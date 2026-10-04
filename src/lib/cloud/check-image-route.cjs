/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm'),assert=require('node:assert/strict');
const workspace='11111111-1111-4111-8111-111111111111',artifactId='22222222-2222-4222-8222-222222222222',assetId='33333333-3333-4333-8333-333333333333';
let denied=false,artifact={project_id:'fixture-project'},asset={object_path:workspace+'/fixture.png',content_type:'image/png'},downloads=0,filters=[];
class RequestError extends Error {constructor(code,message,status=400){super(message);this.code=code;this.status=status;}}
const client={from(table){return {select(){return this;},eq(key,value){filters.push([table,key,value]);return this;},async maybeSingle(){return {data:table==='artifacts'?artifact:asset,error:null};}};},storage:{from(){return {async download(){downloads++;return {data:new Blob([new Uint8Array([1,2,3])]),error:null};}};}}};
const moduleObject={exports:{}}; const environment={NODE_ENV:"development"};
const code=ts.transpileModule(fs.readFileSync('src/app/api/cloud/workspaces/[workspaceId]/artifacts/[artifactId]/assets/[assetId]/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(code,{exports:moduleObject.exports,module:moduleObject,Response,Uint8Array,URL,process:{env:environment},require(name){if(name.endsWith('/server/http'))return {RequestError};if(name.endsWith('/cloud/image-preview'))return {MAX_PREVIEW_SOURCE_BYTES:100,renderAssetPreview:async()=>new Uint8Array([4,5,6]),renderAssetExport:async()=>new Uint8Array([7,8,9])};if(name.endsWith('/cloud/server'))return {validId(){},cloudContext:async()=>{if(denied)throw new RequestError('DENIED','Denied',403);return {client};},databaseError(error){if(error)throw error;},cloudError:error=>Response.json({error:error.message},{status:error.status||500})};throw Error(name);}});
const get=(variant='')=>moduleObject.exports.GET(new Request('http://localhost/image'+variant),{params:Promise.resolve({workspaceId:workspace,artifactId,assetId})});
(async()=>{
 environment.NODE_ENV='production';assert.equal((await get('?variant=export')).status,503);assert.equal(downloads,0);environment.NODE_ENV='development';console.log('PASS production export disabled before storage read');
 let response=await get('?variant=export');assert.equal(response.status,200);assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[7,8,9]);console.log('PASS export uses full-resolution renderer');
 assert.equal((await get('?variant=unknown')).status,400);console.log('PASS unknown variant denied');
 response=await get();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('content-type'),'image/webp');console.log('PASS private non-cached raster response');
 assert.ok(filters.some(([t,k,v])=>t==='assets'&&k==='project_id'&&v==='fixture-project'));assert.ok(filters.some(([t,k,v])=>t==='assets'&&k==='workspace_id'&&v===workspace));console.log('PASS asset query scoped to project and workspace');
 downloads=0;denied=true;assert.equal((await get()).status,403);assert.equal(downloads,0);denied=false;console.log('PASS denied account never downloads storage');
 artifact=null;assert.equal((await get()).status,404);assert.equal(downloads,0);artifact={project_id:'fixture-project'};console.log('PASS missing artifact denied');
 const original=asset;asset=null;assert.equal((await get()).status,404);assert.equal(downloads,0);asset=original;console.log('PASS absent project asset denied');
 asset={...original,object_path:'another-workspace/file.png'};assert.equal((await get()).status,415);assert.equal(downloads,0);console.log('PASS mismatched storage path denied');
 asset={...original,content_type:'image/svg+xml'};assert.equal((await get()).status,415);assert.equal(downloads,0);console.log('PASS unsupported media never downloaded');
})().catch(error=>{console.error(error);process.exitCode=1;});
