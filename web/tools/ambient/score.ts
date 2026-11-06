/**
 * 環境音樂譜：風聲、低音持續音、五聲音階（A 宮：A B C# E F#）持續和聲、簫聲旋律與殿內殘響。
 *
 * 只用於離線產生音檔（tools/ambient/render.ts），遊戲執行時不即時合成，避免手機持續運算。
 * 所有事件在呼叫時一次排程到絕對時間，適用任何 BaseAudioContext（含 OfflineAudioContext）。
 */

const A2 = 110
/** 五聲音階相對 A 的半音數。 */
const PENTATONIC = [0, 2, 4, 7, 9]

export const freqOf = (degree: number, octave: number): number => {
  const step = PENTATONIC[((degree % 5) + 5) % 5]! + 12 * (octave + Math.floor(degree / 5))
  return A2 * 2 ** (step / 12)
}

/** 可重現的亂數（同一 seed 產生同一首）。 */
export function seededRandom(seed: number): () => number {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number, random: () => number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = random() * 2 - 1
  return buf
}

function impulse(ctx: BaseAudioContext, seconds: number, random: () => number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) d[i] = (random() * 2 - 1) * (1 - i / len) ** 3
  }
  return buf
}

/** 排程整段環境音樂到 [0, seconds)。 */
export function scheduleAmbient(ctx: BaseAudioContext, out: AudioNode, seconds: number, random: () => number): void {
  // 殘響匯流排
  const dry = ctx.createGain()
  dry.gain.value = 0.9
  const reverb = ctx.createConvolver()
  reverb.buffer = impulse(ctx, 3.5, random)
  const wet = ctx.createGain()
  wet.gain.value = 0.55
  dry.connect(out)
  dry.connect(reverb)
  reverb.connect(wet)
  wet.connect(out)

  const noise = noiseBuffer(ctx, 2, random)
  scheduleWind(ctx, out, seconds, random)
  scheduleDrone(ctx, dry, seconds)

  // 持續和聲：前後重疊約 5 秒交叉淡化
  for (let t = 0; t < seconds; ) {
    const len = 12 + random() * 6
    playPad(ctx, dry, t, len, random)
    t += len - 5
  }

  // 簫聲旋律
  let degree = 0
  for (let t = 6; t < seconds - 8; ) {
    const phrase = playPhrase(ctx, dry, noise, t, degree, random)
    degree = phrase.lastDegree
    t = phrase.end + 20 + random() * 20
  }
}

/** 風聲：低通濾波的褐噪音，增益由極慢的 LFO 調變。 */
function scheduleWind(ctx: BaseAudioContext, out: AudioNode, seconds: number, random: () => number): void {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate)
  const d = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < d.length; i++) {
    last = last * 0.97 + (random() * 2 - 1) * 0.03
    d[i] = last * 6
  }
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = true
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 420
  const gain = ctx.createGain()
  gain.gain.value = 0.22
  const lfo = ctx.createOscillator()
  lfo.frequency.value = 0.07
  const lfoGain = ctx.createGain()
  lfoGain.gain.value = 0.12
  lfo.connect(lfoGain)
  lfoGain.connect(gain.gain)
  src.connect(lp)
  lp.connect(gain)
  gain.connect(out)
  src.start(0)
  lfo.start(0)
  src.stop(seconds)
  lfo.stop(seconds)
}

/** 低音持續音：宮音與徵音，略微失諧產生緩慢拍頻。 */
function scheduleDrone(ctx: BaseAudioContext, out: AudioNode, seconds: number): void {
  const g = ctx.createGain()
  g.gain.value = 0.05
  g.connect(out)
  for (const f of [A2 / 2, A2 / 2 + 0.25, freqOf(3, -1)]) {
    const o = ctx.createOscillator()
    o.frequency.value = f
    o.connect(g)
    o.start(0)
    o.stop(seconds)
  }
}

