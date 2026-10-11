import "server-only";
import {randomBytes,createHash} from "node:crypto";
import {boundedBytes,RequestError} from "../server/http";
import {servePrivatePreview,previewOriginLabel,validatePreviewOrigins} from "./preview-response";
import {PreviewConsumedSchema,PreviewSessionSchema,PREVIEW_SESSION_MAX_MS,PREVIEW_CLOCK_SKEW_MS} from "./preview-session-contract";
import type {CompiledOutputStore} from "./compiled-output";

export type PreviewGatewayConfig={applicationOrigin:string;baseOrigin:string;allowLocalhost?:boolean};
export type PreviewSessionRpc={
  consume(handoffHash:string,cookieHash:string,buildHash:string,signal:AbortSignal):Promise<unknown>;
  read(cookieHash:string,buildHash:string,signal:AbortSignal):Promise<unknown>;
};
export const PREVIEW_HANDOFF_PATH="/.makeborne/preview";
/** Next's Node adapter can use its internal bind address for request.url.
 * Bind CSRF checks to the configured public origin and actual Host instead;
 * forwarded host values never enlarge this boundary. Auth is still required. */
export function requirePreviewApplicationRequest(request:Request,config:PreviewGatewayConfig) {
  const app=new URL(config.applicationOrigin);
  if(request.headers.get("Origin")!==app.origin || request.headers.get("Host")?.toLowerCase()!==app.host
    ||new URL(request.url).protocol!==app.protocol)
    throw new RequestError("ORIGIN_DENIED","Open this preview from your Makeborne project.",403);
}
const fail=():never=>{throw Object.assign(new Error("PREVIEW_UNAVAILABLE"),{code:"PREVIEW_UNAVAILABLE"});};
export const opaquePreviewToken=()=>randomBytes(32).toString("base64url");
export function previewTokenHash(token:string) {
  if(!/^[A-Za-z0-9_-]{43}$/.test(token) || Buffer.from(token,"base64url").toString("base64url")!==token) fail();
  return createHash("sha256").update(token).digest("hex");
}
export function previewGatewayOrigin(config:PreviewGatewayConfig,buildHash:string) {
  const base=new URL(config.baseOrigin);
  if(base.origin!==base.href.slice(0,-1)||base.username||base.password) fail();
  const preview=new URL(base.origin);preview.hostname=`${previewOriginLabel(buildHash)}.${base.hostname}`;
  return validatePreviewOrigins({applicationOrigin:config.applicationOrigin,previewOrigin:preview.origin,
    allowLocalhost:config.allowLocalhost},{buildHash}).preview.origin;
}
function boundBuild(config:PreviewGatewayConfig,url:URL) {
  const base=new URL(config.baseOrigin),suffix=`.${base.hostname}`;
  if(!url.hostname.endsWith(suffix)) fail();
  const label=url.hostname.slice(0,-suffix.length);
  if(!/^b-[0-9a-z]{50}$/.test(label)) fail();
  let value=BigInt(0);for(const character of label.slice(2)) value=value*BigInt(36)+BigInt(parseInt(character,36));
  const buildHash=value.toString(16).padStart(64,"0");
  if(buildHash.length!==64||previewOriginLabel(buildHash)!==label||previewGatewayOrigin(config,buildHash)!==url.origin) fail();
  return buildHash;
}
function cookieName(config:PreviewGatewayConfig) {
  return new URL(config.baseOrigin).protocol==="https:"?"__Host-makeborne-preview":"makeborne-preview-local";
}
function readCookie(request:Request,name:string) {
  const header=request.headers.get("cookie")??"";if(header.length>4096) fail();
  const values=header.split(";").map(part=>part.trim()).filter(part=>part.startsWith(`${name}=`));
  if(values.length!==1) fail();return values[0].slice(name.length+1);
}

/** Deploy only on the dedicated wildcard preview host. No application Auth
 * cookies are used here. Opaque handoff and cookie values never enter logs/URLs;
 * only their SHA-256 hashes reach the private database authorities. */
export async function handlePreviewGateway(request:Request,config:PreviewGatewayConfig,rpc:PreviewSessionRpc,store:CompiledOutputStore) {
  const headers=new Headers({"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff",
    "Content-Type":"text/plain; charset=utf-8","X-Robots-Tag":"noindex, nofollow, noarchive","Content-Security-Policy":"default-src 'none'; frame-ancestors 'none'; sandbox"});
  const denied=(status=404)=>new Response(request.method==="HEAD"?null:"Preview unavailable.",{status,headers});
  try{
    request.signal.throwIfAborted();
    const url=new URL(request.url),buildHash=boundBuild(config,url),name=cookieName(config);
    if(url.pathname===PREVIEW_HANDOFF_PATH){
      if(request.method!=="POST"){headers.set("Allow","POST");return denied(405);}
      if(request.headers.get("Origin")!==new URL(config.applicationOrigin).origin || url.search) return denied(403);
      if(request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase()!=="application/x-www-form-urlencoded") return denied(415);
      const bytes=await boundedBytes(request,1024,request.signal);
      let text:string;
      try {text=new TextDecoder("utf-8",{fatal:true,ignoreBOM:false}).decode(bytes);} catch {return denied(400);}
      const form=new URLSearchParams(text);
      if([...form.keys()].length!==1||!form.has("handoff")) return denied(400);
      const cookie=opaquePreviewToken(),consumed=PreviewConsumedSchema.parse(await rpc.consume(previewTokenHash(form.get("handoff")!),previewTokenHash(cookie),buildHash,request.signal));
      request.signal.throwIfAborted();
      if(consumed.identity.buildHash!==buildHash) fail();
      const remaining=Date.parse(consumed.expiresAt)-Date.now();
      if(remaining<1000||remaining>PREVIEW_SESSION_MAX_MS+PREVIEW_CLOCK_SKEW_MS) fail();
      const lifetime=Math.min(PREVIEW_SESSION_MAX_MS/1000,Math.floor(remaining/1000));
      headers.set("Set-Cookie",`${name}=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${lifetime}${new URL(config.baseOrigin).protocol==="https:"?"; Secure":""}`);
      headers.set("Location",url.origin+"/");return new Response(null,{status:303,headers});
    }
    if(request.method!=="GET"&&request.method!=="HEAD"){headers.set("Allow","GET, HEAD");return denied(405);}
    const cookieHash=previewTokenHash(readCookie(request,name));
    const current=async()=>{request.signal.throwIfAborted();const session=PreviewSessionSchema.parse(await rpc.read(cookieHash,buildHash,request.signal));
      request.signal.throwIfAborted();if(session.identity.buildHash!==buildHash) fail();return session;};
    const first=await current();
    return await servePrivatePreview(request,{applicationOrigin:config.applicationOrigin,previewOrigin:url.origin,allowLocalhost:config.allowLocalhost},first.identity,first.viewer,
      {store,authorize:async(identity,viewer)=>{const session=await current();
        if(session.identity.jobId!==identity.jobId||session.identity.versionId!==identity.versionId
          ||session.viewer.p_actor!==viewer.p_actor||session.viewer.p_session!==viewer.p_session||session.viewer.p_expires!==viewer.p_expires) fail();
        return session.authorized;}});
  }catch(error){
    const value=error as {code?:string;status?:number};
    return denied(value.code==="REQUEST_TOO_LARGE"?413:value.code==="EMPTY_REQUEST"?400:["P0002","42501","ACCESS_DENIED","NOT_FOUND","PREVIEW_UNAVAILABLE"].includes(value.code??"")?404:503);
  }
}
