/* eslint-disable @typescript-eslint/no-require-imports -- Actual local SQL, synthetic trusted policies, no provider calls. */
const fs=require('node:fs'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Client}=require('pg');
const {harness}=require('../src/lib/generation/check-presentation-worker.cjs');
const {fixtures}=require('../src/lib/generation/check-website-worker.cjs');
const {prepareSavedPresentationProposal}=require('../src/lib/generation/prepare-saved-presentation.ts');
const {prepareSavedWebsiteProposal}=require('../src/lib/generation/prepare-saved-website.ts');
if(process.env.MAKEBORNE_VERIFY_LOCAL_JOBS!=='true'||!process.env.MAKEBORNE_LOCAL_STATUS_FILE)throw Error('EXPLICIT_LOCAL_QUALIFICATION_REQUIRED');
let db,stage='configuration';
async function main(){
 const config=JSON.parse(fs.readFileSync(process.env.MAKEBORNE_LOCAL_STATUS_FILE,'utf8').replace(/^\uFEFF/,'')),url=new URL(config.DB_URL);
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55322');assert.equal(url.pathname,'/postgres');
 db=new Client({connectionString:url.href,query_timeout:8000});db.on('error',()=>{});await db.connect();await db.query('begin');
 if(process.env.MAKEBORNE_VERIFY_PENDING_PREPARATION==='true')await db.query(fs.readFileSync('supabase/migrations/20261009014243_saved_presentation_preparation.sql','utf8').replace(/^begin;\s*/,'').replace(/commit;\s*$/,''));
 async function rejects(fn,code){await db.query('savepoint expected_rejection');let observed;try{await fn();}catch(error){observed=error.code;}finally{await db.query('rollback to savepoint expected_rejection');await db.query('release savepoint expected_rejection');}assert.equal(observed,code);}
 for(const kind of ['presentation','website']){
  stage=kind+' fixture';const f=kind==='presentation'?harness():fixtures(),input=kind==='presentation'?f.input:f.lease.approvedInput.proposal.input;
  const {scope}=input,actor=randomUUID(),owner=randomUUID(),session=randomUUID(),base=randomUUID(),source=randomUUID();
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1::uuid,$1::text||'@example.invalid',now()),($2::uuid,$2::text||'@example.invalid',now())",[actor,owner]);
  await db.query('insert into auth.sessions(id,user_id,created_at,updated_at) values($1,$2,now(),now())',[session,actor]);
  await db.query("insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values($1,true,false,'Rolled back presentation preparation fixture')",[actor]);
  await db.query("insert into public.workspaces(id,name,owner_id) values($1,'Rolled back native preparation',$2)",[scope.workspaceId,owner]);
  await db.query("insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'editor')",[scope.workspaceId,actor]);
  await db.query('insert into public.projects(id,workspace_id,title,kind,brief,audience,purpose,wording,effort,style_id) values($1,$2,$3,$4,$5,$6,$7,$8,\'light\',$9)',[scope.projectId,scope.workspaceId,input.content.title,kind,input.brief,input.audience,input.purpose,input.wording,input.style.id]);
  await db.query('insert into public.artifacts(id,workspace_id,project_id,title,kind) values($1,$2,$3,$4,$5)',[scope.artifactId,scope.workspaceId,scope.projectId,input.content.title,kind]);
  await db.query('insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,content,style_snapshot,asset_manifest,created_by) values($1,$2,$3,1,$4,$5,\'[]\',$6)',[base,scope.workspaceId,scope.artifactId,input.content,input.style,actor]);
  await db.query('update public.artifacts set current_version=1 where id=$1',[scope.artifactId]);
  await db.query("insert into public.sources(id,workspace_id,project_id,title,kind,content,approved) values($1,$2,$3,'Approved client brief','text','Exact approved source.',true)",[source,scope.workspaceId,scope.projectId]);
  const request={scope,baseVersionId:base,sourceIds:[source],processingConsent:true,externalProcessingConsent:true,sourceRightsConfirmed:true},key=randomUUID(),expires=new Date(Date.now()+600000).toISOString();
  const args=[request,key,actor,session,expires];
  const read=async(a=args)=>(await db.query('select public.makeborne_read_generation_preparation($1,$2,$3,$4,$5) value',a)).rows[0].value;
  const loaded=await read();assert.equal(loaded.records.version.id,base);assert.equal(loaded.records.artifact.kind,kind);
  let policy;
  if(kind==='presentation')policy={routes:[f.route],maximumVendorMicrousd:'100000',maximumCustomerCredits:'100000',maximumInputTokens:10000,maximumOutputTokens:5000};
  else {const {capabilities,externalProcessingAllowed,sourceRightsConfirmed,now,...stagePolicy}=f.lease.approvedInput.proposal.workflow.stages[0].request;void capabilities;void externalProcessingAllowed;void sourceRightsConfirmed;void now;policy={routes:[f.route],maximumVendorMicrousd:'100000',maximumCustomerCredits:'100000',stages:{planning:stagePolicy,draft:stagePolicy,review:stagePolicy}};}
  const candidate=(kind==='presentation'?prepareSavedPresentationProposal:prepareSavedWebsiteProposal)(loaded.records,policy,{processingConsent:true,externalProcessingConsent:true,sourceRightsConfirmed:true},new Date().toISOString()).proposal;
  const store=async(snapshot=candidate,a=args,hash=loaded.stateHash)=>(await db.query('select public.makeborne_store_generation_preparation($1,$2,$3,$4,$5,$6,$7) value',[...a,hash,snapshot])).rows[0].value;
  stage=kind+' authority';
  await rejects(()=>read([request,randomUUID(),actor,randomUUID(),expires]),'42501');
  await rejects(async()=>{await db.query("update public.workspace_members set role='reviewer' where workspace_id=$1 and user_id=$2",[scope.workspaceId,actor]);await read();},'P0002');
  await rejects(()=>read([{...request,baseVersionId:randomUUID()},randomUUID(),actor,session,expires]),'PT409');
  await rejects(async()=>{await db.query("update public.sources set content='Changed during preparation' where id=$1",[source]);await store();},'PT409');
  await rejects(()=>store({...candidate,input:{...candidate.input,brief:'Forged client input'}}),'22023');
  if(kind==='presentation')for(const mutate of [p=>{delete p.purpose;},p=>{p.purpose='narrative';},p=>{p.workflow.presentationMode='full_visual';},p=>{p.workflow.maximumExecutions=2;},p=>{p.workflow.stages.push(structuredClone(p.workflow.stages[0]));},p=>{p.workflow.stages[0].stage='planning';},p=>{p.workflow.stages[0].maximumExecutions=2;},p=>{p.workflow.stages[0].route.provider='openai';}]){const bad=structuredClone(candidate);mutate(bad);await rejects(()=>store(bad),'22023');}
  if(kind==='presentation')for(const mutate of [p=>{delete p.purpose;},p=>{p.purpose='unknown';},p=>{p.workflow.includeImages=true;},p=>{p.workflow.stages[0].route.evaluation=null;},p=>{p.workflow.stages[0].request.maximumAttempts=2;}]){
   const bad=structuredClone(candidate);mutate(bad);
   await rejects(()=>db.query('insert into makeborne_private.generation_proposals(workspace_id,project_id,artifact_id,base_version_id,input_hash,approval_hash,snapshot,maximum_vendor_microusd,maximum_customer_credits,prepared_at,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[scope.workspaceId,scope.projectId,scope.artifactId,base,bad.inputHash,bad.approvalHash,bad,bad.workflow.maximumVendorMicrousd,bad.workflow.maximumCustomerCredits,bad.workflow.preparedAt,bad.workflow.expiresAt]),'23514');
  }
  assert.equal((await db.query('select count(*)::int n from makeborne_private.generation_proposals where workspace_id=$1',[scope.workspaceId])).rows[0].n,0);
  const before=(await db.query("select current_setting('request.jwt.claim.sub',true) sub,current_setting('request.jwt.claims',true) claims,current_setting('request.jwt.claim.role',true) role")).rows[0];
  const saved=await store();assert.equal(saved.approvalHash,candidate.approvalHash);assert.deepEqual(await store(),saved);assert.deepEqual(await read(),{prepared:saved});
  const after=(await db.query("select current_setting('request.jwt.claim.sub',true) sub,current_setting('request.jwt.claims',true) claims,current_setting('request.jwt.claim.role',true) role")).rows[0];
  for(const k of Object.keys(before))assert.equal(after[k]||'',before[k]||'');
  await rejects(()=>read([{...request,sourceIds:[]},key,actor,session,expires]),'MB409');
  assert.equal((await db.query('select count(*)::int n from makeborne_private.generation_proposals where workspace_id=$1',[scope.workspaceId])).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from public.generation_jobs where workspace_id=$1',[scope.workspaceId])).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from makeborne_private.generation_reservations where workspace_id=$1',[scope.workspaceId])).rows[0].n,0);
  console.log('PASS '+kind+' actual saved-state preparation, authority/state race/forgery denial, one proposal/replay, restored actor context, no job/hold');
 }
 stage='grants';
 for(const signature of ['public.makeborne_read_generation_preparation(jsonb,uuid,uuid,uuid,timestamptz)','public.makeborne_store_generation_preparation(jsonb,uuid,uuid,uuid,timestamptz,text,jsonb)','makeborne_private.read_generation_preparation(jsonb,uuid,uuid,uuid,timestamptz)','makeborne_private.store_generation_preparation(jsonb,uuid,uuid,uuid,timestamptz,text,jsonb)'])for(const role of ['anon','authenticated','makeborne_generation_worker','service_role'])assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') allowed',[role,signature])).rows[0].allowed,role==='service_role');
 console.log('PASS existing service-only preparation execute grants preserved; no browser/worker authority added');
 await db.query('rollback');console.log('PASS all fixture data and pending-definition experiment rolled back; no paid calls');
}
main().catch(error=>{console.error('FAIL local preparation at '+stage+': '+(error.code||'ASSERTION')+(error.constraint?' ['+error.constraint+']':'')+'; private diagnostics omitted');process.exitCode=1;}).finally(async()=>{await db?.query('rollback').catch(()=>{});await db?.end();});
