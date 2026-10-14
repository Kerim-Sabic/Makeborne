/** Local production HTTP/Auth/Postgres preparation. No browser or provider calls. */
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
import {Client} from 'pg';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import {qualifyNativeExecution} from './qualify-native-execution.mjs';
const require=createRequire(import.meta.url),{harness}=require('../src/lib/generation/check-presentation-worker.cjs');
const {fixtures}=require('../src/lib/generation/check-website-worker.cjs');
const {PreparedGenerationSchema}=require('../src/lib/generation/submission-contract.ts');
if(process.env.MAKEBORNE_VERIFY_LOCAL_JOBS!=='true'||!process.env.MAKEBORNE_LOCAL_STATUS_FILE)throw Error('EXPLICIT_LOCAL_VERIFICATION_REQUIRED');
const dbOrigin='http://127.0.0.1:55321',appOrigin='http://localhost:3047',actors={},runId=randomUUID();
const executeNative=process.env.MAKEBORNE_VERIFY_NATIVE_EXECUTION==='true';
let db,app,nativePrepared,stage='configuration';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const localFetch=(input,init={})=>{assert.equal(new URL(typeof input==='string'?input:input.url??input.href).origin,dbOrigin);return fetch(input,{...init,redirect:'error',signal:AbortSignal.timeout(15000)});};
function data(result){if(result.error||!result.data)throw Object.assign(Error('DATABASE_UNCONFIRMED'),{code:result.error?.code});return result.data;}
async function api(actor,method,path,body,key=randomUUID(),headers={}){
 return fetch(appOrigin+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{Origin:appOrigin,'Content-Type':'application/json','Idempotency-Key':key,...(actor?{Cookie:[...actor.jar].map(([k,v])=>`${k}=${v}`).join('; '),'X-Makeborne-Account':actor.id}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
async function request(actor,body,key=randomUUID(),headers={}){return api(actor,'POST','/api/generate/prepare',body,key,headers);}
async function expect(response,status){const result=await response.json();assert.equal(response.status,status,'UNEXPECTED_HTTP_STATUS_'+response.status+'_'+(result.error?.code??'NO_CODE'));assert.match(response.headers.get('cache-control')??'',/no-store/);return status===200?PreparedGenerationSchema.parse(result.prepared):result;}
async function main(){
 const config=JSON.parse((await readFile(process.env.MAKEBORNE_LOCAL_STATUS_FILE,'utf8')).replace(/^\uFEFF/,'')),url=new URL(config.DB_URL);
 assert.equal(config.API_URL,dbOrigin);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55322');assert.equal(url.pathname,'/postgres');
 await new Promise((resolve,reject)=>{const probe=createServer();probe.once('error',reject);probe.listen(3047,'localhost',()=>probe.close(resolve));});
 db=new Client({connectionString:url.href,query_timeout:8000});db.on('error',()=>{});await db.connect();
 const admin=createClient(dbOrigin,config.SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:localFetch}});
 stage='local Auth fixture';
 for(const role of ['owner','reviewer','outsider','nonbuyer']){
  const email=`makeborne-preparation-${role}-${runId}@example.com`,password=randomBytes(32).toString('base64url');
  const account=data(await admin.auth.admin.createUser({email,password,email_confirm:true}));const jar=new Map();
  const client=createServerClient(dbOrigin,config.PUBLISHABLE_KEY,{auth:{autoRefreshToken:false},global:{fetch:localFetch},cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:values=>values.forEach(({name,value})=>jar.set(name,value))}});
  data(await client.auth.signInWithPassword({email,password}));actors[role]={id:account.user.id,client,jar};
  if(role!=='nonbuyer')await db.query("insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values($1,true,false,'Local presentation preparation HTTP fixture')",[account.user.id]);
 }
 const native=harness(),website=fixtures({workspaceId:native.input.scope.workspaceId,projectId:randomUUID(),artifactId:randomUUID()}),policy={routes:[native.route],maximumVendorMicrousd:'100000',maximumCustomerCredits:'100000',maximumInputTokens:10000,maximumOutputTokens:5000};
 if(executeNative){native.route.price.lines.forEach(line=>line.vendorMicrousd='0');native.route.price.fixedVendorMicrousd='0';}
 const stages=Object.fromEntries(website.lease.approvedInput.proposal.workflow.stages.map(({stage,request:{capabilities,externalProcessingAllowed,sourceRightsConfirmed,now,...rest}})=>{void capabilities;void externalProcessingAllowed;void sourceRightsConfirmed;void now;return [stage,rest];}));
 const websitePolicy={routes:[website.route],maximumVendorMicrousd:'100000',maximumCustomerCredits:'100000',stages};
 const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:dbOrigin,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:config.PUBLISHABLE_KEY,SUPABASE_SECRET_KEY:config.SECRET_KEY,NEXT_PUBLIC_APP_URL:appOrigin,MAKEBORNE_CLOUD_ENABLED:'true',MAKEBORNE_CLOUD_MIGRATIONS_VERIFIED:'true',MAKEBORNE_DURABLE_SUBMISSIONS_ENABLED:'true',MAKEBORNE_PRESENTATION_SUBMISSIONS_ENABLED:executeNative?'true':'false',MAKEBORNE_PRESENTATION_PREPARATION_POLICY:JSON.stringify(policy),MAKEBORNE_WEBSITE_PREPARATION_POLICY:JSON.stringify(websitePolicy),MAKEBORNE_CLAUDE_PILOT_ENABLED:'false',MAKEBORNE_PUBLIC_GENERATION_ENABLED:'false',MAKEBORNE_BILLING_ENABLED:'false'};
 for(const key of new Set([...Object.keys(env),...['ANTHROPIC_API_KEY','OPENAI_API_KEY','WHOP_API_KEY','DEEPSEEK_API_KEY','QWEN_API_KEY']]))if(/ANTHROPIC|OPENAI|WHOP_API|CLAUDE_API|DEEPSEEK_API|QWEN_API/.test(key))env[key]='';
 stage='production build';await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['node_modules/next/dist/bin/next','build'],{env,windowsHide:true,stdio:'ignore',timeout:120000});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('BUILD_FAILED')));});
 stage='owned server';app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','localhost','--port','3047'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let ready=false,failed=false,startup='';app.on('error',()=>{failed=true;});app.stdout.on('data',b=>{startup=(startup+b.toString()).slice(-1000);ready ||= startup.includes('Ready in');});app.stderr.on('data',()=>{});
 for(let i=0;i<60&&!ready&&!failed&&app.exitCode===null;i++)await pause(200);assert(ready&&!failed&&app.exitCode===null,'OWNED_SERVER_NOT_READY');
 for(const kind of ['presentation','website']){
  stage=kind+' fixture';const input=kind==='presentation'?native.input:website.lease.approvedInput.proposal.input,{scope}=input,base=randomUUID(),source=randomUUID();
  await db.query('begin');
  if(kind==='presentation'){
   await db.query("insert into public.workspaces(id,name,owner_id) values($1,'Local preparation HTTP fixture',$2)",[scope.workspaceId,actors.owner.id]);
   await db.query('insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,\'reviewer\')',[scope.workspaceId,actors.reviewer.id]);
  }
  await db.query('insert into public.projects(id,workspace_id,title,kind,brief,audience,purpose,wording,effort,style_id) values($1,$2,$3,$4,$5,$6,$7,$8,\'light\',$9)',[scope.projectId,scope.workspaceId,input.content.title,kind,input.brief,input.audience,input.purpose,input.wording,input.style.id]);
  await db.query('insert into public.artifacts(id,workspace_id,project_id,title,kind) values($1,$2,$3,$4,$5)',[scope.artifactId,scope.workspaceId,scope.projectId,input.content.title,kind]);
  await db.query('insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,content,style_snapshot,asset_manifest,created_by) values($1,$2,$3,1,$4,$5,\'[]\',$6)',[base,scope.workspaceId,scope.artifactId,input.content,input.style,actors.owner.id]);
  await db.query('update public.artifacts set current_version=1 where id=$1',[scope.artifactId]);
  await db.query("insert into public.sources(id,workspace_id,project_id,title,kind,content,approved) values($1,$2,$3,'Approved brief','text','Exact approved material.',true)",[source,scope.workspaceId,scope.projectId]);await db.query('commit');
  const body={scope,baseVersionId:base,sourceIds:[source],processingConsent:true,externalProcessingConsent:true,sourceRightsConfirmed:true},key=randomUUID();stage=kind+' HTTP';
  for(const [actor,status]of [[null,401],[actors.nonbuyer,402],[actors.reviewer,404],[actors.outsider,404]])await expect(await request(actor,body),status);
  await expect(await request(actors.owner,{...body,model:'browser-model'}),400);await expect(await request(actors.owner,{...body,baseVersionId:randomUUID()}),409);
  await expect(await request(actors.owner,body,randomUUID(),{Origin:'https://untrusted.example'}),403);
  if(kind==='presentation')await expect(await request(actors.owner,{...body,externalProcessingConsent:false}),409);
  await expect(await request(actors.owner,body,randomUUID(),{'X-Makeborne-Account':actors.outsider.id}),409);
  const [a,b]=await Promise.all([request(actors.owner,body,key).then(r=>expect(r,200)),request(actors.owner,body,key).then(r=>expect(r,200))]);assert.deepEqual(a,b);assert.deepEqual(await expect(await request(actors.owner,body,key),200),a);
  await expect(await request(actors.owner,{...body,sourceIds:[]},key),409);
  assert(!/provider|model|tariff|snapshot|configuration|records|stateHash/.test(JSON.stringify(a)));
  const stored=(await db.query('select snapshot from makeborne_private.generation_proposals where id=$1',[a.proposalId])).rows[0].snapshot;
  assert.equal(stored.input.baseVersionId,base);assert.deepEqual(stored.input.content,input.content);assert.deepEqual(stored.input.style,input.style);assert.deepEqual(stored.input.sourceIds,[source]);if(kind==='presentation')assert.equal(stored.purpose,'presentation_composition');
  for(const table of ['public.generation_jobs','makeborne_private.generation_reservations'])assert.equal((await db.query(`select count(*)::int n from ${table} where workspace_id=$1`,[scope.workspaceId])).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from makeborne_private.generation_proposals where workspace_id=$1 and artifact_id=$2',[scope.workspaceId,scope.artifactId])).rows[0].n,1);
  if(kind==='presentation'){nativePrepared=a;if(!executeNative){const denied=await api(actors.owner,'POST','/api/generate',{proposalId:a.proposalId,approvalHash:a.approvalHash,inputHash:a.inputHash,processingConsent:true,externalProcessingConsent:true,sourceRightsConfirmed:true});assert.equal(denied.status,503);assert.equal((await denied.json()).error.code,'FORMAT_NOT_READY');console.log('PASS native submission disabled by default; no job or paid execution enabled');}}
  const denied=await actors.owner.client.rpc('makeborne_read_generation_preparation',{p_request:body,p_request_key:randomUUID(),p_actor:actors.owner.id,p_session:randomUUID(),p_expires:new Date(Date.now()+10000).toISOString()});assert.equal(denied.error?.code,'42501');
  console.log('PASS '+kind+' actual production HTTP/Auth/SQL preparation; concurrent replay stable, role/account/revision/field checks, provider details private, one proposal and zero jobs/holds');
 }
 if(executeNative){stage='native execution';await qualifyNativeExecution({db,url,scope:native.input.scope,actor:actors.owner,reviewer:actors.reviewer,prepared:nativePrepared,native,api});}
} 
main().catch(error=>{console.error('FAIL preparation HTTP at '+stage+': '+(error.code??'ASSERTION_OR_CONFIGURATION')+(error.constraint?' ['+error.constraint+']':'')+'; private diagnostics omitted');process.exitCode=1;}).finally(async()=>{
 const live=()=>app&&app.exitCode===null&&app.signalCode===null;
 if(live()){app.kill('SIGTERM');await Promise.race([new Promise(resolve=>app.once('exit',resolve)),pause(5000)]);if(live()){app.kill('SIGKILL');await Promise.race([new Promise(resolve=>app.once('exit',resolve)),pause(1000)]);}if(live()){console.error('FAIL owned server shutdown unconfirmed');process.exitCode=1;}}
 if(db){await db.query('rollback').catch(()=>{});for(const actor of Object.values(actors)){await db.query('delete from makeborne_private.account_privileges where user_id=$1',[actor.id]);await db.query('delete from auth.sessions where user_id=$1',[actor.id]);await actor.client.auth.signOut({scope:'local'}).catch(()=>{});}await db.end();}
 if(!live())console.log('PASS owned server stopped and scoped fixture privileges/sessions removed; synthetic saved preparation fixtures retained, no paid calls');
});
