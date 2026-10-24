// Offline tests for the Yjs co-writing room. No Sanity, no network, no browser.
// Run: node tests/collab.mjs   (after npm install)
// Transpiles lib/collab/*.ts to ESM under node_modules/.cache so 'yjs' resolves normally.
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import ts from 'typescript'

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(web, 'node_modules/.cache/collab-test')
fs.mkdirSync(out, {recursive: true})
for (const name of ['protocol', 'schema', 'textBinding', 'room', 'provider']) {
  const src = fs.readFileSync(path.join(web, 'lib/collab', name + '.ts'), 'utf8')
  const js = ts.transpileModule(src, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}}).outputText
  fs.writeFileSync(path.join(out, name + '.mjs'), js.replace(/from '\.\/(\w+)'/g, "from './$1.mjs'"))
}
const load = (name) => import(pathToFileURL(path.join(out, name + '.mjs')).href)
const Y = await import('yjs')
const {Awareness} = await import('y-protocols/awareness')
const P = await load('protocol')
const S = await load('schema')
const T = await load('textBinding')
const R = await load('room')
const {RoomProvider, isEmptyUpdate} = await load('provider')
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }

// ------------------------------------------------------------------ text binding
await test('diffText: insert, delete, replace, IME-style replacement', () => {
  assert.deepEqual(T.diffText('hello', 'help!lo', 5), {index: 3, remove: 0, insert: 'p!'})
  assert.deepEqual(T.diffText('hello world', 'hello', 5), {index: 5, remove: 6, insert: ''})
  assert.deepEqual(T.diffText('Viet Nam', 'Việt Nam', 3), {index: 2, remove: 1, insert: 'ệ'})
  assert.equal(T.diffText('same', 'same', 2), null)
})
await test('diffText: caret disambiguates repeated characters', () => {
  assert.deepEqual(T.diffText('aa', 'aaa', 2), {index: 1, remove: 0, insert: 'a'})
  assert.deepEqual(T.diffText('aa', 'aaa', 1), {index: 0, remove: 0, insert: 'a'})
  assert.deepEqual(T.diffText('aa', 'aaa', 3), {index: 2, remove: 0, insert: 'a'})
})
await test('diffText: never splits an emoji surrogate pair', () => {
  const change = T.diffText('a😀b', 'a😃b', 3)
  const applied = 'a😀b'.slice(0, change.index) + change.insert + 'a😀b'.slice(change.index + change.remove)
  assert.equal(applied, 'a😃b')
  assert.ok(!/^[\udc00-\udfff]/.test(change.insert))
})
await test('transformIndex: remote edits move the local caret correctly', () => {
  assert.equal(T.transformIndex(5, [{insert: 'abc'}]), 8) // insert before caret
  assert.equal(T.transformIndex(5, [{retain: 5}, {insert: 'x'}]), 5) // at caret: stay
  assert.equal(T.transformIndex(5, [{retain: 7}, {insert: 'x'}]), 5) // after caret
  assert.equal(T.transformIndex(5, [{retain: 1}, {delete: 2}]), 3)
  assert.equal(T.transformIndex(5, [{retain: 3}, {delete: 10}]), 3) // caret inside deleted range
})
await test('historyKey maps undo/redo shortcuts', () => {
  const k = (key, o = {}) => T.historyKey({key, metaKey: false, ctrlKey: true, shiftKey: false, altKey: false, ...o})
  assert.equal(k('z'), 'undo'); assert.equal(k('Z', {shiftKey: true}), 'redo'); assert.equal(k('y'), 'redo'); assert.equal(k('a'), null)
})

// ------------------------------------------------------------------ protocol
await test('room ids: post rooms and draft rooms only', () => {
  assert.ok(P.isRoomId('post.post.user.4b1c2a9e-1111-2222-3333-444455556666.r3'))
  assert.ok(P.isRoomId('draft.0f9c3c1e-aaaa-bbbb-cccc-111122223333'))
  assert.ok(!P.isRoomId('post.drafts.x.r1'))
  assert.ok(!P.isRoomId('../etc'))
  assert.deepEqual(P.parsePostRoom('post.post.abc.r12'), {postId: 'post.abc', revision: 12})
  const bytes = new Uint8Array(70000).map((_, i) => i % 251)
  assert.deepEqual(P.fromBase64(P.toBase64(bytes)), bytes)
})

