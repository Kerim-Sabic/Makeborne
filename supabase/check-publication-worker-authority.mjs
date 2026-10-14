// Explicit disposable-only qualification. Never uses local/linked Supabase URLs.
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const container=process.argv[2];
assert.equal(container,'makeborne_publication_20261013034802','Only the inspected publication v54 disposable is permitted');
const migration='supabase/migrations/20261013190000_publication_worker_authority.sql';
const inputs=[migration,'supabase/check-publication-worker-authority.sql','supabase/check-publication-worker-authority.mjs'];
const hash=value=>createHash('sha256').update(value).digest('hex');
const inputHashes=inputs.map(file=>({file,sha256:hash(readFileSync(file))}));
const query=(sql,user='postgres')=>new Promise((resolve,reject)=>{
 const child=spawn('docker',['exec','-i',container,'psql','-h','127.0.0.1','-U',user,'-d','rehearsal','-v','ON_ERROR_STOP=1','-Atq']);
 let output='',error=''; child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>error+=data);
 child.on('error',reject);child.on('close',code=>resolve({code,output:output.trim(),error}));child.stdin.end(sql);
});
const one=async(sql,user)=>{const result=await query(sql,user);assert.equal(result.code,0,result.error);return result.output?JSON.parse(result.output.split('\n').at(-1)):null;};
const lit=value=>`'${String(value).replaceAll("'","''")}'`;
const json=value=>`${lit(JSON.stringify(value))}::jsonb`;
const suffix=randomUUID().replaceAll('-','').slice(0,12), login=`pub_worker_${suffix}`;
const browserLogins=['anon','authenticated','service_role'].map(role=>({role,name:`pub_${role}_${suffix}`}));
const roles=[login,...browserLogins.map(item=>item.name)];
const workerSql=sql=>`set role makeborne_publication_worker;${sql}`;
const rpc=sql=>one(workerSql(`select ${sql};`),login);
const denied=async(sql,user=login,pattern=/permission denied|Publication worker role required/)=>{
 const result=await query(sql,user);assert.notEqual(result.code,0,result.output);assert.match(result.error,pattern);return result;
};
const u=randomUUID(),sess=randomUUID(),w=randomUUID(),project=randomUUID(),artifact=randomUUID(),version=randomUUID(),asset=randomUUID(),worker=randomUUID();
const content={kind:'website',sections:[],websiteSource:{schemaVersion:1,toolchainId:'react-vite-v1',entrypoint:'src/main.tsx',files:[{},{},{},{}],assets:[{id:asset,sha256:'a'.repeat(64),mediaType:'image/png'}],routes:[{path:'/',title:'Home'}]}};
const html='<!doctype html><html><body><h1>Restricted publication fixture</h1></body></html>'+' '.repeat(120);
const output={html,isolatedHtml:html,script:null,files:[],interactive:false,routes:[{path:'/',html,isolatedHtml:html}]};
const request=()=>one(`set role service_role;select public.makeborne_request_publication_preparation('${u}','${sess}',now()+interval '20 minutes','${w}','${artifact}',1,0,'restricted-${suffix}',false,'${randomUUID()}');`);
const claim=(id,idWorker=worker)=>rpc(`public.makeborne_publication_worker_claim('${id}','${idWorker}')`);
const candidates=(limit=10)=>rpc(`public.makeborne_publication_worker_candidates(${limit})`);
const fail=row=>rpc(`public.makeborne_publication_worker_fail('${row.id}','${worker}',${row.fence},'PUBLICATION_TEST_FAILURE')`);
const receipt=row=>({preparationId:row.id,actorId:u,workspaceId:w,projectId:project,artifactId:artifact,versionId:version,versionNumber:1,
 publicationRevision:0,versionContentHash:row.versionContentHash,slug:row.slug,interactive:false,outputHash:hash(JSON.stringify(output))});
