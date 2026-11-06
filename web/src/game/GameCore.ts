import * as THREE from 'three'
import { AnimationSystem } from './anim/AnimationSystem'
import { AudioManager } from './audio/AudioManager'
import { Emitter } from './core/Emitter'
import { QUALITY_PRESETS, resolveQuality, type QualityLevel, type Settings } from './core/settings'
import { ActionRegistry } from './gameplay/ActionRegistry'
import { gameplayModules } from './gameplay/modules'
import type { GameEvents, GameplayApi } from './gameplay/types'
import { InputController } from './input/InputController'
import { NetworkClient, type ConnectionStatus } from './net/NetworkClient'
import type { ServerMessage } from './net/protocol'
import { ResourceTracker } from './render/ResourceTracker'
import { SceneRenderer } from './render/SceneRenderer'
import { buildTempleScene, type TempleScene } from './render/TempleScene'
import { OBSTACLES, WORLD_BOUNDS } from './world/layout'
import { resolveCollisions, stepMover, type MoveConfig } from './world/movement'
import { Players } from './world/Players'

export interface UiAction {
  id: string
  label: string
  glyph?: string
  cooldownMs: number
  /** 冷卻結束的時間（performance.now 毫秒），UI 自行計算倒數。 */
  readyAt: number
}

/** 給 Vue 的低頻狀態摘要。遊戲核心只在內容改變時推送。 */
export interface UiState {
  status: ConnectionStatus
  networkEnabled: boolean
  room: string | null
  online: number
  quality: QualityLevel
  contextLost: boolean
  actions: UiAction[]
  stats: Array<{ key: string; label: string; value: string | number }>
  perf: { fps: number; frameMs: number; calls: number; triangles: number; rttMs: number | null }
}

export interface GameCoreOptions {
  canvas: HTMLCanvasElement
  settings: Settings
  wsUrl?: string
  ambientUrl?: string
  onUi(state: UiState): void
  onToast(message: string): void
}

const MOVE_SPEED = 3.2
const SFX_HEARING_RANGE = 28
const UI_PUSH_MS = 250

/**
 * 遊戲核心：擁有所有子系統，並負責它們的建立與釋放順序。
 * 渲染頻率（rAF + 畫質幀率上限）與網路頻率（NetworkClient 的 sendHz）分開管理。
 */
export class GameCore {
  readonly events = new Emitter<GameEvents>()
  private renderer: SceneRenderer
  private tracker = new ResourceTracker()
  private temple: TempleScene
  private anim = new AnimationSystem()
  private players: Players
  private input: InputController
  private net: NetworkClient
  private audio = new AudioManager()
  private actions = new ActionRegistry()
  private uninstallers: Array<() => void> = []
  private moveCfg: MoveConfig = { speed: MOVE_SPEED, bounds: WORLD_BOUNDS, obstacles: OBSTACLES }
  private raycaster = new THREE.Raycaster()
  private marker: THREE.Mesh
  private markerUntil = 0

  private settings: Settings
  private quality: QualityLevel
  private raf = 0
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private lastTime = 0
  private lastRender = 0
  private startTime = performance.now()
  private dirty = true
  private snapCamera = true
  private paused = false
  private contextLost = false
  private wasMoving = false
  private disposed = false

  private room: string | null = null
  private selfId: string | null = null
  private serverOffset = 0
  private rtt: number | null = null
  private stats = new Map<string, { label: string; value: string | number }>()
  private uiTimer: ReturnType<typeof setInterval>
  private lastUiJson = ''
  private frames = 0
  private frameMsSum = 0
  private fps = 0
  private frameMs = 0
  private fpsWindowStart = performance.now()

