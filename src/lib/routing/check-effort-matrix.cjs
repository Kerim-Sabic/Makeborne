/* eslint-disable @typescript-eslint/no-require-imports -- Pure task/effort policy fixtures, no service requests. */
const fs=require("node:fs"),ts=require("typescript"),assert=require("node:assert/strict");
require.extensions[".ts"]=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
const {prepareWorkflow}=require("./workflow.ts"),{EFFORT_LEVELS,getEffortPolicy}=require("./effort.ts"),{PLANNED_ROUTES}=require("./registry.ts");
const now="2026-10-04T12:00:00.000Z";
// Rates, scores and model IDs are deliberately invented fixtures.
const base={version:"offline-v1",model:"fixture",status:"ready",adapterVerified:true,configurationRef:"offline-ref",dataBoundary:"external",policyApproved:true,licenseApproved:true,evaluation:{evidenceId:"offline-eval",quality:90},priority:1,price:{version:"offline-price",evidenceId:"offline-rate",expiresAt:"2026-10-04T13:00:00.000Z",lines:[{unit:"input_tokens",perUnits:"1",vendorMicrousd:"1",customerCredits:"1"}],fixedVendorMicrousd:"0",fixedCustomerCredits:"0"}};
const text={...base,id:"text-fixture",provider:"anthropic",capabilities:["text","website_code","book_content","slide_content"]};
const image={...base,id:"image-fixture",provider:"openai",capabilities:["image","visual_slide"]};
const step={capabilities:[],usage:[{unit:"input_tokens",maximum:"1"}],maximumAttempts:10,minimumQuality:20,allowedProviders:["openai","anthropic"],externalProcessingAllowed:true,sourceRightsConfirmed:true,maximumVendorMicrousd:"1000",maximumCustomerCredits:"1000",preference:"quality",now};
const cases=[
  {output:"website",includeImages:false},
  {output:"website",includeImages:true},
  {output:"book",includeImages:true},
  {output:"presentation",presentationMode:"editable",includeImages:false},
  {output:"presentation",presentationMode:"full_visual",includeImages:true},
];
let checks=0;
function check(name,fn){fn();checks++;console.log("PASS "+name);}
for(const format of cases)for(const effort of EFFORT_LEVELS){
  const stages=["planning","draft","review",...(format.includeImages?["images"]:[])].map(stage=>({stage,request:{...step,capabilities:[stage==="images"?(format.presentationMode==="full_visual"?"visual_slide":"image"):"text"]}}));
  const input={...format,effort,now,maximumVendorMicrousd:"1000",maximumCustomerCredits:"1000",stages};
  check(`${format.output}/${format.presentationMode??format.includeImages}/${effort} routes and reserves exact bounds`,()=>{
    const result=prepareWorkflow(input,[text,image]),policy=getEffortPolicy(effort);
    assert.equal(result.status,"prepared");
    assert.equal(result.snapshot.stages.find(s=>s.stage==="draft").route.id,text.id);
    if(format.includeImages)assert.equal(result.snapshot.stages.find(s=>s.stage==="images").route.id,image.id);
    const executions=policy.maximumPlanningSteps+policy.maximumReviewPasses+1+(format.includeImages?1:0);
    assert.equal(result.snapshot.maximumExecutions,executions);
    assert.equal(result.snapshot.maximumCustomerCredits,String(executions*policy.maximumAttemptsPerStep));
    for(const stage of result.snapshot.stages){assert.equal(stage.request.minimumQuality,80);assert.equal(stage.request.maximumAttempts,policy.maximumAttemptsPerStep);}
    assert.equal(result.snapshot.approved,false);
  });
  check(`${format.output}/${effort} cannot become live with planned slots`,()=>{
    const result=prepareWorkflow(input,PLANNED_ROUTES);assert.equal(result.snapshot,null);assert.equal(result.customerView.readyForApproval,false);assert.equal(result.customerView.maximumCredits,null);
  });
  check(`${format.output}/${effort} cannot hide a missing draft capability`,()=>{
    const result=prepareWorkflow(input,[{...text,capabilities:["text"]},image]);assert.equal(result.snapshot,null);assert.ok(result.blocked.some(s=>s.stage==="draft"));
  });
  if(format.includeImages)check(`${format.output}/${effort} refuses a missing image worker`,()=>assert.equal(prepareWorkflow(input,[text]).snapshot,null));
}
check("a configured key reference cannot replace policy and evidence",()=>{
  const stages=["planning","draft","review"].map(stage=>({stage,request:{...step,capabilities:["text"]}}));
  const result=prepareWorkflow({output:"website",includeImages:false,effort:"light",now,maximumVendorMicrousd:"1000",maximumCustomerCredits:"1000",stages},PLANNED_ROUTES.map(route=>({...route,status:"ready",model:"fixture",configurationRef:"secret-is-present"})));
  assert.equal(result.snapshot,null);assert.equal(result.customerView.maximumCredits,null);
});
console.log(`${checks} task/effort matrix checks passed; no model quality or live execution claim.`);