// ------------------------------------------------------------------ seed + notes
const post = {postId: 'post.demo', revision: 2, rev: 'rev-a', title: 'Promo', body: 'Still broke at 30? Save more with Saveo.', mediaDescription: '', platform: 'x', audienceId: 'aud-everyone', brandId: 'brand-saveo'}
await test('seed is deterministic: two concurrent seeds never duplicate text', () => {
  const a = S.seedUpdate(post), b = S.seedUpdate(post)
  assert.deepEqual(a, b)
  const doc = new Y.Doc(); Y.applyUpdate(doc, a); Y.applyUpdate(doc, b)
  assert.equal(S.getText(doc, 'body').toString(), post.body)
  assert.equal(S.getSettings(doc).get('platform'), 'x')
})
await test('margin notes stay anchored through concurrent edits', () => {
  const a = new Y.Doc(), b = new Y.Doc()
  Y.applyUpdate(a, S.seedUpdate(post)); Y.applyUpdate(b, S.seedUpdate(post))
  const id = S.createNote(a, {start: 0, end: 18, text: 'Punches down', author: {name: 'Lan', color: '#f0f'}})
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
  // concurrently: A prepends, B appends and edits inside the quote
  S.getText(a, 'body').insert(0, '🔥 NEW: ')
  S.getText(b, 'body').insert(S.getText(b, 'body').length, ' Today only.')
  S.getText(b, 'body').insert(5, ' still')
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b)); Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
  assert.equal(S.getText(a, 'body').toString(), S.getText(b, 'body').toString())
  const [note] = S.readNotes(b)
  assert.equal(note.id, id)
  assert.equal(note.current, 'Still still broke at 30?')
  assert.equal(note.quote, 'Still broke at 30?')
  // typing right after the quote is not pulled into it
  const body = S.getText(b, 'body'); body.insert(note.range.end, '!!')
  assert.equal(S.readNotes(b)[0].current, 'Still still broke at 30?')
  // deleting the quoted words detaches the note instead of pointing at random text
  body.delete(S.readNotes(b)[0].range.start, S.readNotes(b)[0].current.length)
  assert.equal(S.readNotes(b)[0].range, null)
})
await test('analyst flag note ids are stable and phrases are found', () => {
  assert.equal(S.flagNoteId('Still broke at 30?'), S.flagNoteId('Still broke at 30?'))
  assert.notEqual(S.flagNoteId('a'), S.flagNoteId('b'))
  assert.deepEqual(S.locatePhrase(post.body, 'still BROKE'), {start: 0, end: 11})
  assert.equal(S.locatePhrase(post.body, 'missing'), null)
})

// ------------------------------------------------------------------ room logic (in-memory store)
function memoryStore(seed = post) {
  let n = 0
  const db = {snap: new Map(), updates: [], presence: new Map()}
  return {
    db,
    async load(room) {
      const s = db.snap.get(room)
      return {snapshot: s ? {...s} : null, updates: db.updates.filter((u) => u.room === room).map(({id, data}) => ({id, data}))}
    },
    async createSnapshotIfMissing(room, data) { if (!db.snap.has(room)) db.snap.set(room, {data, rev: 'r' + ++n}) },
    async appendUpdate(room, data, client) { const id = 'u' + ++n; db.updates.push({id, room, data, client}); return id },
    async countUpdates(room) { return db.updates.filter((u) => u.room === room).length },
    async compact(room, prev, data, ids) {
      const cur = db.snap.get(room)
      if ((cur?.rev ?? null) !== prev) throw Object.assign(new Error('conflict'), {statusCode: 409})
      db.snap.set(room, {data, rev: 'r' + ++n})
      db.updates = db.updates.filter((u) => !ids.includes(u.id))
    },
    async putPresence(room, client, data) { db.presence.set(room + client, {room, client, data, at: new Date().toISOString()}) },
    async removePresence(room, client) { db.presence.delete(room + client) },
    async listPresence(room, since) { return [...db.presence.values()].filter((p) => p.room === room && p.at > since).map((p) => p.data) },
    async prunePresence(room, before) { for (const [k, p] of db.presence) if (p.room === room && p.at < before) db.presence.delete(k) },
    async loadSeed(id) { return id === seed.postId ? seed : null },
  }
}
const ROOM = P.postRoom(post.postId, post.revision)
const docFrom = (state) => { const d = new Y.Doc(); Y.applyUpdate(d, P.fromBase64(state.state)); return d }

