import type { Rect } from './layout'
import type { MoveConfig } from './movement'

/**
 * 點擊移動的尋路：在場地上鋪 CELL 公尺的格子，以 A*（8 方向、不切角）找路，
 * 再用視線檢查把路徑拉直成少數轉折點。只在點擊時計算一次。
 * ponytail: 均勻格子，場地放大很多或障礙物變複雜時再改導航網格。
 */

const CELL = 0.5

export interface Point {
  x: number
  z: number
}

interface Grid {
  cols: number
  rows: number
  minX: number
  minZ: number
  blocked: Uint8Array
}

const gridCache = new WeakMap<ReadonlyArray<Rect>, Grid>()

const insideAny = (obstacles: ReadonlyArray<Rect>, x: number, z: number) =>
  obstacles.some((r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ)

function gridFor(cfg: MoveConfig): Grid {
  const cached = gridCache.get(cfg.obstacles)
  if (cached) return cached
  const b = cfg.bounds
  const cols = Math.floor((b.maxX - b.minX) / CELL) + 1
  const rows = Math.floor((b.maxZ - b.minZ) / CELL) + 1
  const blocked = new Uint8Array(cols * rows)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      blocked[r * cols + c] = insideAny(cfg.obstacles, b.minX + c * CELL, b.minZ + r * CELL) ? 1 : 0
    }
  }
  const grid = { cols, rows, minX: b.minX, minZ: b.minZ, blocked }
  gridCache.set(cfg.obstacles, grid)
  return grid
}

/** 線段是否不穿過任何障礙物（以 1/4 格取樣）。 */
export function lineClear(a: Point, b: Point, obstacles: ReadonlyArray<Rect>): boolean {
  const len = Math.hypot(b.x - a.x, b.z - a.z)
  const steps = Math.max(1, Math.ceil(len / (CELL / 4)))
  for (let i = 1; i < steps; i++) {
    const t = i / steps
    if (insideAny(obstacles, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false
  }
  return true
}

/**
 * 從 start 到 goal 的路徑（不含起點，最後一點為 goal）。
 * goal 應已用 resolveCollisions 推出障礙物。直線可達時只回傳 [goal]；找不到路時回傳 null。
 */
export function findPath(start: Point, goal: Point, cfg: MoveConfig): Point[] | null {
  if (lineClear(start, goal, cfg.obstacles)) return [goal]
  const g = gridFor(cfg)
  const toCell = (p: Point) => {
    const c = Math.min(g.cols - 1, Math.max(0, Math.round((p.x - g.minX) / CELL)))
    const r = Math.min(g.rows - 1, Math.max(0, Math.round((p.z - g.minZ) / CELL)))
    return r * g.cols + c
  }
  const center = (i: number): Point => ({ x: g.minX + (i % g.cols) * CELL, z: g.minZ + Math.floor(i / g.cols) * CELL })
  const s = toCell(start)
  const e = toCell(goal)
  // 起點、終點常貼在障礙物邊緣，視為可通行。
  const free = (i: number) => i === s || i === e || g.blocked[i] === 0

  const n = g.cols * g.rows
  const gScore = new Float32Array(n).fill(Infinity)
  const came = new Int32Array(n).fill(-1)
  const closed = new Uint8Array(n)
  const ec = e % g.cols
  const er = Math.floor(e / g.cols)
  const h = (i: number) => {
    const dx = Math.abs((i % g.cols) - ec)
    const dz = Math.abs(Math.floor(i / g.cols) - er)
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)
  }
  // ponytail: 開放清單用陣列線性找最小值，格子數約數千，點擊時才算一次；變慢再換二元堆積。
  const open: number[] = [s]
  gScore[s] = 0
  while (open.length) {
    let best = 0
    let bestF = Infinity
    for (let k = 0; k < open.length; k++) {
      const f = gScore[open[k]!]! + h(open[k]!)
      if (f < bestF) {
        bestF = f
        best = k
      }
    }
    const cur = open[best]!
    open[best] = open[open.length - 1]!
    open.pop()
    if (cur === e) break
    if (closed[cur]) continue
    closed[cur] = 1
    const cc = cur % g.cols
    const cr = Math.floor(cur / g.cols)
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue
        const nc = cc + dx
        const nr = cr + dz
        if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue
        const ni = nr * g.cols + nc
        if (closed[ni] || !free(ni)) continue
        // 不切角：斜走時兩個相鄰的直向格子都要可通行
        if (dx && dz && (!free(cr * g.cols + nc) || !free(nr * g.cols + cc))) continue
        const cost = gScore[cur]! + (dx && dz ? Math.SQRT2 : 1)
        if (cost < gScore[ni]!) {
          gScore[ni] = cost
          came[ni] = cur
          open.push(ni)
        }
      }
    }
  }
  if (came[e] === -1 && e !== s) return null

  // 格子路徑（終點 → 起點），起點與終點換成實際座標
  const cells: Point[] = []
  for (let i = e; i !== -1 && i !== s; i = came[i]!) cells.push(center(i))
  cells.reverse()
  cells[cells.length - 1] = goal

  // 拉直：每次跳到從目前位置可直線抵達的最遠點
  const out: Point[] = []
  let from = start
  let i = 0
  while (i < cells.length) {
    let j = cells.length - 1
    while (j > i && !lineClear(from, cells[j]!, cfg.obstacles)) j--
    out.push(cells[j]!)
    from = cells[j]!
    i = j + 1
  }
  return out
}
