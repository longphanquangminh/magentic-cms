# Co-writing room (Yjs)

Several editors can write the same draft at the same time in the web composer (`/compose`).

## What you get
- **Live co-editing** of title, post copy, media description, and new-brand name and voice. Edits are Yjs CRDT updates, so concurrent typing always converges.
- **Presence**: avatars, coloured remote carets labelled with names, "X is typing…", and join, leave and setting-change toasts.
- **Anchored margin notes**: select words and pin a note. Notes are anchored with `Y.RelativePosition`, so they follow the words through everyone's edits. If the words are deleted, the note says so instead of pointing at random text. Notes support replies and resolve.
- **Analyst handoff**: each risk flag in the live room's Insights tab has a "Fix together" link that opens the composer and pins the flag as a note on the exact phrase. It uses a stable note id, so two editors who open the link get one note.
- **Per-user undo**: `Y.UndoManager` only tracks this tab's edits.
- **Offline**: the doc is cached in IndexedDB (`y-indexeddb`). Failed pushes are kept, merged, and retried with backoff. On reconnect, a state-vector resync runs in both directions.
- **Safe save**: saving marks the room as saved, so other writers see "saved as revision N" and the room becomes read-only.

## Transport (no WebSockets, works on Vercel)
```
browser ──POST /api/collab/:room──▶ Sanity collabUpdate doc
Sanity listener ──SSE /api/collab/:room/stream──▶ other browsers (payload included)
GET /api/collab/:room  → merged state + state vector + presence (join / resync)
POST /api/collab/:room/presence → awareness (name, colour, caret)
```
- Rooms: `post.<postId>.r<revision>` for saved posts, which are seeded deterministically from the saved copy, and `draft.<uuid>` for new drafts. The room id is in the URL, so the link is the invite.
- Updates are validated as real Yjs updates (64 KB per batch, 1 MB per room). After 40 pending updates they are compacted into a `collabSnapshot` doc with a revision-guarded transaction.
- Local edits are batched every 300 ms to save Sanity quota.

## Files
- `web/lib/collab/`: protocol, doc schema and notes, room logic with an injectable store, Sanity store, browser provider, text-diff binding
- `web/components/collab/`: `useCollabRoom`, `CollabField` (input/textarea ↔ Y.Text, IME-safe), presence, notes and toasts
- `web/app/api/collab/[room]/`: state/update, presence, and SSE stream routes
- `web/tests/collab.mjs`: 18 offline tests (in-memory store, simulated SSE bus)

## Limits
- Anyone with the link can co-write, the same as the existing shared demo. There is no per-user authorization.
- Each batch of edits is one Sanity write. Heavy use consumes free-tier quota faster.
- Text fields are plain text, with no rich text.
