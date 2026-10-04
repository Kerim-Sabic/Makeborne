/* eslint-disable @typescript-eslint/no-require-imports -- Actual SDK with an offline fetch stub; no external requests. */
const fs = require('node:fs'), ts = require('typescript'), Module = require('node:module'), assert = require('node:assert/strict'), {randomUUID} = require('node:crypto'), {z} = require('zod');
const originalLoad = Module._load;
Module._load = function(name, parent, main) { if (name === 'server-only') return {}; return originalLoad.call(this, name, parent, main); };
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText, filename);
const {createOpenAITextAdapter} = require('./openai-text.ts');
const config = {apiKey:'offline-fixture-key',model:'fixture-pinned-model',maximumInputTokens:500,maximumOutputTokens:100,timeoutMs:1000,reasoningEffort:'medium'};
const contract = {name:'draft',schema:z.object({title:z.string().min(1),paragraphs:z.array(z.string()).min(1).max(10)}).strict()};
const request = {attemptId:randomUUID(),instructions:'Use only supplied facts.',input:'A useful product guide.'};
const valid = () => ({id:'resp_fixture',model:config.model,status:'completed',error:null,incomplete_details:null,output:[{id:'msg_fixture',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({title:'Guide',paragraphs:['Supplied content.']}),annotations:[]}]}],usage:{input_tokens:40,output_tokens:20,total_tokens:60,input_tokens_details:{cached_tokens:10,cache_write_tokens:0},output_tokens_details:{reasoning_tokens:5}}});
let checks=0;
async function check(name,fn){await fn();checks++;console.log('PASS '+name);}
function fixture(overrides={}) {
 let calls=0,claims=0,body,options,binding;
 const dependencies={spendingAllowed:()=>true,countInputTokens:async()=>40,claimDispatch:async value=>{claims++;binding=value;return true;},fetch:async(url,init)=>{calls++;assert.equal(String(url),'https://api.openai.com/v1/responses');body=JSON.parse(init.body);options=init;return new Response(JSON.stringify(valid()),{headers:{'content-type':'application/json','x-request-id':'req_fixture'}});},...overrides};
 const execute=createOpenAITextAdapter(config,contract,dependencies);
 return {run:(input=request,signal=new AbortController().signal)=>execute(input,signal),get calls(){return calls;},get claims(){return claims;},get body(){return body;},get options(){return options;},get binding(){return binding;}};
}
function responseFixture(change) {let calls=0;return {fetch:async()=>{calls++;const value=valid();change(value);return new Response(JSON.stringify(value),{headers:{'content-type':'application/json','x-request-id':'req_fixture'}});},get calls(){return calls;}};}
(async()=>{
 await check('disabled spending makes no claim or HTTP request',async()=>{const f=fixture({spendingAllowed:()=>false});assert.equal((await f.run()).reason,'disabled');assert.equal(f.calls,0);assert.equal(f.claims,0);});
 await check('invalid request never dispatches',async()=>{const f=fixture();assert.equal((await f.run({...request,url:'https://evil.invalid'})).reason,'invalid_request');assert.equal(f.calls,0);});
 await check('pre-cancelled attempt never dispatches',async()=>{const abort=new AbortController();abort.abort();const f=fixture();assert.equal((await f.run(request,abort.signal)).reason,'cancelled');assert.equal(f.calls,0);});
 for (const tokens of [501,NaN,1.5,-1]) await check('invalid or excessive input estimate '+tokens,async()=>{const f=fixture({countInputTokens:async()=>tokens});assert.equal((await f.run()).reason,'input_limit');assert.equal(f.calls,0);assert.equal(f.claims,0);});
 await check('token counter failure prevents dispatch',async()=>{const f=fixture({countInputTokens:async()=>{throw Error('counter unavailable');}});assert.equal((await f.run()).reason,'input_limit');assert.equal(f.calls,0);});
 await check('spending checked again after token counting',async()=>{let enabled=true;const f=fixture({spendingAllowed:()=>enabled,countInputTokens:async()=>{enabled=false;return 40;}});assert.equal((await f.run()).reason,'disabled');assert.equal(f.calls,0);assert.equal(f.claims,0);});
 await check('lost claim response stays uncertain without network call',async()=>{const f=fixture({claimDispatch:async()=>{throw Error('unknown commit');}});assert.equal((await f.run()).status,'uncertain');assert.equal(f.calls,0);});
 await check('duplicate durable claim does not dispatch',async()=>{const f=fixture({claimDispatch:async()=>false});const result=await f.run();assert.equal(result.status,'uncertain');assert.equal(result.reason,'claim');assert.equal(f.calls,0);});
 await check('cancellation after claim retains uncertainty',async()=>{const abort=new AbortController();const f=fixture({claimDispatch:async()=>{abort.abort();return true;}});assert.equal((await f.run(request,abort.signal)).status,'uncertain');assert.equal(f.calls,0);});
 await check('successful response preserves content and detailed usage',async()=>{const f=fixture();const result=await f.run();assert.equal(result.status,'accepted');assert.equal(result.value.title,'Guide');assert.equal(result.evidence.usage.input_tokens_details.cached_tokens,10);assert.equal(result.evidence.usage.output_tokens_details.reasoning_tokens,5);assert.equal(result.evidence.providerRequestId,'req_fixture');assert.equal(result.evidence.responseId,'resp_fixture');assert.equal(result.evidence.requestHash,f.binding.requestHash);assert.equal(f.calls,1);assert.equal(f.claims,1);});
 await check('request uses strict schema, no tools/storage/truncation and fixed output cap',async()=>{const f=fixture();await f.run();assert.equal(f.body.store,false);assert.equal(f.body.background,false);assert.equal(f.body.truncation,'disabled');assert.deepEqual(f.body.tools,[]);assert.equal(f.body.tool_choice,'none');assert.equal(f.body.max_output_tokens,100);assert.equal(f.body.text.format.strict,true);assert.equal(f.body.reasoning.effort,'medium');assert.equal(f.options.redirect,'error');assert.equal(new Headers(f.options.headers).get('x-client-request-id'),request.attemptId);});
 for(const [name,change,reason] of [
 ['truncated output',r=>{r.status='incomplete';r.incomplete_details={reason:'max_output_tokens'};},'incomplete'],
 ['refusal',r=>{r.output[0].content=[{type:'refusal',refusal:'No'}];},'refusal'],
 ['different model',r=>{r.model='other-model';},'model'],
 ['missing usage',r=>{r.usage=null;},'usage'],
 ['inconsistent totals',r=>{r.usage.total_tokens=999;},'usage'],
 ['excessive output',r=>{r.usage.output_tokens=101;r.usage.total_tokens=141;},'usage'],
 ['excessive input',r=>{r.usage.input_tokens=501;r.usage.total_tokens=521;},'usage'],
 ['invalid JSON',r=>{r.output[0].content[0].text='not json';},'output'],
 ['invalid output structure',r=>{r.output[0].content[0].text='{"title":"Guide","paragraphs":[]}';},'output'],
 ['unexpected output properties',r=>{r.output[0].content[0].text='{"title":"Guide","paragraphs":["x"],"extra":true}';},'output'],
 ['unexpected tool',r=>{r.output.push({type:'function_call',name:'danger'});},'output'],
 ['multiple messages',r=>{r.output.push({...r.output[0],id:'msg_second'});},'output']
 ]) await check(name+' rejected without retry',async()=>{const stub=responseFixture(change);const f=fixture({fetch:stub.fetch});const result=await f.run();assert.equal(result.status,'rejected');assert.equal(result.reason,reason);assert.equal(stub.calls,1);assert.equal(result.evidence.responseId,'resp_fixture');});
 await check('HTTP 500 makes one attempt and retains request ID',async()=>{let calls=0;const f=fixture({fetch:async()=>{calls++;return new Response(JSON.stringify({error:{message:'private provider detail'}}),{status:500,headers:{'content-type':'application/json','x-request-id':'req_failed'}});}});const result=await f.run();assert.equal(result.status,'uncertain');assert.equal(result.evidence.providerRequestId,'req_failed');assert.equal(calls,1);assert.ok(!JSON.stringify(result).includes('private provider detail'));});
 await check('transport loss never claims zero cost or auto-retries',async()=>{let calls=0;const f=fixture({fetch:async()=>{calls++;throw Error('private transport detail');}});const result=await f.run();assert.equal(result.status,'uncertain');assert.equal(result.evidence.usage,null);assert.equal(calls,1);});
 await check('request hash changes with exact input',async()=>{const a=fixture(),b=fixture();await a.run();await b.run({...request,input:'A changed brief.'});assert.notEqual(a.binding.requestHash,b.binding.requestHash);});
 await check('failed valid output still carries observed usage',async()=>{const stub=responseFixture(r=>{r.output[0].content[0].text='invalid';});const result=await fixture({fetch:stub.fetch}).run();assert.equal(result.status,'rejected');assert.equal(result.evidence.usage.total_tokens,60);});
 console.log(`${checks} offline OpenAI adapter checks passed; zero external requests.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
