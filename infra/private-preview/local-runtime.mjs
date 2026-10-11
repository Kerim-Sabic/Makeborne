/** Local fixture only: actual Wrangler bundle, persisted R2, local authority.
 * Secrets remain in memory. No Cloudflare credentials or external transport. */
import {Miniflare,Response as RuntimeResponse} from "miniflare";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
export async function createLocalPreviewRuntime({directory,bundle,apiUrl,secret,applicationOrigin,baseOrigin}){
  if(apiUrl!=="http://127.0.0.1:55321")throw Error("LOCAL_AUTHORITY_REQUIRED");
  const values={SUPABASE_URL:apiUrl,SUPABASE_SECRET_KEY:secret,MAKEBORNE_PRIVATE_PREVIEWS_ENABLED:"true",
    MAKEBORNE_PREVIEW_ALLOW_LOCALHOST:"true",MAKEBORNE_PREVIEW_APPLICATION_ORIGIN:applicationOrigin,MAKEBORNE_PREVIEW_BASE_ORIGIN:baseOrigin};
  const env=Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{type:"json",value}]));
  env.COMPILED_OUTPUT={type:"r2",name:"makeborne-private-output-fixture"};
  const runtime=new Miniflare({host:"127.0.0.1",cf:false,logRequests:false,telemetry:{enabled:false},resourcePersistencePath:resolve(directory),workers:[{
    config:{name:"makeborne-private-preview-fixture",compatibilityDate:"2026-10-08",compatibilityFlags:["nodejs_compat"],env,exports:{},
      manifest:{mainModule:"index.js",modulesRoot:resolve(directory),modules:{"index.js":{type:"esm",contents:await readFile(bundle,"utf8")}}}},
    dev:{outboundService:{type:"fetcher",handler:async request=>{
      const url=new URL(request.url);
      if(url.origin!==apiUrl||request.method!=="POST"||!/^\/rest\/v1\/rpc\/makeborne_(consume_preview_handoff|read_preview_session)$/.test(url.pathname)||url.search)throw Error("EXTERNAL_TRANSPORT_DENIED");
      const body=await request.arrayBuffer();
      const response=await fetch(request.url,{method:"POST",headers:{apikey:request.headers.get("apikey"),"Content-Type":"application/json","Cache-Control":"no-store"},body,redirect:"error",signal:AbortSignal.timeout(10000)});
      return new RuntimeResponse(await response.arrayBuffer(),{status:response.status,headers:Object.fromEntries(response.headers)});
    }}},
  }]});
  try{await runtime.ready;return {dispatchFetch:async request=>runtime.dispatchFetch(request.url,{method:request.method,headers:Object.fromEntries(request.headers),body:["GET","HEAD"].includes(request.method)?undefined:await request.arrayBuffer(),redirect:"manual"}),dispose:()=>runtime.dispose()};}
  catch(error){await runtime.dispose();throw error;}
}