const complete=row=>rpc(`public.makeborne_publication_worker_complete('${row.id}','${worker}',${row.fence},${json(receipt(row))},${lit(JSON.stringify(output))})`);
const checks=[];
const evidence={container,startedAt:new Date().toISOString(),passed:false,providerCalls:0,cloudWrites:0,productionTouched:false,stagingTouched:false,checks,inputHashes};
try {
 assert.equal(await one("select to_json(count(*)) from supabase_migrations.schema_migrations where version='20261013180000';"),1);
 const catalog=await query(readFileSync('supabase/check-publication-worker-authority.sql','utf8'));assert.equal(catalog.code,0,catalog.error);
 checks.push('catalog: explicit preparation/journal RPC grants; role attributes and no table/unrelated function access; original service grants retained');
 await one(`create role ${login} login noinherit;grant makeborne_publication_worker to ${login};
 ${browserLogins.map(({role,name})=>`create role ${name} login noinherit;grant ${role} to ${name};`).join('\n')}
 select '{}'::json;`);
 await denied('select public.makeborne_publication_worker_candidates(1);');
 for(const {role,name} of browserLogins){
  await denied(`set role ${role};set role makeborne_publication_worker;`,name,/permission denied to set role/);
  await denied(`set role ${role};set request.jwt.claims='{"role":"makeborne_publication_worker"}';select public.makeborne_publication_worker_candidates(1);`,name);
 }
 assert.deepEqual(await candidates(),[]);
 await denied(workerSql("select * from makeborne_private.publication_preparations;"));
 await denied(workerSql(`select public.makeborne_claim_publication_preparation('${randomUUID()}','${worker}');`));
 await denied(workerSql(`select public.makeborne_promote_publication_preparation('${randomUUID()}','${u}','${sess}',now());`));
 await denied(workerSql(`select public.makeborne_request_publication_preparation('${u}','${sess}',now(),'${w}','${artifact}',1,0,'forbidden',false,'${randomUUID()}');`));
 checks.push('real dedicated LOGIN requires SET ROLE; anon/authenticated/service LOGIN memberships cannot SET ROLE worker or spoof JWT; raw/request/promote/legacy claim denied');
 await one(`insert into auth.users(id,email,email_confirmed_at) values('${u}','${u}@restricted-publication.invalid',now());
 insert into auth.sessions(id,user_id) values('${sess}','${u}');
 insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values('${u}',true,false,'Restricted worker fixture');
 insert into public.workspaces(id,name,owner_id) values('${w}','Restricted worker fixture','${u}');
 insert into public.projects(id,workspace_id,title,kind) values('${project}','${w}','Restricted worker fixture','website');
 insert into public.artifacts(id,workspace_id,project_id,title,kind) values('${artifact}','${w}','${project}','Restricted worker fixture','website');
 insert into public.assets(id,workspace_id,project_id,object_path,content_type,sha256) values('${asset}','${w}','${project}','${w}/${project}/fixture.png','image/png','${'a'.repeat(64)}');
 insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,content,style_snapshot,created_by,asset_manifest) values('${version}','${w}','${artifact}',1,${json(content)},'{}','${u}',${json([asset])});
 update public.artifacts set current_version=1 where id='${artifact}';select '{}'::json;`);
 const first=await request();assert.deepEqual(await candidates(1),[{id:first.id}]);
 for(const value of ['0','26','null']) await denied(workerSql(`select public.makeborne_publication_worker_candidates(${value});`),login,/Candidate limit/);
 const claims=await Promise.all([claim(first.id),claim(first.id,randomUUID())]);assert.equal(claims.filter(Boolean).length,1);
 assert.deepEqual(await candidates(),[]);
 await one(`update makeborne_private.publication_preparations set lease_until=clock_timestamp()-interval '1 second' where id='${first.id}';select '{}'::json;`);
 assert.deepEqual(await candidates(1),[{id:first.id}]);
 const reclaimed=await claim(first.id);assert.equal(reclaimed.fence,'2');assert.equal(reclaimed.attempts,2);
 await denied(workerSql(`select public.makeborne_publication_worker_load('${first.id}','${worker}',1);`),login,/Preparation lease changed/);
 const loaded=await rpc(`public.makeborne_publication_worker_load('${first.id}','${worker}',2)`);assert.equal(loaded.versionId,version);
 assert.equal(loaded.assetRecords.length,1);
 const located=await rpc(`public.makeborne_publication_worker_asset_locator('${first.id}','${worker}',2,'${asset}')`);assert.equal(located.object_path,`${w}/${project}/fixture.png`);
 await denied(workerSql(`select public.makeborne_publication_worker_asset_locator('${first.id}','${worker}',2,'${randomUUID()}');`),login,/Preparation asset unavailable/);
 await denied(workerSql(`select public.makeborne_publication_worker_asset_locator('${first.id}','${randomUUID()}',2,'${asset}');`),login,/Preparation lease changed/);
 checks.push('concurrent claims grant one lease; active lease excluded; expired lease rediscovered/reclaimed with increased fence; stale/cross-worker loads and unrelated assets denied');
 const done=await complete(reclaimed);assert.equal(done.state,'ready');assert.deepEqual(await complete(reclaimed),done);
 await denied(workerSql(`select public.makeborne_publication_worker_fail('${first.id}','${worker}',2,'late');`),login,/Preparation lease changed/);
 assert.deepEqual(await candidates(),[]);
 checks.push('restricted completion retains immutable ready output; lost-response completion replay exact; late failure cannot overwrite ready output');
 const retry=await request();for(let attempt=1;attempt<=3;attempt++){const row=await claim(retry.id);assert.equal(row.attempts,attempt);assert.equal((await fail(row)).state,attempt===3?'failed':'queued');}
 assert.equal(await claim(retry.id),null);
 checks.push('three claim/fail cycles exhaust retries and permanently leave candidate discovery');
 const abandoned=await request();
 for(let attempt=1;attempt<=3;attempt++){
  const row=await claim(abandoned.id);assert.equal(row.attempts,attempt);
  await one(`update makeborne_private.publication_preparations set lease_until=clock_timestamp()-interval '1 second' where id='${row.id}';select '{}'::json;`);
 }
 assert.deepEqual(await candidates(),[]);
 assert.equal(await one(`select to_json(state) from makeborne_private.publication_preparations where id='${abandoned.id}';`),'failed');
 checks.push('third abandoned lease is terminalized by discovery without another claim or failure callback');
 const valid=await request();
 await one(`insert into makeborne_private.publication_preparations(actor_id,requested_session_id,workspace_id,project_id,artifact_id,version_id,version_number,publication_revision,version_content_hash,slug,interactive,request_id,expires_at,created_at,updated_at)
 select actor_id,requested_session_id,workspace_id,project_id,artifact_id,version_id,version_number,publication_revision,version_content_hash,slug,interactive,gen_random_uuid(),clock_timestamp()-interval '1 hour',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '2 hours'
 from makeborne_private.publication_preparations cross join generate_series(1,105) where id='${valid.id}';select '{}'::json;`);
 assert.deepEqual(await candidates(1),[{id:valid.id}]);
 assert.equal(await one(`select to_json(count(*)) from makeborne_private.publication_preparations where workspace_id='${w}' and state='expired';`),100);
 assert.deepEqual(await candidates(1),[{id:valid.id}]);
 assert.equal(await one(`select to_json(count(*)) from makeborne_private.publication_preparations where workspace_id='${w}' and state='expired';`),105);
 assert.equal(await one(`select to_json(state) from makeborne_private.publication_preparations where id='${first.id}';`),'ready');
 checks.push('105 expired rows cleaned in bounded100+5 batches without starving usable work; ready output untouched');
 const queuedIds=await one(`with inserted as (
 insert into makeborne_private.publication_preparations(actor_id,requested_session_id,workspace_id,project_id,artifact_id,version_id,version_number,publication_revision,version_content_hash,slug,interactive,request_id)
 select actor_id,requested_session_id,workspace_id,project_id,artifact_id,version_id,version_number,publication_revision,version_content_hash,slug,interactive,gen_random_uuid()
 from makeborne_private.publication_preparations cross join generate_series(1,30) where id='${valid.id}' returning id)
 select json_agg(id) from inserted;`);
 const bounded=await candidates(25);assert.equal(bounded.length,25);assert.ok(bounded.every(item=>Object.keys(item).join(',')==='id'));
 assert.deepEqual(await candidates(25),bounded);
 await one(`delete from makeborne_private.publication_preparations where id=any(array[${queuedIds.map(lit).join(',')}]::uuid[]);select '{}'::json;`);
 checks.push('candidate response capped at25 ids without source/actor data and deterministic on an unchanged queue');
 // Unexpected cleanup database errors must escape, rolling back the statement.
 await one(`update makeborne_private.publication_preparations set expires_at=clock_timestamp()-interval '1 second' where id='${valid.id}';select '{}'::json;`);
 const fault=await query(`begin;create function pg_temp.publication_injected_fault() returns trigger language plpgsql as $$begin raise exception 'INJECTED_UNEXPECTED_FAULT' using errcode='XX000';end$$;
 create trigger publication_injected_fault before update on makeborne_private.publication_preparations for each row when(old.id='${valid.id}') execute function pg_temp.publication_injected_fault();
 grant makeborne_publication_worker to postgres;set role makeborne_publication_worker;select public.makeborne_publication_worker_candidates(1);`);
 assert.notEqual(fault.code,0);assert.match(fault.error,/INJECTED_UNEXPECTED_FAULT/);
 assert.equal(await one(`select to_json(state) from makeborne_private.publication_preparations where id='${valid.id}';`),'queued');
 assert.deepEqual(await candidates(1),[]);
 checks.push('unexpected cleanup SQL fault propagates and rolls back; retry then terminalizes expired work');
 const revoked=await request();await one(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${sess}';select '{}'::json;`);
 assert.equal(await claim(revoked.id),null);assert.deepEqual(await candidates(),[]);
 assert.equal(await one(`select to_json(error) from makeborne_private.publication_preparations where id='${revoked.id}';`),'PUBLICATION_AUTHORITY_UNAVAILABLE');
 checks.push('revoked session before claim terminalizes unusable work rather than repeatedly returning a starving candidate');
 evidence.changedInputs=inputHashes.filter(item=>hash(readFileSync(item.file))!==item.sha256).map(item=>item.file);
 assert.deepEqual(evidence.changedInputs,[]);evidence.passed=true;
}catch(error){evidence.error=String(error?.stack??error);process.exitCode=1;}
finally{
 const cleanup=await query(`delete from public.workspaces where id='${w}';delete from auth.users where id='${u}';${roles.map(role=>`drop role if exists ${role};`).join('\n')}`);
 if(cleanup.code!==0){evidence.cleanupError=cleanup.error;evidence.passed=false;process.exitCode=1;}
 evidence.finishedAt=new Date().toISOString();writeFileSync('docs/release-review/publication-worker-authority-20261013.json',JSON.stringify(evidence,null,2)+'\n');
}
console.log(JSON.stringify(evidence,null,2));
