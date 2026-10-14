/* eslint-disable @typescript-eslint/no-require-imports -- Offline supervisor and SQL driver boundary checks. */
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
async function main(){
 const {publicationControl}=await import('../../../infra/project-runtime/publication-control.mjs');
 const {supervisePublications}=await import('../../../infra/project-runtime/publication-supervisor.mjs');
 let count=0;async function check(name,fn){await fn();count++;console.log(`PASS ${name}`);}
 function poolFixture(failAt){const statements=[],releases=[];return {statements,releases,pool:{async connect(){return {async query(sql,values){statements.push({sql,values});if(sql===failAt)throw Error('secret database detail');return {rows:[{result:[{id:'fixture'}]}]};},release(destroy){releases.push(destroy);}};}}};}
 const signal=()=>new AbortController().signal;
 await check('explicit RPC allowlist rejects arbitrary queries, extra keys and invalid fences before pool',async()=>{
  const f=poolFixture(),rpc=publicationControl(f.pool);
  await assert.rejects(rpc('makeborne_promote_publication_preparation',{},signal()),/FORBIDDEN/);
  for(const args of [{p_limit:0},{p_limit:26},{p_limit:1,sql:'DROP'},{p_limit:'1'}])await assert.rejects(rpc('makeborne_publication_worker_candidates',args,signal()));
  await assert.rejects(rpc('makeborne_load_publication_preparation',{p_preparation:randomUUID(),p_worker:randomUUID(),p_fence:'1);drop'},signal()));assert.equal(f.statements.length,0);
 });
 await check('transaction-local restricted role and parameterized arguments, no session-role leakage',async()=>{
  const f=poolFixture();await publicationControl(f.pool)('makeborne_publication_worker_candidates',{p_limit:10},signal());
  assert.deepEqual(f.statements.map(x=>x.sql),['BEGIN','SET LOCAL ROLE makeborne_publication_worker',"SET LOCAL statement_timeout = '5s'","SET LOCAL lock_timeout = '2s'",'SELECT public.makeborne_publication_worker_candidates(p_limit => $1::integer) AS result','COMMIT']);assert.deepEqual(f.statements[4].values,[10]);assert.deepEqual(f.releases,[false]);
 });
 await check('SQL/commit failure destroys ambiguous connection exactly once',async()=>{
  for(const step of ['BEGIN','SET LOCAL ROLE makeborne_publication_worker','COMMIT']){const f=poolFixture(step);await assert.rejects(publicationControl(f.pool)('makeborne_publication_worker_candidates',{p_limit:1},signal()));assert.deepEqual(f.releases,[true]);}
 });
 await check('abort while waiting for a pool slot releases late connection',async()=>{
  let acquire;const releases=[],controller=new AbortController();const rpc=publicationControl({connect:()=>new Promise(resolve=>{acquire=resolve;})});
  const result=rpc('makeborne_publication_worker_candidates',{p_limit:1},controller.signal);controller.abort();await assert.rejects(result);acquire({release:destroy=>releases.push(destroy)});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(releases,[true]);
 });
 await check('abort in running query destroys connection and settles promptly',async()=>{
  const controller=new AbortController(),releases=[];let started;
  const ready=new Promise(resolve=>{started=resolve;});
  const rpc=publicationControl({async connect(){return {query(){started();return new Promise(()=>{});},release:destroy=>releases.push(destroy)};}});
  const result=rpc('makeborne_publication_worker_candidates',{p_limit:1},controller.signal);await ready;controller.abort();await assert.rejects(result);assert.deepEqual(releases,[true]);
 });
 await check('supervisor is sequential; failure does not starve next candidate, then polls again',async()=>{
  const ids=[randomUUID(),randomUUID()],controller=new AbortController(),events=[],seen=[];let active=0,polls=0;
  await supervisePublications({signal:controller.signal,rpc:async()=>{polls++;return ids.map(id=>({id}));},run:async(id)=>{assert.equal(active++,0);seen.push(id);active--;if(id===ids[0])throw Error('secret');return {state:'completed'};},emit:e=>events.push(e),wait:async()=>controller.abort()});
  assert.equal(polls,1);assert.deepEqual(seen,ids);assert.equal(events.find(e=>e.type==='attempt_failed').code,'PUBLICATION_PREPARATION_FAILED');assert.equal(JSON.stringify(events).includes('secret'),false);assert.equal(events.at(-1).type,'stopped');
 });
 await check('bad candidate response cannot dispatch and uses bounded backoff',async()=>{
  const controller=new AbortController(),delays=[];let dispatch=0;
  await supervisePublications({signal:controller.signal,rpc:async()=>[{id:randomUUID(),source:'secret'}],run:async()=>dispatch++,wait:async(ms)=>{delays.push(ms);if(delays.length===8)controller.abort();}});
  assert.equal(dispatch,0);assert.deepEqual(delays,[10000,20000,40000,60000,60000,60000,60000,60000]);
 });
 await check('duplicate IDs and oversized discovery responses rejected',async()=>{
  for(const rows of [Array(11).fill(null).map(()=>({id:randomUUID()})),(()=>{const id=randomUUID();return [{id},{id}];})()]){
   const controller=new AbortController();let dispatched=false;await supervisePublications({signal:controller.signal,rpc:async()=>rows,run:async()=>{dispatched=true;},wait:async()=>controller.abort()});assert.equal(dispatched,false);
  }
 });
 await check('contended queue always waits; new process rediscovers durable candidates',async()=>{
  const id=randomUUID();let attempts=0;
  for(let i=0;i<2;i++){const controller=new AbortController();let waits=0;await supervisePublications({signal:controller.signal,rpc:async()=>[{id}],run:async()=>{attempts++;return {state:'not_claimed'};},wait:async(ms)=>{assert.equal(ms,5000);waits++;controller.abort();}});assert.equal(waits,1);}assert.equal(attempts,2);
 });
 await check('aborted start makes no query and telemetry failure does not break polling',async()=>{
  const controller=new AbortController();controller.abort();await supervisePublications({signal:controller.signal,rpc:async()=>assert.fail(),run:async()=>assert.fail()});
  const running=new AbortController();await supervisePublications({signal:running.signal,rpc:async()=>[],run:async()=>assert.fail(),emit:()=>{throw Error('logging failed');},wait:async()=>running.abort()});
 });
 console.log(`${count} publication supervisor/control groups passed; SQL driver and executor are doubles.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
