/* eslint-disable @typescript-eslint/no-require-imports -- Offline fixture loader only. */
const fs = require('node:fs'), ts = require('typescript'), assert = require('node:assert/strict');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { prepareWorkflow } = require('./workflow.ts');
const { PLANNED_ROUTES } = require('./registry.ts');
// Invented fixture rates and evaluation scores, never real provider economics.
const route = { ...PLANNED_ROUTES[0], model:'fixture', status:'ready', adapterVerified:true, configurationRef:'fixture-ref', policyApproved:true, licenseApproved:true, evaluation:{evidenceId:'fixture',quality:90}, capabilities:['text','website_code','book_content','slide_content','image','visual_slide'], price:{version:'fixture',evidenceId:'fixture',expiresAt:'2026-10-03T13:00:00.000Z',lines:[{unit:'input_tokens',perUnits:'1',vendorMicrousd:'10',customerCredits:'2'}],fixedVendorMicrousd:'1',fixedCustomerCredits:'1'} };
const step = {capabilities:['text'],usage:[{unit:'input_tokens',maximum:'1'}],maximumAttempts:3,minimumQuality:80,allowedProviders:['openai','anthropic'],externalProcessingAllowed:true,sourceRightsConfirmed:true,maximumVendorMicrousd:'100000',maximumCustomerCredits:'100000',preference:'economy',now:'2026-10-03T12:00:00.000Z'};
const input={output:'website',effort:'medium',includeImages:false,now:step.now,maximumVendorMicrousd:'100000',maximumCustomerCredits:'100000',stages:['planning','draft','review'].map(stage=>({stage,request:step}))};
let checks=0;function check(fn){fn();checks++;}
check(()=>assert.equal(prepareWorkflow(input,PLANNED_ROUTES).snapshot,null));
check(()=>{const result=prepareWorkflow(input,[route]);assert.equal(result.status,'prepared');assert.equal(result.snapshot.maximumVendorMicrousd,'88');assert.equal(result.snapshot.maximumCustomerCredits,'24');assert.equal(result.snapshot.maximumExecutions,4);assert.equal(result.snapshot.effort.version,'effort-v2');assert.equal(result.snapshot.approved,false);assert.ok(Object.isFrozen(result.snapshot.stages[0].route.price));assert.deepEqual(Object.keys(result.customerView).sort(),['maximumCredits','operation','readyForApproval']);});
for(const patch of [{maximumCustomerCredits:'23'},{maximumVendorMicrousd:'87'}])check(()=>{const result=prepareWorkflow({...input,...patch},[route]);assert.equal(result.snapshot,null);assert.equal(result.customerView.maximumCredits,null);assert.ok(result.blocked.some(item=>item.reason==='workflow_budget'));});
check(()=>assert.throws(()=>prepareWorkflow({...input,effort:'infinite'},[route])));
check(()=>assert.throws(()=>prepareWorkflow({...input,output:'book'},[route])));
check(()=>assert.throws(()=>prepareWorkflow({...input,output:'presentation'},[route])));
check(()=>assert.throws(()=>prepareWorkflow({...input,stages:[...input.stages,input.stages[0]]},[route])));
const visual={...input,output:'presentation',presentationMode:'full_visual',includeImages:true,stages:[...input.stages,{stage:'images',request:step}]};
check(()=>{const cheaper={...route,id:'other',provider:'anthropic',price:{...route.price,fixedCustomerCredits:'0'}};const result=prepareWorkflow(visual,[route,cheaper]);assert.equal(result.snapshot.stages.find(stage=>stage.stage==='images').route.provider,'openai');});
check(()=>assert.equal(prepareWorkflow(visual,[{...route,provider:'anthropic'}]).snapshot,null));
check(()=>assert.equal(prepareWorkflow({...visual,stages:visual.stages.map(stage=>stage.stage==='images'?{...stage,request:{...step,allowedProviders:['anthropic']}}:stage)},[route]).blocked[0].reason,'image_policy'));
check(()=>assert.ok(prepareWorkflow({...input,includeImages:true},[route]).blocked.some(item=>item.reason==='missing_stage')));
check(()=>assert.ok(prepareWorkflow({...input,stages:visual.stages},[route]).blocked.some(item=>item.reason==='unexpected_stage')));
check(()=>assert.equal(prepareWorkflow({...input,now:'2026-10-03T14:00:00.000Z'},[route]).snapshot,null));
check(()=>assert.equal(prepareWorkflow({...input,stages:input.stages.map(stage=>({...stage,request:{...step,minimumQuality:95}}))},[route]).snapshot,null));
check(()=>assert.equal(prepareWorkflow({...input,stages:input.stages.map(stage=>({...stage,request:{...step,sourceRightsConfirmed:false}}))},[route]).snapshot,null));
check(()=>{const result=prepareWorkflow({...input,effort:'ultra'},[route]);assert.equal(result.snapshot.maximumExecutions,11);assert.equal(result.snapshot.maximumCustomerCredits,'99');});
check(()=>{const large={...route,price:{...route.price,fixedVendorMicrousd:'0',fixedCustomerCredits:'0',lines:[{unit:'input_tokens',perUnits:'1',vendorMicrousd:'9007199254740993',customerCredits:'1'}]}};const high={...input,effort:'light',maximumVendorMicrousd:'9223372036854775807',stages:input.stages.map(stage=>({...stage,request:{...step,maximumVendorMicrousd:'9223372036854775807'}}))};assert.equal(prepareWorkflow(high,[large]).snapshot.maximumVendorMicrousd,'27021597764222979');});
check(()=>{const large={...route,price:{...route.price,fixedVendorMicrousd:'0',fixedCustomerCredits:'0',lines:[{unit:'input_tokens',perUnits:'1',vendorMicrousd:'4000000000000000000',customerCredits:'1'}]}};const high={...input,effort:'light',maximumVendorMicrousd:'9223372036854775807',stages:input.stages.map(stage=>({...stage,request:{...step,maximumVendorMicrousd:'9223372036854775807'}}))};assert.ok(prepareWorkflow(high,[large]).blocked.some(item=>item.reason==='amount_overflow'));});
console.log(`${checks} offline workflow checks passed; no dispatch or provider calls.`);
