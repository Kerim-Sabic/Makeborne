/** Explicit local qualification helper, never imported by application code.
 * Real HTTP/queue/restricted SQL/native renderer; provider transport is offline. */
import {createRequire} from 'node:module';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdir,open,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {PgBoss} from 'pg-boss';
import {createGenerationQueueRuntime} from '../infra/generation-worker/queue-runtime.mjs';
import {publishGenerationOutbox,GENERATION_QUEUE} from '../infra/generation-worker/publish-outbox.mjs';
import {startGenerationWorker} from '../infra/generation-worker/consume-jobs.mjs';
const require=createRequire(import.meta.url);
// Reuse the existing offline TypeScript loader before importing worker modules.
require('../src/lib/generation/check-presentation-worker.cjs');
const {createGenerationExecutor}=require('../src/lib/generation/executor.ts');
const {createClaudePresentationWorker}=require('../src/lib/generation/presentation-worker.ts');
const {GenerationProgressSchema}=require('../src/lib/generation/submission-contract.ts');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){const end=Date.now()+15000;for(;;){const value=await check();if(value)return value;assert(Date.now()<end,'NATIVE_EXECUTION_WAIT_EXPIRED');await pause(75);}}

export async function qualifyNativeExecution({db,url,scope,actor,reviewer,prepared,native,api}){
 assert.equal(process.env.MAKEBORNE_VERIFY_LOCAL_JOBS,'true');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55322');
 const schema='makeborne_queue_probe_'+randomBytes(6).toString('hex'),logins=[],pools=[];
 let adminBoss,pubBoss,workBoss,consumer,jobId,baseline,queueCreated=false,stage='preflight';
 async function progress(response,status=200){const body=await response.json();assert.equal(response.status,status,'NATIVE_HTTP_STATUS_'+response.status+'_'+body.error?.code);assert.match(response.headers.get('cache-control')??'',/no-store/);return status>=200&&status<300?GenerationProgressSchema.parse(body.job):body;}
 async function restricted(kind){const role='makeborne_generation_'+kind,name='makeborne_'+kind+'_probe_'+randomBytes(6).toString('hex'),password=randomBytes(32).toString('hex');
  await db.query(`create role "${name}" login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '${password}'`);logins.push(name);
  await db.query(`grant ${role} to "${name}" with set true`);await db.query(`grant ${role} to "${name}" with inherit false`);
  const target=new URL(url);target.username=name;target.password=password;const pool=new Pool({connectionString:target.href,max:3,connectionTimeoutMillis:2000,query_timeout:6000,options:`-c role=${role} -c statement_timeout=5000 -c lock_timeout=2000`});pool.on('error',()=>{});pools.push(pool);return pool;
 }
 try{
  // A global publisher must not pick up unrelated queued work during a fixture.
  assert.equal((await db.query("select count(*)::int n from makeborne_private.generation_job_outbox e join public.generation_jobs j on j.id=e.job_id where e.kind='queued' and e.published_at is null and j.status in ('queued','running') and j.cancel_requested_at is null and not exists(select 1 from makeborne_private.generation_provider_outcomes o where o.job_id=j.id)")).rows[0].n,0,'UNRELATED_QUEUED_WORK_PRESENT');
  baseline=(await db.query("select * from makeborne_private.generation_execution_caps where scope in ('global','anthropic') order by scope")).rows;assert.equal(baseline.length,2);assert(baseline.every(c=>!c.enabled&&c.active_dispatches===0&&c.vendor_reserved==='0'));
  assert(native.route.price.lines.every(line=>line.vendorMicrousd==='0'),'OFFLINE_VENDOR_TARIFF_REQUIRED');
  await db.query('insert into makeborne_private.generation_budgets(workspace_id,spending_enabled,vendor_limit,credit_limit,concurrency_limit) values($1,true,0,100000,1)',[scope.workspaceId]);
  stage='submission';const body={proposalId:prepared.proposalId,approvalHash:prepared.approvalHash,inputHash:prepared.inputHash,processingConsent:true,externalProcessingConsent:true,sourceRightsConfirmed:true},key=randomUUID();
  const [a,b]=await Promise.all([api(actor,'POST','/api/generate',body,key).then(async r=>{const value=await progress(r,202);jobId=value.id;return value;}),api(actor,'POST','/api/generate',body,key).then(async r=>{const value=await progress(r,202);jobId=value.id;return value;})]);assert.equal(a.id,b.id);assert.equal(a.state,'queued');jobId=a.id;
  const recovered=await progress(await api(actor,'GET',`/api/generate/requests/${key}?proposalId=${prepared.proposalId}`));assert.equal(recovered.id,jobId);
  stage='queue';const publisher=await restricted('publisher'),worker=await restricted('worker');
  adminBoss=new PgBoss({connectionString:url.href,schema,supervise:false,schedule:false,registerInstance:false});adminBoss.on('error',()=>{});queueCreated=true;await adminBoss.start();await adminBoss.createQueue(GENERATION_QUEUE,{retryLimit:3,retryDelay:1,expireInSeconds:120});
  await db.query(`grant usage on schema "${schema}" to makeborne_generation_publisher,makeborne_generation_worker;
   grant select on "${schema}".version,"${schema}".queue to makeborne_generation_publisher,makeborne_generation_worker;
   grant select,insert on "${schema}".job,"${schema}".job_common to makeborne_generation_publisher;
   grant select,insert,update,delete on "${schema}".job,"${schema}".job_common to makeborne_generation_worker`);
  pubBoss=await createGenerationQueueRuntime({pool:publisher,schema,role:'makeborne_generation_publisher'});workBoss=await createGenerationQueueRuntime({pool:worker,schema,role:'makeborne_generation_worker'});
  for(const sql of ['select * from public.artifact_versions','select * from makeborne_private.generation_proposals','select makeborne_private.settle_generation_job(null,null,0,true,null)'])await assert.rejects(worker.query(sql),e=>e.code==='42501');
  await db.query("update makeborne_private.generation_execution_caps set enabled=true,emergency_stop=false,vendor_limit=vendor_spent+1000000,concurrency_limit=1 where scope in ('global','anthropic')");
  const client=await publisher.connect();let published;try{published=await publishGenerationOutbox(pubBoss,client);}finally{client.release();}assert.equal(published.jobId,jobId);
  let calls=0,result;
  const execute=createGenerationExecutor({presentationComposition:createClaudePresentationWorker(native.config,{configurationRef:'offline-only',sql:worker,
   provider:{spendingAllowed:()=>true,countInputTokens:async()=>40,fetch:async(...args)=>{calls++;const response=await native.deps.provider.fetch(...args),headers=new Headers(response.headers);headers.set('request-id','req_fixture_'+jobId);return new Response(response.body,{status:response.status,headers});}},
   resolveAssets:async(_lease,input)=>{
    // This fixture has no artwork. This is not a production artwork resolver.
    assert.equal(input.style.referenceAssetIds.length,0);assert(input.content.sections.every(s=>s.blocks.every(b=>!b.assetId)));return {descriptors:[],artwork:[]};
   },retainEvidence:async({dispatchId,metered})=>{
    const root=resolve('.env.native-worker-qualification',jobId,'usage');await mkdir(root,{recursive:true});const file=join(root,dispatchId+'.json'),handle=await open(file,'wx',0o600);try{await handle.writeFile(metered.bytes);await handle.sync();}finally{await handle.close();}
    const hash=createHash('sha256').update(await readFile(file)).digest('hex');assert.equal(hash,metered.evidenceHash);return {sha256:hash};
   }})});
  stage='consumer';consumer=await startGenerationWorker({boss:workBoss,pool:worker,leaseSeconds:15,heartbeatMs:1000,maxRuntimeMs:30000,execute:async(lease,signal)=>{assert.equal(lease.jobId,jobId);try{result=await execute(lease,signal);return result;}catch(error){console.error('Native fixture executor failed:',/^[A-Z0-9_]{1,100}$/.test(error.code??'')?error.code:'UNCONFIRMED',/^[a-z0-9_]{1,100}$/.test(error.constraint??'')?error.constraint:'');throw error;}}});
  const queue=await until(async()=>{const row=(await db.query(`select state from "${schema}".job where id=$1`,[published.eventId])).rows[0];return row?.state==='completed'?row:null;});assert(queue);assert.equal(result.state,'visual_review_required');assert.equal(calls,1);
  stage='saved output';const current=await progress(await api(actor,'GET',`/api/generate/${jobId}`));assert.equal(current.state,'awaiting_review');assert.equal(current.outputVersionId,result.versionId);assert.equal(current.credits.charged,'0');
  const reviewerProgress=await progress(await api(reviewer,'GET',`/api/generate/${jobId}`));assert.equal(reviewerProgress.credits,null);assert.equal(reviewerProgress.canCancel,false);
  const saved=data(await actor.client.from('artifact_versions').select('content,style_snapshot,parent_version_id,version_number').eq('id',result.versionId).single());assert.deepEqual(saved.content,native.input.content);assert.deepEqual(saved.style_snapshot,native.input.style);assert.equal(saved.version_number,2);
  assert.equal(saved.parent_version_id,(await db.query('select base_version_id from makeborne_private.generation_proposals where id=$1',[prepared.proposalId])).rows[0].base_version_id);
  assert.equal((await db.query('select count(*)::int n from makeborne_private.project_builds where job_id=$1',[jobId])).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from makeborne_private.generation_provider_outcomes where job_id=$1',[jobId])).rows[0].n,1);
  // Redelivery reaches the original SQL review receipt, never the model again.
  await db.query(`update "${schema}".job set state='retry',start_after=clock_timestamp() where id=$1`,[published.eventId]);await until(async()=>(await db.query(`select state from "${schema}".job where id=$1`,[published.eventId])).rows[0]?.state==='completed');assert.equal(calls,1);
  console.log('PASS actual native HTTP submission/recovery -> restricted outbox/pg-boss consumer -> offline SDK/real renderer -> editable revision2/evidence/outcome -> awaiting-review HTTP; redelivery never redispatches, reviewer finance hidden');
 }catch(error){if(error.code==='ERR_ASSERTION')console.error('Native fixture assertion:',String(error.message).slice(0,200));throw Object.assign(new Error('NATIVE_EXECUTION_QUALIFICATION_FAILED'),{code:'NATIVE_EXECUTION_'+stage.toUpperCase().replace(/[^A-Z]/g,'_'),cause:error});}
 finally{
  await consumer?.stop();for(const boss of [workBoss,pubBoss,adminBoss])await boss?.stop({graceful:false});
  // Submission may commit before its HTTP response is lost. Recover only the
  // job bound to this exact synthetic proposal before releasing unused holds.
  if(!jobId){const owned=(await db.query('select j.id from public.generation_jobs j join makeborne_private.generation_reservations r on r.id=j.reservation_id where r.proposal_id=$1 and j.workspace_id=$2',[prepared.proposalId,scope.workspaceId])).rows;assert(owned.length<=1);jobId=owned[0]?.id;}
  if(jobId){const row=(await db.query('select * from public.generation_jobs where id=$1',[jobId])).rows[0],outcome=(await db.query('select * from makeborne_private.generation_provider_outcomes where job_id=$1',[jobId])).rows[0];
   if(outcome)await db.query('select makeborne_private.settle_generation_job($1,$2,$3,false,$4)',[jobId,actor.id,row.run_revision,outcome.evidence_hash]);
   else {const hold=(await db.query('select * from makeborne_private.generation_execution_holds where job_id=$1',[jobId])).rows[0];if(hold){await db.query("select makeborne_private.record_generation_outcome_core($1,$2,false,0,$3,$4,$5,$6,$7,null)",[jobId,hold.dispatch_id,hold.provider,hold.model,hold.tariff_version,'offline-fixture-cleanup-'+jobId,'e'.repeat(64)]);const latest=(await db.query('select run_revision from public.generation_jobs where id=$1',[jobId])).rows[0];await db.query('select makeborne_private.settle_generation_job($1,$2,$3,false,$4)',[jobId,actor.id,latest.run_revision,'e'.repeat(64)]);}else await db.query("select makeborne_private.cancel_generation_job($1,$2,'Unused native fixture cleanup')",[jobId,actor.id]);}
  }
  await db.query('update makeborne_private.generation_budgets set spending_enabled=false,emergency_stop=true where workspace_id=$1',[scope.workspaceId]);
  for(const cap of baseline??[]){const current=(await db.query('select vendor_spent,vendor_reserved,active_dispatches from makeborne_private.generation_execution_caps where scope=$1',[cap.scope])).rows[0];assert.equal(current.vendor_spent,cap.vendor_spent);assert.equal(current.vendor_reserved,cap.vendor_reserved);assert.equal(current.active_dispatches,cap.active_dispatches);await db.query('update makeborne_private.generation_execution_caps set enabled=$2,emergency_stop=$3,vendor_limit=$4,concurrency_limit=$5 where scope=$1',[cap.scope,cap.enabled,cap.emergency_stop,cap.vendor_limit,cap.concurrency_limit]);}
  if(queueCreated){assert.match(schema,/^makeborne_queue_probe_[a-f0-9]{12}$/);await db.query(`drop schema "${schema}" cascade`);}
  for(const pool of pools)await pool.end();for(const name of logins){assert.match(name,/^makeborne_(?:publisher|worker)_probe_[a-f0-9]{12}$/);await db.query(`drop role "${name}"`);}
  console.log('PASS native fixture settled without customer debit; caps restored, queue/logins removed, private zero-cost evidence retained');
 }
}
function data(result){if(result.error||!result.data)throw Object.assign(Error('SAVED_NATIVE_OUTPUT_UNCONFIRMED'),{code:result.error?.code});return result.data;}
