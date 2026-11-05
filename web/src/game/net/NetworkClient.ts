import { Emitter } from '../core/Emitter'
import { backoffDelay } from './backoff'
import { OutboundQueue } from './OutboundQueue'
import {
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  decode,
  encode,
  type ClientMessage,
  type ServerMessage,
} from './protocol'

export type ConnectionStatus = 'offline' | 'connecting' | 'online' | 'reconnecting' | 'closed'

interface NetworkEvents extends Record<string, unknown> {
  status: ConnectionStatus
  message: ServerMessage
  rtt: number
}

export interface NetworkOptions {
  url: string | undefined
  name: string
  /** 位置訊息送出頻率，與渲染頻率分開。 */
  sendHz?: number
  heartbeatMs?: number
  ackTimeoutMs?: number
  /** WebSocket 尚未送出的資料超過此值時暫緩送出，避免弱網路下越積越多。 */
  maxBufferedBytes?: number
}

interface PendingAck {
  msg: Extract<ClientMessage, { t: 'action' }>
  resolve: (ok: boolean, reason?: string) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * WebSocket 連線管理：重連、心跳、送出節流、需確認操作的重送。
 * 未設定 url 時維持 offline，遊戲以單機模式運作。
 */
export class NetworkClient {
  readonly events = new Emitter<NetworkEvents>()
  private ws: WebSocket | null = null
  private status: ConnectionStatus = 'offline'
  private queue = new OutboundQueue()
  private pending = new Map<string, PendingAck>()
  private attempt = 0
  private seq = 0
  private reqCounter = 0
  private resumeToken: string | undefined
  private background = false
  private disposed = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private readonly opts: Required<Omit<NetworkOptions, 'url'>> & { url: string | undefined }

  constructor(options: NetworkOptions) {
    this.opts = {
      sendHz: 10,
      heartbeatMs: 20_000,
      ackTimeoutMs: 10_000,
      maxBufferedBytes: 64 * 1024,
      ...options,
    }
    window.addEventListener('online', this.onBrowserOnline)
  }

  get connectionStatus(): ConnectionStatus {
    return this.status
  }

  get enabled(): boolean {
    return !!this.opts.url
  }

  /** 設定顯示名稱，於下次 hello 生效。 */
  setName(name: string): void {
    this.opts.name = name
  }

  connect(): void {
    if (!this.opts.url || this.disposed || this.ws) return
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting')
    let ws: WebSocket
    try {
      ws = new WebSocket(this.opts.url)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = ws
    ws.onopen = () => {
      this.attempt = 0
      this.sendNow({ t: 'hello', v: PROTOCOL_VERSION, name: this.opts.name, resumeToken: this.resumeToken })
      // 重送尚未確認的操作；伺服器以 reqId 去重。
      for (const p of this.pending.values()) this.sendNow(p.msg)
      this.setStatus('online')
      this.startTimers()
    }
    ws.onmessage = (ev) => this.onMessage(ev.data)
    ws.onclose = () => this.onSocketClosed()
    // onerror 之後一定會有 onclose，統一在 onclose 處理。
    ws.onerror = () => {}
  }

  /** 位置更新（可取代）。只放進佇列，由定時器以 sendHz 送出。 */
  sendPosition(x: number, z: number, heading: number, moving: boolean): void {
    if (!this.enabled || this.background) return
    this.queue.push({ t: moving ? 'move' : 'stop', x, z, heading, seq: ++this.seq })
  }

  /**
   * 需確認的操作。回傳 Promise，伺服器 ack 後 resolve；離線模式直接視為成功。
   */
  sendAction(id: string, data?: Record<string, unknown>): Promise<{ ok: boolean; reason?: string }> {
    if (!this.enabled) return Promise.resolve({ ok: true })
    const reqId = `${Date.now().toString(36)}-${(++this.reqCounter).toString(36)}`
    const msg: PendingAck['msg'] = { t: 'action', reqId, id, data }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId)
        resolve({ ok: false, reason: 'timeout' })
      }, this.opts.ackTimeoutMs)
      this.pending.set(reqId, { msg, timer, resolve: (ok, reason) => resolve({ ok, reason }) })
      if (this.status === 'online') this.sendNow(msg)
    })
  }

  /** 進入背景：停止送位置、清掉過期位置；連線保留以免回前景時重新加入。 */
  setBackground(background: boolean): void {
    this.background = background
    if (background) {
      this.queue.clear()
    } else if (this.enabled && !this.ws && !this.disposed) {
      // 回前景時若已斷線，不等退避計時直接重連。
      this.clearReconnectTimer()
      this.connect()
    }
  }

  dispose(): void {
    this.disposed = true
    window.removeEventListener('online', this.onBrowserOnline)
    this.clearReconnectTimer()
    this.stopTimers()
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.resolve(false, 'disposed')
    }
    this.pending.clear()
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close(1000)
      this.ws = null
    }
    this.setStatus('closed')
    this.events.clear()
  }

  private onBrowserOnline = (): void => {
    if (this.enabled && !this.ws && !this.disposed) {
      this.clearReconnectTimer()
      this.connect()
    }
  }

  private onMessage(data: unknown): void {
    const msg = decode(data)
    if (!msg) return
    switch (msg.t) {
      case 'welcome':
        this.resumeToken = msg.resumeToken
        break
      case 'ack': {
        const p = this.pending.get(msg.reqId)
        if (p) {
          clearTimeout(p.timer)
          this.pending.delete(msg.reqId)
          p.resolve(msg.ok, msg.reason)
        }
        break
      }
      case 'pong':
        this.events.emit('rtt', Math.max(0, performance.now() - msg.ts))
        break
    }
    this.events.emit('message', msg)
  }

  private onSocketClosed(): void {
    this.ws = null
    this.stopTimers()
    if (this.disposed) return
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    this.setStatus('reconnecting')
    const delay = backoffDelay(this.attempt++)
    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private sendNow(msg: ClientMessage): boolean {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    const text = encode(msg)
    if (text.length > MAX_MESSAGE_BYTES) return false
    ws.send(text)
    return true
  }

  private flush = (): void => {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN || this.queue.size === 0) return
    // 慢速網路：暫緩送出，讓佇列合併位置，而不是在瀏覽器緩衝區堆積。
    if (ws.bufferedAmount > this.opts.maxBufferedBytes) return
    for (const msg of this.queue.drain()) this.sendNow(msg)
  }

  private startTimers(): void {
    this.stopTimers()
    this.flushTimer = setInterval(this.flush, 1000 / this.opts.sendHz)
    this.heartbeatTimer = setInterval(
      () => this.sendNow({ t: 'ping', ts: performance.now() }),
      this.opts.heartbeatMs,
    )
  }

  private stopTimers(): void {
    if (this.flushTimer) clearInterval(this.flushTimer)
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.flushTimer = this.heartbeatTimer = null
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return
    this.status = status
    this.events.emit('status', status)
  }
}
