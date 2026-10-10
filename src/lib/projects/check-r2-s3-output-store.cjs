/* eslint-disable @typescript-eslint/no-require-imports -- Explicit local signed-storage qualification; no cloud account or provider transport. */
require('../generation/check-website-worker.cjs');
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path'),{tmpdir}=require('node:os');
const {createR2S3OutputStore}=require('./r2-s3-output-store.ts');
const signal=()=>new AbortController().signal,key=()=>`compiled-v1/${randomUUID()}/${randomUUID()}/${randomUUID()}/${'a'.repeat(64)}/files/index.html`;
let checks=0;async function check(name,run){await run();checks++;console.log(`PASS ${name}`);}
async function main(){
 const {createLocalR2S3OutputRuntime}=await import('../../../infra/project-runtime/local-r2-s3-output.mjs');
 const directory=await fs.mkdtemp(path.join(tmpdir(),'makeborne-s3-fixture-'));let runtime;
 try{
  runtime=await createLocalR2S3OutputRuntime(directory);const config=runtime.configuration,store=createR2S3OutputStore(config,runtime.transport);
  await check('independently verified SigV4 HTTP requests retain exact bytes in actual private R2 and never overwrite',async()=>{
   const target=key();await store.putIfAbsent(target,Buffer.from('original'),signal());await store.putIfAbsent(target,Buffer.from('replacement'),signal());assert.equal(Buffer.from(await store.get(target,8,signal())).toString(),'original');
   const race=key(),values=Array.from({length:8},(_,i)=>Buffer.from(`value-${i}`));await Promise.all(values.map(bytes=>store.putIfAbsent(race,bytes,signal())));const winner=Buffer.from(await store.get(race,7,signal()));assert(values.some(bytes=>bytes.equals(winner))); 
  });
  await check('local HTTP verifier rejects tampered signature and payload without writing R2',async()=>{
   const before=runtime.stats().denials;
   for(const mode of ['signature','payload']){
    const tampered=createR2S3OutputStore(config,async request=>{
     const headers=new Headers(request.headers);if(mode==='signature'){const auth=headers.get('Authorization');headers.set('Authorization',auth.slice(0,-1)+(auth.endsWith('0')?'1':'0'));}
     return runtime.transport(new Request(request.url,{method:request.method,headers,body:mode==='payload'?'tampered':await request.arrayBuffer(),signal:request.signal,redirect:'manual'}));
    });
    await assert.rejects(tampered.putIfAbsent(key(),Buffer.from('original'),signal()),e=>e.code==='OUTPUT_STORAGE_UNAVAILABLE');
   }
   assert.equal(runtime.stats().denials,before+2);
  });
  await check('empty/missing objects and bounds; private bucket/auth errors are never missing files',async()=>{
   const empty=key();await store.putIfAbsent(empty,Buffer.alloc(0),signal());assert.equal((await store.get(empty,0,signal())).length,0);assert.equal(await store.get(key(),100,signal()),null);
   for(const code of ['NoSuchBucket','AccessDenied'])await assert.rejects(createR2S3OutputStore(config,async()=>new Response(`<Error><Code>${code}</Code></Error>`,{status:404})).get(key(),100,signal()),e=>e.code==='OUTPUT_STORAGE_UNAVAILABLE');
  });
  await check('invalid account/bucket/credential configuration, scope keys and limits fail before transport',async()=>{
   for(const patch of [{accountId:'other.example'},{bucket:'../other'},{bucket:'Bucket'},{accessKeyId:'public'},{secretAccessKey:'secret'}])assert.throws(()=>createR2S3OutputStore({...config,...patch}));
   const noTransport=createR2S3OutputStore(config,async()=>assert.fail('REJECTED_INPUT_FETCHED'));
   for(const invalid of ['../x',key()+'?x=y',key()+'/../x'])await assert.rejects(noTransport.get(invalid,10,signal()),e=>e.code==='OUTPUT_KEY_INVALID');
   for(const limit of [-1,50_000_001,NaN,Infinity,0.5])await assert.rejects(noTransport.get(key(),limit,signal()),e=>e.code==='OUTPUT_READ_LIMIT');
  });
  await check('required exact length, compression refusal and streaming overflow/truncation checks',async()=>{
   for(const headers of [{},{'Content-Length':'-1'},{'Content-Length':'9007199254740992'},{'Content-Length':'1','Content-Encoding':'gzip'},{'Content-Length':'0'}])await assert.rejects(createR2S3OutputStore(config,async()=>new Response('x',{headers})).get(key(),10,signal()));
   await assert.rejects(createR2S3OutputStore(config,async()=>new Response('x',{headers:{'Content-Length':'2'}})).get(key(),10,signal()),e=>e.code==='OUTPUT_BYTES_CHANGED');
   await assert.rejects(createR2S3OutputStore(config,async()=>new Response('xx',{headers:{'Content-Length':'1'}})).get(key(),10,signal()),e=>e.code==='OUTPUT_READ_LIMIT');
  });
  await check('redirects/auth/transport failures do not retry, leak upstream errors or follow credentials',async()=>{
   for(const status of [301,302,303,307,308,403,409,500]){let calls=0;const failing=createR2S3OutputStore(config,async request=>{calls++;assert.equal(request.redirect,'manual');assert.equal(request.cache,'no-store');return new Response('PRIVATE_UPSTREAM',{status,headers:{Location:'https://example.invalid'}});});await assert.rejects(failing.putIfAbsent(key(),Buffer.from('x'),signal()),e=>e.code==='OUTPUT_STORAGE_UNAVAILABLE'&&!e.message.includes('PRIVATE'));assert.equal(calls,1);}
   await assert.rejects(createR2S3OutputStore(config,async()=>{throw Error('PRIVATE_CREDENTIAL');}).get(key(),10,signal()),e=>e.code==='OUTPUT_STORAGE_UNAVAILABLE'&&!e.message.includes('PRIVATE'));
  });
  await check('caller bytes snapshotted before signing; abort before/after response/during stream never returns data',async()=>{
   const bytes=Buffer.from('original');let captured;const pending=createR2S3OutputStore(config,async request=>{captured=Buffer.from(await request.arrayBuffer());return new Response(null,{status:200});}).putIfAbsent(key(),bytes,signal());bytes.fill(0);await pending;assert.equal(captured.toString(),'original');
   const before=new AbortController();before.abort();await assert.rejects(store.get(key(),10,before.signal));
   const late=new AbortController();await assert.rejects(createR2S3OutputStore(config,async()=>{late.abort();return new Response('x',{headers:{'Content-Length':'1'}});}).get(key(),10,late.signal));
   let entered,cancelled=false;const started=new Promise(resolve=>{entered=resolve;}),controller=new AbortController();
   const reading=createR2S3OutputStore(config,async()=>new Response(new ReadableStream({pull(){entered();},cancel(){cancelled=true;}}),{headers:{'Content-Length':'1'}})).get(key(),1,controller.signal);await started;controller.abort();await assert.rejects(reading);assert(cancelled);
  });
  const target=key();await store.putIfAbsent(target,Buffer.from('persistent'),signal());assert.equal(runtime.stats().denials,2);await runtime.dispose();runtime=null;
  runtime=await createLocalR2S3OutputRuntime(directory);
  await check('actual signed HTTP reads survive workerd/R2 restart without the original client',async()=>{const reopened=createR2S3OutputStore(runtime.configuration,runtime.transport);assert.equal(Buffer.from(await reopened.get(target,10,signal())).toString(),'persistent');assert.equal(runtime.stats().denials,0);});
 }finally{await runtime?.dispose();await fs.rm(directory,{recursive:true,force:true});}
 console.log(`${checks} signed R2 groups passed; no cloud account or paid calls; owned HTTP/workerd persistence removed.`);
}
main().catch(error=>{console.error(`SIGNED STORAGE CHECK FAILED: ${error.code||'ASSERTION'}; details omitted`);process.exitCode=1;});
