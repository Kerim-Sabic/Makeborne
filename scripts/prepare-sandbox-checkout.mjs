// Creates only a local test account and a fake-money Whop sandbox checkout.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
import {chromium} from 'playwright';
const root='work/release-auth-stack/';
const planId=process.argv[2]??'plan_00mHHGVMtYzRL';assert(['plan_00mHHGVMtYzRL','plan_9B9KMOqqdJXv4'].includes(planId));
const local=JSON.parse(readFileSync(root+'status.json','utf8').replace(/^\uFEFF/,''));
const sandbox=JSON.parse(readFileSync(root+'whop-sandbox.json','utf8'));
assert.equal(local.API_URL,'http://127.0.0.1:55435');assert(local.DB_URL.includes('@127.0.0.1:55438/'));
assert.equal(sandbox.apiBase,'https://sandbox-api.whop.com/api/v1');assert.equal(sandbox.companyId,'biz_e4w3EGe3izP67k');
const db=new pg.Client({connectionString:local.DB_URL});await db.connect();
const admin=createClient(local.API_URL,local.SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
let fixture=existsSync(root+'billing-fixture.json')?JSON.parse(readFileSync(root+'billing-fixture.json','utf8')):null;
if(!fixture){
 fixture={email:`whop-sandbox-${randomUUID()}@example.invalid`,password:`Test-${randomUUID()}!`,requestId:randomUUID()};
 const created=await admin.auth.admin.createUser({email:fixture.email,password:fixture.password,email_confirm:true});assert(!created.error,created.error?.message);fixture.userId=created.data.user.id;
 fixture.previousBillingSettings=(await db.query('select * from makeborne_private.billing_settings')).rows;
 writeFileSync(root+'billing-fixture.json',JSON.stringify(fixture,null,2));
}
await db.query('update makeborne_private.billing_settings set creation_enabled=true where singleton');
await db.query("insert into makeborne_private.billing_access_plans(plan_id,enabled) values($1,true) on conflict(plan_id) do update set enabled=true",[planId]);
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext();await context.route('**/*',r=>['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 const page=await context.newPage();await page.goto('http://localhost:3048/login');await page.locator('#account-email').fill(fixture.email);await page.locator('#account-password').fill(fixture.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(u=>!u.pathname.includes('/login'),{timeout:20000});
 const result=await page.evaluate(async({requestId,planId})=>{const r=await fetch('/api/billing/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({planId,requestId,next:'/studio'})});return {status:r.status,body:await r.json()}},{requestId:fixture.requestId,planId});
 assert.equal(result.status,200,JSON.stringify(result));assert.equal(new URL(result.body.url).origin,'https://sandbox.whop.com');
 fixture.checkoutUrl=result.body.url;await context.storageState({path:root+'billing-browser-state.json'});writeFileSync(root+'billing-fixture.json',JSON.stringify(fixture,null,2));console.log('PASS authenticated local checkout prepared; sandbox URL stored locally');
}finally{await browser.close();await db.end()}
