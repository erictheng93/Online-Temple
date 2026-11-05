import { describe, expect, it } from 'vitest'
import { backoffDelay } from './backoff'
import { OutboundQueue } from './OutboundQueue'
import { MAX_MESSAGE_BYTES, decode } from './protocol'

describe('decode', () => {
  it('接受合法訊息', () => {
    const m = decode(JSON.stringify({ t: 'move', id: 'a', x: 1, z: 2, heading: 0, moving: true }))
    expect(m).toEqual({ t: 'move', id: 'a', x: 1, z: 2, heading: 0, moving: true })
  })

  it('拒絕格式錯誤、未知類型、非有限數值與過大訊息', () => {
    expect(decode('not json')).toBeNull()
    expect(decode(JSON.stringify({ t: 'nope' }))).toBeNull()
    expect(decode(JSON.stringify({ t: 'move', id: 'a', x: 'x', z: 0, heading: 0, moving: true }))).toBeNull()
    expect(decode('{"t":"pong","ts":1e999,"serverTime":0}')).toBeNull()
    expect(decode(JSON.stringify({ t: 'error', code: 'x', message: 'y'.repeat(MAX_MESSAGE_BYTES) }))).toBeNull()
    expect(decode(new ArrayBuffer(4))).toBeNull()
  })

  it('welcome 內任一玩家不合法就整則拒絕', () => {
    const ok = { id: 'a', name: 'n', x: 0, z: 0, heading: 0 }
    const base = { t: 'welcome', selfId: 'a', room: 'r', resumeToken: 't', serverTime: 0 }
    expect(decode(JSON.stringify({ ...base, players: [ok] }))).not.toBeNull()
    expect(decode(JSON.stringify({ ...base, players: [ok, { ...ok, x: null }] }))).toBeNull()
  })
})

describe('backoffDelay', () => {
  it('隨次數成長並受上限限制', () => {
    const max = () => 0.999999
    expect(backoffDelay(0, 500, 30_000, max)).toBe(499)
    expect(backoffDelay(3, 500, 30_000, max)).toBe(3999)
    expect(backoffDelay(20, 500, 30_000, max)).toBe(29_999)
    expect(backoffDelay(5, 500, 30_000, () => 0)).toBe(0)
  })
})

describe('OutboundQueue', () => {
  it('位置只保留最新一筆，其他訊息依序保留', () => {
    const q = new OutboundQueue()
    q.push({ t: 'move', x: 1, z: 0, heading: 0, seq: 1 })
    q.push({ t: 'action', reqId: 'r1', id: 'bow' })
    q.push({ t: 'move', x: 2, z: 0, heading: 0, seq: 2 })
    q.push({ t: 'stop', x: 3, z: 0, heading: 0, seq: 3 })
    expect(q.drain()).toEqual([
      { t: 'action', reqId: 'r1', id: 'bow' },
      { t: 'stop', x: 3, z: 0, heading: 0, seq: 3 },
    ])
    expect(q.size).toBe(0)
  })

  it('超過上限丟棄最舊的', () => {
    const q = new OutboundQueue(2)
    for (let i = 0; i < 5; i++) q.push({ t: 'ping', ts: i })
    expect(q.drain()).toEqual([{ t: 'ping', ts: 3 }, { t: 'ping', ts: 4 }])
  })
})
