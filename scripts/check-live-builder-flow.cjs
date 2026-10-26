/* eslint-disable @typescript-eslint/no-require-imports -- Mounted LiveBuilder with mocked APIs/capture; no AI calls. */
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),assert=require('node:assert/strict'),Module=require('node:module');
const original=Module._load;Module._load=function(n,p,m){return n==='server-only'?{}:original.call(this,n,p,m)};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {ProjectFiles}=require('../src/lib/builder/files.ts'),{build}=require('esbuild'),{chromium}=require('playwright'),{createServer}=require('node:http');
const ids={account:'11111111-1111-4111-8111-111111111111',workspace:'22222222-2222-4222-8222-222222222222',artifact:'33333333-3333-4333-8333-333333333333',operation:'44444444-4444-4444-8444-444444444444',run:'55555555-5555-4555-8555-555555555555'};
const project=new ProjectFiles();project.write('index.html','<html><head><title>Fixture</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>');project.write('src/main.tsx','import{createRoot}from"react-dom/client";createRoot(document.getElementById("root")).render(<h1>Fixture</h1>)');project.write('src/style.css','body{color:red}');
const source=project.toSource();
const scope=JSON.stringify(ids);
const estimates={effort:'medium',firstBuild:{website:{min:16,median:32,max:45,samples:20},presentation:{min:7,median:8,max:9,samples:2},book:{min:9,median:12,max:14,samples:2}},reviewRound:{min:8,median:9,max:11,samples:20}};
const fixture=`import React,{useState}from'react';import{createRoot}from'react-dom/client';import LiveBuilder from'./src/components/live-builder';
const ids=${scope};const estimates=${JSON.stringify(estimates)};function App(){const[version,setVersion]=useState(1),[files,setFiles]=useState({});return <LiveBuilder accountId={ids.account} workspaceId={ids.workspace} artifactId={ids.artifact} version={version} history={[]} baseFiles={files} baseAssets={[]} estimates={estimates} onLive={v=>{window.live=v;}} onSaved={async()=>{setVersion(window.savedVersion??version);setFiles(window.savedFiles??{});}}/>}createRoot(document.getElementById('root')).render(<App/>);`;
const stablePlanner=`const p={active:null,restored:null,operation:null,checking:false,recoveryNotice:'',ready:true,hasPrevious:false,recoverablePlan:null,run:async()=>{},edit:()=>{},markBuilt:()=>{},refreshOperation:async()=>null,recoverPlan:async()=>null};export function usePlanMode(){return p}`;
async function main(){
 const output=await build({stdin:{contents:fixture,loader:'jsx',resolveDir:process.cwd()},write:false,bundle:true,platform:'browser',jsx:'automatic',define:{'process.env':'{}'},plugins:[{name:'fixture',setup(b){
  b.onResolve({filter:/use-plan-mode|plan-card|design-capture|cloud-api/},args=>({path:args.path,namespace:'mock'}));
  b.onLoad({filter:/use-plan-mode/,namespace:'mock'},()=>({contents:stablePlanner,loader:'js'}));
  b.onLoad({filter:/plan-card/,namespace:'mock'},()=>({contents:'export default function PlanCard(){return null}',loader:'js'}));
  b.onLoad({filter:/cloud-api/,namespace:'mock'},()=>({contents:'export async function readCloudImage(){throw new Error("No images requested")}',loader:'js'}));
  b.onLoad({filter:/design-capture/,namespace:'mock'},()=>({contents:`export async function captureDesign(files){window.captures=(window.captures??0)+1;return{screenshots:['desktop','mobile'].map(viewport=>({viewport,index:0,of:1,mediaType:'image/jpeg',data:'AA==',width:390,height:844})),viewports:['desktop','mobile'].map(viewport=>({viewport,overflowX:0,brokenImages:[],missingAlt:0})),errors:[],failures:[]}}`,loader:'js'}));
  b.onLoad({filter:/\.css$/},()=>({contents:'',loader:'js'}));
  b.onResolve({filter:/^@\//},args=>({path:path.resolve('src',args.path.slice(2)+(args.path.endsWith('.css')?'':'.ts'))}));
 }}]});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html');res.end(req.url==='/fixture.js'?output.outputFiles[0].contents:'<!doctype html><div id="root"></div><script src="/fixture.js"></script>')});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
 try{
  const base=`http://127.0.0.1:${server.address().port}`;
  async function scenario(mode){
   const page=await browser.newPage();const requests=[];let buildCount=0,version=1;
   let operation={id:ids.operation,revision:1,kind:'build',effort:'medium',authorizedCredits:50,chargedCredits:0,reservedCredits:0,remainingCredits:50,maximumAdditionalCredits:50,status:'active',pendingKind:null,lastVersion:1,canContinue:false,recoverable:false,expiresAt:'2030-01-01T00:00:00Z'};
   let recovery=mode==='recovery'?{runId:ids.run,candidate:{content:{schemaVersion:1,kind:'website',title:'Retained',sections:[],websiteSource:source},style:{},assetIds:[],expectedVersion:1,summary:'Retained'}}:null;
   if(recovery){operation={...operation,recoverable:true,canContinue:true,pendingKind:'continuation'};}
   const body=()=>({operation,result:{runId:ids.run,version,charged:operation.chargedCredits,changed:true,finished:!operation.pendingKind},recovery});
   await page.route('**/api/credits',r=>r.fulfill({json:{available:500,unlimited:false}}));
   // First builds ask brief questions first; an empty tailored set starts the build directly.
   await page.route('**/api/build/questions',r=>r.fulfill({json:{questions:[]}}));
   await page.route('**/api/build/operations**',async r=>{
    const req=r.request(),data=req.postDataJSON();requests.push({path:'operation',method:req.method(),data});
    if(req.method()==='PATCH'){operation={...operation,revision:2,authorizedCredits:100,remainingCredits:100-operation.chargedCredits,status:'active'};}
    if(req.method()==='POST'){assert.equal(data.runId,ids.run);assert.equal(data.expectedVersion,1);assert.equal(data.acknowledged,true);recovery=null;version=2;operation={...operation,recoverable:false,lastVersion:version};await page.evaluate(v=>{window.savedVersion=v;},version);}
    await r.fulfill({json:body()});
   });
   await page.route('**/api/build',async r=>{
    const data=r.request().postDataJSON();requests.push({path:'build',method:r.request().method(),data});buildCount++;
    if(mode==='fail'){await r.fulfill({headers:{'Content-Type':'text/event-stream'},body:['data: '+JSON.stringify({type:'operation',operation}),'data: '+JSON.stringify({type:'error',code:'BUILD_FAILED',message:'The builder stopped.',charged:0,operation})].join('\n\n')+'\n\n'});return;}
    if(mode==='review'&&buildCount===2){operation={...operation,status:'paused',pendingKind:'review',canContinue:true};await r.fulfill({status:409,json:{error:{code:'OPERATION_BUDGET_REACHED',message:'Approve more credits to review.'},operation}});return;}
    const first=buildCount===1,review=data.mode==='review';version++;
    operation={...operation,lastVersion:version,chargedCredits:mode==='cap'&&first?50:mode==='review'&&first?49:operation.chargedCredits+10};
    operation.remainingCredits=operation.authorizedCredits-operation.chargedCredits;
    operation.pendingKind=mode==='cap'&&first?'continuation':mode==='chain'&&first?'continuation':null;
    operation.canContinue=Boolean(operation.pendingKind);
    await page.evaluate(v=>{window.savedVersion=v;window.savedFiles={'src/App.tsx':'Fixture','src/style.css':'body{color:red}'};},version);
    const events=[{type:'operation',operation},...['src/App.tsx','src/style.css','src/main.tsx'].map(p=>({type:'file',path:p,content:review?'Reviewed':'Fixture',op:'write'})),{type:'done',version,summary:'Saved fixture',changed:true,finished:!operation.pendingKind,charged:first?operation.chargedCredits:10,operation}];
    await r.fulfill({headers:{'Content-Type':'text/event-stream'},body:events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join('')});
   });
   if(mode==='recovery')await page.addInitScript(({ids})=>{sessionStorage.setItem(`makeborne:operation:v1:${ids.account}:${ids.workspace}:${ids.artifact}:build`,JSON.stringify({actionKey:'66666666-6666-4666-8666-666666666666',id:ids.operation}));},{ids});
   // A short first website brief gets the free on-device design questions first (184df26). Skip all starts the build with the brief
   // exactly as written; nothing reaches /api/build before that.
   const send=async()=>{await page.getByRole('textbox',{name:'Message the builder'}).fill('Build my bespoke site');await page.getByRole('button',{name:'Send',exact:true}).click();
    const skip=page.getByRole('button',{name:'Skip all',exact:true});await skip.waitFor();assert.equal(requests.filter(x=>x.path==='build').length,0,'the free questions come before any build request');
    await skip.click();};
   await page.goto(base);
   // The maximum is on screen before Send in the Request details summary (13b1343); the full limit sentence and the measured range sit behind it.
   const details=page.locator('.lb-request-details > summary');await details.getByText('Up to 50 credits',{exact:true}).waitFor();await details.click();
   await page.getByText('Up to 50 credits for this request, including automatic refinements.',{exact:true}).waitFor();
   // A first build shows the measured range, never an invented one.
   await page.getByText('In testing, a first website at Medium used 16–45 credits (20 test websites, no AI images). You pay only for what is used.',{exact:true}).waitFor();
   if(mode==='fail'){
    await send();
    const receipt=page.getByRole('region',{name:'Request receipt'});await receipt.waitFor();
    assert.match(await receipt.innerText(),/Charged\s+0 credits/);assert.match(await receipt.innerText(),/No new version/);
    await receipt.getByText('Nothing was saved, and this request was not charged.',{exact:true}).waitFor();
    await page.close();console.log('PASS mounted LiveBuilder: fail receipt');return;
   }
   if(mode==='recovery'){
    await page.getByRole('button',{name:'Preview retained draft',exact:true}).click();assert(await page.getByRole('textbox',{name:'Message the builder'}).isDisabled());
    assert.equal(await page.evaluate(()=>window.live.files['src/main.tsx']),source.files.find(f=>f.path==='src/main.tsx').content);
    await page.getByRole('button',{name:'Save reviewed draft',exact:true}).click();await page.getByText('Saved the reviewed draft as a new version. No additional generation credits were used.').waitFor();
    assert.equal(requests.filter(x=>x.path==='build').length,0);assert.equal(requests.filter(x=>x.method==='POST').length,1);assert.equal(await page.evaluate(()=>window.live),null);
   }else{
    await send();
    if(mode==='chain'){
     await page.getByText('30 / 50 credits',{exact:true}).waitFor();
     // Receipt: the three settled step charges, every file the run touched, the checks that ran.
     const receipt=page.getByRole('region',{name:'Request receipt'});await receipt.waitFor();const text=await receipt.innerText();
     assert.match(text,/Charged\s+30 credits/);assert.match(text,/Saved as version 4/);assert.match(text,/3 files/);
     assert.match(text,/Project check passed/);assert.match(text,/Design review: 1 round/);assert.match(text,/Final render: no runtime errors/);
     assert.doesNotMatch(text,/not charged/);const builds=requests.filter(x=>x.path==='build');assert.equal(builds.length,3);assert.equal(builds[0].data.message,'Build my bespoke site','skipped questions add nothing to the brief');assert(builds[0].data.operation.actionKey);assert.equal(builds[1].data.operation.id,ids.operation);assert.equal(builds[1].data.operation.kind,'continuation');assert.equal(builds[2].data.operation.kind,'review');assert.equal(requests.filter(x=>x.method==='PATCH').length,0);assert.equal(await page.evaluate(()=>window.captures),2,'Final repair is captured again without another model request');
    }else{
     await page.getByRole('button',{name:'Approve allowance & continue',exact:true}).waitFor();assert.equal(requests.filter(x=>x.method==='PATCH').length,0);assert.equal(requests.filter(x=>x.path==='build').length,mode==='cap'?1:2);
     await page.getByRole('button',{name:'Approve allowance & continue',exact:true}).click();await page.waitForFunction(()=>document.querySelector('textarea')&&!document.querySelector('textarea').disabled);
     const writes=requests.filter(x=>x.path==='build');assert.equal(writes[mode==='cap'?1:2].data.operation.kind,mode==='cap'?'continuation':'review');assert.equal(requests.filter(x=>x.method==='PATCH').length,1);assert.equal(requests.find(x=>x.method==='PATCH').data.additionalCredits,50);
     if(mode==='review')assert.equal(await page.evaluate(()=>window.captures),2,'A declined review is freshly captured when explicit allowance is approved');
    }
   }
   await page.close();console.log(`PASS mounted LiveBuilder: ${mode}`);
  }
  for(const mode of ['chain','cap','review','recovery','fail'])await scenario(mode);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1});
