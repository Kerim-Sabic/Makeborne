// Synthetic fixtures only, against the separately isolated release database.
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
const config=JSON.parse(readFileSync('work/release-auth-stack/status.json','utf8').replace(/^\uFEFF/,''));
assert.equal(config.API_URL,'http://127.0.0.1:55435');
assert(config.DB_URL.includes('@127.0.0.1:55438/'));
const db=new pg.Client({connectionString:config.DB_URL});await db.connect();
const users=[randomUUID(),randomUUID()];const checks=[];
const insert=(client,user,id=randomUUID())=>client.query("insert into public.billing_checkouts(request_id,user_id,plan_id,return_path) values($1,$2,'plan_guardtest','/studio')",[id,user]);
try {
 const installed=await db.query("select 1 from pg_trigger where tgname='prevent_duplicate_creation_checkout'");
 if(!installed.rowCount)await db.query(readFileSync('supabase/migrations/20261012175901_prevent_duplicate_creation_checkouts.sql','utf8'));
 for(const user of users)await db.query('insert into auth.users(id,email) values($1,$2)',[user,`${user}@checkout.example.invalid`]);
 const results=await Promise.all(Array.from({length:8},async()=>{const c=new pg.Client({connectionString:config.DB_URL});await c.connect();try{await insert(c,users[0]);return 'accepted';}catch(e){return e.code;}finally{await c.end();}}));
 assert.equal(results.filter(x=>x==='accepted').length,1);assert.equal(results.filter(x=>x==='PBC02').length,7);checks.push('8 concurrent requests: exactly one checkout reservation');
 await insert(db,users[1]);checks.push('Independent account can reserve');
 const {request_id:id}=(await db.query('select request_id from public.billing_checkouts where user_id=$1',[users[0]])).rows[0];
 await assert.rejects(insert(db,users[0],id),{code:'23505'});checks.push('Same request retains idempotency conflict');
 await db.query("update public.billing_checkouts set checkout_id='ch_guardtest',status='ready' where request_id=$1",[id]);
 await db.query("insert into public.billing_memberships(membership_id,user_id,checkout_id,whop_user_id,plan_id,status) values('mem_guardtest',$1,'ch_guardtest','user_guardtest','plan_guardtest','active')",[users[0]]);
 for(const status of ['active','canceling','past_due','trialing','unknown']){
  await db.query('update public.billing_memberships set status=$1 where membership_id=\'mem_guardtest\'',[status]);
  await assert.rejects(insert(db,users[0]),{code:'PBC01'});
 }checks.push('Active, canceling, past-due and unresolved memberships block another purchase');
 for(const status of ['canceled','expired','completed']){
  await db.query('update public.billing_memberships set status=$1 where membership_id=\'mem_guardtest\'',[status]);
  const next=randomUUID();await insert(db,users[0],next);await db.query('delete from public.billing_checkouts where request_id=$1',[next]);
 }checks.push('Terminal memberships permit an explicit new purchase');
 for(const role of ['anon','authenticated','service_role']){
  const r=await db.query("select has_function_privilege($1,'makeborne_private.guard_creation_checkout()','EXECUTE') as allowed",[role]);assert.equal(r.rows[0].allowed,false);
 }checks.push('Guard function cannot be directly called by client or service roles');
 writeFileSync('docs/release-review/duplicate-checkouts.json',JSON.stringify({date:new Date().toISOString(),environment:'isolated local release database',checks,providerCalls:0,productionMutations:0,limitations:['Existing external Whop checkout links are outside the app guard.','Uncertain checkout reservations require support reconciliation before another purchase.','Cancelled then repurchased memberships are new purchases; seamless switching remains disabled.']},null,2)+'\n');
 console.log(`PASS ${checks.length} duplicate-checkout checks`);
}finally{for(const user of users)await db.query('delete from auth.users where id=$1',[user]);await db.end();}
