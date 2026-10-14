/* eslint-disable @typescript-eslint/no-require-imports -- Offline worker orchestration qualification with isolated executor and database doubles. */
const fs=require('node:fs'),ts=require('typescript'),Module=require('node:module'),assert=require('node:assert/strict');
const original=Module._load;let events=[],compileError=null;
const version={id:'55555555-5555-4555-8555-555555555555',artifactId:'33333333-3333-4333-8333-333333333333',number:1,content:{title:'Bakery'}};
Module._load=function(name,parent,main){
 if(name==='server-only')return {};
 if(parent?.filename.endsWith('publication-worker.ts')){
  if(name==='../cloud/mappers')return {mapVersion:value=>value};
  if(name==='./publication-compiler')return {PublicationBindingSchema:{parse:value=>value},compileTrustedPublication:async(input,executor,signal)=>{events.push({name:'compile',input,executor});signal.throwIfAborted();if(compileError)throw compileError;return {trusted:true};}};
  if(name==='./publication-output')return {composePublicationOutput:()=>({receipt:{trusted:true},serializedOutput:{html:'verified'}})};
 }
 return original.call(this,name,parent,main);
};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {runPublicationPreparation}=require('../src/lib/projects/publication-worker.ts');
const prep='44444444-4444-4444-8444-444444444444',worker='66666666-6666-4666-8666-666666666666';
const claim=()=>({id:prep,actorId:'11111111-1111-4111-8111-111111111111',state:'running',scope:{workspaceId:'22222222-2222-4222-8222-222222222222',artifactId:version.artifactId,projectId:'77777777-7777-4777-8777-777777777777'},versionId:version.id,versionNumber:1,publicationRevision:4,versionContentHash:'a'.repeat(64),slug:'bakery',interactive:false,fence:'9',leaseUntil:new Date(Date.now()+60000).toISOString(),version:{...version}});
async function main(){let count=0;async function check(name,fn){events=[];compileError=null;await fn();console.log(`PASS ${name}`);count++;}
 const setup=(row=claim(),failName=null)=>({executor:{qualified:true},address:slug=>`https://${slug}.example/`,resolveArtwork:async(scope)=>{events.push({name:'artwork',scope});return [];},rpc:async(name,args,signal)=>{events.push({name,args,aborted:signal.aborted});if(name===failName)throw new Error('private database detail');return name==='makeborne_claim_publication_preparation'?row:{};}});
 const run=deps=>runPublicationPreparation(prep,worker,deps,new AbortController().signal);
 await check('no claim, expired lease and wrong preparation cannot execute source',async()=>{
  assert.deepEqual(await run(setup(null)),{state:'not_claimed'});
  for(const row of [{...claim(),id:worker},{...claim(),leaseUntil:'2000-01-01T00:00:00Z'}])await assert.rejects(run(setup(row)));
  assert.equal(events.filter(e=>e.name==='compile'||e.name==='artwork').length,0);
 });
 await check('worker validates version identity before resolving assets or compiling',async()=>{
  const row=claim();row.version.number=2;await assert.rejects(run(setup(row)),/PUBLICATION_VERSION_MISMATCH/);assert.equal(events.filter(e=>e.name==='compile'||e.name==='artwork').length,0);assert.equal(events.at(-1).name,'makeborne_fail_publication_preparation');assert.equal(events.at(-1).args.p_fence,'9');
 });
 await check('revoked fence at authority refresh blocks compiler and completion',async()=>{
  await assert.rejects(run(setup(claim(),'makeborne_load_publication_preparation')));assert.equal(events.filter(e=>e.name==='compile'||e.name==='makeborne_complete_publication_preparation').length,0);assert.equal(events.at(-1).args.p_error,'PUBLICATION_PREPARATION_FAILED');
 });
 await check('successful orchestration binds claim scope, refreshes authority, then completes with same fence',async()=>{
  assert.equal((await run(setup())).state,'completed');assert.deepEqual(events.map(e=>e.name),['makeborne_claim_publication_preparation','artwork','makeborne_load_publication_preparation','compile','makeborne_complete_publication_preparation']);
  assert.equal(events[1].scope.preparationId,prep);assert.equal(events[1].scope.workerId,worker);assert.equal(events[1].scope.fence,'9');assert.equal(events[3].input.binding.versionId,version.id);assert.equal(events[3].input.binding.publicationRevision,4);assert.equal(events.at(-1).args.p_fence,'9');
  assert.deepEqual(Object.keys(events[3].executor),['qualified'],'control RPC is never passed to executor');
 });
 await check('compiler failure records only bounded code and cannot complete',async()=>{
  compileError=new Error('token=private-secret');await assert.rejects(run(setup()));assert.equal(events.at(-1).args.p_error,'PUBLICATION_PREPARATION_FAILED');assert.equal(events.filter(e=>e.name==='makeborne_complete_publication_preparation').length,0);
 });
 await check('lost completion response uses fenced failure report; does not recompile or promote',async()=>{
  await assert.rejects(run(setup(claim(),'makeborne_complete_publication_preparation')));assert.equal(events.filter(e=>e.name==='compile').length,1);assert.equal(events.at(-1).name,'makeborne_fail_publication_preparation');assert.equal(events.at(-1).args.p_fence,'9');assert.equal(events.some(e=>e.name.includes('promote')),false);
 });
 await check('already aborted supervisor never claims work',async()=>{const controller=new AbortController();controller.abort();await assert.rejects(runPublicationPreparation(prep,worker,setup(),controller.signal));assert.equal(events.length,0);});
 await check('executor factory receives only fenced lease context after authority checks',async()=>{
  const row=claim(),deps=setup(row);deps.executor=async(context,signal)=>{assert.deepEqual(context,{preparationId:prep,workerId:worker,fence:'9',leaseUntil:row.leaseUntil});assert.equal(signal.aborted,false);assert.equal(events.at(-1).name,'makeborne_load_publication_preparation');return {qualified:true};};
  assert.equal((await run(deps)).state,'completed');
  const failed=setup(claim(),'makeborne_load_publication_preparation');failed.executor=()=>{throw Error('factory must not run');};await assert.rejects(run(failed),/private database detail/);
 });
 await check('executor provisioning failure records fenced failure without compiling',async()=>{
  const deps=setup();deps.executor=async()=>{throw Error('PUBLICATION_EXECUTOR_UNQUALIFIED');};await assert.rejects(run(deps),/PUBLICATION_EXECUTOR_UNQUALIFIED/);assert.equal(events.at(-1).args.p_error,'PUBLICATION_EXECUTOR_UNQUALIFIED');assert.equal(events.some(e=>e.name==='compile'),false);
 });
 console.log(`${count} trusted publication worker orchestration groups passed. Compiler/output and database are doubles; their integrity is checked by dedicated suites.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
