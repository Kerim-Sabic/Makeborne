/* eslint-disable @typescript-eslint/no-require-imports -- Offline tests of the real fenced asset resolver and raster verifier. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto'),sharp=require('sharp');
const modules=new Map();
function load(file){
 file=path.resolve(file);if(modules.has(file))return modules.get(file).exports;
 const compiledModule={exports:{}};modules.set(file,compiledModule);
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{module:compiledModule,exports:compiledModule.exports,Buffer,TextEncoder,AbortSignal,Error,
  require(name){if(name==='server-only')return {};if(['zod','node:crypto','sharp'].includes(name))return require(name);
   assert(name.startsWith('./')||name.startsWith('../'),`Unexpected dependency ${name}`);return load(path.resolve(path.dirname(file),name+'.ts'));}}, {filename:file});
 return compiledModule.exports;
}
const {publicationArtworkResolver}=load('src/lib/projects/publication-assets.ts');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let raster,checks=0;
function fixture(){
 const scope={preparationId:randomUUID(),workerId:randomUUID(),fence:'2',workspaceId:randomUUID(),projectId:randomUUID()};
 const descriptor={id:randomUUID(),path:'public/artwork/hero.png',sha256:hash(raster),bytes:raster.length,mediaType:'image/png'};
 const version={id:randomUUID(),artifactId:randomUUID(),content:{websiteSource:{schemaVersion:1,toolchainId:'react-vite-v1',entrypoint:'src/main.tsx',
  files:[{path:'package.json',content:'{}'},{path:'package-lock.json',content:'{}'},{path:'index.html',content:'<div id="root"></div>'},{path:'src/main.tsx',content:'export {}'}],
  assets:[descriptor],routes:[{path:'/',title:'Home'}]}}};
 const record={id:descriptor.id,workspace_id:scope.workspaceId,project_id:scope.projectId,
  object_path:`${scope.workspaceId}/${scope.projectId}/original/hero.png`,content_type:'image/png',sha256:descriptor.sha256};
 const locator={versionId:version.id,scope:{workspaceId:scope.workspaceId,projectId:scope.projectId,artifactId:version.artifactId},assetRecords:[record]};
 const controller=new AbortController(),calls={rpc:[],download:[]};
 const deps={async rpc(name,args,signal){calls.rpc.push({name,args,signal});return structuredClone(locator);},
  async download(objectPath,maxBytes,signal){calls.download.push({objectPath,maxBytes,signal});return Buffer.from(raster);}};
 return {scope,version,descriptor,record,locator,controller,calls,deps,
  run:()=>publicationArtworkResolver(deps)(scope,version,controller.signal)};
}
async function check(name,fn){await fn();checks++;console.log(`PASS ${name}`);}
async function noDownload(mutate){const f=fixture();mutate(f);await assert.rejects(f.run());assert.equal(f.calls.download.length,0);}
async function main(){
 raster=await sharp({create:{width:2,height:2,channels:4,background:'#ff6033'}}).png().toBuffer();
 await check('only fenced scoped original is downloaded, with exact bounds and bytes; authority checked before and after',async()=>{
  const f=fixture(),result=await f.run();assert.equal(result.length,1);assert.deepEqual(Buffer.from(result[0].bytes),raster);assert.equal(result[0].path,f.descriptor.path);
  assert.equal(f.calls.rpc.length,2);for(const call of f.calls.rpc){assert.equal(call.name,'makeborne_load_publication_preparation');assert.deepEqual(JSON.parse(JSON.stringify(call.args)),{p_preparation:f.scope.preparationId,p_worker:f.scope.workerId,p_fence:'2'});assert.equal(call.signal,f.controller.signal);}
  assert.deepEqual(f.calls.download,[{objectPath:f.record.object_path,maxBytes:raster.length,signal:f.controller.signal}]);
 });
 await check('wrong version, artifact, workspace, project, asset identity, hash or MIME refuses before download',async()=>{
  for(const mutate of [f=>f.locator.versionId=randomUUID(),f=>f.locator.scope.artifactId=randomUUID(),f=>f.locator.scope.workspaceId=randomUUID(),f=>f.locator.scope.projectId=randomUUID(),
   f=>f.record.workspace_id=randomUUID(),f=>f.record.project_id=randomUUID(),f=>f.record.id=randomUUID(),f=>f.record.sha256='a'.repeat(64),f=>f.record.content_type='image/jpeg'])await noDownload(mutate);
 });
 await check('missing, duplicate, extra or malformed original locators refuse before download',async()=>{
  for(const mutate of [f=>f.locator.assetRecords=[],f=>f.locator.assetRecords.push({...f.record}),f=>f.locator.assetRecords.push({...f.record,id:randomUUID()}),
   f=>delete f.record.object_path,f=>f.record.extra='untrusted',f=>f.record.sha256='invalid',f=>f.record.content_type='image/svg+xml',f=>f.record.object_path='x'.repeat(1025)])await noDownload(mutate);
 });
 await check('traversal, encoded paths, controls, URL-like locators and sibling-project prefixes never download',async()=>{
  for(const suffix of ['../hero.png','./hero.png','a//hero.png','a/../hero.png','%2e%2e/hero.png','a\\hero.png','hero.png?token=secret','hero.png#fragment','a\0.png','a\n.png','a\u007f.png']){
   await noDownload(f=>f.record.object_path=`${f.scope.workspaceId}/${f.scope.projectId}/${suffix}`);
  }
  for(const locator of ['https://example.invalid/private.png','/private.png','../private.png'])await noDownload(f=>f.record.object_path=locator);
  await noDownload(f=>f.record.object_path=`${f.scope.workspaceId}/${f.scope.projectId}-sibling/hero.png`);
 });
 await check('invalid source counts, descriptor types and individual/aggregate bounds refuse before locator RPC',async()=>{
  for(const mutate of [f=>f.descriptor.bytes=0,f=>f.descriptor.bytes=20_000_001,f=>f.descriptor.bytes=1.5,f=>f.descriptor.mediaType='image/svg+xml',
   f=>f.version.content.websiteSource.assets.push({...f.descriptor}),
   f=>f.version.content.websiteSource.assets=[0,1,2].map(i=>({...f.descriptor,id:randomUUID(),path:`public/${i}.png`,bytes:15_000_000})),
   f=>f.version.content.websiteSource.assets=Array.from({length:101},(_,i)=>({...f.descriptor,id:randomUUID(),path:`public/${i}.png`}))]){
   const f=fixture();mutate(f);await assert.rejects(f.run());assert.equal(f.calls.rpc.length,0);assert.equal(f.calls.download.length,0);
  }
 });
 await check('truncated, oversized and same-length tampered original bytes are rejected',async()=>{
  for(const bytes of [raster.subarray(0,raster.length-1),Buffer.concat([raster,Buffer.from('x')]),Buffer.alloc(raster.length,1)]){
   const f=fixture();f.deps.download=async()=>bytes;await assert.rejects(f.run(),/PUBLICATION_ASSET_BYTES_INVALID/);assert.equal(f.calls.rpc.length,1);
  }
 });
 await check('matching hash cannot authorize invalid raster bytes or mislabeled media',async()=>{
  const f=fixture(),junk=Buffer.from('This is not an image');f.descriptor.bytes=junk.length;f.descriptor.sha256=hash(junk);f.record.sha256=hash(junk);f.deps.download=async()=>junk;
  await assert.rejects(f.run());assert.equal(f.calls.rpc.length,1);
  const mislabeled=fixture();mislabeled.descriptor.mediaType='image/jpeg';mislabeled.record.content_type='image/jpeg';await assert.rejects(mislabeled.run(),/INVALID_STILL_RASTER/);assert.equal(mislabeled.calls.rpc.length,1);
 });
 await check('asset records may arrive unordered but originals remain bound to canonical source asset order',async()=>{
  const f=fixture(),second={...f.descriptor,id:randomUUID(),path:'public/artwork/alpha.png'};
  f.version.content.websiteSource.assets.push(second);f.locator.assetRecords.unshift({...f.record,id:second.id,object_path:`${f.scope.workspaceId}/${f.scope.projectId}/alpha.png`});
  const results=await f.run();assert.deepEqual(Array.from(results,x=>x.id),[second.id,f.descriptor.id]);assert.equal(f.calls.download.length,2);
  assert.equal(f.calls.download[0].objectPath,f.locator.assetRecords[0].object_path);
 });
 await check('revocation or locator mutation during download prevents returning prepared artwork',async()=>{
  for(const change of ['revoked','scope','path','hash','missing']){
   const f=fixture(),rpc=f.deps.rpc;f.deps.rpc=async(...args)=>{
    if(f.calls.rpc.length===1){
     if(change==='revoked')throw new Error('Current confirmed session required');
     if(change==='scope')f.locator.scope.projectId=randomUUID();
     if(change==='path')f.record.object_path=`${f.scope.workspaceId}/${f.scope.projectId}/changed.png`;
     if(change==='hash')f.record.sha256='b'.repeat(64);
     if(change==='missing')f.locator.assetRecords=[];
    }
    return rpc(...args);
   };
   await assert.rejects(f.run());assert.equal(f.calls.download.length,1);
  }
 });
 await check('locator or download failures surface without substituting artwork',async()=>{
  const f=fixture();f.deps.rpc=async()=>{throw new Error('DATABASE_UNAVAILABLE');};await assert.rejects(f.run(),/DATABASE_UNAVAILABLE/);assert.equal(f.calls.download.length,0);
  const d=fixture();d.deps.download=async()=>{throw new Error('STORAGE_UNAVAILABLE');};await assert.rejects(d.run(),/STORAGE_UNAVAILABLE/);assert.equal(d.calls.rpc.length,1);
 });
 await check('empty artwork still requires both current fenced authority checks',async()=>{
  const f=fixture();f.version.content.websiteSource.assets=[];f.locator.assetRecords=[];assert.equal((await f.run()).length,0);assert.equal(f.calls.rpc.length,2);assert.equal(f.calls.download.length,0);
 });
 await check('pre-aborted requests, including empty artwork, do not query or download',async()=>{
  for(const empty of [false,true]){const f=fixture();if(empty){f.version.content.websiteSource.assets=[];f.locator.assetRecords=[];}f.controller.abort(new Error('ABORTED_BEFORE_RESOLUTION'));
   await assert.rejects(f.run(),/ABORTED_BEFORE_RESOLUTION/);assert.equal(f.calls.rpc.length,0);assert.equal(f.calls.download.length,0);}
 });
 await check('abort during initial locator prevents downloads; abort during final locator refuses retained result',async()=>{
  for(const abortAt of [1,2]){const f=fixture(),rpc=f.deps.rpc;f.deps.rpc=async(...args)=>{const result=await rpc(...args);if(f.calls.rpc.length===abortAt)f.controller.abort(new Error('ABORTED_DURING_LOCATOR'));return result;};
   await assert.rejects(f.run(),/ABORTED_DURING_LOCATOR/);assert.equal(f.calls.download.length,abortAt===1?0:1);}
 });
 await check('abort during a completed download prevents raster processing or final acceptance',async()=>{
  const f=fixture();f.deps.download=async()=>{f.controller.abort(new Error('ABORTED_DURING_DOWNLOAD'));return raster;};await assert.rejects(f.run(),/ABORTED_DURING_DOWNLOAD/);assert.equal(f.calls.rpc.length,1);
 });
 console.log(`${checks} publication artwork regression groups passed; real PNG decoding, no network or provider calls.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
