import {defineField, defineType} from 'sanity'
import {FilterIcon} from '@sanity/icons/Filter'

/**
 * An audience is a GROQ filter over persona documents. "Gen Z, skeptical of
 * influencers" is literally `generation == "Gen Z" && attitudes.influencers in [...]`.
 * The simulation samples personas by running this filter against the Content Lake.
 */
export const audience = defineType({
  name: 'audience',
  title: 'Audience',
  type: 'document',
  icon: FilterIcon,
  fields: [
    defineField({name: 'title', type: 'string', validation: (r) => r.required()}),
    defineField({name: 'description', type: 'text', rows: 2}),
    defineField({
      name: 'groqFilter',
      title: 'GROQ filter over personas',
      description: 'Appended to *[_type == "persona" && (...)]. Leave empty for everyone.',
      type: 'text',
      rows: 3,
    }),
    defineField({
      name: 'sampleSize',
      type: 'number',
      initialValue: 60,
      validation: (r) => r.min(5).max(400),
    }),
  ],
})