await test('readRoom seeds a post room once, even with simultaneous first visitors', async () => {
  const store = memoryStore()
  const [a, b] = await Promise.all([R.readRoom(store, ROOM), R.readRoom(store, ROOM)])
  assert.equal(S.getText(docFrom(a), 'body').toString(), post.body)
  assert.equal(S.getText(docFrom(b), 'body').toString(), post.body)
  assert.equal(store.db.snap.size, 1)
})
await test('readRoom refuses outdated revisions and missing posts', async () => {
  await assert.rejects(() => R.readRoom(memoryStore(), P.postRoom(post.postId, 1)), (e) => e.status === 409)
  await assert.rejects(() => R.readRoom(memoryStore(), P.postRoom('post.gone', 1)), (e) => e.status === 404)
  const draft = await R.readRoom(memoryStore(), 'draft.12345678-abcd')
  assert.equal(S.getText(docFrom(draft), 'body').toString(), '')
})
await test('writeUpdate rejects garbage, oversize and non-Yjs payloads', async () => {
  const store = memoryStore()
  await assert.rejects(() => R.writeUpdate(store, ROOM, 'not base64!'), (e) => e.status === 400)
  await assert.rejects(() => R.writeUpdate(store, ROOM, P.toBase64(new Uint8Array([255, 255, 255, 1, 2]))), (e) => e.status === 400)
  await assert.rejects(() => R.writeUpdate(store, ROOM, 'A'.repeat(100_000)), (e) => e.status === 413)
  assert.equal(store.db.updates.length, 0)
})
await test('compaction folds updates into the snapshot without losing text', async () => {
  const store = memoryStore()
  const doc = docFrom(await R.readRoom(store, ROOM))
  for (let i = 0; i < 45; i++) {
    const sv = Y.encodeStateVector(doc)
    S.getText(doc, 'body').insert(S.getText(doc, 'body').length, ` ${i}`)
    await R.writeUpdate(store, ROOM, P.toBase64(Y.encodeStateAsUpdate(doc, sv)), doc.clientID)
  }
  assert.ok(store.db.updates.length < 10, `expected compaction, have ${store.db.updates.length} updates`)
  const fresh = docFrom(await R.readRoom(store, ROOM))
  assert.equal(S.getText(fresh, 'body').toString(), S.getText(doc, 'body').toString())
})

// ------------------------------------------------------------------ provider end-to-end over an in-memory "SSE bus"
function bus(store, room) {
  const subs = new Set()
  const emit = (e) => { for (const s of subs) if (s.online()) queueMicrotask(() => s.fn(e)) }
  return (client) => {
    let online = true
    const me = {fn: null, online: () => online, drop: null}
    const fail = () => { if (!online) throw new Error('offline') }
    return {
      setOnline(v) { online = v; if (!v) me.drop?.(); else queueMicrotask(() => me.fn({type: 'ready'})) },
      transport: {
        async fetchState() { fail(); await tick(); return R.readRoom(store, room) },
        async pushUpdate(update) { fail(); await tick(); const id = await R.writeUpdate(store, room, update, client); emit({type: 'update', id, update, client}) },
        async pushPresence(update) { fail(); await R.writePresence(store, room, client, update); emit({type: 'presence', client, update}) },
        subscribe(fn, onDisconnect) { me.fn = fn; me.drop = onDisconnect; subs.add(me); queueMicrotask(() => fn({type: 'ready'})); return () => subs.delete(me) },
        leave() { emit({type: 'presence', client, update: null}) },
      },
    }
  }
}
function peer(join, name) {
  const doc = new Y.Doc()
  const awareness = new Awareness(doc)
  const link = join(doc.clientID)
  const provider = new RoomProvider(doc, awareness, link.transport, {batchMs: 5, presenceMs: 5, maxBackoffMs: 30})
  provider.start()
  awareness.setLocalStateField('user', {name, color: '#fff'})
  return {doc, awareness, provider, link, body: () => S.getText(doc, 'body')}
}
const settle = async (...peers) => {
  for (let i = 0; i < 200; i++) {
    await tick(5)
    if (peers.every((p) => p.provider.synced && !p.provider.pending)) { await tick(10); if (peers.every((p) => !p.provider.pending)) return }
  }
  throw new Error('peers did not settle')
}

