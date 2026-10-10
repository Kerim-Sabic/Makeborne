/* eslint-disable @typescript-eslint/no-require-imports -- Offline synthetic policy qualification. */
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
// Reuse the existing offline TypeScript/server-only loader and synthetic rates.
const {fixtures}=require('./check-website-worker.cjs');
const {prepareSavedWebsiteProposal}=require('./prepare-saved-website.ts');
const {verifyGenerationApproval}=require('../routing/proposal.ts');
const {getModelStyleReference}=require('../style-design-instructions.ts');
const {PLANNED_ROUTES}=require('../routing/registry.ts');
const f=fixtures(),p=f.lease.approvedInput.proposal,scope=p.input.scope;
const records={scope,
  project:{id:scope.projectId,workspace_id:scope.workspaceId,kind:'website',brief:p.input.brief,audience:p.input.audience,purpose:p.input.purpose,wording:p.input.wording,effort:'light',style_id:p.input.style.id},
  artifact:{id:scope.artifactId,workspace_id:scope.workspaceId,project_id:scope.projectId,kind:'website',current_version:1},
  version:{id:randomUUID(),workspace_id:scope.workspaceId,artifact_id:scope.artifactId,version_number:1,content:p.input.content,style_snapshot:p.input.style,asset_manifest:[]},sources:[]};
const stage=p.workflow.stages[0].request;
const {capabilities,externalProcessingAllowed,sourceRightsConfirmed,now,...stagePolicy}=stage;
void capabilities;void externalProcessingAllowed;void sourceRightsConfirmed;
const policy={routes:[f.route],maximumVendorMicrousd:'100000',maximumCustomerCredits:'100000',stages:{planning:stagePolicy,draft:stagePolicy,review:stagePolicy}};
const consent={processingConsent:true,externalProcessingConsent:true,sourceRightsConfirmed:true};
const prepare=(r=records,pol=policy,c=consent)=>prepareSavedWebsiteProposal(r,pol,c,now);
let count=0;function check(name,fn){fn();count++;console.log('PASS '+name);}
const initial=prepare().proposal;
check('canonical saved version/brief/style are preserved and frozen',()=>{assert.equal(initial.input.baseVersionId,records.version.id);assert.equal(initial.input.brief,records.project.brief);assert.deepEqual(initial.input.style,records.version.style_snapshot);assert(Object.isFrozen(initial.input.content));verifyGenerationApproval(initial,initial.approvalHash,initial.input,now);});
check('automatic design remains business-led without imposing provisional palette',()=>assert.deepEqual(getModelStyleReference(initial.input.style.id,initial.input.style),{id:'automatic',selection:'automatic',referenceAssetIds:[]}));
check('extra database columns are not copied into generation input',()=>{const r=structuredClone(records);r.project.internal_note='private';assert.equal(prepare(r).proposal.approvalHash,initial.approvalHash);});
for(const [part,field,value] of [['project','workspace_id',randomUUID()],['project','id',randomUUID()],['artifact','project_id',randomUUID()],['artifact','workspace_id',randomUUID()],['artifact','id',randomUUID()],['version','artifact_id',randomUUID()],['version','workspace_id',randomUUID()],['version','version_number',2],['project','style_id','other'],['artifact','kind','book']])check(`rejects mismatched ${part}.${field}`,()=>{const r=structuredClone(records);r[part][field]=value;assert.throws(()=>prepare(r));});
check('saved content cannot change format',()=>{const r=structuredClone(records);r.version.content.kind='presentation';assert.throws(()=>prepare(r));});
check('duplicate/unapproved/foreign/oversized sources rejected before quote',()=>{const source={id:randomUUID(),workspace_id:scope.workspaceId,project_id:scope.projectId,approved:true,title:'Original',content:'Approved original material'};for(const sources of [[source,source],[{...source,approved:false}],[{...source,workspace_id:randomUUID()}],[{...source,project_id:randomUUID()}],[{...source,content:'x'.repeat(20001)}]])assert.throws(()=>prepare({...records,sources}));assert.deepEqual(prepare({...records,sources:[source]}).proposal.input.sourceIds,[source.id]);});
check('source reference absent from saved selection rejected',()=>{const r=structuredClone(records);r.version.content.sections=[{id:randomUUID(),title:'Brief',blocks:[{id:randomUUID(),type:'paragraph',text:'Original',sourceIds:[randomUUID()]}]}];assert.throws(()=>prepare(r));});
check('unregistered style artwork rejected before reservation',()=>{const r=structuredClone(records);r.version.style_snapshot.referenceAssetIds=[randomUUID()];assert.throws(()=>prepare(r));});
check('browser route/price fields cannot enter saved record boundary',()=>assert.throws(()=>prepare({...records,model:'unapproved'})));
check('unconfigured/expired/unqualified route policies produce no proposal',()=>{for(const routes of [PLANNED_ROUTES,[{...f.route,adapterVerified:false}],[{...f.route,evaluation:null}],[{...f.route,price:{...f.route.price,expiresAt:now}}]])assert.equal(prepare(records,{...policy,routes}).proposal,null);});
check('processing/rights declaration required; external denial prevents external route',()=>{assert.throws(()=>prepare(records,policy,{...consent,processingConsent:false}));assert.throws(()=>prepare(records,policy,{...consent,sourceRightsConfirmed:false}));assert.equal(prepare(records,policy,{...consent,externalProcessingConsent:false}).proposal,null);});
check('limits and model are supplied only by validated trusted policy',()=>{assert.throws(()=>prepare(records,{...policy,maximumVendorMicrousd:25}));assert.throws(()=>prepare(records,{...policy,stages:{...policy.stages,draft:{...stagePolicy,model:'browser'}}}));assert.equal(prepare(records,{...policy,maximumCustomerCredits:'0',routes:[{...f.route,price:{...f.route.price,fixedCustomerCredits:'1'}}]}).proposal,null);});
check('each effort and changed saved brief/style invalidate original approval',()=>{const hashes=new Set();for(const effort of ['light','medium','high','super_high','ultra'])hashes.add(prepare({...records,project:{...records.project,effort}}).proposal.approvalHash);assert.equal(hashes.size,5);const r=structuredClone(records);r.project.brief+=' Additional business goal.';assert.notEqual(prepare(r).proposal.inputHash,initial.inputHash);r.project.style_id='custom';r.version.style_snapshot={...r.version.style_snapshot,id:'custom',name:'Client direction'};assert.equal(prepare(r).proposal.input.style.id,'custom');});
console.log(`${count} saved preparation checks passed; synthetic rates, no database/provider calls.`);