  constructor(private readonly opts: GameCoreOptions) {
    this.settings = opts.settings
    this.quality = resolveQuality(opts.settings.quality)
    const preset = QUALITY_PRESETS[this.quality]

    this.renderer = new SceneRenderer(opts.canvas, preset, {
      onContextLost: () => {
        this.contextLost = true
        this.stopLoop()
        this.pushUi(true)
      },
      onContextRestored: () => {
        this.contextLost = false
        this.pushUi(true)
        this.wake()
      },
    })
    this.renderer.onResize = () => this.wake()

    this.temple = buildTempleScene(this.tracker)
    this.renderer.scene.add(this.temple.root)

    const markerGeo = this.tracker.track(new THREE.RingGeometry(0.28, 0.4, 24))
    markerGeo.rotateX(-Math.PI / 2)
    const markerMat = this.tracker.trackMaterial(
      new THREE.MeshBasicMaterial({ color: '#fff6e0', transparent: true, opacity: 0, depthWrite: false }),
    )
    this.marker = new THREE.Mesh(markerGeo, markerMat)
    this.marker.position.y = 0.08
    this.marker.visible = false
    this.renderer.scene.add(this.marker)

    this.players = new Players(this.renderer.scene, this.anim, this.maxVisibleFor(this.quality))

    this.input = new InputController(opts.canvas, {
      onTap: (x, y) => this.onTap(x, y),
      onRotate: (dx, dy) => {
        this.renderer.rotate(-dx * 0.006, dy * 0.004)
        this.wake()
      },
      onZoom: (d) => {
        this.renderer.zoom(d)
        this.wake()
      },
      onActivity: () => {
        // 使用者有操作時順便嘗試恢復被系統中斷的音訊（iOS）。
        if (this.audio.audible && !this.audio.running && !this.paused) void this.audio.resume()
        this.wake()
      },
    })

    this.net = new NetworkClient({ url: opts.wsUrl, name: '' })
    this.net.events.on('status', () => this.pushUi(true))
    this.net.events.on('message', (m) => this.onServerMessage(m))
    this.net.events.on('rtt', (ms) => (this.rtt = ms))

    this.audio.setVolumes(this.volumes())
    this.installGameplay()
    this.actions.subscribe(() => this.pushUi(true))

    document.addEventListener('visibilitychange', this.onVisibility)
    this.uiTimer = setInterval(() => this.pushUi(false), UI_PUSH_MS)
  }

  /** 進入遊戲：必須在使用者點擊事件中呼叫，才能啟用音訊。 */
  async enter(playerName: string): Promise<void> {
    this.net.setName(playerName)
    await this.audio.unlock()
    this.audio.startAmbient(this.opts.ambientUrl)
    this.net.connect()
    this.snapCamera = true
    this.wake()
    this.pushUi(true)
  }

  /** 開始渲染場景（進場前就先顯示背景畫面）。 */
  start(): void {
    this.wake()
  }

  performAction(id: string): void {
    const now = performance.now()
    const local = this.players.local
    if (now < local.lockedUntil) return
    const def = this.actions.tryBegin(id, now)
    if (!def) return

    if (def.locksMovement) {
      local.lockedUntil = now + def.durationMs
      local.mover.target = null
    }
    this.anim.play(local.anim, def.animation, now, def.durationMs)
    if (def.sound) this.audio.play(def.sound)
    this.events.emit('actionPerformed', {
      playerId: this.selfId ?? 'local',
      actionId: id,
      local: true,
      x: local.mover.x,
      z: local.mover.z,
    })
    this.wake()
    this.pushUi(true)

    void this.net.sendAction(id).then((res) => {
      if (this.disposed) return
      if (res.ok) def.onConfirmed?.()
      else this.opts.onToast(res.reason === 'timeout' ? '連線不穩，動作未送達' : `動作未完成：${res.reason ?? '未知原因'}`)
    })
  }

  applySettings(settings: Settings): void {
    this.settings = settings
    const q = resolveQuality(settings.quality)
    if (q !== this.quality) {
      this.quality = q
      this.renderer.setQuality(QUALITY_PRESETS[q])
      this.players.maxVisible = this.maxVisibleFor(q)
    }
    this.audio.setVolumes(this.volumes())
    this.wake()
    this.pushUi(true)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    document.removeEventListener('visibilitychange', this.onVisibility)
    clearInterval(this.uiTimer)
    this.stopLoop()
    for (const off of this.uninstallers) off()
    this.uninstallers = []
    this.input.dispose()
    this.net.dispose()
    void this.audio.dispose()
    this.players.dispose()
    this.tracker.dispose()
    this.renderer.dispose()
    this.events.clear()
  }

  // ---------- 渲染迴圈 ----------

  /** 喚醒渲染迴圈；畫面靜止時迴圈會自行停止以節省電力。 */
  private wake = (): void => {
    this.dirty = true
    if (this.paused || this.contextLost || this.disposed) return
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    if (!this.raf) this.raf = requestAnimationFrame(this.frame)
  }

  private stopLoop(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.raf = 0
    this.idleTimer = null
  }

  private frame = (time: number): void => {
    this.raf = 0
    if (this.paused || this.contextLost) return
    const preset = QUALITY_PRESETS[this.quality]

    // 依目標幀率略過多餘的 rAF（高更新率螢幕上限制在 30/60 FPS）。
    const minInterval = 1000 / preset.activeFps - 1
    if (!this.dirty && time - this.lastRender < minInterval) {
      this.raf = requestAnimationFrame(this.frame)
      return
    }

    const dt = this.lastTime ? Math.min(0.1, (time - this.lastTime) / 1000) : 0
    this.lastTime = time
    const t = (time - this.startTime) / 1000
    const cpuStart = performance.now()

    const active = this.update(time, dt, t)
    this.renderer.render()
    this.lastRender = time
    this.dirty = false
    this.countFrame(performance.now() - cpuStart, time)

    if (active) {
      this.raf = requestAnimationFrame(this.frame)
    } else if (preset.idleFps > 0) {
      // 靜止時以低幀率繪製環境動畫（燈火、香煙）。
      this.idleTimer = setTimeout(() => {
        this.idleTimer = null
        this.raf = requestAnimationFrame(this.frame)
      }, 1000 / preset.idleFps)
    } else {
      // 完全靜止：停止迴圈，等待輸入或網路事件喚醒。下一次喚醒的 dt 不應包含閒置時間。
      this.lastTime = 0
    }
  }

