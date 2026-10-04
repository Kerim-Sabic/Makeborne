/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm'),assert=require('node:assert/strict'),sharp=require('sharp');
const w='11111111-1111-4111-8111-111111111111',a='22222222-2222-4222-8222-222222222222';
let record=null,object=null,uploadCount=0,denied=false,registrationFail=false;
class RequestError extends Error {constructor(code,message,status=400){super(message);this.status=status;}}
const client={from(table){return {select(){return this;},eq(){return this;},async maybeSingle(){return {data:table==='artifacts'?{project_id:a}:record,error:null};},async insert(value){if(registrationFail)return {error:{code:'fixture'}};record=value;return {error:null};}};},storage:{from(){return {async upload(path,bytes){uploadCount++;if(object)return {error:{code:'Duplicate'}};object=bytes;return {error:null};},async download(){return {data:object?new Blob([object]):null,error:null};}};}}};
const moduleObject={exports:{}},env={NODE_ENV:'development'};
const code=ts.transpileModule(fs.readFileSync('src/app/api/cloud/workspaces/[workspaceId]/artifacts/[artifactId]/assets/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
vm.runInNewContext(code,{exports:moduleObject.exports,module:moduleObject,Response,Uint8Array,Buffer,process:{env},require(name){if(name==='sharp')return sharp;if(name==='node:crypto')return require(name);if(name.endsWith('/server/http'))return {RequestError,sameOrigin(){}};if(name.endsWith('/cloud/image-preview'))return {MAX_PREVIEW_SOURCE_BYTES:10000,renderAssetPreview:async(bytes)=>{await sharp(bytes).png().toBuffer();}};if(name.endsWith('/cloud/server'))return {validId(){},cloudContext:async()=>{if(denied)throw new RequestError('DENIED','Denied',403);return {client};},databaseError(error){if(error)throw error;},cloudJson:(value,status=200)=>Response.json(value,{status}),cloudError:error=>Response.json({error:error.message},{status:error.status||500})};throw Error(name);}});
(async()=>{
 const bytes=await sharp({create:{width:10,height:10,channels:3,background:'#456749'}}).png().toBuffer();
 const post=(body=bytes)=>moduleObject.exports.POST(new Request('http://localhost/upload',{method:'POST',body}),{params:Promise.resolve({workspaceId:w,artifactId:a})});
 let response=await post();assert.equal(response.status,201);const first=await response.json();assert.equal(uploadCount,1);console.log('PASS original image uploaded and registered');
 response=await post();assert.equal(response.status,200);assert.equal((await response.json()).asset.id,first.asset.id);assert.equal(uploadCount,1);console.log('PASS same-file retry reuses asset without upload');
 record=null;registrationFail=true;response=await post();assert.equal(response.status,503);registrationFail=false;response=await post();assert.equal(response.status,201);assert.equal((await response.json()).asset.id,first.asset.id);console.log('PASS interrupted registration recovers original object');
 denied=true;response=await post();assert.equal(response.status,403);denied=false;console.log('PASS denied editor cannot upload');
 response=await post(Buffer.from('bad image'));assert.equal(response.status,415);console.log('PASS invalid image rejected');
 response=await post(Buffer.alloc(10001));assert.equal(response.status,413);console.log('PASS streamed size bound enforced');
 env.NODE_ENV='production';response=await post();assert.equal(response.status,503);console.log('PASS production remains closed until quotas');
})().catch(error=>{console.error(error);process.exitCode=1;});
