import {handlePreviewGateway} from "../../src/lib/projects/preview-gateway";
import {createPreviewRpcClient} from "../../src/lib/projects/preview-rpc-client";
import {createR2OutputStore} from "../../src/lib/projects/r2-output-store";

const previewWorker = {
  async fetch(request:Request,env:MakebornePreviewEnv):Promise<Response>{
    const closed=()=>new Response(request.method==="HEAD"?null:"Preview unavailable.",{status:503,headers:{
      "Cache-Control":"private, no-store","Content-Type":"text/plain; charset=utf-8","X-Content-Type-Options":"nosniff",
      "X-Robots-Tag":"noindex, nofollow, noarchive","Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'none'; frame-ancestors 'none'; sandbox"}});
    if(env.MAKEBORNE_PRIVATE_PREVIEWS_ENABLED!=="true")return closed();
    try{
      const allowLocalhost=env.MAKEBORNE_PREVIEW_ALLOW_LOCALHOST==="true";
      const rpc=createPreviewRpcClient({url:env.SUPABASE_URL,secret:env.SUPABASE_SECRET_KEY,allowLocalhost});
      const scoped=new Request(request,{signal:AbortSignal.any([request.signal,AbortSignal.timeout(20_000)])});
      return await handlePreviewGateway(scoped,{applicationOrigin:env.MAKEBORNE_PREVIEW_APPLICATION_ORIGIN,
        baseOrigin:env.MAKEBORNE_PREVIEW_BASE_ORIGIN,allowLocalhost},rpc,createR2OutputStore(env.COMPILED_OUTPUT));
    }catch{return closed();}
  },
};

export default previewWorker;
