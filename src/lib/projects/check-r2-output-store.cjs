/* eslint-disable @typescript-eslint/no-require-imports -- Local workerd R2 qualification; no account or paid calls. */
require('../generation/check-website-worker.cjs');
const assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const {createR2OutputStore}=require('./r2-output-store.ts'),{retainCompiledOutput,readCompiledOutputFile}=require('./compiled-output.ts'),{canonicalSourceJson}=require('./canonical-json.ts');
const fs=require('node:fs/promises'),path=require('node:path'),{tmpdir}=require('node:os');
const signal=()=>new AbortController().signal,digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const key=()=>`compiled-v1/${randomUUID()}/${randomUUID()}/${randomUUID()}/${'a'.repeat(64)}/files/index.html`;
let checks=0;
async function check(name,run){await run();checks++;console.log(`PASS ${name}`);}
async function main(){
 const {createLocalR2OutputRuntime}=await import('../../../infra/project-runtime/local-r2-output.mjs');
 const directory=await fs.mkdtemp(path.join(tmpdir(),'makeborne-build-'));let mf;
 try{
  mf=await createLocalR2OutputRuntime(directory);const bucket=mf.bucket,store=createR2OutputStore(bucket);
  await check('actual R2 conditional creation preserves first bytes across duplicate and competing writes',async()=>{
   const target=key();await store.putIfAbsent(target,Buffer.from('original'),signal());await store.putIfAbsent(target,Buffer.from('replacement'),signal());assert.equal(Buffer.from(await store.get(target,8,signal())).toString(),'original');
   const race=key(),values=Array.from({length:12},(_,i)=>Buffer.from(`candidate-${String(i).padStart(2,'0')}`));await Promise.all(values.map(bytes=>store.putIfAbsent(race,bytes,signal())));
   const winner=Buffer.from(await store.get(race,12,signal())).toString();assert(values.some(bytes=>bytes.toString()===winner));await store.putIfAbsent(race,Buffer.from('late-value!!'),signal());assert.equal(Buffer.from(await store.get(race,12,signal())).toString(),winner);
  });
  await check('actual R2 missing/empty objects, allocation limits and scoped keys',async()=>{
   assert.equal(await store.get(key(),10,signal()),null);const empty=key();await store.putIfAbsent(empty,Buffer.alloc(0),signal());assert.equal((await store.get(empty,0,signal())).length,0);
   const large=key();await store.putIfAbsent(large,Buffer.alloc(100),signal());await assert.rejects(store.get(large,99,signal()),e=>e.code==='OUTPUT_READ_LIMIT');
   for(const invalid of ['../secret','compiled-v1/local/key',key()+'/../escape',key()+'?token=x',key().replace('/files/','/files//')])await assert.rejects(store.get(invalid,100,signal()),e=>e.code==='OUTPUT_KEY_INVALID');
   for(const limit of [-1,50_000_001,NaN,Infinity,0.5])await assert.rejects(store.get(key(),limit,signal()),e=>e.code==='OUTPUT_READ_LIMIT');
  });
  await check('metadata and streaming limits enforced before allocation and across malformed/truncated bodies',async()=>{
   let read=false,cancelled=false;
   const fake=bytes=>({put:async()=>null,get:async()=>({size:2,body:new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();},cancel(){cancelled=true;}})})});
   const oversized=createR2OutputStore({put:async()=>null,get:async()=>({size:101,body:{cancel:async()=>{cancelled=true;},getReader:()=>{read=true;assert.fail('UNBOUNDED_ALLOCATION');}}})});
   await assert.rejects(oversized.get(key(),100,signal()),e=>e.code==='OUTPUT_READ_LIMIT');assert(cancelled);assert.equal(read,false);
   await assert.rejects(createR2OutputStore(fake(Buffer.from('toolong'))).get(key(),100,signal()),e=>e.code==='OUTPUT_READ_LIMIT');
   await assert.rejects(createR2OutputStore(fake(Buffer.from('x'))).get(key(),100,signal()),e=>e.code==='OUTPUT_BYTES_CHANGED');
  });
  await check('abort before binding, after binding and during pending stream never returns bytes',async()=>{
   const controller=new AbortController();controller.abort();await assert.rejects(store.get(key(),10,controller.signal));await assert.rejects(store.putIfAbsent(key(),Buffer.from('x'),controller.signal));
   const late=new AbortController();let cancelled=false;
   const lateStore=createR2OutputStore({put:async()=>{late.abort();return null;},get:async()=>{late.abort();return {size:1,body:{cancel:async()=>{cancelled=true;}}};}});
   await assert.rejects(lateStore.get(key(),1,late.signal));assert(cancelled);
   const writing=new AbortController();await assert.rejects(createR2OutputStore({get:async()=>null,put:async()=>{writing.abort();return null;}}).putIfAbsent(key(),Buffer.from('x'),writing.signal));
   const waiting=new AbortController();let reading;
   const started=new Promise(resolve=>{reading=resolve;});
   const pending=createR2OutputStore({put:async()=>null,get:async()=>({size:1,body:new ReadableStream({pull(){reading();},cancel(){cancelled=true;}})})}).get(key(),1,waiting.signal);
   await started;waiting.abort();await assert.rejects(pending);assert(cancelled);
  });
  const contents=new Map([['index.html',Buffer.from('<!doctype html><h1>Retained R2 website</h1>')],['assets/app.js',Buffer.from('document.title="R2 site"')],['empty.txt',Buffer.alloc(0)]]);
  const identity={schemaVersion:1,artifactId:randomUUID(),revisionId:randomUUID(),version:1,sourceHash:'a'.repeat(64),toolchainId:'react-vite-v1',toolchainHash:'b'.repeat(64),runtimeImageId:`sha256:${'c'.repeat(64)}`,routes:[{path:'/',title:'R2 site'}],files:[...contents].map(([path,bytes])=>({path,bytes:bytes.length,sha256:digest(bytes)}))};
  const receipt={...identity,buildHash:digest(canonicalSourceJson(identity))},workspace=randomUUID(),read=async name=>contents.get(name);
  await check('shared receipt-last retention and manifest reads work against real local R2',async()=>{
   await retainCompiledOutput(store,workspace,receipt,read,signal());await retainCompiledOutput(store,workspace,receipt,read,signal());
   for(const [name,bytes]of contents)assert.deepEqual(Buffer.from(await readCompiledOutputFile(store,workspace,receipt,name,signal())),bytes);
   await assert.rejects(readCompiledOutputFile(store,randomUUID(),receipt,'index.html',signal()),e=>e.code==='OUTPUT_NOT_RETAINED');
   assert.equal(await readCompiledOutputFile(store,workspace,receipt,'../index.html',signal()),null);
  });
  await check('partial upload cannot expose a receipt, retry uses original immutable files',async()=>{
   const other=randomUUID();let writes=0;const interrupted={...store,putIfAbsent:async(...args)=>{if(++writes===2)throw Error('SYNTHETIC_INTERRUPTION');return store.putIfAbsent(...args);}};
   await assert.rejects(retainCompiledOutput(interrupted,other,receipt,read,signal()));await assert.rejects(readCompiledOutputFile(store,other,receipt,'index.html',signal()),e=>e.code==='OUTPUT_NOT_RETAINED');
   await retainCompiledOutput(store,other,receipt,read,signal());assert.deepEqual(Buffer.from(await readCompiledOutputFile(store,other,receipt,'index.html',signal())),contents.get('index.html'));
  });
  await mf.dispose();mf=await createLocalR2OutputRuntime(directory);
  await check('actual R2 persisted data survives workerd restart and detects administrator corruption',async()=>{
   const reopenedBucket=mf.bucket,reopened=createR2OutputStore(reopenedBucket);
   assert.deepEqual(Buffer.from(await readCompiledOutputFile(reopened,workspace,receipt,'index.html',signal())),contents.get('index.html'));
   const target=`compiled-v1/${workspace}/${receipt.artifactId}/${receipt.revisionId}/${receipt.buildHash}/files/index.html`;await reopenedBucket.put(target,'bad');
   await assert.rejects(readCompiledOutputFile(reopened,workspace,receipt,'index.html',signal()),e=>e.code==='OUTPUT_BYTES_CHANGED');
  });
 }finally{await mf?.dispose();const {removeLocalTemporary}=await import('../../../infra/project-runtime/local-adapter.mjs');await removeLocalTemporary(directory);}
 console.log(`${checks} R2 groups passed with actual local workerd, no Cloudflare account, remote requests or paid calls.`);
}
main().catch(error=>{console.error(`R2 CHECK FAILED: ${typeof error.code==='string'?error.code:'ASSERTION_OR_CONFIGURATION'}; sensitive details omitted`);process.exitCode=1;});
