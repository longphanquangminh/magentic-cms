import 'server-only'
import {createClient} from '@sanity/client'

export const projectId = process.env.SANITY_PROJECT_ID || process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || ''
export const dataset = process.env.SANITY_DATASET || process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'
export const apiVersion = '2025-02-19'

/** Server-side client. Holds the write token, never shipped to the browser. */
export const sanity = createClient({
  projectId,
  dataset,
  apiVersion,
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
  perspective: 'raw',
})

export const notDraft = `!(_id in path("drafts.**"))`

export const ref = (id: string) => ({_type: 'reference' as const, _ref: id, _weak: true})
