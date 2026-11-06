/**
 * 離線產生環境音樂檔（佛樂＋風聲），輸出可無縫循環的 MP3，再上傳到 R2。
 *
 * 用法：npm run render:ambient -- [seed=7] [秒數=180]
 * 輸出：public/audio/temple-ambient.mp3（已加入 .gitignore；正式環境由 VITE_AMBIENT_URL 指向 R2）
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Mp3Encoder } from '@breezystack/lamejs'
import { OfflineAudioContext } from 'node-web-audio-api'
import { makeSeamless, scheduleAmbient, seededRandom } from './score.ts'

const seed = Number(process.argv[2] ?? 7)
const loopSeconds = Number(process.argv[3] ?? 180)
const TAIL_SECONDS = 8
const SAMPLE_RATE = 44_100
const KBPS = 112
const TARGET_PEAK = 0.8

const here = dirname(fileURLToPath(import.meta.url))
const outFile = resolve(here, '../../public/audio/temple-ambient.mp3')

const totalFrames = (loopSeconds + TAIL_SECONDS) * SAMPLE_RATE
const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: totalFrames, sampleRate: SAMPLE_RATE })
const master = ctx.createGain()
master.connect(ctx.destination)
scheduleAmbient(ctx as unknown as BaseAudioContext, master as unknown as AudioNode, loopSeconds + TAIL_SECONDS, seededRandom(seed))

const started = performance.now()
const rendered = await ctx.startRendering()
const channels = makeSeamless([rendered.getChannelData(0), rendered.getChannelData(1)], loopSeconds * SAMPLE_RATE)

let peak = 0
for (const ch of channels) for (const v of ch) peak = Math.max(peak, Math.abs(v))
const gain = peak > 0 ? TARGET_PEAK / peak : 1

const toInt16 = (ch: Float32Array) => {
  const out = new Int16Array(ch.length)
  for (let i = 0; i < ch.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(ch[i]! * gain * 32767)))
  return out
}
const [left, right] = channels.map(toInt16) as [Int16Array, Int16Array]

const encoder = new Mp3Encoder(2, SAMPLE_RATE, KBPS)
const chunks: Uint8Array[] = []
const BLOCK = 1152 * 20
for (let i = 0; i < left.length; i += BLOCK) {
  chunks.push(new Uint8Array(encoder.encodeBuffer(left.subarray(i, i + BLOCK), right.subarray(i, i + BLOCK))))
}
chunks.push(new Uint8Array(encoder.flush()))

mkdirSync(dirname(outFile), { recursive: true })
const bytes = Buffer.concat(chunks)
writeFileSync(outFile, bytes)
console.log(
  `已輸出 ${outFile}\n長度 ${loopSeconds} 秒，${(bytes.length / 1024 / 1024).toFixed(2)} MB，` +
    `原始峰值 ${peak.toFixed(3)}，正規化增益 ${gain.toFixed(2)}，耗時 ${((performance.now() - started) / 1000).toFixed(1)} 秒`,
)
