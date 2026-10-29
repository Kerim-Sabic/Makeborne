/* eslint-disable @typescript-eslint/no-require-imports -- Mounted sign-up clickwrap line and checkout withdrawal consent at 390 and 1440 px; stubbed auth and mocked HTTP only. */
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const { browserType } = require('./browser-engine.cjs');
const link="import React from 'react';export default function Link(p){return React.createElement('a',p)}";
const nav="export const useRouter=()=>({push:url=>location.assign(url),replace:url=>location.replace(url),refresh(){}});";
const client="export function createClient(){return{auth:{signUp:async args=>{window.__signUp=args;return{data:{session:null},error:null};},verifyOtp:async()=>({error:null}),resend:async()=>({error:null}),signInWithPassword:async()=>({error:null}),resetPasswordForEmail:async()=>({error:null}),signInWithOAuth:async()=>({error:null})}};}";
const build=entry=>require('esbuild').build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},resolveExtensions:['.tsx','.ts','.js'],plugins:[{name:'stubs',setup(b){
 b.onResolve({filter:/^next\/(link|navigation)$|^@\/lib\/supabase\/client$|^\.\/brand-mark$/},args=>({path:args.path,namespace:'stub'}));
 b.onResolve({filter:/^@\//},args=>{const file=path.resolve('src',args.path.slice(2));return{path:fs.existsSync(file+'.ts')?file+'.ts':file+'.tsx'};});
 b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:args.path==='next/navigation'?nav:args.path==='@/lib/supabase/client'?client:args.path==='./brand-mark'?"export default function BrandMark(){return null}":link,resolveDir:path.resolve('node_modules')}));}}]});
(async()=>{
 const form=await build("import React from 'react';import {createRoot} from 'react-dom/client';import AccountForm from './src/components/account-form';createRoot(document.getElementById('root')).render(<AccountForm/>);");
 const plans=await build("import React from 'react';import {createRoot} from 'react-dom/client';import Plans from './src/components/creation-plans';createRoot(document.getElementById('root')).render(<Plans/>);");
 let availability={authenticated:true,existingMember:false,offers:[{tier:'studio',interval:'monthly',totalCents:4900,monthlyCredits:750}]};const requests=[];
 const server=http.createServer((req,res)=>{
  const js=bundle=>{res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].text);};
  if(req.url==='/form.js')return js(form);if(req.url==='/plans.js')return js(plans);
  if(req.url==='/api/auth/providers'){res.setHeader('content-type','application/json');res.end(JSON.stringify({enabled:true,google:true,github:false}));return;}
  if(req.url==='/api/billing/availability'){res.setHeader('content-type','application/json');res.end(JSON.stringify(availability));return;}
  if(req.url==='/api/billing/checkout'){let body='';req.on('data',c=>body+=c);req.on('end',()=>{requests.push(JSON.parse(body));res.setHeader('content-type','application/json');res.end(JSON.stringify({url:'https://whop.com/checkout/ch_fixture'}));});return;}
  res.setHeader('content-type','text/html');res.end(`<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/${req.url.startsWith('/billing')?'plans':'form'}.js"></script>`);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;let browser;
 const noOverflow=async page=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'no sideways scroll');
 try{
  browser=await browserType.launch({headless:true});
  for(const width of [390,1440]){
   const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();
   // Sign-up: the clickwrap line names both documents as links, with no checkbox, and email sign-up stores the version.
   await page.goto(`${base}/login?mode=signup`);await page.getByRole('button',{name:'Create account'}).waitFor();
   const line=page.locator('#signup-terms');assert.equal(await line.innerText(),'By creating an account you agree to the Terms and acknowledge the Privacy Policy.');
   assert.equal(await line.getByRole('link',{name:'Terms'}).getAttribute('href'),'/terms');assert.equal(await line.getByRole('link',{name:'Privacy Policy'}).getAttribute('href'),'/privacy');
   assert.equal(await page.locator('form input[type=checkbox]').count(),0,'no pre-ticked or extra box at sign-up');assert.equal(await line.isVisible(),true);await noOverflow(page);
   for(const label of ['Terms','Privacy','DPA','Legal notice'])assert.equal(await page.locator('footer').getByRole('link',{name:label,exact:true}).count(),1,`footer ${label}`);
   await page.getByLabel('Email address').fill('fixture@example.test');await page.getByLabel('Password',{exact:true}).fill('fixture-password-1234');await page.getByRole('button',{name:'Create account'}).click();await page.getByRole('heading',{name:'Check your inbox'}).waitFor();
   const signUp=await page.evaluate(()=>window.__signUp.options.data);assert.equal(signUp.terms_version,'2026-10-26');assert.ok(Date.parse(signUp.terms_accepted_at)>0);
   // Sign-in with a social provider: the same terms before an account can be created.
   await page.evaluate(()=>{localStorage.clear();sessionStorage.clear();});await page.goto(`${base}/login`);await page.getByRole('button',{name:'Sign in'}).waitFor();await page.getByText(/New here\? Continuing with Google or GitHub creates an account\. By creating an account you agree to the Terms/).waitFor();
   // Checkout: unticked box, gated buttons, nothing sent until it is ticked; then the version travels with the request.
   requests.length=0;availability={authenticated:true,existingMember:false,offers:[{tier:'studio',interval:'monthly',totalCents:4900,monthlyCredits:750}]};
   await page.route('https://whop.com/**',route=>route.fulfill({body:'Mock checkout'}));await page.goto(`${base}/billing`);
   const box=page.getByRole('checkbox',{name:/I want my plan to start immediately/});await box.waitFor();assert.equal(await box.isChecked(),false);
   const buy=page.getByRole('button',{name:'Get Studio'});assert.equal(await buy.getAttribute('aria-disabled'),'true');
   await buy.dispatchEvent('click');await page.getByRole('alert').filter({hasText:'Tick the box about starting your plan now'}).waitFor();assert.equal(requests.length,0,'no checkout before consent');
   assert.equal(await page.locator('.billing-consent').getByRole('link',{name:'how'}).getAttribute('href'),'/withdraw');await noOverflow(page);
   await box.check();assert.equal(await buy.getAttribute('aria-disabled'),null);await buy.click();await page.waitForURL('https://whop.com/checkout/ch_fixture');
   assert.equal(requests.length,1);assert.equal(requests[0].withdrawalConsent,'withdrawal-2026-10-26');assert.equal(requests[0].tier,'studio');
   // Signed out: no box (no payment can start), the plan button leads to sign-up.
   availability={...availability,authenticated:false};await page.goto(`${base}/billing`);await page.getByRole('button',{name:'Get Studio'}).waitFor();await page.getByText('Next: create your account').waitFor();assert.equal(await page.getByRole('checkbox').count(),0);
   await context.close();
  }
  console.log('PASS legal consent at 390 and 1440 px: sign-up clickwrap links and stored version, social sign-in line, legal footer links, unticked checkout consent gating the buy button, consent version sent with checkout, no box when signed out, no sideways scroll.');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
