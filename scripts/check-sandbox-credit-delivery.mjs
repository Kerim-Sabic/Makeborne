// Real Whop sandbox + isolated Postgres only. No live merchant or database.
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import pg from 'pg';
const root='work/release-auth-stack/';
const config=JSON.parse(readFileSync(root+'whop-sandbox.json','utf8'));
const local=JSON.parse(readFileSync(root+'status.json','utf8').replace(/^\uFEFF/,''));
const fixture=JSON.parse(readFileSync(root+'billing-fixture.json','utf8'));
assert.equal(config.apiBase,'https://sandbox-api.whop.com/api/v1');assert.equal(config.companyId,'biz_e4w3EGe3izP67k');
assert.equal(local.API_URL,'http://127.0.0.1:55435');assert(local.DB_URL.includes('@127.0.0.1:55438/'));
const db=new pg.Client({connectionString:local.DB_URL});await db.connect();
try{
 const memberships=(await db.query('select membership_id,plan_id,status from public.billing_memberships where user_id=$1',[fixture.userId])).rows;
 const annual=memberships.find(m=>m.plan_id==='plan_9B9KMOqqdJXv4');assert(annual);
 const grants=(await db.query("select delta,metadata->>'interval' cadence,metadata->>'allocation' allocation from public.credit_ledger where user_id=$1 and kind='plan_grant'",[fixture.userId])).rows;
 assert.equal(grants.filter(g=>g.cadence==='yearly').length,1);assert.equal(grants.find(g=>g.cadence==='yearly').delta,'300');
 const response=await fetch(config.apiBase+'/memberships/'+annual.membership_id,{headers:{Authorization:'Bearer '+config.apiKey,'Api-Version-Date':'2025-01-01'}});assert(response.ok);const provider=await response.json();
 assert.equal(provider.company.id,config.companyId);assert.equal(provider.plan.id,annual.plan_id);
 assert(provider.renewal_period_start&&provider.renewal_period_end);writeFileSync(root+'annual-membership.json',JSON.stringify(provider));
 const unauthorized=await fetch('http://127.0.0.1:3048/api/cron/billing-reconcile');assert.equal(unauthorized.status,401);
 // Make only this disposable user's observations due for a real provider refresh.
 // recorded_at is ingestion metadata, not entitlement time (observed_at).
 await db.query("update makeborne_private.plan_observations set recorded_at=now()-interval '21 hours' where user_id=$1",[fixture.userId]);
 const job=await fetch('http://127.0.0.1:3048/api/cron/billing-reconcile',{headers:{Authorization:'Bearer '+config.cronSecret}});const result=await job.json();assert.equal(job.status,200,JSON.stringify(result));assert.equal(result.status,'succeeded',JSON.stringify(result));assert.equal(result.stats.processed,2);assert.equal(result.stats.observationsGranted,0);
 const count=(await db.query("select count(*)::int n from public.credit_ledger where user_id=$1 and kind='plan_grant'",[fixture.userId])).rows[0].n;assert.equal(count,2);
 const delivery=JSON.parse(readFileSync('docs/release-review/whop-credit-delivery.json','utf8'));
 Object.assign(delivery,{annualPurchase:{providerPeriodStart:provider.renewal_period_start,providerPeriodEnd:provider.renewal_period_end,initialAllocation:300,allocationCount:1,newMembershipId:true},realProviderReconcile:result,unauthorizedCron:unauthorized.status,notVerified:['Actual subsequent Whop renewal payment (no sandbox time-advance control found)','In-place upgrade/downgrade (not offered by customer portal)','Replacement allowance policy; separate new purchases still receive separate allowances']});
 writeFileSync('docs/release-review/whop-credit-delivery.json',JSON.stringify(delivery,null,2));
 console.log('PASS annual initial allocation, actual provider period, authenticated real-provider reconciliation, no duplicate grants');
}finally{await db.end()}
