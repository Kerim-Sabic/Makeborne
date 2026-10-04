/* eslint-disable @typescript-eslint/no-require-imports -- Offline actual SDK requests; all fetches stubbed. */
const fs=require('node:fs'),ts=require('typescript'),Module=require('node:module'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto'),sharp=require('sharp');
const load=Module._load;Module._load=function(name,parent,main){if(name==='server-only')return {};return load.call(this,name,parent,main);};
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const {createOpenAIImageAdapter}=require('./openai-image.ts');
const config={apiKey:'offline-only',model:'gpt-image-fixture',size:'1024x1024',quality:'high',background:'opaque',maximumInputTokens:1000,maximumOutputTokens:5000,timeoutMs:1000};
const request={attemptId:randomUUID(),prompt:'An editorial botanical illustration.'};
let png,count=0;
async function check(name,fn){await fn();count++;console.log('PASS '+name);}
function response(){return {created:1791072000,background:'opaque',output_format:'png',quality:'high',size:'1024x1024',data:[{b64_json:png.toString('base64')}],usage:{input_tokens:100,output_tokens:1000,total_tokens:1100,input_tokens_details:{image_tokens:0,text_tokens:100},output_tokens_details:{image_tokens:1000,text_tokens:0}}};}
function fixture(change=()=>{},overrides={}){let calls=0,claims=0,body,options;const run=createOpenAIImageAdapter(config,{spendingAllowed:()=>true,countInputTokens:async()=>100,claimDispatch:async()=>{claims++;return true;},fetch:async(url,init)=>{calls++;assert.equal(String(url),'https://api.openai.com/v1/images/generations');body=JSON.parse(init.body);options=init;const value=response();change(value);return new Response(JSON.stringify(value),{headers:{'content-type':'application/json','x-request-id':'req_image'}});},...overrides});return {run:(value=request,signal=new AbortController().signal)=>run(value,signal),get calls(){return calls;},get claims(){return claims;},get body(){return body;},get options(){return options;}};}
(async()=>{
 png=await sharp({create:{width:1024,height:1024,channels:3,background:'#456749'}}).png().toBuffer();
 await check('disabled spending prevents claims and calls',async()=>{const f=fixture(()=>{},{spendingAllowed:()=>false});assert.equal((await f.run()).reason,'disabled');assert.equal(f.calls,0);assert.equal(f.claims,0);});
 await check('untrusted request fields rejected',async()=>{const f=fixture();assert.equal((await f.run({...request,n:10})).reason,'invalid_request');assert.equal(f.calls,0);});
 await check('input estimate bounded before claim',async()=>{const f=fixture(()=>{},{countInputTokens:async()=>1001});assert.equal((await f.run()).reason,'input_limit');assert.equal(f.claims,0);});
 await check('cancelled input never calls provider',async()=>{const abort=new AbortController();abort.abort();const f=fixture();assert.equal((await f.run(request,abort.signal)).reason,'cancelled');assert.equal(f.calls,0);});
 await check('duplicate claim remains uncertain with zero requests',async()=>{const f=fixture(()=>{},{claimDispatch:async()=>false});assert.equal((await f.run()).reason,'claim');assert.equal(f.calls,0);});
 await check('lost claim response never dispatches',async()=>{const f=fixture(()=>{},{claimDispatch:async()=>{throw Error('unknown commit');}});assert.equal((await f.run()).status,'uncertain');assert.equal(f.calls,0);});
 await check('validated PNG bytes and digest preserved',async()=>{const f=fixture();const out=await f.run();assert.equal(out.status,'image_ready');assert.deepEqual(out.image.bytes,png);assert.equal(out.image.sha256,createHash('sha256').update(png).digest('hex'));assert.equal(out.image.width,1024);assert.equal(out.requiresVisualReview,true);assert.equal(out.evidence.usage.output_tokens_details.image_tokens,1000);assert.equal(f.calls,1);});
 await check('one bounded image with explicit quality and no redirects',async()=>{const f=fixture();await f.run();assert.equal(f.body.n,1);assert.equal(f.body.quality,'high');assert.equal(f.body.size,'1024x1024');assert.equal(f.body.output_format,'png');assert.equal(f.body.stream,false);assert.equal(f.body.moderation,'auto');assert.equal(f.body.response_format,undefined);assert.equal(f.options.redirect,'error');});
 const wrongSize=await sharp({create:{width:512,height:512,channels:3,background:'#456749'}}).png().toBuffer();
 const jpeg=await sharp(png).jpeg().toBuffer();
 for(const [name,change,reason] of [
 ['missing usage',r=>delete r.usage,'usage'],
 ['usage overflow',r=>{r.usage.output_tokens=5001;r.usage.total_tokens=5101;r.usage.output_tokens_details.image_tokens=5001;},'usage'],
 ['inconsistent usage',r=>r.usage.total_tokens=9,'usage'],
 ['unexpected image count',r=>r.data.push({...r.data[0]}),'output'],
 ['URL response',r=>{r.data[0]={url:'https://outside.invalid/private'};},'output'],
 ['malformed base64',r=>r.data[0].b64_json='not base64','output'],
 ['invalid PNG bytes',r=>r.data[0].b64_json=Buffer.from('not an image').toString('base64'),'output'],
 ['disguised JPEG',r=>r.data[0].b64_json=jpeg.toString('base64'),'output'],
 ['wrong pixel dimensions',r=>r.data[0].b64_json=wrongSize.toString('base64'),'dimensions'],
 ['mismatched declared quality',r=>r.quality='low','output'],
 ['mismatched declared format',r=>r.output_format='jpeg','output'],
 ['mismatched declared background',r=>r.background='transparent','output'],
 ['truncated pixel data',r=>r.data[0].b64_json=png.subarray(0,100).toString('base64'),'output'],
 ]) await check(name+' rejected without retry',async()=>{const f=fixture(change);const out=await f.run();assert.equal(out.status,'rejected');assert.equal(out.reason,reason);assert.equal(f.calls,1);assert.equal(out.evidence.providerRequestId,'req_image');});
 await check('HTTP failure keeps unknown outcome and never retries',async()=>{let calls=0;const f=fixture(()=>{},{fetch:async()=>{calls++;return new Response('{"error":{"message":"private detail"}}',{status:500,headers:{'content-type':'application/json','x-request-id':'req_error'}});}});const out=await f.run();assert.equal(out.status,'uncertain');assert.equal(out.evidence.providerRequestId,'req_error');assert.equal(calls,1);assert.ok(!JSON.stringify(out).includes('private detail'));});
 await check('invalid dimensions rejected during configuration',()=>assert.throws(()=>createOpenAIImageAdapter({...config,size:'4096x4096'},{})));
 console.log(`${count} offline image adapter checks passed; zero external requests.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
