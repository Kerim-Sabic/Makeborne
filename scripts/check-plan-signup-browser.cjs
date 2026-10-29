/* eslint-disable @typescript-eslint/no-require-imports -- Mounted sign-up form with a stubbed auth client; no account or provider calls. */
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const { browserType } = require('./browser-engine.cjs');
(async()=>{
 // The auth client is a stub: sign-up always needs email confirmation, and any 6-digit code verifies.
 const client="export function createClient(){return{auth:{signUp:async()=>({data:{session:null},error:null}),verifyOtp:async()=>{window.__verified=(window.__verified||0)+1;return{error:null};},resend:async()=>({error:null}),signInWithPassword:async()=>({error:null}),resetPasswordForEmail:async()=>({error:null}),signInWithOAuth:async()=>({error:null})}};}";
 const bundle=await require('esbuild').build({stdin:{contents:"import React from 'react';import {createRoot} from 'react-dom/client';import AccountForm from './src/components/account-form';createRoot(document.getElementById('root')).render(<AccountForm/>);",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'stubs',setup(build){
  build.onResolve({filter:/^next\/(link|navigation)$|^@\/lib\/supabase\/client$|^\.\/brand-mark$/},args=>({path:args.path,namespace:'stub'}));
  build.onResolve({filter:/^@\//},args=>{const file=path.resolve('src',args.path.slice(2));return{path:fs.existsSync(file+'.ts')?file+'.ts':file+'.tsx'};});
  build.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:args.path==='next/navigation'?"export const useRouter=()=>({push:url=>location.assign(url),replace:url=>location.replace(url),refresh(){}});":args.path==='@/lib/supabase/client'?client:args.path==='./brand-mark'?"export default function BrandMark(){return null}":"import React from 'react';export default function Link(p){return React.createElement('a',p)}",resolveDir:path.resolve('node_modules')}));}}],resolveExtensions:['.tsx','.ts','.js']});
 const server=http.createServer((req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
  if(req.url==='/api/auth/providers'){res.setHeader('content-type','application/json');res.end(JSON.stringify({enabled:true,google:false,github:false}));return;}
  res.setHeader('content-type','text/html');res.end('<div id="root"></div><script src="/bundle.js"></script>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;let browser;
 const signUp=async(page,next)=>{await page.goto(`${base}/login?mode=signup&next=${encodeURIComponent(next)}`);await page.getByRole('button',{name:'Create account'}).waitFor();
  await page.getByLabel('Email address').fill('fixture@example.test');await page.getByLabel('Password',{exact:true}).fill('fixture-password-1234');await page.getByRole('button',{name:'Create account'}).click();await page.getByRole('heading',{name:'Check your inbox'}).waitFor();};
 try{
  browser=await browserType.launch({headless:true});
  // The plan path: the choice is restated, the code field is open, and a verified code goes straight back to the plan.
  const plan=await browser.newPage();const planNext='/billing?plan=studio&interval=monthly#plans';
  await plan.goto(`${base}/login?mode=signup&next=${encodeURIComponent(planNext)}`);await plan.getByText('Studio · $49 a month · 750 credits. Create your account, then pay in secure Whop checkout.').waitFor();
  await signUp(plan,planNext);assert.equal(await plan.getByLabel('Code from your email').isVisible(),true,'the code input shows by default on the plan path');
  await plan.getByLabel('Code from your email').fill('123456');await plan.getByRole('button',{name:'Verify email'}).click();await plan.waitForURL(url=>url.pathname==='/billing');
  const back=new URL(plan.url());assert.equal(back.searchParams.get('plan'),'studio');assert.equal(back.searchParams.get('interval'),'monthly');assert.equal(back.hash,'#plans');
  // Every other entry point keeps today's explicit Continue step and a closed code field.
  const studio=await browser.newPage();await studio.goto(`${base}/login?mode=signup&next=${encodeURIComponent('/studio')}`);await studio.getByRole('button',{name:'Create account'}).waitFor();assert.equal(await studio.locator('.auth-plan-strip').count(),0);
  await signUp(studio,'/studio');assert.equal(await studio.getByLabel('Code from your email').isVisible(),false);await studio.getByText('Have a verification code?').click();
  await studio.getByLabel('Code from your email').fill('123456');await studio.getByRole('button',{name:'Verify email'}).click();await studio.getByRole('link',{name:'Continue'}).waitFor();assert.equal(new URL(studio.url()).pathname,'/login');
  // A tampered plan is not restated.
  const evil=await browser.newPage();await evil.goto(`${base}/login?mode=signup&next=${encodeURIComponent('/billing?plan=evil&interval=weekly')}`);await evil.getByRole('button',{name:'Create account'}).waitFor();assert.equal(await evil.locator('.auth-plan-strip').count(),0);
  console.log('PASS mounted sign-up: plan restated from the catalogue, code entry open and auto-continue only for a /billing plan return, explicit Continue kept elsewhere, tampered plan ignored. Stubbed auth only.');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
