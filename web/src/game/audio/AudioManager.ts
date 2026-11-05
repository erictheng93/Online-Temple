import { ChantMusic } from './ChantMusic'

/**
 * 音訊管理：長音軌（環境音）與短音效分開、獨立音量、淡入淡出、背景暫停。
 *
 * - AudioContext 只能在使用者操作後建立／恢復，因此 unlock() 必須在點擊事件中呼叫。
 * - 長音軌建議用 HTMLMediaElement 串流（playMusic），再接進 Web Audio 統一控制音量（iOS 忽略 media.volume）。
 * - 尚無錄音素材時，以合成方式產生鐘聲、木魚、頌缽、風聲、鳥叫與佛樂作為預設。
 */

type SynthName = 'bell' | 'wood' | 'bowl'

const MAX_VOICES = 12

export interface Volumes {
  master: number
  music: number
  sfx: number
  muted: boolean
}

function synthesize(ctx: BaseAudioContext, name: SynthName): AudioBuffer {
  const sr = ctx.sampleRate
  const spec: Record<SynthName, { seconds: number; partials: Array<[ratio: number, amp: number, decay: number]>; f0: number; click?: number }> = {
    // 寺鐘：不和諧泛音、長衰減
    bell: { seconds: 7, f0: 98, partials: [[1, 1, 3.2], [2.0, 0.6, 2.2], [2.76, 0.45, 1.6], [5.4, 0.25, 0.9], [8.93, 0.12, 0.5]] },
    // 木魚：短促、帶敲擊聲
    wood: { seconds: 0.35, f0: 620, partials: [[1, 1, 0.07], [2.31, 0.4, 0.04]], click: 0.004 },
    // 頌缽：拍頻造成的嗡嗡聲
    bowl: { seconds: 6, f0: 294, partials: [[1, 1, 3.5], [1.006, 0.8, 3.5], [2.71, 0.35, 2], [5.15, 0.12, 1]] },
  }
  const s = spec[name]
  const len = Math.floor(sr * s.seconds)
  const buffer = ctx.createBuffer(1, len, sr)
  const data = buffer.getChannelData(0)
  const attack = Math.floor(sr * 0.004)
  let peak = 0
  for (let i = 0; i < len; i++) {
    const t = i / sr
    let v = 0
    for (const [ratio, amp, decay] of s.partials) {
      v += amp * Math.sin(2 * Math.PI * s.f0 * ratio * t) * Math.exp(-t / decay)
    }
    if (s.click && t < s.click) v += (Math.random() * 2 - 1) * (1 - t / s.click)
    if (i < attack) v *= i / attack
    data[i] = v
    peak = Math.max(peak, Math.abs(v))
  }
  const norm = peak > 0 ? 0.8 / peak : 1
  for (let i = 0; i < len; i++) data[i]! *= norm
  return buffer
}

/**
 * 合成一段鳥叫：數個快速滑音組成的短句。每次呼叫用 random 產生不同的叫法。
 * random 可注入，方便產生可重現的結果。
 */
export function synthesizeBirdCall(ctx: BaseAudioContext, random: () => number = Math.random): AudioBuffer {
  const sr = ctx.sampleRate
  const notes = 2 + Math.floor(random() * 5)
  const trill = random() < 0.4 // 顫音型：振幅快速起伏
  const base = 2600 + random() * 2200
  const spec = Array.from({ length: notes }, () => ({
    dur: 0.05 + random() * 0.09,
    gap: 0.03 + random() * 0.07,
    f0: base * (0.85 + random() * 0.3),
    sweep: (random() - 0.4) * 1800,
  }))
  const total = spec.reduce((t, n) => t + n.dur + n.gap, 0.05)
  const buffer = ctx.createBuffer(1, Math.ceil(total * sr), sr)
  const data = buffer.getChannelData(0)
  let offset = 0
  let peak = 0
  for (const n of spec) {
    const len = Math.floor(n.dur * sr)
    let phase = 0
    for (let i = 0; i < len; i++) {
      const p = i / len
      const f = n.f0 + n.sweep * p
      phase += (2 * Math.PI * f) / sr
      let amp = Math.sin(Math.PI * p) ** 2
      if (trill) amp *= 0.55 + 0.45 * Math.sin(2 * Math.PI * 45 * (i / sr))
      // 少量二次諧波讓聲音不那麼像純正弦波
      const v = amp * (Math.sin(phase) + 0.18 * Math.sin(2 * phase))
      const idx = offset + i
      if (idx < data.length) {
        data[idx] = v
        peak = Math.max(peak, Math.abs(v))
      }
    }
    offset += len + Math.floor(n.gap * sr)
  }
  const norm = peak > 0 ? 0.7 / peak : 1
  for (let i = 0; i < data.length; i++) data[i]! *= norm
  return buffer
}

