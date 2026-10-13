// Real browser -> local Auth/email -> Next routes -> local PostgREST/Postgres.
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
const status=JSON.parse(readFileSync('work/release-auth-stack/status.json','utf8').replace(/^\uFEFF/,''));
assert.equal(status.API_URL,'http://127.0.0.1:55435');assert(status.DB_URL.includes('@127.0.0.1:55438/'));
const db=new pg.Client({connectionString:status.DB_URL});await db.connect();
const admin=createClient(status.API_URL,status.SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const email=`release-${randomUUID()}@example.invalid`,password=`Local-only-${randomUUID()}!`;
const browser=await chromium.launch({headless:true});const context=await browser.newContext();
await context.route('**/*',route=>{const u=new URL(route.request().url());return ['localhost','127.0.0.1'].includes(u.hostname)||u.protocol==='data:'?route.continue():route.abort()});
const page=await context.newPage();let stage='signup',userId,uploadedPath;const passed=[];
async function api(path,body,method='POST',extra={}) {
 return page.evaluate(async({path,body,method,extra})=>{const r=await fetch(path,{method,headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID(),'x-makeborne-crm-protocol':'2',...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json()}},{path,body,method,extra});
}
try {
 await page.goto('http://localhost:3048/login?mode=signup');
 await page.locator('#account-email').fill(email);await page.locator('#account-password').fill(password);
 await page.getByRole('button',{name:'Create account',exact:true}).click();
 await page.getByRole('heading',{name:'Check your inbox'}).waitFor({timeout:20000});passed.push('Browser signup and confirmation screen');
 stage='branded email';let message;
 for(let i=0;i<20;i++) {const inbox=await fetch('http://127.0.0.1:55440/api/v1/messages').then(r=>r.json());const found=inbox.messages?.find(m=>m.To?.some(t=>t.Address===email));if(found){message=await fetch(`http://127.0.0.1:55440/api/v1/message/${found.ID}`).then(r=>r.json());break}await new Promise(r=>setTimeout(r,300))}
 assert(message,'Confirmation email missing from local inbox');assert(message.HTML.includes('Makeborne'),'Branded template missing');
 const href=message.HTML.match(/href="([^"]*\/auth\/confirm\?[^"]+)"/)?.[1]?.replaceAll('&amp;','&');assert(href,'Confirmation link missing');
 const target=new URL(href);assert(['127.0.0.1','localhost'].includes(target.hostname));target.hostname='localhost';
 userId=(await db.query('select id from auth.users where email=$1',[email])).rows[0]?.id;assert(userId);
 assert.equal((await db.query('select email_confirmed_at from auth.users where id=$1',[userId])).rows[0].email_confirmed_at,null);
 await page.goto(target.href);assert.equal((await db.query('select email_confirmed_at from auth.users where id=$1',[userId])).rows[0].email_confirmed_at,null,'GET scanner consumed token');
 stage='confirm';await page.getByRole('button',{name:'Confirm my email'}).click();await page.getByRole('heading',{name:'Email confirmed',exact:true}).waitFor({timeout:15000});
 passed.push('Branded local email; scanner-safe GET; deliberate confirmation sets session');
 stage='unpaid gate';const denied=await api('/api/workspaces',{name:'Must not create'});assert.equal(denied.status,402,JSON.stringify(denied));
 assert.equal((await db.query('select count(*)::int n from public.credit_ledger where user_id=$1',[userId])).rows[0].n,0);passed.push('Confirmed unpaid account denied creation; no trial credits');
 await db.query("insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values($1,true,false,'Isolated browser fixture')",[userId]);
 stage='workspace';const ws=await api('/api/workspaces',{name:'Browser staging workspace'});assert.equal(ws.status,201,JSON.stringify(ws));const wid=ws.body.workspace.id;
 stage='CRM';const client=await api(`/api/cloud/workspaces/${wid}/clients`,{name:'Staging customer',notes:'Preserve this brief'});assert.equal(client.status,201,JSON.stringify(client));
 const project=await api(`/api/cloud/workspaces/${wid}/projects`,{title:'Staging website',kind:'website',clientId:client.body.client.id});assert.equal(project.status,201,JSON.stringify(project));
 const changed=await api(`/api/cloud/workspaces/${wid}/projects/${project.body.project.id}`,{deliveryStage:'in_review',expectedUpdatedAt:project.body.project.updatedAt},'PATCH');assert.equal(changed.status,200,JSON.stringify(changed));
 const row=(await db.query('select outreach from public.clients where id=$1',[client.body.client.id])).rows[0];assert.equal(row.outreach,null,'Project delivery change wrote client outreach');
 passed.push('Authenticated workspace/client/project creation; project delivery update preserves client sales stage');
 await page.goto(`http://localhost:3048/studio?tab=clients&workspace=${wid}`);await page.waitForLoadState('networkidle');assert(!page.url().includes('/login'));
 passed.push('Signed-in studio renders');
 stage='private storage';
 const signed=createClient(status.API_URL,status.PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const signedIn=await signed.auth.signInWithPassword({email,password});assert(!signedIn.error);
 const uploaded=await signed.storage.from('project-assets').upload(`${wid}/${randomUUID()}.png`,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVuoAAAAASUVORK5CYII=','base64'),{contentType:'image/png'});
 assert(!uploaded.error,uploaded.error?.message);uploadedPath=uploaded.data.path;
 assert(!(await signed.storage.from('project-assets').download(uploadedPath)).error);
 const outsider=createClient(status.API_URL,status.PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 assert((await outsider.storage.from('project-assets').download(uploadedPath)).error,'Anonymous reader accessed private image');
 assert((await signed.storage.from('project-assets').upload(`${randomUUID()}/foreign.png`,Buffer.from('no'),{contentType:'image/png'})).error,'Foreign workspace upload accepted');
 passed.push('Real storage upload/download; anonymous read and foreign-workspace write denied');
 stage='saved document exports';
 const theme={fonts:'editorial',palette:{background:'#FAFAF8',surface:'#FFFFFF',ink:'#172121',muted:'#555555',accent:'#335544',accent2:'#AA6644',dark:'#172121'}};
 const style={id:'editorial',name:'Editorial',version:1,typography:{headingFont:'Georgia',bodyFont:'Arial'},colors:{ink:'#172121'},description:'Staging fixture',referenceAssetIds:[]};
 for(const kind of ['book','presentation']) {
  const doc={kind:kind==='book'?'book':'deck',schemaVersion:1,title:`Staging ${kind}`,theme,assets:[],...(kind==='book'?{chapters:[{id:'chapter-one',title:'A useful brief',text:'Keep the source and the next action together.'}]}:{slides:[{id:'slide-one',layout:'statement',title:'A useful brief',notes:'Explain the project clearly.'}]})};
  const p=await api(`/api/cloud/workspaces/${wid}/projects`,{title:doc.title,kind});assert.equal(p.status,201,JSON.stringify(p));
  const a=await api(`/api/cloud/workspaces/${wid}/projects/${p.body.project.id}/artifacts`,{title:doc.title,kind});assert.equal(a.status,201,JSON.stringify(a));
  const aid=a.body.artifact.id;
  const saved=await api(`/api/cloud/workspaces/${wid}/artifacts/${aid}/versions`,{expectedVersion:0,content:{schemaVersion:1,title:doc.title,kind,sections:[],document:doc},style,assetIds:[],changeSummary:'Staging save'});
  assert.equal(saved.status,201,JSON.stringify(saved));
  for(const format of kind==='book'?['pdf']:['pdf','pptx']) {
   const result=await page.evaluate(async path=>{const r=await fetch(path);const bytes=new Uint8Array(await r.arrayBuffer());return {status:r.status,size:bytes.length,header:Array.from(bytes.slice(0,4)),error:r.ok?null:new TextDecoder().decode(bytes)}},`/api/cloud/workspaces/${wid}/artifacts/${aid}/document-export?format=${format}`);
   assert.equal(result.status,200,JSON.stringify(result));assert(result.size>500);
   assert.equal(result.header[0],format==='pdf'?37:80,'Invalid export signature');
  }
 }
 passed.push('Saved live-document sources export through authenticated HTTP to book PDF and deck PDF/PPTX');
 stage='fresh sign-in';const signin=await browser.newPage();await signin.goto('http://localhost:3048/login');await signin.locator('#account-email').fill(email);await signin.locator('#account-password').fill(password);await signin.getByRole('button',{name:'Sign in',exact:true}).click();await signin.waitForURL(u=>!u.pathname.includes('/login'),{timeout:15000});passed.push('Password sign-in in a fresh browser session');
 console.log(`PASS ${passed.length} real browser/Auth checks`);
} catch(e) {console.error(`FAIL ${stage}: ${String(e.message).slice(0,900)}`);process.exitCode=1}
finally {
 writeFileSync('docs/release-review/auth-staging-results.json',JSON.stringify({passed,failedStage:process.exitCode?stage:null,externalEmailSent:false,productionTouched:false},null,2));
 // Exact generated account only, in the guarded isolated database.
 if(uploadedPath) {const removed=await admin.storage.from('project-assets').remove([uploadedPath]);assert(!removed.error,'Fixture storage cleanup failed')}
 await db.query('delete from makeborne_private.cloud_mutation_receipts where actor_id in(select id from auth.users where email=$1)',[email]);
 await db.query('delete from public.workspaces where owner_id in(select id from auth.users where email=$1)',[email]);
 await db.query('delete from auth.users where email=$1',[email]);await browser.close();await db.end();
}
