import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {parseControllerConfig,STAGING,PRODUCTION} from './config.mjs';
import {validateNamespaceAttestation} from './attestation.mjs';
import {scopedPublicationControl} from './scope.mjs';
const workspace='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const approved={compiler:{image:`${PRODUCTION.imagePrefix}compiler@sha256:${'a'.repeat(64)}`,runtimeImageId:`sha256:${'b'.repeat(64)}`,evidenceSha256:'c'.repeat(64)},renderer:{image:`${PRODUCTION.imagePrefix}renderer@sha256:${'d'.repeat(64)}`,rendererId:`chromium-153.0-controller-${'e'.repeat(64)}`,evidenceSha256:'f'.repeat(64)}};
const bytes=Buffer.from(JSON.stringify(approved)),approvedFile=resolve('approved.fixture.json'),caFile=resolve('ca.fixture.pem');
const read=p=>p===approvedFile?bytes:Buffer.from('-----BEGIN CERTIFICATE-----\nfixture-ca\n-----END CERTIFICATE-----');
const env={NODE_ENV:'production',MBPUB_DB_PASSWORD:'fixture-database-password',MBPUB_VERCEL_TOKEN:'fixture-vercel-token',MBPUB_BROKER_SECRET:'a'.repeat(64),MBPUB_R2_ACCESS_KEY_ID:'b'.repeat(32),MBPUB_R2_SECRET_ACCESS_KEY:'c'.repeat(64)};
const value={schemaVersion:2,namespace:'production',supabaseProjectRef:PRODUCTION.projectRef,workspaceAllowlist:[workspace],database:{host:PRODUCTION.databaseHost,port:5432,database:'postgres',user:'makeborne_publication_controller_production',caFile},vercel:{teamId:PRODUCTION.teamId,projectId:PRODUCTION.projectId},broker:{origin:PRODUCTION.brokerOrigin,protectionBypassRequired:false},output:{accountId:'d'.repeat(32),bucket:PRODUCTION.bucket},approvedFile,approvedSha256:createHash('sha256').update(bytes).digest('hex')};
const parse=(v=value,e=env)=>parseControllerConfig(v,e,{nodeMajor:24,read});
let n=0;async function check(name,fn){await fn();n++;console.log('PASS '+name);}
await check('production profile fixes every service identity and independent workspace allowlist',()=>{
 const c=parse();assert.equal(c.database.host,PRODUCTION.databaseHost);assert.equal(c.vercel.projectId,PRODUCTION.projectId);assert.equal(c.output.bucket,PRODUCTION.bucket);assert.equal(c.broker.origin,'https://makeborne.com');assert.equal(c.database.ssl.rejectUnauthorized,true);assert(Object.isFrozen(c.workspaceAllowlist));assert(!('protectionBypassSecret' in c.broker));
});
await check('staging values, QA selectors, bypass credentials and unknown production fields are rejected',()=>{
 for(const mutate of [v=>v.supabaseProjectRef=STAGING.projectRef,v=>v.database.host=STAGING.databaseHost,v=>v.database.user='makeborne_publication_controller_staging',v=>v.vercel.projectId=STAGING.projectId,v=>v.output.bucket=STAGING.bucket,v=>v.broker.origin='https://makeborne-release-staging-kerimsabic-6594s-projects.vercel.app',v=>v.qaWorkspaceId=workspace,v=>v.schemaVersion=1,v=>v.namespace='staging',v=>v.broker.protectionBypassRequired=true,v=>v.database.user='postgres',v=>v.output.endpoint='https://evil.example']){const c=structuredClone(value);mutate(c);assert.throws(()=>parse(c));}
 assert.throws(()=>parse(value,{...env,MBPUB_BROKER_PROTECTION_BYPASS:'staging-secret'}));
 const swapped=structuredClone(approved);swapped.compiler.image=swapped.compiler.image.replace(PRODUCTION.imagePrefix,STAGING.imagePrefix);const b=Buffer.from(JSON.stringify(swapped));
 assert.throws(()=>parseControllerConfig({...value,approvedSha256:createHash('sha256').update(b).digest('hex')},env,{nodeMajor:24,read:p=>p===approvedFile?b:read(p)}));
 const stage={...value,schemaVersion:1,namespace:'staging',supabaseProjectRef:STAGING.projectRef,qaWorkspaceId:workspace,database:{...value.database,host:STAGING.databaseHost,user:'makeborne_publication_controller_staging'},vercel:{teamId:STAGING.teamId,projectId:STAGING.projectId},output:{...value.output,bucket:STAGING.bucket},broker:{origin:'https://makeborne-release-staging-kerimsabic-6594s-projects.vercel.app',protectionBypassRequired:true}};delete stage.workspaceAllowlist;
 assert.throws(()=>parse(stage,{...env,MBPUB_BROKER_PROTECTION_BYPASS:'fixture-bypass'}));
});
await check('empty, duplicate, wildcard and oversized rollout lists fail closed; sorted copy cannot mutate',()=>{
 for(const list of [[],[workspace,workspace],['*'],['AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'],Array.from({length:101},(_,i)=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`)])assert.throws(()=>parse({...value,workspaceAllowlist:list}));
 const list=[other,workspace],c=parse({...value,workspaceAllowlist:list});list.length=0;assert.deepEqual(c.workspaceAllowlist,[workspace,other]);
});
const config=parse(),attestation={contractVersion:'publication-controller-v2',namespace:'production',workspaceAllowlist:[workspace]};
await check('database production attestation must match exact configured rollout set',()=>{
 validateNamespaceAttestation(attestation,config);
 for(const a of [{...attestation,contractVersion:'publication-controller-v1'},{...attestation,namespace:'staging'},{...attestation,workspaceAllowlist:[]},{...attestation,workspaceAllowlist:[workspace,other]},{...attestation,qaWorkspaceId:workspace}])assert.throws(()=>validateNamespaceAttestation(a,config));
});
await check('runtime rollout drift stops discovery but preserves orphan cleanup',async()=>{
 const calls=[];const raw=async name=>{calls.push(name);return name==='makeborne_publication_worker_attest'?{...attestation,workspaceAllowlist:[other]}:[];};const rpc=scopedPublicationControl(raw,config),signal=new AbortController().signal;
 await assert.rejects(rpc('makeborne_publication_worker_candidates',{p_limit:10},signal));assert.deepEqual(calls,['makeborne_publication_worker_attest']);await rpc('makeborne_publication_worker_sandbox_cleanup_claim',{},signal);assert.equal(calls.at(-1),'makeborne_publication_worker_sandbox_cleanup_claim');
});
await check('claim and source refresh outside configured scope cannot reach a compiler',async()=>{
 const signal=new AbortController().signal;
 for(const name of ['makeborne_claim_publication_preparation','makeborne_load_publication_preparation']){
  await assert.rejects(scopedPublicationControl(async()=>({scope:{workspaceId:other}}),config)(name,{},signal),/WORKSPACE_DENIED/);
  assert.deepEqual(await scopedPublicationControl(async()=>({scope:{workspaceId:workspace}}),config)(name,{},signal),{scope:{workspaceId:workspace}});
 }
});
console.log(`${n} production profile groups passed; no network or provider calls`);
