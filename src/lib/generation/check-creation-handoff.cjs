/* eslint-disable @typescript-eslint/no-require-imports -- Offline prompt handoff checks with synthetic content only. */
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
require('../cloud/check-creation-payload.cjs');
const {buildCreationPayload}=require('../cloud/creation-payload.ts');
const {stageCreationGeneration}=require('./creation-handoff.ts');
const {readGenerationReference,saveGenerationReference}=require('./browser-request.ts');
const accountId=randomUUID(),artifactId=randomUUID();
const body=buildCreationPayload({title:'Makeup studio',kind:'website',effort:'high',brief:'Original business brief',audience:'Performers',purpose:'Appointments',styleId:'automatic',clientId:'',wording:'preserve',content:''},{id:'automatic',name:'Automatic',color:'#333333',background:'#ffffff',textColor:'#111111',font:'sans',description:'Business-led design'},randomUUID);
const time=new Date().toISOString();
const creation={version:1,accountId,intentId:randomUUID(),workspaceId:randomUUID(),requestKey:randomUUID(),body,artifact:{id:artifactId,projectId:randomUUID(),kind:'website',title:body.project.title,currentVersion:1,createdAt:time,updatedAt:time},generationConsent:{processingConsent:true,externalProcessingConsent:true,sourceRightsConfirmed:true}};
const version={id:randomUUID(),artifactId,number:1,parentVersionId:null,content:body.content,style:body.style,assetIds:[],createdAt:time,createdBy:accountId,changeSummary:'Initial approved project'};
function storage(){const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};}
let count=0;function check(name,fn){fn();count++;console.log('PASS '+name);}
check('explicit consent stages original website revision and intent key',()=>{const s=storage(),r=stageCreationGeneration(s,creation,1,version);assert.equal(r.requestKey,creation.intentId);assert.equal(r.input.baseVersionId,version.id);assert.deepEqual(r.input.sourceIds,[]);assert.equal(r.autoStart,true);assert.equal(readGenerationReference(s,accountId,r.input.scope).requestKey,creation.intentId);});
check('no consent stages no request',()=>{assert.equal(stageCreationGeneration(storage(),{...creation,generationConsent:undefined},1,version),null);});
check('changed saved revision cannot trigger an old prompt',()=>{assert.throws(()=>stageCreationGeneration(storage(),creation,2,version),/changed/);});
check('foreign version or author cannot bind original handoff',()=>{for(const changed of [{artifactId:randomUUID()},{createdBy:randomUUID()},{number:2}])assert.throws(()=>stageCreationGeneration(storage(),creation,1,{...version,...changed}));});
check('existing ongoing or terminal reference always wins without rotation',()=>{for(const jobId of [null,randomUUID()]){const s=storage(),r=stageCreationGeneration(s,creation,1,version);const existing={...r,requestKey:randomUUID(),jobId,autoStart:false};saveGenerationReference(s,existing);assert.deepEqual(stageCreationGeneration(s,creation,2,undefined),existing);}});
check('book cannot become automatic website request',()=>{assert.throws(()=>stageCreationGeneration(storage(),{...creation,artifact:{...creation.artifact,kind:'book'}},1,version));});
check('missing rights declaration rejected',()=>{assert.throws(()=>stageCreationGeneration(storage(),{...creation,generationConsent:{...creation.generationConsent,sourceRightsConfirmed:false}},1,version));});
check('storage failure prevents staging an unremembered request',()=>{const s=storage();s.setItem=()=>{throw Error('Quota');};assert.throws(()=>stageCreationGeneration(s,creation,1,version),/save your request/);});
check('corrupt earlier reference is retained and not replaced',()=>{const s=storage(),r=stageCreationGeneration(s,creation,1,version);const {generationStorageKey}=require('./browser-request.ts');const key=generationStorageKey(accountId,r.input.scope);s.setItem(key,'broken');assert.throws(()=>stageCreationGeneration(s,creation,1,version),/preserved/);assert.equal(s.getItem(key),'broken');});
console.log(`${count} creation handoff groups passed; no network/provider calls.`);
