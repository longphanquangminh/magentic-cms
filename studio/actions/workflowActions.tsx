import {useEffect, useState} from 'react'
import type {DocumentActionComponent, DocumentActionsResolver} from 'sanity'
import {useClient, useCurrentUser} from 'sanity'
import {PlayIcon} from '@sanity/icons/Play'
import {CheckmarkIcon} from '@sanity/icons/Checkmark'
import {PublishIcon} from '@sanity/icons/Publish'
import {ResetIcon} from '@sanity/icons/Reset'
import {EditIcon} from '@sanity/icons/Edit'
import {WarningOutlineIcon} from '@sanity/icons/WarningOutline'

const WEB_URL = (process.env.SANITY_STUDIO_WEB_URL || 'http://localhost:3000').replace(/\/$/, '')
const API = '2025-02-19'

type Transition = {id: string; title: string; from: string[]; to: string; actors: string[]; requiresNote?: boolean}

const ICONS: Record<string, any> = {
  start_simulation: PlayIcon,
  approve: CheckmarkIcon,
  override_approve: WarningOutlineIcon,
  publish: PublishIcon,
  send_back: ResetIcon,
  apply_revision: EditIcon,
}

// One fetch per Studio session; the workflow document is the source of truth.
let workflowPromise: Promise<Transition[]> | null = null

function useTransitions() {
  const client = useClient({apiVersion: API})
  const [transitions, setTransitions] = useState<Transition[] | null>(null)
  useEffect(() => {
    let alive = true
    workflowPromise =
      workflowPromise ||
      client.fetch<Transition[]>(`coalesce(*[_type == "workflow" && appliesTo == "post"][0].transitions, [])`)
    workflowPromise.then((t) => alive && setTransitions(t)).catch(() => alive && setTransitions([]))
    return () => {
      alive = false
    }
  }, [client])
  return transitions
}

/** Builds a document action bound to one transition id from the workflow document. */
function transitionAction(transitionId: string): DocumentActionComponent {
  const Action: DocumentActionComponent = (props) => {
    const client = useClient({apiVersion: API})
    const user = useCurrentUser()
    const transitions = useTransitions()
    const [busy, setBusy] = useState(false)

    const t = transitions?.find((x) => x.id === transitionId)
    const doc = (props.draft || props.published) as any
    const stage = doc?.stage || 'draft'
    if (!t || !t.from.includes(stage) || !t.actors.includes('human')) return null

    const baseId = props.id.replace(/^drafts\./, '')

    return {
      label: t.title,
      icon: ICONS[t.id],
      tone: t.id === 'override_approve' ? 'critical' : t.id === 'approve' || t.id === 'publish' ? 'positive' : undefined,
      disabled: busy || (t.id === 'start_simulation' && !props.published),
      title: t.id === 'start_simulation' && !props.published ? 'Publish the document once so the simulator can read it' : undefined,
      onHandle: async () => {
        // Simulations run in the live room so you can watch the crowd react.
        if (t.id === 'start_simulation') {
          window.open(`${WEB_URL}/posts/${baseId}?autorun=1`, '_blank', 'noopener')
          props.onComplete()
          return
        }
        let note: string | undefined
        if (t.requiresNote) {
          note = window.prompt('The simulation flagged this post. Why approve it anyway?') || undefined
          if (!note) {
            props.onComplete()
            return
          }
        }
        setBusy(true)
        try {
          const ids = [props.published ? baseId : null, props.draft ? `drafts.${baseId}` : null].filter(Boolean) as string[]
          const set: Record<string, unknown> = {stage: t.to}
          if (t.id === 'apply_revision') {
            const suggestion = await client.fetch<string | null>(
              `*[_id == $id][0].latestRun->analysis.suggestedRevision`,
              {id: ids[0]},
            )
            if (!suggestion) {
              window.alert('The latest run has no suggested revision yet.')
              return
            }
            set.body = suggestion
            set.revision = (doc?.revision || 1) + 1
          }
          const tx = client.transaction()
          ids.forEach((id) => tx.patch(id, (p) => p.set(set)))
          tx.create({
            _type: 'workflowEvent',
            post: {_type: 'reference', _ref: baseId, _weak: true},
            transition: t.id,
            from: stage,
            to: t.to,
            actor: {kind: 'human', name: user?.name || user?.email || 'editor'},
            note,
            run: doc?.latestRun?._ref ? {_type: 'reference', _ref: doc.latestRun._ref, _weak: true} : undefined,
            at: new Date().toISOString(),
          })
          await tx.commit()
        } finally {
          setBusy(false)
          props.onComplete()
        }
      },
    }
  }
  Action.displayName = `Workflow_${transitionId}`
  return Action
}

const ACTIONS = ['start_simulation', 'apply_revision', 'approve', 'override_approve', 'publish', 'send_back'].map(
  transitionAction,
)

export const workflowActions: DocumentActionsResolver = (prev, context) =>
  context.schemaType === 'post' ? [...ACTIONS, ...prev] : prev
