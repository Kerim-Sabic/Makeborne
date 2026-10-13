// Synthetic fixture only, restricted to this package's disposable containers.
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const container=process.argv[2];
assert.match(container??'',/^makeborne_publication_\d{14}$/);
const query=sql=>new Promise((resolve,reject)=>{
 const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','rehearsal','-v','ON_ERROR_STOP=1','-Atq']);
 let output='',error='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>error+=x);
 child.on('error',reject);child.on('close',code=>resolve({code,output:output.trim(),error}));child.stdin.end(sql);
});
const one=async sql=>{const r=await query(sql);assert.equal(r.code,0,r.error);return r.output ? JSON.parse(r.output.split('\n').at(-1)) : null;};
const literal=x=>`'${String(x).replaceAll("'","''")}'`;
const json=x=>literal(JSON.stringify(x));
const rpc=sql=>one(`set role service_role;select ${sql};`);
const u=randomUUID(),sess=randomUUID(),w=randomUUID(),project=randomUUID(),a=randomUUID(),version=randomUUID(),worker=randomUUID();
const html='<!doctype html><html><body><h1>Concurrent trusted publication</h1></body></html>'+' '.repeat(120);
const content={kind:'website',sections:[],websiteSource:{schemaVersion:1,toolchainId:'react-vite-v1',entrypoint:'src/main.tsx',files:[{},{},{},{}],assets:[],routes:[{path:'/',title:'Home'}]}};
const output={html,isolatedHtml:html,script:null,files:[],interactive:false,routes:[{path:'/',html,isolatedHtml:html}]};
const access=`'${u}','${sess}',now()+interval '20 minutes'`;
const request=(key,revision=0,v=1)=>`public.makeborne_request_publication_preparation(${access},'${w}','${a}',${v},${revision},'publication-${a.slice(0,8)}',false,'${key}')`;
const promote=id=>`public.makeborne_promote_publication_preparation('${id}',${access})`;
const checks=[];
try {
 await one(`insert into auth.users(id,email,email_confirmed_at) values('${u}','${u}@publication-concurrency.invalid',now());
 insert into auth.sessions(id,user_id) values('${sess}','${u}');
 insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values('${u}',true,false,'Concurrency fixture');
 insert into public.workspaces(id,name,owner_id) values('${w}','Publication concurrency','${u}');
 insert into public.projects(id,workspace_id,title,kind) values('${project}','${w}','Publication concurrency','website');
 insert into public.artifacts(id,workspace_id,project_id,title,kind) values('${a}','${w}','${project}','Publication concurrency','website');
 insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,content,style_snapshot,created_by)
 values('${version}','${w}','${a}',1,${json(content)},'{}','${u}');update public.artifacts set current_version=1 where id='${a}'; select '{}'::json;`);
 const key=randomUUID(), same=await Promise.all([rpc(request(key)),rpc(request(key))]);
 assert.equal(same[0].id,same[1].id);checks.push('concurrent identical requests create one preparation');
 const first=same[0], competing=await rpc(request(randomUUID()));
 const claims=await Promise.all([rpc(`public.makeborne_claim_publication_preparation('${first.id}','${worker}')`),rpc(`public.makeborne_claim_publication_preparation('${first.id}','${randomUUID()}')`)]);
 assert.equal(claims.filter(Boolean).length,1);checks.push('concurrent claims grant exactly one lease');
 // Reclaim with a known worker after an expired lease, fencing out the winner.
 await one(`update makeborne_private.publication_preparations set lease_until=clock_timestamp()-interval '1 second' where id='${first.id}';select '{}'::json;`);
 const reclaimed=await rpc(`public.makeborne_claim_publication_preparation('${first.id}','${worker}')`);
 assert.equal(reclaimed.fence,'2');
 const complete=async row=>{
  const receipt={preparationId:row.id,actorId:u,workspaceId:w,projectId:project,artifactId:a,versionId:row.versionId,versionNumber:row.versionNumber,
   publicationRevision:row.publicationRevision,versionContentHash:row.versionContentHash,slug:row.slug,interactive:false,
   outputHash:createHash('sha256').update(JSON.stringify(output)).digest('hex')};
  return rpc(`public.makeborne_complete_publication_preparation('${row.id}','${worker}',${row.fence},${json(receipt)},${literal(JSON.stringify(output))})`);
 };
 await complete(reclaimed);
 const secondClaim=await rpc(`public.makeborne_claim_publication_preparation('${competing.id}','${worker}')`);await complete(secondClaim);
 const published=await Promise.all([query(`set role service_role;select ${promote(first.id)};`),query(`set role service_role;select ${promote(competing.id)};`)]);
 assert.equal(published.filter(r=>r.code===0).length,1);assert.match(published.find(r=>r.code!==0).error,/publication changed/i);
 const winningId=published[0].code===0?first.id:competing.id;
 const original=JSON.parse(published.find(r=>r.code===0).output);
 const replayed=await Promise.all([rpc(promote(winningId)),rpc(promote(winningId))]);assert.deepEqual(replayed,[original,original]);
 assert.equal((await one(`select json_build_object('revision',revision,'html',html) from public.hosted_sites where artifact_id='${a}';`)).revision,1);
 checks.push('competing promotions commit exactly once; lost-response concurrent replays return recorded result');

 // Hold the shared workspace lock before saving, forcing promotion to inspect
 // the committed new version. The reverse ordering legitimately publishes old
 // version first; both serial orders are safe.
 const beforeSave=await rpc(request(randomUUID(),1));await complete(await rpc(`public.makeborne_claim_publication_preparation('${beforeSave.id}','${worker}')`));
 const save=query(`begin;select id from public.workspaces where id='${w}' for update;
 insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,content,style_snapshot,created_by) values('${randomUUID()}','${w}','${a}',2,${json(content)},'{}','${u}');
 update public.artifacts set current_version=2 where id='${a}';select pg_sleep(0.25);commit;`);
 await new Promise(resolve=>setTimeout(resolve,75));
 const stale=await query(`set role service_role;select ${promote(beforeSave.id)};`);const saved=await save;
 assert.equal(saved.code,0,saved.error);assert.notEqual(stale.code,0);assert.match(stale.error,/Saved version or publication changed/);
 assert.equal((await one(`select json_build_object('revision',revision,'html',html) from public.hosted_sites where artifact_id='${a}';`)).revision,1);
 checks.push('save racing promotion rejects stale revision and preserves old live output');

 const beforeRevoke=await rpc(request(randomUUID(),1,2));await complete(await rpc(`public.makeborne_claim_publication_preparation('${beforeRevoke.id}','${worker}')`));
 const revoke=query(`begin;update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${sess}';select pg_sleep(0.25);commit;`);
 await new Promise(resolve=>setTimeout(resolve,75));
 const denied=await query(`set role service_role;select ${promote(beforeRevoke.id)};`);assert.equal((await revoke).code,0);assert.notEqual(denied.code,0);assert.match(denied.error,/Current confirmed session required/);
 assert.equal((await one(`select json_build_object('revision',revision) from public.hosted_sites where artifact_id='${a}';`)).revision,1);
 checks.push('session revocation racing promotion blocks publication');
 console.log(JSON.stringify({passed:true,container,checks},null,2));
} finally {
 const cleanup=await query(`delete from public.hosted_sites where workspace_id='${w}';delete from public.workspaces where id='${w}';delete from auth.users where id='${u}';`);assert.equal(cleanup.code,0,cleanup.error);
}



