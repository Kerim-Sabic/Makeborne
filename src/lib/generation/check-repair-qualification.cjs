/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic protocol checks, no live calls. */
const {fixtures,response,createClaudeWebsiteWorker}=require('./check-website-worker.cjs');
const {fixture}=require('../projects/check-compiled-output.cjs');
const {prepareWebsiteQualification,prepareWebsiteRepairQualification,CLAUDE_QUALIFICATION_ROUND:round}=require('./qualification-proposal.ts');
const {createClaudeWebsiteQualificationWorker}=require('./website-worker.ts');
const {validateGeneratedWebsiteSource,buildWebsiteSourcePrompt}=require('./website-source-contract.ts');
const {websiteBuildInput}=require('../projects/build-input.ts');
const {createWebsiteRepairReview,readWebsiteRepairReview}=require('../projects/repair-review.ts');
const {canonicalSourceJson}=require('../projects/canonical-json.ts');
const assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const digest=value=>createHash('sha256').update(canonicalSourceJson(value)).digest('hex');
function setup(){
 const f=fixtures(),original=f.lease.approvedInput.proposal.input,now=new Date().toISOString();
 const content=validateGeneratedWebsiteSource({input:original,presentationMode:null,sourceMaterial:[],availableAssetIds:[]},[],f.output).content;
 const version={id:randomUUID(),artifactId:original.scope.artifactId,number:1,parentVersionId:null,content,style:original.style,assetIds:[],createdAt:now,createdBy:f.lease.approvedInput.actorId,changeSummary:'Synthetic source'};
 const workload=websiteBuildInput(version,[]),receipt={...fixture().receipt,artifactId:workload.artifactId,revisionId:workload.revisionId,version:workload.version,sourceHash:workload.sourceHash,toolchainHash:workload.toolchainHash,routes:workload.routes};delete receipt.buildHash;receipt.buildHash=digest(receipt);
 const context={scope:original.scope,jobId:randomUUID(),reviewerId:f.lease.approvedInput.actorId};
 const review=createWebsiteRepairReview(context,{recordedAt:now,issues:[{id:'hero',category:'composition',severity:'major',observation:'Primary action falls below the viewport.',requestedChange:'Rebalance hero spacing and headline size.',evidence:{kind:'browser_observation',reference:'Synthetic fixture only',viewport:{width:1440,height:900}}}]},workload,receipt);
 const binding=readWebsiteRepairReview(review.row,context,workload,receipt);
 const input={...original,baseVersionId:version.id,content},options={now,effort:'light',processingConsent:true,externalProcessingConsent:true,sourceRightsConfirmed:true};
 const proposal=prepareWebsiteRepairQualification(input,options,binding);f.lease.approvedInput.proposal=proposal;
 return {...f,input,options,binding,proposal};
}
async function execute(f,ordinary=false){
 const calls={claims:0,fetches:0,saves:0};let request;
 const deps={configurationRef:round.configurationRef,sql:{query:async(sql)=>{if(sql.includes('claim_capped_generation_dispatch')){calls.claims++;return {rows:[{claim:{claimed:true,dispatchId:randomUUID()}}]};}if(sql.includes('commit_generation_worker_result')){calls.saves++;return {rows:[{saved:{versionId:randomUUID(),outcomeId:randomUUID(),readyForPublication:false}}]};}throw Error('UNEXPECTED_SQL');}},provider:{spendingAllowed:()=>true,countInputTokens:async()=>40,fetch:async(url,options)=>{calls.fetches++;request=JSON.parse(options.body);return new Response(JSON.stringify(response(f.output,round.model)),{headers:{'content-type':'application/json','request-id':'req_fixture'}});}},resolveAssets:async()=>({descriptors:[],artwork:[]}),retainEvidence:async({metered})=>({sha256:metered.evidenceHash})};
 const worker=(ordinary?createClaudeWebsiteWorker:createClaudeWebsiteQualificationWorker)({apiKey:'offline-no-live-key',model:round.model,maximumInputTokens:round.maximumInputTokens,maximumOutputTokens:round.maximumOutputTokens,timeoutMs:1000},deps);
 try{return {result:await worker(f.lease,new AbortController().signal),calls,request};}catch(error){return {error,calls};}
}
async function main(){let n=0;async function check(name,run){await run();n++;console.log(`PASS ${name}`);}
 await check('repair retains original fixed policy and exact base/review binding',()=>{const f=setup();assert.equal(f.proposal.input.baseVersionId,f.input.baseVersionId);assert.equal(f.proposal.repairReview.reportHash,f.binding.reportHash);assert.equal(f.proposal.workflow.maximumVendorMicrousd,'544000');assert.equal(f.proposal.workflow.maximumCustomerCredits,'0');assert.equal(f.proposal.workflow.stages[0].route.evaluation,null);assert(Object.isFrozen(f.proposal.repairReview.report.observations));assert.throws(()=>prepareWebsiteQualification(f.input,f.options));});
 await check('wrong base/source/scope and fabricated review digest fail preparation',()=>{const f=setup();for(const input of [{...f.input,baseVersionId:randomUUID()},{...f.input,scope:{...f.input.scope,projectId:randomUUID()}},{...f.input,content:{...f.input.content,websiteSource:{...f.input.content.websiteSource,designDirection:{...f.input.content.websiteSource.designDirection,composition:'Altered source'}}}}])assert.throws(()=>prepareWebsiteRepairQualification(input,f.options,f.binding));assert.throws(()=>prepareWebsiteRepairQualification(f.input,f.options,{...f.binding,reportHash:'a'.repeat(64)}));});
 await check('repair dispatch includes full existing source and actionable findings exactly once',async()=>{const f=setup(),run=await execute(f);assert.ifError(run.error);assert.equal(run.result.state,'build_queued');assert.deepEqual(run.calls,{claims:1,fetches:1,saves:1});const body=JSON.stringify(run.request);assert(body.includes('Rebalance hero spacing and headline size.'));assert(body.includes('REPAIR THIS SAVED WEBSITE'));assert(body.includes('Made for performance.'));assert.equal(body.split('REPAIR THIS SAVED WEBSITE').length,2);});
 await check('model context omits only server-managed packages without mutating canonical source',()=>{const f=setup(),before=canonicalSourceJson(f.input),prompt=buildWebsiteSourcePrompt({input:f.input,presentationMode:null,sourceMaterial:[],availableAssetIds:[]},[]),sent=JSON.parse(prompt.input);assert.equal(canonicalSourceJson(f.input),before);const expected=f.input.content.websiteSource.files.filter(file=>!['package.json','package-lock.json'].includes(file.path));assert.deepEqual(sent.input.content.websiteSource.files,expected);assert(f.input.content.websiteSource.files.some(file=>file.path==='package-lock.json'));assert(prompt.input.length<before.length);});
 await check('ordinary worker refuses repair operator proposal before dispatch',async()=>{const run=await execute(setup(),true);assert.equal(run.error.code,'WEBSITE_WORKER_OPERATOR_PROPOSAL_DENIED');assert.deepEqual(run.calls,{claims:0,fetches:0,saves:0});});
 await check('changed reviewer refuses before claim even with otherwise valid snapshot',async()=>{const f=setup();f.lease.approvedInput.actorId=randomUUID();const run=await execute(f);assert.equal(run.error.code,'WEBSITE_WORKER_REPAIR_REVIEWER_CHANGED');assert.equal(run.calls.fetches,0);});
 await check('rehashing cannot change fixed repair model or price',async()=>{for(const change of [p=>{p.workflow.stages[0].route.model='other';},p=>{p.workflow.stages[0].route.price.lines[0].vendorMicrousd='0';}]){const f=setup(),p=structuredClone(f.proposal);change(p);delete p.approvalHash;p.approvalHash=digest(p);f.lease.approvedInput.proposal=p;const run=await execute(f);assert.equal(run.error.code,'WEBSITE_WORKER_QUALIFICATION_POLICY_CHANGED');assert.equal(run.calls.fetches,0);}});
 console.log(`${n} repair qualification groups passed; no live provider or database calls.`);
}
main().catch(error=>{console.error(`REPAIR QUALIFICATION FAILED: ${error.code||error.message}`);process.exitCode=1;});
