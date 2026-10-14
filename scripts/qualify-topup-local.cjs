/* eslint-disable @typescript-eslint/no-require-imports -- Disposable offline qualification transport. */
// No provider credentials, HTTP clients, cloud access, or protected-stack targets.
// Usage: init NAME BINDING_JSON [synthetic|captured], checkout NAME PLAN_JSON RESPONSE_JSON,
//        deliver NAME PAYMENT_JSON, inspect NAME, pause NAME, resume NAME, cleanup NAME.
// Captured responses are supplied by the operator. This is NOT signed-webhook proof.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process'),{randomUUID,createHash}=require('node:crypto'),ts=require('typescript');
const ROOT=path.resolve(__dirname,'..'),BASE=path.join(ROOT,'work','topup-qualification');
const IMAGE='public.ecr.aws/supabase/postgres:17.11.0.002',DB='topup_qualification';
const MERCHANT='biz_e4w3EGe3izP67k',PLAN='plan_bfmAY3ekgPP6G',VERSION='credit-packs-preview-2026-10-05';
const [command,name,...args]=process.argv.slice(2);
assert.match(name??'',/^[a-z][a-z0-9-]{2,48}$/,'Pass a unique local run name');
const directory=path.join(BASE,name),stateFile=path.join(directory,'state.json');
const sha=value=>createHash('sha256').update(value).digest('hex');
const quote=value=>`'${String(value).replaceAll("'","''")}'`;
const emit=value=>console.log(JSON.stringify(value));
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
function write(file,value){fs.writeFileSync(path.join(directory,file),JSON.stringify(value,null,2)+'\n',{flag:'w'});}
function fixture(file){
 const absolute=path.resolve(ROOT,file);const work=path.join(ROOT,'work')+path.sep;
 assert(absolute.startsWith(work),'Fixtures must be in ignored work/');
 const text=fs.readFileSync(absolute,'utf8').replace(/^\uFEFF/,'');assert(Buffer.byteLength(text)<1024*1024,'Fixture too large');
 const result=JSON.parse(text);
 function noSecrets(value){if(value&&typeof value==='object')for(const [key,child]of Object.entries(value)){
  // Whop returns client_secret:null on completed payments. Null contains no
  // credential; every non-null credential field remains forbidden recursively.
  assert(child===null||!/^(api.?key|.*secret|password|authorization|access_token|refresh_token|id_token)$/i.test(key),'Credential fields are forbidden');noSecrets(child);
 }}noSecrets(result);return {value:result,sha256:sha(text),path:path.relative(ROOT,absolute)};
}
function docker(args,input){const r=spawnSync('docker',args,{input,encoding:'utf8',maxBuffer:64*1024*1024,timeout:120000});if(r.error)throw r.error;return r;}
function sql(state,text,{admin=false,database=DB,allowFailure=false}={}){
 const r=docker(['exec','-i',state.container,'psql','-U',admin?'supabase_admin':'postgres','-d',database,'-v','ON_ERROR_STOP=1','-q','-At'],text);
 if(r.status&&!allowFailure)throw new Error(`Disposable SQL failed: ${r.stderr.slice(-1500)}`);
 return {ok:r.status===0,output:r.stdout.trim(),error:r.stderr};
}
function inspectTarget(state){
 assert.equal(state.database,DB);assert.match(state.container,/^makeborne_topup_qualification_[a-f0-9]{32}$/);
 const r=docker(['inspect',state.container]);assert.equal(r.status,0,'Owned disposable container missing');const [item]=JSON.parse(r.stdout);
 assert.equal(item.Name,'/'+state.container);assert.equal(item.Config.Image,IMAGE);assert.equal(item.Config.Labels?.['makeborne.topup-qualification'],state.runId);
 assert.equal(item.HostConfig.NetworkMode,'none');assert.equal(Object.keys(item.HostConfig.PortBindings??{}).length,0);return item;
}
function sourceManifest(){
 const baseline=JSON.parse(read('docs/release-review/production-baseline.json')).rows[0].baseline.versions;
 const files=fs.readdirSync(path.join(ROOT,'supabase','migrations')).filter(f=>f.endsWith('.sql')&&!baseline.includes(f.slice(0,14))).sort();
 return {baseline,files,hashes:files.map(file=>({file,sha256:sha(read('supabase/migrations/'+file))}))};
}
async function init(){
 assert(!fs.existsSync(stateFile),'Run already exists; choose another name');
 const binding=fixture(args[0]);assert.equal(binding.value.companyId,MERCHANT);assert.equal(binding.value.packPlanId,PLAN);assert.match(binding.value.whopUserId,/^user_[A-Za-z0-9]+$/);
 const mode=args[1]??'captured';assert(['synthetic','captured'].includes(mode));
 const image=docker(['image','inspect',IMAGE]);assert.equal(image.status,0,'Cached image missing; pulls are prohibited');
 fs.mkdirSync(directory,{recursive:true});const runId=randomUUID();const state={runId,container:'makeborne_topup_qualification_'+runId.replaceAll('-',''),database:DB,mode,userId:randomUUID(),requestId:randomUUID(),binding:binding.value,bindingSha256:binding.sha256,phase:'initializing',providerCalls:0,signedWebhookProof:false};write('state.json',state);
 const started=docker(['run','--pull=never','--network=none','--label','makeborne.topup-qualification='+runId,'-d','--name',state.container,'-e','POSTGRES_PASSWORD=topup-disposable-local-only','-e','POSTGRES_USER=supabase_admin','-e','POSTGRES_DB=postgres',IMAGE,'postgres','-D','/etc/postgresql']);assert.equal(started.status,0,started.stderr);
 inspectTarget(state);
 let ready=false;for(let i=0;i<90;i++){if(docker(['exec',state.container,'pg_isready','-U','supabase_admin','-h','localhost']).status===0&&sql(state,'select 1',{admin:true,database:'postgres',allowFailure:true}).ok){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,1000));}assert(ready,'Disposable database did not become ready');
 sql(state,`drop schema auth cascade; drop schema storage cascade; create database ${DB} owner postgres;`,{admin:true,database:'postgres'});
 // Match the reviewed rehearsal baseline; tolerates only known platform duplicates.
 const platform=docker(['exec','-i',state.container,'psql','-U','supabase_admin','-d',DB,'-q'],read('docs/release-review/staging-platform-schema.sql'));
 const unexpected=platform.stderr.split(/\r?\n/).filter(line=>line.includes('ERROR')&&!/already exists|relation "public\.workspaces" does not exist/.test(line));assert.deepEqual(unexpected,[]);
 sql(state,'create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; create extension if not exists "uuid-ossp" with schema extensions; grant usage on schema extensions to postgres,anon,authenticated,service_role;',{admin:true});
 sql(state,read('docs/release-review/production-schema.sql'),{admin:true});
 const policies=[...read('docs/release-review/staging-platform-schema.sql').matchAll(/CREATE POLICY [^;]*?public\.workspaces[\s\S]*?;\n/g)].map(m=>m[0]).join('');sql(state,policies,{admin:true});
 const source=sourceManifest();
 for(const file of source.files)sql(state,read('supabase/migrations/'+file));
 assert.equal(sql(state,'select count(*) from auth.users').output,'0','Expected an empty synthetic database');
 sql(state,`begin; insert into auth.users(id,email,email_confirmed_at) values(${quote(state.userId)},${quote(state.userId+'@topup-qualification.example.invalid')},now());
 insert into makeborne_private.account_privileges(user_id,is_admin,reason) values(${quote(state.userId)},true,'Disposable adapter qualification only');
 update makeborne_private.topup_catalog set enabled=true,merchant_id=${quote(MERCHANT)},plan_id=${quote(PLAN)} where version=${quote(VERSION)} and pack_id='boost_100'; commit;`);
 const result=sql(state,`set role service_role; select public.makeborne_prepare_topup(${quote(state.userId)},${quote(state.requestId)},'boost_100',${quote(VERSION)},${quote(binding.value.whopUserId)})::text;`);
 state.orderId=JSON.parse(result.output.split('\n').at(-1)).id;state.phase='prepared';state.migrations=source.hashes;state.adapterSources=adapterHashes();write('state.json',state);
 emit({phase:state.phase,run:name,orderId:state.orderId,pendingMigrations:source.files.length,statePath:path.relative(ROOT,stateFile),providerCalls:0});
}
const rpcSignatures={makeborne_claim_topup_checkout:['p_user','p_order','p_request'],makeborne_save_topup_checkout:['p_user','p_order','p_checkout','p_url'],makeborne_find_topup_payment:['p_payment','p_checkout','p_plan','p_merchant'],makeborne_reconcile_topup:['p_user','p_order','p_payment']};
function adapterHashes(){return ['topup-checkout.ts','topup-delivery.ts','topup-fulfillment.ts','topups-contracts.ts','topups-reconcile.ts','topups-catalog.ts','whop.ts','plans.ts'].map(file=>({file,sha256:sha(read('src/lib/billing/'+file))}));}
function snapshot(state){return JSON.parse(sql(state,`select jsonb_build_object('order',(select jsonb_build_object('id',id,'state',state,'granted',granted,'checkoutId',checkout_id,'paymentId',payment_id,'checkoutAttempts',checkout_attempts) from makeborne_private.topup_orders where id=${quote(state.orderId)} and user_id=${quote(state.userId)}),'available',makeborne_private.credit_available(${quote(state.userId)}),'ledger',(select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'delta',delta,'reference',reference)),'[]') from public.credit_ledger where user_id=${quote(state.userId)}),'lots',(select coalesce(jsonb_agg(jsonb_build_object('source',source,'amount',amount,'spent',spent,'held',held,'lapsed',lapsed,'expiresAt',expires_at)),'[]') from makeborne_private.credit_lots where user_id=${quote(state.userId)}));`).output);}
function adapter(state,transport){
 const rpc=async(fn,args)=>{assert(Object.hasOwn(rpcSignatures,fn),'RPC not allowlisted');const params=rpcSignatures[fn].map(key=>`${key} => ${args[key]==null?'null':quote(typeof args[key]==='object'?JSON.stringify(args[key]):args[key])}${args[key]!=null&&typeof args[key]==='object'?'::jsonb':''}`).join(',');
  const r=sql(state,`set role service_role; select to_jsonb(public.${fn}(${params}));`,{allowFailure:true});return r.ok?{data:JSON.parse(r.output.split('\n').at(-1)),error:null}:{data:null,error:{message:'Disposable RPC rejected'}};
 };
 class RequestError extends Error{constructor(code,message,status){super(message);Object.assign(this,{code,status});}}
 const cache=new Map();let whop;
 function load(filename){filename=path.resolve(ROOT,'src/lib/billing',filename);if(cache.has(filename))return cache.get(filename);
  assert(filename.startsWith(path.join(ROOT,'src')+path.sep)&&filename.endsWith('.ts'),'Adapter import outside source');
  const mocks={'server-only':{},'@/lib/server/http':{RequestError},'./config':{billingConfig:()=>({companyId:MERCHANT,sandbox:true})},'./database':{billingDatabase:()=>({rpc})}};
  const context={exports:{},Buffer,Date,JSON,BigInt,Number,Set,String,URL,URLSearchParams,process:{env:{WHOP_API_BASE_URL:'https://sandbox-api.whop.com/api/v1'}},require:key=>{
   if(Object.hasOwn(mocks,key))return mocks[key];if(key==='./whop'&&!filename.endsWith(path.sep+'whop.ts'))return {...whop,...transport};
   if(key.startsWith('@/'))return load(path.resolve(ROOT,'src',key.slice(2))+'.ts');if(key.startsWith('.'))return load(path.resolve(path.dirname(filename),key)+'.ts');
   assert.equal(key,'zod','Unapproved adapter dependency');return require('zod');
  }};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context,{filename});cache.set(filename,context.exports);return context.exports;
 }
 whop=load('whop.ts');return {load,rpc};
}
async function checkout(state){
 assert.equal(state.phase,'prepared');const plan=fixture(args[0]);const responsePath=path.resolve(ROOT,args[1]);assert(responsePath.startsWith(path.join(ROOT,'work')+path.sep));
 let responseEvidence;const {load}=adapter(state,{whopGet:async request=>{assert.equal(request,'/plans/'+PLAN);return plan.value;},whopRequest:async(request,body,options)=>{
  assert.equal(request,'/checkout_configurations');assert.equal(body.plan_id,PLAN);assert.equal(body.metadata.makeborne_topup_order_id,state.orderId);
  const descriptor={apiBase:'https://sandbox-api.whop.com/api/v1',apiVersion:'2025-01-01',method:'POST',path:request,body,idempotencyKey:options.idempotencyKey,planFixtureSha256:plan.sha256,orderId:state.orderId,mode:state.mode};
  state.phase='awaiting-checkout-response';write('state.json',state);
  write('checkout-request.json',descriptor);emit({phase:'awaiting-captured-checkout-response',requestPath:path.relative(ROOT,path.join(directory,'checkout-request.json')),responsePath:path.relative(ROOT,responsePath),providerCalls:0});
  const deadline=Date.now()+15*60*1000;while(!fs.existsSync(responsePath)){if(Date.now()>deadline)throw new Error('Capture wait expired; do not retry provider POST with a new key');await new Promise(resolve=>setTimeout(resolve,500));}
  responseEvidence=fixture(responsePath);return responseEvidence.value;
 }});
 const purchase=JSON.parse(sql(state,`select to_jsonb(o) from makeborne_private.topup_orders o where id=${quote(state.orderId)} and user_id=${quote(state.userId)};`).output);
 const result=await load('topup-checkout.ts').checkoutForTopup(purchase);state.phase='checkout-bound';state.checkoutId=responseEvidence.value.id;state.checkoutResponseSha256=responseEvidence.sha256;state.planFixtureSha256=plan.sha256;write('state.json',state);write('checkout-result.json',{result,responseSha256:responseEvidence.sha256,snapshot:snapshot(state),providerCalls:0,signedWebhookProof:false});emit({phase:state.phase,run:name,checkoutId:state.checkoutId,resultPath:path.relative(ROOT,path.join(directory,'checkout-result.json'))});
}
async function deliver(state){
 assert.equal(state.phase,'checkout-bound');const payment=fixture(args[0]);assert.match(payment.value.id,/^pay_[A-Za-z0-9]+$/);const before=snapshot(state);let reads=0;
 const {load}=adapter(state,{whopGet:async request=>{assert.equal(request,'/payments/'+payment.value.id);reads++;return payment.value;},whopRequest:async()=>{throw new Error('Provider mutations are forbidden');}});
 const deliver=load('topup-delivery.ts').deliverTopupPayment;let result,error;
 try{result=await deliver(payment.value.id);if(result!==true)throw new Error('Payment not recognized as this bound pack');await deliver(payment.value.id);}catch(e){error={code:e.code??'LOCAL_ADAPTER_ERROR',message:e.message};}
 const after=snapshot(state);const report={mode:state.mode,proof:'Captured response through real adapter and service-role SQL; no HTTP or signed-webhook proof',paymentFixtureSha256:payment.sha256,paymentId:payment.value.id,adapterSources:adapterHashes(),before,after,result,error:error??null,repeatedDelivery:!error,fixtureReads:reads,providerCalls:0,signedWebhookProof:false};
 write('delivery-'+Date.now()+'.json',report);emit({phase:error?'delivery-refused':'delivery-verified',errorCode:error?.code??null,paymentId:payment.value.id,available:after.available,orderState:after.order?.state,mode:state.mode,providerCalls:0});if(error)process.exitCode=1;
}
(async()=>{
 if(command==='init')return init();
 assert(fs.existsSync(stateFile),'Unknown qualification run');const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));const target=inspectTarget(state);
 if(command==='pause'){if(target.State.Running){const r=docker(['stop',state.container]);assert.equal(r.status,0);}return emit({phase:'paused',container:state.container,orderPhase:state.phase,volumesPreserved:true});}
 if(command==='resume'){
  assert.deepEqual(sourceManifest().hashes,state.migrations,'Migration source changed since initialization');assert.deepEqual(adapterHashes(),state.adapterSources,'Adapter source changed since initialization');
  if(!target.State.Running){const r=docker(['start',state.container]);assert.equal(r.status,0);}
  let ready=false;for(let i=0;i<60;i++){if(docker(['exec',state.container,'pg_isready','-U','supabase_admin','-h','localhost']).status===0){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,1000));}assert(ready,'Disposable database did not become ready');
  assert.equal(sql(state,'select current_database()').output,DB);return emit({phase:'resumed',container:state.container,orderPhase:state.phase,snapshot:snapshot(state)});
 }
 if(command==='cleanup'){if(target.State.Running){const r=docker(['stop',state.container]);assert.equal(r.status,0);}const r=docker(['rm','-v',state.container]);assert.equal(r.status,0);state.phase='cleaned';write('state.json',state);return emit({phase:'cleaned',container:state.container});}
 assert(target.State.Running,'Owned container is not running');assert.equal(sql(state,'select current_database()').output,DB);
 assert.deepEqual(sourceManifest().hashes,state.migrations,'Migration source changed since initialization');assert.deepEqual(adapterHashes(),state.adapterSources,'Adapter source changed since initialization');
 if(command==='checkout')return checkout(state);if(command==='deliver')return deliver(state);if(command==='inspect')return emit(snapshot(state));throw new Error('Unknown command');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
