'use client'

import {useEffect, useMemo, useRef, useState} from 'react'
import * as Y from 'yjs'
import {FIELD_LABEL, LOCAL_ORIGIN, findNote, getSettingsBy, readNotes, type NoteReply, type NoteView} from '@/lib/collab/schema'
import type {CollabRoom, PeerState} from './useCollabRoom'
import {useYVersion} from './useCollabRoom'

const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()

export function useNow(active: boolean, every = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(id)
  }, [active, every])
  return now
}

export function timeAgo(at: number, now: number) {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

// ------------------------------------------------------------------ presence bar
const STATUS: Record<string, {label: string; tone: string}> = {
  connecting: {label: 'JOINING ROOM', tone: 'wait'},
  synced: {label: 'LIVE · SYNCED', tone: 'ok'},
  saving: {label: 'SYNCING', tone: 'busy'},
  offline: {label: 'OFFLINE · KEPT ON THIS DEVICE', tone: 'off'},
}

export function PresenceBar({room, revisionLabel}: {room: CollabRoom; revisionLabel: string}) {
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const status = STATUS[room.status] || STATUS.connecting
  const writers = room.peers.length + 1
  const invite = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1800) }
    catch { window.prompt('Copy this link to invite a co-writer:', window.location.href) }
  }
  return (
    <div className="room-bar">
      <span className={`room-status tone-${status.tone}`} title={room.provider?.lastError || undefined}><i />{status.label}<em>{revisionLabel}</em></span>
      <div className="room-people" aria-label={`${writers} ${writers === 1 ? 'writer' : 'writers'} in this room`}>
        {room.peers.slice(0, 5).map((p) => (
          <span key={p.clientId} className="room-avatar" style={{['--c' as any]: p.user.color}} title={`${p.user.name}${p.cursor ? ` · in ${FIELD_LABEL[p.cursor.field]}` : ''}`}>
            {initials(p.user.name)}{p.cursor && <i className="room-avatar-dot" />}
          </span>
        ))}
        {room.peers.length > 5 && <span className="room-avatar room-avatar-more">+{room.peers.length - 5}</span>}
        {editing ? (
          <form className="room-rename" onSubmit={(e) => { e.preventDefault(); room.rename(new FormData(e.currentTarget).get('name') as string); setEditing(false) }}>
            <input name="name" defaultValue={room.me.name} maxLength={32} autoFocus aria-label="Your display name" onBlur={(e) => { room.rename(e.currentTarget.value); setEditing(false) }} />
          </form>
        ) : (
          <button type="button" className="room-avatar room-me" style={{['--c' as any]: room.me.color}} onClick={() => setEditing(true)} title={`You are “${room.me.name}”. Click to rename.`}>
            {initials(room.me.name)}
          </button>
        )}
      </div>
      <button type="button" className="room-invite" onClick={invite}>{copied ? '✓ Link copied' : '+ Invite co-writer'}</button>
    </div>
  )
}

/** "Lan is editing Post copy · Minh is typing…" */
export function WhoIsWhere({peers, now}: {peers: PeerState[]; now: number}) {
  if (!peers.length) return <p className="room-where">Only you here. Share the link and edit together in real time — every keystroke syncs.</p>
  return (
    <p className="room-where">
      {peers.map((p, i) => (
        <span key={p.clientId}>
          {i > 0 && ' · '}
          <b style={{color: p.user.color}}>{p.user.name}</b>{' '}
          {(p.typingUntil || 0) > now ? <>is typing in {FIELD_LABEL[p.cursor?.field || 'body']}<span className="typing-dots"><i /><i /><i /></span></> : p.cursor ? `is in ${FIELD_LABEL[p.cursor.field]}` : 'is reading'}
        </span>
      ))}
    </p>
  )
}

// ------------------------------------------------------------------ activity toasts
type Toast = {id: number; color: string; text: string}
const SETTING_LABEL: Record<string, string> = {platform: 'platform', audienceId: 'test audience', brandId: 'speaker'}

export function ActivityToasts({room, describe}: {room: CollabRoom; describe: (key: string, value: string) => string}) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)
  const describeRef = useRef(describe)
  describeRef.current = describe
  useEffect(() => {
    const push = (color: string, text: string) => {
      const id = ++seq.current
      setToasts((t) => [...t.slice(-2), {id, color, text}])
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500)
    }
    const onSettings = (event: Y.YMapEvent<string>, tr: Y.Transaction) => {
      if (tr.local) return
      for (const key of event.keysChanged) {
        const by = getSettingsBy(room.doc).get(key)
        if (by) push(by.color, `${by.name} set ${SETTING_LABEL[key] || key} to ${describeRef.current(key, room.settings.get(key) || '')}`)
      }
    }
    const names = new Map<number, {name: string; color: string}>()
    const onAwareness = ({added, removed}: {added: number[]; removed: number[]}) => {
      for (const id of added) {
        const u = room.awareness.getStates().get(id)?.user
        if (u && id !== room.doc.clientID) { names.set(id, u); push(u.color, `${u.name} joined the room`) }
      }
      for (const id of removed) { const u = names.get(id); if (u) push(u.color, `${u.name} left`) }
    }
    const onNotes = (event: Y.YArrayEvent<Y.Map<any>>, tr: Y.Transaction) => {
      if (tr.local) return
      for (const item of event.changes.added) {
        const note = (item.content as any).getContent?.()[0] as Y.Map<any> | undefined
        if (note?.get) push(note.get('color'), `${note.get('author')} left a note: “${String(note.get('text')).slice(0, 48)}”`)
      }
    }
    room.settings.observe(onSettings)
    room.awareness.on('change', onAwareness)
    room.notes.observe(onNotes)
    return () => { room.settings.unobserve(onSettings); room.awareness.off('change', onAwareness); room.notes.unobserve(onNotes) }
  }, [room.doc, room.settings, room.awareness, room.notes])
  return (
    <div className="room-toasts" role="status" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className="room-toast" style={{['--c' as any]: t.color}}>{t.text}</div>)}
    </div>
  )
}

