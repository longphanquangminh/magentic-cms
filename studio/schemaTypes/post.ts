import {defineField, defineType} from 'sanity'
import {DocumentTextIcon} from '@sanity/icons/DocumentText'
import {STAGES} from '../lib/workflow'

export const post = defineType({
  name: 'post',
  title: 'Social post',
  type: 'document',
  icon: DocumentTextIcon,
  groups: [
    {name: 'content', title: 'Content', default: true},
    {name: 'workflow', title: 'Workflow'},
  ],
  fields: [
    defineField({name: 'title', title: 'Internal title', type: 'string', group: 'content', validation: (r) => r.required()}),
    defineField({name: 'brand', type: 'reference', to: [{type: 'brand'}], group: 'content', validation: (r) => r.required()}),
    defineField({
      name: 'platform',
      type: 'string',
      group: 'content',
      initialValue: 'facebook',
      options: {list: ['facebook', 'instagram', 'x', 'tiktok', 'linkedin'], layout: 'radio', direction: 'horizontal'},
    }),
    defineField({
      name: 'body',
      title: 'Post copy',
      type: 'text',
      rows: 6,
      group: 'content',
      validation: (r) => r.required().max(2000),
    }),
    defineField({
      name: 'mediaDescription',
      title: 'Image / video (described)',
      description: 'Agents cannot see media yet, so describe it the way a viewer would.',
      type: 'text',
      rows: 2,
      group: 'content',
    }),
    defineField({name: 'audience', type: 'reference', to: [{type: 'audience'}], group: 'content'}),
    defineField({
      name: 'stage',
      type: 'string',
      group: 'workflow',
      readOnly: true,
      initialValue: 'draft',
      description: 'Moved only through workflow transitions (see the Workflow document).',
      options: {list: STAGES.map((s) => ({title: s.title, value: s.id}))},
    }),
    defineField({name: 'latestRun', type: 'reference', to: [{type: 'simulationRun'}], group: 'workflow', readOnly: true, weak: true}),
    defineField({name: 'revision', type: 'number', group: 'workflow', readOnly: true, initialValue: 1}),
  ],
  preview: {
    select: {title: 'title', stage: 'stage', platform: 'platform', risk: 'latestRun.metrics.backlashRisk'},
    prepare: ({title, stage, platform, risk}) => ({
      title,
      subtitle: [stage, platform, risk != null ? `risk ${risk}` : null].filter(Boolean).join(' · '),
    }),
  },
})
