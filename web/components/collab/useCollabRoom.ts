'use client'

import {useCallback, useEffect, useMemo, useState, useSyncExternalStore} from 'react'
import * as Y from 'yjs'
import {Awareness} from 'y-protocols/awareness'
import {IndexeddbPersistence} from 'y-indexeddb'
import {RoomProvider, httpTransport, type ProviderStatus} from '@/lib/collab/provider'
import {
  LOCAL_ORIGIN, TEXT_FIELDS, getMeta, getNotes, getSettings, getSettingsBy, getText,
  type Author, type SettingKey, type TextField,
} from '@/lib/collab/schema'

export type CursorState = {field: TextField; anchor: unknown; head: unknown} | null
export type PeerState = {clientId: number; user: Author; cursor: CursorState; typingUntil?: number}

const COLORS = ['#ff7ab6', '#7cc4ff', '#ffb35c', '#b69bff', '#5ee6c9', '#ff8a7a', '#ffd84d', '#9be15d']
const ADJ = ['Swift', 'Quiet', 'Bold', 'Witty', 'Calm', 'Bright', 'Keen', 'Sunny']
const ANIMALS = ['Otter', 'Heron', 'Lynx', 'Panda', 'Gecko', 'Koi', 'Fox', 'Wren']
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)]
const IDENTITY_KEY = 'magentic:writer'

export function loadIdentity(): Author {
  try {
    const saved = JSON.parse(localStorage.getItem(IDENTITY_KEY) || 'null')
    if (saved?.name && saved?.color) return saved
  } catch {}
  const me = {name: `${pick(ADJ)} ${pick(ANIMALS)}`, color: pick(COLORS)}
  try { localStorage.setItem(IDENTITY_KEY, JSON.stringify(me)) } catch {}
  return me
}

/** Re-render whenever a Yjs type (deeply) changes. Returns a version counter. */
export function useYVersion(type: Y.AbstractType<any> | null, deep = false) {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (!type) return
    const bump = () => setVersion((v) => v + 1)
    if (deep) type.observeDeep(bump); else type.observe(bump)
    return () => { if (deep) type.unobserveDeep(bump); else type.unobserve(bump) }
  }, [type, deep])
  return version
}

export function useYText(text: Y.Text) {
  return useSyncExternalStore(
    useCallback((cb) => { text.observe(cb); return () => text.unobserve(cb) }, [text]),
    () => text.toString(),
    () => text.toString(),
  )
}

/**
 * One shared draft per room: Y.Doc + awareness + IndexedDB cache + network provider.
 * Mount the composer with `key={room}` so a room change builds a fresh doc.
 */
export function useCollabRoom(room: string) {
  const [{doc, awareness}] = useState(() => {
    const doc = new Y.Doc()
    return {doc, awareness: new Awareness(doc)}
  })
  const [provider, setProvider] = useState<RoomProvider | null>(null)
  const [status, setStatus] = useState<ProviderStatus>('connecting')
  const [serverSynced, setServerSynced] = useState(false)
  const [localLoaded, setLocalLoaded] = useState(false)
  const [me, setMe] = useState<Author>({name: 'You', color: COLORS[0]})
  const [peers, setPeers] = useState<PeerState[]>([])

  const texts = useMemo(() => Object.fromEntries(TEXT_FIELDS.map((f) => [f, getText(doc, f)])) as Record<TextField, Y.Text>, [doc])
  const settings = useMemo(() => getSettings(doc), [doc])
  const meta = useMemo(() => getMeta(doc), [doc])
  const notes = useMemo(() => getNotes(doc), [doc])
  const undo = useMemo(
    () => new Y.UndoManager([...Object.values(texts), settings, notes], {trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout: 600}),
    [texts, settings, notes],
  )

  useEffect(() => {
    const identity = loadIdentity()
    setMe(identity)
    awareness.setLocalState({user: identity, cursor: null})
    const persistence = new IndexeddbPersistence(`magentic:${room}`, doc)
    const p = new RoomProvider(doc, awareness, httpTransport(room, doc.clientID), {ignoreOrigins: [persistence]})
    const offStatus = p.onChange(() => {
      setStatus(p.status)
      if (p.synced) setServerSynced(true)
    })
    persistence.whenSynced.then(() => setLocalLoaded(true)).catch(() => setLocalLoaded(true))
    p.start()
    setProvider(p)
    const leave = () => p.destroy()
    window.addEventListener('pagehide', leave)
    return () => {
      window.removeEventListener('pagehide', leave)
      offStatus()
      p.destroy()
      void persistence.destroy()
    }
  }, [room, doc, awareness])

  useEffect(() => {
    const read = () => {
      const list: PeerState[] = []
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === doc.clientID || !state?.user) return
        list.push({clientId, user: state.user, cursor: state.cursor ?? null, typingUntil: state.typingUntil})
      })
      setPeers(list.sort((a, b) => a.clientId - b.clientId))
    }
    awareness.on('change', read)
    read()
    return () => awareness.off('change', read)
  }, [awareness, doc])

  useEffect(() => () => { undo.destroy() }, [undo])

  const rename = useCallback((name: string) => {
    const next = {...me, name: name.trim().slice(0, 32) || me.name}
    setMe(next)
    try { localStorage.setItem(IDENTITY_KEY, JSON.stringify(next)) } catch {}
    awareness.setLocalStateField('user', next)
  }, [me, awareness])

  const setSetting = useCallback((key: SettingKey, value: string) => {
    doc.transact(() => {
      settings.set(key, value)
      getSettingsBy(doc).set(key, {...me, at: Date.now()})
    }, LOCAL_ORIGIN)
  }, [doc, settings, me])

  const setCursor = useCallback((cursor: CursorState) => {
    const prev = awareness.getLocalState()?.cursor
    if (JSON.stringify(prev) === JSON.stringify(cursor)) return
    awareness.setLocalStateField('cursor', cursor)
  }, [awareness])

  const markTyping = useCallback(() => {
    const until = awareness.getLocalState()?.typingUntil || 0
    if (until - Date.now() < 1200) awareness.setLocalStateField('typingUntil', Date.now() + 3000)
  }, [awareness])

  return {
    doc, awareness, provider, status, serverSynced, localLoaded, me, peers,
    texts, settings, meta, notes, undo,
    rename, setSetting, setCursor, markTyping,
  }
}

export type CollabRoom = ReturnType<typeof useCollabRoom>
