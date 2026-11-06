import { describe, expect, it } from 'vitest'
import type { MoveConfig } from './movement'
import { findPath, lineClear, type Point } from './pathfind'
import { ZONES } from './zones'

const cfgFor = (id: keyof typeof ZONES): MoveConfig => ({ speed: 3.2, bounds: ZONES[id].bounds, obstacles: ZONES[id].obstacles })

/** 路徑每一段都不穿過障礙物，且最後一點是目標。 */
function expectValid(start: Point, goal: Point, path: Point[] | null, cfg: MoveConfig) {
  expect(path).not.toBeNull()
  let from = start
  for (const p of path!) {
    expect(lineClear(from, p, cfg.obstacles)).toBe(true)
    from = p
  }
  expect(path!.at(-1)).toEqual(goal)
}

describe('findPath', () => {
  it('直線可達時直接回傳目標', () => {
    const cfg = cfgFor('courtyard')
    expect(findPath({ x: 0, z: 11 }, { x: 5, z: 11 }, cfg)).toEqual([{ x: 5, z: 11 }])
  })

  it('庭院：從出生點繞過香爐走到殿門前', () => {
    const cfg = cfgFor('courtyard')
    const start = { x: 0, z: 11 }
    const goal = { x: 0, z: -5.85 }
    expect(lineClear(start, goal, cfg.obstacles)).toBe(false) // 香爐擋在中軸線上
    const path = findPath(start, goal, cfg)
    expectValid(start, goal, path, cfg)
    expect(path!.length).toBeLessThanOrEqual(4) // 拉直後只剩少數轉折點
  })

  it('殿內：繞過柱子', () => {
    const cfg = cfgFor('hall')
    const start = { x: 5.2, z: 0 }
    const goal = { x: 5.2, z: -4.5 }
    expect(lineClear(start, goal, cfg.obstacles)).toBe(false)
    expectValid(start, goal, findPath(start, goal, cfg), cfg)
  })

  it('目標被完全圍住時回傳 null', () => {
    const cfg: MoveConfig = {
      speed: 1,
      bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
      obstacles: [
        { minX: -3, maxX: 3, minZ: 2, maxZ: 3 },
        { minX: -3, maxX: 3, minZ: -3, maxZ: -2 },
        { minX: -3, maxX: -2, minZ: -3, maxZ: 3 },
        { minX: 2, maxX: 3, minZ: -3, maxZ: 3 },
      ],
    }
    expect(findPath({ x: 8, z: 8 }, { x: 0, z: 0 }, cfg)).toBeNull()
  })
})
