/* eslint-disable @typescript-eslint/no-require-imports -- Rolled-back local database contract qualification only. */
const fs=require('node:fs/promises'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Client}=require('pg');
const {fixtures,response}=require('../src/lib/generation/check-website-worker.cjs');
const {prepareWebsiteQualification,CLAUDE_QUALIFICATION_ROUND:round}=require('../src/lib/generation/qualification-proposal.ts');
const {createClaudeWebsiteQualificationWorker}=require('../src/lib/generation/website-worker.ts');
const {generationProposalRecord}=require('../src/lib/routing/proposal.ts');
const {canonicalSourceJson}=require('../src/lib/projects/canonical-json.ts');
if(process.env.MAKEBORNE_VERIFY_LOCAL_JOBS!=='true'||!process.env.MAKEBORNE_LOCAL_STATUS_FILE){console.log('NOT RUN: explicit local database opt-in required.');process.exit(2);}
let stage="configuration";
async function main(){const c=JSON.parse((await fs.readFile(process.env.MAKEBORNE_LOCAL_STATUS_FILE,'utf8')).replace(/^\uFEFF/,''));const u=new URL(c.DB_URL);assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'55322');assert.equal(u.pathname,'/postgres');const db=new Client({connectionString:u.href,query_timeout:5000});await db.connect();
 let begun=false;try{const baseline=(await db.query('select scope,enabled,vendor_limit,vendor_spent,vendor_reserved,active_dispatches from makeborne_private.generation_execution_caps order by scope')).rows;
 assert(baseline.every(x=>!x.enabled));await db.query('begin');begun=true;
 const migration=await fs.readFile('supabase/migrations/20261008200855_operator_website_qualification_proposal.sql','utf8');
 await db.query(migration.replace(/^begin;\s*/,'').replace(/commit;\s*$/,''));
 stage='setup';const owner=randomUUID(),workspace=randomUUID(),project=randomUUID(),artifact=randomUUID(),session=randomUUID();
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[owner,`qualification-${owner}@example.invalid`]);
 await db.query('insert into auth.sessions(id,user_id,created_at,updated_at) values($1,$2,now(),now())',[session,owner]);
 await db.query("insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values($1,true,false,'Rolled-back operator qualification contract')",[owner]);
 await db.query("insert into public.workspaces(id,name,owner_id) values($1,'Rolled-back qualification',$2)",[workspace,owner]);
 await db.query("insert into public.projects(id,workspace_id,title,kind) values($1,$2,'Qualification','website')",[project,workspace]);
 await db.query("insert into public.artifacts(id,workspace_id,project_id,title,kind) values($1,$2,$3,'Qualification','website')",[artifact,workspace,project]);
 await db.query('insert into makeborne_private.generation_budgets(workspace_id,spending_enabled,vendor_limit,credit_limit,concurrency_limit) values($1,true,$2,0,1)',[workspace,round.maximumVendorMicrousd]);
 await db.query("update makeborne_private.generation_execution_caps set enabled=true,emergency_stop=false,vendor_limit=$1,concurrency_limit=1 where scope in ('global','anthropic')",[round.maximumVendorMicrousd]);
 stage='proposal';const f=fixtures({workspaceId:workspace,projectId:project,artifactId:artifact}),now=new Date().toISOString();
 const p=prepareWebsiteQualification(f.lease.approvedInput.proposal.input,{now,effort:'high',processingConsent:true,externalProcessingConsent:true,sourceRightsConfirmed:true});
 const record=generationProposalRecord(p,now),proposalId=randomUUID();
 async function insertProposal(snapshot,id=proposalId){return db.query('insert into makeborne_private.generation_proposals(id,workspace_id,project_id,artifact_id,base_version_id,input_hash,approval_hash,snapshot,maximum_vendor_microusd,maximum_customer_credits,prepared_at,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[id,workspace,project,artifact,null,record.input_hash,record.approval_hash,snapshot,record.maximum_vendor_microusd,'0',record.prepared_at,record.expires_at]);}
 for(const mutate of [p=>delete p.purpose,p=>p.purpose='customer',p=>delete p.qualificationRound,p=>p.workflow.stages[0].route.evaluation={evidenceId:'invented',quality:100},p=>p.workflow.maximumExecutions=2,p=>p.workflow.stages[0].maximumExecutions=2,p=>p.workflow.stages[0].request.maximumAttempts=2]){
  const invalid=structuredClone(p);mutate(invalid);await db.query('savepoint invalid_qualification');
  await assert.rejects(insertProposal(invalid,randomUUID()),error=>error.code==='23514');await db.query('rollback to savepoint invalid_qualification');await db.query('release savepoint invalid_qualification');
 }
 await insertProposal(p);
 console.log('PASS database refuses one-stage customer/unknown purpose, missing round, invented evaluation and extra executions/attempts');
 const deadline=new Date(Date.now()+240000).toISOString();
 stage='authorization';const job=(await db.query('select (makeborne_private.authorize_and_enqueue_generation_job($1,$2,$3,$4,$5,$6,$7,$8,true,true,true)).*',[proposalId,randomUUID(),owner,p.approvalHash,p.inputHash,deadline,session,deadline])).rows[0];
 const budget=(await db.query('select vendor_limit,vendor_reserved,credit_reserved from makeborne_private.generation_budgets where workspace_id=$1',[workspace])).rows[0];assert.equal(budget.vendor_limit,'25000000');assert.equal(budget.vendor_reserved,'544000');assert.equal(budget.credit_reserved,'0');
 console.log('PASS existing SQL proposal/authorization/reservation binds operator purpose and unmeasured model; exact $25 round, $0.544 worst-case hold, zero customer credits');
 stage='lease';const workerId=randomUUID(),leased=(await db.query('select (makeborne_private.acquire_generation_job_lease($1,$2,120)).*',[job.id,workerId])).rows[0];
 await db.query('set local role makeborne_generation_worker');
 const approvedInput=(await db.query('select makeborne_private.load_generation_worker_input($1,$2,$3) input',[job.id,workerId,leased.fence])).rows[0].input;
 assert.equal(approvedInput.proposal.purpose,'operator_qualification');assert.equal(approvedInput.proposal.workflow.stages[0].route.evaluation,null);
 let dispatchId,metered,calls=0;
 const executor=createClaudeWebsiteQualificationWorker({...f.config,model:round.model,maximumInputTokens:round.maximumInputTokens,maximumOutputTokens:round.maximumOutputTokens},{configurationRef:round.configurationRef,
 sql:{query:async(sql,args)=>{stage=sql.includes('claim_capped')?'worker-claim':'worker-save';const result=await db.query(sql,args);if(sql.includes('claim_capped_generation_dispatch'))dispatchId=result.rows[0].claim.dispatchId;return result;}},
 provider:{spendingAllowed:()=>true,countInputTokens:async()=>40,fetch:async(url,options)=>{calls++;assert.equal(String(url),'https://api.anthropic.com/v1/messages');assert.equal(JSON.parse(options.body).output_config.effort,'high');const invalid=structuredClone(f.output);invalid.files.push({path:'../escape',content:'invalid'});return new Response(JSON.stringify(response(invalid,round.model)),{headers:{'content-type':'application/json','request-id':'req_operator_offline'}});}},
 resolveAssets:async()=>({descriptors:[],artwork:[]}),retainEvidence:async(input)=>{metered=input.metered;return {sha256:metered.evidenceHash};}});
 stage='worker';const result=await executor({jobId:job.id,workspaceId:workspace,workerId,fence:String(leased.fence),deadlineAt:deadline,approvedInput},new AbortController().signal);assert.equal(result.state,'attempt_failed');assert.equal(calls,1);assert.equal(metered.actualVendorMicrousd,'560');
 await db.query('reset role');
 const caps=(await db.query("select scope,vendor_reserved,vendor_spent,active_dispatches from makeborne_private.generation_execution_caps where scope in ('global','anthropic') order by scope")).rows;
 assert(caps.every(x=>x.vendor_reserved==='544000'&&x.active_dispatches===1));
 assert.equal((await db.query('select dispatch_id from makeborne_private.generation_execution_holds where job_id=$1',[job.id])).rows[0].dispatch_id,dispatchId);
 assert.equal((await db.query('select amount_microusd from public.usage_ledger where job_id=$1 and reason=$2',[job.id,'provider_cost'])).rows[0].amount_microusd,'560');
 assert.equal((await db.query('select count(*)::int n from public.artifact_versions where artifact_id=$1',[artifact])).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from makeborne_private.project_builds where job_id=$1',[job.id])).rows[0].n,0);
 console.log('PASS original worker-role capped claim and exact synthetic incurred usage; invalid source retains cost without a saved version, build, fabricated quality or publication');
 stage='settlement';const revision=(await db.query('select run_revision from public.generation_jobs where id=$1',[job.id])).rows[0].run_revision;
 await db.query('select makeborne_private.settle_generation_job($1,$2,$3,false,$4)',[job.id,owner,revision,metered.evidenceHash]);
 const settled=(await db.query('select vendor_spent,vendor_reserved,credit_spent,active_reservations from makeborne_private.generation_budgets where workspace_id=$1',[workspace])).rows[0];assert.deepEqual(settled,{vendor_spent:'560',vendor_reserved:'0',credit_spent:'0',active_reservations:0});
 const closed=(await db.query("select vendor_reserved,active_dispatches,vendor_spent from makeborne_private.generation_execution_caps where scope in ('global','anthropic')")).rows;assert(closed.every(x=>x.vendor_reserved==='0'&&x.active_dispatches===0));
 console.log('PASS original nonacceptance settlement preserves provider cost, releases unused hold once and charges zero customer credits');
 stage='rollback';await db.query('rollback');begun=false;const after=(await db.query('select scope,enabled,vendor_limit,vendor_spent,vendor_reserved,active_dispatches from makeborne_private.generation_execution_caps order by scope')).rows;assert.equal(canonicalSourceJson(after),canonicalSourceJson(baseline));assert.equal((await db.query('select count(*)::int n from public.workspaces where id=$1',[workspace])).rows[0].n,0);
 console.log('PASS full transaction rolled back; cap counters/policies unchanged; no retained fixture or paid request. This is SQL contract evidence, not committed live dispatch or restricted LOGIN qualification.');
 }finally{if(begun)await db.query('rollback');await db.end();}}
main().catch(error=>{console.error(`LOCAL QUALIFICATION FAILED at ${stage}: ${/^[A-Z0-9_]{1,80}$/.test(error?.code)?error.code:'ASSERTION_OR_CONFIGURATION'}; private diagnostics withheld.`);process.exitCode=1});
