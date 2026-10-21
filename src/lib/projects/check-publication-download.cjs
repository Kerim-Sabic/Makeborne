/* eslint-disable @typescript-eslint/no-require-imports -- Offline private source broker and controller transport checks. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const modules=new Map(),routeEnv={env:{}},routeCalls=[];let routeData;
let routeTransport=async()=>{throw Error('UNEXPECTED_TEST_NETWORK');};
function load(file){
 file=path.resolve(file);if(modules.has(file))return modules.get(file).exports;
 const mod={exports:{}};modules.set(file,mod);
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{module:mod,exports:mod.exports,Buffer,TextEncoder,TextDecoder,AbortSignal,AbortController,Error,Request,Response,ReadableStream,URL,fetch:(...args)=>routeTransport(...args),process:routeEnv,
  require(name){if(name==='server-only')return {};if(['zod','node:crypto'].includes(name))return require(name);
   if(name==='@/lib/billing/database')return {billingDatabase:()=>({rpc:(name,args)=>{routeCalls.push({name,args});return {abortSignal:async()=>({data:routeData,error:null})};}})};
   let resolved=name.startsWith('@/')?path.resolve('src',name.slice(2)):path.resolve(path.dirname(file),name);
   if(!path.extname(resolved))resolved+='.ts';return load(resolved);}}, {filename:file});
 return mod.exports;
}
const contract=load('src/lib/projects/publication-download-contract.ts');
const {publicationSourceDownloader}=load('src/lib/projects/publication-download.ts');
const {publicationAssetBroker,publicationStorageReader}=load('src/lib/projects/publication-asset-broker.ts');
const {POST}=load('src/app/api/hosting/publication-assets/route.ts');
const {STAGING_SUPABASE_URL}=load('infra/customer-sites/namespace-policy.js');
const secret='a1'.repeat(32),origin='https://makeborne-release-staging-kerimsabic-6594s-projects.vercel.app',now=Date.now(),url=origin+contract.PUBLICATION_ASSET_PATH;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');let checks=0;
function signed(context,opts={}){
 const body=opts.body??JSON.stringify(context),time=opts.time??String(Math.floor(now/1000));
 return new Request(opts.url??url,{method:'POST',body,signal:opts.signal,headers:{'content-type':'application/json','x-makeborne-asset-time':time,
  'x-makeborne-asset-signature':opts.signature??contract.publicationAssetSignature(secret,origin,time,body),...opts.headers}});
}
function fixture(size=17){
 const bytes=Buffer.alloc(size,42),context={preparationId:randomUUID(),workerId:randomUUID(),fence:'2',assetId:randomUUID()},workspaceId=randomUUID(),projectId=randomUUID();
 const asset={id:context.assetId,path:'public/artwork/hero.png',sha256:hash(bytes),bytes:bytes.length,mediaType:'image/png'};
 const record={id:asset.id,workspace_id:workspaceId,project_id:projectId,object_path:`${workspaceId}/${projectId}/original/hero.png`,content_type:asset.mediaType,sha256:asset.sha256};
 const loaded={id:context.preparationId,state:'running',versionId:randomUUID(),scope:{workspaceId,projectId,artifactId:randomUUID()},assetRecords:[record],
  content:{websiteSource:{schemaVersion:1,toolchainId:'react-vite-v1',entrypoint:'src/main.tsx',files:[{path:'package.json',content:'{}'},
   {path:'package-lock.json',content:'{}'},{path:'index.html',content:'<div id="root"></div>'},{path:'src/main.tsx',content:'export {}'}],assets:[asset],routes:[{path:'/',title:'Home'}]}}};
 const calls={load:[],read:[]},deps={secret,origin,workspaceId,now:()=>now,async load(ctx,signal){calls.load.push({ctx,signal});return structuredClone(loaded);},
  async read(objectPath,maximum,signal){calls.read.push({objectPath,maximum,signal});return bytes;}};
 return {bytes,context,workspaceId,record,asset,loaded,calls,deps,run:opts=>publicationAssetBroker(deps)(signed(context,opts))};
}
async function check(name,fn){await fn();checks++;console.log(`PASS ${name}`);}
async function denied(f,opts){const response=await f.run(opts);assert.equal(response.status,403);assert.equal(await response.text(),'Private source unavailable.');}
async function main(){
 await check('operator origin is required, exact approved project only; HMAC cannot move between approved deployments',async()=>{
  for(const value of ['', 'https://makeborne.com','https://evil.example','http://makeborne-release-staging-kerimsabic-6594s-projects.vercel.app',
   origin+'/',origin+':443',origin+'.evil.example',origin+'?x=1',origin.replace('https://','https://user:pass@')])
   assert.throws(()=>publicationSourceDownloader({secret,origin:value}));
  const next='https://makeborne-release-staging-abcdef123-kerimsabic-6594s-projects.vercel.app';
  contract.assertPublicationAssetOrigin(next);const f=fixture(),body=JSON.stringify(f.context),time=String(Math.floor(now/1000));
  f.deps.origin=next;
  await denied(f,{url:next+contract.PUBLICATION_ASSET_PATH,signature:contract.publicationAssetSignature(secret,origin,time,body)});
  assert.equal(f.calls.load.length,0);
 });
 await check('preview bypass credential stays in fixed broker header, never URL/body/Storage; configuration captured immutably',async()=>{
  const f=fixture(),captured=[],bypass='fixture-automation-token';
  f.deps.read=publicationStorageReader('sb_secret_fixture',async(u,init)=>{captured.push({u,init});return new Response(f.bytes);});
  const config={secret,origin,protectionBypassSecret:bypass,now:()=>now,fetch:async(u,init)=>{captured.push({u,init});return publicationAssetBroker(f.deps)(new Request(u,init));}};
  const down=publicationSourceDownloader(config);config.origin='https://evil.example';config.secret='0'.repeat(64);config.protectionBypassSecret='changed';
  await down('',17,new AbortController().signal,f.context);assert.equal(captured.length,2);
  assert.equal(captured[0].u,url);assert.equal(captured[0].init.headers['x-vercel-protection-bypass'],bypass);
  assert(!captured[0].init.body.includes(bypass));assert(!captured[0].u.includes(bypass));assert(!JSON.stringify(captured[1]).includes(bypass));
  assert(!('x-vercel-set-bypass-cookie' in captured[0].init.headers));assert(!('apikey' in captured[0].init.headers));
  for(const invalid of ['', 'x\r\ny', 'x'.repeat(513)])assert.throws(()=>publicationSourceDownloader({secret,origin,protectionBypassSecret:invalid}));
 });
 await check('signed controller request passes broker, exact original bytes and two active fence checks',async()=>{
  const f=fixture();let request;
  const download=publicationSourceDownloader({secret,origin,now:()=>now,fetch:async(u,init)=>{request={u,init};return publicationAssetBroker(f.deps)(new Request(u,init));}});
  assert.deepEqual(Buffer.from(await download('ignored/private/path',f.bytes.length,new AbortController().signal,f.context)),f.bytes);
  assert.equal(request.u,url);assert.equal(request.init.redirect,'error');assert.equal(request.init.credentials,'omit');
  assert(!request.init.body.includes('ignored'));assert(!JSON.stringify(request).includes(secret));assert.equal(f.calls.load.length,2);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.load[0].ctx)),f.context);assert.equal(f.calls.read[0].maximum,f.bytes.length);
 });
 await check('unsigned, tampered identities, old/future timestamps and wrong fixed origins fail before authority/storage',async()=>{
  const original=fixture(),body=JSON.stringify(original.context),signature=contract.publicationAssetSignature(secret,origin,String(Math.floor(now/1000)),body);
  for(const opts of [{signature:''},{signature:'0'.repeat(64)},{time:String(Math.floor(now/1000)-31)},{time:String(Math.floor(now/1000)+31)},
   {url:'https://makeborne.com'+contract.PUBLICATION_ASSET_PATH},{url:url+'?asset=x'},
   ...['preparationId','workerId','fence','assetId'].map(key=>({body:JSON.stringify({...original.context,[key]:key==='fence'?'3':randomUUID()}),signature}))]){
   const f=fixture();await denied(f,opts);assert.equal(f.calls.load.length,0);assert.equal(f.calls.read.length,0);
  }
 });
 await check('bounded signed bodies reject extra path, invalid fences, compressed body and invalid UTF8',async()=>{
  for(const context of [{...fixture().context,objectPath:'private'}, {...fixture().context,fence:'9223372036854775808'}, {...fixture().context,fence:'0'}]){
   const f=fixture();await denied(f,{body:JSON.stringify(context)});assert.equal(f.calls.load.length,0);
  }
  for(const opts of [{body:' '.repeat(1025)},{headers:{'content-encoding':'gzip'}},{headers:{'content-type':'text/plain'}}]){
   const f=fixture();await denied(f,opts);assert.equal(f.calls.load.length,0);
  }
  const f=fixture(),request=new Request(url,{method:'POST',body:Uint8Array.of(0xff),headers:{'content-type':'application/json'}});
  assert.equal((await publicationAssetBroker(f.deps)(request)).status,403);assert.equal(f.calls.load.length,0);
 });
 await check('private replay is read-only and reevaluates current authority; revoked second read is denied',async()=>{
  const f=fixture();assert.equal((await f.run()).status,200);f.deps.load=async()=>{throw Error('sensitive revocation details');};
  await denied(f);assert.equal(f.calls.read.length,1);
 });
 await check('wrong scope, descriptor identity, hash/type, duplicates and unsafe locators cannot trigger privileged reads',async()=>{
  for(const change of [f=>f.loaded.scope.workspaceId=randomUUID(),f=>f.record.project_id=randomUUID(),f=>f.record.id=randomUUID(),
   f=>f.record.sha256='f'.repeat(64),f=>f.record.content_type='image/svg+xml',f=>f.loaded.assetRecords.push({...f.record}),
   ...['../x','%2e/x','x?token=y','x\\y','x//y','./x','x\0y'].map(suffix=>f=>f.record.object_path=`${f.workspaceId}/${f.record.project_id}/${suffix}`)]){
   const f=fixture();change(f);await denied(f);assert.equal(f.calls.read.length,0);
  }
 });
 await check('read corruption and post-read authority/version/path mutation emit no source bytes',async()=>{
  for(const change of ['hash','length','version','path','revoked']){
   const f=fixture(),read=f.deps.read;f.deps.read=async(...args)=>{
    const bytes=await read(...args);
    if(change==='hash')return Buffer.alloc(bytes.length,1);if(change==='length')return bytes.subarray(1);
    if(change==='version')f.loaded.versionId=randomUUID();if(change==='path')f.record.object_path+='.changed';
    if(change==='revoked')f.deps.load=async()=>{throw Error('secret');};return bytes;
   };await denied(f);
  }
 });
 await check('full20 MB source streams in64 KiB chunks without Content-Length; no silent truncation',async()=>{
  const f=fixture(20_000_000),response=await f.run();assert.equal(response.status,200);assert(!response.headers.has('content-length'));
  assert.equal(response.headers.get('x-makeborne-asset-bytes'),'20000000');assert.match(response.headers.get('cache-control'),/no-store/);
  const reader=response.body.getReader();let total=0,chunks=0;while(true){const part=await reader.read();if(part.done)break;
   assert(part.value.byteLength<=65536);total+=part.value.byteLength;chunks++;}assert.equal(total,20_000_000);assert(chunks>300);
  const over=fixture(20_000_001);await denied(over);assert.equal(over.calls.read.length,0);
 });
 await check('fixed Storage GET uses only app apikey, exact encoded locator, no redirects and bounded body',async()=>{
  const calls=[],bytes=Buffer.from('abcd');const read=publicationStorageReader('sb_secret_fixture',async(u,init)=>{calls.push({u,init});return new Response(bytes);});
  assert.deepEqual(Buffer.from(await read('workspace/project/a b.png',4,new AbortController().signal)),bytes);
  assert.equal(calls[0].u,STAGING_SUPABASE_URL+'/storage/v1/object/authenticated/project-assets/workspace/project/a%20b.png');
  assert.equal(calls[0].init.headers.apikey,'sb_secret_fixture');assert(!('authorization' in calls[0].init.headers));assert.equal(calls[0].init.redirect,'error');
  await assert.rejects(read('../secret',4,new AbortController().signal));assert.equal(calls.length,1);
 });
 await check('Storage and controller reject redirect/status/encoding/size/short/long streams; errors contain no remote details',async()=>{
  for(const make of [()=>new Response('credential leaked',{status:302}),()=>new Response('x',{headers:{'content-length':'99999999'}}),
   ()=>new Response('abcd',{headers:{'content-encoding':'gzip'}}),()=>new Response('abc'),()=>new Response('abcde')]){
   const read=publicationStorageReader('sb_secret_fixture',async()=>make());await assert.rejects(read('a/b/c',4,new AbortController().signal));
  }
  const f=fixture();for(const response of [new Response('secret',{status:503}),new Response(f.bytes,{headers:{'content-type':'image/png','x-makeborne-asset-bytes':'17'}}),
   new Response(f.bytes,{headers:{'content-type':'application/octet-stream','x-makeborne-asset-bytes':'18'}})]){
   const down=publicationSourceDownloader({secret,origin,fetch:async()=>response});await assert.rejects(down('',17,new AbortController().signal,f.context),/PUBLICATION_ASSET_DOWNLOAD_FAILED/);
  }
 });
 await check('aborted source fetch or stalled body returns promptly; late response is canceled',async()=>{
  const f=fixture(),abort=new AbortController();let resolve,canceled=false;
  const down=publicationSourceDownloader({secret,origin,fetch:()=>new Promise(r=>resolve=r)});
  const pending=down('',17,abort.signal,f.context);await new Promise(r=>setTimeout(r,5));abort.abort();await assert.rejects(pending,/DOWNLOAD_FAILED/);
  resolve(new Response(new ReadableStream({cancel(){canceled=true;}})));await new Promise(r=>setTimeout(r,5));assert(canceled);
  const abort2=new AbortController();const read=publicationStorageReader('sb_secret_fixture',async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{});}})));
  const stalled=read('a/b/c',4,abort2.signal);await new Promise(r=>setTimeout(r,5));abort2.abort();await assert.rejects(stalled);
 });
 await check('abort between HTTP headers and body read cancels response and yields no bytes',async()=>{
  const f=fixture(),abort=new AbortController();let canceled=false;
  const down=publicationSourceDownloader({secret,origin,fetch:async()=>{
   const response=new Response(new ReadableStream({cancel(){canceled=true;}}),{headers:{'content-type':'application/octet-stream','x-makeborne-asset-bytes':'17'}});
   abort.abort();return response;
  }});
  await assert.rejects(down('',17,abort.signal,f.context),/DOWNLOAD_FAILED/);await new Promise(r=>setTimeout(r,5));assert(canceled);
 });
 await check('aborted broker load/read and cancellation after verified stream prevent further source delivery',async()=>{
  for(const stage of ['load','read']){const f=fixture(),abort=new AbortController();f.deps[stage]=()=>new Promise(()=>{});
   const pending=f.run({signal:abort.signal});await new Promise(r=>setTimeout(r,5));abort.abort();assert.equal((await pending).status,403);}
  const f=fixture(),abort=new AbortController(),response=await f.run({signal:abort.signal});abort.abort();await assert.rejects(response.arrayBuffer());
 });
 await check('route is disabled by default and production/mismatched database config never reaches privileged RPC',async()=>{
  const f=fixture();for(const env of [{},{MAKEBORNE_PUBLICATION_ASSET_BROKER_ENABLED:'true'},
   {MAKEBORNE_PUBLICATION_ASSET_BROKER_ENABLED:'true',MAKEBORNE_PUBLICATION_ASSET_BROKER_SECRET:secret,MAKEBORNE_PUBLICATION_ASSET_BROKER_ORIGIN:origin,MAKEBORNE_HOSTING_NAMESPACE:'production',NEXT_PUBLIC_SUPABASE_URL:STAGING_SUPABASE_URL,MAKEBORNE_STAGING_QA_WORKSPACE_ID:f.workspaceId}]){
   routeEnv.env=env;assert.equal((await POST(signed(f.context))).status,503);
  }assert.equal(routeCalls.length,0);
  routeEnv.env={MAKEBORNE_PUBLICATION_ASSET_BROKER_ENABLED:'true',MAKEBORNE_PUBLICATION_ASSET_BROKER_SECRET:secret,MAKEBORNE_PUBLICATION_ASSET_BROKER_ORIGIN:origin,MAKEBORNE_HOSTING_NAMESPACE:'staging',NEXT_PUBLIC_SUPABASE_URL:STAGING_SUPABASE_URL,MAKEBORNE_STAGING_QA_WORKSPACE_ID:f.workspaceId};
  assert.equal((await POST(signed(f.context,{signature:'0'.repeat(64)}))).status,403);assert.equal(routeCalls.length,0);
  routeData=null;assert.equal((await POST(signed(f.context))).status,403);assert.equal(routeCalls.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(routeCalls[0])),{name:'makeborne_load_publication_preparation',args:{p_preparation:f.context.preparationId,p_worker:f.context.workerId,p_fence:'2'}});
 });
 await check('production broker requires exact production deployment/database/rollout and denies mixed profiles before privileged access',async()=>{
  const {publicationBrokerProfile}=load('src/lib/projects/publication-broker-profile.ts'),{PRODUCTION,STAGING}=load('infra/publication-controller/profiles.mjs');
  const f=fixture(),env={MAKEBORNE_PUBLICATION_ASSET_BROKER_ENABLED:'true',MAKEBORNE_HOSTING_NAMESPACE:'production',MAKEBORNE_PUBLICATION_ASSET_BROKER_ORIGIN:'https://makeborne.com',NEXT_PUBLIC_SUPABASE_URL:`https://${PRODUCTION.projectRef}.supabase.co`,VERCEL_PROJECT_ID:PRODUCTION.projectId,VERCEL_ENV:'production',MAKEBORNE_PUBLICATION_WORKSPACE_IDS:f.workspaceId};
  assert.equal(publicationBrokerProfile(env).workspaceIds[0],f.workspaceId);
  for(const patch of [{VERCEL_ENV:'preview'},{VERCEL_PROJECT_ID:STAGING.projectId},{NEXT_PUBLIC_SUPABASE_URL:STAGING_SUPABASE_URL},{MAKEBORNE_HOSTING_NAMESPACE:'staging'},{MAKEBORNE_PUBLICATION_ASSET_BROKER_ORIGIN:origin},{MAKEBORNE_STAGING_QA_WORKSPACE_ID:f.workspaceId},{MAKEBORNE_PUBLICATION_WORKSPACE_IDS:''},{MAKEBORNE_PUBLICATION_WORKSPACE_IDS:f.workspaceId+','+f.workspaceId}])assert.throws(()=>publicationBrokerProfile({...env,...patch}));
 });
 await check('production asset transport binds signature, fixed storage project and multiple allowed workspaces without a preview bypass',async()=>{
  const f=fixture(),production='https://makeborne.com',{workspaceId,...rest}=f.deps;
  const deps={...rest,origin:production,namespace:'production',workspaceIds:[workspaceId,randomUUID()]};
  const down=publicationSourceDownloader({secret,origin:production,namespace:'production',now:()=>now,fetch:async(u,init)=>{assert(!('x-vercel-protection-bypass' in init.headers));return publicationAssetBroker(deps)(new Request(u,init));}});
  assert.deepEqual(Buffer.from(await down('',17,new AbortController().signal,f.context)),f.bytes);
  assert.throws(()=>publicationSourceDownloader({secret,origin,namespace:'production'}));assert.throws(()=>publicationSourceDownloader({secret,origin:production,namespace:'production',protectionBypassSecret:'not-allowed'}));
  const restricted={...deps,workspaceIds:[randomUUID()]};
  const refused=publicationSourceDownloader({secret,origin:production,namespace:'production',now:()=>now,fetch:async(u,init)=>publicationAssetBroker(restricted)(new Request(u,init))});
  const reads=f.calls.read.length;await assert.rejects(refused('',17,new AbortController().signal,f.context));assert.equal(f.calls.read.length,reads);
  let target;const read=publicationStorageReader('sb_secret_fixture',async u=>{target=u;return new Response(f.bytes);},'production');await read(f.record.object_path,17,new AbortController().signal);assert.equal(new URL(target).origin,'https://rklojnmmsmhwnkbzuidp.supabase.co');
 });
 await check('actual production route authenticates, reauthorizes and streams only pinned production storage; mixed deployment makes no privileged call',async()=>{
  const f=fixture(),{PRODUCTION,STAGING}=load('infra/publication-controller/profiles.mjs'),production=PRODUCTION.brokerOrigin;
  const env={MAKEBORNE_PUBLICATION_ASSET_BROKER_ENABLED:'true',MAKEBORNE_HOSTING_NAMESPACE:'production',MAKEBORNE_PUBLICATION_ASSET_BROKER_SECRET:secret,MAKEBORNE_PUBLICATION_ASSET_BROKER_ORIGIN:production,NEXT_PUBLIC_SUPABASE_URL:`https://${PRODUCTION.projectRef}.supabase.co`,VERCEL_PROJECT_ID:PRODUCTION.projectId,VERCEL_ENV:'production',MAKEBORNE_PUBLICATION_WORKSPACE_IDS:f.workspaceId,SUPABASE_SECRET_KEY:'sb_secret_fixture'};
  const body=JSON.stringify(f.context),time=String(Math.floor(Date.now()/1000));
  const request=()=>new Request(production+contract.PUBLICATION_ASSET_PATH,{method:'POST',body,headers:{'content-type':'application/json','x-makeborne-asset-time':time,'x-makeborne-asset-signature':contract.publicationAssetSignature(secret,production,time,body)}});
  let reads=0;routeData=f.loaded;routeEnv.env=env;
  routeTransport=async(target,init)=>{reads++;assert.equal(new URL(target).origin,`https://${PRODUCTION.projectRef}.supabase.co`);assert.equal(init.headers.apikey,'sb_secret_fixture');assert(!('x-vercel-protection-bypass' in init.headers));return new Response(f.bytes);};
  try{
   const before=routeCalls.length,response=await POST(request());assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),f.bytes);assert.equal(routeCalls.length-before,2);assert.equal(reads,1);
   routeEnv.env={...env,VERCEL_PROJECT_ID:STAGING.projectId};const calls=routeCalls.length;assert.equal((await POST(request())).status,503);assert.equal(routeCalls.length,calls);assert.equal(reads,1);
   routeEnv.env={...env,MAKEBORNE_PUBLICATION_WORKSPACE_IDS:randomUUID()};assert.equal((await POST(request())).status,403);assert.equal(reads,1);
  }finally{routeTransport=async()=>{throw Error('UNEXPECTED_TEST_NETWORK');};routeData=null;routeEnv.env={};}
 });
 console.log(`${checks} private publication source transport groups passed; only mocked network/storage, no cloud calls.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
