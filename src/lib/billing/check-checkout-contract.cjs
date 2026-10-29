/* eslint-disable @typescript-eslint/no-require-imports -- Offline route regression from real sandbox response. */
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
class RequestError extends Error{constructor(code,message,status){super(message);this.code=code;this.status=status}}
let response={id:'ch_fixture',company_id:'biz_fixture',plan:{id:'plan_fixture'},purchase_url:'https://sandbox.whop.com/checkout/ch_fixture'},saved=false,payload,insertError,providerCalls=0;
const config={enabled:true,sandbox:true,companyId:'biz_fixture',accessPlanIds:['plan_fixture']};
let openRows=[],memberRows=[];
const rows=value=>{const chain={eq:()=>chain,order:()=>chain,in:()=>chain,limit:async()=>({data:value(),error:null}),maybeSingle:async()=>({data:value()[0]??null,error:null}),then:(ok,fail)=>Promise.resolve({data:value(),error:null}).then(ok,fail)};return chain;};
const db={rpc:async()=>({data:true}),from:table=>({insert:async()=>({error:insertError}),update:()=>({eq:()=>({eq:async()=>{saved=true;return {}}})}),
 select:()=>rows(()=>table==='billing_memberships'?memberRows:openRows)})};
let offerAvailable=true;
// Exact-checkout recovery (checkout-recovery.ts): 'pending' means Whop lists no paid payment for that checkout now.
let recovery='pending',recoveryCalls=[];
let consentRecords=[],consentFails=false;
const modules={
 '@/lib/billing/checkout-consent':{requireCheckoutConsent:version=>{if(version!=='withdrawal-2026-10-26')throw new RequestError('CHECKOUT_CONSENT_REQUIRED','Consent required',400)},prepareConsentedPlanCheckout:async()=>{if(consentFails)throw new RequestError('CHECKOUT_CONSENT_UNSAVED','Unavailable',503);return{data:true,error:insertError}},recordCheckoutConsent:async(...args)=>{if(consentFails)throw new RequestError('CHECKOUT_CONSENT_UNSAVED','Unavailable',503);consentRecords.push(args)}},
 '@/lib/billing/plans':{BILLING_TERMS_VERSION:'2026-10-25-beta-v9',WITHDRAWAL_CONSENT_VERSION:'withdrawal-2026-10-26'},
 '@/lib/billing/creation-offers':{verifiedCreationOffer:async()=>offerAvailable?{planId:'plan_fixture'}:null},
 '@/lib/billing/access':{requireBillingUser:async()=>({id:'user_fixture'})},'@/lib/billing/config':{billingConfig:()=>config},'@/lib/billing/database':{billingDatabase:()=>db},
 '@/lib/billing/checkout-recovery':{recoverCreationCheckout:async(user,request)=>{recoveryCalls.push([user,request]);if(recovery==='throw')throw Object.assign(Error('provider unavailable'),{code:'CHECKOUT_RECOVERY_UNVERIFIED'});return recovery}},
 '@/lib/billing/whop':{checkoutUrl:x=>x,whopRequest:async(path,body)=>{providerCalls++;assert.equal(path,'/checkout_configurations');payload=body;return response}},
 '@/lib/supabase/auth-flow':{authDestination:x=>x},'@/lib/site-metadata':{SITE:{url:'https://makeborne.com'}},
 '@/lib/server/http':{RequestError,sameOrigin(){},boundedJson:r=>r.json(),apiError:e=>Response.json({code:e.code},{status:e.status??500})},
};
const ctx={exports:{},Response,process:{env:{}},require:n=>modules[n]??require(n)};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../../app/api/billing/checkout/route.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);
const request=(selection={planId:'plan_fixture'})=>new Request('http://localhost:3048/api/billing/checkout',{method:'POST',body:JSON.stringify({withdrawalConsent:'withdrawal-2026-10-26',...selection,requestId:'00000000-0000-4000-8000-000000000001',next:'/studio'})});
(async()=>{
 assert.equal((await ctx.exports.POST(request())).status,200);assert(saved);assert.equal(payload.redirect_url,'https://sandbox.whop.com/');assert.equal(payload.metadata.makeborne_terms_version,'2026-10-25-beta-v9');
 // Missing/stale consent never creates or resumes a payment link.
 assert.equal(payload.metadata.makeborne_withdrawal_consent,'withdrawal-2026-10-26');
 assert.equal((await ctx.exports.POST(request({planId:'plan_fixture',withdrawalConsent:'withdrawal-2026-10-26'}))).status,200);assert.equal(payload.metadata.makeborne_withdrawal_consent,'withdrawal-2026-10-26');
 for(const withdrawalConsent of [undefined,false,'','withdrawal-old']){const before=providerCalls;const reply=await ctx.exports.POST(request({planId:'plan_fixture',withdrawalConsent}));assert.equal(reply.status,400);assert.equal(providerCalls,before)}
 consentFails=true;{const before=providerCalls;assert.equal((await ctx.exports.POST(request())).status,503);assert.equal(providerCalls,before)}consentFails=false;
 ctx.process.env.MAKEBORNE_WHOP_STAGING_SANDBOX='true';
 ctx.process.env.VERCEL_URL='makeborne-release-staging-abc123def-kerimsabic-6594s-projects.vercel.app';
 assert.equal((await ctx.exports.POST(request())).status,200);assert.equal(payload.redirect_url,'https://'+ctx.process.env.VERCEL_URL+'/billing/return?request=00000000-0000-4000-8000-000000000001');
 for(const host of ['makeborne.com','attacker.invalid','makeborne-other-abc123def-kerimsabic-6594s-projects.vercel.app',undefined]){ctx.process.env.VERCEL_URL=host;const before=providerCalls;assert.equal((await ctx.exports.POST(request())).status,503);assert.equal(providerCalls,before,'Unknown return host never contacts provider');}
 delete ctx.process.env.MAKEBORNE_WHOP_STAGING_SANDBOX;delete ctx.process.env.VERCEL_URL;
 saved=false;response={...response,company_id:'biz_other'};assert.equal((await ctx.exports.POST(request())).status,503);assert(!saved);
 response={...response,company_id:'biz_fixture',plan:{id:'plan_other'}};assert.equal((await ctx.exports.POST(request())).status,503);
 response={...response,plan:{id:'plan_fixture'}};config.sandbox=false;assert.equal((await ctx.exports.POST(request())).status,200);assert.equal(payload.redirect_url,'https://makeborne.com/billing/return?request=00000000-0000-4000-8000-000000000001');
 for(const code of ['PBC01','PBC02','PBC03']){insertError={code};const before=providerCalls;const blocked=await ctx.exports.POST(request());assert.equal(blocked.status,409);const body=await blocked.json();if(code==='PBC03')assert.equal(body.code,'SUBSCRIPTION_REPURCHASE_REQUIRES_SUPPORT');assert(!('url' in body),'Blocked account gets no payment link');assert.equal(providerCalls,before,'Blocked checkout must not contact Whop');}
 // An abandoned checkout must not lock the account: the open checkout for the same plan resumes, without a new provider call.
 insertError={code:'PBC02'};openRows=[{request_id:'r1',plan_id:'plan_fixture',purchase_url:'https://whop.com/checkout/ch_open',status:'ready',checkout_id:'ch_open'}];memberRows=[];
 let before=providerCalls,res=await ctx.exports.POST(request());assert.equal(res.status,200);assert.deepEqual(await res.json(),{url:'https://whop.com/checkout/ch_open',resumed:true});assert.equal(providerCalls,before);
 assert.deepEqual(recoveryCalls.at(-1),['user_fixture','r1'],'Resume first re-checks the open checkout with Whop');
 assert.deepEqual(consentRecords.at(-1),['user_fixture','r1','plan'],'Consent binds the ACTUAL resumed order');
 // Missing/late first webhook: the unbound checkout may already be paid. Never send the buyer back to pay it again.
 for(const [outcome,code] of [['recovered','CHECKOUT_ALREADY_COMPLETED'],['review','CHECKOUT_PENDING'],['skipped','CHECKOUT_PENDING'],['throw','CHECKOUT_PENDING']]){
  recovery=outcome;res=await ctx.exports.POST(request());assert.equal(res.status,409,outcome);const body=await res.json();assert.equal(body.code,code,outcome);assert(!('url' in body),'No checkout URL when '+outcome);assert.equal(providerCalls,before,'No new checkout when '+outcome);}
 recovery='pending';
 openRows=[{...openRows[0],plan_id:'plan_other'}];res=await ctx.exports.POST(request());assert.equal(res.status,409);assert.equal((await res.json()).code,'CHECKOUT_ALREADY_OPEN');
 openRows=[{request_id:'r2',plan_id:'plan_fixture',purchase_url:null,status:'pending',checkout_id:null}];assert.equal((await ctx.exports.POST(request())).status,409,'An uncertain provider attempt still needs support');
 openRows=[{request_id:'r3',plan_id:'plan_fixture',purchase_url:'https://whop.com/checkout/ch_paid',status:'ready',checkout_id:'ch_paid'}];memberRows=[{checkout_id:'ch_paid'}];assert.equal((await ctx.exports.POST(request())).status,409,'A paid checkout is never resumed');
 assert.equal(providerCalls,before,'No blocked path contacts Whop');insertError=undefined;
 insertError={code:'23505'};openRows=[{plan_id:'plan_fixture',return_path:'/studio',status:'ready',purchase_url:'https://whop.com/checkout/ch_used',checkout_id:'ch_used'}];memberRows=[{membership_id:'mem_expired',checkout_id:'ch_used'}];before=providerCalls;
 res=await ctx.exports.POST(request());assert.equal(res.status,409);assert.equal((await res.json()).code,'CHECKOUT_ALREADY_COMPLETED');assert.equal(providerCalls,before);
 memberRows=[];assert.equal((await ctx.exports.POST(request())).status,200,'An unbound same-key checkout still resumes');assert.deepEqual(recoveryCalls.at(-1),['user_fixture','00000000-0000-4000-8000-000000000001']);
 for(const [outcome,code] of [['recovered','CHECKOUT_ALREADY_COMPLETED'],['review','CHECKOUT_PENDING'],['throw','CHECKOUT_PENDING']]){recovery=outcome;res=await ctx.exports.POST(request());assert.equal(res.status,409);assert.equal((await res.json()).code,code,'Same-key retry of a possibly paid checkout: '+outcome);}recovery='pending';assert.equal(providerCalls,before);assert.equal(providerCalls,before);insertError=undefined;
 offerAvailable=false;before=providerCalls;assert.equal((await ctx.exports.POST(request())).status,503);assert.equal(providerCalls,before);offerAvailable=true;
 assert.equal((await ctx.exports.POST(request({tier:'create',interval:'yearly'}))).status,200);
 before=providerCalls;assert.equal((await ctx.exports.POST(request({tier:'create',interval:'yearly',priceCents:1}))).status,400);assert.equal(providerCalls,before);
 console.log('PASS checkout contract: merchant/plan validation; HTTPS returns; duplicate subscription and checkout blocked before provider call; abandoned checkout resumes for the same plan only after Whop shows no paid payment on it; a paid-but-unbound checkout is recovered or held, never re-offered');
})().catch(e=>{console.error(e);process.exitCode=1});
