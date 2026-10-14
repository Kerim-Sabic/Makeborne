/** Local-only R2 qualification runtime. No remote bucket, account credentials,
 * telemetry, public bucket access, or provider transport. Caller owns directory
 * lifetime and must await dispose before removing or reopening persistence. */
import {Miniflare} from "miniflare";
import {resolve} from "node:path";
export async function createLocalR2OutputRuntime(directory){
  const runtime=new Miniflare({host:"127.0.0.1",cf:false,logRequests:false,resourcePersistencePath:resolve(directory),telemetry:{enabled:false},workers:[{
    config:{name:"makeborne-output-fixture",compatibilityDate:"2026-10-06",
      manifest:{mainModule:"output.mjs",modulesRoot:resolve(directory),modules:{"output.mjs":{type:"esm",contents:'export default {fetch(){return new Response("No public bucket access",{status:404})}}'}}},
      env:{COMPILED_OUTPUT:{type:"r2",name:"makeborne-private-output-fixture"}},exports:{}},
  }]});
  try{return {bucket:await runtime.getR2Bucket("COMPILED_OUTPUT","makeborne-output-fixture"),dispose:()=>runtime.dispose()};}
  catch(error){await runtime.dispose();throw error;}
}
