import {useEffect, useState} from 'react'
import {useClient} from 'sanity'
import {Badge, Box, Card, Flex, Grid, Heading, Stack, Text} from '@sanity/ui'

const API = '2025-02-19'
const WEB_URL = (process.env.SANITY_STUDIO_WEB_URL || 'http://localhost:3000').replace(/\/$/, '')

const RUN_QUERY = `*[_type == "simulationRun" && post._ref == $id] | order(startedAt desc)[0...6]{
  _id, revision, status, processed, personaCount, metrics, analysis, startedAt,
  "top": *[_type == "reaction" && run._ref == ^._id && defined(text)] | order(likes desc)[0...6]{
    _id, text, likes, sentiment, flag, "handle": persona->handle
  }
}`

function Meter({label, value, danger}: {label: string; value?: number; danger?: boolean}) {
  const v = Math.max(0, Math.min(100, value ?? 0))
  const tone = danger ? (v >= 60 ? '#e5484d' : v >= 35 ? '#f5a524' : '#30a46c') : v >= 60 ? '#30a46c' : '#6e56cf'
  return (
    <Stack space={2}>
      <Flex justify="space-between">
        <Text size={1} muted>
          {label}
        </Text>
        <Text size={1} weight="semibold">
          {value ?? '—'}
        </Text>
      </Flex>
      <div style={{height: 8, background: 'var(--card-border-color)', borderRadius: 4}}>
        <div style={{width: `${v}%`, height: 8, background: tone, borderRadius: 4, transition: 'width .4s'}} />
      </div>
    </Stack>
  )
}

/**
 * "Simulation" tab on every post. Subscribes to the Content Lake so numbers
 * move while a run is in progress, even if the run was started elsewhere.
 */
export function SimulationPane(props: any) {
  const client = useClient({apiVersion: API})
  const id = String(props.documentId || '').replace(/^drafts\./, '')
  const [runs, setRuns] = useState<any[] | null>(null)

  useEffect(() => {
    let alive = true
    let timer: any
    const load = () => client.fetch(RUN_QUERY, {id}).then((r) => alive && setRuns(r))
    load()
    const sub = client
      // Listener filters can't follow references, so watch the run docs; the
      // engine patches `processed` on its run after every batch of reactions.
      .listen(`*[_type == "simulationRun" && post._ref == $id]`, {id}, {
        visibility: 'query',
        includeResult: false,
      })
      .subscribe(() => {
        clearTimeout(timer)
        timer = setTimeout(load, 400)
      })
    return () => {
      alive = false
      sub.unsubscribe()
      clearTimeout(timer)
    }
  }, [client, id])

  if (!runs) return <Box padding={4}><Text muted>Loading…</Text></Box>
  if (!runs.length)
    return (
      <Box padding={4}>
        <Stack space={3}>
          <Heading size={1}>No simulations yet</Heading>
          <Text muted>Publish the post, then use “Run simulation” in the document actions menu.</Text>
        </Stack>
      </Box>
    )

  const [run, ...older] = runs
  const m = run.metrics || {}
  const a = run.analysis || {}
  return (
    <Box padding={4}>
      <Stack space={4}>
        <Flex align="center" gap={2}>
          <Heading size={1}>Revision {run.revision}</Heading>
          <Badge tone={run.status === 'complete' ? 'positive' : 'primary'}>{run.status}</Badge>
          {a.verdict && (
            <Badge tone={a.verdict === 'ship' ? 'positive' : a.verdict === 'revise' ? 'caution' : 'critical'}>
              {a.verdict}
            </Badge>
          )}
          <Box flex={1} />
          <a href={`${WEB_URL}/posts/${id}?run=${run._id}`} target="_blank" rel="noopener noreferrer">
            <Text size={1}>Open live room ↗</Text>
          </a>
        </Flex>
        {run.status !== 'complete' && (
          <Text size={1} muted>
            {run.processed || 0} / {run.personaCount} personas processed…
          </Text>
        )}
        <Grid columns={2} gap={4}>
          <Meter label="Backlash risk" value={m.backlashRisk} danger />
          <Meter label="Trend score" value={m.trendScore} />
        </Grid>
        {a.headline && (
          <Card padding={3} radius={2} tone={a.verdict === 'ship' ? 'positive' : 'caution'}>
            <Stack space={2}>
              <Text weight="semibold">{a.headline}</Text>
              <Text size={1}>{a.summary}</Text>
            </Stack>
          </Card>
        )}
        {(a.riskFlags || []).length > 0 && (
          <Stack space={2}>
            <Text size={1} weight="semibold">Risk flags</Text>
            {a.riskFlags.map((f: any, i: number) => (
              <Card key={i} padding={3} radius={2} border tone={f.severity === 'high' ? 'critical' : 'caution'}>
                <Stack space={2}>
                  <Text size={1} weight="semibold">“{f.phrase}”</Text>
                  <Text size={1}>{f.why}</Text>
                  {f.brandMemory && <Text size={1} muted>Brand memory: {f.brandMemory}</Text>}
                </Stack>
              </Card>
            ))}
          </Stack>
        )}
        <Stack space={2}>
          <Text size={1} weight="semibold">Most-liked comments</Text>
          {(run.top || []).map((c: any) => (
            <Card key={c._id} padding={3} radius={2} border tone={c.flag?.category ? 'critical' : 'default'}>
              <Text size={1}>
                <b>@{c.handle}</b> {c.text} <span style={{opacity: 0.6}}>· {c.likes || 0} likes</span>
              </Text>
            </Card>
          ))}
        </Stack>
        {older.length > 0 && (
          <Stack space={2}>
            <Text size={1} weight="semibold">Earlier revisions</Text>
            {older.map((r) => (
              <Text key={r._id} size={1} muted>
                rev {r.revision}: risk {r.metrics?.backlashRisk ?? '—'} · trend {r.metrics?.trendScore ?? '—'} ·{' '}
                {r.analysis?.verdict || r.status}
              </Text>
            ))}
          </Stack>
        )}
      </Stack>
    </Box>
  )
}