await test('two writers converge, live, on the same post room', async () => {
  const store = memoryStore(); const join = bus(store, ROOM)
  const a = peer(join, 'Lan'), b = peer(join, 'Minh')
  await settle(a, b)
  assert.equal(a.body().toString(), post.body)
  a.doc.transact(() => a.body().insert(0, 'Hey! '), S.LOCAL_ORIGIN)
  b.doc.transact(() => b.body().insert(b.body().length, ' 🎉'), S.LOCAL_ORIGIN)
  await settle(a, b)
  assert.equal(a.body().toString(), 'Hey! ' + post.body + ' 🎉')
  assert.equal(b.body().toString(), a.body().toString())
  assert.equal(a.provider.status, 'synced')
  a.provider.destroy(); b.provider.destroy()
})
await test('presence: peers see each other, and leaving removes the peer', async () => {
  const store = memoryStore(); const join = bus(store, ROOM)
  const a = peer(join, 'Lan'), b = peer(join, 'Minh')
  await settle(a, b); await tick(40)
  const names = [...b.awareness.getStates().values()].map((s) => s.user?.name).sort()
  assert.deepEqual(names, ['Lan', 'Minh'])
  a.provider.destroy(); await tick(20)
  assert.deepEqual([...b.awareness.getStates().values()].map((s) => s.user?.name), ['Minh'])
  b.provider.destroy()
})
await test('offline edits are kept, retried, and merged after reconnect', async () => {
  const store = memoryStore(); const join = bus(store, ROOM)
  const a = peer(join, 'Lan'), b = peer(join, 'Minh')
  await settle(a, b)
  a.link.setOnline(false)
  a.doc.transact(() => a.body().insert(0, '[offline A] '), S.LOCAL_ORIGIN)
  b.doc.transact(() => b.body().insert(b.body().length, ' [online B]'), S.LOCAL_ORIGIN)
  await tick(60)
  assert.equal(a.provider.status, 'offline')
  assert.ok(!b.body().toString().includes('offline A'))
  a.link.setOnline(true) // SSE "ready" → resync both ways
  await settle(a, b)
  const expected = '[offline A] ' + post.body + ' [online B]'
  assert.equal(a.body().toString(), expected)
  assert.equal(b.body().toString(), expected)
  // a brand-new visitor loads the same result from the store
  const c = peer(join, 'Thu'); await settle(c)
  assert.equal(c.body().toString(), expected)
  for (const p of [a, b, c]) p.provider.destroy()
})
await test('per-user undo only reverts my own edits', async () => {
  const store = memoryStore(); const join = bus(store, ROOM)
  const a = peer(join, 'Lan'), b = peer(join, 'Minh')
  await settle(a, b)
  const undo = new Y.UndoManager([a.body()], {trackedOrigins: new Set([S.LOCAL_ORIGIN])})
  a.doc.transact(() => a.body().insert(0, 'MINE '), S.LOCAL_ORIGIN)
  await settle(a, b)
  b.doc.transact(() => b.body().insert(b.body().length, ' THEIRS'), S.LOCAL_ORIGIN)
  await settle(a, b)
  undo.undo()
  await settle(a, b)
  assert.equal(b.body().toString(), post.body + ' THEIRS')
  a.provider.destroy(); b.provider.destroy()
})
await test('isEmptyUpdate recognises no-op diffs', () => {
  const d = new Y.Doc(); S.getText(d, 'body').insert(0, 'x')
  assert.ok(isEmptyUpdate(Y.encodeStateAsUpdate(d, Y.encodeStateVector(d))))
  assert.ok(!isEmptyUpdate(Y.encodeStateAsUpdate(d)))
})

console.log(`PASS: ${passed} co-writing checks (text binding, deterministic seed, anchored notes, compaction, live convergence, presence, offline retry, per-user undo). No network.`)
process.exit(0)
