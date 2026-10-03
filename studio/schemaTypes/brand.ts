import {defineArrayMember, defineField, defineType} from 'sanity'
import {TagIcon} from '@sanity/icons/Tag'

/**
 * The brand's memory. The analyst agent reads this so it can say "this joke is the
 * same shape as the thing that blew up last March", not just "this sounds negative".
 */
export const brand = defineType({
  name: 'brand',
  title: 'Brand',
  type: 'document',
  icon: TagIcon,
  fields: [
    defineField({name: 'name', type: 'string', validation: (r) => r.required()}),
    defineField({name: 'handle', type: 'string', description: 'Social handle shown on the post preview'}),
    defineField({name: 'voice', title: 'Brand voice', type: 'text', rows: 3}),
    defineField({name: 'audience', title: 'Who we talk to', type: 'text', rows: 2}),
    defineField({
      name: 'redLines',
      title: 'Red lines',
      description: 'Things this brand must never do. The analyst checks every draft against them.',
      type: 'array',
      of: [defineArrayMember({type: 'string'})],
    }),
    defineField({
      name: 'pastIncidents',
      title: 'Past incidents',
      description: 'Previous backlash. Used to spot a draft repeating history.',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'incident',
          fields: [
            defineField({name: 'title', type: 'string'}),
            defineField({name: 'date', type: 'date'}),
            defineField({name: 'whatHappened', type: 'text', rows: 3}),
            defineField({name: 'lesson', type: 'string'}),
          ],
          preview: {select: {title: 'title', subtitle: 'date'}},
        }),
      ],
    }),
  ],
})
