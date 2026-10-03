// Mirror of web/lib/workflow.ts. The runtime source of truth is the
// `workflow.socialPost` document in the dataset; this file seeds it and
// gives Studio the stage list for the `post.stage` field.

export type Actor = 'human' | 'agent'

export const STAGES = [
  {id: 'draft', title: 'Draft', tone: 'default'},
  {id: 'simulating', title: 'Simulating', tone: 'primary'},
  {id: 'needs_revision', title: 'Needs revision', tone: 'critical'},
  {id: 'ready_for_review', title: 'Ready for review', tone: 'caution'},
  {id: 'approved', title: 'Approved', tone: 'positive'},
  {id: 'published', title: 'Published', tone: 'positive'},
] as const

export const TRANSITIONS = [
  {id: 'start_simulation', title: 'Run simulation', from: ['draft', 'needs_revision', 'ready_for_review'], to: 'simulating', actors: ['human', 'agent']},
  {id: 'flag_risk', title: 'Flag risk', from: ['simulating'], to: 'needs_revision', actors: ['agent']},
  {id: 'clear_for_review', title: 'Clear for review', from: ['simulating'], to: 'ready_for_review', actors: ['agent']},
  {id: 'apply_revision', title: 'Apply suggested revision', from: ['needs_revision', 'ready_for_review'], to: 'draft', actors: ['human', 'agent']},
  {id: 'approve', title: 'Approve', from: ['ready_for_review'], to: 'approved', actors: ['human']},
  {id: 'override_approve', title: 'Approve anyway', from: ['needs_revision'], to: 'approved', actors: ['human'], requiresNote: true},
  {id: 'publish', title: 'Publish', from: ['approved'], to: 'published', actors: ['human']},
  {id: 'send_back', title: 'Send back to draft', from: ['ready_for_review', 'approved', 'needs_revision'], to: 'draft', actors: ['human']},
] as const
