/* eslint-disable @typescript-eslint/no-require-imports -- Offline queue, cursor, lease and provider-list contracts. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const uuid='00000000-0000-4000-8000-000000000001';
const row={id:uuid,user_id:uuid,merchant_id:'biz_Test',plan_id:'plan_Test',whop_user_id:'user_Test',checkout_id:'ch_Test',payment_id:null,payment_scan_cursor:null};
let response={data:[],page_info:{has_next_page:false,end_cursor:null}},requests=[];
class RequestError extends Error{constructor(code,message,status){super(message);this.code=code;this.status=status;}}
const env={MAKEBORNE_TOPUP_RECONCILE_ENABLED:'true',MAKEBORNE_TOPUP_MIGRATIONS_VERIFIED:'true'};
function load(file,modules={}){const ctx={exports:{},Date,Number,Set,URL,URLSearchParams,Response,process:{env},console:{info:()=>{},error:()=>{}},require:name=>{
 if(Object.hasOwn(modules,name))return modules[name];
 if(name==='server-only')return {};if(name==='@/lib/server/http')return {RequestError};
 if(name==='./whop')return {whopGet:async(url,options)=>{requests.push({url,options});return response;}};return require(name);
 }};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);return ctx.exports;}
const {runTopupReconcileJob:run}=load('topup-reconcile-job.ts');
const {listTopupPayments:list}=load('topup-payment-list.ts');
function deps(overrides={}){
 const calls=[],delivered=[];let rows=[row];
 return {calls,delivered,rows,setRows:value=>rows=value,
  rpc:async(name,args)=>{calls.push({name,args});return {error:null,data:name==='makeborne_billing_job_begin'?1:name==='makeborne_topup_due_orders'?rows:true};},
  listPayments:async()=>({paymentIds:['pay_Test','pay_Test'],complete:true,nextCursor:null,skipped:0}),
  deliver:async id=>{delivered.push(id);return true;},...overrides};
}
(async()=>{
 let d=deps();let result=await run(d);assert.equal(result.status,'succeeded');assert.deepEqual(d.delivered,['pay_Test']);
 assert.equal(d.calls.find(x=>x.name==='makeborne_topup_record_check').args.p_cursor,null);
 d=deps({rpc:async()=>({data:null,error:null})});assert.equal((await run(d)).status,'skipped');
 d=deps({listPayments:async()=>({paymentIds:['pay_Test'],complete:false,nextCursor:'cursor2',skipped:0})});result=await run(d);
 assert.equal(result.status,'partial');assert.equal(d.calls.find(x=>x.name==='makeborne_topup_record_check').args.p_cursor,'cursor2');
 d=deps({deliver:async()=>{throw Object.assign(new Error('must-not-log-provider-payload'),{code:'TOPUP_DELIVERY_UNVERIFIED'});}});result=await run(d);
 assert.equal(result.status,'partial');assert.equal(result.stats.failed,1);assert(!JSON.stringify(result).includes('must-not-log'));
 assert.equal(d.calls.find(x=>x.name==='makeborne_topup_record_check').args.p_cursor,null,'Failed page retains cursor');
 d=deps();d.setRows([{...row,payment_scan_cursor:'cursor1'}]);result=await run(d,{budgetMs:0});assert.equal(result.status,'partial');assert.equal(d.delivered.length,0);
 assert(!d.calls.some(x=>x.name==='makeborne_topup_record_check'),'Deadline cannot checkpoint undelivered page');
 d=deps();d.setRows([row,{...row,id:'00000000-0000-4000-8000-000000000002'}]);result=await run(d,{maxOrders:1});assert.equal(result.stats.backlog,true);assert.equal(result.status,'partial');
 d=deps();d.setRows([{...row,checkout_id:null}]);result=await run(d);assert.equal(result.stats.unbound,1);assert.equal(result.status,'partial');
 d=deps();d.setRows([{...row,payment_id:'pay_Test'}]);await run(d);assert.deepEqual(d.delivered,['pay_Test'],'Known payment checks refunds but list does not redeliver it');
 const realItem={id:'pay_Test',company:{id:'biz_Test'},plan:{id:'plan_Test'},user:{id:'user_Test'},checkout_configuration_id:'ch_Test'};
 response={data:[realItem,{...realItem,id:'pay_Other',checkout_configuration_id:'ch_Other'}],page_info:{has_next_page:true,end_cursor:'cursor2'}};
 result=await list({...row,payment_scan_cursor:'cursor1'});assert.equal(result.paymentIds.length,1);assert.equal(result.skipped,1);assert.equal(result.nextCursor,'cursor2');
 const url=new URL(requests[0].url,'https://sandbox-api.whop.com');assert.equal(url.searchParams.get('company_id'),'biz_Test');assert.equal(url.searchParams.get('checkout_configuration_ids[]'),'ch_Test');assert.equal(url.searchParams.get('after'),'cursor1');
 response={data:[],page_info:{has_next_page:true,end_cursor:'cursor1'}};await assert.rejects(()=>list({...row,payment_scan_cursor:'cursor1'}));
 let dbCalls=0;
 const route=load('../../app/api/cron/topup-reconcile/route.ts',{
  '@/lib/server/cron-auth':{authorizedCron:request=>request.headers.get('authorization')==='Bearer fake-test-secret'},
  '@/lib/billing/config':{billingConfig:()=>({configured:true})},
  '@/lib/billing/database':{billingDatabase:()=>{dbCalls++;return {rpc:async()=>({data:{overdue:true},error:null})};}},
  '@/lib/billing/topup-delivery':{},'@/lib/billing/topup-payment-list':{},'@/lib/billing/topup-reconcile-job':{runTopupReconcileJob:async()=>({status:'succeeded',runId:1,stats:{}})},
 });
 assert.equal((await route.GET(new Request('https://staging.example/api/cron/topup-reconcile'))).status,401);assert.equal(dbCalls,0);
 env.MAKEBORNE_TOPUP_RECONCILE_ENABLED='false';
 const authorized=new Request('https://staging.example/api/cron/topup-reconcile',{headers:{authorization:'Bearer fake-test-secret'}});
 assert.equal((await route.GET(authorized)).status,503);assert.equal(dbCalls,0);
 env.MAKEBORNE_TOPUP_RECONCILE_ENABLED='true';
 assert.equal((await route.POST(authorized)).status,200);assert.equal(dbCalls,1);
 console.log('PASS: queue lease, replay, persistent cursor, failures/deadlines, backlog, missing binding, refund refresh, exact merchant/checkout ownership and cursor validation');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
