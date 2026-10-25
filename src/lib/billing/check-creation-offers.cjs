/* eslint-disable @typescript-eslint/no-require-imports -- Offline server availability and offer contract. */
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript'), assert = require('node:assert/strict');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
const plans=require('./plans.ts'), schedule=require('./plan-schedule.ts');
let config={enabled:true,configured:true,companyId:'biz_fixture',accessPlanIds:['plan_month','plan_year'],planConfigIssues:[]};
let enabled=true, dbError=null, providerCalls=0, user=null, members=[];
let provider={id:'plan_month',company:{id:'biz_fixture'},currency:'usd',plan_type:'renewal',billing_period:30,initial_price:0,renewal_price:20,trial_period_days:null,release_method:'buy_now',stock:0,unlimited_stock:true};
const db={rpc:async()=>({data:enabled,error:dbError}),from:()=>({select:()=>({eq:()=>({not:()=>({limit:async()=>({data:members,error:dbError})})})})})};
const env={WHOP_PLAN_CREDIT_MAP:'plan_year:create:yearly'};
const modules={'server-only':{},'./config':{billingConfig:()=>config,CREATION_CATALOG:{create:'plan_month'},SUPPORT:{planId:'plan_coffee'}},'./database':{billingDatabase:()=>db},'./plan-schedule':schedule,'./plans':plans,
 './whop':{whopGet:async path=>{providerCalls++;return path.endsWith('plan_year')?{...provider,id:'plan_year',billing_period:365,renewal_price:192}:provider;}},'./topup-fulfillment':{providerUsdCents:value=>{if(!/^\d+(\.\d{1,2})?$/.test(String(value)))throw Error('imprecise');return BigInt(Math.round(Number(value)*100));}}};
function load(file, imports){const ctx={exports:{},process:{env},Response,require:name=>imports[name]??require(name)};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);return ctx.exports;}
const offers=load(require.resolve('./creation-offers.ts'),modules);
class RequestError extends Error{constructor(code,message,status){super(message);this.code=code;this.status=status;}}
const route=load(require.resolve('../../app/api/billing/availability/route.ts'),{'@/lib/billing/access':{billingUser:async()=>user},'@/lib/billing/config':modules['./config'],'@/lib/billing/database':modules['./database'],'@/lib/billing/creation-offers':offers,'@/lib/server/http':{RequestError,apiError:e=>Response.json({error:e.code},{status:e.status??500})}});
(async()=>{
 assert.equal((await offers.verifiedCreationOffer({tier:'create',interval:'monthly'})).totalCents,2000);
 assert.equal((await offers.verifiedCreationOffer({tier:'create',interval:'yearly'})).totalCents,19200);
 assert.equal(await offers.verifiedCreationOffer({tier:'scale',interval:'yearly'}),null);
 for(const patch of [{currency:'eur'},{initial_price:29},{renewal_price:30},{renewal_price:29},{billing_period:7},{trial_period_days:1},{stock:0,unlimited_stock:false},{stock:null,unlimited_stock:false},{stock:-1},{stock:0.5},{unlimited_stock:undefined},{unlimited_stock:'true'},{release_method:'waitlist'},{company:{id:'biz_other'}},{id:'plan_other'}]){
  const previous=provider;provider={...provider,...patch};assert.equal(await offers.verifiedCreationOffer({planId:'plan_month'}),null,JSON.stringify(patch));provider=previous;
 }
 for(const patch of [{stock:0,unlimited_stock:true},{stock:null,unlimited_stock:true},{stock:1,unlimited_stock:false}]){
  const previous=provider;provider={...provider,...patch};assert.equal((await offers.verifiedCreationOffer({planId:'plan_month'})).totalCents,2000,JSON.stringify(patch));provider=previous;
 }
 enabled=false;let before=providerCalls;assert.equal(await offers.verifiedCreationOffer({planId:'plan_month'}),null);assert.equal(providerCalls,before);enabled=true;
 config.enabled=false;assert.equal((await offers.configuredCreationOffers()).length,0);config.enabled=true;
 config.planConfigIssues=[{problem:'bad'}];assert.equal(offers.configuredCreationOffers().length,0);config.planConfigIssues=[];
 env.WHOP_PLAN_CREDIT_MAP+=',plan_duplicate:create:monthly';config.accessPlanIds.push('plan_duplicate');assert.equal(offers.configuredCreationOffers().length,1);config.accessPlanIds.pop();
 // Historical memberships must remain reconcilable without becoming new offers.
 config.accessPlanIds.push('plan_duplicate');
 env.WHOP_CREATION_CHECKOUT_PLAN_IDS='plan_month,plan_year';
 assert.equal(offers.configuredCreationOffers().length,2,'explicit checkout plans isolate legacy entitlement rules');
 assert.equal(await offers.verifiedCreationOffer({planId:'plan_duplicate'}),null);
 for(const invalid of ['', 'plan_unknown', 'not-a-plan', 'plan_month,plan_month', 'plan_month,']){
  env.WHOP_CREATION_CHECKOUT_PLAN_IDS=invalid;
  assert.equal(offers.configuredCreationOffers().length,0,'invalid checkout selection fails closed: '+invalid);
 }
 env.WHOP_CREATION_CHECKOUT_PLAN_IDS='plan_month,plan_year';
 config.accessPlanIds.pop();
 delete env.WHOP_CREATION_CHECKOUT_PLAN_IDS;
 let response=await route.GET(), body=await response.json();assert.equal(body.authenticated,false);assert.equal(body.offers.length,2);assert.equal(JSON.stringify(body).includes('plan_month'),false);assert.equal(response.headers.get('cache-control'),'private, no-store');
 user={id:'fixture'};members=[{membership_id:'mem_fixture'}];before=providerCalls;body=await(await route.GET()).json();assert.equal(body.existingMember,true);assert.equal(body.offers.length,0);assert.equal(providerCalls,before);
 dbError={message:'offline'};assert.equal((await route.GET()).status,503);
 console.log('PASS creation offers: closed/config/DB gates, monthly/yearly mapping, exact provider price/cadence/stock/trial/merchant, member safety, private nonsecret response. Mocked only.');
})().catch(error=>{console.error(error);process.exitCode=1;});
