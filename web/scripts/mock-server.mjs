// 開發用 mock 遊戲伺服器：實作 src/game/net/protocol.ts 的協定草案，供 Rust 後端完成前測試前端。
// 不是正式伺服器，不做權限、持久化或容量設計。
//
// 用法：node scripts/mock-server.mjs [機器人數量=6] [埠=8080]
// 前端：在 web/.env.local 設定 VITE_WS_URL=ws://localhost:8080/ws
import { WebSocketServer } from 'ws'

const BOTS = Number(process.argv[2] ?? 6)
const PORT = Number(process.argv[3] ?? 8080)
const ACTIONS = ['bow', 'bowl', 'bell']
const NAMES = ['靜心', '晨鐘', '松風', '雲水', '明月', '竹影', '清泉', '山嵐']

const wss = new WebSocketServer({ port: PORT, path: '/ws', maxPayload: 16 * 1024 })
const players = new Map() // id -> { id, name, x, z, heading, ws?, bot? }
const seenReq = new Map() // reqId -> ack（模擬伺服器去重）
let nextId = 1

const now = () => Date.now()
const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg))
const broadcast = (msg, exceptId) => {
  for (const p of players.values()) if (p.ws && p.id !== exceptId) send(p.ws, msg)
}
const snapshot = (p) => ({ id: p.id, name: p.name, x: p.x, z: p.z, heading: p.heading })

// 機器人：在廣場上隨機走動，偶爾做動作。
for (let i = 0; i < BOTS; i++) {
  const id = `bot-${i}`
  players.set(id, {
    id,
    name: NAMES[i % NAMES.length] + (i >= NAMES.length ? i : ''),
    x: (Math.random() - 0.5) * 20,
    z: Math.random() * 12 - 2,
    heading: 0,
    bot: { tx: 0, tz: 0, wait: Math.random() * 3 },
  })
}

setInterval(() => {
  const dt = 0.1
  for (const p of players.values()) {
    if (!p.bot) continue
    const b = p.bot
    if (b.wait > 0) {
      b.wait -= dt
      if (b.wait <= 0) {
        b.tx = (Math.random() - 0.5) * 24
        b.tz = Math.random() * 14 - 3
      }
      continue
    }
    const dx = b.tx - p.x
    const dz = b.tz - p.z
    const d = Math.hypot(dx, dz)
    if (d < 0.2) {
      b.wait = 2 + Math.random() * 6
      broadcast({ t: 'move', id: p.id, x: p.x, z: p.z, heading: p.heading, moving: false })
      if (Math.random() < 0.6) {
        broadcast({ t: 'action', playerId: p.id, id: ACTIONS[Math.floor(Math.random() * ACTIONS.length)], startedAt: now() })
      }
      continue
    }
    const step = Math.min(d, 2.2 * dt)
    p.x += (dx / d) * step
    p.z += (dz / d) * step
    p.heading = Math.atan2(dx, dz)
    broadcast({ t: 'move', id: p.id, x: p.x, z: p.z, heading: p.heading, moving: true })
  }
}, 100)

wss.on('connection', (ws) => {
  let me = null

  ws.on('message', (raw) => {
    let m
    try {
      m = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (m.t === 'hello') {
      const id = `p-${nextId++}`
      me = { id, name: String(m.name || '訪客').slice(0, 16), x: (Math.random() - 0.5) * 4, z: 11, heading: Math.PI, ws }
      players.set(id, me)
      send(ws, {
        t: 'welcome',
        selfId: id,
        room: 'mock-1',
        resumeToken: id,
        serverTime: now(),
        players: [...players.values()].map(snapshot),
      })
      broadcast({ t: 'join', player: snapshot(me) }, id)
      return
    }
    if (!me) return
    switch (m.t) {
      case 'move':
      case 'stop':
        Object.assign(me, { x: m.x, z: m.z, heading: m.heading })
        broadcast({ t: 'move', id: me.id, x: m.x, z: m.z, heading: m.heading, moving: m.t === 'move' }, me.id)
        break
      case 'action': {
        const cached = seenReq.get(m.reqId)
        if (cached) return send(ws, cached)
        const ack = { t: 'ack', reqId: m.reqId, ok: ACTIONS.includes(m.id), reason: ACTIONS.includes(m.id) ? undefined : 'unknown_action' }
        seenReq.set(m.reqId, ack)
        send(ws, ack)
        if (ack.ok) broadcast({ t: 'action', playerId: me.id, id: m.id, startedAt: now() }, me.id)
        break
      }
      case 'ping':
        send(ws, { t: 'pong', ts: m.ts, serverTime: now() })
        break
    }
  })

  ws.on('close', () => {
    if (!me) return
    players.delete(me.id)
    broadcast({ t: 'leave', id: me.id })
  })
})

console.log(`mock server ws://localhost:${PORT}/ws，機器人 ${BOTS} 個`)
