// Real SQL, synthetic metadata, explicit disposable only. No SDK/provider calls.
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const container=process.argv[2];assert.equal(container,'makeborne_publication_20261013034802');
const migration='supabase/migrations/20261013210000_publication_sandbox_journal.sql';
const hash=v=>createHash('sha256').update(v).digest('hex');
const query=(sql,user='postgres')=>new Promise((resolve,reject)=>{
 const child=spawn('docker',['exec','-i',container,'psql','-h','127.0.0.1','-U',user,'-d','rehearsal','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-Atq']);
 let output='',error='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>error+=v);child.on('error',reject);
 child.on('close',code=>resolve({code,output:output.trim(),error}));child.stdin.end(sql);
});
const one=async(sql,user)=>{const r=await query(sql,user);assert.equal(r.code,0,r.error);return r.output?JSON.parse(r.output.split('\n').at(-1)):null;};
const lit=v=>`'${String(v).replaceAll("'","''")}'`,json=v=>`${lit(JSON.stringify(v))}::jsonb`;
const suffix=randomUUID().replaceAll('-','').slice(0,10),login=`sj_worker_${suffix}`;
const deniedLogins=['anon','authenticated','service_role'].map(role=>({role,name:`sj_${role}_${suffix}`}));
const sqlRole=s=>`set role makeborne_publication_worker;${s}`;
const rpc=s=>one(sqlRole(`select ${s};`),login);
const denied=async(sql,pattern=/PT409:/,user=login)=>{const r=await query(sql,user);assert.notEqual(r.code,0,r.output);assert.match(r.error,pattern);};
const event=r=>rpc(`public.makeborne_publication_worker_sandbox_event(${json(r)})`);
const denyEvent=(r,pattern)=>denied(sqlRole(`select public.makeborne_publication_worker_sandbox_event(${json(r)});`),pattern);
const worker=randomUUID(),cleaner=randomUUID(),u=randomUUID(),session=randomUUID(),w=randomUUID(),project=randomUUID(),artifact=randomUUID(),version=randomUUID();
const prepIds=[],names=[];
const claim=async()=>{
 const p=await one(`set role service_role;select public.makeborne_request_publication_preparation('${u}','${session}',now()+interval '30 minutes','${w}','${artifact}',1,0,'journal-${suffix}',false,'${randomUUID()}');`);
 prepIds.push(p.id);return rpc(`public.makeborne_publication_worker_claim('${p.id}','${worker}')`);
};
const record=(p,kind='compiler')=>{const name=`mbpub-${kind}-${randomUUID()}`;names.push(name);return {preparationId:p.id,workerId:worker,fence:p.fence,leaseUntil:p.leaseUntil,name,kind,image:`vcr.vercel.com/fixture/${kind}@sha256:${'a'.repeat(64)}`,evidenceSha256:'b'.repeat(64),runtimeIdentity:kind==='compiler'?`sha256:${'c'.repeat(64)}`:`chromium-130.0-controller-${'c'.repeat(64)}`,latestExpectedExpiry:new Date(Date.parse(p.leaseUntil)-5000).toISOString(),state:'creating'};};
const cleanup=(who=cleaner,limit=1)=>rpc(`public.makeborne_publication_worker_sandbox_cleanup_claim('${who}',${limit})`);
const finish=(r,state='stopped',who=cleaner)=>rpc(`public.makeborne_publication_worker_sandbox_cleanup_finish(${lit(r.record.name)},'${who}',${r.cleanupFence},'${state}')`);
const expire=name=>one(`update makeborne_private.publication_sandboxes set lease_until=clock_timestamp()-interval '1 second',next_cleanup_at=clock_timestamp()-interval '1 second' where name=${lit(name)};select '{}'::json;`);
const checks=[],evidence={container,startedAt:new Date().toISOString(),passed:false,cloudWrites:0,providerCalls:0,migration,sha256:hash(readFileSync(migration)),checks};
try{
 assert.equal(await one("select to_json(mode) from makeborne_private.site_address_namespace_policy;"),'production');
 await one(`create role ${login} login noinherit;grant makeborne_publication_worker to ${login};${deniedLogins.map(({role,name})=>`create role ${name} login noinherit;grant ${role} to ${name};`).join('')}select '{}'::json;`);
 await denied('select public.makeborne_publication_worker_sandbox_cleanup_claim(null,1);',/42501:/);
 for(const {role,name} of deniedLogins){
  await denied(`set role ${role};select public.makeborne_publication_worker_sandbox_cleanup_claim('${cleaner}',1);`,/42501:/,name);
  await denied(`set role ${role};set request.jwt.claims='{"role":"makeborne_publication_worker"}';set role makeborne_publication_worker;`,/42501:/,name);
 }
 await denied(sqlRole('select * from makeborne_private.publication_sandboxes;'),/42501:/);
 await denied(sqlRole(`update makeborne_private.publication_sandboxes set state='stopped';`),/42501:/);
 const catalog=await query(readFileSync('supabase/check-publication-worker-authority.sql','utf8'));assert.equal(catalog.code,0,catalog.error);
 const journalCatalog=await query(readFileSync('supabase/check-publication-sandbox-journal.sql','utf8'));assert.equal(journalCatalog.code,0,journalCatalog.error);
 checks.push('real LOGIN role boundary: explicit SET ROLE required, browser/service cannot escalate or call, worker has no journal table access, exact RPC catalog passes');
 const content={kind:'website',sections:[],websiteSource:{schemaVersion:1,toolchainId:'react-vite-v1',entrypoint:'src/main.tsx',files:[{},{},{},{}],assets:[],routes:[{path:'/',title:'Home'}]}};
 await one(`insert into auth.users(id,email,email_confirmed_at) values('${u}','${u}@sandbox-journal.invalid',now());insert into auth.sessions(id,user_id) values('${session}','${u}');
 insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values('${u}',true,false,'Sandbox journal fixture');
 insert into public.workspaces(id,name,owner_id) values('${w}','Sandbox journal fixture','${u}');insert into public.projects(id,workspace_id,title,kind) values('${project}','${w}','Sandbox journal fixture','website');
 insert into public.artifacts(id,workspace_id,project_id,title,kind) values('${artifact}','${w}','${project}','Sandbox journal fixture','website');
 insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,content,style_snapshot,created_by) values('${version}','${w}','${artifact}',1,${json(content)},'{}','${u}');update public.artifacts set current_version=1 where id='${artifact}';select '{}'::json;`);
 const p=await claim(),r=record(p);
 for(const malformed of [null,{}, {...r,secret:'forbidden'},{...r,fence:1},{...r,state:'running'},{...r,image:'latest'},{...r,leaseUntil:'infinity'},{...r,workerId:null},{...r,evidenceSha256:'bad'},{...r,providerExpiresAt:r.latestExpectedExpiry}]) await denyEvent(malformed,/22023:/);
 await denyEvent({...r,workerId:randomUUID()});await denyEvent({...r,fence:'99'});await denyEvent({...r,leaseUntil:new Date(Date.parse(r.leaseUntil)+1000).toISOString()});
 checks.push('strict bounded event schema rejects unknown/secret fields, wrong scalar types, mutable images, invalid identities/timestamps and unmatched claim/worker/fence/lease');
 const competing=record(p);const outcomes=await Promise.all([query(sqlRole(`select public.makeborne_publication_worker_sandbox_event(${json(r)});`),login),query(sqlRole(`select public.makeborne_publication_worker_sandbox_event(${json(competing)});`),login)]);
 assert.equal(outcomes.filter(v=>v.code===0).length,1);const winner=outcomes[0].code===0?r:competing;
 const created=await event(winner);assert.equal(created.state,'creating');assert.deepEqual(await event({...winner,leaseUntil:winner.leaseUntil.replace('+00:00','Z')}),created);
 assert.deepEqual(await cleanup(),{records:[],pending:0});
 checks.push('concurrent per-attempt creation admits one intent, replay is stable, equivalent timestamp formats accepted, active peer is excluded from cleanup/pending');
 const running={...created,state:'running',sessionId:'session-fixture',providerExpiresAt:new Date(Date.parse(created.latestExpectedExpiry)-1000).toISOString()};
 const started=await event(running);assert.equal(started.state,'running');
 for(const changed of [{image:`vcr.vercel.com/other@sha256:${'a'.repeat(64)}`},{evidenceSha256:'d'.repeat(64)},{runtimeIdentity:`sha256:${'d'.repeat(64)}`},{sessionId:'different'},{providerExpiresAt:new Date(Date.parse(running.providerExpiresAt)-1000).toISOString()}])await denyEvent({...running,...changed});
 await denyEvent(created);const stopped=await event({...started,state:'stopped'});assert.deepEqual(await event(stopped),stopped);
 await denyEvent({...stopped,state:'cleanup_unconfirmed'});await denyEvent({...stopped,sessionId:'changed'});await denyEvent({...stopped,image:`vcr.vercel.com/changed@sha256:${'a'.repeat(64)}`});
 await denyEvent(record(p));
 checks.push('running binds provider session/expiry once; immutable image/evidence/runtime preserved, monotonic terminal stop and exact stopped replay, compiler capped at one');
 for(let i=0;i<20;i++){const route=await event(record(p,'renderer'));await event({...route,state:'stopped'});}await denyEvent(record(p,'renderer'));
 checks.push('renderer intents capped at20 per claim and unresolved resources prevent parallel create admission');
 const old=await claim(),oldRecord=await event(record(old));
 await one(`update makeborne_private.publication_preparations set lease_until=clock_timestamp()-interval '1 second' where id='${old.id}';select '{}'::json;`);
 await denyEvent({...oldRecord,state:'running',sessionId:'late',providerExpiresAt:oldRecord.latestExpectedExpiry});
 assert.equal((await event({...oldRecord,state:'cleanup_unconfirmed'})).state,'cleanup_unconfirmed');
 const [a,b]=await Promise.all([cleanup(),cleanup(randomUUID())]);assert.equal(a.records.length+b.records.length,1);
 const acquired=a.records[0]??b.records[0],owner=a.records.length?cleaner:await one(`select to_json(cleanup_worker_id) from makeborne_private.publication_sandboxes where name=${lit(oldRecord.name)};`);
 assert.equal(acquired.record.name,oldRecord.name);assert.equal(acquired.cleanupFence,'1');assert.equal((await cleanup()).pending,1);
 await denyEvent({...acquired.record,state:'stopped'});
 await denied(sqlRole(`select public.makeborne_publication_worker_sandbox_cleanup_finish(${lit(oldRecord.name)},'${randomUUID()}',1,'stopped');`));
 await denied(sqlRole(`select public.makeborne_publication_worker_sandbox_cleanup_finish(${lit(oldRecord.name)},'${owner}',1,'running');`),/22023:/);
 const unknown=await finish(acquired,'cleanup_unconfirmed',owner);assert.deepEqual(await finish(acquired,'cleanup_unconfirmed',owner),unknown);
 await denied(sqlRole(`select public.makeborne_publication_worker_sandbox_cleanup_finish(${lit(oldRecord.name)},'${owner}',1,'stopped');`));
 assert.deepEqual(await cleanup(),{records:[],pending:1});
 checks.push('expired execution cannot run but original cleanup persists; concurrent cleaners grant one separate fence, no source/resume state, exact finish replay and hidden-backoff pending retained');
 const orphan=await claim(),orphanRecord=await event(record(orphan));
 await one(`delete from makeborne_private.publication_preparations where id='${orphan.id}';select '{}'::json;`);
 const newer=await cleanup();assert.equal(newer.records[0].record.name,orphanRecord.name);assert.equal(newer.pending,2);await finish(newer.records[0]);
 await one(`update makeborne_private.publication_sandboxes set cleanup_lease_until=clock_timestamp()-interval '1 second',next_cleanup_at=clock_timestamp()-interval '1 second' where name=${lit(oldRecord.name)};select '{}'::json;`);
 const reclaimed=(await cleanup()).records[0];assert.equal(reclaimed.cleanupFence,'2');
 await denied(sqlRole(`select public.makeborne_publication_worker_sandbox_cleanup_finish(${lit(oldRecord.name)},'${owner}',1,'stopped');`));
 const cleaned=await finish(reclaimed);assert.deepEqual(await finish(reclaimed),cleaned);assert.deepEqual(await cleanup(),{records:[],pending:0});
 checks.push('deleted preparation retains cleanup obligation; old backoff record does not starve newer orphan; expired cleanup lease increments fence, stale cleaner denied and terminal replay stable');
 const replaced=await claim(),previous=await event(record(replaced));
 await rpc(`public.makeborne_publication_worker_fail('${replaced.id}','${worker}',${replaced.fence},'PUBLICATION_TEST_FAILURE')`);
 const replacement=await rpc(`public.makeborne_publication_worker_claim('${replaced.id}','${worker}')`),next=record(replacement);
 assert.equal(replacement.fence,'2');
 // Admission first, then recovery: the old resource blocks a fresh name even
 // though its original recorded deadline is still in the future.
 await denyEvent(next);
 const cleanedOld=(await cleanup()).records[0];assert.equal(cleanedOld.record.name,previous.name);
 // Recovery owns the old resource first; competing fresh creation still fails.
 const parallel=await Promise.all([query(sqlRole(`select public.makeborne_publication_worker_sandbox_event(${json(next)});`),login),cleanup(randomUUID())]);
 assert.notEqual(parallel[0].code,0);assert.match(parallel[0].error,/PT409:/);assert.equal(parallel[1].pending,1);assert.deepEqual(parallel[1].records,[]);
 await finish(cleanedOld);const admitted=await event(next);await event({...admitted,state:'stopped'});
 assert.deepEqual(await cleanup(),{records:[],pending:0});
 checks.push('reclaimed preparation cannot create across an unresolved earlier fence; admission-before-recovery and recovery-before-concurrent-admission fail closed, cleanup permits new intent');
 const dead=await claim(),deadRecord=await event(record(dead));await expire(deadRecord.name);
 await one(`delete from public.workspaces where id='${w}';delete from auth.users where id='${u}';select '{}'::json;`);
 assert.equal((await cleanup()).records[0].record.name,deadRecord.name);
 checks.push('workspace/account/source cascades cannot erase unresolved sandbox journal');
 const retentionPrefix=`mbpub-compiler-`;
 await one(`insert into makeborne_private.publication_sandboxes(name,preparation_id,worker_id,fence,lease_until,kind,image,evidence_sha256,runtime_identity,latest_expected_expiry,state,next_cleanup_at,stopped_at)
 select '${retentionPrefix}'||gen_random_uuid(),'${p.id}','${worker}',1,clock_timestamp()-interval '32 days','compiler','fixture','fixture','fixture',clock_timestamp()-interval '32 days','stopped',clock_timestamp()-interval '32 days',clock_timestamp()-interval '31 days' from generate_series(1,105);select '{}'::json;`);
 const oldCount=()=>one(`select to_json(count(*)) from makeborne_private.publication_sandboxes where preparation_id='${p.id}' and stopped_at<clock_timestamp()-interval '30 days';`);
 await cleanup();assert.equal(await oldCount(),5);await cleanup();assert.equal(await oldCount(),0);
 assert.equal(await one(`select to_json(count(*)) from makeborne_private.publication_sandboxes where name=${lit(deadRecord.name)};`),1);
 for(const invalid of ['0','26','null'])await denied(sqlRole(`select public.makeborne_publication_worker_sandbox_cleanup_claim('${cleaner}',${invalid});`),/22023:/);
 checks.push('cleanup batch bounds enforced; stopped retention prunes at most100 older30day rows per poll; unresolved survives age/retention and remains pending');
 assert.equal(hash(readFileSync(migration)),evidence.sha256);evidence.passed=true;
}catch(error){evidence.error=String(error?.stack??error);process.exitCode=1;}
finally{
 const cleanupResult=await query(`delete from makeborne_private.publication_sandboxes where worker_id='${worker}';delete from public.hosted_sites where workspace_id='${w}';delete from public.workspaces where id='${w}';delete from auth.users where id='${u}';drop role if exists ${login};${deniedLogins.map(({name})=>`drop role if exists ${name};`).join('')}`);
 if(cleanupResult.code!==0){evidence.cleanupError=cleanupResult.error;evidence.passed=false;process.exitCode=1;}
 evidence.finishedAt=new Date().toISOString();writeFileSync('docs/release-review/publication-sandbox-journal-20261013.json',JSON.stringify(evidence,null,2)+'\n');
}
console.log(JSON.stringify(evidence,null,2));
