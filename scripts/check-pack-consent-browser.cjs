/* eslint-disable @typescript-eslint/no-require-imports -- Mounted real component, loopback mocked HTTP only; never a payment. */
const assert=require('node:assert/strict'),http=require('node:http'),path=require('node:path');
const {browserType}=require('./browser-engine.cjs');
(async()=>{
 const bundle=await require('esbuild').build({stdin:{contents:"import React from 'react';import{createRoot}from'react-dom/client';import Packs from './src/components/billing-topups';createRoot(document.getElementById('root')).render(<Packs/>);",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'navigation',setup(b){b.onResolve({filter:/^next\/navigation$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const useRouter=()=>({push:url=>location.assign(url)});',resolveDir:path.resolve('node_modules')}));}}]});
 let available=true,requests=[],fail=true;
 const server=http.createServer((req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('content-type','text/javascript');return res.end(bundle.outputFiles[0].text);}
  if(req.url==='/api/billing/topups'){
   res.setHeader('content-type','application/json');
   if(req.method==='GET')return res.end(JSON.stringify({available,authenticated:true,eligible:true,reason:available?null:'Not open'}));
   let body='';req.on('data',c=>body+=c);req.on('end',()=>{requests.push(JSON.parse(body));res.statusCode=fail?503:200;res.end(JSON.stringify(fail?{error:{message:'Temporary test fault'}}:{url:'https://sandbox.whop.com/checkout/ch_fixture'}));});return;
  }
  res.setHeader('content-type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;let browser;
 try{
  browser=await browserType.launch({headless:true});
  for(const width of [375,1440]){
   available=true;requests=[];fail=true;
   const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();
   await page.route('https://sandbox.whop.com/**',route=>route.fulfill({body:'Fictional checkout; no payment'}));
   await page.goto(base+'/billing');const box=page.getByRole('checkbox',{name:/credit pack to be available immediately/});await box.waitFor();assert.equal(await box.isChecked(),false);
   await page.getByRole('button',{name:'Continue with 100 credits'}).click();await page.getByRole('alert').waitFor();assert.equal(requests.length,0,'Unticked box never POSTs');
   await box.check();await page.getByRole('button',{name:'Continue with 100 credits'}).click();await page.getByText('Temporary test fault').waitFor();
   assert.equal(requests.length,1);assert.equal(requests[0].withdrawalConsent,'withdrawal-2026-10-26');assert.equal(requests[0].packId,'boost_100');
   fail=false;await page.getByRole('button',{name:'Continue with 100 credits'}).click();await page.waitForURL('https://sandbox.whop.com/checkout/ch_fixture');
   assert.equal(requests.length,2);assert.equal(requests[0].requestId,requests[1].requestId,'Uncertain retry reuses the same request');
   available=false;await page.goto(base+'/billing');await page.getByRole('button',{name:'Credit packs coming soon'}).waitFor();assert.equal(await page.getByRole('checkbox').count(),0);assert.equal(await page.getByRole('button',{name:'Credit packs coming soon'}).isDisabled(),true);
   await context.close();
  }
  console.log('PASS mounted pack consent at 375/1440: unticked/no POST, explicit version, same-key retry, hidden/disabled coming-soon state. Mock HTTP only.');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
