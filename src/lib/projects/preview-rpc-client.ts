import "server-only";
import {boundedBytes} from "../server/http";
import type {PreviewSessionRpc} from "./preview-gateway";

const unavailable=(code="PREVIEW_AUTHORITY_UNAVAILABLE"):never=>{throw Object.assign(Error(code),{code});};
/** Dedicated gateway transport. Only the two existing preview RPCs are exposed;
 * no browser headers/cookies, arbitrary RPC names or redirects are forwarded. */
export function createPreviewRpcClient(configuration:{url:string;secret:string;allowLocalhost?:boolean},transport:typeof fetch=fetch):PreviewSessionRpc {
  const url=new URL(configuration.url),local=configuration.allowLocalhost===true&&url.protocol==="http:"&&url.hostname==="127.0.0.1";
  if(url.origin!==url.href.slice(0,-1)||url.username||url.password
    ||!(url.protocol==="https:"&&/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname)||local)
    ||!(configuration.secret.startsWith("sb_secret_")||local&&/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(configuration.secret)))unavailable();
  async function call(name:"makeborne_consume_preview_handoff"|"makeborne_read_preview_session",args:Record<string,string>,signal:AbortSignal){
    signal.throwIfAborted();
    const deadline=AbortSignal.any([signal,AbortSignal.timeout(10_000)]);
    const response=await transport(`${url.origin}/rest/v1/rpc/${name}`,{method:"POST",redirect:"manual",
      headers:{apikey:configuration.secret,"Content-Type":"application/json","Cache-Control":"no-store"},body:JSON.stringify(args),signal:deadline});
    signal.throwIfAborted();
    if(response.status>=300&&response.status<400){await response.body?.cancel();return unavailable();}
    let bytes:Uint8Array;
    try{bytes=await boundedBytes(response,512_000,deadline);}catch{signal.throwIfAborted();return unavailable();}
    signal.throwIfAborted();
    let data:unknown;
    try{data=JSON.parse(new TextDecoder("utf-8",{fatal:true,ignoreBOM:false}).decode(bytes));}catch{unavailable();}
    if(!response.ok){
      const code=data&&typeof data==="object"&&"code"in data?data.code:null;
      unavailable(code==="P0002"||code==="42501"?code:"PREVIEW_AUTHORITY_UNAVAILABLE");
    }
    if(data===null)unavailable();
    return data;
  }
  return {
    consume:(handoffHash,cookieHash,buildHash,signal)=>call("makeborne_consume_preview_handoff",{p_handoff_hash:handoffHash,p_cookie_hash:cookieHash,p_build_hash:buildHash},signal),
    read:(cookieHash,buildHash,signal)=>call("makeborne_read_preview_session",{p_cookie_hash:cookieHash,p_build_hash:buildHash},signal),
  };
}
