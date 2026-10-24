import 'server-only'
import {NextResponse} from 'next/server'
import {isRoomId} from './protocol'
import {RoomError} from './room'

export const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {status, headers: {'Cache-Control': 'no-store'}})

export async function roomParam(params: Promise<{room: string}>) {
  const {room} = await params
  const decoded = decodeURIComponent(room)
  if (!isRoomId(decoded)) throw new RoomError('Unknown room.', 404)
  return decoded
}

export async function readJson(req: Request, maxChars: number): Promise<Record<string, unknown>> {
  const type = req.headers.get('content-type')?.toLowerCase() || ''
  // sendBeacon may arrive as text/plain; both are parsed strictly as JSON.
  if (!type.includes('application/json') && !type.includes('text/plain')) throw new RoomError('Content-Type must be application/json.', 415)
  if (Number(req.headers.get('content-length') || 0) > maxChars) throw new RoomError('The request is too large.', 413)
  const raw = await req.text()
  if (raw.length > maxChars) throw new RoomError('The request is too large.', 413)
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new RoomError('The request is not valid JSON.') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new RoomError('Send a JSON object.')
  return parsed as Record<string, unknown>
}

export function failure(error: unknown) {
  if (error instanceof RoomError) return json({error: error.message}, error.status)
  if ((error as {statusCode?: number})?.statusCode === 409) return json({error: 'Concurrent write, please retry.'}, 409)
  // Never echo Sanity tokens or infrastructure details to the browser.
  return json({error: 'The co-writing room is unavailable right now. Your edits are kept in this browser.'}, 503)
}
