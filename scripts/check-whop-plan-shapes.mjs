// Read-only provider contract observation. Never creates plans or checkouts.
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const config=JSON.parse(readFileSync('work/release-auth-stack/whop-sandbox.json','utf8').replace(/^\uFEFF/,''));
assert.equal(config.apiBase,'https://sandbox-api.whop.com/api/v1');
assert.equal(config.companyId,'biz_e4w3EGe3izP67k');
const observations=[];
for(const id of ['plan_00mHHGVMtYzRL','plan_9B9KMOqqdJXv4']){
 const response=await fetch(`${config.apiBase}/plans/${id}`,{headers:{Authorization:`Bearer ${config.apiKey}`,'Api-Version-Date':'2025-01-01'},redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error(`Sandbox plan read failed (${response.status}); no provider response or credential logged`);
 const p=await response.json();assert.equal(p.id,id);assert.equal(p.company?.id,config.companyId);
 observations.push({id:p.id,companyId:p.company.id,currency:p.currency,planType:p.plan_type,billingPeriod:p.billing_period,
  initialPrice:p.initial_price,renewalPrice:p.renewal_price,trialPeriodDays:p.trial_period_days,releaseMethod:p.release_method,stock:p.stock,unlimitedStock:p.unlimited_stock,
  requiredFieldsPresent:['currency','plan_type','billing_period','initial_price','renewal_price','trial_period_days','release_method','stock','unlimited_stock'].every(key=>Object.hasOwn(p,key))});
}
const report={observedAt:new Date().toISOString(),apiVersion:'2025-01-01',sandboxOnly:true,readOnly:true,realMoneySpent:0,observations,
 limitations:['These existing test plans do not establish production catalogue prices or purchasability.','No checkout, signed notification, credit delivery, renewal or plan replacement is exercised.']};
writeFileSync('docs/release-review/whop-plan-shapes-20261013.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
