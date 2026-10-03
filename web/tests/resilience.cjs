const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const assert=require('node:assert/strict');const ts=require('typescript');
const base=path.resolve(__dirname,'../lib');
function load(name, mocks={}){const exp={};const src=ts.transpileModule(fs.readFileSync(path.join(base,name+'.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;vm.runInNewContext(src,{exports:exp,require:n=>n==='server-only'?{}:mocks[n]||require(n),process:{env:{}},console,fetch,AbortSignal,setTimeout,clearTimeout,URL,Date,Math,Set,Map,Error,JSON},{filename:name+'.js'});return exp}
const {requestJSON}=load('modelTransport');const {validateCrowdBatch}=load('crowdValidation');
const response=(text,status=200)=>new Response(status===200?JSON.stringify({candidates:[{content:{parts:[{text}]}}]}):'private provider details',{status});
const row=id=>({personaId:id,action:'scroll',emoji:'none',sentiment:0,flagCategory:'none',thought:'Not interested'});
(async()=>{
let calls=0;await assert.rejects(()=>requestJSON({key:'',models:['a'],body:{},fetcher:async()=>{calls++;return response('{}')}}),e=>e.code==='missing_key');assert.equal(calls,0);
calls=0;await assert.rejects(()=>requestJSON({key:'test',models:['a','b'],body:{},fetcher:async()=>{calls++;return response('',403)},sleep:async()=>{}}),e=>e.code==='auth');assert.equal(calls,1);
calls=0;await assert.rejects(()=>requestJSON({key:'test',models:['a'],body:{},fetcher:async()=>{calls++;return response('',429)},sleep:async()=>{}}),e=>e.code==='quota');assert.equal(calls,2);
calls=0;const out=await requestJSON({key:'test',models:['a','b'],body:{},fetcher:async url=>{calls++;return url.includes('/b:')?response('{"ok":true}'):response('',503)},sleep:async()=>{}});assert.equal(out.ok,true);assert.equal(calls,3);
await assert.rejects(()=>requestJSON({key:'test',models:['a'],body:{},fetcher:async()=>response('not json'),sleep:async()=>{}}),e=>e.code==='invalid_response');
assert.throws(()=>validateCrowdBatch([row('a')],['a','b']));assert.throws(()=>validateCrowdBatch([row('a'),row('a')],['a','b']));assert.throws(()=>validateCrowdBatch([{...row('a'),sentiment:NaN}],['a']));assert.throws(()=>validateCrowdBatch([{...row('a'),action:'comment',text:''}],['a']));assert.equal(validateCrowdBatch([row('a')],['a']).length,1);
// Exercise the real engine against an in-memory content store. One batch succeeds,
// another fails. Only successful evidence is committed; failed agents are retried.
const personas=Array.from({length:16},(_,i)=>({_id:'persona-'+String(i).padStart(10,'0'),handle:'test'+i,summary:'test persona'}));
let run={_id:'run-test',_rev:'1',status:'running',processed:0,personaCount:16,queue:personas.map(p=>({persona:{_ref:p._id},wave:1})),bodySnapshot:'Test post',post:{_id:'p',brand:{name:'Test'},platform:'x'}};
let docs=[];let fail=true;let modelCalls=0;
const client={fetch:async(q,args)=>q.includes('_id in')?personas.filter(p=>args.ids.includes(p._id)):run,transaction(){const added=[];let change={};const tx={create(d){added.push(d);return tx},patch(id,fn){const p={ifRevisionId(){return p},set(v){if(id===run._id)change={...change,...v};return p},setIfMissing(){return p},inc(){return p}};fn(p);return tx},async commit(){docs.push(...added);run={...run,...change,_rev:String(+run._rev+1)};return []}};return tx}};
const engine=load('engine',{'./sanity':{sanity:client,ref:id=>({_ref:id,_type:'reference'}),notDraft:'true'},'./gemini':{MODEL:'test',CROWD_MODEL:'test',geminiJSON:async({prompt})=>{modelCalls++;if(fail&&modelCalls===2)throw new Error('Quota exhausted');const ids=[...prompt.matchAll(/\[(\d{10})\]/g)].map(m=>m[1]);return {reactions:ids.map(row)}}},'./metrics':{EMOJI:['like','love','haha','wow','sad','angry']},'./workflowEngine':{transition:async()=>{}},'./crowdValidation':{validateCrowdBatch}});
let result=await engine.stepRun(run._id);assert.equal(result.paused,true);assert.equal(docs.length,8);assert.equal(run.queue.length,8);assert.equal(run.processed,8);assert.equal(run.status,'paused');
fail=false;result=await engine.stepRun(run._id);assert.equal(result.done,true);assert.equal(docs.length,16);assert.equal(new Set(docs.map(d=>d._id)).size,16);assert.equal(run.queue.length,0);assert.equal(modelCalls,3);
// Analyst outage: even a safe numerical score must not become a fabricated AI approval.
const evidence=[{_id:'r1',action:'react',emoji:'like',sentiment:1,likes:0,persona:{handle:'test'} }];
let aRun={_id:'analyst-test',_rev:'1',status:'running',queue:[],revision:1,bodySnapshot:'Test',post:{_id:'post-test',brand:{name:'QA'}}};let move='';
const aClient={fetch:async(q)=>q.includes('_type == "reaction"')?evidence:aRun,patch(){const patch={ifRevisionId(){return patch},set(x){aRun={...aRun,...x};return patch},async commit(){aRun._rev=String(+aRun._rev+1);return aRun}};return patch}};
const aEngine=load('engine',{'./sanity':{sanity:aClient,ref:id=>({_ref:id}),notDraft:'true'},'./gemini':{MODEL:'test',CROWD_MODEL:'test',geminiJSON:async()=>{throw Error('Model unavailable')}},'./metrics':load('metrics'),'./workflowEngine':{transition:async(_,t)=>{move=t}},'./crowdValidation':{validateCrowdBatch}});
await aEngine.finalizeRun('analyst-test');assert.equal(aRun.analysis.mode,'metrics_only');assert.equal(aRun.analysis.verdict,'review');assert.equal(aRun.analysis.suggestedRevision,'');assert.equal(move,'flag_risk');
console.log('PASS: missing key, auth, quota, bounded failover, invalid JSON, omitted/duplicated/invalid personas, partial-batch pause/resume, unique committed evidence, analyst metrics-only fallback without approval. No real API calls.');
})().catch(e=>{console.error(e);process.exit(1)});
