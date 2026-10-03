import {defineArrayMember, defineField, defineType} from 'sanity'
import {CommentIcon} from '@sanity/icons/Comment'
import {PlayIcon} from '@sanity/icons/Play'

const num = (name: string, title?: string) => defineField({name, title, type: 'number'})

/**
 * One simulation of one revision of one post. The copy is snapshotted so
 * runs can be compared after the post is edited.
 */
export const simulationRun = defineType({
  name: 'simulationRun',
  title: 'Simulation run',
  type: 'document',
  icon: PlayIcon,
  readOnly: true,
  groups: [
    {name: 'result', title: 'Result', default: true},
    {name: 'setup', title: 'Setup'},
  ],
  fields: [
    defineField({name: 'post', type: 'reference', to: [{type: 'post'}], weak: true, group: 'setup'}),
    defineField({name: 'revision', type: 'number', group: 'setup'}),
    defineField({name: 'bodySnapshot', type: 'text', group: 'setup'}),
    defineField({name: 'audienceSnapshot', type: 'string', group: 'setup'}),
    defineField({name: 'model', type: 'string', group: 'setup'}),
    defineField({
      name: 'status',
      type: 'string',
      group: 'result',
      options: {list: ['running', 'paused', 'analyzing', 'complete', 'failed', 'cancelled']},
    }),
    defineField({name: 'personaCount', type: 'number', group: 'setup'}),
    defineField({
      name: 'queue',
      title: 'Persona queue',
      description: 'Personas not yet processed, in wave order.',
      type: 'array',
      group: 'setup',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'slot',
          fields: [
            defineField({name: 'persona', type: 'reference', to: [{type: 'persona'}], weak: true}),
            defineField({name: 'wave', type: 'number'}),
          ],
        }),
      ],
    }),
    defineField({name: 'processed', type: 'number', group: 'setup'}),
    defineField({name: 'analysisStartedAt', type: 'datetime', group: 'setup'}),
    defineField({name: 'mediaSnapshot', type: 'text', group: 'setup'}),
    defineField({name: 'startedAt', type: 'datetime', group: 'setup'}),
    defineField({name: 'finishedAt', type: 'datetime', group: 'setup'}),
    defineField({name: 'error', type: 'text', group: 'setup'}),
    defineField({
      name: 'metrics',
      type: 'object',
      group: 'result',
      fields: [
        num('backlashRisk', 'Backlash risk (0-100)'),
        num('trendScore', 'Trend score (0-100)'),
        num('engagementRate'),
        num('avgSentiment'),
        num('comments'),
        num('replies'),
        num('shares'),
        num('scrolledPast'),
        num('flagged'),
        defineField({
          name: 'emoji',
          type: 'object',
          options: {columns: 3},
          fields: ['like', 'love', 'haha', 'wow', 'sad', 'angry'].map((n) => num(n)),
        }),
        defineField({name: 'quadrant', type: 'string', description: 'viral_good | viral_bad | quiet_safe | quiet_risky'}),
      ],
    }),
    defineField({
      name: 'cohorts',
      title: 'Cohort breakdown',
      type: 'array',
      group: 'result',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'cohort',
          fields: [
            defineField({name: 'dimension', type: 'string'}),
            defineField({name: 'value', type: 'string'}),
            num('n'),
            num('avgSentiment'),
            num('negativeShare'),
          ],
          preview: {
            select: {d: 'dimension', v: 'value', n: 'n', s: 'avgSentiment'},
            prepare: ({d, v, n, s}) => ({title: `${d}: ${v}`, subtitle: `n=${n} · sentiment ${s}`}),
          },
        }),
      ],
    }),
    defineField({
      name: 'analysis',
      type: 'object',
      group: 'result',
      fields: [
        defineField({name: 'mode', type: 'string', options: {list: ['model', 'metrics_only']}}),
        defineField({name: 'verdict', type: 'string', options: {list: ['ship', 'revise', 'kill', 'review']}}),
        defineField({name: 'headline', type: 'string'}),
        defineField({name: 'summary', type: 'text'}),
        defineField({
          name: 'riskFlags',
          type: 'array',
          of: [
            defineArrayMember({
              type: 'object',
              name: 'riskFlag',
              fields: [
                defineField({name: 'phrase', title: 'Phrase in the post', type: 'string'}),
                defineField({name: 'why', type: 'text', rows: 2}),
                defineField({name: 'severity', type: 'string', options: {list: ['low', 'medium', 'high']}}),
                defineField({name: 'brandMemory', title: 'Matches brand red line / past incident', type: 'string'}),
                defineField({
                  name: 'evidence',
                  type: 'array',
                  of: [{type: 'reference', to: [{type: 'reaction'}], weak: true}],
                }),
              ],
              preview: {select: {title: 'phrase', subtitle: 'severity'}},
            }),
          ],
        }),
        defineField({name: 'suggestedRevision', type: 'text', rows: 6}),
        defineField({name: 'changes', type: 'array', of: [{type: 'string'}]}),
      ],
    }),
  ],
  preview: {
    select: {post: 'post.title', rev: 'revision', status: 'status', risk: 'metrics.backlashRisk', trend: 'metrics.trendScore'},
    prepare: ({post, rev, status, risk, trend}) => ({
      title: `${post || 'Run'} · rev ${rev ?? '?'}`,
      subtitle: status === 'complete' ? `risk ${risk} · trend ${trend}` : status,
    }),
  },
})

/**
 * One thing one persona did. A reaction can reply to another reaction, which
 * is how agents argue with each other in later waves.
 */
export const reaction = defineType({
  name: 'reaction',
  title: 'Reaction',
  type: 'document',
  icon: CommentIcon,
  readOnly: true,
  fields: [
    defineField({name: 'run', type: 'reference', to: [{type: 'simulationRun'}], weak: true}),
    defineField({name: 'persona', type: 'reference', to: [{type: 'persona'}], weak: true}),
    defineField({name: 'wave', type: 'number'}),
    defineField({name: 'seq', type: 'number', description: 'Order of arrival within the run'}),
    defineField({name: 'action', type: 'string', options: {list: ['scroll', 'react', 'comment', 'reply', 'share']}}),
    defineField({name: 'emoji', type: 'string', options: {list: ['like', 'love', 'haha', 'wow', 'sad', 'angry']}}),
    defineField({name: 'text', type: 'text', rows: 2}),
    defineField({name: 'sentiment', type: 'number', validation: (r) => r.min(-1).max(1)}),
    defineField({name: 'replyTo', type: 'reference', to: [{type: 'reaction'}], weak: true}),
    defineField({name: 'likes', type: 'number', initialValue: 0}),
    defineField({
      name: 'flag',
      type: 'object',
      fields: [
        defineField({
          name: 'category',
          type: 'string',
          options: {list: ['offensive', 'insensitive', 'misleading', 'tone_deaf', 'legal', 'off_brand']},
        }),
        defineField({name: 'reason', type: 'string'}),
      ],
    }),
    defineField({name: 'thought', title: 'Private thought', description: 'Why the persona did what it did (not shown in the feed).', type: 'string'}),
  ],
  preview: {
    select: {handle: 'persona.handle', action: 'action', text: 'text', emoji: 'emoji'},
    prepare: ({handle, action, text, emoji}) => ({
      title: text || `${action}${emoji ? ' ' + emoji : ''}`,
      subtitle: `@${handle} · ${action}`,
    }),
  },
})
