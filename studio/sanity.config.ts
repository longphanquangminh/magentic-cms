import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import {schemaTypes} from './schemaTypes'
import {structure, defaultDocumentNode} from './structure'
import {workflowActions} from './actions/workflowActions'
import {StageBadge} from './components/StageBadge'

export default defineConfig({
  name: 'magenticcms',
  title: 'MagenticCMS',
  projectId: process.env.SANITY_STUDIO_PROJECT_ID!,
  dataset: process.env.SANITY_STUDIO_DATASET || 'production',
  plugins: [structureTool({structure, defaultDocumentNode}), visionTool()],
  schema: {
    types: schemaTypes,
    // Runs, reactions and the workflow log are written by agents, not created by hand.
    templates: (prev) => prev.filter((t) => !['simulationRun', 'reaction', 'workflowEvent', 'persona', 'workflow'].includes(t.schemaType)),
  },
  document: {
    actions: workflowActions,
    badges: (prev, ctx) => (ctx.schemaType === 'post' ? [StageBadge, ...prev] : prev),
  },
})
