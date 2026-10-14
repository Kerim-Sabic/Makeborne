/* eslint-disable @typescript-eslint/no-require-imports -- Offline private gateway transport qualification. */
require('../generation/check-website-worker.cjs');
const assert=require('node:assert/strict'),{createPreviewRpcClient}=require('./preview-rpc-client.ts');
const configuration={url:'https://abcdefghijklmnopqrst.supabase.co',secret:'sb_secret_OFFLINE_TEST_NOT_A_CREDENTIAL'},hash='a'.repeat(64),signal=()=>new AbortController().signal;
let checks=0;async function check(name,run){await run();checks++;console.log(`PASS ${name}`);}
async function main(){
 await check('exact two POST RPCs, secret header only, no forwarded cookie/auth or redirects',async()=>{
  const seen=[],rpc=createPreviewRpcClient(configuration,async function(url,init){seen.push(url);assert.equal(init.method,'POST');assert.equal(init.redirect,'manual');assert.equal(init.cache,undefined);assert.deepEqual(init.headers,{apikey:configuration.secret,'Content-Type':'application/json','Cache-Control':'no-store'});assert(init.signal instanceof AbortSignal);const args=JSON.parse(init.body);assert.equal(args.p_build_hash,hash);assert.equal(args.p_cookie_hash,hash);assert.equal(Object.keys(args).length,url.endsWith('makeborne_read_preview_session')?2:3);return Response.json({ok:true});});
  assert.deepEqual(await rpc.consume(hash,hash,hash,signal()),{ok:true});assert.deepEqual(await rpc.read(hash,hash,signal()),{ok:true});assert.deepEqual(seen,['makeborne_consume_preview_handoff','makeborne_read_preview_session'].map(name=>configuration.url+'/rest/v1/rpc/'+name));
 });
 await check('non-Supabase/cleartext/embedded credentials/path/query/fragment and invalid secret reject',async()=>{
  for(const url of ['https://evil.example','http://abcdefghijklmnopqrst.supabase.co','https://u:p@abcdefghijklmnopqrst.supabase.co','https://abcdefghijklmnopqrst.supabase.co/path','https://abcdefghijklmnopqrst.supabase.co?x=y','https://abcdefghijklmnopqrst.supabase.co/#x'])assert.throws(()=>createPreviewRpcClient({...configuration,url}));
  assert.throws(()=>createPreviewRpcClient({...configuration,secret:'public-key'}));assert.throws(()=>createPreviewRpcClient({...configuration,url:'http://127.0.0.1:55321'}));
  assert(createPreviewRpcClient({...configuration,url:'http://127.0.0.1:55321',allowLocalhost:true}));
 });
 await check('only scoped denial codes survive; malformed/private/oversized upstream bodies are generic',async()=>{
  for(const [body,status,expected]of [[{code:'P0002',message:'PRIVATE'},400,'P0002'],[{code:'42501',message:'PRIVATE'},403,'42501'],[{code:'PRIVATE',message:'PRIVATE'},500,'PREVIEW_AUTHORITY_UNAVAILABLE'],[null,200,'PREVIEW_AUTHORITY_UNAVAILABLE']])await assert.rejects(createPreviewRpcClient(configuration,async()=>Response.json(body,{status})).read(hash,hash,signal()),e=>e.code===expected&&!e.message.includes('PRIVATE'));
  for(const body of ['PRIVATE_BODY',Uint8Array.from([255]),'x'.repeat(512001)])await assert.rejects(createPreviewRpcClient(configuration,async()=>new Response(body)).read(hash,hash,signal()),e=>e.code==='PREVIEW_AUTHORITY_UNAVAILABLE'&&!e.message.includes('PRIVATE'));
 });
 await check('redirect responses never follow and their bodies are cancelled',async()=>{
  for(const status of [301,302,303,307,308]){
   let cancelled=false,calls=0;
   const rpc=createPreviewRpcClient(configuration,async(_url,init)=>{calls++;assert.equal(init.redirect,'manual');return new Response(new ReadableStream({cancel(){cancelled=true;}}),{status,headers:{Location:'https://example.invalid/private'}});});
   await assert.rejects(rpc.read(hash,hash,signal()),e=>e.code==='PREVIEW_AUTHORITY_UNAVAILABLE');assert.equal(calls,1);assert.equal(cancelled,true);
  }
 });
 await check('pre-abort, late response and stalled stream stop without returning data',async()=>{
  const before=new AbortController();before.abort();await assert.rejects(createPreviewRpcClient(configuration,async()=>assert.fail('ABORTED_FETCH')).read(hash,hash,before.signal));
  const after=new AbortController();await assert.rejects(createPreviewRpcClient(configuration,async()=>{after.abort();return Response.json({ok:true});}).read(hash,hash,after.signal));
  let reading,cancelled=false;const started=new Promise(resolve=>{reading=resolve;}),during=new AbortController();
  const pending=createPreviewRpcClient(configuration,async()=>new Response(new ReadableStream({pull(){reading();},cancel(){cancelled=true;}}))).read(hash,hash,during.signal);
  await started;during.abort();await assert.rejects(pending);assert(cancelled);
 });
 console.log(`${checks} preview RPC groups passed; no network or paid calls.`);
}
main().catch(error=>{console.error(`PREVIEW RPC CHECK FAILED: ${error.code||'ASSERTION'}; sensitive details omitted`);process.exitCode=1;});