  private update(now: number, dt: number, t: number): boolean {
    const local = this.players.local
    let moving = false
    // 有移動意圖就保持迴圈運作；喚醒後第一幀 dt=0 不會位移，不能只看本幀是否移動。
    let wantsMove = false

    if (now >= local.lockedUntil) {
      const k = this.input.keyDirection
      wantsMove = k.x !== 0 || k.y !== 0 || local.mover.target !== null
      const yaw = this.renderer.yaw
      // 鏡頭在角色後方 (sin yaw, cos yaw) 方向，畫面「上」= 遠離鏡頭。
      const dirX = Math.cos(yaw) * k.x + Math.sin(yaw) * k.y
      const dirZ = -Math.sin(yaw) * k.x + Math.cos(yaw) * k.y
      moving = stepMover(local.mover, { dirX, dirZ }, dt, this.moveCfg)
    }
    local.anim.moving = moving

    if (moving) {
      this.net.sendPosition(local.mover.x, local.mover.z, local.mover.heading, true)
    } else if (this.wasMoving) {
      this.net.sendPosition(local.mover.x, local.mover.z, local.mover.heading, false)
    }
    this.wasMoving = moving

    const playersActive = this.players.update(now, dt, t)
    this.temple.update(t, dt)
    const cameraMoving = this.renderer.follow(local.mover.x, local.mover.z, dt, this.snapCamera)
    this.snapCamera = false

    let markerActive = false
    if (this.marker.visible) {
      const left = this.markerUntil - now
      const mat = this.marker.material as THREE.MeshBasicMaterial
      if (left <= 0 || !local.mover.target) {
        this.marker.visible = false
      } else {
        mat.opacity = Math.min(1, left / 400) * 0.8
        const s = 1 + Math.sin(t * 6) * 0.08
        this.marker.scale.set(s, 1, s)
        markerActive = true
      }
    }

    return moving || wantsMove || playersActive || cameraMoving || markerActive || this.temple.hasTransientMotion()
  }

  private countFrame(cpuMs: number, time: number): void {
    // 迴圈剛從停止狀態恢復：重開統計區間，避免把閒置時間算進幀率。
    if (time - this.fpsWindowStart > 2000) {
      this.fpsWindowStart = time
      this.frames = 0
      this.frameMsSum = 0
      return
    }
    this.frames++
    this.frameMsSum += cpuMs
    const elapsed = time - this.fpsWindowStart
    if (elapsed >= 1000) {
      this.fps = Math.round((this.frames * 1000) / elapsed)
      this.frameMs = this.frameMsSum / this.frames
      this.frames = 0
      this.frameMsSum = 0
      this.fpsWindowStart = time
    }
  }

  // ---------- 輸入 ----------

