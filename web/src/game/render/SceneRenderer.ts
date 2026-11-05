import * as THREE from 'three'
import type { QualityPreset } from '../core/settings'
import { SKY_COLOR } from './TempleScene'

export interface RendererCallbacks {
  onContextLost(): void
  onContextRestored(): void
}

/**
 * Three.js renderer、場景、鏡頭與畫質。不擁有遊戲物件，只負責把場景畫出來。
 */
export class SceneRenderer {
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: THREE.WebGLRenderer
  private preset: QualityPreset
  private resizeObserver: ResizeObserver
  private width = 1
  private height = 1

  // 第三人稱鏡頭參數
  yaw = 0
  pitch = 0.4
  distance = 10
  readonly minDistance = 5
  readonly maxDistance = 20
  private focus = new THREE.Vector3()
  private desired = new THREE.Vector3()

  constructor(
    private readonly canvas: HTMLCanvasElement,
    preset: QualityPreset,
    private readonly callbacks: RendererCallbacks,
  ) {
    this.preset = preset
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: preset.antialias,
      powerPreference: 'low-power',
      stencil: false,
    })
    this.renderer.setClearColor(SKY_COLOR)
    this.scene.background = new THREE.Color(SKY_COLOR)
    this.scene.fog = new THREE.Fog(SKY_COLOR, 28, 95)
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.3, 160)

    const hemi = new THREE.HemisphereLight('#eef3f6', '#6b6450', 2.2)
    const sun = new THREE.DirectionalLight('#fff0d4', 1.8)
    sun.position.set(12, 22, 10)
    this.scene.add(hemi, sun)

    canvas.addEventListener('webglcontextlost', this.onLost)
    canvas.addEventListener('webglcontextrestored', this.onRestored)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas)
    this.resize()
  }

  /** 套用畫質；antialias 需重建 context，於下次載入生效。 */
  setQuality(preset: QualityPreset): void {
    this.preset = preset
    this.resize()
  }

  /** 依畫質限制像素比例與總像素數。 */
  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth)
    const h = Math.max(1, this.canvas.clientHeight)
    let ratio = Math.min(window.devicePixelRatio || 1, this.preset.maxPixelRatio)
    const pixels = w * h * ratio * ratio
    if (pixels > this.preset.maxPixels) ratio *= Math.sqrt(this.preset.maxPixels / pixels)
    this.width = w
    this.height = h
    this.renderer.setPixelRatio(ratio)
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    // 直式手機畫面加大視角，避免左右太窄。
    this.camera.fov = w < h ? 62 : 50
    this.camera.updateProjectionMatrix()
    this.onResize?.()
  }

  onResize: (() => void) | null = null

  get viewport(): { width: number; height: number } {
    return { width: this.width, height: this.height }
  }

  /**
   * 鏡頭跟隨目標。回傳鏡頭是否仍在移動（需要繼續重繪）。
   * snap=true 時直接到位（初次進場、恢復前景）。
   */
  follow(x: number, z: number, dt: number, snap = false): boolean {
    this.focus.set(x, 1.1, z)
    const horiz = Math.cos(this.pitch) * this.distance
    this.desired.set(
      x + Math.sin(this.yaw) * horiz,
      1.1 + Math.sin(this.pitch) * this.distance,
      z + Math.cos(this.yaw) * horiz,
    )
    const cam = this.camera.position
    if (snap) {
      cam.copy(this.desired)
    } else {
      cam.lerp(this.desired, 1 - Math.exp(-dt * 6))
    }
    this.camera.lookAt(this.focus)
    return cam.distanceToSquared(this.desired) > 1e-4
  }

  zoom(delta: number): void {
    this.distance = THREE.MathUtils.clamp(this.distance + delta, this.minDistance, this.maxDistance)
  }

  rotate(dYaw: number, dPitch: number): void {
    this.yaw += dYaw
    this.pitch = THREE.MathUtils.clamp(this.pitch + dPitch, 0.25, 1.2)
  }

  render(): void {
    this.renderer.render(this.scene, this.camera)
  }

  get stats(): { calls: number; triangles: number } {
    const r = this.renderer.info.render
    return { calls: r.calls, triangles: r.triangles }
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored)
    this.resizeObserver.disconnect()
    this.renderer.dispose()
  }

  private onLost = (e: Event): void => {
    // preventDefault 才會讓瀏覽器嘗試恢復 context。
    e.preventDefault()
    this.callbacks.onContextLost()
  }

  private onRestored = (): void => {
    this.callbacks.onContextRestored()
  }
}
