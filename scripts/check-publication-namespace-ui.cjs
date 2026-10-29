/* eslint-disable @typescript-eslint/no-require-imports -- Mounted local UI qualification; APIs mocked, no provider calls. */
const assert=require('node:assert/strict');
const {createServer}=require('node:http');
const {build}=require('esbuild');
const {browserType}=require('./browser-engine.cjs');
const ids={account:'11111111-1111-4111-8111-111111111111',workspace:'22222222-2222-4222-8222-222222222222',artifact:'33333333-3333-4333-8333-333333333333',prep:'44444444-4444-4444-8444-444444444444'};
const labels=['release-check','release-check-renamed'];
const staging=()=>({enabled:true,allowedSlugs:labels,reservedSlugs:[]});
const production=()=>({enabled:true,allowedSlugs:null,reservedSlugs:labels});
const storageKey=`makeborne-publish-v1:${ids.account}:${ids.workspace}:${ids.artifact}`;
const pending={key:'66666666-6666-4666-8666-666666666666',body:JSON.stringify({version:1,revision:4,slug:'ordinary-customer',interactive:false})};
const live=slug=>({slug,live:true,version_number:1,revision:4,updated_at:'2026-10-13T00:00:00Z',interactive:false,scripted:false});
const ready=slug=>({id:ids.prep,state:'ready',workspaceId:ids.workspace,artifactId:ids.artifact,version:1,publicationRevision:4,slug,interactive:false,expiresAt:'2030-01-01T00:00:00Z',error:null,previewHtml:'<html><head></head><body>Reviewed</body></html>',previewRoutes:[]});
const fixture=`import React from 'react';import{createRoot}from'react-dom/client';import Publish from './src/components/trusted-website-publish';import{setCloudAccount}from'./src/components/cloud-api';const ids=${JSON.stringify(ids)};setCloudAccount(ids.account);createRoot(document.getElementById('root')).render(<Publish accountId={ids.account} workspaceId={ids.workspace} artifactId={ids.artifact} title="Bakery" version={1} dirty={false} disabled={false} owner={true}/>);`;
async function main(){
 const output=await build({stdin:{contents:fixture,loader:'jsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env':'{}'},plugins:[{name:'enquiries-stub',setup(b){b.onResolve({filter:/website-enquiries$/},()=>({path:'enquiries',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export default function Enquiries(){return null}'}));}}]});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html');res.end(req.url==='/fixture.js'?output.outputFiles[0].contents:'<!doctype html><div id="root"></div><script src="/fixture.js"></script>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser,count=0;
 try{
  browser=await browserType.launch({headless:true});
  const prepare=page=>page.getByRole('button',{name:'Prepare saved website',exact:true});
  const address=page=>page.getByRole('textbox',{name:'Website address'});
  const refresh=page=>page.getByRole('button',{name:'Refresh publishing status'}).click();
  async function scenario(name,initial,check){
   const page=await browser.newPage();page.setDefaultTimeout(5000);
   const state={site:null,prep:null,policy:staging(),status:200,available:true,...initial},requests=[],errors=[];
   if(state.pending)await page.addInitScript(({key,value})=>sessionStorage.setItem(key,JSON.stringify(value)),{key:storageKey,value:state.pending});
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/api/cloud/**',async route=>{
    const req=route.request(),isPrep=req.url().endsWith('/preparation'),method=req.method();
    if(method==='POST'){
     const data=req.postDataJSON();requests.push({isPrep,data});state.lastPostKey=req.headers()['idempotency-key'];
     if(state.postError)return route.fulfill({status:503,json:{error:{message:'Preparation response lost'}}});
     if(isPrep){state.prep={...ready(data.slug),publicationRevision:data.revision,state:'queued',previewHtml:null};return route.fulfill({json:{preparation:state.prep}});}
     if(data.live===false)state.site={...state.site,live:false,revision:5};
     return route.fulfill({json:{site:state.site}});
    }
    if(!isPrep&&state.status!==200)return route.fulfill({status:state.status,json:{error:{message:'Publishing status unavailable'}}});
    const json=isPrep?{available:state.available,preparation:state.prep}:{site:state.site,preparationAvailable:state.available,addressPolicy:state.policy};
    if(state.holdGet){state.heldGets=(state.heldGets??0)+1;await state.holdGet;}
    return route.fulfill({json});
   });
   try{await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('heading',{name:'Publish website'}).waitFor();await check(page,state,requests);assert.deepEqual(errors,[]);count++;console.log('PASS '+name);}finally{await page.close();}
  }
  await scenario('staging defaults to exact QA address, blocks ordinary labels and queues the second allowed label',{},async(page,_state,requests)=>{
   await page.waitForFunction(()=>document.querySelector('input[aria-label="Website address"]')?.value==='release-check');
   assert.equal(await prepare(page).isEnabled(),true);
   await address(page).fill('ordinary-customer');assert.equal(await prepare(page).isDisabled(),true);
   await address(page).fill(labels[1]);assert.equal(await prepare(page).isEnabled(),true);
   await prepare(page).click();await page.getByRole('button',{name:'Preparing website…',exact:true}).waitFor();
   assert.deepEqual(requests,[{isPrep:true,data:{version:1,revision:0,slug:labels[1],interactive:false}}]);
  });
  await scenario('production ordinary addresses stay enabled while both QA labels are reserved',{policy:production()},async(page,_state,requests)=>{
   await page.waitForFunction(()=>!document.querySelector('button.button.secondary')?.disabled);
   for(const slug of labels){await address(page).fill(slug);assert.equal(await prepare(page).isDisabled(),true);}
   await address(page).fill('ordinary-customer');assert.equal(await prepare(page).isEnabled(),true);assert.equal(requests.length,0);
  });
  await scenario('disabled namespace retains existing live link and permits explicit offline cleanup',{site:live('ordinary-customer'),policy:{enabled:false,allowedSlugs:[],reservedSlugs:labels}},async(page,_state,requests)=>{
   await page.getByRole('link',{name:'Open live website'}).waitFor();assert.equal(await prepare(page).isDisabled(),true);
   await page.getByRole('button',{name:'Take website offline',exact:true}).click();await page.getByRole('button',{name:'Take offline',exact:true}).click();
   await page.getByText('Your website is offline. Its address stays reserved.').waitFor();assert.equal(requests.length,1);assert.equal(requests[0].data.live,false);assert.equal(requests[0].data.slug,'ordinary-customer');
  });
  await scenario('existing ready output outside staging cannot be promoted',{site:live('ordinary-customer'),prep:ready('ordinary-customer')},async(page,_state,requests)=>{
   const consent=page.getByRole('checkbox',{name:/I’ve reviewed/});await consent.check();
   assert.equal(await page.getByRole('button',{name:'Publish reviewed website',exact:true}).isDisabled(),true);assert.equal(requests.length,0);
  });
  await scenario('reviewed QA output requires explicit consent and promotes only its identifier',{site:live(labels[0]),prep:ready(labels[0])},async(page,_state,requests)=>{
   const publish=page.getByRole('button',{name:'Publish reviewed website',exact:true});await publish.waitFor();assert.equal(await publish.isDisabled(),true);
   await page.getByRole('checkbox',{name:/I’ve reviewed/}).check();assert.equal(await publish.isEnabled(),true);await publish.click();
   await page.getByText('Your reviewed website is live.',{exact:false}).waitFor();assert.deepEqual(requests,[{isPrep:false,data:{preparationId:ids.prep,acknowledged:true}}]);
  });
  await scenario('valid namespace withdrawal disables a previously allowed preparation',{},async(page,state,requests)=>{
   await page.waitForFunction(()=>!document.querySelector('button.button.secondary')?.disabled);state.policy={enabled:false,allowedSlugs:[],reservedSlugs:labels};await refresh(page);
   await page.waitForFunction(()=>document.querySelector('button.button.secondary')?.disabled);assert.equal(requests.length,0);
  });
  for(const invalid of [undefined,{enabled:true,allowedSlugs:'release-check',reservedSlugs:[]}]){
   await scenario('malformed or missing initial server policy remains disabled',{policy:invalid},async(page,_state,requests)=>{
    await page.getByText('Refresh the app to load its publishing options.').waitFor();assert.equal(await prepare(page).isDisabled(),true);assert.equal(requests.length,0);
   });
  }
  await scenario('malformed refresh invalidates prior permission before another preparation',{},async(page,state,requests)=>{
   await page.waitForFunction(()=>!document.querySelector('button.button.secondary')?.disabled);state.policy=null;await refresh(page);
   await page.getByText('Refresh the app to load its publishing options.').waitFor();assert.equal(await prepare(page).isDisabled(),true);assert.equal(requests.length,0);
  });
  await scenario('failed status refresh invalidates prior permission before another preparation',{},async(page,state,requests)=>{
   await page.waitForFunction(()=>!document.querySelector('button.button.secondary')?.disabled);state.status=503;await refresh(page);
   await page.getByText('Publishing status unavailable').waitFor();assert.equal(await prepare(page).isDisabled(),true);assert.equal(requests.length,0);
  });
  const clear=page=>page.getByRole('button',{name:'Clear saved preparation request',exact:true});
  await scenario('namespace cutover permits explicit browser-only recovery from an ordinary pending address',{site:live('ordinary-customer'),pending},async(page,state,requests)=>{
   const retry=page.getByRole('button',{name:'Retry preparation request',exact:true});await retry.waitFor();
   await page.getByRole('link',{name:'Open live website'}).waitFor();assert.equal(await retry.isDisabled(),true);assert.equal(await address(page).isDisabled(),true);
   await clear(page).click();assert.equal(await address(page).isEnabled(),true);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),storageKey),null);
   assert.equal(requests.length,0);assert.equal(state.site.live,true);assert.equal(await page.getByRole('link',{name:'Open live website'}).getAttribute('href'),'https://sites.makeborne.com/ordinary-customer');
   await address(page).fill(labels[0]);await prepare(page).click();await page.getByRole('button',{name:'Preparing website…',exact:true}).waitFor();
   assert.deepEqual(requests,[{isPrep:true,data:{version:1,revision:4,slug:labels[0],interactive:false}}]);assert.notEqual(state.lastPostKey,pending.key);
  });
  await scenario('browser-only recovery is unavailable while authoritative preparation is running',{site:live('ordinary-customer'),pending,prep:{...ready('ordinary-customer'),state:'building',previewHtml:null}},async(page,state,requests)=>{
   await page.getByRole('button',{name:'Preparing website…',exact:true}).waitFor();assert.ok(await clear(page).count()===0||await clear(page).isDisabled());
   assert.equal(await address(page).isDisabled(),true);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),storageKey),JSON.stringify(pending));assert.equal(state.prep.state,'building');assert.equal(requests.length,0);
  });
  await scenario('browser-only recovery waits for a successful status refresh',{site:live('ordinary-customer'),pending,status:503},async(page,state,requests)=>{
   await page.getByText('Publishing status unavailable').waitFor();assert.ok(await clear(page).count()===0||await clear(page).isDisabled());
   state.status=200;await refresh(page);await clear(page).click();assert.equal(await address(page).isEnabled(),true);assert.equal(requests.length,0);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),storageKey),null);
  });
  await scenario('older refresh cannot overwrite newer running preparation or unlock local recovery',{site:live('ordinary-customer'),pending},async(page,state,requests)=>{
   await page.getByRole('link',{name:'Open live website'}).waitFor();let release;
   state.holdGet=new Promise(resolve=>{release=resolve;});await refresh(page);
   for(let tries=0;state.heldGets!==2&&tries<100;tries++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(state.heldGets,2);
   state.holdGet=null;state.prep={...ready('ordinary-customer'),state:'building',previewHtml:null};await refresh(page);
   await page.getByRole('button',{name:'Preparing website…',exact:true}).waitFor();release();
   await page.waitForTimeout(100);assert.equal(await page.getByRole('button',{name:'Preparing website…',exact:true}).count(),1);
   assert.equal(await clear(page).isDisabled(),true);assert.equal(requests.length,0);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),storageKey),JSON.stringify(pending));
  });
  await scenario('older success cannot reopen local recovery after a newer failed status refresh',{site:live('ordinary-customer'),pending},async(page,state,requests)=>{
   await page.getByRole('link',{name:'Open live website'}).waitFor();let release;
   state.holdGet=new Promise(resolve=>{release=resolve;});await refresh(page);
   for(let tries=0;state.heldGets!==2&&tries<100;tries++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(state.heldGets,2);
   state.holdGet=null;state.status=503;await refresh(page);await page.getByText('Publishing status unavailable').waitFor();release();
   await page.waitForTimeout(100);assert.equal(await clear(page).isDisabled(),true);assert.equal(requests.length,0);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),storageKey),JSON.stringify(pending));
   assert.equal(await page.getByRole('link',{name:'Open live website'}).count(),1);
  });
  await scenario('ambiguous preparation response requires a new status refresh before local discard',{site:live(labels[0]),postError:true},async(page,_state,requests)=>{
   await page.getByRole('link',{name:'Open live website'}).waitFor();await prepare(page).click();await page.getByText('Preparation response lost').waitFor();
   assert.equal(await clear(page).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Retry preparation request',exact:true}).isDisabled(),true);
   assert.notEqual(await page.evaluate(key=>sessionStorage.getItem(key),storageKey),null);await refresh(page);await clear(page).click();
   assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),storageKey),null);assert.equal(requests.length,1);assert.equal(await page.getByRole('link',{name:'Open live website'}).count(),1);
  });
  console.log(JSON.stringify({groups:count,providerCalls:0,cloudWrites:0,realComponent:true,api:'mocked'}));
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