  private onTap(ndcX: number, ndcY: number): void {
    const local = this.players.local
    if (performance.now() < local.lockedUntil) return
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.renderer.camera)
    const hit = this.raycaster.intersectObject(this.temple.walkSurface, false)[0]
    if (!hit) return
    const p = resolveCollisions(hit.point.x, hit.point.z, this.moveCfg)
    local.mover.target = p
    this.marker.position.set(p.x, 0.08, p.z)
    this.marker.visible = true
    this.markerUntil = performance.now() + 1600
    this.wake()
  }

  // ---------- 生命週期 ----------

  private onVisibility = (): void => {
    if (document.hidden) {
      this.paused = true
      this.stopLoop()
      this.input.clearKeys()
      this.net.setBackground(true)
      void this.audio.suspend()
    } else {
      this.paused = false
      // 回前景：時間基準重設，避免一次跳一大步；鏡頭直接到位。
      this.lastTime = 0
      this.snapCamera = true
      this.net.setBackground(false)
      if (this.audio.unlocked) void this.audio.resume()
      this.wake()
    }
  }

  // ---------- 網路 ----------

  private onServerMessage(m: ServerMessage): void {
    switch (m.t) {
      case 'welcome': {
        this.selfId = m.selfId
        this.room = m.room
        this.serverOffset = m.serverTime - performance.now()
        this.players.clearRemotes()
        for (const p of m.players) {
          if (p.id === m.selfId) {
            const pos = resolveCollisions(p.x, p.z, this.moveCfg)
            Object.assign(this.players.local.mover, { ...pos, heading: p.heading, target: null })
            this.snapCamera = true
          } else {
            const r = this.players.upsert(p)
            if (p.action) {
              const def = this.actions.get(p.action.id)
              if (def) this.anim.play(r.anim, def.animation, performance.now(), def.durationMs, p.action.startedAt - this.serverOffset)
            }
          }
        }
        break
      }
      case 'join':
        if (m.player.id !== this.selfId) {
          this.players.upsert(m.player)
          this.events.emit('playerJoined', { id: m.player.id, name: m.player.name })
        }
        break
      case 'leave':
        this.players.remove(m.id)
        this.events.emit('playerLeft', { id: m.id })
        break
      case 'move':
        if (m.id !== this.selfId) this.players.setRemoteTarget(m.id, m.x, m.z, m.heading, m.moving)
        break
      case 'moves':
        for (const [id, x, z, heading, moving] of m.m) {
          if (id !== this.selfId) this.players.setRemoteTarget(id, x, z, heading, moving === 1)
        }
        break
      case 'action':
        this.onRemoteAction(m)
        break
      case 'pong':
        this.serverOffset = m.serverTime - performance.now()
        break
      case 'error':
        this.opts.onToast(m.message)
        break
    }
    if (m.t === 'welcome' || m.t === 'join' || m.t === 'leave') this.pushUi(true)
    this.wake()
  }

  private onRemoteAction(m: Extract<ServerMessage, { t: 'action' }>): void {
    if (m.playerId === this.selfId) return
    const r = this.players.remotes.get(m.playerId)
    const def = this.actions.get(m.id)
    if (!r || !def) return
    const now = performance.now()
    const startedAt = m.startedAt - this.serverOffset
    if (now - startedAt > def.durationMs) return
    this.anim.play(r.anim, def.animation, now, def.durationMs, startedAt)
    if (def.sound && now - startedAt < 1500) {
      const local = this.players.local.mover
      const d = Math.hypot(r.x - local.x, r.z - local.z)
      this.audio.play(def.sound, { gain: Math.max(0, 1 - d / SFX_HEARING_RANGE) * 0.7 })
    }
    this.events.emit('actionPerformed', { playerId: r.id, actionId: m.id, local: false, x: r.x, z: r.z })
  }

  // ---------- 玩法模組 ----------

  private installGameplay(): void {
    const api: GameplayApi = {
      actions: this.actions,
      animations: this.anim,
      audio: this.audio,
      events: this.events,
      scene: {
        swingBell: () => {
          this.temple.swingBell()
          this.wake()
        },
      },
      setStat: (key, label, value) => {
        if (value === null) this.stats.delete(key)
        else this.stats.set(key, { label, value })
        this.pushUi(true)
      },
      localPosition: () => ({ x: this.players.local.mover.x, z: this.players.local.mover.z }),
    }
    for (const mod of gameplayModules) {
      try {
        this.uninstallers.push(mod.install(api))
      } catch (err) {
        console.error(`玩法模組 ${mod.id} 安裝失敗`, err)
      }
    }
  }

  // ---------- UI 橋接 ----------

  private pushUi(force: boolean): void {
    if (this.disposed) return
    const r = this.renderer.stats
    const state: UiState = {
      status: this.net.connectionStatus,
      networkEnabled: this.net.enabled,
      room: this.room,
      online: this.net.enabled ? this.players.count : 1,
      quality: this.quality,
      contextLost: this.contextLost,
      actions: this.actions.list().map((a) => ({
        id: a.id,
        label: a.label,
        glyph: a.glyph,
        cooldownMs: a.cooldownMs,
        readyAt: this.actions.readyAt(a.id),
      })),
      stats: [...this.stats].map(([key, s]) => ({ key, ...s })),
      // 迴圈停止時不再計幀，顯示 0 而非最後一次的數值。
      perf: { fps: performance.now() - this.lastRender > 1500 ? 0 : this.fps, frameMs: this.frameMs, calls: r.calls, triangles: r.triangles, rttMs: this.rtt },
    }
    const json = JSON.stringify(state)
    if (!force && json === this.lastUiJson) return
    this.lastUiJson = json
    this.opts.onUi(state)
  }

  private volumes() {
    const s = this.settings
    return { master: s.masterVolume, music: s.musicVolume, sfx: s.sfxVolume, muted: s.muted }
  }

  private maxVisibleFor(q: QualityLevel): number {
    return q === 'low' ? 30 : q === 'medium' ? 60 : 120
  }
}