// ------------------------------------------------------------------ margin notes
export function useNotes(room: CollabRoom) {
  const v1 = useYVersion(room.notes, true)
  const v2 = useYVersion(room.texts.body)
  return useMemo(() => readNotes(room.doc), [room.doc, v1, v2]) // eslint-disable-line react-hooks/exhaustive-deps
}

export function NotesPanel({room, notes, disabled, focusId, onFocusNote, onJump}: {
  room: CollabRoom; notes: NoteView[]; disabled: boolean
  focusId: string | null; onFocusNote: (id: string | null) => void; onJump: (note: NoteView) => void
}) {
  const [showResolved, setShowResolved] = useState(false)
  const now = useNow(true, 30_000)
  const open = notes.filter((n) => !n.resolved)
  const list = showResolved ? notes : open
  const mutate = (id: string, fn: (note: Y.Map<any>) => void) => {
    const note = findNote(room.doc, id)
    if (note) room.doc.transact(() => fn(note), LOCAL_ORIGIN)
  }
  const remove = (id: string) => {
    const index = room.notes.toArray().findIndex((n) => n.get('id') === id)
    if (index >= 0) room.doc.transact(() => room.notes.delete(index, 1), LOCAL_ORIGIN)
  }
  return (
    <section className="notes-panel" aria-labelledby="notes-title">
      <div className="notes-head">
        <h3 id="notes-title">Margin notes <span>{open.length} open</span></h3>
        {notes.length > open.length && <button type="button" onClick={() => setShowResolved(!showResolved)}>{showResolved ? 'Hide resolved' : `Show resolved (${notes.length - open.length})`}</button>}
      </div>
      {!list.length && <p className="notes-empty">Select words in the post copy and add a note. Notes stay pinned to those words while anyone edits around them.</p>}
      <ol className="notes-list">
        {list.map((n) => (
          <li key={n.id} className={`note-card ${n.resolved ? 'is-resolved' : ''} ${focusId === n.id ? 'is-focus' : ''}`} style={{['--c' as any]: n.color}}
            onMouseEnter={() => onFocusNote(n.id)} onMouseLeave={() => onFocusNote(null)}>
            <header>
              <b>{n.kind === 'analyst' ? '🤖 ' : ''}{n.author}</b>
              <span>{timeAgo(n.createdAt, now)}</span>
            </header>
            {n.range
              ? <button type="button" className="note-quote" onClick={() => onJump(n)} title="Select these words in the editor">“{n.current}”</button>
              : <p className="note-quote is-gone"><s>“{n.quote}”</s> <em>words removed</em></p>}
            {n.range && n.current !== n.quote && <p className="note-was">was “{n.quote}”</p>}
            <p className="note-text">{n.text}</p>
            {n.replies.map((r, i) => <p key={i} className="note-reply"><b style={{color: r.color}}>{r.name}</b> {r.text}</p>)}
            {!disabled && (
              <div className="note-actions">
                <form onSubmit={(e) => {
                  e.preventDefault()
                  const input = e.currentTarget.elements.namedItem('reply') as HTMLInputElement
                  const text = input.value.trim().slice(0, 400)
                  if (!text) return
                  mutate(n.id, (note) => (note.get('replies') as Y.Array<NoteReply>)?.push([{...room.me, text, at: Date.now()}]))
                  input.value = ''
                }}>
                  <input name="reply" placeholder="Reply…" maxLength={400} aria-label={`Reply to ${n.author}`} autoComplete="off" />
                </form>
                <button type="button" onClick={() => mutate(n.id, (note) => note.set('resolved', !n.resolved))}>{n.resolved ? 'Reopen' : '✓ Resolve'}</button>
                {n.author === room.me.name && n.kind === 'human' && <button type="button" className="note-delete" onClick={() => remove(n.id)} aria-label="Delete note">✕</button>}
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Post copy with open notes highlighted, for the feed preview. */
export function HighlightedCopy({body, notes, focusId, onFocusNote}: {body: string; notes: NoteView[]; focusId: string | null; onFocusNote: (id: string | null) => void}) {
  const ranges = notes.filter((n) => !n.resolved && n.range)
  if (!ranges.length) return <>{body}</>
  const cuts = new Set<number>([0, body.length])
  for (const n of ranges) { cuts.add(n.range!.start); cuts.add(n.range!.end) }
  const points = [...cuts].sort((a, b) => a - b)
  const out: React.ReactNode[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const [from, to] = [points[i], points[i + 1]]
    const text = body.slice(from, to)
    const covering = ranges.filter((n) => n.range!.start <= from && n.range!.end >= to)
    if (!covering.length) { out.push(text); continue }
    const top = covering.find((n) => n.id === focusId) || covering[covering.length - 1]
    out.push(
      <mark key={from} className={`note-mark ${covering.some((n) => n.id === focusId) ? 'is-focus' : ''}`} style={{['--c' as any]: top.color}}
        title={covering.map((n) => `${n.author}: ${n.text}`).join('\n')} onMouseEnter={() => onFocusNote(top.id)} onMouseLeave={() => onFocusNote(null)}>
        {text}
      </mark>,
    )
  }
  return <>{out}</>
}
