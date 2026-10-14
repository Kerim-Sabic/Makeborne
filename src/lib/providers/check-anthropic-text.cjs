/* eslint-disable @typescript-eslint/no-require-imports -- Offline transport fixtures, no API spend. */
const fs = require('node:fs'), ts = require('typescript'), Module = require('node:module'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto'), { z } = require('zod');
const load = Module._load;
Module._load = function(name,parent,main) { return name === 'server-only' ? {} : load.call(this,name,parent,main); };
require.extensions['.ts'] = (module,path) => module._compile(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,path);
const { createAnthropicTextAdapter } = require('./anthropic-text.ts');
const config = {apiKey:'offline-fixture',model:'fixture-model',maximumInputTokens:500,maximumOutputTokens:100,timeoutMs:1000};
const contract = {name:'draft',schema:z.object({title:z.string().min(1)}).strict()};
const input = {attemptId:randomUUID(),instructions:'Only supplied facts.',input:'A guide.'};
const valid = () => ({id:'msg_fixture',type:'message',role:'assistant',model:'fixture-model',stop_reason:'end_turn',stop_sequence:null,content:[{type:'text',text:'{"title":"Guide"}'}],usage:{input_tokens:40,output_tokens:20,cache_read_input_tokens:0,cache_creation_input_tokens:0}});
function fixture(overrides={},change=()=>{}) {
 let calls=0,body;
 const run=createAnthropicTextAdapter(config,contract,{spendingAllowed:()=>true,countInputTokens:async()=>40,claimDispatch:async()=>true,fetch:async(url,options)=>{calls++;assert.equal(String(url),'https://api.anthropic.com/v1/messages');assert.equal(options.redirect,'error');body=JSON.parse(options.body);const response=valid();change(response);return new Response(JSON.stringify(response),{headers:{'content-type':'application/json','request-id':'req_fixture'}});},...overrides});
 return {run:(signal=new AbortController().signal)=>run(input,signal),get calls(){return calls;},get body(){return body;}};
}
(async()=>{
 let n=0;
 for(const [name,deps] of [['disabled',{spendingAllowed:()=>false}],['input cap',{countInputTokens:async()=>501}],['claim denied',{claimDispatch:async()=>false}],['claim uncertain',{claimDispatch:async()=>{throw Error('lost commit');}}]]) {
  const f=fixture(deps);assert.notEqual((await f.run()).status,'accepted');assert.equal(f.calls,0);n++;console.log('PASS '+name);
 }
 const success=fixture();const result=await success.run();assert.equal(result.status,'accepted');assert.equal(result.value.title,'Guide');assert.equal(result.evidence.usage.total_tokens,60);assert.equal(result.evidence.providerRequestId,'req_fixture');assert.equal(success.body.max_tokens,100);assert.equal(success.body.output_config.format.type,'json_schema');assert.equal(success.body.tools,undefined);assert.equal(success.body.thinking,undefined);n++;
 for(const [name,change] of [['truncation',r=>r.stop_reason='max_tokens'],['refusal',r=>r.stop_reason='refusal'],['wrong model',r=>r.model='other'],['usage missing',r=>r.usage=null],['overspend',r=>r.usage.output_tokens=101],['invalid output',r=>r.content[0].text='{}'],['tool output',r=>r.content[0]={type:'tool_use',name:'bad'}],['malformed JSON',r=>r.content[0].text='invalid']]) {
  const f=fixture({},change);assert.equal((await f.run()).status,'rejected');assert.equal(f.calls,1);n++;console.log('PASS '+name);
 }
 for(const type of ['thinking','redacted_thinking']) {
  const f=fixture({},r=>{r.content.unshift(type==='thinking'?{type,thinking:'',signature:'fixture'}:{type,data:'fixture'});});
  assert.equal((await f.run()).status,'accepted');n++;
 }
 let attempts=0;const f=fixture({fetch:async()=>{attempts++;throw Error('private secret');}});const uncertain=await f.run();assert.equal(uncertain.status,'uncertain');assert.equal(attempts,1);assert.ok(!JSON.stringify(uncertain).includes('private secret'));n++;
 const abort=new AbortController();abort.abort();const canceled=fixture();assert.equal((await canceled.run(abort.signal)).status,'not_dispatched');assert.equal(canceled.calls,0);n++;
 for(const effort of ['low','medium','high','xhigh','max']){
  let body,counted,claim;const run=createAnthropicTextAdapter({...config,model:'claude-opus-5-5',effort},contract,{spendingAllowed:()=>true,countInputTokens:async value=>{counted=value;return 40;},claimDispatch:async value=>{claim=value;return true;},fetch:async(_url,options)=>{body=JSON.parse(options.body);const value=valid();value.model='claude-opus-5-5';value.usage.output_tokens_details={thinking_tokens:12};value.content.unshift({type:'thinking',thinking:'PRIVATE_THINKING',signature:'fixture'});return new Response(JSON.stringify(value),{headers:{'request-id':'req_fixture','content-type':'application/json'}});}});
  const outcome=await run(input,new AbortController().signal);assert.equal(outcome.status,'accepted');assert.equal(body.output_config.effort,effort);assert.equal(counted.output_config.effort,effort);assert.equal(claim.requestHash,require('node:crypto').createHash('sha256').update(JSON.stringify(body)).digest('hex'));assert.equal(outcome.evidence.usage.output_tokens_details.reasoning_tokens,12);assert.equal(outcome.evidence.usage.output_tokens_details.reasoning_tokens_reported,true);assert(!JSON.stringify(outcome).includes('PRIVATE_THINKING'));n++;
 }
 for(const model of ['unknown-model','claude-haiku-4-5-20251001','claude-opus-4-5-20251101']){assert.throws(()=>createAnthropicTextAdapter({...config,model,effort:'xhigh'},contract,{spendingAllowed:()=>true,countInputTokens:async()=>assert.fail('UNSUPPORTED_COUNT'),claimDispatch:async()=>assert.fail('UNSUPPORTED_CLAIM')}),e=>e.code==='ANTHROPIC_EFFORT_UNSUPPORTED');n++;}
 const invalidThinking=fixture({},r=>{r.usage.output_tokens_details={thinking_tokens:21};});assert.equal((await invalidThinking.run()).reason,'usage');n++;
 const unknownThinking=await fixture().run();assert.equal(unknownThinking.evidence.usage.output_tokens_details.reasoning_tokens_reported,false);n++;
 for(const timeoutMs of [999,540001])assert.throws(()=>createAnthropicTextAdapter({...config,timeoutMs},contract,{}));
 createAnthropicTextAdapter({...config,timeoutMs:480000},contract,{});n++;
 let brokenCalls=0;const broken=fixture({fetch:async()=>{brokenCalls++;return new Response(new ReadableStream({start(controller){controller.error(Error('PRIVATE_BODY_ERROR'));}}),{headers:{'content-type':'application/json','request-id':'req_body_failed'}});}});
 const brokenResult=await broken.run();assert.equal(brokenResult.status,'uncertain');assert.equal(brokenResult.evidence.providerRequestId,'req_body_failed');assert.equal(brokenCalls,1);assert(!JSON.stringify(brokenResult).includes('PRIVATE_BODY_ERROR'));n++;
 const concurrent=createAnthropicTextAdapter(config,contract,{spendingAllowed:()=>true,countInputTokens:async()=>40,claimDispatch:async()=>true,fetch:async(_url,options)=>{const body=JSON.parse(options.body);const id=body.messages[0].content;await new Promise(resolve=>setTimeout(resolve,id==='A'?20:1));return new Response(new ReadableStream({start(controller){controller.error(Error('PRIVATE_BODY_ERROR'));}}),{headers:{'content-type':'application/json','request-id':`req_${id}`}});}});
 const parallel=await Promise.all(['A','B'].map(value=>concurrent({...input,attemptId:randomUUID(),input:value},new AbortController().signal)));
 assert.deepEqual(parallel.map(value=>value.evidence.providerRequestId),['req_A','req_B']);n++;
 console.log(`${n} offline Claude checks passed; no paid API calls.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
