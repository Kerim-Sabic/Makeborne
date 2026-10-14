/* eslint-disable @typescript-eslint/no-require-imports -- Offline SDK transport; real local layout renderer. */
const fs=require('node:fs'),ts=require('typescript'),Module=require('node:module'),assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const load=Module._load;Module._load=function(name,parent,main){return name==='server-only'?{}:load.call(this,name,parent,main);};
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const {createNativeSlideFixture}=require('../../../supabase/native-slide-fixture.cjs');
const {preparePresentationComposition}=require('./presentation-proposal.ts');
const {createClaudePresentationWorker}=require('./presentation-worker.ts');
function harness(patch={}){
 const fixture=createNativeSlideFixture(),now=new Date().toISOString();
 const input={scope:{workspaceId:randomUUID(),projectId:randomUUID(),artifactId:randomUUID()},baseVersionId:randomUUID(),brief:'Compose a distinctive editorial presentation using this approved copy.',audience:'Independent shop owners',purpose:'Review the creative direction',wording:'preserve',...fixture,sourceIds:[]};
 const route={id:'offline-presentation-fixture',version:'fixture-v1',provider:'anthropic',model:'claude-opus-5-5',capabilities:['text','slide_content'],status:'ready',adapterVerified:true,configurationRef:'offline-only',dataBoundary:'external',policyApproved:true,licenseApproved:true,evaluation:{evidenceId:'synthetic-offline-score-not-model-quality',quality:95},priority:1,price:{version:'synthetic-tariff-v1',evidenceId:'offline-transport',expiresAt:new Date(Date.now()+3600000).toISOString(),lines:['input_tokens','output_tokens'].map(unit=>({unit,perUnits:'1',vendorMicrousd:'2',customerCredits:'1'})),fixedVendorMicrousd:'0',fixedCustomerCredits:'0'}};
 const options={now,effort:patch.effort??'light',maximumInputTokens:10000,maximumOutputTokens:5000,maximumVendorMicrousd:'100000',maximumCustomerCredits:'100000',externalProcessingAllowed:true,sourceRightsConfirmed:true};
 const proposal=preparePresentationComposition(input,options,[route]).proposal;
 const lease={jobId:randomUUID(),workspaceId:input.scope.workspaceId,workerId:randomUUID(),fence:'1',deadlineAt:new Date(Date.now()+600000).toISOString(),approvedInput:{actorId:randomUUID(),authorizationExpiresAt:new Date(Date.now()+600000).toISOString(),proposal,sourceMaterial:[]}};
 const output={theme:null,slides:input.content.sections.map(s=>({sectionId:s.id,design:{...s.slideDesign,background:s.slideDesign.background??null,elements:s.slideDesign.elements.map(e=>({...e,color:e.color??null}))}}))};
 const config={apiKey:'offline-no-live-key',model:route.model,maximumInputTokens:10000,maximumOutputTokens:5000,timeoutMs:1000};
 const calls={claims:0,fetches:0,saves:0,failed:0,retained:0};let evidence,saved,body;
 const deps={configurationRef:'offline-only',sql:{query:async(text,args)=>{
  if(text.includes('claim_capped_generation_dispatch')){calls.claims++;return {rows:[{claim:{claimed:true,dispatchId:randomUUID()}}]};}
  if(text.includes('commit_generation_worker_result')){calls.saves++;assert.equal(args[4],'120');assert.deepEqual(JSON.parse(args[12]),[]);saved=args;return {rows:[{saved:{versionId:randomUUID(),outcomeId:randomUUID(),readyForPublication:false}}]};}
  if(text.includes('record_capped_generation_outcome')){calls.failed++;assert.equal(args[4],'120');assert.ok(text.includes('false'));return {rows:[]};}
  throw Error('UNEXPECTED_SQL');}},resolveAssets:async()=>({descriptors:[],artwork:[]}),
  provider:{spendingAllowed:()=>true,countInputTokens:async()=>40,fetch:async(url,options)=>{
   calls.fetches++;assert.equal(String(url),'https://api.anthropic.com/v1/messages');body=JSON.parse(options.body);
   const response={id:'msg_fixture',type:'message',role:'assistant',model:route.model,stop_reason:'end_turn',stop_sequence:null,content:[{type:'text',text:JSON.stringify(output)}],usage:{input_tokens:40,output_tokens:20,cache_read_input_tokens:0,cache_creation_input_tokens:0}};
   patch.changeResponse?.(response);return new Response(JSON.stringify(response),{headers:{'content-type':'application/json','request-id':'req_fixture'}});
  }},retainEvidence:async({metered})=>{calls.retained++;assert.equal(createHash('sha256').update(metered.bytes).digest('hex'),metered.evidenceHash);evidence=metered;return {sha256:metered.evidenceHash};}};
 const f={input,route,options,lease,output,config,deps,calls};patch.configure?.(f);
 return {...f,run:(signal=new AbortController().signal)=>createClaudePresentationWorker(config,deps)(f.lease,signal),get evidence(){return evidence;},get saved(){return saved;},get body(){return body;}};
}
async function main(){let groups=0;const check=async(name,fn)=>{await fn();console.log('PASS '+name);groups++;};
 await check('real renderer accepts editable composition and commits confirmed cost once',async()=>{const f=harness(),r=await f.run();assert.equal(r.state,'visual_review_required');assert.equal(r.readyForPublication,false);assert.deepEqual(f.calls,{claims:1,fetches:1,saves:1,failed:0,retained:1});assert.deepEqual(f.saved[10],f.input.content);assert.deepEqual(f.saved[11],f.input.style);assert.equal(f.evidence.payload.result.review.status,'layout_checked');assert.equal(f.evidence.payload.result.review.needsVisualReview,true);assert.equal(f.evidence.actualVendorMicrousd,'120');});
 await check('small measured overflow expands into free space and rerenders with one paid attempt',async()=>{
  const f=harness({changeResponse:r=>{const o=JSON.parse(r.content[0].text);o.slides[0].design.elements[0].height=100;r.content[0].text=JSON.stringify(o);}});
  const r=await f.run();assert.equal(r.state,'visual_review_required');assert.equal(f.calls.claims,1);assert.equal(f.calls.fetches,1);assert.equal(f.calls.saves,1);
  const result=f.evidence.payload.result;assert.equal(result.layoutRepair.strategy,'expand_text_height_v1');assert(result.layoutRepair.adjustments.length>0);
  const changed=result.layoutRepair.adjustments[0],element=f.saved[10].sections[0].slideDesign.elements.find(e=>e.id===changed.elementId);
  assert.equal(changed.previousHeight,100);assert.equal(element.height,changed.height);assert(element.height>100&&element.height<=164);
  assert.deepEqual(result.review.slides[0].overflowingText,[]);assert.deepEqual(f.saved[10].sections[0].blocks,f.input.content.sections[0].blocks);assert.equal(f.saved[10].sections[0].title,f.input.content.sections[0].title);
 });
 await check('large overflow is retained with exact measurements and refuses save',async()=>{
  const f=harness({changeResponse:r=>{const o=JSON.parse(r.content[0].text);o.slides[0].design.elements[0].height=10;r.content[0].text=JSON.stringify(o);}});
  assert.equal((await f.run()).state,'attempt_failed');assert.equal(f.calls.saves,0);assert.equal(f.calls.fetches,1);
  assert.equal(f.evidence.payload.result.reason,'SLIDE_CONTENT_OVERFLOW');assert(f.evidence.payload.result.review.slides[0].overflowingText.length>0);
 });
 await check('deterministic repair refuses collision, locked content and stale box measurements',()=>{
  const {expandNativeTextBoxes}=require('../presentations/layout-repair.ts');const f=createNativeSlideFixture(),element=f.content.sections[0].slideDesign.elements[0];
  element.height=200;const finding={element:0,elementId:element.id,role:'title',width:element.width,height:200,requiredWidth:element.width,requiredHeight:220};
  const measured={slides:[{slide:1,overflowingText:[finding]}]},original=JSON.stringify(f.content);
  assert.equal(expandNativeTextBoxes(f.content,measured).adjustments.length,1);assert.equal(JSON.stringify(f.content),original);
  for(const mode of ['collision','locked','stale','off-canvas']){
   const c=structuredClone(f.content),r=structuredClone(measured);
   if(mode==='collision')c.sections[0].slideDesign.elements[1].y=290;
   if(mode==='locked')c.sections[0].blocks[0].locked=true;
   if(mode==='stale')r.slides[0].overflowingText[0].width=1;
   if(mode==='off-canvas')c.sections[0].slideDesign.elements[0].y=510;
   assert.equal(expandNativeTextBoxes(c,r).adjustments.length,0,mode);
  }
 });
 await check('all approved effort levels use the original token and dispatch bounds',async()=>{for(const effort of ['light','medium','high','super_high','ultra']){const f=harness({effort});assert.equal((await f.run()).state,'visual_review_required');assert.equal(f.calls.fetches,1);assert.equal(f.body.max_tokens,5000);}});
 await check('invalid generated geometry retains paid failure without saving',async()=>{const f=harness({changeResponse:r=>{const o=JSON.parse(r.content[0].text);o.slides[0].design.elements[0].x=-1;r.content[0].text=JSON.stringify(o);}});assert.equal((await f.run()).state,'attempt_failed');assert.equal(f.calls.saves,0);assert.equal(f.calls.failed,1);assert.equal(f.evidence.payload.result.status,'provider_rejected');});
 await check('actual text overlap retains candidate and safe review findings',async()=>{const f=harness({changeResponse:r=>{const o=JSON.parse(r.content[0].text),e=o.slides[0].design.elements;e[2]={...e[2],x:e[1].x,y:e[1].y,width:e[1].width};r.content[0].text=JSON.stringify(o);}});assert.equal((await f.run()).state,'attempt_failed');assert.equal(f.calls.saves,0);assert.equal(f.calls.failed,1);assert.equal(f.evidence.payload.result.status,'layout_rejected');assert.ok(f.evidence.payload.result.candidate.content.sections[0].slideDesign);});
 await check('actual invisible text is rejected before version commit',async()=>{const f=harness({changeResponse:r=>{const o=JSON.parse(r.content[0].text);o.slides[0].design.elements[1].color='#F4F0E7';r.content[0].text=JSON.stringify(o);}});assert.equal((await f.run()).state,'attempt_failed');assert.equal(f.calls.saves,0);assert.equal(f.calls.failed,1);});
 await check('transport uncertainty preserves holds instead of recording zero',async()=>{const f=harness({configure:f=>{f.deps.provider.fetch=async()=>{f.calls.fetches++;throw Error('offline transport');};}});await assert.rejects(f.run(),e=>e.code==='PRESENTATION_WORKER_USAGE_UNCONFIRMED');assert.equal(f.calls.saves+f.calls.failed+f.calls.retained,0);});
 await check('unpriced cache usage cannot be recorded as ordinary input',async()=>{const f=harness({changeResponse:r=>{r.usage.cache_read_input_tokens=10;}});await assert.rejects(f.run(),e=>e.code==='PRESENTATION_WORKER_USAGE_UNCONFIRMED');assert.equal(f.calls.saves+f.calls.failed,0);});
 await check('evidence hash mismatch prevents committing a paid result',async()=>{const f=harness({configure:f=>{f.deps.retainEvidence=async()=>({sha256:'0'.repeat(64)});}});await assert.rejects(f.run(),e=>e.code==='PRESENTATION_WORKER_EVIDENCE_UNCONFIRMED');assert.equal(f.calls.saves+f.calls.failed,0);});
 await check('disabled spending never claims or dispatches',async()=>{const f=harness({configure:f=>{f.deps.provider.spendingAllowed=()=>false;}});assert.equal((await f.run()).state,'not_dispatched');assert.equal(f.calls.claims+f.calls.fetches,0);});
 await check('declined replay claim never calls provider',async()=>{const f=harness({configure:f=>{f.deps.sql.query=async()=>({rows:[{claim:{claimed:false}}]});}});await assert.rejects(f.run(),e=>e.code==='PRESENTATION_WORKER_DISPATCH_UNCONFIRMED');assert.equal(f.calls.fetches,0);});
 for(const [name,change]of [['wrong model',f=>{f.config.model='different';}],['wrong credential reference',f=>{f.deps.configurationRef='different';}],['output above approval',f=>{f.config.maximumOutputTokens=5001;}],['effort override',f=>{f.config.effort='max';}],['expired lease',f=>{f.lease.deadlineAt='2000-01-01T00:00:00Z';}],['changed approved copy',f=>{f.lease=structuredClone(f.lease);f.lease.approvedInput.proposal.input.content.title='Changed';}]])await check(name+' fails before spending',async()=>{const f=harness({configure:change});await assert.rejects(f.run());assert.equal(f.calls.fetches+f.calls.claims,0);});
 await check('pre-cancellation never dispatches',async()=>{const f=harness(),c=new AbortController();c.abort();await assert.rejects(f.run(c.signal));assert.equal(f.calls.claims+f.calls.fetches,0);});
 await check('asset mismatch fails before provider claim',async()=>{const f=harness({configure:f=>{f.deps.resolveAssets=async()=>({descriptors:[{id:randomUUID(),path:'public/art.png',sha256:'a'.repeat(64),bytes:3,mediaType:'image/png'}],artwork:[]});}});await assert.rejects(f.run());assert.equal(f.calls.claims+f.calls.fetches,0);});
 await check('unsaved presentation cannot be quoted as a composition operation',async()=>{const f=harness();assert.throws(()=>preparePresentationComposition({...f.input,baseVersionId:null},f.options,[f.route]));});
 console.log(`${groups} offline presentation-worker groups passed with real local layout rendering; no live provider or database integration claim.`);
}
module.exports={harness};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
