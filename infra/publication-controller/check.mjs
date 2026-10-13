import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {readFileSync,writeFileSync} from 'node:fs';
import {parseControllerConfig,readControllerConfig,STAGING} from './config.mjs';
import {attestController,validateLoginAttestation,validateNamespaceAttestation,LOGIN_ATTESTATION_SQL} from './attestation.mjs';
import {runService,safeEvent} from './service.mjs';
const approved={compiler:{image:`vcr.vercel.com/compiler@sha256:${'a'.repeat(64)}`,runtimeImageId:`sha256:${'b'.repeat(64)}`,evidenceSha256:'c'.repeat(64)},renderer:{image:`vcr.vercel.com/renderer@sha256:${'d'.repeat(64)}`,rendererId:`chromium-130.0-controller-${'e'.repeat(64)}`,evidenceSha256:'f'.repeat(64)}};
const approvedBytes=Buffer.from(JSON.stringify(approved)),approvedFile=resolve('approved.local.json'),caFile=resolve('ca.local.pem');
const value={schemaVersion:1,namespace:'staging',supabaseProjectRef:STAGING.projectRef,qaWorkspaceId:'11111111-1111-4111-8111-111111111111',
 database:{host:STAGING.databaseHost,port:5432,database:'postgres',user:'makeborne_publication_controller_staging',caFile},
 vercel:{teamId:STAGING.teamId,projectId:STAGING.projectId},broker:{origin:'https://makeborne-release-staging-kerimsabic-6594s-projects.vercel.app',protectionBypassRequired:true},
 output:{accountId:'a'.repeat(32),bucket:STAGING.bucket},approvedFile,approvedSha256:createHash('sha256').update(approvedBytes).digest('hex')};
