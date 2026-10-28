/* eslint-disable @typescript-eslint/no-require-imports -- Offline exact-binding and failure-injection checks; no provider calls. */
const fs=require('fs'),vm=require('vm'),ts=require('typescript'),assert=require('assert/strict');
class RequestError extends Error{constructor(code,message,status){super(message);this.code=code;this.status=status}}
const user='11111111-1111-4111-8111-111111111111',request='22222222-2222-4222-8222-222222222222',lease='33333333-3333-4333-8333-333333333333';
const base={id:'pay_purchase',company:{id:'biz_merchant'},plan:{id:'plan_create'},user:{id:'user_buyer'},membership:{id:'mem_paid'},checkout_configuration_id:'ch_owned',status:'paid',substatus:'succeeded',billing_reason:'subscription_create',currency:'usd',total:29,refunded_amount:0,paid_at:new Date().toISOString(),updated_at:new Date().toISOString(),disputes:[]};
let payment,listed,checkout,membership,claimed,finished,bound,provider,observations,settlements,failSettlement,finishAllowed,claimAllowed;
const config=()=>({configured:true,companyId:'biz_merchant',accessPlanIds:['plan_create']});
const db={async rpc(name,args){if(name==='makeborne_claim_checkout_recovery'){claimed++;return{data:claimAllowed?{user_id:user,request_id:request,checkout_id:'ch_owned',plan_id:'plan_create',lease}:null,error:null}}if(name==='makeborne_finish_checkout_recovery'){finished.push(args);return{data:finishAllowed,error:null}}if(name==='makeborne_bind_checkout_recovery'){bound++;return{data:true,error:null}}if(name==='makeborne_reconcile_plan_payment'){settlements++;if(failSettlement)throw Error('Lost response');return{data:{outcome:'recorded',state:'funded'},error:null}}throw Error('Unexpected RPC '+name)}};
const whop={whopTime:value=>new Date(value).toISOString(),whopGet:async(path,options)=>{assert.equal(options.attempts,1);provider.push(path);if(path.startsWith('/checkout_configurations/'))return checkout;if(path.startsWith('/payments?')){const u=new URL('https://provider.invalid'+path);assert.equal(u.searchParams.get('checkout_configuration_ids[]'),'ch_owned');assert.equal(u.searchParams.get('query'),null);return listed}if(path==='/payments/pay_purchase')return payment;throw Error('Unexpected GET')},fetchMembership:async(id,options)=>{assert.equal(options.attempts,1);provider.push('membership:'+id);return membership},activeMembership:m=>['active','canceling'].includes(m.status)&&Date.parse(m.renewal_period_end)>Date.now()};
function load(file,modules){const ctx={exports:{},process:{env:{MAKEBORNE_BILLING_MIGRATIONS_VERIFIED:'true'}},Date,URLSearchParams,BigInt,console,require:n=>n==='server-only'?{}:modules[n]??require(n)};vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve(file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);return ctx.exports}
const confirmed=[];const modules={'./config':{billingConfig:config},'./database':{billingDatabase:()=>db},'./whop':whop,'@/lib/server/http':{RequestError},'./purchase-confirmations':{confirmAfterFulfillment:async id=>{confirmed.push(id)}}};
modules['./plan-payments']=load('./plan-payments.ts',modules);modules['@/lib/credits/server']={recordPlanObservation:async()=>{observations++;return{outcome:'recorded',granted:300}}};
const recovery=load('./checkout-recovery.ts',modules);const reset=()=>{payment=structuredClone(base);listed={data:[structuredClone(base)],page_info:{has_next_page:false,end_cursor:null}};checkout={id:'ch_owned',company_id:'biz_merchant',plan:{id:'plan_create'},metadata:{makeborne_request_id:request}};membership={id:'mem_paid',company:{id:'biz_merchant'},plan:{id:'plan_create'},user:{id:'user_buyer'},checkout_configuration_id:'ch_owned',status:'active',renewal_period_start:new Date(Date.now()-10000).toISOString(),renewal_period_end:new Date(Date.now()+86400000).toISOString()};claimed=bound=observations=settlements=0;finished=[];provider=[];failSettlement=false;finishAllowed=claimAllowed=true};
let checks=0;async function check(name,fn){reset();await fn();checks++;console.log('PASS '+name)}
(async()=>{
 await check('Missing event: authoritative payment binds and settles before allocation; no synthetic webhook',async()=>{assert.equal(await recovery.recoverCreationCheckout(user,request),'recovered');assert.equal(bound,1);assert.equal(settlements,1);assert.equal(observations,1);assert.equal(provider.length,4);assert.equal(finished.at(-1).p_state,'recovered');assert.equal(confirmed.length,1,'a recovered paid checkout is confirmed when its payment is recorded, before the allocation')});
 await check('Invalid account/request refuses before DB/provider access',async()=>{await assert.rejects(recovery.recoverCreationCheckout('other',request));assert.equal(claimed,0);assert.equal(provider.length,0)});
 await check('Lease/cooldown suppresses concurrent poll without provider reads',async()=>{claimAllowed=false;assert.equal(await recovery.recoverCreationCheckout(user,request),'skipped');assert.equal(provider.length,0)});
 for(const [name,change] of [
  ['request metadata',()=>checkout.metadata.makeborne_request_id=user],['checkout merchant',()=>checkout.company_id='biz_other'],['checkout plan',()=>checkout.plan.id='plan_other'],
  ['listed checkout',()=>listed.data[0].checkout_configuration_id='ch_other'],['listed merchant',()=>listed.data[0].company.id='biz_other'],
  ['fresh checkout',()=>payment.checkout_configuration_id='ch_other'],['fresh payer',()=>payment.user.id='user_other'],['fresh membership',()=>payment.membership.id='mem_other'],
  ['membership payer',()=>membership.user.id='user_other'],['membership checkout',()=>membership.checkout_configuration_id='ch_other'],['membership plan',()=>membership.plan.id='plan_other'],
 ])await check(name+' mismatch never binds or allocates',async()=>{change();await assert.rejects(recovery.recoverCreationCheckout(user,request));assert.equal(bound,0);assert.equal(observations,0);assert.equal(finished.at(-1).p_state,'pending')});
 await check('Incomplete list is review, not a partial proof',async()=>{listed.page_info.has_next_page=true;assert.equal(await recovery.recoverCreationCheckout(user,request),'review');assert.equal(bound,0)});
 await check('Multiple paid subscriptions for one checkout require review',async()=>{listed.data.push({...structuredClone(base),id:'pay_second'});assert.equal(await recovery.recoverCreationCheckout(user,request),'review');assert.equal(bound,0)});
 await check('Unpaid first attempts do not reserve a draft membership',async()=>{listed.data[0].status='open';assert.equal(await recovery.recoverCreationCheckout(user,request),'pending');assert.equal(bound,0)});
 for(const [name,change] of [['refund',()=>{payment.substatus='refunded';payment.refunded_amount=29}],['partial refund',()=>{payment.substatus='partially_refunded';payment.refunded_amount=1}],['dispute',()=>payment.disputes=[{status:'needs_response'}]],['non-USD',()=>payment.currency='eur'],['noninitial charge',()=>payment.billing_reason='subscription_cycle'],['zero principal',()=>payment.total=0]])await check(name+' cannot authorize initial access',async()=>{change();assert.equal(await recovery.recoverCreationCheckout(user,request),'review');assert.equal(bound,0);assert.equal(observations,0)});
 await check('Cancellation checked from current membership despite paid list',async()=>{membership.status='canceled';assert.equal(await recovery.recoverCreationCheckout(user,request),'review');assert.equal(bound,0)});
 await check('Crash after binding retries financial settlement, never allocates before it',async()=>{failSettlement=true;await assert.rejects(recovery.recoverCreationCheckout(user,request));assert.equal(bound,1);assert.equal(observations,0);assert.equal(finished.at(-1).p_state,'pending');failSettlement=false;assert.equal(await recovery.recoverCreationCheckout(user,request),'recovered');assert.equal(observations,1)});
 await check('Stale finish is surfaced as an error',async()=>{finishAllowed=false;await assert.rejects(recovery.recoverCreationCheckout(user,request))});
 await check('Eleven abandoned checkouts rotate oldest-first across successful financial runs; review/errors remain partial',async()=>{
  const rows=Array.from({length:11},(_,i)=>({user_id:user,request_id:`44444444-4444-4444-8444-${String(i+1).padStart(12,'0')}`,updated:i}));
  let tick=11,active,mode='pending';const attempted=[],runs=[];
  const queueDb={async rpc(name,args){
   if(name==='makeborne_due_checkout_recoveries')return{data:[...rows].sort((a,b)=>a.updated-b.updated).slice(0,args.p_limit),error:null};
   if(name==='makeborne_claim_checkout_recovery'){active=args.p_request;attempted.push(active);return{data:{user_id:user,request_id:active,checkout_id:'ch_owned',plan_id:'plan_create',lease},error:null}};
   if(name==='makeborne_finish_checkout_recovery'){rows.find(r=>r.request_id===args.p_request).updated=tick++;return{data:true,error:null}};
   throw Error('Unexpected queue RPC '+name);
  }};
  const queueRecovery=load('./checkout-recovery.ts',{...modules,'./database':{billingDatabase:()=>queueDb},'./whop':{...whop,whopGet:async path=>{
   if(mode==='error')throw Error('Provider unavailable');
   if(path.startsWith('/checkout_configurations/'))return{...checkout,metadata:{makeborne_request_id:active}};
   return{data:[],page_info:{has_next_page:mode==='review',end_cursor:null}};
  }}});
  const job=load('./reconcile-job.ts',{});
  const deps={companyId:'biz_merchant',rpc:async(name,args)=>{
   if(name==='makeborne_billing_job_begin')return{data:1,error:null};
   if(name==='makeborne_billing_job_due_memberships')return{data:[],error:null};
   if(name==='makeborne_billing_job_finish')runs.push(args);
   return{data:{},error:null};
  },recoverCheckouts:()=>queueRecovery.recoverDueCreationCheckouts()};
  const first=await job.runPlanCreditReconcileJob(deps);
  assert.equal(first.status,'succeeded');assert.equal(first.stats.checkoutRecoveryBacklog,true);
  assert.equal(attempted.length,10);assert.equal(bound,0);assert.equal(observations,0);
  const second=await job.runPlanCreditReconcileJob(deps);
  assert.equal(second.status,'succeeded');assert.equal(second.stats.checkoutRecoveryBacklog,true);
  assert.equal(attempted[10],rows[10].request_id,'Unprocessed eleventh checkout is first next run');
  assert.equal(new Set(attempted).size,11);assert.equal(runs[1].p_status,'succeeded');
  // The SQL is authoritative for ordering; the fake queue models this exact clause.
  const sql=fs.readFileSync('supabase/migrations/20261021125359_checkout_payment_recovery.sql','utf8');
  assert(sql.includes("order by coalesce(r.updated_at,'1970-01-01'),c.created_at,c.request_id"));
  for(const failure of ['review','error']){mode=failure;const result=await job.runPlanCreditReconcileJob(deps);assert.equal(result.status,'partial');assert.equal(result.stats.checkoutRecoveryFailures,10)}
 });
 const route=fs.readFileSync('src/app/api/billing/checkout-status/route.ts','utf8');assert(route.indexOf('requireBillingUser()')<route.indexOf('recoverCreationCheckout(user.id'));assert(route.includes('.eq("user_id", user.id)'));assert(!fs.readFileSync(require.resolve('./checkout-recovery.ts'),'utf8').includes('makeborne_record_whop_membership'));
 console.log(checks+' checkout recovery checks pass; live provider/SQL qualification is separate');
})().catch(e=>{console.error(e);process.exitCode=1});
