import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {LOGIN_ATTESTATION_SQL,validateLoginAttestation} from '../infra/publication-controller/attestation.mjs';
const fixture=process.argv[2];assert.equal(fixture,'makeborne_publication_20261013034802');
const migration='supabase/migrations/20261013220000_publication_worker_attestation.sql';
const suffix=randomUUID().replaceAll('-','').slice(0,10),login=`attest_${suffix}`,u=randomUUID(),w=randomUUID();
const query=(sql,user='postgres')=>new Promise((resolve,reject)=>{const c=spawn('docker',['exec','-i',fixture,'psql','-h','127.0.0.1','-U',user,'-d','rehearsal','-Atq','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']);let out='',err='';c.stdout.on('data',v=>out+=v);c.stderr.on('data',v=>err+=v);c.on('error',reject);c.on('close',code=>resolve({code,out:out.trim(),err}));c.stdin.end(sql);});
const ok=async(sql,user)=>{const r=await query(sql,user);assert.equal(r.code,0,r.err);return r.out?JSON.parse(r.out.split('\n').at(-1)):null;};
const call=()=>query('set role makeborne_publication_worker;select public.makeborne_publication_worker_attest();',login);
const checks=[],evidence={fixture,migration,sha256:createHash('sha256').update(readFileSync(migration)).digest('hex'),startedAt:new Date().toISOString(),providerCalls:0,cloudWrites:0,passed:false,checks};
const faults=[
 ['grant execute on function public.makeborne_claim_publication_preparation(uuid,uuid) to makeborne_publication_worker;','revoke execute on function public.makeborne_claim_publication_preparation(uuid,uuid) from makeborne_publication_worker;'],
 ['grant select on makeborne_private.site_address_namespace_policy to makeborne_publication_worker;','revoke select on makeborne_private.site_address_namespace_policy from makeborne_publication_worker;'],
 ['revoke execute on function public.makeborne_publication_worker_sandbox_event(jsonb) from makeborne_publication_worker;','grant execute on function public.makeborne_publication_worker_sandbox_event(jsonb) to makeborne_publication_worker;'],
 ['alter function public.makeborne_publication_worker_sandbox_event(jsonb) security definer;','alter function public.makeborne_publication_worker_sandbox_event(jsonb) security invoker;'],
 ['alter table makeborne_private.publication_sandboxes disable row level security;','alter table makeborne_private.publication_sandboxes enable row level security;'],
 ["create function public.makeborne_publication_worker_candidates(text) returns jsonb language sql security invoker set search_path='' as $$select '{}'::jsonb$$;revoke all on function public.makeborne_publication_worker_candidates(text) from public,anon,authenticated,service_role;grant execute on function public.makeborne_publication_worker_candidates(text) to makeborne_publication_worker;",'drop function if exists public.makeborne_publication_worker_candidates(text);'],
];
try{
 await ok(`create role ${login} login noinherit;grant makeborne_publication_worker to ${login};`);
 const actualLogin=await ok(LOGIN_ATTESTATION_SQL,login);
 // This disposable is deliberately plaintext rehearsal, not remote TLS proof.
 // Verify all real role/catalog values; TLS and fixed database name are tested
 // separately by the offline transport-denial cases.
 validateLoginAttestation({...actualLogin,tls:true,database:'postgres'},{database:{user:login}},{encrypted:true,authorized:true});
 checks.push('actual dedicated-login catalog has exact worker-only membership, no admin/inherited/raw/function/schema/database privileges; local TLS not claimed');
 const noRole=await query('select public.makeborne_publication_worker_attest();',login);assert.notEqual(noRole.code,0);assert.match(noRole.err,/42501:/);
 let value=await call();assert.equal(value.code,0,value.err);assert.deepEqual(JSON.parse(value.out),{contractVersion:'publication-controller-v1',namespace:'production',qaWorkspaceId:null});
 checks.push('actual restricted LOGIN requires SET ROLE and returns exact actual production policy with explicit verified contract');
 for(const [fault,restore] of faults){try{await ok(fault);value=await call();assert.notEqual(value.code,0);assert.match(value.err,/PT409:/);}finally{await ok(restore);}}
 checks.push('extra worker RPC/table access, executable allowed-name overload, missing required grant, wrong definer boundary and disabled journal RLS each refuse attestation, then restore cleanly');
 await ok(`insert into auth.users(id,email,email_confirmed_at) values('${u}','${u}@attestation.invalid',now());insert into public.workspaces(id,name,owner_id) values('${w}','Attestation fixture','${u}');select makeborne_private.configure_site_address_namespace('staging','${w}');`);
 value=await call();assert.equal(value.code,0,value.err);assert.deepEqual(JSON.parse(value.out),{contractVersion:'publication-controller-v1',namespace:'staging',qaWorkspaceId:w});
 checks.push('configured synthetic staging namespace and exact QA workspace are reported from private policy without raw read grant');
 for(const role of ['anon','authenticated','service_role']){value=await query(`set role ${role};select public.makeborne_publication_worker_attest();`);assert.notEqual(value.code,0);assert.match(value.err,/42501:/);}
 checks.push('browser and service roles cannot execute either startup authority or read policy');
 const catalog=await query(readFileSync('supabase/check-publication-worker-authority.sql','utf8'));assert.equal(catalog.code,0,catalog.err);checks.push('full worker catalog remains explicit ten RPCs, no table or unrelated authority');
 evidence.passed=true;
}catch(error){evidence.error=String(error.stack??error);process.exitCode=1;}
finally{
 const cleaned=await query(`${faults.map(([,restore])=>restore).join('\n')}select makeborne_private.configure_site_address_namespace('production');delete from public.workspaces where id='${w}';delete from auth.users where id='${u}';drop role if exists ${login};`);
 if(cleaned.code!==0){evidence.cleanupError=cleaned.err;evidence.passed=false;process.exitCode=1;}
 evidence.finishedAt=new Date().toISOString();writeFileSync('docs/release-review/publication-worker-attestation-20261013.json',JSON.stringify(evidence,null,2)+'\n');
}
console.log(JSON.stringify(evidence,null,2));