const BIRD_VARIANTS = 5

export class AudioManager {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private musicBus: GainNode | null = null
  private sfxBus: GainNode | null = null
  private buffers = new Map<string, AudioBuffer>()
  private pendingUrls = new Map<string, string>()
  private voices = 0
  private ambientNodes: AudioNode[] = []
  private ambientSources: AudioScheduledSourceNode[] = []
  private ambientTimer: ReturnType<typeof setTimeout> | null = null
  private birdTimer: ReturnType<typeof setTimeout> | null = null
  private birdBuffers: AudioBuffer[] = []
  private chant: ChantMusic | null = null
  private media: HTMLAudioElement | null = null
  private mediaNode: MediaElementAudioSourceNode | null = null
  private volumes: Volumes = { master: 0.8, music: 0.6, sfx: 0.8, muted: false }
  private suspendedByApp = false

  get unlocked(): boolean {
    return this.ctx !== null
  }

  /** 在使用者點擊時呼叫。重複呼叫安全。 */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      const ctx = new Ctor({ latencyHint: 'playback' })
      this.ctx = ctx
      this.master = ctx.createGain()
      this.musicBus = ctx.createGain()
      this.sfxBus = ctx.createGain()
      this.master.gain.value = 0
      this.musicBus.connect(this.master)
      this.sfxBus.connect(this.master)
      this.master.connect(ctx.destination)
      for (const n of ['bell', 'wood', 'bowl'] as const) this.buffers.set(n, synthesize(ctx, n))
      this.birdBuffers = Array.from({ length: BIRD_VARIANTS }, () => synthesizeBirdCall(ctx))
      for (const [name, url] of this.pendingUrls) void this.loadSfx(name, url)
      this.pendingUrls.clear()
      this.applyVolumes(1.5)
    }
    await this.resume()
  }

  setVolumes(v: Volumes): void {
    this.volumes = { ...v }
    this.applyVolumes(0.15)
  }

  /** 以 URL 載入或替換音效（例如正式錄製的鐘聲）。unlock 前呼叫會延後載入。 */
  async loadSfx(name: string, url: string): Promise<void> {
    if (!this.ctx) {
      this.pendingUrls.set(name, url)
      return
    }
    const res = await fetch(url)
    if (!res.ok) throw new Error(`音效載入失敗：${url}`)
    this.buffers.set(name, await this.ctx.decodeAudioData(await res.arrayBuffer()))
  }

  hasSfx(name: string): boolean {
    return this.buffers.has(name) || this.pendingUrls.has(name)
  }

  /** 播放短音效。gain 可用於距離衰減。超過同時發聲上限時略過。 */
  play(name: string, opts: { gain?: number; rate?: number } = {}): void {
    const ctx = this.ctx
    const buffer = this.buffers.get(name)
    if (!ctx || !buffer || !this.sfxBus || ctx.state !== 'running' || this.voices >= MAX_VOICES) return
    const gain = opts.gain ?? 1
    if (gain < 0.01) return
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.playbackRate.value = opts.rate ?? 1
    const g = ctx.createGain()
    g.gain.value = gain
    src.connect(g).connect(this.sfxBus)
    this.voices++
    src.onended = () => {
      this.voices--
      src.disconnect()
      g.disconnect()
    }
    src.start()
  }

  /**
   * 開始環境音。有 url 時串流播放錄音，否則用合成風聲與佛樂；兩種模式都有鳥叫。
   */
  startAmbient(url?: string): void {
    const ctx = this.ctx
    if (!ctx || !this.musicBus) return
    this.stopAmbient()
    if (url) {
      const media = new Audio()
      media.crossOrigin = 'anonymous'
      media.src = url
      media.loop = true
      media.preload = 'auto'
      this.media = media
      this.mediaNode = ctx.createMediaElementSource(media)
      this.mediaNode.connect(this.musicBus)
      void media.play().catch(() => {})
      this.scheduleBirds()
      return
    }

    // 風聲：循環白噪音經低通濾波，增益由極慢的 LFO 調變。
    const noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate)
    const d = noise.getChannelData(0)
    let last = 0
    for (let i = 0; i < d.length; i++) {
      last = last * 0.97 + (Math.random() * 2 - 1) * 0.03
      d[i] = last * 6
    }
    const src = ctx.createBufferSource()
    src.buffer = noise
    src.loop = true
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 420
    const windGain = ctx.createGain()
    windGain.gain.value = 0.22
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.07
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 0.12
    lfo.connect(lfoGain).connect(windGain.gain)
    src.connect(lp).connect(windGain).connect(this.musicBus)

    for (const s of [src, lfo]) s.start()
    this.ambientSources = [src, lfo]
    this.ambientNodes = [lp, windGain, lfoGain]

    // 程序化佛樂：持續和聲、簫聲旋律與殘響。
    this.chant = new ChantMusic(ctx, this.musicBus)
    this.chant.start()
    this.scheduleDistantBowl()
    this.scheduleBirds()
  }

  stopAmbient(): void {
    if (this.ambientTimer) clearTimeout(this.ambientTimer)
    if (this.birdTimer) clearTimeout(this.birdTimer)
    this.ambientTimer = this.birdTimer = null
    this.chant?.stop()
    this.chant = null
    for (const s of this.ambientSources) {
      try {
        s.stop()
      } catch {
        // 已停止
      }
      s.disconnect()
    }
    for (const n of this.ambientNodes) n.disconnect()
    this.ambientSources = []
    this.ambientNodes = []
    if (this.media) {
      this.media.pause()
      this.media.removeAttribute('src')
      this.media.load()
      this.mediaNode?.disconnect()
      this.media = null
      this.mediaNode = null
    }
  }

  /** 進入背景：淡出後暫停 AudioContext，停止耗電。 */
  async suspend(): Promise<void> {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    this.suspendedByApp = true
    this.fadeMaster(0, 0.25)
    this.media?.pause()
    await new Promise((r) => setTimeout(r, 300))
    if (this.suspendedByApp) await ctx.suspend().catch(() => {})
  }

  /** 恢復播放並淡入。iOS 來電等中斷後也透過這裡恢復。 */
  async resume(): Promise<void> {
    const ctx = this.ctx
    if (!ctx) return
    this.suspendedByApp = false
    if (ctx.state !== 'running') await ctx.resume().catch(() => {})
    if (this.media?.paused) void this.media.play().catch(() => {})
    this.applyVolumes(0.8)
  }

  get running(): boolean {
    return this.ctx?.state === 'running'
  }

  async dispose(): Promise<void> {
    this.stopAmbient()
    const ctx = this.ctx
    this.ctx = null
    this.buffers.clear()
    if (ctx) await ctx.close().catch(() => {})
  }

  /** 每隔數秒隨機一聲鳥叫，偶爾有另一隻鳥回應。 */
  private scheduleBirds(): void {
    this.birdTimer = setTimeout(() => {
      this.playBird()
      if (Math.random() < 0.35) setTimeout(() => this.playBird(), 600 + Math.random() * 1200)
      this.scheduleBirds()
    }, 4_000 + Math.random() * 10_000)
  }

  /** 鳥叫走環境音軌（musicBus），由「環境音」音量控制；左右位置與音高隨機。 */
  private playBird(): void {
    const ctx = this.ctx
    const buffer = this.birdBuffers[Math.floor(Math.random() * this.birdBuffers.length)]
    if (!ctx || !buffer || !this.musicBus || ctx.state !== 'running' || this.voices >= MAX_VOICES) return
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.playbackRate.value = 0.9 + Math.random() * 0.2
    const gain = ctx.createGain()
    gain.gain.value = 0.05 + Math.random() * 0.1
    const nodes: AudioNode[] = [src, gain]
    let tail: AudioNode = src.connect(gain)
    if (typeof ctx.createStereoPanner === 'function') {
      const pan = ctx.createStereoPanner()
      pan.pan.value = (Math.random() * 2 - 1) * 0.8
      tail = tail.connect(pan)
      nodes.push(pan)
    }
    tail.connect(this.musicBus)
    this.voices++
    src.onended = () => {
      this.voices--
      for (const n of nodes) n.disconnect()
    }
    src.start()
  }

  private scheduleDistantBowl(): void {
    this.ambientTimer = setTimeout(() => {
      this.play('bowl', { gain: 0.12, rate: 0.85 + Math.random() * 0.3 })
      this.scheduleDistantBowl()
    }, 25_000 + Math.random() * 30_000)
  }

  private applyVolumes(fadeSeconds: number): void {
    const ctx = this.ctx
    if (!ctx || !this.musicBus || !this.sfxBus) return
    const now = ctx.currentTime
    this.musicBus.gain.setTargetAtTime(this.volumes.music, now, 0.1)
    this.sfxBus.gain.setTargetAtTime(this.volumes.sfx, now, 0.1)
    this.fadeMaster(this.volumes.muted ? 0 : this.volumes.master, fadeSeconds)
  }

  private fadeMaster(value: number, seconds: number): void {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    const g = this.master.gain
    const now = ctx.currentTime
    g.cancelScheduledValues(now)
    g.setValueAtTime(g.value, now)
    g.linearRampToValueAtTime(value, now + Math.max(0.01, seconds))
  }
}
