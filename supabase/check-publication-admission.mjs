// Real concurrency reproduction/regression, strictly scoped to the inspected disposable.
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const container=process.argv[2];
assert.equal(container,'makeborne_publication_20261013034802');
const query=sql=>new Promise((resolve,reject)=>{
 const child=spawn('docker',['exec','-i',container,'psql','-h','127.0.0.1','-U','postgres','-d','rehearsal','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-Atq']);
 let output='',error='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>error+=chunk);
 child.on('error',reject);child.on('close',code=>resolve({code,output:output.trim(),error}));child.stdin.end(sql);
});
const one=async sql=>{const result=await query(sql);assert.equal(result.code,0,result.error);return result.output?JSON.parse(result.output.split('\n').at(-1)):null;};
const lit=x=>`'${String(x).replaceAll("'","''")}'`;
const u=randomUUID(),other=randomUUID(),sess=randomUUID(),otherSess=randomUUID();
const scopes=[0,1,2].map(index=>({actor:index===2?other:u,session:index===2?otherSess:sess,w:randomUUID(),p:randomUUID(),a:randomUUID(),v:randomUUID()}));
scopes[1].w=scopes[0].w;
const content={kind:'website',sections:[],websiteSource:{schemaVersion:1,toolchainId:'react-vite-v1',entrypoint:'src/main.tsx',files:[{},{},{},{}],assets:[],routes:[{path:'/',title:'Home'}]}};
const request=(scope,key,privateCall=false)=>`${privateCall?'makeborne_private.request_publication_preparation':'public.makeborne_request_publication_preparation'}('${scope.actor}','${scope.session}',clock_timestamp()+interval '20 minutes','${scope.w}','${scope.a}',1,0,'admission-${scope.a.slice(0,8)}',false,'${key}')`;
const service=sql=>query(`set role service_role;select ${sql};`);
const trigger=`publication_admission_probe_${u.replaceAll('-','')}`;
const checks=[];let holder;
const evidence={container,hypothesis:'Distinct request IDs in different owned workspaces bypass the actor admission cap',conclusion:'Falsified by existing one-owned-workspace invariant and workspace lock; no migration required',startedAt:new Date().toISOString(),passed:false,providerCalls:0,cloudWrites:0,checks};
try{
 const migrated=await one("select to_json(to_regprocedure('makeborne_private.request_publication_preparation_v54(uuid,uuid,timestamptz,uuid,uuid,integer,integer,text,boolean,uuid)') is not null);");
 assert.equal(migrated,false,'This regression checks unchanged v54 implementation plus worker authority v55');
 await one(`insert into auth.users(id,email,email_confirmed_at) values('${u}','${u}@admission.invalid',now()),('${other}','${other}@admission.invalid',now());
 insert into auth.sessions(id,user_id) values('${sess}','${u}'),('${otherSess}','${other}');
 insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values('${u}',true,false,'Admission race fixture'),('${other}',true,false,'Admission unrelated actor');
 ${scopes.map((s,i)=>`${i===1?'':`insert into public.workspaces(id,name,owner_id) values('${s.w}','Admission fixture','${s.actor}');`}
 insert into public.projects(id,workspace_id,title,kind) values('${s.p}','${s.w}','Admission fixture','website');
 insert into public.artifacts(id,workspace_id,project_id,title,kind) values('${s.a}','${s.w}','${s.p}','Admission fixture','website');
 insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,content,style_snapshot,created_by) values('${s.v}','${s.w}','${s.a}',1,${lit(JSON.stringify(content))}::jsonb,'{}','${s.actor}');
 update public.artifacts set current_version=1 where id='${s.a}';`).join('\n')}select '{}'::json;`);
 const forbiddenWorkspace=await query(`insert into public.workspaces(id,name,owner_id) values('${randomUUID()}','Forbidden second owned workspace','${u}');`);
 assert.notEqual(forbiddenWorkspace.code,0);assert.match(forbiddenWorkspace.error,/one_owned_workspace_per_user/);
 checks.push('second owned workspace is rejected by production one_owned_workspace_per_user unique index; hypothesized cross-workspace race is unreachable');
 const wrongOwner=await service(request({...scopes[0],actor:other,session:otherSess},randomUUID()));
 assert.notEqual(wrongOwner.code,0);assert.match(wrongOwner.error,/42501: Owner required/);
 checks.push('a valid session for another actor cannot admit a preparation in the existing owned workspace');
 const originalKey=randomUUID(),initial=await service(request(scopes[0],originalKey));assert.equal(initial.code,0,initial.error);const initialRow=JSON.parse(initial.output);
 await one(`insert into makeborne_private.publication_preparations(actor_id,requested_session_id,workspace_id,project_id,artifact_id,version_id,version_number,publication_revision,version_content_hash,slug,interactive,request_id)
 select actor_id,requested_session_id,workspace_id,project_id,artifact_id,version_id,version_number,publication_revision,version_content_hash,slug,interactive,gen_random_uuid()
 from makeborne_private.publication_preparations cross join generate_series(1,28) where id='${initialRow.id}';select '{}'::json;`);
 assert.equal(await one(`select to_json(count(*)) from makeborne_private.publication_preparations where actor_id='${u}';`),29);
 // Pause at INSERT, after admission count, making the previously unprotected
 // overlap reproducible without rewriting the old implementation under test.
 await one(`create function makeborne_private.${trigger}() returns trigger language plpgsql set search_path='' as $$begin perform pg_sleep(1);return new;end$$;
 create trigger ${trigger} before insert on makeborne_private.publication_preparations for each row when(new.actor_id='${u}') execute function makeborne_private.${trigger}();select '{}'::json;`);
 const keys=[randomUUID(),randomUUID()];
 const results=await Promise.all([service(request(scopes[0],keys[0])),service(request(scopes[1],keys[1],true))]);
 const accepted=results.filter(result=>result.code===0);
 assert.equal(accepted.length,1,JSON.stringify(results));
 assert.match(results.find(result=>result.code!==0).error,/MB429: Preparation limit reached/);
 const count=await one(`select to_json(count(*)) from makeborne_private.publication_preparations where actor_id='${u}';`);
 assert.equal(count,30);evidence.race={startingCount:29,workspaces:1,distinctArtifacts:2,distinctRequestIds:true,accepted:accepted.length,finalCount:count,errors:results.filter(r=>r.code!==0).map(r=>r.error)};
 checks.push('existing public and private request paths lock the unique owned workspace: exactlyone of two distinct-artifact requests succeeds at29; other failsMB429 at30');
 const replay=await service(request(scopes[0],originalKey));assert.equal(replay.code,0,replay.error);assert.equal(JSON.parse(replay.output).id,initialRow.id);
 assert.equal(await one(`select to_json(count(*)) from makeborne_private.publication_preparations where actor_id='${u}';`),count);
 checks.push('original request replay remains valid above/at cap without a new preparation');
 await one(`drop trigger ${trigger} on makeborne_private.publication_preparations;drop function makeborne_private.${trigger}();select '{}'::json;`);
 {
  // Hold actor A's existing workspace lock and prove actor B still progresses.
  holder=spawn('docker',['exec','-i',container,'psql','-h','127.0.0.1','-U','postgres','-d','rehearsal','-v','ON_ERROR_STOP=1','-Atq']);
  let heldOutput='',heldError='';const heldClosed=new Promise(resolve=>holder.on('close',resolve));holder.stderr.on('data',chunk=>heldError+=chunk);
  const held=new Promise((resolve,reject)=>{holder.stdout.on('data',chunk=>{heldOutput+=chunk;if(heldOutput.includes('HELD'))resolve();});holder.on('error',reject);});
  holder.stdin.write(`begin;select id from public.workspaces where id='${scopes[0].w}' for update;\n\\echo HELD\n`);
  await held;
  const application=`admission_wait_${u.replaceAll('-','')}`;
  const waiting=query(`set application_name='${application}';set role service_role;select ${request(scopes[0],originalKey)};`);
  let blocked=false;
  for(let i=0;i<30&&!blocked;i++){
   blocked=await one(`select to_json(exists(select 1 from pg_stat_activity where application_name='${application}' and wait_event_type='Lock' and wait_event in ('transactionid','tuple')));`);
   if(!blocked)await new Promise(resolve=>setTimeout(resolve,30));
  }
  assert.equal(blocked,true,'same actor did not wait on owned workspace lock');
  const unrelated=await service(request(scopes[2],randomUUID()));assert.equal(unrelated.code,0,unrelated.error);
  holder.stdin.end('rollback;\n');assert.equal(await heldClosed,0,heldError);holder=undefined;
  const recovered=await waiting;assert.equal(recovered.code,0,recovered.error);assert.equal(JSON.parse(recovered.output).id,initialRow.id);
  checks.push('same actor waits on existing workspace lock; unrelated actor admits while lock held; replay resumes after release');
 }
 evidence.passed=true;
}catch(error){evidence.error=String(error?.stack??error);process.exitCode=1;}
finally{
 if(holder){holder.stdin.end('rollback;\n');await new Promise(resolve=>holder.once('close',resolve));}
 const cleanup=await query(`drop trigger if exists ${trigger} on makeborne_private.publication_preparations;drop function if exists makeborne_private.${trigger}();
 delete from public.workspaces where id=any(array[${scopes.map(s=>lit(s.w)).join(',')}]::uuid[]);delete from auth.users where id in ('${u}','${other}');`);
 if(cleanup.code!==0){evidence.cleanupError=cleanup.error;evidence.passed=false;process.exitCode=1;}
 evidence.finishedAt=new Date().toISOString();
 const file='docs/release-review/publication-admission-20261013.json';
 evidence.harnessSha256=createHash('sha256').update(readFileSync('supabase/check-publication-admission.mjs')).digest('hex');
 writeFileSync(file,JSON.stringify(evidence,null,2)+'\n');
}
console.log(JSON.stringify(evidence,null,2));
