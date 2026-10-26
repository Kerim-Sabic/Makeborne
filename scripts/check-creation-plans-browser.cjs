/* eslint-disable @typescript-eslint/no-require-imports -- Actual React flow with local mocked HTTP only. */
const assert=require('node:assert/strict'),http=require('node:http'),path=require('node:path');
const { browserType } = require('./browser-engine.cjs');
(async()=>{
 const bundle=await require('esbuild').build({stdin:{contents:"import React from 'react';import {createRoot} from 'react-dom/client';import Plans from './src/components/creation-plans';createRoot(document.getElementById('root')).render(<Plans accountId={window.__account??null}/>);",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'link-stub',setup(build){build.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));build.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:args.path==='next/navigation'?"export const useRouter=()=>({push:url=>location.assign(url)});":"import React from 'react';export default function Link(p){return React.createElement('a',p)}",resolveDir:path.resolve('node_modules')}));}}]});
 let availability={authenticated:false,existingMember:false,offers:[]},requests=[],replies=[],delay=0;
 const ok={status:200,body:{url:'https://whop.com/checkout/ch_fixture'}},failed={status:503,body:{error:{code:'CHECKOUT_UNAVAILABLE',message:'Checkout awaiting confirmation. Retry safely.'}}};
 const conflict=code=>({status:409,body:{error:{code,message:'Mocked conflict.'}}});
 const server=http.createServer((req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
  if(req.url==='/api/billing/availability'){setTimeout(()=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(availability));},delay);return;}
  if(req.url==='/api/billing/checkout'){let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{requests.push(JSON.parse(body));const reply=replies.shift()??failed;res.setHeader('content-type','application/json');res.statusCode=reply.status;res.end(JSON.stringify(reply.body));});return;}
  res.setHeader('content-type','text/html');res.end('<div id="root"></div><script src="/bundle.js"></script>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;let browser;
 const studio={tier:'studio',interval:'monthly',totalCents:4900,monthlyCredits:750};
 try{
  browser=await browserType.launch({headless:true});const page=await browser.newPage();
  const fresh=async(account=null)=>{const context=await browser.newContext();const p=await context.newPage();if(account)await p.addInitScript(id=>{window.__account=id;},account);await p.route('https://whop.com/**',route=>route.fulfill({body:'Mock checkout destination'}));return p;};
  // Loading: three disabled "Checking…" buttons and no launch pill until an empty availability arrives.
  delay=600;await page.goto(base+'/billing');await page.getByText('Checking plan availability…').waitFor();assert.equal(await page.getByRole('button',{name:'Checking…'}).count(),3);assert.equal(await page.getByText('Opens at launch').count(),0);
  await page.getByText('Plans open at launch. Nothing can be bought or charged before then.').waitFor();delay=0;assert.equal(await page.locator('.founding-cta:disabled').count(),3);assert.equal(await page.getByRole('button',{name:'Opens at launch'}).count(),3);assert.equal(await page.getByRole('radiogroup').count(),0);
  // Signed out with monthly and yearly offers: one click carries plan and interval to sign-up, no purchase.
  availability.offers=[{tier:'create',interval:'monthly',totalCents:2000,monthlyCredits:300},{tier:'create',interval:'yearly',totalCents:19200,monthlyCredits:300}];
  await page.reload();await page.getByRole('button',{name:'Get Create'}).waitFor();await page.getByText('Next: create your account, then pay in secure Whop checkout. Your plan choice is kept.').waitFor();
  await page.getByRole('radio',{name:/Yearly/}).click();await page.getByText('$192 today, then $192 a year until you cancel.',{exact:false}).waitFor();await page.getByRole('button',{name:'Get Create'}).click();await page.waitForURL('**/login?**');
  const loginUrl=new URL(page.url());assert.equal(loginUrl.searchParams.get('mode'),'signup');assert.match(loginUrl.searchParams.get('next'),/^\/billing\?plan=create&interval=yearly#plans$/);assert.equal(requests.length,0);
  // Back on /billing in the same tab, signed in: the key-information panel, focused, then one click to checkout.
  availability.authenticated=true;await page.goto(base+'/billing');await page.getByRole('heading',{name:'Ready to finish: Create, $192 a year, 300 credits every month.'}).waitFor();
  assert.equal(await page.getByRole('radio',{name:/Yearly/}).getAttribute('aria-checked'),'true');assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Continue to secure checkout');
  await page.getByRole('button',{name:'Continue to secure checkout'}).click();await page.getByRole('alert').filter({hasText:'Nothing was charged'}).waitFor();await page.getByRole('button',{name:'Continue to secure checkout'}).click();
  while(requests.length<2)await page.waitForTimeout(50);
  assert.equal(requests[0].requestId,requests[1].requestId);assert.equal(requests[0].interval,'yearly');assert.equal(requests[0].tier,'create');assert.equal(Object.hasOwn(requests[0],'priceCents'),false);
  await page.reload();await page.getByRole('button',{name:'Continue to secure checkout'}).click();while(requests.length<3)await page.waitForTimeout(50);assert.equal(requests[0].requestId,requests[2].requestId);
  replies.push(ok);await page.route('https://whop.com/**',route=>route.fulfill({body:'Mock checkout destination'}));await page.getByRole('button',{name:'Continue to secure checkout'}).click();await page.waitForURL('https://whop.com/checkout/ch_fixture');
  // Members: no buying, storage cleared.
  availability={authenticated:true,existingMember:true,offers:[]};await page.goto(base+'/billing');await page.getByText(/You already have a creation subscription/).waitFor();assert.equal(await page.getByRole('button',{name:'Already subscribed'}).count(),3);assert.equal(await page.locator('.founding-cta:disabled').count(),3);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('makeborne-creation-checkout-v1')),null);
  availability={authenticated:true,existingMember:false,offers:[{tier:'create',interval:'monthly',totalCents:1,monthlyCredits:300}]};await page.reload();await page.getByText('Plan availability could not be loaded.').waitFor();assert.equal(await page.locator('.founding-cta:disabled').count(),3);
  availability.offers=[];await page.getByRole('button',{name:'Retry availability'}).click();await page.getByText('Plans open at launch. Nothing can be bought or charged before then.').waitFor();
  // Another tab or device: the URL alone restores the choice (storage empty); monthly-only shows no interval switch.
  availability={authenticated:true,existingMember:false,offers:[studio]};
  const other=await fresh();await other.goto(base+'/billing?plan=studio&interval=monthly&next=%2Fstudio%3Fdraft%3D11111111-1111-4111-8111-111111111111#plans');await other.getByRole('heading',{name:'Ready to finish: Studio, $49 a month, 750 credits every month.'}).waitFor();
  const panel=await other.locator('.billing-resume').innerText();assert.match(panel,/\$49 today plus any tax or checkout fee Whop shows, then \$49 a month until you cancel/);assert.match(panel,/statutory rights, including any EU or UK right to withdraw, still apply/);
  assert.equal(await other.getByRole('radiogroup').count(),0);assert.equal(await other.evaluate(()=>document.activeElement?.textContent),'Continue to secure checkout');
  replies.push(ok);const before=requests.length;await other.getByRole('button',{name:'Continue to secure checkout'}).click();await other.waitForURL('https://whop.com/checkout/ch_fixture');assert.equal(requests[before].tier,'studio');assert.equal(requests[before].next,'/studio?draft=11111111-1111-4111-8111-111111111111');
  // localStorage only lends an owner-bound key: same owner reuses it, another account's key is discarded, and alone it selects nothing.
  const key='aaaaaaaa-1111-4111-8111-111111111111',seed=owner=>({tier:'studio',interval:'monthly',requestId:key,owner,savedAt:Date.now()});
  for(const [account,owner,reused] of [[null,'anon',true],['user-a','user-a',true],['user-a','user-b',false]]){
   const p=await fresh(account);await p.goto(base+'/blank');await p.evaluate(v=>localStorage.setItem('makeborne-creation-checkout-v2',JSON.stringify(v)),seed(owner));
   await p.goto(base+'/billing?plan=studio&interval=monthly#plans');replies.push(ok);const at=requests.length;await p.getByRole('button',{name:'Continue to secure checkout'}).click();await p.waitForURL('https://whop.com/checkout/ch_fixture');
   assert.equal(requests[at].requestId===key,reused,`${account} / ${owner}`);await p.context().close();
  }
  const anon=await fresh();await anon.goto(base+'/blank');await anon.evaluate(v=>localStorage.setItem('makeborne-creation-checkout-v2',JSON.stringify(v)),seed('anon'));await anon.goto(base+'/billing');await anon.getByRole('button',{name:'Get Studio'}).waitFor();assert.equal(await anon.locator('.billing-resume').count(),0,'a stored key alone never shows a resume panel');
  // Open-checkout conflicts: name the earlier checkout and offer one resume; a second 409 asks not to pay twice.
  await anon.evaluate(()=>sessionStorage.setItem('makeborne-creation-checkout-sent-v1',JSON.stringify({tier:'create',interval:'monthly',requestId:'bbbbbbbb-1111-4111-8111-111111111111',next:'/studio'})));await anon.reload();
  replies.push(conflict('CHECKOUT_ALREADY_OPEN'));await anon.getByRole('button',{name:'Get Studio'}).click();await anon.getByRole('alert').filter({hasText:'You already started a checkout for Create, monthly.'}).waitFor();
  replies.push(conflict('CHECKOUT_ALREADY_OPEN'));const resumeAt=requests.length;await anon.getByRole('button',{name:'Resume that checkout'}).click();await anon.getByRole('alert').filter({hasText:'Please don’t pay twice'}).waitFor();
  assert.equal(requests[resumeAt].tier,'create');assert.equal(await anon.getByRole('button',{name:'Resume that checkout'}).count(),0);assert.doesNotMatch(await anon.locator('.billing-plans-section').innerText(),/cancel (?:that|the|your) checkout/i);
  const unknown=await fresh();await unknown.goto(base+'/billing');replies.push(conflict('CHECKOUT_ALREADY_OPEN'));await unknown.getByRole('button',{name:'Get Studio'}).click();await unknown.getByRole('alert').filter({hasText:'You already have a checkout in progress.'}).waitFor();assert.equal(await unknown.getByRole('button',{name:'Resume that checkout'}).count(),0);
  replies.push(conflict('CHECKOUT_ALREADY_COMPLETED'));await unknown.getByRole('button',{name:'Get Studio'}).click();await unknown.getByRole('status').filter({hasText:'That checkout is already complete.'}).waitFor();await unknown.getByRole('link',{name:'Open studio'}).waitFor();
  replies.push(conflict('SUBSCRIPTION_REPURCHASE_REQUIRES_SUPPORT'));await unknown.getByRole('button',{name:'Get Studio'}).click();await unknown.getByRole('alert').filter({hasText:'Before you subscribe again'}).waitFor();assert.equal(await unknown.getByRole('link',{name:'Contact support'}).getAttribute('href'),'mailto:admin@makeborne.com?subject=Subscription%20restart');assert.equal(await unknown.getByRole('button',{name:'Try again',exact:true}).count(),0,'Unsupported repeat purchase must not suggest another payment attempt');
  replies.push(conflict('CHECKOUT_CONFLICT'));const conflictAt=requests.length;await unknown.getByRole('button',{name:'Get Studio'}).click();await unknown.getByRole('alert').filter({hasText:'Checkout couldn’t open. Nothing was charged. Please try again.'}).waitFor();
  replies.push(ok);await unknown.getByRole('button',{name:'Try again'}).click();await unknown.waitForURL('https://whop.com/checkout/ch_fixture');assert.notEqual(requests[conflictAt].requestId,requests[conflictAt+1].requestId,'a conflicting key is never reused');
  console.log('PASS actual React browser: loading/pre-launch states, plan carried through sign-up, focused key-information panel, stable retry key, URL-only resume, owner-bound shared key, open/completed/conflict checkout copy, mocked redirect, existing-member support. No provider/account calls.');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
