import * as Y from 'yjs'
import {Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates} from 'y-protocols/awareness'
import {fromBase64, toBase64, type RoomState, type StreamEvent} from './protocol'

/**
 * A small Yjs provider for a serverless host (no WebSockets):
 *   - local updates are merged for `batchMs` and POSTed as one Yjs update
 *   - remote updates arrive over SSE and are applied with origin = this provider
 *   - every (re)connect does a state-vector resync, in both directions, so edits
 *     made offline (or kept in IndexedDB) are pushed and missed ones are pulled
 *   - failed pushes stay queued (merged) and retry with exponential backoff
 * The transport is injected so the whole thing runs in tests without a network.
 */
export interface CollabTransport {
  fetchState(): Promise<RoomState>
  pushUpdate(update: string): Promise<void>
  pushPresence(update: string | null): Promise<void>
  subscribe(onEvent: (event: StreamEvent) => void, onDisconnect: () => void): () => void
  /** Best-effort "I left", must work during page unload. */
  leave(): void
}

export type ProviderStatus = 'connecting' | 'synced' | 'saving' | 'offline'

type Options = {batchMs?: number; presenceMs?: number; ignoreOrigins?: unknown[]; maxBackoffMs?: number}

export class RoomProvider {
  status: ProviderStatus = 'connecting'
  /** True once the server state has been merged at least once. */
  synced = false
  lastError: string | null = null
  private queue: Uint8Array[] = []
  private inflight = false
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private presenceTimer: ReturnType<typeof setTimeout> | null = null
  private presenceInflight = false
  private presenceDirty = false
  private backoff = 0
  private connected = false
  private destroyed = false
  private unsubscribe: (() => void) | null = null
  private listeners = new Set<() => void>()
  private ignore: Set<unknown>
  private batchMs: number
  private presenceMs: number
  private maxBackoffMs: number

  constructor(public doc: Y.Doc, public awareness: Awareness, private transport: CollabTransport, opts: Options = {}) {
    this.batchMs = opts.batchMs ?? 300
    this.presenceMs = opts.presenceMs ?? 700
    this.maxBackoffMs = opts.maxBackoffMs ?? 15000
    this.ignore = new Set(opts.ignoreOrigins || [])
    doc.on('update', this.onDocUpdate)
    awareness.on('update', this.onAwarenessUpdate)
  }

  onChange(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  ignoreOrigin(origin: unknown) { this.ignore.add(origin) }

  start() {
    this.unsubscribe = this.transport.subscribe(this.onEvent, () => {
      this.connected = false
      this.setStatus('offline')
    })
  }

  /** Pull everything the server has, push everything it lacks. Safe to call any time. */
  async resync() {
    if (this.destroyed) return
    try {
      const state = await this.transport.fetchState()
      if (this.destroyed) return
      Y.applyUpdate(this.doc, fromBase64(state.state), this)
      for (const p of state.presence || []) this.applyPresence(p)
      const missing = Y.encodeStateAsUpdate(this.doc, fromBase64(state.vector))
      if (!isEmptyUpdate(missing)) this.queue.push(missing)
      this.synced = true
      this.connected = true
      this.lastError = null
      this.flush()
      this.schedulePresence(0)
      this.refreshStatus()
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Unavailable'
      this.setStatus('offline')
      this.scheduleRetry(() => this.resync())
    }
  }

  /** Push pending edits now (e.g. right before navigating away after a save). */
  async flushNow(timeoutMs = 4000) {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null }
    const deadline = Date.now() + timeoutMs
    while ((this.queue.length || this.inflight) && Date.now() < deadline) {
      if (!this.inflight) await this.flush()
      else await new Promise((r) => setTimeout(r, 40))
    }
    return this.queue.length === 0 && !this.inflight
  }

