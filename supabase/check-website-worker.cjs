/* eslint-disable @typescript-eslint/no-require-imports -- Explicit local integration fixture; no paid provider import/transport. */
const {fixtures,response,createClaudeWebsiteWorker}=require('../src/lib/generation/check-website-worker.cjs');
const {generationProposalRecord}=require('../src/lib/routing/proposal.ts');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {Client}=require('pg'),{randomUUID,randomBytes,createHash}=require('node:crypto');
if(process.env.MAKEBORNE_VERIFY_LOCAL_JOBS!=='true'||process.env.MAKEBORNE_VERIFY_LOCAL_RUNTIME!=='true'||!process.env.MAKEBORNE_LOCAL_STATUS_FILE){console.log('NOT RUN: explicit local job/runtime opt-in and ignored configuration required.');process.exit(2);}
let admin,worker,baseline,created=false,loginCreated=false,stage='configuration',workspace,owner,session,project,source;
const jobs=[],name=`makeborne_executor_probe_${randomUUID().replaceAll('-','').slice(0,12)}`,password=randomBytes(32).toString('hex');
const evidenceDirectory=path.resolve(process.env.MAKEBORNE_WORKER_EVIDENCE_DIRECTORY||'docs/execution/evidence/M03-T01-R06');
async function main(){
 const config=JSON.parse((await fs.readFile(process.env.MAKEBORNE_LOCAL_STATUS_FILE,'utf8')).replace(/^\uFEFF/,''));
 const url=new URL(config.DB_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55322');assert.equal(url.pathname,'/postgres');
 admin=new Client({connectionString:url.href,connectionTimeoutMillis:2000,query_timeout:5000});admin.on('error',()=>{});await admin.connect();
 baseline=(await admin.query("select scope,enabled,emergency_stop,vendor_limit,concurrency_limit,vendor_spent,vendor_reserved,active_dispatches from makeborne_private.generation_execution_caps where scope in ('global','anthropic')")).rows;assert(baseline.every(cap=>!cap.enabled&&cap.vendor_reserved==='0'&&cap.active_dispatches===0),'LOCAL_CAPS_MUST_START_DISABLED_WITH_NO_ACTIVE_DISPATCH');
 workspace=randomUUID();owner=randomUUID();session=randomUUID();project=randomUUID();source=randomUUID();stage='setup';
 await admin.query('begin');
 await admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",[owner,`executor-${owner}@example.invalid`]);
 await admin.query('insert into auth.sessions(id,user_id,created_at,updated_at) values($1,$2,now(),now())',[session,owner]);
 await admin.query("insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values($1,true,false,'Local zero-cost executor fixture')",[owner]);
 await admin.query("insert into public.workspaces(id,name,owner_id) values($1,'Local zero-cost executor fixture',$2)",[workspace,owner]);
 await admin.query("insert into public.projects(id,workspace_id,title,kind) values($1,$2,'Executor fixture','website')",[project,workspace]);
 await admin.query("insert into public.sources(id,workspace_id,project_id,title,kind,content,approved) values($1,$2,$3,'Approved brief','text','Original approved studio material.',true)",[source,workspace,project]);
 await admin.query('insert into makeborne_private.generation_budgets(workspace_id,spending_enabled,vendor_limit,credit_limit,concurrency_limit) values($1,true,100,100,10)',[workspace]);
 // A real paid qualification may already be in this local ledger. Preserve its
 // spend and allow only the existing fixture's additional 100 micro-USD.
 await admin.query("update makeborne_private.generation_execution_caps set enabled=true,emergency_stop=false,vendor_limit=vendor_spent+vendor_reserved+100,concurrency_limit=10 where scope in ('global','anthropic')");
 await admin.query('commit');created=true;
 await admin.query(`create role "${name}" login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '${password}'`);loginCreated=true;
 await admin.query(`grant makeborne_generation_worker to "${name}"`);
 const target=new URL(url);target.username=name;target.password=password;
 worker=new Client({connectionString:target.href,connectionTimeoutMillis:2000,query_timeout:5000,options:'-c role=makeborne_generation_worker'});worker.on('error',()=>{});await worker.connect();
 const {assertGenerationRole}=await import('../infra/generation-worker/queue-runtime.mjs');await assertGenerationRole(worker,'makeborne_generation_worker');
 await fs.mkdir(path.join(evidenceDirectory,'receipts'),{recursive:true});
 for(const mode of ['success','invalid_source','transport_unknown','evidence_unconfirmed','source_changed']){
   stage=mode;const artifact=randomUUID();await admin.query("insert into public.artifacts(id,workspace_id,project_id,title,kind) values($1,$2,$3,'Executor fixture','website')",[artifact,workspace,project]);
   const f=fixtures({workspaceId:workspace,projectId:project,artifactId:artifact},source);
   const p=generationProposalRecord(f.lease.approvedInput.proposal,new Date().toISOString()),proposalId=randomUUID();
   await admin.query('insert into makeborne_private.generation_proposals(id,workspace_id,project_id,artifact_id,base_version_id,input_hash,approval_hash,snapshot,maximum_vendor_microusd,maximum_customer_credits,prepared_at,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[proposalId,p.workspace_id,p.project_id,p.artifact_id,p.base_version_id,p.input_hash,p.approval_hash,p.snapshot,p.maximum_vendor_microusd,p.maximum_customer_credits,p.prepared_at,p.expires_at]);
   stage=`${mode}/authorize`;let job=(await admin.query('select (makeborne_private.authorize_and_enqueue_generation_job($1,$2,$3,$4,$5,$6,$7,$8,true,true,true)).*',[proposalId,randomUUID(),owner,p.approval_hash,p.input_hash,f.lease.deadlineAt,session,f.lease.approvedInput.authorizationExpiresAt])).rows[0];
   stage=`${mode}/lease`;job=(await admin.query('select (makeborne_private.acquire_generation_job_lease($1,$2,120)).*',[job.id,f.lease.workerId])).rows[0];jobs.push(job.id);
   stage=`${mode}/approved-input`;const input=(await worker.query('select makeborne_private.load_generation_worker_input($1,$2,$3) as input',[job.id,f.lease.workerId,job.fence])).rows[0].input;
   const lease={...f.lease,jobId:job.id,fence:job.fence.toString(),approvedInput:input};
   let calls=0;
   const execute=createClaudeWebsiteWorker(f.config,{configurationRef:'offline-only',sql:{query:async(text,args)=>{stage=`${mode}/sql-${text.split('makeborne_private.')[1]?.split('(')[0]}`;return worker.query(text,args);}},provider:{spendingAllowed:()=>true,countInputTokens:async()=>40,fetch:async(url,options)=>{
     calls++;assert.equal(String(url),'https://api.anthropic.com/v1/messages');assert.equal(options.redirect,'error');
     if(mode==='transport_unknown')throw Error('Synthetic offline transport uncertainty; no real network used');
     const output=structuredClone(f.output);if(mode==='invalid_source')output.files.push({path:'../escape',content:'invalid'});
     if(mode==='source_changed')await admin.query("update public.sources set content='Changed after synthetic response' where id=$1",[source]);
     return new Response(JSON.stringify(response(output,f.config.model,job.id.replaceAll('-',''))),{headers:{'content-type':'application/json','request-id':`req_${job.id.replaceAll('-','')}`}});
   }},resolveAssets:async()=>({descriptors:[],artwork:[]}),retainEvidence:async({dispatchId,metered})=>{
     if(mode==='evidence_unconfirmed')return {sha256:'0'.repeat(64)};
     const file=path.join(evidenceDirectory,'receipts',`${dispatchId}.json`);await fs.writeFile(file,metered.bytes,{flag:'wx'});
     return {sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')};
   }});
   if(mode==='success'){
     const result=await execute(lease,new AbortController().signal);assert.equal(result.state,'build_queued');assert.equal(result.readyForPublication,false);
     const stored=(await admin.query('select content from public.artifact_versions where id=$1',[result.versionId])).rows[0].content;assert.deepEqual(stored.reviewQuestions,f.output.questions);assert(stored.websiteSource&&!stored.website);assert.equal(stored.websiteSource.designDirection.palette,f.output.design.palette);
     for(const questions of [null,{},[42],[''],['x'.repeat(1001)],Array(21).fill('Question')])await assert.rejects(admin.query("insert into public.artifact_versions(workspace_id,artifact_id,version_number,parent_version_id,content,style_snapshot,asset_manifest,change_summary,created_by) select workspace_id,artifact_id,2,id,jsonb_set(content,'{reviewQuestions}',$2::jsonb),style_snapshot,asset_manifest,'Invalid question fixture',created_by from public.artifact_versions where id=$1",[result.versionId,JSON.stringify(questions)]),e=>e.code==='22023');
     console.log('PASS independent database guard rejects malformed, empty, oversized and over-count review questions without extra versions');
     await require('./check-project-build.cjs').qualifyBuild({admin,url,job,lease,result,owner,evidenceDirectory});
     console.log('PASS actual restricted LOGIN: approved proposal → mocked Claude adapter → durable local evidence → atomic canonical source/usage → scoped readback → actual isolated Docker build; questions retained, no publish/debit');
   }else if(mode==='invalid_source'){
     assert.equal((await execute(lease,new AbortController().signal)).state,'attempt_failed');assert.equal((await admin.query('select count(*)::int as n from makeborne_private.generation_provider_outcomes where job_id=$1 and not succeeded',[job.id])).rows[0].n,1);
     assert.equal((await admin.query('select count(*)::int as n from public.artifact_versions where artifact_id=$1',[artifact])).rows[0].n,0);
     console.log('PASS invalid generated source preserves known provider evidence/cost without a saved version or build');
   }else{
     await assert.rejects(execute(lease,new AbortController().signal),e=>mode==='transport_unknown'?e.code==='WEBSITE_WORKER_USAGE_UNCONFIRMED':mode==='evidence_unconfirmed'?e.code==='WEBSITE_WORKER_EVIDENCE_UNCONFIRMED':e.code==='PT409');
     assert.equal((await admin.query('select count(*)::int as n from makeborne_private.generation_provider_outcomes where job_id=$1',[job.id])).rows[0].n,0);
     assert.equal((await admin.query('select count(*)::int as n from public.artifact_versions where artifact_id=$1',[artifact])).rows[0].n,0);
     assert.equal((await admin.query('select status from makeborne_private.generation_reservations where id=$1',[job.reservation_id])).rows[0].status,'uncertain');
     assert.equal((await admin.query('select count(*)::int as n from makeborne_private.generation_execution_holds where job_id=$1',[job.id])).rows[0].n,1);
     console.log(`PASS ${mode}: no partial result/cost, no build; unknown cap/accounting hold retained for reconciliation`);
   }
   assert.equal(calls,1);
   await admin.query("update public.sources set content='Original approved studio material.' where id=$1",[source]);
 }
 assert.equal((await admin.query("select to_regprocedure('makeborne_private.load_generation_worker_result(uuid,uuid,bigint,uuid)') value")).rows[0].value,null);
 const migration=await fs.readFile('supabase/migrations/20261008155402_generation_worker_result_readback.sql','utf8');
 let definitions=0;
 for(const match of migration.matchAll(/create function makeborne_private\.([a-z_]+)\([\s\S]*?as \$\$([\s\S]*?)\$\$;/g)){
   if(match[1]==='load_generation_worker_result')continue;
   const rows=(await admin.query("select prosrc,proconfig,prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='makeborne_private' and p.proname=$1",[match[1]])).rows;
   assert.equal(rows.length,1);assert.equal(rows[0].prosrc.trim(),match[2].trim());assert.deepEqual(rows[0].proconfig,['search_path=""']);assert.equal(rows[0].prosecdef,match[1]==='load_generation_worker_result');definitions++;
 }
 assert.equal(definitions,1);
 for(const role of ['anon','authenticated','service_role','makeborne_generation_worker','makeborne_generation_publisher'])assert.equal((await admin.query("select has_function_privilege($1,'makeborne_private.validate_artifact_review_questions()','execute') as allowed",[role])).rows[0].allowed,false);
 console.log(`PASS canonical question guard and retired immediate result-loader grant; local workspace ${workspace}; all five fixtures used synthetic zero-cost transport`);
}
main().catch(error=>{console.error(`LOCAL EXECUTOR FAILED at ${stage}: ${typeof error?.code==='string'?error.code:'ASSERTION_OR_CONFIGURATION'}; sensitive driver/configuration details omitted.`);process.exitCode=1;}).finally(async()=>{
 await admin?.query('rollback').catch(()=>{});await worker?.end();
 if(created){try{
   for(const id of jobs){let row=(await admin.query('select * from public.generation_jobs where id=$1',[id])).rows[0];
     const existing=(await admin.query('select id from makeborne_private.generation_provider_outcomes where job_id=$1',[id])).rows[0];
     if(!existing){const dispatch=(await admin.query('select id from makeborne_private.generation_dispatches where reservation_id=$1',[row.reservation_id])).rows[0];
       if(dispatch)await admin.query("select makeborne_private.record_generation_outcome_core($1,$2,false,0,'anthropic','claude-opus-5-5','offline-zero-v1',$3,$4,null)",[id,dispatch.id,`local-cleanup-${id}`,'e'.repeat(64)]);
       else{await admin.query("select makeborne_private.cancel_generation_job($1,$2,'Unused local fixture cleanup')",[id,owner]);continue;}}
     row=(await admin.query('select run_revision from public.generation_jobs where id=$1',[id])).rows[0];await admin.query('select makeborne_private.settle_generation_job($1,$2,$3,false,$4)',[id,owner,row.run_revision,'f'.repeat(64)]);
   }
   await admin.query('update makeborne_private.generation_budgets set spending_enabled=false,emergency_stop=true where workspace_id=$1',[workspace]);
   await admin.query('delete from auth.sessions where id=$1',[session]);await admin.query('delete from makeborne_private.account_privileges where user_id=$1',[owner]);
   for(const cap of baseline)await admin.query('update makeborne_private.generation_execution_caps set enabled=$2,emergency_stop=$3,vendor_limit=$4,concurrency_limit=$5 where scope=$1',[cap.scope,cap.enabled,cap.emergency_stop,cap.vendor_limit,cap.concurrency_limit]);
   for(const cap of baseline){const current=(await admin.query('select vendor_spent,vendor_reserved,active_dispatches from makeborne_private.generation_execution_caps where scope=$1',[cap.scope])).rows[0];assert.deepEqual(current,{vendor_spent:cap.vendor_spent,vendor_reserved:cap.vendor_reserved,active_dispatches:cap.active_dispatches});}
   console.log('PASS explicit offline-only known-zero operator cleanup; fixture holds settled without customer charge, budget stopped, session/grant removed and original cap policies restored');
 }catch{console.error('FAIL local executor fixture cleanup requires review');process.exitCode=1;}}
 if(loginCreated){try{await admin.query(`drop role "${name}"`);console.log('PASS ephemeral restricted executor LOGIN removed');}catch{console.error('FAIL temporary executor LOGIN cleanup requires review');process.exitCode=1;}}
 await admin?.end();
});