/** 空五度和聲（根音、五度、八度），三角波經低通濾波。 */
function playPad(ctx: BaseAudioContext, out: AudioNode, t: number, seconds: number, random: () => number): void {
  const root = [0, 3, 4, 1][Math.floor(random() * 4)]!
  const base = freqOf(root, 1)
  const env = ctx.createGain()
  env.gain.setValueAtTime(0, t)
  env.gain.linearRampToValueAtTime(0.035, t + 4)
  env.gain.setValueAtTime(0.035, t + seconds - 5)
  env.gain.linearRampToValueAtTime(0, t + seconds)
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 900
  lp.Q.value = 0.3
  env.connect(lp)
  lp.connect(out)
  for (const f of [base, base * 1.5, base * 2]) {
    for (const cents of [-3, 3]) {
      const o = ctx.createOscillator()
      o.type = 'triangle'
      o.frequency.value = f
      o.detune.value = cents
      o.connect(env)
      o.start(t)
      o.stop(t + seconds + 0.1)
    }
  }
}

/** 一句旋律：級進為主、偶爾跳進，句尾回到宮音或徵音。 */
function playPhrase(
  ctx: BaseAudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  start: number,
  fromDegree: number,
  random: () => number,
): { end: number; lastDegree: number } {
  const count = 3 + Math.floor(random() * 4)
  let t = start
  let degree = fromDegree
  for (let i = 0; i < count; i++) {
    const last = i === count - 1
    if (last) {
      degree = random() < 0.6 ? 5 : 3
    } else {
      const leap = random() < 0.2 ? (random() < 0.5 ? -2 : 2) : random() < 0.5 ? -1 : 1
      degree = Math.min(8, Math.max(1, degree + leap))
    }
    const dur = last ? 3 + random() * 1.5 : 1.2 + random() * 1.6
    playFluteNote(ctx, out, noise, freqOf(degree, 2), t, dur)
    t += dur + 0.15 + random() * 0.35
  }
  return { end: t, lastDegree: degree }
}

function playFluteNote(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, freq: number, t: number, dur: number): void {
  const env = ctx.createGain()
  env.gain.setValueAtTime(0, t)
  env.gain.linearRampToValueAtTime(0.06, t + 0.35)
  env.gain.setValueAtTime(0.055, t + dur - 0.6)
  env.gain.linearRampToValueAtTime(0, t + dur)
  env.connect(out)

  // 正弦基音加少量三倍頻
  const o = ctx.createOscillator()
  o.frequency.value = freq
  const h = ctx.createOscillator()
  h.frequency.value = freq * 3
  const hGain = ctx.createGain()
  hGain.gain.value = 0.08
  o.connect(env)
  h.connect(hGain)
  hGain.connect(env)

  // 延遲出現的顫音
  const vib = ctx.createOscillator()
  vib.frequency.value = 4.8
  const vibDepth = ctx.createGain()
  vibDepth.gain.setValueAtTime(0, t)
  vibDepth.gain.linearRampToValueAtTime(freq * 0.006, t + Math.min(dur, 1.2))
  vib.connect(vibDepth)
  vibDepth.connect(o.frequency)
  vibDepth.connect(h.frequency)

  // 氣聲
  const breath = ctx.createBufferSource()
  breath.buffer = noise
  breath.loop = true
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = freq * 2
  bp.Q.value = 1.5
  const bGain = ctx.createGain()
  bGain.gain.value = 0.18
  breath.connect(bp)
  bp.connect(bGain)
  bGain.connect(env)

  for (const s of [o, h, vib, breath]) {
    s.start(t)
    s.stop(t + dur + 0.05)
  }
}

/**
 * 讓音檔頭尾無縫：把多算的尾段（tail）以等功率交叉淡化疊回開頭。
 * 輸入長度為 loop + tail，回傳長度為 loop 的聲道資料。
 */
export function makeSeamless(channels: Float32Array[], loopLength: number): Float32Array[] {
  return channels.map((src) => {
    const tail = src.length - loopLength
    const out = src.slice(0, loopLength)
    for (let i = 0; i < tail; i++) {
      const x = i / tail
      out[i] = src[i]! * Math.sin((x * Math.PI) / 2) + src[loopLength + i]! * Math.cos((x * Math.PI) / 2)
    }
    return out
  })
}
