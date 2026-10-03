import {NextResponse} from 'next/server'
import {sanity, ref} from '@/lib/sanity'

/** Explicit recovery action. Retains all evidence; returns only this run's current post to draft. */
export async function POST(_req: Request, {params}: {params: Promise<{id: string}>}) {
  const {id} = await params
  const run = await sanity.fetch('*[_id==$id && _type=="simulationRun"][0]{_id,_rev,status,post}',{id})
  if (!run) return NextResponse.json({error:'Run not found'},{status:404})
  if (!['running','paused','analyzing'].includes(run.status)) return NextResponse.json({error:'This session is already finished.'},{status:409})
  const post = await sanity.fetch('*[_id==$id && _type=="post"][0]{_id,_rev,stage,latestRun}',{id:run.post._ref})
  if (!post || post.stage !== 'simulating' || post.latestRun?._ref !== id) return NextResponse.json({error:'The post has moved on. Refresh before retrying.'},{status:409})
  try {
    await sanity.transaction()
      .patch(run._id,p=>p.ifRevisionId(run._rev).set({status:'cancelled',error:null,finishedAt:new Date().toISOString()}))
      .patch(post._id,p=>p.ifRevisionId(post._rev).set({stage:'draft'}))
      .create({_type:'workflowEvent',post:ref(post._id),run:ref(id),transition:'cancel_simulation',from:'simulating',to:'draft',actor:{kind:'human',name:'Live room reviewer'},note:'Cancelled session; saved reactions retained.',at:new Date().toISOString()})
      .commit({visibility:'sync'})
    return NextResponse.json({status:'cancelled'})
  } catch { return NextResponse.json({error:'The session changed while cancelling. Refresh and try again.'},{status:409}) }
}
