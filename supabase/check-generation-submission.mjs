/** Actual local production HTTP/Auth/Postgres qualification. No provider calls. */
import {createRequire} from "node:module";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {randomUUID,randomBytes} from "node:crypto";
import {spawn} from "node:child_process";
import assert from "node:assert/strict";
import {Client} from "pg";
import {createClient} from "@supabase/supabase-js";
import {createServerClient} from "@supabase/ssr";
import {chromium} from "playwright";
const require=createRequire(import.meta.url);
const {fixtures}=require('../src/lib/generation/check-website-worker.cjs');
const {prepareSavedWebsiteProposal}=require('../src/lib/generation/prepare-saved-website.ts');
const {GenerationProgressSchema,PreparedGenerationSchema}=require('../src/lib/generation/submission-contract.ts');
if(process.env.MAKEBORNE_VERIFY_LOCAL_JOBS!=='true'||!process.env.MAKEBORNE_LOCAL_STATUS_FILE){console.log('NOT RUN: explicit local verification and ignored configuration required.');process.exit(2);}
const dbOrigin='http://127.0.0.1:55321',appOrigin='http://localhost:3042',runId=randomUUID(),actors={},clients=[],jobs=[],creationArtifacts=[];
const evidence='docs/execution/evidence/M03-T01-R13';
let admin,db,app,browser,workspace,project,artifact,preparationInput,stage='configuration',created=false;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const dbFetch=(input,init={})=>{const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);assert.equal(url.origin,dbOrigin);return fetch(input,{...init,redirect:'error',signal:AbortSignal.timeout(15000)});};
function data(result){if(result.error||!result.data)throw Object.assign(Error('LOCAL_DATABASE_UNCONFIRMED'),{code:result.error?.code});return result.data;}
async function request(actor,method,path,body,key=randomUUID(),extra={}){
 const headers={Origin:appOrigin,...(body?{'Content-Type':'application/json'}:{}),'Idempotency-Key':key};
 if(actor){headers.Cookie=[...actor.jar].map(([name,value])=>`${name}=${value}`).join('; ');headers['X-Makeborne-Account']=actor.id;}
 return fetch(appOrigin+path,{method,headers:{...headers,...extra},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(15000)});
}
async function expect(response,status){const value=await response.json();if(response.status!==status)throw Object.assign(Error('HTTP_STATUS_MISMATCH'),{code:`HTTP_${response.status}_EXPECTED_${status}_${String(value.error?.code??'NO_ERROR').replace(/[^A-Z_]/g,'').slice(0,60)}`});assert.match(response.headers.get('Cache-Control')??'',/no-store/);if(status<300)return GenerationProgressSchema.parse(value.job);assert(value.error.code);return value;}
async function proposal(key=randomUUID()){
 const response=await request(actors.owner,'POST','/api/generate/prepare',preparationInput,key);
 const value=await response.json();
 if(response.status!==200)throw Object.assign(Error('PREPARATION_FAILED'),{code:`PREP_HTTP_${response.status}_${String(value.error?.code??'NO_ERROR').replace(/[^A-Z_]/g,'').slice(0,60)}`});
 assert.match(response.headers.get('Cache-Control')??'',/no-store/);
 const p=PreparedGenerationSchema.parse(value.prepared);
 assert(!/provider|model|tariff|snapshot|brief|configuration|stateHash|records/.test(JSON.stringify(p)));
 return {proposalId:p.proposalId,approvalHash:p.approvalHash,inputHash:p.inputHash,processingConsent:true,externalProcessingConsent:true,sourceRightsConfirmed:true};
}
async function main(){
 const config=JSON.parse((await readFile(process.env.MAKEBORNE_LOCAL_STATUS_FILE,'utf8')).replace(/^\uFEFF/,'')),url=new URL(config.DB_URL);
 assert.equal(config.API_URL,dbOrigin);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55322');assert.equal(url.pathname,'/postgres');
 assert(config.PUBLISHABLE_KEY?.startsWith('sb_publishable_'));assert(config.SECRET_KEY?.startsWith('sb_secret_'));
 db=new Client({connectionString:url.href,query_timeout:5000});db.on('error',()=>{});await db.connect();
 assert((await db.query('select enabled from makeborne_private.generation_execution_caps')).rows.every(row=>!row.enabled));
 admin=createClient(dbOrigin,config.SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:dbFetch}});clients.push(admin);
 stage='actual auth fixture';
 for(const role of ['owner','editor','reviewer','outsider','nonbuyer']){
   const email=`submission-${runId}-${role}@example.com`,password=randomBytes(32).toString('base64url');
   const account=data(await admin.auth.admin.createUser({email,password,email_confirm:true})),jar=new Map();
   const client=createServerClient(dbOrigin,config.PUBLISHABLE_KEY,{global:{fetch:dbFetch},cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:values=>values.forEach(({name,value})=>jar.set(name,value))}});clients.push(client);
   const session=data(await client.auth.signInWithPassword({email,password})).session;actors[role]={id:account.user.id,client,jar,session};
   if(role!=='nonbuyer')await db.query("insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values($1,true,false,'Local submission fixture')",[account.user.id]);
 }
 workspace=randomUUID();project=randomUUID();artifact=randomUUID();
 await db.query('begin');
 await db.query("insert into public.workspaces(id,name,owner_id) values($1,'Local submission fixture',$2)",[workspace,actors.owner.id]);
 await db.query("insert into public.projects(id,workspace_id,title,kind,brief,audience,purpose,wording,effort,style_id) values($1,$2,'Submission fixture','website','A makeup studio for stage performers. Bespoke editorial layout.','Stage performers','Book an appointment','improve','light','automatic')",[project,workspace]);
 await db.query("insert into public.artifacts(id,workspace_id,project_id,title,kind) values($1,$2,$3,'Submission fixture','website')",[artifact,workspace,project]);
 const initial=fixtures({workspaceId:workspace,projectId:project,artifactId:artifact}).lease.approvedInput.proposal.input;
 await db.query('insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,content,style_snapshot,asset_manifest,created_by) values($1,$2,$3,1,$4,$5,\'[]\',$6)',[randomUUID(),workspace,artifact,initial.content,initial.style,actors.owner.id]);
 await db.query('update public.artifacts set current_version=1 where id=$1',[artifact]);
 await db.query("insert into public.sources(workspace_id,project_id,title,kind,content,approved) values($1,$2,'Client brief','text','Use original brand language. No invented testimonials.',true)",[workspace,project]);
 await db.query('insert into makeborne_private.generation_budgets(workspace_id,spending_enabled,vendor_limit,credit_limit,concurrency_limit) values($1,true,100,100,10)',[workspace]);
 for(const role of ['editor','reviewer'])await db.query('insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,$3)',[workspace,actors[role].id,role]);
 await db.query('commit');created=true;
 const base=(await db.query('select id from public.artifact_versions where artifact_id=$1 and version_number=1',[artifact])).rows[0].id;
 const sourceIds=(await db.query('select id from public.sources where project_id=$1 and approved order by id',[project])).rows.map(row=>row.id);
 preparationInput={scope:{workspaceId:workspace,projectId:project,artifactId:artifact},baseVersionId:base,sourceIds,processingConsent:true,externalProcessingConsent:true,sourceRightsConfirmed:true};
 const price={version:'offline-zero-v1',evidenceId:'synthetic-no-provider',expiresAt:new Date(Date.now()+3600000).toISOString(),
   lines:['input_tokens','output_tokens'].map(unit=>({unit,perUnits:'1000',vendorMicrousd:'0',customerCredits:'1'})),fixedVendorMicrousd:'0',fixedCustomerCredits:'0'};
 const f=fixtures(preparationInput.scope,null,{price});
 const stages=Object.fromEntries(f.lease.approvedInput.proposal.workflow.stages.map(stage=>{
   const {capabilities,externalProcessingAllowed,sourceRightsConfirmed,now,...policy}=stage.request;
   void capabilities;void externalProcessingAllowed;void sourceRightsConfirmed;void now;return [stage.stage,policy];
 }));
 const preparationPolicy={routes:[f.route],stages,maximumVendorMicrousd:'100000',maximumCustomerCredits:'100000'};
 const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:dbOrigin,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:config.PUBLISHABLE_KEY,SUPABASE_SECRET_KEY:config.SECRET_KEY,
   MAKEBORNE_CLOUD_ENABLED:'true',MAKEBORNE_CLOUD_MIGRATIONS_VERIFIED:'true',MAKEBORNE_DURABLE_SUBMISSIONS_ENABLED:'true',MAKEBORNE_WEBSITE_PREPARATION_POLICY:JSON.stringify(preparationPolicy),MAKEBORNE_CLAUDE_PILOT_ENABLED:'false',MAKEBORNE_PUBLIC_GENERATION_ENABLED:'false',MAKEBORNE_BILLING_ENABLED:'false'};
 // Provider credentials are not needed and must not reach this test child.
 for(const key of Object.keys(env))if(/ANTHROPIC|OPENAI|WHOP_API|CLAUDE_API|DEEPSEEK_API|QWEN_API/.test(key))env[key]='';
 for(const key of ['ANTHROPIC_API_KEY','OPENAI_API_KEY','WHOP_API_KEY','DEEPSEEK_API_KEY','QWEN_API_KEY'])env[key]='';
 stage='production build';
 await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['node_modules/next/dist/bin/next','build'],{env,windowsHide:true,stdio:'ignore',timeout:120000});child.once('error',()=>reject(Error('BUILD_FAILED')));child.once('exit',code=>code===0?resolve():reject(Error('BUILD_FAILED')));});
 app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','localhost','--port','3042'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let ownedReady=false,appError=false,startup='';app.on('error',()=>{appError=true;});
 app.stdout.on('data',bytes=>{startup=(startup+bytes.toString()).slice(-2000);ownedReady ||= startup.includes('Ready in');});
 app.stderr.on('data',()=>{/* drain without exposing diagnostic/environment data */});
 for(let attempt=0;;attempt++){if(appError||app.exitCode!==null||attempt>40)throw Error('SERVER_UNAVAILABLE');if(ownedReady)try{if((await fetch(appOrigin+'/api/capabilities',{signal:AbortSignal.timeout(1000)})).ok)break;}catch{/* bounded poll of this confirmed owned child only */}await pause(250);}
 stage='preparation HTTP auth and scope';
 for(const [actor,status] of [[null,401],[actors.nonbuyer,402],[actors.reviewer,404],[actors.outsider,404]])await expect(await request(actor,'POST','/api/generate/prepare',preparationInput),status);
 await expect(await request(actors.owner,'POST','/api/generate/prepare',{...preparationInput,model:'client-route'}),400);
 await expect(await request(actors.owner,'POST','/api/generate/prepare',{...preparationInput,baseVersionId:randomUUID()}),409);
 const preparationKey=randomUUID(),[body,concurrentPreparation]=await Promise.all([proposal(preparationKey),proposal(preparationKey)]);
 assert.deepEqual(concurrentPreparation,body);
 assert.deepEqual(await proposal(preparationKey),body);
 await expect(await request(actors.owner,'POST','/api/generate/prepare',{...preparationInput,sourceIds:[]},preparationKey),409);
 const stored=(await db.query('select snapshot from makeborne_private.generation_proposals where id=$1',[body.proposalId])).rows[0].snapshot;
 assert.equal(stored.input.brief,'A makeup studio for stage performers. Bespoke editorial layout.');assert.equal(stored.input.baseVersionId,base);assert.deepEqual(stored.input.sourceIds,sourceIds);
 assert.equal((await db.query('select count(*)::int n from makeborne_private.generation_proposals where workspace_id=$1',[workspace])).rows[0].n,1);
 assert.equal((await db.query('select count(*)::int n from public.generation_jobs where workspace_id=$1',[workspace])).rows[0].n,0);
 assert.equal((await actors.owner.client.rpc('makeborne_read_generation_preparation',{p_request:preparationInput,p_request_key:randomUUID(),p_actor:actors.owner.id,p_session:randomUUID(),p_expires:new Date(Date.now()+10000).toISOString()})).error?.code,'42501');
 console.log('PASS authenticated preparation HTTP from exact canonical saved records; stable replay creates one private proposal and no job/hold; invalid revisions, changed requests, browser routing and direct bridges denied');
 stage='preparation state race';
 const claimsForPrep=data(await actors.owner.client.auth.getClaims()).claims;
 const params={p_request:preparationInput,p_request_key:randomUUID(),p_actor:actors.owner.id,p_session:claimsForPrep.session_id,p_expires:new Date(Math.min(claimsForPrep.exp*1000,Date.now()+3500000)).toISOString()};
 const loaded=data(await admin.rpc('makeborne_read_generation_preparation',params));
 const candidate=prepareSavedWebsiteProposal(loaded.records,preparationPolicy,{processingConsent:true,externalProcessingConsent:true,sourceRightsConfirmed:true},new Date().toISOString()).proposal;
 await db.query("update public.sources set content='Changed source while preparing' where id=$1",[sourceIds[0]]);
 assert.equal((await admin.rpc('makeborne_store_generation_preparation',{...params,p_state_hash:loaded.stateHash,p_snapshot:candidate})).error?.code,'PT409');
 await db.query("update public.sources set content='Use original brand language. No invented testimonials.' where id=$1",[sourceIds[0]]);
 const latest=data(await admin.rpc('makeborne_read_generation_preparation',params));
 const changed=structuredClone(candidate);changed.input.brief='Forged saved brief';
 assert.equal((await admin.rpc('makeborne_store_generation_preparation',{...params,p_state_hash:latest.stateHash,p_snapshot:changed})).error?.code,'22023');
 assert.equal((await db.query("select count(*)::int n from makeborne_private.cloud_mutation_receipts where workspace_id=$1 and operation='prepare_generation' and request_key=$2",[workspace,params.p_request_key])).rows[0].n,0);
 console.log('PASS source edit between preparation read/store and forged saved input rejected with no partial proposal/receipt');
 await db.query('begin');
 try {
   const before={sub:randomUUID(),claims:JSON.stringify({role:'anon',marker:'local-setting-preservation'}),role:'anon'};
   await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true),set_config('request.jwt.claim.role',$3,true)",[before.sub,before.claims,before.role]);
   const reuse=(await db.query('select makeborne_private.store_generation_preparation($1,$2,$3,$4,$5,$6,$7) prepared',[preparationInput,randomUUID(),actors.owner.id,params.p_session,params.p_expires,latest.stateHash,stored])).rows[0].prepared;
   assert.equal(reuse.proposalId,body.proposalId);
   const restored=(await db.query("select current_setting('request.jwt.claim.sub') sub,current_setting('request.jwt.claims') claims,current_setting('request.jwt.claim.role') role")).rows[0];assert.deepEqual(restored,before);
   assert.equal((await db.query('select count(*)::int n from makeborne_private.generation_proposals where workspace_id=$1',[workspace])).rows[0].n,1);
 } finally {await db.query('rollback');}
 console.log('PASS identical immutable proposal reused across request references; all three prior transaction-local JWT settings restored');
 stage='submission HTTP auth and scope';
 await expect(await request(null,'POST','/api/generate',body),401);
 await expect(await request(actors.nonbuyer,'POST','/api/generate',body),402);
 await expect(await request(actors.reviewer,'POST','/api/generate',body),404);
 await expect(await request(actors.outsider,'POST','/api/generate',body),404);
 await expect(await request(actors.owner,'POST','/api/generate',body,randomUUID(),{Origin:'https://untrusted.invalid'}),403);
 await expect(await request(actors.owner,'POST','/api/generate',body,randomUUID(),{'X-Makeborne-Account':actors.outsider.id}),409);
 await expect(await request(actors.owner,'POST','/api/generate',{...body,model:'browser-chosen'}),400);
 await expect(await request(actors.owner,'POST','/api/generate',{...body,approvalHash:'0'.repeat(64)}),409);
 console.log('PASS actual HTTP: anonymous/nonbuyer/reviewer/foreign workspace, foreign origin, switched account, client routing fields and altered approval denied');
 stage='durable submit replay';
 const key=randomUUID();
 await db.query('begin');await db.query('select 1 from makeborne_private.generation_budgets where workspace_id=$1 for update',[workspace]);
 try{await expect(await request(actors.owner,'POST','/api/generate',body,key),503);}finally{await db.query('rollback');}
 assert.equal((await db.query('select count(*)::int n from public.generation_jobs where workspace_id=$1',[workspace])).rows[0].n,0);
 assert.equal((await db.query('select credit_reserved from makeborne_private.generation_budgets where workspace_id=$1',[workspace])).rows[0].credit_reserved,'0');
 const first=await expect(await request(actors.owner,'POST','/api/generate',body,key),202);jobs.push(first.id);
 const replay=await expect(await request(actors.owner,'POST','/api/generate',body,key),202);assert.equal(replay.id,first.id);assert.equal(first.state,'queued');assert.equal(first.credits.reserved,'45');assert.equal(first.credits.charged,'0');
 const recoveryPath=`/api/generate/requests/${key}?proposalId=${body.proposalId}`;
 assert.equal((await expect(await request(actors.owner,'GET',recoveryPath),200)).id,first.id);
 await expect(await request(actors.reviewer,'GET',recoveryPath),404);
 await expect(await request(actors.outsider,'GET',recoveryPath),404);
 const absent=await request(actors.owner,'GET',`/api/generate/requests/${randomUUID()}?proposalId=${body.proposalId}`);assert.equal(absent.status,200);assert.deepEqual(await absent.json(),{job:null});
 assert.equal((await db.query('select count(*)::int n from public.generation_jobs where workspace_id=$1',[workspace])).rows[0].n,1);
 await expect(await request(actors.owner,'POST','/api/generate',{...body,externalProcessingConsent:false},key),409);
 for(const role of ['owner','editor','reviewer']){const status=await expect(await request(actors[role],'GET',`/api/generate/${first.id}`),200);assert.equal(status.id,first.id);assert.equal(status.canCancel,role!=='reviewer');if(role==='reviewer')assert.equal(status.credits,null);else assert.equal(status.credits.reserved,'45');}
 await expect(await request(actors.outsider,'GET',`/api/generate/${first.id}`),404);
 await expect(await request(actors.reviewer,'DELETE',`/api/generate/${first.id}`),403);
 assert.equal((await actors.owner.client.rpc('makeborne_generation_progress',{p_job:first.id,p_actor:actors.owner.id,p_session:randomUUID(),p_expires:new Date(Date.now()+10000).toISOString()})).error?.code,'42501');
 const validClaims=data(await actors.owner.client.auth.getClaims()).claims;
 for(const patch of [{p_actor:actors.outsider.id},{p_session:randomUUID()},{p_expires:new Date(0).toISOString()},{p_expires:new Date(Date.now()+7200000).toISOString()}]){
   assert.equal((await admin.rpc('makeborne_generation_progress',{p_job:first.id,p_actor:actors.owner.id,p_session:validClaims.session_id,p_expires:new Date(validClaims.exp*1000).toISOString(),...patch})).error?.code,'42501');
 }
 assert(!/provider|model|tariff|fingerprint|snapshot|brief|lease|evidence/i.test(JSON.stringify(first)));
 console.log('PASS bounded database contention leaves no partial job/hold; same-key retry and replay save once, exact 45-credit hold and scoped safe progress; direct browser bridge denied');
 stage='unused cancellation';
 await db.query('delete from makeborne_private.account_privileges where user_id=$1',[actors.editor.id]);
 const cancelled=await expect(await request(actors.editor,'DELETE',`/api/generate/${first.id}`),200);assert.equal(cancelled.state,'cancelled');assert.equal(cancelled.credits.reserved,'0');assert.equal(cancelled.credits.charged,'0');
 assert.equal((await expect(await request(actors.editor,'DELETE',`/api/generate/${first.id}`),200)).state,'cancelled');
 console.log('PASS current editor can cancel unused work after creation access expires; hold released once, no customer charge');
 stage='unknown and confirmed cancellation';
 const second=await expect(await request(actors.owner,'POST','/api/generate',await proposal()),202);jobs.push(second.id);
 const worker=randomUUID();let job=(await db.query('select (makeborne_private.acquire_generation_job_lease($1,$2,120)).*',[second.id,worker])).rows[0];
 // Explicit operator-only simulation of an uncertain dispatch; no network,
 // provider credentials, capped worker or external execution is started.
 const dispatch=(await db.query('select makeborne_private.claim_generation_job_dispatch($1,$2,$3,$4) result',[job.id,worker,job.fence,randomUUID()])).rows[0].result.dispatchId;
 const waiting=await expect(await request(actors.owner,'DELETE',`/api/generate/${second.id}`),200);assert.equal(waiting.state,'cancelling');assert.equal(waiting.credits.reserved,'45');
 assert.equal((await db.query('select count(*)::int n from makeborne_private.generation_job_settlements where job_id=$1',[job.id])).rows[0].n,0);
 await db.query("select makeborne_private.record_generation_outcome_core($1,$2,false,0,'anthropic','claude-opus-5-5','offline-zero-v1',$3,$4,null)",[job.id,dispatch,`local-submission-${job.id}`,'e'.repeat(64)]);
 const resolved=await expect(await request(actors.owner,'DELETE',`/api/generate/${second.id}`),200);assert.equal(resolved.state,'cancelled');assert.equal(resolved.credits.reserved,'0');assert.equal(resolved.credits.charged,'0');
 console.log('PASS uncertain cancellation retains hold; only explicit known-zero synthetic outcome permits original settlement/release, no invented refund');
 stage='actual browser creation recovery';
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addCookies([...actors.owner.jar].map(([name,value])=>({name,value,url:appOrigin,httpOnly:false,secure:false,sameSite:'Lax'})));
 const page=await context.newPage();let lost=false;
 await page.route('**/api/generate',async route=>{
   if(route.request().method()==='POST'&&!lost){lost=true;const response=await route.fetch();if(response.status()!==202){await route.fulfill({response});return;}await route.abort('failed');}
   else await route.continue();
 });
 await page.goto(`${appOrigin}/studio?tab=projects&workspace=${workspace}&artifact=${artifact}`);
 const panel=page.getByRole('region',{name:'Website creation'});
 await panel.getByRole('checkbox').nth(0).check();await panel.getByRole('checkbox').nth(1).check();
 await panel.getByRole('button',{name:'Build website',exact:true}).click();
 await panel.getByRole('status').filter({hasText:'The outcome could not be confirmed'}).waitFor({timeout:30000});assert(lost);
 stage='browser committed job count';
 const uiJobs=(await db.query("select id from public.generation_jobs where workspace_id=$1 and status='queued'",[workspace])).rows;assert.equal(uiJobs.length,1);jobs.push(uiJobs[0].id);
 await db.query('delete from makeborne_private.account_privileges where user_id=$1',[actors.owner.id]);
 const storedReference=await page.evaluate(()=>{const key=Object.keys(localStorage).find(key=>key.startsWith('makeborne.generation.v1.'));return key?JSON.parse(localStorage.getItem(key)):null;});
 assert(storedReference?.prepared&&!storedReference.jobId);
 const recovered=await expect(await request(actors.owner,'GET',`/api/generate/requests/${storedReference.requestKey}?proposalId=${storedReference.prepared.proposalId}`),200);assert.equal(recovered.id,uiJobs[0].id);
 await db.query("insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values($1,true,false,'Local submission fixture')",[actors.owner.id]);
 stage='browser reload recovery with studio access';
 await page.reload();await panel.getByRole('button',{name:'Retry saved request'}).click();
 await panel.getByText('Waiting to start',{exact:true}).waitFor({timeout:15000});
 await page.reload();await panel.getByText('Waiting to start',{exact:true}).waitFor({timeout:15000});
 assert.equal((await db.query("select count(*)::int n from public.generation_jobs where workspace_id=$1 and status='queued'",[workspace])).rows[0].n,1);
 await panel.getByRole('button',{name:'Cancel creation'}).click();await panel.getByText('Creation cancelled',{exact:true}).waitFor({timeout:15000});
 stage='actual browser cross-tab coordination';
 await panel.getByRole('button',{name:'New request'}).click();
 await panel.getByRole('checkbox').nth(0).check();await panel.getByRole('checkbox').nth(1).check();
 const checkboxBounds=await panel.getByRole('checkbox').nth(0).boundingBox();assert(checkboxBounds.width<=20&&checkboxBounds.height<=20);
 await page.screenshot({path:evidence+'/studio-consent.png',fullPage:true});
 const secondPage=await context.newPage();await secondPage.goto(`${appOrigin}/studio?tab=projects&workspace=${workspace}&artifact=${artifact}`);
 const secondPanel=secondPage.getByRole('region',{name:'Website creation'});
 await secondPanel.getByRole('checkbox').nth(0).check();await secondPanel.getByRole('checkbox').nth(1).check();
 await Promise.all([panel.getByRole('button',{name:'Build website',exact:true}).click(),secondPanel.getByRole('button',{name:'Build website',exact:true}).click()]);
 await panel.getByText('Waiting to start',{exact:true}).waitFor({timeout:15000});await secondPanel.getByText('Waiting to start',{exact:true}).waitFor({timeout:15000});
 const crossTab=(await db.query("select id from public.generation_jobs where workspace_id=$1 and status='queued'",[workspace])).rows;assert.equal(crossTab.length,1);jobs.push(crossTab[0].id);
 await panel.getByRole('button',{name:'Cancel creation'}).click();await panel.getByText('Creation cancelled',{exact:true}).waitFor({timeout:15000});
 await secondPanel.getByText('Creation cancelled',{exact:true}).waitFor({timeout:15000});await secondPage.close();
 await mkdir(evidence,{recursive:true});await page.screenshot({path:evidence+'/studio-cancelled.png',fullPage:true});
 stage='homepage creation lost-response recovery';
 const home=await context.newPage(),projectWrites=[],generationWrites=[];let projectLost=false,generationLost=false;
 await home.route('**/api/generate',async route=>{
   if(route.request().method()!=='POST'){await route.continue();return;}
   generationWrites.push({key:route.request().headers()['idempotency-key'],body:route.request().postData()});
   if(!generationLost){generationLost=true;const response=await route.fetch();assert.equal(response.status(),202);await route.abort('failed');}
   else await route.continue();
 });
 await home.route('**/studio-projects',async route=>{
   if(route.request().method()!=='POST'){await route.continue();return;}
   projectWrites.push({key:route.request().headers()['idempotency-key'],body:route.request().postData()});
   if(!projectLost){projectLost=true;const response=await route.fetch();assert.equal(response.status(),201);await route.abort('failed');}
   else await route.continue();
 });
 await home.goto(appOrigin+'/');
 await home.getByLabel('Describe your project').fill(`Original performer makeup website ${runId}. Invent a bespoke art direction, not a template.`);
 await home.waitForFunction(()=>!document.querySelector('button[aria-label="Attach files"]')?.disabled);
 await home.getByLabel('Choose files to attach').setInputFiles({name:'approved-client-notes.txt',mimeType:'text/plain',buffer:Buffer.from('Original permitted client reference. No invented testimonials.')});
 await home.getByLabel('Download approved-client-notes.txt').waitFor();
 const permissions=home.getByRole('group',{name:'Creation permissions'});
 await permissions.waitFor();
 assert.equal(await home.getByRole('button',{name:'Create this project',exact:true}).isEnabled(),false);
 await permissions.getByRole('checkbox').nth(0).check();
 assert.equal(await home.getByRole('button',{name:'Create this project',exact:true}).isEnabled(),false);
 await permissions.getByRole('checkbox').nth(1).check();
 stage='homepage compact permission controls';
 const permissionBounds=await permissions.getByRole('checkbox').nth(0).boundingBox();assert(permissionBounds.width<=20&&permissionBounds.height<=20);
 await home.screenshot({path:evidence+'/homepage-create-permissions.png',fullPage:true});
 stage='homepage committed project response';
 await home.getByRole('button',{name:'Create this project',exact:true}).click();
 await home.getByRole('alert').filter({hasText:'cloud could not confirm'}).waitFor({timeout:30000});
 assert(projectLost);assert.equal(projectWrites.length,1);
 const originalHomeDraft=await home.evaluate(()=>sessionStorage.getItem('makeborne.creation-draft.v1'));
 assert(originalHomeDraft);const creationIntent=JSON.parse(originalHomeDraft).requestId;
 const creationRef=await home.evaluate(({accountId,intentId})=>JSON.parse(localStorage.getItem(`makeborne.creation-reference.v1.${accountId}.${intentId}`)),{accountId:actors.owner.id,intentId:creationIntent});
 assert(creationRef&&!creationRef.artifact);assert.equal(creationRef.workspaceId,workspace);assert.equal(creationRef.requestKey,projectWrites[0].key);
 await home.reload();
 await home.waitForURL(url=>url.searchParams.has('artifact'),{timeout:30000});
 const handoffArtifact=new URL(home.url()).searchParams.get('artifact');
 creationArtifacts.push(handoffArtifact);
 assert.equal(projectWrites.length,2);assert.deepEqual(projectWrites[1],projectWrites[0]);
 assert.equal((await db.query('select count(*)::int n from public.artifact_versions where artifact_id=$1',[handoffArtifact])).rows[0].n,1);
 stage='homepage original atomic project receipt';
 const receiptOperations=(await db.query('select operation,count(*)::int n from makeborne_private.cloud_mutation_receipts where workspace_id=$1 and actor_id=$2 and request_key=$3 group by operation order by operation',[workspace,actors.owner.id,creationRef.requestKey])).rows;
 assert.deepEqual(receiptOperations,[{operation:'create_artifact',n:1},{operation:'create_project',n:1},{operation:'save_version',n:1}]);
 const savedProjects=(await db.query('select a.id,p.brief,p.effort,p.style_id from public.projects p join public.artifacts a on a.project_id=p.id where p.workspace_id=$1 and p.brief like $2',[workspace,`%${runId}%`])).rows;
 assert.equal(savedProjects.length,1);assert.equal(savedProjects[0].id,handoffArtifact);assert.equal(savedProjects[0].style_id,'automatic');
 await home.getByLabel('Download approved-client-notes.txt').waitFor({timeout:15000});
 const completed=await home.evaluate(({accountId,intentId})=>JSON.parse(localStorage.getItem(`makeborne.creation-reference.v1.${accountId}.${intentId}`)),{accountId:actors.owner.id,intentId:creationIntent});
 assert.equal(completed.artifact.id,handoffArtifact);assert.equal(completed.requestKey,creationRef.requestKey);
 stage='homepage immediate generation dropped-response recovery';
 const autoPanel=home.getByRole('region',{name:'Website creation'});
 await autoPanel.getByRole('status').filter({hasText:'The outcome could not be confirmed'}).waitFor({timeout:30000});
 assert(generationLost);assert.equal(generationWrites.length,1);assert.equal(generationWrites[0].key,creationIntent);
 const autoJobs=(await db.query("select id from public.generation_jobs where artifact_id=$1 and status='queued'",[handoffArtifact])).rows;
 assert.equal(autoJobs.length,1);jobs.push(autoJobs[0].id);
 await home.reload();
 await autoPanel.getByText('Waiting to start',{exact:true}).waitFor({timeout:15000});
 assert.equal(generationWrites.length,1);
 await autoPanel.getByRole('button',{name:'Cancel creation'}).click();
 await autoPanel.getByText('Creation cancelled',{exact:true}).waitFor({timeout:15000});
 // A delayed copy of the original prompt handoff must reopen the receipt,
 // even after api() cleared its separate pending-write transport record.
 await home.evaluate(raw=>sessionStorage.setItem('makeborne.creation-draft.v1',raw),originalHomeDraft);
 await home.goto(appOrigin+'/studio?create=website&from=home');
 await home.waitForURL(url=>url.searchParams.get('artifact')===handoffArtifact,{timeout:30000});
 assert.equal(projectWrites.length,2);
 await autoPanel.getByText('Creation cancelled',{exact:true}).waitFor({timeout:15000});assert.equal(generationWrites.length,1);
 assert.equal((await db.query('select count(*)::int n from public.generation_jobs where artifact_id=$1',[handoffArtifact])).rows[0].n,1);
 await home.getByLabel('Download approved-client-notes.txt').waitFor({timeout:15000});
 stage='homepage attachment byte preservation';
 const attachmentText=await home.evaluate(async key=>{
   const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('makeborne.attachments.v1',2);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(Error('ATTACHMENT_DB_UNAVAILABLE'));});
   const value=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(Error('ATTACHMENT_RECORD_UNAVAILABLE'));});
   const tx=database.transaction(['collections','files'],'readonly');
   const collection=await value(tx.objectStore('collections').get(key));
   if(!collection||collection.ids.length!==1){database.close();throw Error('ATTACHMENT_SCOPE_MISMATCH');}
   const file=await value(tx.objectStore('files').get(collection.ids[0]));database.close();return file.blob.text();
 },`account:${actors.owner.id}/project:${actors.owner.id}:${workspace}:${handoffArtifact}`);
 assert.equal(attachmentText,'Original permitted client reference. No invented testimonials.');
 await home.screenshot({path:evidence+'/homepage-recovered-project.png',fullPage:true});await home.close();
 stage='optional plan does not submit creation';
 const planPage=await context.newPage();await planPage.goto(appOrigin+'/');
 await planPage.getByLabel('Describe your project').fill(`Plan only ${runId}. A makeup business website.`);
 await planPage.waitForFunction(()=>!document.querySelector('button[aria-label="Attach files"]')?.disabled);
 await planPage.getByRole('group',{name:'Creation permissions'}).waitFor();
 await planPage.getByRole('button',{name:'Plan',exact:true}).click();
 assert.equal(await planPage.getByRole('group',{name:'Creation permissions'}).count(),0);
 const jobsBeforePlan=(await db.query('select count(*)::int n from public.generation_jobs where workspace_id=$1',[workspace])).rows[0].n;
 await planPage.getByRole('button',{name:'Plan this project',exact:true}).click();
 await planPage.getByRole('heading',{name:'Let’s shape your idea'}).waitFor({timeout:15000});
 assert.equal((await db.query('select count(*)::int n from public.generation_jobs where workspace_id=$1',[workspace])).rows[0].n,jobsBeforePlan);
 assert.equal((await db.query('select count(*)::int n from public.projects where workspace_id=$1 and brief like $2',[workspace,`%Plan only ${runId}%`])).rows[0].n,0);
 await planPage.screenshot({path:evidence+'/optional-plan.png',fullPage:true});
 stage='plan confirmation uses shared website handoff';
 const planPermissions=planPage.getByRole('group',{name:'Creation permissions'});
 await planPermissions.waitFor();
 assert.equal(await planPage.getByRole('button',{name:'Confirm plan & create',exact:true}).isEnabled(),false);
 await planPage.getByLabel('Who is it for?').fill('Independent makeup artists');
 await planPage.getByLabel('What should it achieve?').fill('Book a consultation');
 await planPage.getByLabel('Sections to include').fill('Services\nWork\nBook a consultation');
 await planPermissions.getByRole('checkbox').nth(0).check();await planPermissions.getByRole('checkbox').nth(1).check();
 const planBounds=await planPermissions.getByRole('checkbox').nth(0).boundingBox();assert(planBounds.width<=20&&planBounds.height<=20);
 await planPage.getByRole('button',{name:'Confirm plan & create',exact:true}).click();
 await planPage.waitForURL(url=>url.searchParams.has('artifact'),{timeout:30000});
 const planArtifact=new URL(planPage.url()).searchParams.get('artifact');creationArtifacts.push(planArtifact);
 const planPanel=planPage.getByRole('region',{name:'Website creation'});await planPanel.getByText('Waiting to start',{exact:true}).waitFor({timeout:15000});
 const planJobs=(await db.query('select id from public.generation_jobs where artifact_id=$1',[planArtifact])).rows;
 assert.equal(planJobs.length,1);jobs.push(planJobs[0].id);
 const approvedPlan=(await db.query('select p.brief,p.audience,p.purpose from public.projects p join public.artifacts a on a.project_id=p.id where a.id=$1 and p.workspace_id=$2',[planArtifact,workspace])).rows[0];
 assert.equal(approvedPlan.audience,'Independent makeup artists');assert.equal(approvedPlan.purpose,'Book a consultation');assert(approvedPlan.brief.includes('Services')&&approvedPlan.brief.includes('Work'));
 await planPanel.getByRole('button',{name:'Cancel creation'}).click();await planPanel.getByText('Creation cancelled',{exact:true}).waitFor({timeout:15000});
 await planPage.reload();await planPanel.getByText('Creation cancelled',{exact:true}).waitFor({timeout:15000});
 assert.equal((await db.query('select count(*)::int n from public.generation_jobs where artifact_id=$1',[planArtifact])).rows[0].n,1);
 await planPage.screenshot({path:evidence+'/confirmed-plan-request.png',fullPage:true});await planPage.close();
 stage='studio composer lost committed save and automatic job';
 const studioPage=await context.newPage(),studioWrites=[];let studioLost=false;
 await studioPage.route('**/studio-projects',async route=>{
   if(route.request().method()!=='POST'){await route.continue();return;}
   studioWrites.push({key:route.request().headers()['idempotency-key'],body:route.request().postData()});
   if(!studioLost){studioLost=true;const response=await route.fetch();assert.equal(response.status(),201);await route.abort('failed');}
   else await route.continue();
 });
 await studioPage.goto(appOrigin+'/studio?tab=projects');
 await studioPage.getByLabel('Describe your next project').fill(`Studio composer ${runId}. An original makeup studio website.`);
 const studioPermissions=studioPage.getByRole('group',{name:'Creation permissions'});await studioPermissions.waitFor();
 assert.equal(await studioPage.getByRole('button',{name:'Create this project',exact:true}).isEnabled(),false);
 await studioPermissions.getByRole('checkbox').nth(0).check();await studioPermissions.getByRole('checkbox').nth(1).check();
 const studioBounds=await studioPermissions.getByRole('checkbox').nth(0).boundingBox();assert(studioBounds.width<=20&&studioBounds.height<=20);
 await studioPage.getByRole('button',{name:'Create this project',exact:true}).click();
 await studioPage.getByRole('alert').filter({hasText:'cloud could not confirm'}).waitFor({timeout:30000});assert(studioLost);
 assert.equal(new URL(studioPage.url()).searchParams.get('create'),'website');
 await studioPage.reload();await studioPage.waitForURL(url=>url.searchParams.has('artifact'),{timeout:30000});
 const studioArtifact=new URL(studioPage.url()).searchParams.get('artifact');creationArtifacts.push(studioArtifact);
 assert.equal(studioWrites.length,2);assert.deepEqual(studioWrites[0],studioWrites[1]);
 const studioPanel=studioPage.getByRole('region',{name:'Website creation'});await studioPanel.getByText('Waiting to start',{exact:true}).waitFor({timeout:15000});
 const studioJobs=(await db.query('select id from public.generation_jobs where artifact_id=$1',[studioArtifact])).rows;
 assert.equal(studioJobs.length,1);jobs.push(studioJobs[0].id);
 assert.equal((await db.query('select count(*)::int n from public.projects p join public.artifacts a on a.project_id=p.id where a.id=$1 and p.workspace_id=$2 and p.brief like $3',[studioArtifact,workspace,`Studio composer ${runId}%`])).rows[0].n,1);
 await studioPanel.getByRole('button',{name:'Cancel creation'}).click();await studioPanel.getByText('Creation cancelled',{exact:true}).waitFor({timeout:15000});
 await studioPage.screenshot({path:evidence+'/studio-composer-request.png',fullPage:true});await studioPage.close();
 console.log('PASS optional Plan confirmation requires shared permissions, preserves audience/outcome/edited outline, submits one original website job and reload observes its cancellation');
 console.log('PASS studio composer shared permissions, durable prompt return route, lost committed project response/reload uses same key/body and automatically submits one website job without a second Build click');
 console.log('PASS homepage inline permissions required for Create, one automatic website preparation/job without second build click; dropped committed job response reload recovers original without another POST; delayed original handoff observes cancellation and cannot restart it; optional Plan asks for confirmation and creates no project/job');
 console.log('PASS actual homepage prompt and local text attachment: lost committed project response plus reload preserves original payload/key, creates one automatic-direction project; delayed original handoff reopens confirmed artifact without another POST, attachments remain available');
 await browser.close();browser=null;
 console.log('PASS actual studio browser: inline consent, dropped committed response, reload/retry and second reload recover one job; recovery API works with creation entitlement removed; restored studio access cancels once without draft replacement');
 console.log('PASS actual two-tab simultaneous creation shares browser lock/reference, commits one job/hold and both tabs observe one cancellation');
 stage='session revocation';
 await db.query('delete from auth.sessions where user_id=$1',[actors.owner.id]);
 const revoked=await request(actors.owner,'GET',`/api/generate/${first.id}`);
 assert([401,403].includes(revoked.status),'REVOKED_SESSION_WAS_NOT_DENIED');await expect(revoked,revoked.status);
 const claims=data(await actors.owner.client.auth.getClaims()).claims;
 assert.equal(claims.sub,actors.owner.id);assert(claims.exp*1000>Date.now());
 assert.equal((await admin.rpc('makeborne_generation_progress',{p_job:first.id,p_actor:actors.owner.id,p_session:claims.session_id,p_expires:new Date(claims.exp*1000).toISOString()})).error?.code,'42501');
 console.log('PASS revoked Auth session denied even with previously issued valid access token');
 stage='current definitions and bridge grants';
 const migration=(await Promise.all(['20261008163228_generation_submission_boundary.sql','20261008170101_generation_preparation_boundary.sql','20261008171229_generation_request_recovery.sql'].map(file=>readFile('supabase/migrations/'+file,'utf8')))).join('\n');let definitions=0;
 for(const match of migration.matchAll(/create(?: or replace)? function (makeborne_private|public)\.([a-z_]+)\([\s\S]*?as \$\$([\s\S]*?)\$\$;/g)){
   const row=(await db.query('select prosrc,proconfig,prosecdef,p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2',[match[1],match[2]])).rows[0];
   assert(row);assert.equal(row.prosrc.replace(/\r\n/g,'\n').trim(),match[3].replace(/\r\n/g,'\n').trim());assert(row.proconfig.includes('search_path=""'));assert.equal(row.prosecdef,match[1]==='makeborne_private');
   if(match[2]==='makeborne_submit_generation')assert(row.proconfig.includes('lock_timeout=5s'));
   for(const role of ['anon','authenticated','service_role','makeborne_generation_worker','makeborne_generation_publisher','makeborne_project_builder'])assert.equal((await db.query("select has_function_privilege($1,$2::oid,'execute') allowed",[role,row.oid])).rows[0].allowed,role==='service_role'&&match[2]!=='check_submission_session');
   definitions++;
 }
 assert.equal(definitions,14);console.log('PASS all fourteen current submission/preparation/recovery SQL definitions/fixed search paths; service-only invoker bridges and least-privilege helper grants');
 await mkdir(evidence,{recursive:true});await writeFile(evidence+'/http-fixture.json',JSON.stringify({runId,workspace,jobIds:jobs,creationArtifactIds:creationArtifacts,paidCalls:0,publicGenerationEnabled:false},null,2)+'\n');
 console.log(`PASS local production HTTP qualification ${runId}; no paid calls, production mutation or worker dispatch`);
}
main().catch(error=>{console.error(`LOCAL SUBMISSION FAILED at ${stage}: ${typeof error?.code==='string'?error.code:'ASSERTION_OR_CONFIGURATION'}; sensitive details omitted.`);const location=String(error?.stack??'').match(/check-generation-submission\.mjs:[0-9]+:[0-9]+/);if(location)console.error('SAFE VERIFIER LOCATION '+location[0]);process.exitCode=1;}).finally(async()=>{
 if(browser){if(process.exitCode)await browser.contexts()[0]?.pages().at(-1)?.screenshot({path:evidence+'/studio-failure.png',fullPage:true}).catch(()=>{});await browser.close().catch(()=>{});}
 if(app){app.kill();await Promise.race([new Promise(resolve=>app.once('exit',resolve)),pause(5000)]);}
 if(db){await db.query('rollback').catch(()=>{});if(created){try{
   // A browser response can be lost before its job ID reaches the harness.
   // Read all jobs in this exact owned fixture workspace, not only known IDs.
   const cleanupJobs=(await db.query("select j.id from public.generation_jobs j join public.workspaces w on w.id=j.workspace_id where w.id=$1 and w.owner_id=$2 and w.name='Local submission fixture'",[workspace,actors.owner.id])).rows;
   for(const {id} of cleanupJobs){const row=(await db.query('select * from public.generation_jobs where id=$1',[id])).rows[0];if(row&&!['succeeded','failed','cancelled'].includes(row.status)){
     const dispatch=(await db.query('select id from makeborne_private.generation_dispatches where reservation_id=$1',[row.reservation_id])).rows[0];
     if(dispatch){if(!(await db.query('select 1 from makeborne_private.generation_provider_outcomes where job_id=$1',[id])).rowCount)await db.query("select makeborne_private.record_generation_outcome_core($1,$2,false,0,'anthropic','claude-opus-5-5','offline-zero-v1',$3,$4,null)",[id,dispatch.id,`local-cleanup-${id}`,'e'.repeat(64)]);
       const revision=(await db.query('select run_revision from public.generation_jobs where id=$1',[id])).rows[0].run_revision;await db.query('select makeborne_private.settle_generation_job($1,$2,$3,false,$4)',[id,actors.owner.id,revision,'f'.repeat(64)]);
     }else await db.query("select makeborne_private.cancel_generation_job($1,$2,'Unused local submission fixture cleanup')",[id,actors.owner.id]);
   }}
   await db.query('update makeborne_private.generation_budgets set spending_enabled=false,emergency_stop=true where workspace_id=$1',[workspace]);
   const stopped=(await db.query('select vendor_reserved,credit_reserved,active_reservations from makeborne_private.generation_budgets where workspace_id=$1',[workspace])).rows[0];
   assert.equal(stopped.vendor_reserved,'0');assert.equal(stopped.credit_reserved,'0');assert.equal(stopped.active_reservations,0);
 }catch{console.error('FAIL local submission accounting cleanup requires review');process.exitCode=1;}}
 for(const actor of Object.values(actors)){await db.query('delete from makeborne_private.account_privileges where user_id=$1',[actor.id]);await db.query('delete from auth.sessions where user_id=$1',[actor.id]);}
 await db.end();}
 for(const client of clients)await client.auth.signOut({scope:'local'}).catch(()=>{});
 console.log('PASS owned HTTP server stopped, fixture sessions/grants removed and workspace budget disabled; immutable accounting retained');
});
