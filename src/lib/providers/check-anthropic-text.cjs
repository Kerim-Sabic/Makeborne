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
 let attempts=0;const f=fixture({fetch:async()=>{attempts++;throw Error('private secret');}});const uncertain=await f.run();assert.equal(uncertain.status,'uncertain');assert.equal(attempts,1);assert.ok(!JSON.stringify(uncertain).includes('private secret'));n++;
 const abort=new AbortController();abort.abort();const canceled=fixture();assert.equal((await canceled.run(abort.signal)).status,'not_dispatched');assert.equal(canceled.calls,0);n++;
 console.log(`${n} offline Claude checks passed; no paid API calls.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
