import {createHash, randomUUID, timingSafeEqual} from 'node:crypto'
import {NextResponse} from 'next/server'
import {sanity} from '@/lib/sanity'
import {ComposerError, editBlockReason, validateComposerInput, type ComposerPost} from '@/lib/composerValidation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const reference = (id: string) => ({_type: 'reference', _ref: id})
const respond = (body: unknown, status = 200) => NextResponse.json(body, {status, headers: {'Cache-Control': 'no-store'}})

/** Shared-demo write gate, not user authentication or document ownership. */
export async function POST(req: Request) {
  try {
    const gate = process.env.DEMO_ACCESS_CODE
    if (gate) {
      const provided = req.headers.get('x-demo-access-code') || ''
      const digest = (s: string) => createHash('sha256').update(s).digest()
      if (!timingSafeEqual(digest(provided), digest(gate))) throw new ComposerError('The demo access code is missing or incorrect.', 403, 'accessCode')
    }
    if (!req.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new ComposerError('Content-Type must be application/json.', 415)
    if (Number(req.headers.get('content-length') || 0) > 24000) throw new ComposerError('The request is too large.', 413)
    const raw = await req.text()
    if (raw.length > 24000) throw new ComposerError('The request is too large.', 413)
    let json: unknown
    try { json = JSON.parse(raw) } catch { throw new ComposerError('The request is not valid JSON.') }
    const input = validateComposerInput(json)
    const [current, brand, audience] = await Promise.all([
      input.postId ? sanity.fetch<ComposerPost | null>(`*[_id == $id][0]{_id, _rev, _type, title, body, mediaDescription, platform, revision, stage,
        "brandId": brand._ref, "audienceId": audience._ref,
        "hasDraft": defined(*[_id == "drafts." + $id][0]._id),
        "activeRun": count(*[_type == "simulationRun" && post._ref == $id && status in ["running", "analyzing", "paused"]]) > 0
      }`, {id: input.postId}) : null,
      input.brandId ? sanity.fetch<{_id: string} | null>(`*[_id == $id && _type == "brand"][0]{_id}`, {id: input.brandId}) : null,
      sanity.fetch<{_id: string} | null>(`*[_id == $id && _type == "audience"][0]{_id}`, {id: input.audienceId}),
    ])
    if (input.postId && !current) throw new ComposerError('This post no longer exists.', 404)
    if (current) {
      const reason = editBlockReason(current)
      if (reason) throw new ComposerError(reason, 409)
      if (current._rev !== input.expectedRev) throw new ComposerError('This post changed since you opened it. Copy your edits, then reload before saving.', 409, 'expectedRev')
    }
    if (input.brandId && !brand) throw new ComposerError('That brand is no longer available. Choose another brand.', 400, 'brandId')
    if (!audience) throw new ComposerError('That audience is no longer available. Choose another audience.', 400, 'audienceId')
    const postId = current?._id || `post.user.${randomUUID()}`
    const brandId = input.newBrand ? `brand.user.${randomUUID()}` : input.brandId!
    const mediaDescription = input.mediaDescription ?? current?.mediaDescription ?? ''
    const changed = !current || current.title !== input.title || current.body !== input.body
      || (current.mediaDescription ?? '') !== mediaDescription
      || current.platform !== input.platform || current.brandId !== brandId || current.audienceId !== input.audienceId
    // A no-op save deliberately preserves revision, stage, and simulation results.
    if (current && !changed) return respond({postId, revision: current.revision || 1, expectedRev: current._rev, stage: current.stage || 'draft', changed: false, created: false})
    const revision = current ? (current.revision || 1) + 1 : 1
    // On updates, omitted mediaDescription is left untouched, including legacy absent values.
    const set = {title: input.title, body: input.body, ...(!current || input.mediaDescription !== undefined ? {mediaDescription} : {}), platform: input.platform, brand: reference(brandId), audience: reference(input.audienceId), revision, stage: 'draft'}
    const tx = sanity.transaction()
    if (input.newBrand) tx.create({_id: brandId, _type: 'brand', name: input.newBrand.name, voice: input.newBrand.voice})
    if (current) {
      // Revision guard covers concurrent edits and workflow changes at commit time.
      tx.patch(postId, (patch) => patch.ifRevisionId(input.expectedRev!).set(set).unset(['latestRun']))
    } else {
      tx.create({_id: postId, _type: 'post', ...set})
    }
    tx.create({
      _id: `workflowEvent.composer.${randomUUID()}`, _type: 'workflowEvent',
      post: {_type: 'reference', _ref: postId, _weak: true},
      transition: current ? 'human_edit' : 'create_draft', from: current?.stage || 'draft', to: 'draft',
      actor: {kind: 'human', name: 'Web composer'},
      note: current ? `Human edited content or settings; saved revision ${revision} as a draft. Previous simulation detached.` : 'Human created a draft in the web composer.',
      at: new Date().toISOString(),
    })
    const documents = await tx.commit({visibility: 'sync', returnDocuments: true})
    const saved = documents.find((doc) => doc._id === postId)
    return respond({postId, revision, expectedRev: saved?._rev, stage: 'draft', changed: true, created: !current}, current ? 200 : 201)
  } catch (error: unknown) {
    if (error instanceof ComposerError) return respond({error: error.message, field: error.field}, error.status)
    const status = (error as {statusCode?: number})?.statusCode
    if (status === 409) return respond({error: 'This post changed during saving. Copy your edits, then reload before trying again.', field: 'expectedRev'}, 409)
    // Do not expose Sanity tokens, request details, or infrastructure errors to clients.
    return respond({error: 'Could not save to the content store. Your text is still here; please try again.'}, 500)
  }
}
