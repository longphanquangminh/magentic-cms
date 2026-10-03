import {defineArrayMember, defineField, defineType} from 'sanity'
import {ArrowRightIcon} from '@sanity/icons/ArrowRight'
import {ActivityIcon} from '@sanity/icons/Activity'

/**
 * The publishing process, stored as data next to the content it governs.
 * Both the simulation agent (via the web API) and humans (via Studio actions)
 * move a post by asking for a transition id; the transition is checked against
 * this document: is the post in an allowed `from` stage, and is this kind of
 * actor allowed to take it? Agents can flag and clear. Only humans approve.
 */
export const workflow = defineType({
  name: 'workflow',
  title: 'Workflow',
  type: 'document',
  icon: ArrowRightIcon,
  fields: [
    defineField({name: 'title', type: 'string'}),
    defineField({name: 'appliesTo', type: 'string', initialValue: 'post'}),
    defineField({
      name: 'stages',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'stage',
          fields: [
            defineField({name: 'id', type: 'string'}),
            defineField({name: 'title', type: 'string'}),
            defineField({name: 'tone', type: 'string'}),
          ],
          preview: {select: {title: 'title', subtitle: 'id'}},
        }),
      ],
    }),
    defineField({
      name: 'transitions',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'transition',
          fields: [
            defineField({name: 'id', type: 'string'}),
            defineField({name: 'title', type: 'string'}),
            defineField({name: 'from', type: 'array', of: [{type: 'string'}]}),
            defineField({name: 'to', type: 'string'}),
            defineField({
              name: 'actors',
              title: 'Who may take it',
              type: 'array',
              of: [{type: 'string'}],
              options: {list: ['human', 'agent']},
            }),
            defineField({name: 'requiresNote', type: 'boolean'}),
          ],
          preview: {
            select: {title: 'title', from: 'from', to: 'to', actors: 'actors'},
            prepare: ({title, from, to, actors}) => ({
              title,
              subtitle: `${(from || []).join(' | ')} → ${to}   [${(actors || []).join(', ')}]`,
            }),
          },
        }),
      ],
    }),
  ],
})

/** Append-only audit log of every transition taken, by whom, and why. */
export const workflowEvent = defineType({
  name: 'workflowEvent',
  title: 'Workflow event',
  type: 'document',
  icon: ActivityIcon,
  readOnly: true,
  fields: [
    defineField({name: 'post', type: 'reference', to: [{type: 'post'}], weak: true}),
    defineField({name: 'transition', type: 'string'}),
    defineField({name: 'from', type: 'string'}),
    defineField({name: 'to', type: 'string'}),
    defineField({
      name: 'actor',
      type: 'object',
      fields: [
        defineField({name: 'kind', type: 'string', options: {list: ['human', 'agent']}}),
        defineField({name: 'name', type: 'string'}),
      ],
    }),
    defineField({name: 'note', type: 'text', rows: 2}),
    defineField({name: 'run', type: 'reference', to: [{type: 'simulationRun'}], weak: true}),
    defineField({name: 'at', type: 'datetime'}),
  ],
  orderings: [{title: 'Newest', name: 'atDesc', by: [{field: 'at', direction: 'desc'}]}],
  preview: {
    select: {t: 'transition', from: 'from', to: 'to', who: 'actor.name', kind: 'actor.kind', post: 'post.title'},
    prepare: ({t, from, to, who, kind, post}) => ({
      title: `${post || 'post'}: ${from} → ${to}`,
      subtitle: `${t} by ${kind === 'agent' ? '🤖' : '🧑'} ${who || ''}`,
    }),
  },
})
