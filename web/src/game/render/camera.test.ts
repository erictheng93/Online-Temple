import { describe, expect, it } from 'vitest'
import { clampCamera } from './SceneRenderer'

const b = { minX: -5, maxX: 5, minZ: -5, maxZ: 5, maxY: 4 }
const f = { x: 0, y: 1, z: 0 }

describe('clampCamera', () => {
  it('理想位置在範圍內時不變', () => {
    expect(clampCamera(f, { x: 2, y: 3, z: 2 }, b)).toEqual({ x: 2, y: 3, z: 2 })
  })
  it('超出牆面時水平拉近、高度保持', () => {
    expect(clampCamera(f, { x: 0, y: 3, z: 10 }, b)).toEqual({ x: 0, y: 3, z: 5 })
    expect(clampCamera({ x: 4, y: 1, z: 0 }, { x: 8, y: 2, z: 0 }, b)).toEqual({ x: 5, y: 2, z: 0 })
  })
  it('高度只受天花板限制', () => {
    expect(clampCamera(f, { x: 0, y: 7, z: 0 }, b)).toEqual({ x: 0, y: 4, z: 0 })
  })
})
