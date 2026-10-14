// Explicit local synthetic fixture smoke. Never arms a provider or invokes generation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import pg from 'pg';
import ts from 'typescript';
import {createClient} from '@supabase/supabase-js';
import {chromium} from 'playwright';
import {ROOT,COPY_ENTRIES,json,save,canonical,cleanEnv,sourceInventory,ledger} from './fresh-quality-common.mjs';
assert(process.argv.slice(2).every(arg=>['--run','--dry-run'].includes(arg)));
if(!process.argv.includes('--run'))console.log(JSON.stringify({dryRun:true,providerRequests:0,dbWrites:0,port:3069,api:'http://127.0.0.1:55465',database:'127.0.0.1:55468',synthetic:true}));
else{
 const local=json('work/fresh-quality-stack/status.json'),url=new URL(local.DB_URL);assert.equal(local.API_URL,'http://127.0.0.1:55465');assert.equal(url.protocol,'postgresql:');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55468');assert.equal(url.pathname,'/postgres');assert.equal(url.search,'');assert.equal(url.hash,'');
 const id=randomUUID(),base=path.resolve('work/fresh-quality-smoke',id),app=path.join(base,'app'),output=path.resolve('outputs',`fresh-quality-smoke-${id}`),origin='http://127.0.0.1:3069';
 const db=new pg.Client({connectionString:local.DB_URL}),checks=[],env=cleanEnv(local,''),childEnv={...env};delete childEnv.SUPABASE_SECRET_KEY;delete childEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 let child,browser,baseline,limits,processTreeStopped=null;
 const report={synthetic:true,modelGenerated:false,providerRequests:0,origin,sourceHashes:sourceInventory(),checks};
 try{
  await db.connect();baseline=canonical(await ledger(db));limits=(await db.query('select * from makeborne_private.live_provider_limits order by scope')).rows;assert(limits.every(row=>!row.enabled));assert((await db.query("select to_regclass('makeborne_private.ai_operations') is not null and to_regclass('makeborne_private.ai_operation_runs') is not null ready")).rows[0].ready);
  await new Promise((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(3069,'127.0.0.1',()=>s.close(resolve));});
  fs.mkdirSync(app,{recursive:true});fs.mkdirSync(output,{recursive:true});
  for(const entry of COPY_ENTRIES)if(fs.existsSync(entry)){fs.mkdirSync(path.dirname(path.join(app,entry)),{recursive:true});fs.cpSync(entry,path.join(app,entry),{recursive:true,errorOnExist:true});}
  assert.equal(canonical(sourceInventory(app)),canonical(report.sourceHashes));fs.symlinkSync(path.join(ROOT,'node_modules'),path.join(app,'node_modules'),'junction');
  const config=path.join(app,'next.config.ts'),raw=fs.readFileSync(config,'utf8');assert(raw.includes('const nextConfig: NextConfig = {'));fs.writeFileSync(config,raw.replace('const nextConfig: NextConfig = {','const nextConfig: NextConfig = {\n distDir: ".next-quality-smoke",'));
  const auth=createClient(local.API_URL,local.SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}}),email=`quality-smoke-${id}@example.invalid`,password=`Smoke-${randomUUID()}!`;
  const user=await auth.auth.admin.createUser({email,password,email_confirm:true});assert(!user.error&&user.data.user);await db.query("insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values($1,true,true,'Local provider-disabled route smoke')",[user.data.user.id]);
  const log=fs.openSync(path.join(base,'server.log'),'a');child=spawn(process.execPath,[path.join(ROOT,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','3069'],{cwd:app,env,stdio:['ignore',log,log],windowsHide:true});fs.closeSync(log);
  const readyBy=Date.now()+180000;let ready=false;while(Date.now()<readyBy&&!ready){assert(child.exitCode===null,'SMOKE_SERVER_EXITED');try{ready=(await fetch(origin+'/login',{signal:AbortSignal.timeout(2000)})).ok;}catch{}if(!ready)await new Promise(resolve=>setTimeout(resolve,1000));}assert(ready,'SMOKE_SERVER_NOT_READY');
  browser=await chromium.launch({headless:true,env:childEnv});const page=await browser.newPage();await page.route('**/*',route=>[origin,local.API_URL].includes(new URL(route.request().url()).origin)?route.continue():route.abort());
  await page.goto(origin+'/login');await page.locator('#account-email').fill(email);await page.locator('#account-password').fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(u=>!u.pathname.includes('/login'),{timeout:30000});checks.push('local fixture sign-in');
  const api=async(route,body)=>{const r=await page.request.post(origin+route,{data:body,headers:{Origin:origin,'Idempotency-Key':randomUUID(),'x-makeborne-crm-protocol':'2'},timeout:120000});assert.equal(r.status(),201,`LOCAL_ROUTE_STATUS_${r.status()}_${route}`);return r.json();};
  const workspace=(await api('/api/workspaces',{name:'Synthetic route smoke '+id})).workspace.id;checks.push('workspace create');
  const require=createRequire(import.meta.url);require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,resolveJsonModule:true}}).outputText,file);
  const fixture=require(path.join(app,'src/lib/documents/fixtures/authored-covers.cjs')).fixtures()[2];
  const style={id:'automatic',name:'Synthetic smoke',version:1,typography:{headingFont:'Georgia',bodyFont:'Arial'},colors:{background:'#F2EFE8',text:'#202323',primary:'#A63527'},description:'Synthetic route/export fixture, not model output.',referenceAssetIds:[]};
  for(const [kind,document] of [['book',fixture.book],['presentation',fixture.deck]]){
   const dir=path.join(output,kind);fs.mkdirSync(dir);const project=(await api(`/api/cloud/workspaces/${workspace}/projects`,{title:document.title,kind,styleId:'automatic',brief:'Synthetic nonpaid route/export smoke.'})).project.id;
   const artifact=(await api(`/api/cloud/workspaces/${workspace}/projects/${project}/artifacts`,{title:document.title,kind})).artifact.id;
   await api(`/api/cloud/workspaces/${workspace}/artifacts/${artifact}/versions`,{expectedVersion:0,content:{schemaVersion:1,kind,title:document.title,sections:[],document},style,assetIds:[],changeSummary:'Synthetic fixture for route/export qualification only.'});
   const saved=(await db.query('select version_number,content,style_snapshot,change_summary from public.artifact_versions where artifact_id=$1 and version_number=1',[artifact])).rows[0];assert(saved);save(path.join(dir,'saved-version.json'),saved);checks.push(`${kind} project/artifact/save version`);
   for(const format of kind==='book'?['pdf']:['pdf','pptx']){const r=await page.request.get(`${origin}/api/cloud/workspaces/${workspace}/artifacts/${artifact}/document-export?format=${format}&version=1`,{timeout:120000});assert.equal(r.status(),200,`${kind}_${format}_EXPORT_${r.status()}`);const body=await r.body();assert(body.length>100);fs.writeFileSync(path.join(dir,`document.${format}`),body,{flag:'wx'});checks.push(`${kind} real API ${format} export`);}
   const rendered=spawnSync(process.execPath,['scripts/render-fresh-quality.cjs',app,dir],{env:childEnv,stdio:'inherit',windowsHide:true,timeout:120000});assert.equal(rendered.status,0,'SAVED_RENDERER_FAILED');save(path.join(dir,'provenance.json'),{synthetic:true,modelGenerated:false,fixture:'authored-covers/grid',providerRequests:0});checks.push(`${kind} saved-source renderer`);
  }
  report.completed=true;
 }catch(error){report.completed=false;report.failure=error instanceof assert.AssertionError?String(error.message).slice(0,220):'LOCAL_SMOKE_FAILED';process.exitCode=1;}
 finally{
  if(browser)await browser.close();if(child?.pid){const stopped=spawnSync(path.join(process.env.SystemRoot,'System32/taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});processTreeStopped=stopped.status===0;}
  try{report.ledgerUnchanged=canonical(await ledger(db))===baseline;report.limitsUnchanged=canonical((await db.query('select * from makeborne_private.live_provider_limits order by scope')).rows)===canonical(limits);if(!report.ledgerUnchanged||!report.limitsUnchanged)process.exitCode=1;}catch{report.ledgerUnchanged=null;report.limitsUnchanged=null;process.exitCode=1;}
  report.processTreeStopped=processTreeStopped;if(processTreeStopped===false)process.exitCode=1;await db.end().catch(()=>{});fs.mkdirSync(output,{recursive:true});save(path.join(output,'smoke-report.json'),report);console.log(JSON.stringify({completed:report.completed,output,checks,ledgerUnchanged:report.ledgerUnchanged,limitsUnchanged:report.limitsUnchanged,processTreeStopped,providerRequests:0}));
 }
}
