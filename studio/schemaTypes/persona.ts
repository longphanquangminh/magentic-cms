import {defineField, defineType} from 'sanity'
import {UsersIcon} from '@sanity/icons/Users'

const opt = (name: string, title?: string) => defineField({name, title, type: 'string', readOnly: true})

/**
 * A persona agent. Projected from one MatrAIx Persona-1M record (1,290-dim schema)
 * down to the ~40 attributes that drive how someone reacts to a social post.
 * Read-only in Studio: personas are data, not something editors should tweak to get
 * the answer they want.
 */
export const persona = defineType({
  name: 'persona',
  title: 'Persona agent',
  type: 'document',
  icon: UsersIcon,
  groups: [
    {name: 'identity', title: 'Identity', default: true},
    {name: 'psych', title: 'Personality & attitudes'},
    {name: 'provenance', title: 'Provenance'},
  ],
  fields: [
    defineField({name: 'handle', type: 'string', group: 'identity', validation: (r) => r.required()}),
    defineField({name: 'displayName', type: 'string', group: 'identity'}),
    defineField({name: 'avatarSeed', type: 'string', group: 'identity', hidden: true}),
    defineField({
      name: 'summary',
      title: 'Persona card',
      description: 'Plain-language card the agent is prompted with.',
      type: 'text',
      rows: 3,
      group: 'identity',
    }),
    {...opt('region'), group: 'identity'},
    {...opt('primaryLanguage'), group: 'identity'},
    {...opt('ageBracket'), group: 'identity'},
    {...opt('generation'), group: 'identity'},
    {...opt('gender'), group: 'identity'},
    {...opt('urbanicity'), group: 'identity'},
    {...opt('householdIncome'), group: 'identity'},
    {...opt('education'), group: 'identity'},
    {...opt('workDomain'), group: 'identity'},
    {...opt('role'), group: 'identity'},
    {...opt('politicalLean'), group: 'psych'},
    {...opt('politicalEngagement'), group: 'psych'},
    {...opt('religiosity'), group: 'psych'},
    {...opt('religion'), group: 'psych'},
    {...opt('shoppingStyle'), group: 'psych'},
    {...opt('socialBattery'), group: 'psych'},
    {...opt('newsFrequency'), group: 'psych'},
    {...opt('tone', 'Writing tone'), group: 'psych'},
    {...opt('mood', 'Baseline mood'), group: 'psych'},
    {...opt('riskTolerance'), group: 'psych'},
    {...opt('interestSocialMedia'), group: 'psych'},
    {...opt('interestPolitics'), group: 'psych'},
    defineField({
      name: 'traits',
      title: 'Big Five / BFI-2 traits',
      type: 'object',
      group: 'psych',
      readOnly: true,
      options: {columns: 3},
      fields: [
        'extraversion',
        'agreeableness',
        'negativeEmotionality',
        'anger',
        'trust',
        'liberalism',
        'sympathy',
        'cheerfulness',
        'ambiguityTolerance',
      ].map((n) => defineField({name: n, type: 'string'})),
    }),
    defineField({
      name: 'attitudes',
      type: 'object',
      group: 'psych',
      readOnly: true,
      options: {columns: 2},
      fields: [
        'socialMedia',
        'influencers',
        'brandLoyalty',
        'consumerism',
        'onlineReviews',
        'organizedReligion',
        'traditionalGenderRoles',
        'trustLevel',
      ].map((n) => defineField({name: n, type: 'string'})),
    }),
    defineField({
      name: 'matraix',
      title: 'MatrAIx record',
      type: 'object',
      group: 'provenance',
      readOnly: true,
      fields: [
        defineField({name: 'dataset', type: 'string'}),
        defineField({name: 'source', type: 'string'}),
        defineField({name: 'recordId', type: 'string'}),
        defineField({name: 'rowIndex', type: 'number'}),
        defineField({name: 'populatedAttributes', type: 'number'}),
      ],
    }),
  ],
  preview: {
    select: {title: 'handle', region: 'region', gen: 'generation', lean: 'politicalLean'},
    prepare: ({title, region, gen, lean}) => ({
      title: `@${title}`,
      subtitle: [gen, region, lean].filter(Boolean).join(' · '),
    }),
  },
})
