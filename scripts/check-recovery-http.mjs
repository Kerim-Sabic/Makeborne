import assert from 'node:assert/strict';
const base=new URL(process.argv[2]??'http://localhost:3049');
assert(['localhost','127.0.0.1'].includes(base.hostname),'Local fixture only');
for(const route of ['/api/build','/api/build/plan','/api/credits','/api/generate','/api/cron/billing-reconcile','/api/github/callback','/api/cloud/workspaces/test','/api/billing/checkout','/api/hosting/enquiries']) {
 for(const method of ['GET','POST']) {
  const response=await fetch(new URL(route,base),{method,redirect:'manual',signal:AbortSignal.timeout(10000)});
  assert.equal(response.status,503,`${method} ${route}`);
  assert.equal((await response.json()).error.code,'RELEASE_MAINTENANCE');
  assert.equal(response.headers.get('Retry-After'),'60');
 }
}
for(const route of ['/api/billing/webhook','/api/billing/whop-events']) {
 const response=await fetch(new URL(route,base),{method:'POST',body:'{}',signal:AbortSignal.timeout(10000)});
 assert.notEqual((await response.json()).error.code,'RELEASE_MAINTENANCE','Signed handler must receive event');
 assert(response.status>=400,'Unsigned financial event must fail');
}
assert.equal((await fetch(base,{signal:AbortSignal.timeout(10000)})).status,200);
console.log('PASS HTTP recovery build: 18 API requests blocked, unsigned webhooks reach verifier and fail, public home available');
