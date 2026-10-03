import type {DefaultDocumentNodeResolver, StructureResolver} from 'sanity/structure'
import {SimulationPane} from './components/SimulationPane'
import {STAGES} from './lib/workflow'

export const structure: StructureResolver = (S) =>
  S.list()
    .title('MagenticCMS')
    .items([
      S.listItem()
        .title('Posts by stage')
        .child(
          S.list()
            .title('Stages')
            .items([
              S.listItem().title('All posts').child(S.documentTypeList('post').title('All posts')),
              S.divider(),
              ...STAGES.map((s) =>
                S.listItem()
                  .id(`stage-${s.id}`)
                  .title(s.title)
                  .child(
                    S.documentList()
                      .title(s.title)
                      .schemaType('post')
                      .filter('_type == "post" && coalesce(stage, "draft") == $stage')
                      .params({stage: s.id}),
                  ),
              ),
            ]),
        ),
      S.documentTypeListItem('brand').title('Brands'),
      S.documentTypeListItem('audience').title('Audiences'),
      S.divider(),
      S.documentTypeListItem('simulationRun').title('Simulation runs'),
      S.documentTypeListItem('reaction').title('Reactions'),
      S.documentTypeListItem('persona').title('Persona agents (MatrAIx)'),
      S.divider(),
      S.listItem()
        .title('Workflow definition')
        .child(S.document().schemaType('workflow').documentId('workflow.socialPost')),
      S.documentTypeListItem('workflowEvent').title('Workflow log'),
    ])

export const defaultDocumentNode: DefaultDocumentNodeResolver = (S, {schemaType}) =>
  schemaType === 'post'
    ? S.document().views([S.view.form(), S.view.component(SimulationPane).title('Simulation')])
    : S.document()