  get pending() { return this.queue.length > 0 || this.inflight }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    for (const t of [this.flushTimer, this.retryTimer, this.presenceTimer]) if (t) clearTimeout(t)
    this.doc.off('update', this.onDocUpdate)
    this.awareness.off('update', this.onAwarenessUpdate)
    this.unsubscribe?.()
    try { this.transport.leave() } catch {}
    this.listeners.clear()
  }

  // ------------------------------------------------------------------ internals
  private onEvent = (event: StreamEvent) => {
    if (this.destroyed) return
    if (event.type === 'ready') { void this.resync(); return }
    if (event.type === 'update') {
      if (event.client === this.doc.clientID) return // our own echo
      try { Y.applyUpdate(this.doc, fromBase64(event.update), this) } catch { void this.resync() }
      return
    }
    if (event.type === 'presence') {
      if (event.client === this.doc.clientID) return
      if (event.update === null) removeAwarenessStates(this.awareness, [event.client], this)
      else this.applyPresence(event.update)
    }
  }

  private applyPresence(update: string) {
    try { applyAwarenessUpdate(this.awareness, fromBase64(update), this) } catch { /* ignore a malformed peer */ }
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this || this.ignore.has(origin) || this.destroyed) return
    this.queue.push(update)
    this.refreshStatus()
    if (!this.flushTimer) this.flushTimer = setTimeout(() => { this.flushTimer = null; void this.flush() }, this.batchMs)
  }

  private async flush() {
    if (this.inflight || !this.queue.length || this.destroyed) return
    if (!this.synced) return // first resync will push everything via the state vector diff
    const merged = this.queue.length === 1 ? this.queue[0] : Y.mergeUpdates(this.queue)
    this.queue = []
    this.inflight = true
    this.refreshStatus()
    try {
      await this.transport.pushUpdate(toBase64(merged))
      this.backoff = 0
      this.inflight = false
      this.lastError = null
      if (this.queue.length) void this.flush()
      this.refreshStatus()
    } catch (error) {
      this.inflight = false
      this.queue.unshift(merged) // keep it; merged again on the next attempt
      this.lastError = error instanceof Error ? error.message : 'Unavailable'
      this.setStatus('offline')
      this.scheduleRetry(() => this.flush())
    }
  }

  private scheduleRetry(fn: () => unknown) {
    if (this.retryTimer || this.destroyed) return
    this.backoff = Math.min(this.maxBackoffMs, this.backoff ? this.backoff * 2 : 1000)
    this.retryTimer = setTimeout(() => { this.retryTimer = null; void fn() }, this.backoff)
  }

  private onAwarenessUpdate = ({added, updated, removed}: {added: number[]; updated: number[]; removed: number[]}, origin: unknown) => {
    if (origin === this) return
    const mine = this.doc.clientID
    if (![...added, ...updated, ...removed].includes(mine)) return
    this.presenceDirty = true
    this.schedulePresence(this.presenceMs)
  }

  private schedulePresence(delay: number) {
    if (this.presenceTimer || this.destroyed) return
    this.presenceTimer = setTimeout(() => { this.presenceTimer = null; void this.sendPresence() }, delay)
  }

  private async sendPresence() {
    if (!this.synced || this.presenceInflight || this.destroyed) return
    this.presenceDirty = false
    this.presenceInflight = true
    try {
      const local = this.awareness.getLocalState()
      await this.transport.pushPresence(local ? toBase64(encodeAwarenessUpdate(this.awareness, [this.doc.clientID])) : null)
    } catch { /* presence is best-effort */ }
    this.presenceInflight = false
    if (this.presenceDirty) this.schedulePresence(this.presenceMs)
  }

  private refreshStatus() {
    if (!this.synced) return this.setStatus(this.lastError ? 'offline' : 'connecting')
    if (this.lastError) return this.setStatus('offline')
    this.setStatus(this.queue.length || this.inflight ? 'saving' : 'synced')
  }

  private setStatus(status: ProviderStatus) {
    if (this.status === status) return
    this.status = status
    for (const fn of this.listeners) fn()
  }
}

/** An encoded update with no structs and no deletions. */
export function isEmptyUpdate(update: Uint8Array) {
  if (update.length <= 2) return true
  const meta = Y.parseUpdateMeta(update)
  return meta.from.size === 0 && Y.decodeUpdate(update).ds.clients.size === 0
}

// ------------------------------------------------------------------ HTTP + SSE transport
export function httpTransport(room: string, client: number): CollabTransport {
  const base = `/api/collab/${encodeURIComponent(room)}`
  const post = async (url: string, body: unknown, keepalive = false) => {
    const res = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), keepalive})
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || `Room write failed (${res.status})`)
    }
  }
  return {
    async fetchState() {
      const res = await fetch(base, {cache: 'no-store'})
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.state) throw Object.assign(new Error(data?.error || 'Room unavailable'), {status: res.status})
      return data as RoomState
    },
    pushUpdate: (update) => post(base, {update, client}, update.length < 48_000),
    pushPresence: (update) => post(`${base}/presence`, {client, update}),
    subscribe(onEvent, onDisconnect) {
      const es = new EventSource(`${base}/stream`)
      const handle = (e: MessageEvent) => { try { onEvent(JSON.parse(e.data)) } catch {} }
      for (const type of ['ready', 'update', 'presence']) es.addEventListener(type, handle as EventListener)
      es.onerror = () => onDisconnect() // EventSource reconnects by itself; the next `ready` resyncs
      return () => es.close()
    },
    leave() {
      const body = JSON.stringify({client, update: null})
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) navigator.sendBeacon(`${base}/presence`, new Blob([body], {type: 'text/plain'}))
      else void fetch(`${base}/presence`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body, keepalive: true}).catch(() => null)
    },
  }
}
