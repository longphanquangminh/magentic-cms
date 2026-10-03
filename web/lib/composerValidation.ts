export const PLATFORMS = ['facebook', 'instagram', 'x', 'tiktok', 'linkedin'] as const
export type Platform = (typeof PLATFORMS)[number]
export const MEDIA_DESCRIPTION_MAX_LENGTH = 1000
export const EDITABLE_STAGES = ['draft', 'needs_revision', 'ready_for_review', 'approved']
export type ComposerBrand = {_id: string; name: string; handle?: string; voice?: string}
export type ComposerAudience = {_id: string; title: string; description?: string}
export type ComposerPost = {
  _id: string; _rev: string; _type: string; title: string; body: string; mediaDescription?: string; platform: Platform
  brandId?: string; audienceId?: string; revision?: number; stage?: string
  hasDraft?: boolean; activeRun?: boolean
}
export type ComposerInput = {
  postId?: string; expectedRev?: string; title: string; body: string; mediaDescription?: string; platform: Platform
  audienceId: string; brandId?: string; newBrand?: {name: string; voice: string}
}
export class ComposerError extends Error {
  constructor(message: string, public status = 400, public field?: string) { super(message) }
}
export function isLiveDocumentId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value)
    && !/^(drafts|versions|system)\./.test(value)
}
export function editBlockReason(post: ComposerPost): string | null {
  if (post._type !== 'post') return 'This document is not an editable social post.'
  if (post.stage === 'published') return 'Published posts cannot be edited. Create a new draft instead.'
  if (post.stage === 'simulating' || post.activeRun) return 'A simulation is in progress. Wait for it to finish before editing.'
  if (!EDITABLE_STAGES.includes(post.stage || 'draft')) return 'This workflow stage does not allow editing.'
  if (post.hasDraft) return 'This post has an unpublished Studio draft. Resolve it in Studio before editing here.'
  return null
}
export function validateComposerInput(value: unknown): ComposerInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ComposerError('Send a JSON object.')
  const data = value as Record<string, unknown>
  const text = (v: unknown, field: string, max: number, required = true) => {
    if (typeof v !== 'string') throw new ComposerError(`${field} must be text.`, 400, field)
    if (v.length > max) throw new ComposerError(`${field} must be ${max} characters or fewer.`, 400, field)
    const trimmed = v.trim()
    if (required && !trimmed) throw new ComposerError(`${field} is required.`, 400, field)
    return trimmed
  }
  const title = text(data.title, 'title', 160)
  const body = text(data.body, 'body', 2000)
  // Keep omission distinct from an explicit empty string so older callers cannot clear existing media context.
  const mediaDescription = data.mediaDescription === undefined ? undefined : text(data.mediaDescription, 'mediaDescription', MEDIA_DESCRIPTION_MAX_LENGTH, false)
  if (!PLATFORMS.includes(data.platform as Platform)) throw new ComposerError('Choose a supported platform.', 400, 'platform')
  if (!isLiveDocumentId(data.audienceId)) throw new ComposerError('Choose an available audience.', 400, 'audienceId')
  let postId: string | undefined
  let expectedRev: string | undefined
  if (data.postId !== undefined) {
    if (!isLiveDocumentId(data.postId)) throw new ComposerError('Invalid post ID.', 400, 'postId')
    postId = data.postId
    expectedRev = text(data.expectedRev, 'expectedRev', 200)
  }
  let brandId: string | undefined
  let newBrand: ComposerInput['newBrand']
  if (data.newBrand !== undefined) {
    if (data.brandId !== undefined) throw new ComposerError('Choose an existing brand or create one, not both.', 400, 'brandId')
    if (!data.newBrand || typeof data.newBrand !== 'object' || Array.isArray(data.newBrand)) throw new ComposerError('Invalid new brand.', 400, 'newBrand')
    const brand = data.newBrand as Record<string, unknown>
    newBrand = {name: text(brand.name ?? '', 'brand name', 100, false) || 'My brand', voice: text(brand.voice ?? '', 'brand voice', 1000, false)}
  } else {
    if (!isLiveDocumentId(data.brandId)) throw new ComposerError('Choose an available brand or create your own.', 400, 'brandId')
    brandId = data.brandId
  }
  return {postId, expectedRev, title, body, mediaDescription, platform: data.platform as Platform, audienceId: data.audienceId, brandId, newBrand}
}
