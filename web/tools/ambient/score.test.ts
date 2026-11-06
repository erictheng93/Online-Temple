import { describe, expect, it } from 'vitest'
import { freqOf, makeSeamless } from './score.ts'

describe('freqOf', () => {
  it('對應 A 宮五聲音階並正確跨八度', () => {
    expect(freqOf(0, 0)).toBeCloseTo(110)
    expect(freqOf(3, 0)).toBeCloseTo(110 * 2 ** (7 / 12)) // 徵音 E
    expect(freqOf(5, 0)).toBeCloseTo(220) // 高八度的宮音
    expect(freqOf(-1, 0)).toBeCloseTo(55 * 2 ** (9 / 12)) // 低八度的羽音 F#
  })
})

describe('makeSeamless', () => {
  it('開頭銜接尾段、交叉淡化結束後回到原訊號', () => {
    // 前 10 個樣本為 0，尾段（索引 10..13）為 1
    const src = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1])
    const [out] = makeSeamless([src], 10)
    expect(out!.length).toBe(10)
    expect(out![0]).toBeCloseTo(1) // 循環點：接續尾段
    expect(out![4]).toBeCloseTo(0) // 交叉淡化結束
  })
})
