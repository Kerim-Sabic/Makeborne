/* eslint-disable @typescript-eslint/no-require-imports -- Offline provider contract tests. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
let response, requests = [];
const cache = new Map();
function load(file) {
  const filename = path.resolve(__dirname, file);
  if (cache.has(filename)) return cache.get(filename);
  const context = { exports: {}, BigInt, Date, JSON, Number, Set, String, require: name => {
    if (name === 'server-only') return {};
    if (name === './whop') return { whopGet: async (url, options) => { requests.push({url, options}); return response; } };
    if (name.startsWith('@/')) return load(path.resolve(__dirname, '../..', name.slice(2)) + '.ts');
    if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name) + '.ts');
    return require(name);
  } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  cache.set(filename, context.exports);
  return context.exports;
}
const { providerUsdCents, normalizeWhopTopupPayment: normalize, retrieveVerifiedTopupPayment: retrieve } = load('topup-fulfillment.ts');
const { CREDIT_TOPUP_CATALOG_VERSION } = load('topups-catalog.ts');
const { reconcileCreditTopup: reconcile } = load('topups-reconcile.ts');
const uuid = '00000000-0000-4000-8000-000000000001';
const purchase = { id: uuid, requestId: uuid, userId: uuid, creditAccountId: uuid, packId: 'boost_100', catalogVersion: CREDIT_TOPUP_CATALOG_VERSION,
  credits: '100', priceCents: '1200', currency: 'usd', merchantId: 'biz_test', planId: 'plan_test', checkoutId: 'ch_test', whopUserId: 'user_test', createdAt: '2026-10-13T00:00:00Z' };
const payment = { id: 'pay_test', company: {id:'biz_test'}, plan: {id:'plan_test'}, user: {id:'user_test'}, checkout_configuration_id:'ch_test',
  billing_reason:'one_time', currency:'usd', status:'paid', substatus:'succeeded', subtotal:12, total:12, tax_amount:null, tax_refunded_amount:null,
  refunded_amount:0, tax_behavior:'exclusive', promo_code:null, disputes:[], updated_at:'2026-10-13T00:01:00Z' };
assert.equal(providerUsdCents(12.99),1299n);
assert.equal(providerUsdCents('0.01'),1n);
for(const bad of [1.234,'01.00','1e3',NaN,Infinity,-1,'-1','12.0001',null,undefined]) assert.throws(()=>providerUsdCents(bad));
const normalized = normalize(purchase,payment);
assert.throws(()=>normalize({...purchase,catalogVersion:'unrecognized-history'},payment));
assert.throws(()=>normalize({...purchase,priceCents:'1300'},payment));
assert.equal(normalized.principalCents,'1200');
const first = reconcile(purchase,null,normalized);
assert.equal(first.effects[0].credits,'100');
assert.equal(reconcile(purchase,first.state,normalized).effects.length,0);
for(const patch of [{company:{id:'biz_other'}},{plan:{id:'plan_other'}},{user:{id:'user_other'}},{checkout_configuration_id:'ch_other'},
 {currency:'eur'},{billing_reason:'subscription_cycle'},{subtotal:1,total:1},{total:12.01},{tax_amount:1,total:13},{tax_refunded_amount:1},
 {refunded_amount:12.01},{substatus:'refunded',refunded_amount:0},{substatus:'pending'},{substatus:'failed'},
 {promo_code:{id:'promo_test'}},{disputes:null},{disputes:undefined},{disputes:[{status:'unknown'}]},{substatus:'unexpected'},{user:null},{updated_at:'bad'},
 {status:'failed',substatus:'succeeded'},{status:'pending',substatus:'refunded'},
 {substatus:'unknown',disputes:[{status:'won'}]}]) assert.throws(()=>normalize(purchase,{...payment,...patch}));
const refund = normalize(purchase,{...payment,substatus:'refunded',refunded_amount:12,updated_at:'2026-10-13T00:02:00Z'});
assert.equal(refund.status,'refunded');
assert.equal(reconcile(purchase,first.state,refund).effects[0].kind,'reversal');
const partial=normalize(purchase,{...payment,substatus:'partially_refunded',refunded_amount:1,updated_at:'2026-10-13T00:02:00Z'});
assert.equal(reconcile(purchase,first.state,partial).state.status,'held');
assert.equal(normalize(purchase,{...payment,disputes:[{status:'won'},{status:'needs_response'}]}).dispute,'open');
assert.equal(normalize(purchase,{...payment,substatus:'dispute_lost',disputes:[{status:'won'}]}).dispute,'lost');
assert.equal(normalize(purchase,{...payment,substatus:'open_dispute',disputes:[{status:'won'}]}).dispute,'open');
assert.equal(normalize(purchase,{...payment,status:'failed',substatus:'failed'}).status,'failed');
async function run() {
  response=payment;
  assert.equal((await retrieve(purchase,'pay_test')).id,'pay_test');
  assert.equal(requests[0].url,'/payments/pay_test');
  assert.equal(requests[0].options.attempts,2);
  const count=requests.length;
  await assert.rejects(retrieve(purchase,'../../users'));
  assert.equal(requests.length,count);
  response={...payment,id:'pay_other'};
  await assert.rejects(retrieve(purchase,'pay_test'));
  console.log('PASS top-up provider evidence: exact money, one-time ownership, refund/dispute safety, retrieval binding. No network or grants performed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
