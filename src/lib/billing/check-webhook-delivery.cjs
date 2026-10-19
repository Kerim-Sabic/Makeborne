/* eslint-disable @typescript-eslint/no-require-imports -- Offline financial-delivery regression. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
class RequestError extends Error {constructor(code,message,status){super(message);this.code=code;this.status=status}}
let checkout=null,recorded=false,grantFails=false,reads=0,receipts=0,topupCalls=0,topupFails=false;
const observations=[],order=[],paymentReads=[];let paymentFails=false,paymentMembership='mem_fixture';
const membership={id:'mem_fixture',company:{id:'biz_fixture'},plan:{id:'plan_fixture'},user:{id:'user_fixture'},checkout_configuration_id:'ch_fixture',status:'active',renewal_period_start:new Date().toISOString(),renewal_period_end:new Date(Date.now()+86400000).toISOString()};
const db={from(table){const q={select(){return q},eq(){return q},async maybeSingle(){return {error:null,data:table==='billing_webhook_events'?(recorded?{id:'event'}:null):table==='billing_checkouts'?checkout:{membership_id:membership.id}}}};return q},async rpc(){receipts++;recorded=true;return {error:null}}};
const modules={
 'server-only':{},'@/lib/server/http':{RequestError},'./config':{billingConfig:()=>({apiKey:'fixture',secretKey:'fixture',companyId:'biz_fixture',accessPlanIds:['plan_fixture']})},
 './database':{billingDatabase:()=>db},'./plan-credits':{creditRuleFor:()=>({})},
 './topup-delivery':{topupEventPaymentId:e=>e.data.id==='pay_pack'?'pay_pack':null,deliverTopupPayment:async()=>{topupCalls++;if(topupFails)throw new RequestError('TOPUP_BINDING_PENDING','Retry',503);return true}},
 './whop':{retrieveMembership:async()=>{reads++;return membership},activeMembership:m=>m.status==='active',retrievePaymentMembership:async()=>membership.id},
 '@/lib/credits/server':{recordPlanObservation:async(user,observation)=>{if(grantFails)throw new Error('transient SQL error');observations.push({user,...observation});order.push('observation')}},
 './plan-payments':{
  eventPaymentId:e=>e.type.startsWith('payment.')?(e.data.id??null):(e.data.payment?.id??null),
  retrieveVerifiedPlanPayment:async id=>{paymentReads.push(id);return {id,membershipId:paymentMembership,status:'refunded'}},
  reconcilePlanPayment:async(user,m,payment)=>{if(paymentFails)throw new RequestError('PLAN_PAYMENT_STORAGE_UNAVAILABLE','Retry',503);order.push(`payment:${user}:${m.id}:${payment.id}`)},
 },
};
const ctx={exports:{},Buffer,Date,process:{env:{MAKEBORNE_BILLING_MIGRATIONS_VERIFIED:'true'}},require:name=>modules[name]??require(name)};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('./webhook.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);
const event={id:'event',type:'payment.succeeded',account_id:'biz_fixture',data:{membership:{id:'mem_fixture'}}};
(async()=>{
 const reconcile=ctx.exports.reconcileWhopEvent;
 await assert.rejects(reconcile(event),e=>e.code==='CHECKOUT_BINDING_PENDING'&&e.status===503);assert.equal(receipts,0);
 checkout={user_id:'account_fixture',plan_id:'plan_other'};
 await assert.rejects(reconcile(event),e=>e.code==='CHECKOUT_PLAN_MISMATCH');assert.equal(receipts,0);
 checkout.plan_id='plan_fixture';grantFails=true;
 await assert.rejects(reconcile(event),/transient SQL/);assert.equal(receipts,1);
 grantFails=false;await reconcile(event);assert.equal(receipts,1);assert.equal(observations.length,1);
 membership.status='canceled';await reconcile(event);
 assert.equal(observations.at(-1).paid,false,'Old success event must consult current cancellation');
 assert.equal(observations.at(-1).status,'canceled');assert.equal(receipts,1);assert.equal(reads,5);
 await assert.rejects(reconcile({...event,account_id:'biz_other'}),e=>e.code==='WRONG_MERCHANT');
 ctx.process.env.MAKEBORNE_TOPUP_MIGRATIONS_VERIFIED='true';
 const pack={id:'pack-event',type:'payment.succeeded',account_id:'biz_fixture',data:{id:'pay_pack'}};
 await reconcile(pack);assert.equal(topupCalls,1);assert.equal(reads,5,'Top-up must bypass membership lookup');
 topupFails=true;await assert.rejects(reconcile(pack),e=>e.code==='TOPUP_BINDING_PENDING');
 assert.equal(reads,5,'Failed top-up must retry instead of acknowledging or falling through');
 await assert.rejects(reconcile({...pack,account_id:'biz_other'}),e=>e.code==='WRONG_MERCHANT');
 assert.equal(topupCalls,2,'Merchant must be checked before top-up provider access');
 // Refund events: the verified payment is reconciled before the membership observation.
 // Whop keeps a refunded membership active, so the payment decides the period.
 membership.status='active';order.length=0;
 const refund={id:'refund-event',type:'refund.created',account_id:'biz_fixture',data:{payment:{id:'pay_sub'}}};
 await reconcile(refund);
 assert.deepEqual(order,['payment:account_fixture:mem_fixture:pay_sub','observation'],'Refund must be reconciled before the active-membership observation');
 assert.deepEqual(paymentReads,['pay_sub']);
 order.length=0;paymentFails=true;
 await assert.rejects(reconcile(refund),e=>e.code==='PLAN_PAYMENT_STORAGE_UNAVAILABLE'&&e.status===503);
 assert.deepEqual(order,[],'A failed payment reconcile must not record an active observation');
 paymentFails=false;paymentMembership='mem_other';order.length=0;
 await reconcile({...refund,id:'refund-other'});
 assert.deepEqual(order,['observation'],'A payment of another membership is not applied to this one');
 paymentMembership='mem_fixture';order.length=0;
 await reconcile({id:'membership-event',type:'membership.went_valid',account_id:'biz_fixture',data:{id:'mem_fixture'}});
 assert.equal(paymentReads.length,3,'Membership events do not read payments');
 console.log('PASS webhook delivery: missing checkout retries; plan mismatch refuses; receipt survives grant failure; duplicate heals only grant; delayed success reads current cancellation; wrong merchant denied; refund reconciled before observation and retried on failure');
})().catch(e=>{console.error(e);process.exitCode=1});