const env={NODE_ENV:'production',MBPUB_DB_PASSWORD:'fixture-database-password',MBPUB_VERCEL_TOKEN:'fixture-vercel-token',MBPUB_BROKER_SECRET:'a1'.repeat(32),MBPUB_BROKER_PROTECTION_BYPASS:'fixture-bypass',MBPUB_R2_ACCESS_KEY_ID:'b1'.repeat(16),MBPUB_R2_SECRET_ACCESS_KEY:'c1'.repeat(32)};
const read=path=>path===approvedFile?approvedBytes:Buffer.from('-----BEGIN CERTIFICATE-----\nfixture-public-ca\n-----END CERTIFICATE-----');
const parse=(v=value,e=env)=>parseControllerConfig(v,e,{read,nodeMajor:24}),config=parse();
const role=login=>({login,inherit:false,super:false,createRole:false,createDb:false,replication:false,bypassRls:false});
const login={user:config.database.user,sessionUser:config.database.user,role:'none',tls:true,login:role(true),worker:role(false),memberships:['makeborne_publication_worker'],membership:{admin:false,inherit:false,set:true},extraTables:false,extraFunctions:false,createSchema:false,createDatabase:false,database:'postgres'};
const namespace={contractVersion:'publication-controller-v1',namespace:'staging',qaWorkspaceId:config.qaWorkspaceId};
const stream={encrypted:true,authorized:true};
const checks=[],check=async(name,fn)=>{await fn();checks.push(name);console.log(`PASS ${name}`);};
const tick=()=>new Promise(r=>setTimeout(r,0));
function fixture(options={}){
 const calls=[],instances=[];
 const client={connection:{stream:options.stream??stream},release:destroy=>calls.push(['release',destroy]),query:async text=>{calls.push(['query',text]);return {rows:text===LOGIN_ATTESTATION_SQL?[{result:options.login??login}]:text.includes('makeborne_publication_worker_attest')?[{result:options.namespace??namespace}]:[]};}};
 class Pool extends EventEmitter{constructor(){super();instances.push(this);calls.push(['pool']);}async connect(){return client;}async end(){calls.push(['end']);if(options.hangClose)return new Promise(()=>{});}}
 const deps={Pool,Sandbox:{},publicationControl:()=>{calls.push(['rpc']);return()=>{};},vercelSandboxTransport:()=>{calls.push(['transport']);return{};},
  createR2S3OutputStore:()=>{calls.push(['store']);return{};},publicationSourceDownloader:()=>{calls.push(['download']);return()=>{};},publicationArtworkResolver:()=>{calls.push(['artwork']);return()=>{};},
  runPublicationPreparation:()=>{},runPublicationController:async args=>{calls.push(['controller']);if(options.run)return options.run(args);}};
 return {calls,client,deps,get pool(){return instances.at(-1);}};
}
await check('strict staging config and locked mapping keep explicit TLS and all host credentials out of runtime data',async()=>{
 assert.equal(config.database.ssl.rejectUnauthorized,true);assert.equal(config.database.ssl.servername,STAGING.databaseHost);assert(!('connectionString' in config.database));
 assert.equal(config.vercel.projectId,STAGING.projectId);assert.equal(config.output.bucket,STAGING.bucket);assert(Object.isFrozen(config.approved.compiler));
 for(const mutation of [v=>v.namespace='production',v=>v.supabaseProjectRef='production',v=>v.database.host='localhost',v=>v.database.port=6543,v=>v.database.user='postgres',v=>v.database.connectionString='postgres://unsafe',v=>v.database.sslmode='disable',v=>v.output.bucket='production',v=>v.vercel.projectId='other',v=>v.broker.origin='https://evil.example',v=>v.approvedSha256='0'.repeat(64),v=>v.qaWorkspaceId='bad']){const changed=structuredClone(value);mutation(changed);assert.throws(()=>parse(changed));}
 assert.throws(()=>parseControllerConfig(value,env,{read,nodeMajor:22}));assert.throws(()=>readControllerConfig({NODE_ENV:'production'}));
});
await check('ambient connection, proxy, TLS, admin and SDK credentials refused before any transport',async()=>{
 for(const key of ['PGHOST','PGPASSWORD','PGOPTIONS','DATABASE_URL','SUPABASE_SERVICE_ROLE_KEY','NEXT_PUBLIC_SUPABASE_URL','VERCEL_OIDC_TOKEN','VERCEL_TOKEN','NODE_OPTIONS','NODE_TLS_REJECT_UNAUTHORIZED','NODE_EXTRA_CA_CERTS','NODE_USE_ENV_PROXY','HTTP_PROXY','https_proxy','ALL_PROXY','SSL_CERT_FILE'])assert.throws(()=>parse(value,{...env,[key]:'fixture'}),key);
 for(const key of Object.keys(env).filter(k=>k.startsWith('MBPUB_'))){const missing={...env};delete missing[key];assert.throws(()=>parse(value,missing),key);}
});
await check('database attestation rejects admin, inherited/unrelated grants, wrong namespace and unverifiedTLS',async()=>{
 validateLoginAttestation(login,config,stream);validateNamespaceAttestation(namespace,config);
 for(const mutation of [v=>v.login.super=true,v=>v.login.inherit=true,v=>v.worker.login=true,v=>v.memberships.push('service_role'),v=>v.membership.admin=true,v=>v.extraTables=true,v=>v.extraFunctions=true,v=>v.createSchema=true,v=>v.createDatabase=true,v=>v.user='postgres',v=>v.tls=false]){const changed=structuredClone(login);mutation(changed);assert.throws(()=>validateLoginAttestation(changed,config,stream));}
 assert.throws(()=>validateLoginAttestation(login,config,{encrypted:true,authorized:false}));assert.throws(()=>validateNamespaceAttestation({...namespace,namespace:'production'},config));assert.throws(()=>validateNamespaceAttestation({...namespace,qaWorkspaceId:'other'},config));
});
await check('real startup composition attests and commits before constructing provider/store/broker or discovering work',async()=>{
 const f=fixture();await runService(config,f.deps,new AbortController().signal);
 const committed=f.calls.findIndex(c=>c[0]==='query'&&c[1]==='COMMIT');for(const name of ['transport','store','download','controller'])assert(f.calls.findIndex(c=>c[0]===name)>committed);
 assert.equal(f.calls.filter(c=>c[0]==='end').length,1);assert.equal(f.pool.listenerCount('error'),0);
 for(const options of [{namespace:{...namespace,namespace:'production'}},{stream:{encrypted:false,authorized:false}}]){const bad=fixture(options);await assert.rejects(runService(config,bad.deps,new AbortController().signal));assert(!bad.calls.some(c=>['transport','store','download','controller'].includes(c[0])));assert(bad.calls.some(c=>c[0]==='end'));}
});
await check('startup cancellation destroys late acquisition and never falls through into controller',async()=>{
 let acquire;const f=fixture(),pool={connect:()=>new Promise(r=>acquire=r)},stop=new AbortController();
 const started=attestController(pool,config,stop.signal);stop.abort();await assert.rejects(started);acquire(f.client);await tick();assert.deepEqual(f.calls,[['release',true]]);
});
await check('requested shutdown settles, uncooperative work/pool is bounded, idle database error remains failure',async()=>{
 let entered;const ready=new Promise(r=>entered=r),stop=new AbortController();
 const f=fixture({run:async({signal})=>{entered();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));}});
 const active=runService(config,f.deps,stop.signal,{shutdownMs:20,closeMs:20});await ready;stop.abort();await active;
 let hungEntered;const hungReady=new Promise(r=>hungEntered=r),hungStop=new AbortController(),hung=fixture({run:()=>{hungEntered();return new Promise(()=>{});}});
 const pending=runService(config,hung.deps,hungStop.signal,{shutdownMs:10,closeMs:10});await hungReady;hungStop.abort();await assert.rejects(pending,/SHUTDOWN_TIMEOUT/);
 const close=fixture({hangClose:true});await assert.rejects(runService(config,close.deps,new AbortController().signal,{closeMs:10}),/POOL_CLOSE_TIMEOUT/);assert.equal(close.pool.listenerCount('error'),0);
 let errorEntered;const errorReady=new Promise(r=>errorEntered=r),failed=fixture({run:async({signal})=>{errorEntered();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));}});
 const failure=runService(config,failed.deps,new AbortController().signal);await errorReady;failed.pool.emit('error',Error('secret provider dump'));await assert.rejects(failure,/DATABASE_UNAVAILABLE/);
});
await check('structured logging never includes configuration, raw SQL errors, credentials or arbitrary text',async()=>{
 assert.deepEqual(safeEvent({type:'attempt_failed',error:'secret',token:'secret',code:'password=secret',workerId:'secret',retryInMs:-1}),{type:'attempt_failed'});
 assert.deepEqual(safeEvent(Error('secret')),{type:'fatal'});
});
await check('package exact versions and generated bundle excludes Supabase/admin/Next dependencies',async()=>{
 const pkg=JSON.parse(readFileSync(new URL('package.json',import.meta.url))),lock=JSON.parse(readFileSync(new URL('package-lock.json',import.meta.url)));
 for(const [name,version] of Object.entries(pkg.dependencies)){assert.match(version,/^\d+\.\d+\.\d+$/);assert.equal(lock.packages['node_modules/'+name].version,version);}
 const meta=JSON.parse(readFileSync(new URL('dist/build.json',import.meta.url)));assert(meta.inputs.some(p=>p.endsWith('publication-worker.ts')));assert(meta.inputs.some(p=>p.endsWith('publication-assets.ts')));assert(meta.inputs.some(p=>p.endsWith('publication-download.ts')));assert(meta.inputs.some(p=>p.endsWith('r2-s3-output-store.ts')));assert(!meta.inputs.some(p=>p.includes('@supabase/')||p.includes('supabase/admin')));
});
if(!process.argv.includes('--no-report'))writeFileSync(new URL('../../docs/release-review/publication-controller-bootstrap-20261013.json',import.meta.url),JSON.stringify({passed:true,node:process.version,cloudWrites:0,providerCalls:0,checks,finishedAt:new Date().toISOString()},null,2)+'\n');
console.log(`${checks.length} controller startup groups passed`);
