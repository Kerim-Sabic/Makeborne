/* eslint-disable @typescript-eslint/no-require-imports -- Offline provider-to-ledger integration contract. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const uuid='00000000-0000-4000-8000-000000000001';
const row={id:uuid,user_id:uuid,request_id:uuid,pack_id:'boost_100',catalog_version:'credit-packs-preview-2026-10-05',credits:100,price_cents:1200,
  merchant_id:'biz_Test',plan_id:'plan_Test',whop_user_id:'user_Test',checkout_id:'ch_Test',created_at:'2026-10-13 00:00:00+00'};
const original={id:'pay_Test',company:{id:'biz_Test'},plan:{id:'plan_Test'},user:{id:'user_Test'},checkout_configuration_id:'ch_Test',
  billing_reason:'one_time',currency:'usd',status:'paid',substatus:'succeeded',subtotal:12,total:12,tax_amount:null,tax_refunded_amount:null,
  refunded_amount:0,tax_behavior:'exclusive',promo_code:null,disputes:[],updated_at:'2026-10-13T00:01:00Z'};
let payment=original,lookup={purchase:row,knownPack:true},calls=[],retrievals=[];
class RequestError extends Error { constructor(code,message,status=400){super(message);this.code=code;this.status=status;} }
const mocks={
  'server-only':{},'@/lib/server/http':{RequestError},'./config':{billingConfig:()=>({companyId:'biz_Test'})},
  './database':{billingDatabase:()=>({rpc:async(name,args)=>{calls.push({name,args});return name==='makeborne_find_topup_payment'?{data:lookup,error:null}:{data:{outcome:'updated'},error:null};}})},
  './whop':{whopGet:async(url,options)=>{retrievals.push({url,options});return payment;}},
};
const cache=new Map();
function load(file){
  const filename=path.resolve(__dirname,file); if(cache.has(filename))return cache.get(filename);
  const context={exports:{},Date,JSON,BigInt,Number,Set,String,require:name=>{
    if(Object.hasOwn(mocks,name))return mocks[name];
    if(name.startsWith('@/'))return load(path.resolve(__dirname,'../..',name.slice(2))+'.ts');
    if(name.startsWith('.'))return load(path.resolve(path.dirname(filename),name)+'.ts');
    return require(name);
  }};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
  cache.set(filename,context.exports);return context.exports;
}
const {deliverTopupPayment:deliver,topupEventPaymentId:eventId,storedTopupPurchase:stored}=load('topup-delivery.ts');
async function refused(patch,code){payment={...original,...patch};calls=[];await assert.rejects(()=>deliver('pay_Test'),error=>error.code===code);assert.equal(calls.filter(x=>x.name==='makeborne_reconcile_topup').length,0);}
(async()=>{
  assert.equal(stored(row).credits,'100');
  assert.equal(eventId({type:'payment.succeeded',data:{id:'pay_Test'}}),'pay_Test');
  assert.equal(eventId({type:'refund.created',data:{payment:{id:'pay_Test'}}}),'pay_Test');
  assert.equal(eventId({type:'dispute.updated',data:{payment:{id:'pay_Test'}}}),'pay_Test');
  assert.equal(eventId({type:'membership.activated',data:{id:'pay_Test'}}),null);
  assert.equal(eventId({type:'payment.succeeded',data:{id:'pay_X/../../users'}}),null);
  await assert.rejects(()=>deliver('pay_X/../../users'));assert.equal(retrievals.length,0);
  assert.equal(await deliver('pay_Test'),true);
  assert.equal(retrievals[0].url,'/payments/pay_Test');assert.equal(retrievals[0].options.attempts,2);
  assert.equal(calls[1].name,'makeborne_reconcile_topup');assert.equal(calls[1].args.p_user,uuid);assert.equal(calls[1].args.p_payment.principalCents,'1200');
  await refused({company:{id:'biz_Other'}},'WRONG_MERCHANT');
  await refused({id:'pay_Other'},'PAYMENT_UNVERIFIED');
  await refused({user:{id:'user_Other'}},'TOPUP_DELIVERY_UNVERIFIED');
  await refused({subtotal:13,total:13},'TOPUP_DELIVERY_UNVERIFIED');
  payment=original;lookup={purchase:null,knownPack:true};
  await assert.rejects(()=>deliver('pay_Test'),error=>error.code==='TOPUP_BINDING_PENDING');
  lookup={purchase:null,knownPack:false};assert.equal(await deliver('pay_Test'),false);
  lookup={purchase:{...row,catalog_version:'unrecognized'},knownPack:true};
  await assert.rejects(()=>deliver('pay_Test'),error=>error.code==='TOPUP_DELIVERY_UNVERIFIED');
  lookup={purchase:row,knownPack:true};payment={...original,substatus:'refunded',refunded_amount:12};calls=[];
  assert.equal(await deliver('pay_Test'),true);assert.equal(calls[1].args.p_payment.status,'refunded');
  console.log('PASS: trusted retrieval, immutable purchase mapping, one-time delivery, support/unknown payments, binding retries, refund delivery and malformed/mismatched evidence');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
