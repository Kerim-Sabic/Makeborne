/* eslint-disable @typescript-eslint/no-require-imports -- Offline keyed checkout and recovery contracts. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const uuid='00000000-0000-4000-8000-000000000001';
const row={id:uuid,user_id:uuid,request_id:uuid,merchant_id:'biz_Test',plan_id:'plan_Test',whop_user_id:'user_Test',price_cents:1200,state:'awaiting_payment',checkout_url:null,checkout_request:null};
const originalPlan={id:'plan_Test',company:{id:'biz_Test'},currency:'usd',adaptive_pricing_enabled:false,plan_type:'one_time',initial_price:12,renewal_price:0,trial_period_days:null};
let plan=originalPlan,claimed=true,claimPurchase=row,posts=[],rpcCalls=[],savedError=false,memberships=[{whop_user_id:'user_Test'}];
let consentRecords=[],consentFails=false;
class RequestError extends Error{constructor(code,message,status){super(message);this.code=code;this.status=status;}}
const config={companyId:'biz_Test',apiKey:'fake',sandbox:true,enabled:true};
const testEnv={WHOP_API_BASE_URL:'https://sandbox-api.whop.com/api/v1',WHOP_TOPUPS_ENABLED:'true',MAKEBORNE_TOPUP_CHECKOUT_QUALIFIED:'true',MAKEBORNE_TOPUP_MIGRATIONS_VERIFIED:'true'};
const catalogue=[{id:'boost_100',credits:100,priceCents:1200},{id:'boost_300',credits:300,priceCents:3200},{id:'boost_1000',credits:1000,priceCents:9500}];
const mocks={'server-only':{},'@/lib/server/http':{RequestError},'./config':{billingConfig:()=>config},
 './checkout-consent':{requireCheckoutConsent:version=>{if(version!=='withdrawal-2026-10-26')throw new RequestError('CHECKOUT_CONSENT_REQUIRED','Consent required',400)},recordCheckoutConsent:async(...args)=>{if(consentFails)throw new RequestError('CHECKOUT_CONSENT_UNSAVED','Unavailable',503);consentRecords.push(args)}},
 './access':{billingUser:async()=>({id:uuid}),verifyCreationAccess:async()=>true},
 './database':{billingDatabase:()=>({from:()=>{const q={select:()=>q,eq:()=>q,in:()=>q,gt:()=>q,limit:async()=>({data:memberships,error:null})};return q;},rpc:async(name,args)=>{rpcCalls.push({name,args});
   if(name==='makeborne_topup_catalog_available')return {data:catalogue,error:null};
   if(name==='makeborne_prepare_topup')return {data:row,error:null};
   return name==='makeborne_claim_topup_checkout'
   ?{data:{claimed,purchase:claimPurchase},error:null}:{data:{id:uuid,checkout_id:'ch_Test',checkout_url:'https://sandbox.whop.com/checkout/ch_Test'},error:savedError?{code:'temporary'}:null};}})},
 './whop':{whopGet:async()=>plan,checkoutUrl:value=>{const u=new URL(value);if(u.origin!=='https://sandbox.whop.com')throw Error('Invalid checkout');return u.href;},
   whopRequest:async(path,body,options)=>{posts.push({path,body,options});return {id:'ch_Test',company_id:'biz_Test',plan:{id:'plan_Test'},purchase_url:'https://sandbox.whop.com/checkout/ch_Test'};}},
};
const cache=new Map(),fetchCalls=[];
function load(file){const filename=path.resolve(__dirname,file);if(cache.has(filename))return cache.get(filename);
 const context={exports:{},Date,JSON,BigInt,Number,Set,String,URL,AbortSignal,process:{env:testEnv},
 fetch:async(url,options)=>{fetchCalls.push({url,options});return {ok:true,json:async()=>({id:'ch_Test'})};},require:name=>{
  if(Object.hasOwn(mocks,name))return mocks[name];if(name.startsWith('@/'))return load(path.resolve(__dirname,'../..',name.slice(2))+'.ts');
  if(name.startsWith('.'))return load(path.resolve(path.dirname(filename),name)+'.ts');return require(name);
 }};vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);cache.set(filename,context.exports);return context.exports;}
(async()=>{
 const {checkoutForTopup:create}=load('topup-checkout.ts');
 const first=await create(row);assert.equal(first.url,'https://sandbox.whop.com/checkout/ch_Test');assert.equal(first.resumed,false);
 assert.equal(posts.length,1);assert.equal(posts[0].options.idempotencyKey,`makeborne-topup-${uuid}`);
 assert.equal(posts[0].body.metadata.makeborne_topup_order_id,uuid);assert.equal(posts[0].body.redirect_url,'https://sandbox.whop.com/');
 assert.equal(rpcCalls[1].name,'makeborne_save_topup_checkout');
 const oldPosts=posts.length;const resumed=await create({...row,checkout_url:first.url});assert.equal(resumed.resumed,true);assert.equal(posts.length,oldPosts);
 for(const state of ['funded','held','reversed']){
  for(const checkout_url of [first.url,null]){
   const beforeRpc=rpcCalls.length;
   await assert.rejects(()=>create({...row,state,checkout_url}),e=>e.code==='CREDIT_PACK_CHECKOUT_RESOLVED'&&e.status===409);
   assert.equal(posts.length,oldPosts);assert.equal(rpcCalls.length,beforeRpc,'Resolved request must not reclaim checkout');
  }
 }
 await assert.rejects(()=>create({...row,state:undefined,checkout_url:first.url}));
 claimed=false;await assert.rejects(()=>create(row),e=>e.code==='CREDIT_PACK_CHECKOUT_PENDING');assert.equal(posts.length,oldPosts);
 for(const state of ['funded','held','reversed']){
  claimPurchase={...row,state,checkout_url:first.url};
  await assert.rejects(()=>create(row),e=>e.code==='CREDIT_PACK_CHECKOUT_RESOLVED');assert.equal(posts.length,oldPosts);
 }
 claimPurchase={...row,checkout_url:first.url};assert.equal((await create(row)).resumed,true);assert.equal(posts.length,oldPosts);
 claimPurchase=row;
 claimed=true;
 for(const patch of [{initial_price:13},{initial_price:12.001},{renewal_price:1},{plan_type:'renewal'},{currency:'eur'},{company:{id:'biz_Other'}},{trial_period_days:1},{adaptive_pricing_enabled:true},{adaptive_pricing_enabled:undefined},{adaptive_pricing_enabled:null}]){
  plan={...originalPlan,...patch};rpcCalls=[];await assert.rejects(()=>create(row),e=>e.code==='CREDIT_PACK_PRICE_UNVERIFIED');assert.equal(rpcCalls.length,0);
 }
 for(const adaptive_pricing_enabled of [true,undefined,null]){
  plan={...originalPlan,adaptive_pricing_enabled};const before=posts.length;rpcCalls=[];
  await assert.rejects(()=>create({...row,checkout_url:first.url}),e=>e.code==='CREDIT_PACK_PRICE_UNVERIFIED');
  assert.equal(posts.length,before,'Saved checkout must not bypass current currency qualification');assert.equal(rpcCalls.length,0);
 }
 plan=originalPlan;savedError=true;await assert.rejects(()=>create(row),e=>e.code==='CREDIT_PACK_CHECKOUT_UNVERIFIED');
 const uncertain=posts.at(-1);savedError=false;await create({...row,checkout_request:uncertain.body});
 assert.equal(JSON.stringify(posts.at(-1).body),JSON.stringify(uncertain.body));assert.equal(posts.at(-1).options.idempotencyKey,uncertain.options.idempotencyKey);
 const topups=load('topups.ts');assert.equal((await topups.creditTopupAvailability()).available,true);
 for(const withdrawalConsent of [undefined,'old','',false]){const before=rpcCalls.length;await assert.rejects(()=>topups.createTopupCheckout(uuid,{packId:'boost_100',requestId:uuid,withdrawalConsent}),e=>e.code==='CHECKOUT_CONSENT_REQUIRED');assert.equal(rpcCalls.length,before)}
 await topups.createTopupCheckout(uuid,{packId:'boost_100',requestId:uuid,withdrawalConsent:'withdrawal-2026-10-26'});
 assert.deepEqual(consentRecords.at(-1),[uuid,row.request_id,'pack']);
 consentFails=true;{const before=posts.length;await assert.rejects(()=>topups.createTopupCheckout(uuid,{packId:'boost_100',requestId:uuid,withdrawalConsent:'withdrawal-2026-10-26'}),e=>e.code==='CHECKOUT_CONSENT_UNSAVED');assert.equal(posts.length,before)}consentFails=false;
 const prepared=rpcCalls.findLast(x=>x.name==='makeborne_prepare_topup');assert.equal(prepared.args.p_user,uuid);assert.equal(prepared.args.p_whop_user,'user_Test');
 memberships=[{whop_user_id:'user_Test'},{whop_user_id:'user_Other'}];const before=posts.length;
 await assert.rejects(()=>topups.createTopupCheckout(uuid,{packId:'boost_100',requestId:uuid,withdrawalConsent:'withdrawal-2026-10-26'}),e=>e.code==='TOPUP_IDENTITY_UNVERIFIED');assert.equal(posts.length,before);
 testEnv.MAKEBORNE_TOPUP_CHECKOUT_QUALIFIED='false';assert.equal((await topups.creditTopupAvailability()).available,false);
 await assert.rejects(()=>topups.createTopupCheckout(uuid,{packId:'boost_100',requestId:uuid,withdrawalConsent:'withdrawal-2026-10-26'}),e=>e.code==='TOPUPS_NOT_OPEN');assert.equal(posts.length,before);
 testEnv.MAKEBORNE_TOPUP_SANDBOX_TEST='true';assert.equal(topups.topupCheckoutOpen(),true);
 config.sandbox=false;assert.equal(topups.topupCheckoutOpen(),false,'Sandbox test flag must not activate live sales');config.sandbox=true;
 const transport=load('whop.ts');await transport.whopRequest('/checkout_configurations',{mode:'payment'},{idempotencyKey:'probe_Test'});
 assert.equal(fetchCalls[0].options.headers['Idempotency-Key'],'probe_Test');assert.equal(fetchCalls[0].options.headers['Api-Version-Date'],'2025-01-01');
 await assert.rejects(()=>transport.whopRequest('/checkout_configurations',{}, {idempotencyKey:'bad\r\nheader'}));assert.equal(fetchCalls.length,1);
 console.log('PASS: keyed single POST, frozen payload recovery, pending checkout resume, resolved/held/reversed checkout refusal including claim races, exact one-time pricing, save failure, and transport header validation');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
