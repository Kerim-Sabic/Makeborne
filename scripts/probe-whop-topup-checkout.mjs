// Sandbox configuration probe only; never submits card details or a purchase.
// Default is read-only. --prepare creates a hidden one-time plan and checkout.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const config=JSON.parse(fs.readFileSync('work/release-auth-stack/whop-sandbox.json','utf8').replace(/^\uFEFF/,''));
assert.equal(config.apiBase,'https://sandbox-api.whop.com/api/v1');
assert.equal(config.companyId,'biz_e4w3EGe3izP67k');
const file='docs/release-review/whop-topup-checkout-probe.json';
const record=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{sandboxOnly:true,productionTouched:false,realMoneySpent:0,requestId:randomUUID(),planId:null,observations:[]};
const save=()=>fs.writeFileSync(file,JSON.stringify(record,null,2)+'\n');
async function api(path,body,key,version='2025-01-01'){
  const response=await fetch(config.apiBase+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${config.apiKey}`,'Api-Version-Date':version,
    ...(body?{'Content-Type':'application/json','Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok){
    const error=await response.json().catch(()=>null);
    const message=typeof error?.error?.message==='string'?error.error.message:typeof error?.message==='string'?error.message:'Unspecified validation error';
    // Probe requests carry only synthetic IDs/product data; still remove the key
    // if a provider ever echoes it. Never log response bodies or headers.
    throw new Error(`Sandbox ${path} returned ${response.status}: ${message.replaceAll(config.apiKey,'[redacted]').slice(0,300)}`);
  }
  return response.json();
}
if(!process.argv.includes('--prepare')){
  console.log('Read-only: sandbox target verified; --prepare is required for a hidden one-time checkout probe.');
  process.exit(0);
}
save();
if(!record.planId){
  const plan=await api('/variants',{product_id:'prod_CDLOn3W9hruAI',visibility:'hidden',release_method:'buy_now',currency:'usd',
    title:'Makeborne pack test',plan_type:'one_time',initial_price:12,renewal_price:0},`topup-plan-${record.requestId}-v2`,'2026-10-09-2');
  assert.match(plan.id,/^plan_[A-Za-z0-9]+$/);record.planId=plan.id;save();
}
const plan=await api(`/plans/${record.planId}`);
assert.equal(plan.plan_type,'one_time');assert.equal(plan.currency,'usd');assert.equal(plan.initial_price,12);
assert.equal(plan.company?.id??plan.account?.id,config.companyId);
const body={plan_id:record.planId,mode:'payment',metadata:{makeborne_topup_probe:record.requestId},redirect_url:'https://sandbox.whop.com/'};
const key=`makeborne-topup-probe-${record.requestId}`;
for(let i=0;i<2;i++){
  const checkout=await api('/checkout_configurations',body,key);
  assert.match(checkout.id,/^ch_[A-Za-z0-9]+$/);assert.equal(checkout.company_id,config.companyId);assert.equal(checkout.plan?.id,record.planId);
  assert.equal(new URL(checkout.purchase_url).origin,'https://sandbox.whop.com');
  record.observations.push({at:new Date().toISOString(),apiVersion:'2025-01-01',idempotencyKey:key,checkoutId:checkout.id,purchaseUrl:checkout.purchase_url});save();
}
const latest=record.observations.slice(-2);
record.sameCheckout=latest[0].checkoutId===latest[1].checkoutId;record.checkedAt=new Date().toISOString();save();
assert.equal(record.sameCheckout,true,'Same explicit key/body must return the same pinned-version checkout');
console.log('PASS: hidden $12 one-time sandbox plan verified; repeated keyed POST returned the same checkout. No purchase submitted.');
