import { describe, expect, it } from 'vitest'
import { synthesizeBirdCall } from './AudioManager'

// 只實作 synthesizeBirdCall 用到的 createBuffer，node 環境沒有 Web Audio。
const fakeCtx = (sampleRate = 8000) =>
  ({
    sampleRate,
    createBuffer: (_ch: number, length: number) => {
      const data = new Float32Array(length)
      return { length, getChannelData: () => data }
    },
  }) as unknown as BaseAudioContext

const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646

describe('synthesizeBirdCall', () => {
  it('產生短促、已正規化且可重現的鳥叫', () => {
    const a = synthesizeBirdCall(fakeCtx(), seeded(42))
    const b = synthesizeBirdCall(fakeCtx(), seeded(42))
    const data = a.getChannelData(0)
    const peak = data.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    expect(peak).toBeCloseTo(0.7, 5)
    expect(a.length / 8000).toBeLessThan(1.5)
    expect(a.length / 8000).toBeGreaterThan(0.1)
    expect(b.getChannelData(0)).toEqual(data)
  })
})

describe('freqOf', () => {
  it('對應 A 宮五聲音階並正確跨八度', async () => {
    const { freqOf } = await import('./ChantMusic')
    expect(freqOf(0, 0)).toBeCloseTo(110)
    expect(freqOf(3, 0)).toBeCloseTo(110 * 2 ** (7 / 12)) // 徵音 E
    expect(freqOf(5, 0)).toBeCloseTo(220) // 下一個八度的宮音
    expect(freqOf(-1, 0)).toBeCloseTo(55 * 2 ** (9 / 12)) // 低八度的羽音 F#
  })
})
