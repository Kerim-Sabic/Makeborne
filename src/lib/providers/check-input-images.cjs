/* eslint-disable @typescript-eslint/no-require-imports -- Real SDK serialization, offline transport and raster decoding. */
const fs=require('node:fs'),ts=require('typescript'),Module=require('node:module'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto'),{z}=require('zod'),sharp=require('sharp');
const load=Module._load;Module._load=function(name,parent,main){return name==='server-only'?{}:load.call(this,name,parent,main);};
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {createAnthropicTextAdapter}=require('./anthropic-text.ts'),{createOpenAITextAdapter}=require('./openai-text.ts');
const {ModelInputImagesSchema}=require('./input-images.ts');
const config={apiKey:'offline',model:'fixture-model',maximumInputTokens:500,maximumOutputTokens:100,timeoutMs:1000},contract={name:'fixture',schema:z.object({title:z.string()}).strict()};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function main(){let groups=0;async function check(name,run){await run();groups++;console.log('PASS '+name);}
 const bytes=await sharp({create:{width:32,height:24,channels:3,background:'#3559d8'}}).png().toBuffer();
 const image={assetId:randomUUID(),mediaType:'image/png',sha256:digest(bytes),data:bytes.toString('base64')};
 function harness(provider,images=[image],options={}){let counts=0,claims=0,fetches=0,counted,sent,binding;
 const run=(provider==='anthropic'?createAnthropicTextAdapter:createOpenAITextAdapter)(config,contract,{spendingAllowed:()=>options.enabled!==false,
  countInputTokens:async body=>{counts++;counted=body;return options.tokens??40;},claimDispatch:async value=>{claims++;binding=value;return options.claimed!==false;},
  fetch:async(url,init)=>{fetches++;sent=JSON.parse(init.body);assert.equal(init.redirect,'error');
   const value=provider==='anthropic'?{id:'msg_fixture',type:'message',role:'assistant',model:config.model,stop_reason:'end_turn',stop_sequence:null,content:[{type:'text',text:'{"title":"Guide"}'}],usage:{input_tokens:40,output_tokens:20,cache_creation_input_tokens:0,cache_read_input_tokens:0}}:
   {id:'resp_fixture',object:'response',created_at:1,status:'completed',model:config.model,error:null,incomplete_details:null,output:[{id:'msg_fixture',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'{"title":"Guide"}',annotations:[]}]}],usage:{input_tokens:40,output_tokens:20,total_tokens:60,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}};
   return new Response(JSON.stringify(value),{headers:{'content-type':'application/json','request-id':'req_fixture','x-request-id':'req_fixture'}});}});
 return {run:(signal=new AbortController().signal)=>run({attemptId:randomUUID(),instructions:'Use approved artwork only.',input:'Compose.',images},signal),get counts(){return counts;},get claims(){return claims;},get fetches(){return fetches;},get counted(){return counted;},get sent(){return sent;},get binding(){return binding;}};
 }
 for(const provider of ['anthropic','openai']){
  await check(provider+' counts and sends the identical original pixels/labels, with hash-bound durable claim',async()=>{
   const f=harness(provider),result=await f.run();assert.equal(result.status,'accepted');assert.equal(f.counts,1);assert.equal(f.claims,1);assert.equal(f.fetches,1);assert.deepEqual(f.sent,JSON.parse(JSON.stringify(f.counted)));assert.equal(f.binding.requestHash,digest(Buffer.from(JSON.stringify(f.sent))));
   const parts=provider==='anthropic'?f.sent.messages[0].content:f.sent.input[0].content;
   assert(parts[0].text.includes(image.assetId)&&parts[0].text.includes(image.sha256));
   assert.equal(provider==='anthropic'?parts[1].source.data:parts[1].image_url,provider==='anthropic'?image.data:`data:image/png;base64,${image.data}`);
   assert.equal(parts.at(-1).text,'Compose.');assert.equal(result.evidence.usage.input_tokens,40);
  });
  await check(provider+' rejects altered hash, remote URLs, duplicate IDs and invalid base64 before count/claim/network',async()=>{
   for(const images of [[{...image,sha256:'a'.repeat(64)}],[{...image,data:'https://evil.test/image.png'}],[image,{...image,assetId:image.assetId.toUpperCase()}],[{...image,data:image.data+'='}],[{...image,url:'https://evil.test'}]]){
    const f=harness(provider,images);assert.equal((await f.run()).status,'not_dispatched');assert.equal(f.counts+f.claims+f.fetches,0);
   }
  });
  await check(provider+' refuses hash-matched invalid pixels or MIME before counting',async()=>{
   const bad=Buffer.from('not a raster');for(const images of [[{...image,data:bad.toString('base64'),sha256:digest(bad)}],[{...image,mediaType:'image/webp'}]]){
    const f=harness(provider,images);assert.equal((await f.run()).status,'not_dispatched');assert.equal(f.counts+f.claims+f.fetches,0);
   }
  });
  await check(provider+' vision counting remains inside approved input cap and spending/claim guards',async()=>{
   for(const options of [{tokens:501},{enabled:false},{claimed:false}]){const f=harness(provider,[image],options);assert.notEqual((await f.run()).status,'accepted');assert.equal(f.fetches,0);}
   const c=new AbortController();c.abort();const f=harness(provider);assert.equal((await f.run(c.signal)).reason,'cancelled');assert.equal(f.counts+f.claims+f.fetches,0);
  });
  await check(provider+' request identity changes when artwork identity or pixels change',async()=>{
   const changed=await sharp({create:{width:32,height:24,channels:3,background:'#d85539'}}).png().toBuffer();
   const a=harness(provider),b=harness(provider,[{...image,sha256:digest(changed),data:changed.toString('base64')}]);await a.run();await b.run();assert.notEqual(a.binding.requestHash,b.binding.requestHash);
  });
 }
 await check('shared image count and aggregate byte caps refuse excess without a provider call',()=>{
  assert(!ModelInputImagesSchema.safeParse(Array.from({length:21},()=>({...image,assetId:randomUUID()}))).success);
  const big=Buffer.alloc(3_000_000),item={...image,data:big.toString('base64'),sha256:digest(big)};
  assert(!ModelInputImagesSchema.safeParse(Array.from({length:5},()=>({...item,assetId:randomUUID()}))).success);
 });
 console.log(`${groups} vision-input groups passed; offline SDK transports and real raster decoding, zero paid calls.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
