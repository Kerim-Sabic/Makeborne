/* eslint-disable @typescript-eslint/no-require-imports -- Actual React flow with local mocked HTTP only. */
const assert=require('node:assert/strict'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 const bundle=await require('esbuild').build({stdin:{contents:"import React from 'react';import {createRoot} from 'react-dom/client';import Plans from './src/components/creation-plans';createRoot(document.getElementById('root')).render(<Plans/>);",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'link-stub',setup(build){build.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));build.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:args.path==='next/navigation'?"export const useRouter=()=>({push:url=>location.assign(url)});":"import React from 'react';export default function Link(p){return React.createElement('a',p)}",resolveDir:path.resolve('node_modules')}));}}]});
 let availability={authenticated:false,existingMember:false,offers:[]},requests=[],mode='error';
 const server=http.createServer((req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
  if(req.url==='/api/billing/availability'){res.setHeader('content-type','application/json');res.end(JSON.stringify(availability));return;}
  if(req.url==='/api/billing/checkout'){let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{requests.push(JSON.parse(body));res.setHeader('content-type','application/json');res.statusCode=mode==='error'?503:200;res.end(JSON.stringify(mode==='error'?{error:{message:'Checkout awaiting confirmation. Retry safely.'}}:{url:'https://whop.com/checkout/ch_fixture'}));});return;}
  res.setHeader('content-type','text/html');res.end('<div id="root"></div><script src="/bundle.js"></script>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage();
  await page.goto(base+'/billing');await page.getByText('Creation memberships are not available for purchase yet.').waitFor();assert.equal(await page.locator('.founding-cta:disabled').count(),3);
  availability.offers=[{tier:'create',interval:'monthly',totalCents:2900,monthlyCredits:300},{tier:'create',interval:'yearly',totalCents:27840,monthlyCredits:300}];
  await page.reload();await page.getByRole('button',{name:'Sign in for Create'}).waitFor();await page.getByRole('radio',{name:/Yearly/}).click();await page.getByRole('button',{name:'Sign in for Create'}).click();await page.waitForURL('**/login?**');assert.equal(requests.length,0);
  availability.authenticated=true;await page.goto(base+'/billing');await page.getByRole('button',{name:'Continue with Create'}).waitFor();assert.equal(await page.getByRole('radio',{name:/Yearly/}).getAttribute('aria-checked'),'true');await page.getByText(/Selected: Create, yearly/).waitFor();
  await page.getByRole('button',{name:'Continue with Create'}).click();await page.getByRole('alert').waitFor();await page.getByRole('button',{name:'Continue with Create'}).click();await page.waitForFunction(()=>document.querySelector('[role=alert]'));assert.equal(requests.length,2);assert.equal(requests[0].requestId,requests[1].requestId);assert.equal(requests[0].interval,'yearly');assert.equal(Object.hasOwn(requests[0],'priceCents'),false);
  await page.reload();await page.getByRole('button',{name:'Continue with Create'}).click();await page.getByRole('alert').waitFor();assert.equal(requests[0].requestId,requests[2].requestId);
  mode='success';await page.route('https://whop.com/**',route=>route.fulfill({body:'Mock checkout destination'}));await page.getByRole('button',{name:'Continue with Create'}).click();await page.waitForURL('https://whop.com/checkout/ch_fixture');
  availability={authenticated:true,existingMember:true,offers:[]};await page.goto(base+'/billing');await page.getByText(/You already have a creation subscription/).waitFor();assert.equal(await page.getByRole('button',{name:'Already subscribed'}).count(),3);assert.equal(await page.locator('.founding-cta:disabled').count(),3);
  availability={authenticated:true,existingMember:false,offers:[{tier:'create',interval:'monthly',totalCents:1,monthlyCredits:300}]};await page.reload();await page.getByText('Plan availability could not be loaded.').waitFor();assert.equal(await page.locator('.founding-cta:disabled').count(),3);
  availability.offers=[];await page.getByRole('button',{name:'Retry availability'}).click();await page.getByText('Creation memberships are not available for purchase yet.').waitFor();
  console.log('PASS actual React browser: closed purchase, yearly login selection, no automatic purchase, stable retry/reload key, mocked redirect, existing-member support. No provider/account calls.');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
