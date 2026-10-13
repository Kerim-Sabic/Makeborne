/* eslint-disable @typescript-eslint/no-require-imports -- Real adapter + SQL; fake provider; named disposable DB only. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process'),{randomUUID}=require('node:crypto');
const db='makeborne_topup_verify',user=randomUUID(),request=randomUUID(),tag=user.replaceAll('-','');
const plan=`plan_${tag}`,checkout=`ch_${tag}`,paymentId=`pay_${tag}`;
const version='credit-packs-preview-2026-10-05';
function sql(input){
  const r=spawnSync('docker',['exec','-i','supabase_db_makeborne-release-auth','psql','-U','supabase_admin','-d',db,'-v','ON_ERROR_STOP=1','-At'],{input,encoding:'utf8',timeout:10000});
  if(r.error)throw r.error;if(r.status)throw new Error(r.stderr);return r.stdout.trim();
}
const quote=value=>`'${String(value).replaceAll("'","''")}'`;
let payment={id:paymentId,company:{id:'biz_Test'},plan:{id:plan},user:{id:'user_Test'},checkout_configuration_id:checkout,
  billing_reason:'one_time',currency:'usd',status:'paid',substatus:'succeeded',subtotal:12,total:12,tax_amount:null,tax_refunded_amount:null,
  refunded_amount:0,tax_behavior:'exclusive',promo_code:null,disputes:[],updated_at:new Date(Date.now()-30000).toISOString()};
class RequestError extends Error{constructor(code,message,status){super(message);this.code=code;this.status=status;}}
const jobRuns=[];
const rpc=async(name,args)=>{
  const signatures={makeborne_find_topup_payment:['p_payment','p_checkout','p_plan','p_merchant'],makeborne_reconcile_topup:['p_user','p_order','p_payment'],
    makeborne_claim_topup_checkout:['p_user','p_order','p_request'],makeborne_save_topup_checkout:['p_user','p_order','p_checkout','p_url'],
    makeborne_billing_job_begin:['p_job','p_lease_seconds'],makeborne_billing_job_heartbeat:['p_run','p_lease_seconds'],
    makeborne_billing_job_finish:['p_run','p_status','p_stats','p_error'],makeborne_topup_due_orders:['p_limit','p_stale_seconds'],
    makeborne_topup_record_check:['p_order','p_cursor','p_error','p_run']};
  if(!Object.hasOwn(signatures,name))throw new Error('Test RPC not allowlisted');
  try {
    const parameters=signatures[name].map(key=>`${key} => ${args[key]==null?'null':quote(typeof args[key]==='object'?JSON.stringify(args[key]):args[key])}${args[key]!=null&&typeof args[key]==='object'?'::jsonb':''}`).join(',');
    // Invoker wrappers actually run with service_role, not a database-owner shortcut.
    const out=sql(`set role service_role; select to_jsonb(public.${name}(${parameters}));`);
    const data=JSON.parse(out.split('\n').at(-1));if(name==='makeborne_billing_job_begin'&&data)jobRuns.push(data);
    return {data,error:null};
  }catch(error){return {data:null,error:{message:error.message}};}
};
const checkoutCalls=[];
const mocks={'server-only':{},'@/lib/server/http':{RequestError},'./config':{billingConfig:()=>({companyId:'biz_Test',sandbox:true})},
  './database':{billingDatabase:()=>({rpc})},'./whop':{
    whopGet:async url=>url.startsWith('/plans/')?{id:plan,company:{id:'biz_Test'},currency:'usd',plan_type:'one_time',initial_price:12,renewal_price:0,trial_period_days:null}
      :url.startsWith('/payments?')?{data:[payment],page_info:{has_next_page:false,end_cursor:null}}:payment,
    checkoutUrl:value=>{assert.equal(new URL(value).origin,'https://sandbox.whop.com');return value;},
    whopRequest:async(path,body,options)=>{checkoutCalls.push({path,body,options});return {id:checkout,company_id:'biz_Test',plan:{id:plan},purchase_url:`https://sandbox.whop.com/checkout/${checkout}`};}}};
const cache=new Map();
function load(file){
  const filename=path.resolve(__dirname,'../src/lib/billing',file);if(cache.has(filename))return cache.get(filename);
  const context={exports:{},Date,JSON,BigInt,Number,Set,String,URLSearchParams,require:name=>{
    if(Object.hasOwn(mocks,name))return mocks[name];
    if(name.startsWith('@/'))return load(path.resolve(__dirname,'../src',name.slice(2))+'.ts');
    if(name.startsWith('.'))return load(path.resolve(path.dirname(filename),name)+'.ts');return require(name);
  }};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
  cache.set(filename,context.exports);return context.exports;
}
(async()=>{
  assert.equal(sql('select current_database();'),db);
  assert.equal(sql('select count(*) from auth.users;'),'0');
  let setup=false;
  try{
    sql(`begin; insert into auth.users(id,email,email_confirmed_at) values('${user}','${tag}@topup.example.invalid',now());
      insert into makeborne_private.account_privileges(user_id,is_admin,reason) values('${user}',true,'Disposable adapter fixture');
      update makeborne_private.topup_catalog set enabled=true,merchant_id='biz_Test',plan_id='${plan}' where version='${version}' and pack_id='boost_100'; commit;`);
    setup=true;
    const order=sql(`select public.makeborne_prepare_topup('${user}','${request}','boost_100','${version}','user_Test')->>'id';`);
    assert.match(order,/^[0-9a-f-]{36}$/);
    const {checkoutForTopup:createCheckout}=load('topup-checkout.ts');
    const frozen=()=>JSON.parse(sql(`select to_jsonb(o) from makeborne_private.topup_orders o where id='${order}';`));
    const opened=await createCheckout(frozen());assert.equal(opened.purchaseId,order);
    assert.equal(checkoutCalls.length,1);assert.equal(checkoutCalls[0].options.idempotencyKey,`makeborne-topup-${order}`);
    assert.equal((await createCheckout(frozen())).resumed,true);assert.equal(checkoutCalls.length,1);
    console.log('PASS: real checkout adapter claims and saves via service role; resumed purchase does not contact provider');
    const {deliverTopupPayment:deliver}=load('topup-delivery.ts');
    const {listTopupPayments:listPayments}=load('topup-payment-list.ts');
    const {runTopupReconcileJob:reconcile}=load('topup-reconcile-job.ts');
    const grantJob=await reconcile({rpc,listPayments,deliver});
    assert.equal(grantJob.status,'succeeded',JSON.stringify(grantJob));
    assert.equal(await deliver(paymentId),true);assert.equal(await deliver(paymentId),true);
    assert.equal(sql(`select makeborne_private.credit_available('${user}');`),'100');
    assert.equal(sql(`select count(*) from makeborne_private.credit_lots where user_id='${user}';`),'1');
    payment={...payment,substatus:'refunded',refunded_amount:12,updated_at:new Date(Date.now()-10000).toISOString()};
    sql(`update makeborne_private.topup_orders set last_checked_at=now()-interval '2 hours' where id='${order}';`);
    assert.equal((await reconcile({rpc,listPayments,deliver})).status,'succeeded');
    assert.equal(await deliver(paymentId),true);assert.equal(await deliver(paymentId),true);
    assert.equal(sql(`select makeborne_private.credit_available('${user}');`),'0');
    assert.equal(sql(`select state from makeborne_private.topup_orders where id='${order}';`),'reversed');
    assert.equal(sql(`select sum(delta) from public.credit_ledger where user_id='${user}';`),'0');
    console.log('PASS: real TypeScript delivery adapter → service-role RPC → durable lot/ledger; payment/refund replay grants and reverses exactly once');
  }finally{
    if(setup){
      sql(`begin; delete from makeborne_private.topup_orders where user_id='${user}'; delete from auth.users where id='${user}';
        ${jobRuns.length?`delete from makeborne_private.billing_job_runs where id in (${jobRuns.join(',')});`:''}
        delete from makeborne_private.topup_catalog where version='${version}' and pack_id='boost_100';
        insert into makeborne_private.topup_catalog(version,pack_id,credits,price_cents) values('${version}','boost_100',100,1200); commit;`);
      assert.equal(sql('select count(*) from auth.users;'),'0');assert.equal(sql('select count(*) from public.credit_ledger;'),'0');
      assert.equal(sql('select count(*) from makeborne_private.topup_catalog where enabled;'),'0');
      console.log('PASS: disposable account/ledger fixtures removed; catalogue returned to disabled state');
    }
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
