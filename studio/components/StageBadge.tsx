import type {DocumentBadgeComponent} from 'sanity'
import {STAGES} from '../lib/workflow'

const COLOR: Record<string, 'primary' | 'success' | 'warning' | 'danger' | undefined> = {
  primary: 'primary',
  positive: 'success',
  caution: 'warning',
  critical: 'danger',
}

export const StageBadge: DocumentBadgeComponent = (props) => {
  const doc = (props.draft || props.published) as any
  const s = STAGES.find((x) => x.id === (doc?.stage || 'draft'))
  if (!s) return null
  return {label: s.title, color: COLOR[s.tone]}
}
