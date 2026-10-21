/* eslint-disable @typescript-eslint/no-require-imports -- Real React/Chromium flow with local API responses; no database/providers. */
const assert=require('node:assert/strict'),{createServer}=require('node:http'),{build}=require('esbuild'),{ browserType } = require('./browser-engine.cjs');
const ids={account:'11111111-1111-4111-8111-111111111111',workspace:'22222222-2222-4222-8222-222222222222',artifact:'33333333-3333-4333-8333-333333333333',prep:'44444444-4444-4444-8444-444444444444',other:'55555555-5555-4555-8555-555555555555'};
const html='<html><head></head><body><h1>Verified home</h1><script>parent.forged=true</script></body></html>';
const ready=()=>({id:ids.prep,state:'ready',workspaceId:ids.workspace,artifactId:ids.artifact,version:1,publicationRevision:4,slug:'bakery',interactive:false,expiresAt:'2030-01-01T00:00:00Z',error:null,previewHtml:html,previewRoutes:[{path:'/',html},{path:'/about',html:'<html><head></head><body><h1>Verified about</h1></body></html>'}]});
const live=()=>({slug:'bakery',live:true,version_number:1,revision:4,updated_at:'2026-10-13T00:00:00Z',interactive:false,scripted:false});
const fixture=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import Publish from './src/components/trusted-website-publish';import{setCloudAccount}from'./src/components/cloud-api';const ids=${JSON.stringify(ids)};function App(){const[props,update]=useState({accountId:ids.account,workspaceId:ids.workspace,artifactId:ids.artifact,title:'Bakery',version:1,dirty:false,disabled:false,owner:true});window.change=p=>update(v=>({...v,...p}));setCloudAccount(props.accountId);return <Publish key={props.accountId+props.artifactId} {...props}/>;}createRoot(document.getElementById('root')).render(<App/>);`;
async function main(){
 const output=await build({stdin:{contents:fixture,loader:'jsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env':'{}'},plugins:[{name:'enquiries-only-stub',setup(b){b.onResolve({filter:/website-enquiries$/},()=>({path:'enquiries',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export default function Enquiries(){return null}'}));}}]});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html');res.end(req.url==='/fixture.js'?output.outputFiles[0].contents:'<!doctype html><div id="root"></div><script src="/fixture.js"></script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser;let count=0;
 try{browser=await browserType.launch({headless:true});const base=`http://127.0.0.1:${server.address().port}`;
 async function scenario(name,fn){const page=await browser.newPage();const requests=[];const state={site:live(),prep:null,available:true,postError:false,promoteError:false,hold:null};
  await page.route('**/api/cloud/**',async route=>{const req=route.request(),method=req.method(),isPrep=req.url().endsWith('/preparation'),data=method==='POST'?req.postDataJSON():null;requests.push({method,isPrep,data,key:req.headers()['idempotency-key'],account:req.headers()['x-makeborne-account']});
   if(state.hold&&method==='POST')await state.hold;
   if(method==='POST'&&isPrep){if(state.postError)return route.fulfill({status:503,json:{error:{message:'Preparation response lost'}}});state.prep={...ready(),state:'queued',previewHtml:null,previewRoutes:[]};return route.fulfill({json:{preparation:state.prep}});}
   if(method==='POST'){if(state.promoteError)return route.fulfill({status:409,json:{error:{message:'Saved version changed. Your live site is unchanged.'}}});state.site={...live(),revision:5};return route.fulfill({json:{site:state.site}});}
   return route.fulfill({json:isPrep?{available:state.available,preparation:state.prep}:{site:state.site,preparationAvailable:state.available,addressPolicy:{enabled:true,allowedSlugs:null,reservedSlugs:['release-check','release-check-renamed']}}});
  });
  try{await page.goto(base);await page.getByRole('button',{name:'Prepare saved website',exact:true}).waitFor();await fn(page,state,requests);console.log(`PASS ${name}`);count++;}finally{await page.close();}
 }
 const refresh=async page=>{await page.getByRole('button',{name:'Refresh publishing status'}).click();};
 const publish=page=>page.getByRole('button',{name:'Publish reviewed website',exact:true});
 const consent=page=>page.getByRole('checkbox',{name:/I’ve reviewed/});
 await scenario('prepare queues identifiers; polling/reload only GET; explicit review promotes identifiers',async(page,state,requests)=>{
  await page.getByRole('button',{name:'Prepare saved website',exact:true}).click();await page.getByRole('button',{name:'Preparing website…',exact:true}).waitFor();
  assert.deepEqual(requests.filter(r=>r.method==='POST').map(r=>r.data),[{version:1,revision:4,slug:'bakery',interactive:false}]);
  const gets=requests.filter(r=>r.method==='GET').length;await new Promise(r=>setTimeout(r,3300));assert.ok(requests.filter(r=>r.method==='GET').length>gets);assert.equal(requests.filter(r=>r.method==='POST').length,1);
  await page.reload();await page.getByRole('button',{name:'Preparing website…',exact:true}).waitFor();assert.equal(requests.filter(r=>r.method==='POST').length,1);
  state.prep=ready();await refresh(page);await publish(page).waitFor();assert.equal(await publish(page).isDisabled(),true);
  assert.equal(await page.locator('iframe').getAttribute('sandbox'),'');assert.equal(await page.evaluate(()=>window.forged),undefined);
  await page.getByLabel('Prepared page').selectOption('/about');await page.frameLocator('iframe').getByRole('heading',{name:'Verified about'}).waitFor();
  await consent(page).check();assert.equal(await publish(page).isEnabled(),true);await publish(page).click();await page.getByText('Your reviewed website is live.',{exact:false}).waitFor();
  assert.deepEqual(requests.filter(r=>r.method==='POST').at(-1).data,{preparationId:ids.prep,acknowledged:true});
 });
 await scenario('saved version, dirty source, changed address invalidate review; promotion error keeps old live link',async(page,state,requests)=>{
  state.prep=ready();await refresh(page);await consent(page).check();await page.evaluate(()=>window.change({version:2}));await page.getByText('The saved version or publishing options changed.',{exact:false}).waitFor();assert.equal(await publish(page).isDisabled(),true);
  await page.evaluate(()=>window.change({version:1,dirty:true}));await page.getByText('Save your changes before preparing this version.').waitFor();assert.equal(await publish(page).isDisabled(),true);
  await page.evaluate(()=>window.change({dirty:false}));await page.getByRole('textbox',{name:'Website address'}).fill('changed-bakery');assert.equal(await publish(page).isDisabled(),true);
  await page.getByRole('textbox',{name:'Website address'}).fill('bakery');assert.equal(await consent(page).isChecked(),false);await consent(page).check();state.promoteError=true;await publish(page).click();await page.getByText(/^Saved version changed. Your live site is unchanged.( The status shown is the current one from the server.)?$/).waitFor();assert.equal(await page.getByRole('link',{name:'Open live website'}).getAttribute('href'),'https://sites.makeborne.com/bakery');assert.equal(requests.filter(r=>r.method==='POST').length,1);
 });
 await scenario('replacement preparation requires new consent; failed preparation preserves prior live website',async(page,state,requests)=>{
  state.prep=ready();await refresh(page);await consent(page).check();state.prep={...ready(),id:ids.other};await refresh(page);await page.waitForFunction(()=>!document.querySelector('.website-publish-consent input')?.checked);assert.equal(await publish(page).isDisabled(),true);
  state.prep={...ready(),state:'failed',previewHtml:null,previewRoutes:[],error:'Preparation failed. Your live site is unchanged.'};await refresh(page);await page.getByRole('alert').waitFor();assert.equal(await publish(page).count(),0);assert.equal(await page.getByRole('link',{name:'Open live website'}).getAttribute('href'),'https://sites.makeborne.com/bakery');assert.equal(requests.filter(r=>r.method==='POST').length,0);
 });
 await scenario('uncertain preparation retries same key/body after reload without automatic mutation',async(page,state,requests)=>{
  state.postError=true;await page.getByRole('button',{name:'Prepare saved website',exact:true}).click();await page.getByText('Preparation response lost',{exact:true}).waitFor();const first=requests.find(r=>r.method==='POST');assert.ok(first.key);
  await page.reload();await page.getByRole('button',{name:'Retry preparation request',exact:true}).waitFor();assert.equal(requests.filter(r=>r.method==='POST').length,1);state.postError=false;await page.getByRole('button',{name:'Retry preparation request',exact:true}).click();await page.getByRole('button',{name:'Preparing website…',exact:true}).waitFor();const retry=requests.filter(r=>r.method==='POST')[1];assert.equal(retry.key,first.key);assert.deepEqual(retry.data,first.data);
 });
 await scenario('account switch isolates recovery metadata and ignores delayed prior account response',async(page,state,requests)=>{
  let release;state.hold=new Promise(r=>release=r);await page.getByRole('button',{name:'Prepare saved website',exact:true}).click();await page.waitForFunction(()=>Object.keys(sessionStorage).length>0);
  await page.evaluate(id=>window.change({accountId:id}),ids.other);await page.getByRole('button',{name:'Prepare saved website',exact:true}).waitFor();release();state.hold=null;await page.waitForTimeout(100);assert.equal(await page.getByText('Preparing your saved website.',{exact:false}).count(),0);assert.equal(await page.getByRole('button',{name:'Retry preparation request',exact:true}).count(),0);assert.ok(requests.some(r=>r.account===ids.other&&r.method==='GET'));
 });
 await scenario('feature unavailable keeps prior site readable and preparation disabled',async(page,state)=>{state.available=false;await refresh(page);await page.getByText('Verified publishing is being prepared.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Prepare saved website',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('link',{name:'Open live website'}).count(),1);});
 console.log(`${count} trusted publication React/browser groups passed. Real component, account guard and browser; APIs mocked.`);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
