// Narrow follow-up on an existing synthetic smoke fixture, never generation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
import {chromium} from 'playwright';
import {ROOT,COPY_ENTRIES,sourceInventory,localConfig,cleanEnv,ledger,canonical,json,save} from './fresh-quality-common.mjs';
const id=process.argv[2];assert.match(id,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
const local=localConfig(),app=path.resolve('work/fresh-quality-smoke',id,'app'),output=path.resolve('outputs',`fresh-quality-smoke-${id}`),origin='http://127.0.0.1:3069';assert(json(path.join(output,'smoke-report.json')).completed);
const db=new pg.Client({connectionString:local.DB_URL}),env=cleanEnv(local,''),browserEnv={...env};delete browserEnv.SUPABASE_SECRET_KEY;delete browserEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
let child,browser,baseline,limits;const report={synthetic:true,modelGenerated:false,providerRequests:0,checks:[]};
try{
 await db.connect();baseline=canonical(await ledger(db));limits=(await db.query('select * from makeborne_private.live_provider_limits order by scope')).rows;assert(limits.every(row=>!row.enabled));
 await new Promise((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(3069,'127.0.0.1',()=>s.close(resolve));});
 report.sourceHashes=sourceInventory();for(const entry of COPY_ENTRIES)if(fs.existsSync(entry)){fs.mkdirSync(path.dirname(path.join(app,entry)),{recursive:true});fs.cpSync(entry,path.join(app,entry),{recursive:true,preserveTimestamps:true});}assert.equal(canonical(sourceInventory(app)),canonical(report.sourceHashes));
 const config=path.join(app,'next.config.ts');fs.writeFileSync(config,fs.readFileSync(config,'utf8').replace('const nextConfig: NextConfig = {','const nextConfig: NextConfig = {\n distDir: ".next-quality-smoke",'));
 const email=`quality-smoke-${id}@example.invalid`,users=(await db.query('select id from auth.users where email=$1',[email])).rows;assert.equal(users.length,1);const password=`Smoke-Jump-${randomUUID()}!`;
 const auth=createClient(local.API_URL,local.SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});assert(!(await auth.auth.admin.updateUserById(users[0].id,{password})).error);
 const workspaces=(await db.query('select id from public.workspaces where name=$1',['Synthetic route smoke '+id])).rows;assert.equal(workspaces.length,1);const workspace=workspaces[0].id;
 const artifacts=(await db.query('select id,kind from public.artifacts where workspace_id=$1 and current_version=1',[workspace])).rows;assert.equal(artifacts.length,2);
 const reviewerEmail=`quality-reviewer-${randomUUID()}@example.invalid`,reviewerPassword=`Reviewer-${randomUUID()}!`,reviewer=await auth.auth.admin.createUser({email:reviewerEmail,password:reviewerPassword,email_confirm:true});assert(!reviewer.error&&reviewer.data.user);
 await db.query("insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values($1,false,true,'Local reviewer UI smoke only')",[reviewer.data.user.id]);await db.query("insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'reviewer')",[workspace,reviewer.data.user.id]);
 const log=fs.openSync(path.resolve('work/fresh-quality-smoke',id,'jump-server.log'),'a');child=spawn(process.execPath,[path.join(ROOT,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','3069'],{cwd:app,env,stdio:['ignore',log,log],windowsHide:true});fs.closeSync(log);
 const deadline=Date.now()+90000;let ready=false;while(!ready&&Date.now()<deadline){try{ready=(await fetch(origin+'/login',{signal:AbortSignal.timeout(2000)})).ok;}catch{}if(!ready)await new Promise(resolve=>setTimeout(resolve,1000));}assert(ready);
 browser=await chromium.launch({headless:true,env:browserEnv});for(const person of [{role:'owner',email,password},{role:'reviewer',email:reviewerEmail,password:reviewerPassword}]){const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await page.route('**/*',route=>{const u=new URL(route.request().url());return [origin,local.API_URL].includes(u.origin)?route.continue():route.abort();});
 await page.goto(origin+'/login');await page.locator('#account-email').fill(person.email);await page.locator('#account-password').fill(person.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(u=>!u.pathname.includes('/login'));
 for(const artifact of artifacts){await page.goto(`${origin}/studio?tab=projects&workspace=${workspace}&artifact=${artifact.id}`);const label=artifact.kind==='book'?'Book preview':'Presentation preview';await page.locator(`iframe[title="${label}"]`).waitFor({timeout:90000});const frame=page.frameLocator(`iframe[title="${label}"]`);
  if(artifact.kind==='book'){assert.equal(await page.getByRole('combobox',{name:'Go to chapter',exact:true}).count(),0);report.checks.push({role:person.role,kind:'book',menu:'absent as expected: one synthetic chapter; multi-chapter jump unqualified'});}
  else{const menu=page.getByRole('combobox',{name:'Go to slide',exact:true});await menu.waitFor();const target=await menu.locator('option').last().getAttribute('value');assert(target);await menu.selectOption(target);const top=await frame.locator('#'+target).evaluate(el=>el.getBoundingClientRect().top);assert(Math.abs(top)<3,`JUMP_TARGET_TOP_${top}`);report.checks.push({role:person.role,kind:'presentation',menu:'selected last slide',target,top});}
  if(person.role==='reviewer')assert.equal(await page.locator('.cloud-workbench').getByRole('button',{name:'Edit',exact:true}).count(),0);
  await page.screenshot({path:path.join(output,`${person.role}-${artifact.kind}-saved-ui.png`),fullPage:true});
 }await page.close();}report.completed=true;
}catch(error){report.completed=false;report.failure=error instanceof assert.AssertionError?String(error.message).slice(0,220):'JUMP_UI_CHECK_FAILED';process.exitCode=1;}
finally{if(browser)await browser.close();if(child?.pid){report.processTreeStopped=spawnSync(path.join(process.env.SystemRoot,'System32/taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true}).status===0;if(!report.processTreeStopped)process.exitCode=1;}try{report.ledgerUnchanged=canonical(await ledger(db))===baseline;report.limitsUnchanged=canonical((await db.query('select * from makeborne_private.live_provider_limits order by scope')).rows)===canonical(limits);assert(report.ledgerUnchanged&&report.limitsUnchanged);}catch{process.exitCode=1;}await db.end().catch(()=>{});save(path.join(output,'jump-ui-report.json'),report);console.log(JSON.stringify(report));}
