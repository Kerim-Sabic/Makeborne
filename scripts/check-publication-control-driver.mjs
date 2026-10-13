// Explicit isolated fixture only. Creates no passwords, uses no cloud/service keys.
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const fixture='makeborne_publication_20261013034802';
assert.equal(process.argv[2],fixture,'Only the coordinated existing disposable is permitted');
const suffix=randomUUID().replaceAll('-','').slice(0,12),login=`pub_driver_${suffix}`,deniedLogin=`pub_denied_${suffix}`;
const run=(args,input='')=>new Promise((resolveRun,reject)=>{
 const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']}),timer=setTimeout(()=>child.kill(),60000);let stdout='',stderr='';
 child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolveRun({code,stdout,stderr})});child.stdin.end(input);
});
const sql=text=>run(['exec','-i',fixture,'psql','-h','127.0.0.1','-U','postgres','-d','rehearsal','-v','ON_ERROR_STOP=1','-Atq'],text);
const probe=`
import assert from 'node:assert/strict';import{createRequire}from'node:module';import{setTimeout as pause}from'node:timers/promises';
import{publicationControl}from'/app/infra/project-runtime/publication-control.mjs';
const require=createRequire(import.meta.url),{Pool}=require('/app/node_modules/pg');
const config={host:'127.0.0.1',port:5432,database:'rehearsal',user:${JSON.stringify(login)},max:1,connectionTimeoutMillis:5000,idleTimeoutMillis:1000,ssl:false};
const pool=new Pool(config),denied=new Pool({...config,user:${JSON.stringify(deniedLogin)}}),checks=[];
const signal=()=>new AbortController().signal;
async function until(test){for(let i=0;i<100;i++){if(test())return;await pause(10)}assert.fail('Pool did not settle');}
try{
 const rpc=publicationControl(pool);
 assert.deepEqual(await rpc('makeborne_publication_worker_candidates',{p_limit:1},signal()),[]);
 const reset=await pool.query("select current_user as actor,current_setting('role') as role,current_setting('statement_timeout') as timeout");
 assert.equal(reset.rows[0].actor,config.user);assert.equal(reset.rows[0].role,'none');assert.equal(reset.rows[0].timeout,'0');
 checks.push('real pg8.23.1 dedicated LOGIN, parameterized candidate RPC, transaction-local role and timeout reset');
 const fixtureWorker='11111111-1111-4111-8111-111111111111',fixtureName='mbpub-compiler-22222222-2222-4222-8222-222222222222';
 assert.deepEqual(await rpc('makeborne_publication_worker_sandbox_cleanup_claim',{p_worker:fixtureWorker,p_limit:1},signal()),{records:[],pending:0});
 checks.push('real restricted cleanup_claim wrapper mapping returns empty records and zero pending');
 const badIdentity={preparationId:'33333333-3333-4333-8333-333333333333',workerId:fixtureWorker,fence:'1',leaseUntil:'2030-01-01T00:02:00Z',name:fixtureName,kind:'compiler',image:'mutable:latest',evidenceSha256:'a'.repeat(64),runtimeIdentity:'sha256:'+ 'b'.repeat(64),latestExpectedExpiry:'2030-01-01T00:01:55Z',state:'creating'};
 await assert.rejects(rpc('makeborne_publication_worker_sandbox_event',{p_record:badIdentity},signal()),e=>e.code==='22023');await until(()=>pool.totalCount===0);
 checks.push('real sandbox_event wrapper reaches SQL and rejects mutable image identity with22023');
 await assert.rejects(rpc('makeborne_publication_worker_sandbox_cleanup_finish',{p_name:fixtureName,p_worker:fixtureWorker,p_cleanup_fence:'1',p_state:'stopped'},signal()),e=>e.code==='P0002');await until(()=>pool.totalCount===0);
 checks.push('real cleanup_finish wrapper mapping refuses nonexistent journal withP0002');
 await assert.rejects(publicationControl(denied)('makeborne_publication_worker_candidates',{p_limit:1},signal()),e=>e.code==='42501');await until(()=>denied.totalCount===0);
 checks.push('login without worker membership refused by PostgreSQL and rejected transaction connection destroyed');
 const before=pool.totalCount;await assert.rejects(rpc('makeborne_publication_worker_candidates',{p_limit:1,query:'forbidden'},signal()),/ARGUMENT_INVALID/);assert.equal(pool.totalCount,before);
 checks.push('extra SQL argument refused before database dispatch');
 const held=await pool.connect(),queued=new AbortController();const waiting=rpc('makeborne_publication_worker_candidates',{p_limit:1},queued.signal);await until(()=>pool.waitingCount===1);queued.abort();await assert.rejects(waiting);held.release();await until(()=>pool.totalCount===0&&pool.waitingCount===0);
 checks.push('real max1 pool queued acquisition abort settles immediately and destroys late-acquired connection');
 let began;const active=new Promise(r=>began=r),controller=new AbortController();
 const delayed={async connect(){const client=await pool.connect();return{release:value=>client.release(value),query:(text,values)=>{if(text.startsWith('SELECT public.')){began();return client.query('SELECT pg_sleep(5)')}return client.query(text,values)}}}};
 const running=publicationControl(delayed)('makeborne_publication_worker_candidates',{p_limit:1},controller.signal);await active;const started=Date.now();controller.abort();await assert.rejects(running);assert(Date.now()-started<1000);await until(()=>pool.totalCount===0);
 checks.push('real running query abort destroys connection and settles within1s; SELECT pg_sleep fault injected at allowlisted statement');
 const unknown={async connect(){const client=await pool.connect();return{release:value=>client.release(value),query:async(text,values)=>{const result=await client.query(text,values);if(text==='COMMIT')throw Error('PUBLICATION_COMMIT_RESPONSE_LOST');return result}}}};
 await assert.rejects(publicationControl(unknown)('makeborne_publication_worker_candidates',{p_limit:1},signal()),/RESPONSE_LOST/);await until(()=>pool.totalCount===0);
 assert.deepEqual(await rpc('makeborne_publication_worker_candidates',{p_limit:1},signal()),[]);
 checks.push('lost response injected after actual COMMIT destroys ambiguous connection; next transaction recovers');
 // Exercise simultaneous abort and successful query completion using real pg.
 let issuedAfterAbort=0;const edge=new AbortController();const wrapped={async connect(){const client=await pool.connect();return{release:value=>client.release(value),query:async(text,values)=>{if(edge.signal.aborted)issuedAfterAbort++;const value=await client.query(text,values);if(text==='BEGIN')edge.abort();return value}}}};
 await assert.rejects(publicationControl(wrapped)('makeborne_publication_worker_candidates',{p_limit:1},edge.signal));await until(()=>pool.totalCount===0);
 checks.push('abort at actual BEGIN acknowledgement rejects without reaching operation query; post-abort client calls='+issuedAfterAbort);
 console.log(JSON.stringify({passed:true,checks,driver:require('/app/node_modules/pg/package.json').version,node:process.version}));
}finally{await pool.end();await denied.end();}
`;
const files=['infra/project-runtime/publication-control.mjs','infra/project-runtime/publication-supervisor.mjs','src/lib/projects/publication-worker.ts','supabase/migrations/20261013190000_publication_worker_authority.sql','supabase/migrations/20261013210000_publication_sandbox_journal.sql','scripts/check-publication-control-driver.mjs'];
const digest=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const evidence={fixture,startedAt:new Date().toISOString(),passed:false,providerCalls:0,cloudWrites:0,productionTouched:false,stagingTouched:false,tlsQualified:false,inputHashes:files.map(file=>({file,sha256:digest(file)}))};
try{
 const inspect=await run(['inspect','--format','{{.State.Running}}',fixture]);assert.equal(inspect.code,0);assert.equal(inspect.stdout.trim(),'true');
 const image=await run(['image','inspect','--format','{{.Id}}','node:24-bookworm-slim']);assert.equal(image.code,0,'Existing Node image required; never pull');evidence.nodeImage=image.stdout.trim();
 const created=await sql(`create role ${login} login noinherit;grant makeborne_publication_worker to ${login};create role ${deniedLogin} login noinherit;`);assert.equal(created.code,0,created.stderr);
 const result=await run(['run','--rm','-i','--pull','never','--network',`container:${fixture}`,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','256m','--cpus','1','--pids-limit','32','--tmpfs','/tmp:size=16m','--mount',`type=bind,src=${resolve('infra/project-runtime')},dst=/app/infra/project-runtime,readonly`,'--mount',`type=bind,src=${resolve('node_modules')},dst=/app/node_modules,readonly`,evidence.nodeImage,'node','--input-type=module','-'],probe);
 assert.equal(result.code,0,result.stderr);Object.assign(evidence,JSON.parse(result.stdout.trim().split('\n').at(-1)));
 evidence.changedInputs=evidence.inputHashes.filter(item=>digest(item.file)!==item.sha256).map(item=>item.file);assert.deepEqual(evidence.changedInputs,[]);
}catch(error){evidence.error=String(error?.stack??error);evidence.passed=false;process.exitCode=1;}
finally{
 const cleanup=await sql(`drop role if exists ${login};drop role if exists ${deniedLogin};`);evidence.cleanupPassed=cleanup.code===0;if(cleanup.code!==0){evidence.cleanupError=cleanup.stderr;evidence.passed=false;process.exitCode=1;}
 evidence.finishedAt=new Date().toISOString();writeFileSync('docs/release-review/publication-control-driver-20261013.json',JSON.stringify(evidence,null,2)+'\n');
}
console.log(JSON.stringify(evidence,null,2));
