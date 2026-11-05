import { describe, expect, it } from 'vitest'
import { resolveCollisions, stepMover, type MoveConfig, type MoverState } from './movement'

const cfg: MoveConfig = {
  speed: 2,
  bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
  obstacles: [{ minX: -1, maxX: 1, minZ: -1, maxZ: 1 }],
}
const mover = (x: number, z: number, target: MoverState['target'] = null): MoverState => ({ x, z, heading: 0, target })

describe('stepMover', () => {
  it('朝目標前進且不超過目標', () => {
    const s = mover(5, 5, { x: 5, z: 6 })
    expect(stepMover(s, { dirX: 0, dirZ: 0 }, 0.25, cfg)).toBe(true)
    expect(s.z).toBeCloseTo(5.5)
    stepMover(s, { dirX: 0, dirZ: 0 }, 10, cfg)
    expect(s.z).toBeCloseTo(6)
    expect(stepMover(s, { dirX: 0, dirZ: 0 }, 0.1, cfg)).toBe(false)
    expect(s.target).toBeNull()
  })

  it('鍵盤輸入取消點擊目標，斜向不會更快', () => {
    const s = mover(5, 5, { x: 0, z: 0 })
    stepMover(s, { dirX: 1, dirZ: 1 }, 0.5, cfg)
    expect(s.target).toBeNull()
    expect(Math.hypot(s.x - 5, s.z - 5)).toBeCloseTo(1)
  })

  it('受邊界限制，撞牆時放棄目標', () => {
    const s = mover(9.9, 0, { x: 20, z: 0 })
    stepMover(s, { dirX: 0, dirZ: 0 }, 1, cfg)
    expect(s.x).toBe(10)
    stepMover(s, { dirX: 0, dirZ: 0 }, 1, cfg)
    expect(s.target).toBeNull()
  })
})

describe('resolveCollisions', () => {
  it('把障礙物內的點推到最近邊緣', () => {
    expect(resolveCollisions(0.8, 0, cfg)).toEqual({ x: 1, z: 0 })
    expect(resolveCollisions(0, -0.9, cfg)).toEqual({ x: 0, z: -1 })
    expect(resolveCollisions(3, 3, cfg)).toEqual({ x: 3, z: 3 })
  })
})
