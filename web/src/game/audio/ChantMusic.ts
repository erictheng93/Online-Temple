/**
 * 程序化佛樂：五聲音階（A 宮：A B C# E F#）的持續和聲、簫聲旋律與殿內殘響。
 * 每次都是即時生成的原創樂句，不重複播放固定曲目，長時間聆聽也不會循環得很明顯。
 *
 * 所有事件以 AudioContext 時間排程；context 暫停時不排程，避免恢復時事件擠在同一刻。
 */

const A2 = 110
/** 五聲音階相對 A 的半音數。 */
const PENTATONIC = [0, 2, 4, 7, 9]

export const freqOf = (degree: number, octave: number): number => {
  const step = PENTATONIC[((degree % 5) + 5) % 5]! + 12 * (octave + Math.floor(degree / 5))
  return A2 * 2 ** (step / 12)
}

/** 合成殘響用的脈衝響應：指數衰減的雙聲道雜訊。 */
function makeImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3
  }
  return buf
}

export class ChantMusic {
  private input: GainNode
  private reverb: ConvolverNode
  private wet: GainNode
  private nodes: AudioNode[] = []
  private drones: OscillatorNode[] = []
  private padTimer: ReturnType<typeof setTimeout> | null = null
  private melodyTimer: ReturnType<typeof setTimeout> | null = null
  private noise: AudioBuffer
  private lastDegree = 0
  private stopped = false

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
  ) {
    this.input = ctx.createGain()
    this.input.gain.value = 0.9
    this.reverb = ctx.createConvolver()
    this.reverb.buffer = makeImpulse(ctx, 3.5)
    this.wet = ctx.createGain()
    this.wet.gain.value = 0.55
    this.input.connect(destination)
    this.input.connect(this.reverb).connect(this.wet).connect(destination)
    this.nodes.push(this.input, this.reverb, this.wet)

    const n = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const d = n.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    this.noise = n
  }

  start(): void {
    const ctx = this.ctx
    // 低音持續音：宮音與徵音（A1、E2），略微失諧產生緩慢拍頻。
    const droneGain = ctx.createGain()
    droneGain.gain.value = 0
    droneGain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 6)
    droneGain.connect(this.input)
    this.nodes.push(droneGain)
    for (const f of [A2 / 2, A2 / 2 + 0.25, freqOf(3, -1)]) {
      const o = ctx.createOscillator()
      o.frequency.value = f
      o.connect(droneGain)
      o.start()
      this.drones.push(o)
    }
    this.schedulePad(1_000)
    this.scheduleMelody(8_000)
  }

  stop(): void {
    this.stopped = true
    if (this.padTimer) clearTimeout(this.padTimer)
    if (this.melodyTimer) clearTimeout(this.melodyTimer)
    for (const o of this.drones) {
      try {
        o.stop()
      } catch {
        // 已停止
      }
    }
    for (const n of [...this.drones, ...this.nodes]) n.disconnect()
    this.drones = []
    this.nodes = []
  }

  private get running(): boolean {
    return !this.stopped && this.ctx.state === 'running'
  }

  // ---------- 持續和聲 ----------

  private schedulePad(delayMs: number): void {
    this.padTimer = setTimeout(() => {
      const length = 12 + Math.random() * 6
      if (this.running) this.playPad(length)
      // 前後和聲重疊約 5 秒，交叉淡化。
      this.schedulePad((length - 5) * 1000)
    }, delayMs)
  }

  private playPad(seconds: number): void {
    const ctx = this.ctx
    const t = ctx.currentTime
    const root = [0, 3, 4, 1][Math.floor(Math.random() * 4)]!
    // 根音、五度、八度（空五度和聲，沒有大小三度，聽起來空靈而莊嚴）
    const freqs = [freqOf(root, 1), freqOf(root, 1) * 1.5, freqOf(root, 2)]
    const env = ctx.createGain()
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(0.035, t + 4)
    env.gain.setValueAtTime(0.035, t + seconds - 5)
    env.gain.linearRampToValueAtTime(0, t + seconds)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 900
    lp.Q.value = 0.3
    env.connect(lp).connect(this.input)

    const oscs = freqs.flatMap((f) =>
      [-3, 3].map((cents) => {
        const o = ctx.createOscillator()
        o.type = 'triangle'
        o.frequency.value = f
        o.detune.value = cents
        o.connect(env)
        o.start(t)
        o.stop(t + seconds + 0.1)
        return o
      }),
    )
    oscs[0]!.onended = () => {
      for (const o of oscs) o.disconnect()
      env.disconnect()
      lp.disconnect()
    }
  }

  // ---------- 簫聲旋律 ----------

  private scheduleMelody(delayMs: number): void {
    this.melodyTimer = setTimeout(() => {
      let phraseSeconds = 0
      if (this.running) phraseSeconds = this.playPhrase()
      this.scheduleMelody((phraseSeconds + 20 + Math.random() * 20) * 1000)
    }, delayMs)
  }

  /** 播放一句旋律，回傳長度（秒）。以級進為主，偶爾跳進，句尾回到宮音或徵音。 */
  private playPhrase(): number {
    const count = 3 + Math.floor(Math.random() * 4)
    let t = this.ctx.currentTime + 0.1
    let degree = this.lastDegree
    for (let i = 0; i < count; i++) {
      const last = i === count - 1
      if (last) {
        degree = Math.random() < 0.6 ? 5 : 3 // 宮（高八度 A）或徵（E）
      } else {
        const leap = Math.random() < 0.2 ? (Math.random() < 0.5 ? -2 : 2) : Math.random() < 0.5 ? -1 : 1
        degree = Math.min(8, Math.max(1, degree + leap))
      }
      const dur = last ? 3 + Math.random() * 1.5 : 1.2 + Math.random() * 1.6
      this.playFluteNote(freqOf(degree, 2), t, dur)
      t += dur + 0.15 + Math.random() * 0.35
    }
    this.lastDegree = degree
    return t - this.ctx.currentTime
  }

  private playFluteNote(freq: number, t: number, dur: number): void {
    const ctx = this.ctx
    const env = ctx.createGain()
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(0.06, t + 0.35)
    env.gain.setValueAtTime(0.055, t + dur - 0.6)
    env.gain.linearRampToValueAtTime(0, t + dur)
    env.connect(this.input)

    // 音色：正弦基音加少量三倍頻。
    const o = ctx.createOscillator()
    o.frequency.value = freq
    const h = ctx.createOscillator()
    h.frequency.value = freq * 3
    const hGain = ctx.createGain()
    hGain.gain.value = 0.08
    o.connect(env)
    h.connect(hGain).connect(env)

    // 延遲出現的顫音，模仿吹奏者在長音後段加入的揉音。
    const vib = ctx.createOscillator()
    vib.frequency.value = 4.8
    const vibDepth = ctx.createGain()
    vibDepth.gain.setValueAtTime(0, t)
    vibDepth.gain.linearRampToValueAtTime(freq * 0.006, t + Math.min(dur, 1.2))
    vib.connect(vibDepth)
    vibDepth.connect(o.frequency)
    vibDepth.connect(h.frequency)

    // 氣聲：帶通濾波雜訊。
    const breath = ctx.createBufferSource()
    breath.buffer = this.noise
    breath.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = freq * 2
    bp.Q.value = 1.5
    const bGain = ctx.createGain()
    bGain.gain.value = 0.18
    breath.connect(bp).connect(bGain).connect(env)

    const sources = [o, h, vib, breath]
    for (const s of sources) {
      s.start(t)
      s.stop(t + dur + 0.05)
    }
    o.onended = () => {
      for (const n of [...sources, hGain, vibDepth, bp, bGain, env]) n.disconnect()
    }
  }
}
