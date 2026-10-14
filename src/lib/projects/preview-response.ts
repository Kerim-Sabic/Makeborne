import "server-only";
import {PRIVATE_PREVIEW_SANDBOX} from "./preview-sandbox";
import {readAuthorizedPreviewRoute, type PreviewDependencies, type PreviewIdentity, type PreviewViewer} from "./authorized-preview";

export type PreviewServingConfig={applicationOrigin:string;previewOrigin:string;allowLocalhost?:boolean};
const unavailable=()=>{throw Object.assign(new Error("PREVIEW_ORIGIN_INVALID"),{code:"PREVIEW_ORIGIN_INVALID"});};

/** Full build-hash origin binding; each build gets a distinct DNS label under a
 * dedicated preview suffix. The full 256-bit identity fits one wildcard label. */
export function previewOriginLabel(buildHash:string) {
  if(!/^[a-f0-9]{64}$/.test(buildHash)) unavailable();
  return `b-${BigInt(`0x${buildHash}`).toString(36).padStart(50,"0")}`;
}
export function validatePreviewOrigins(config:PreviewServingConfig,identity:Pick<PreviewIdentity,"buildHash">) {
  const app=new URL(config.applicationOrigin),preview=new URL(config.previewOrigin);
  const clean=(url:URL)=>url.origin===url.href.slice(0,-1) && !url.username && !url.password && !url.search && !url.hash;
  const transport=(url:URL)=>url.protocol==="https:" || (config.allowLocalhost===true && url.protocol==="http:"
    && (url.hostname==="localhost" || url.hostname.endsWith(".localhost")));
  const label=previewOriginLabel(identity.buildHash),prefix=`${label}.`;
  if(!clean(app)||!clean(preview)||!transport(app)||!transport(preview)||!preview.hostname.startsWith(prefix)) unavailable();
  const suffix=preview.hostname.slice(prefix.length);
  if(!suffix || app.hostname===suffix || app.hostname.endsWith(`.${suffix}`) || app.hostname===preview.hostname) unavailable();
  return {app,preview};
}
const types:Record<string,string>={html:"text/html; charset=utf-8",js:"text/javascript; charset=utf-8",mjs:"text/javascript; charset=utf-8",
  css:"text/css; charset=utf-8",json:"application/json; charset=utf-8",txt:"text/plain; charset=utf-8",svg:"image/svg+xml",
  png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp",gif:"image/gif",avif:"image/avif",ico:"image/x-icon",
  woff:"font/woff",woff2:"font/woff2",ttf:"font/ttf",otf:"font/otf",mp4:"video/mp4",webm:"video/webm",mp3:"audio/mpeg",pdf:"application/pdf"};

/** Framework-neutral serving boundary for an isolated preview gateway. The
 * gateway must verify its host-bound viewer credential before calling this.
 * Do not mount this on Makeborne's application origin or a shared build host.
 * No preview credentials in query strings, public buckets or permissive CORS. */
export async function servePrivatePreview(request:Request,config:PreviewServingConfig,identity:PreviewIdentity,
  viewer:PreviewViewer,dependencies:PreviewDependencies) {
  const headers=new Headers({"Cache-Control":"private, no-store, max-age=0","Vary":"Cookie, Authorization",
    "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","X-Robots-Tag":"noindex, nofollow, noarchive",
    "Cross-Origin-Resource-Policy":"same-origin","Cross-Origin-Opener-Policy":"same-origin","Origin-Agent-Cluster":"?1",
    "Permissions-Policy":"camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Content-Type":"text/plain; charset=utf-8","Content-Security-Policy":"default-src 'none'; sandbox; frame-ancestors 'none'"});
  const error=(status:number)=>new Response(request.method==="HEAD"?null:"Preview unavailable.",{status,headers});
  try{
    const {app,preview}=validatePreviewOrigins(config,identity),url=new URL(request.url);
    if(url.origin!==preview.origin || url.username || url.password) return error(404);
    if(request.method!=="GET" && request.method!=="HEAD"){headers.set("Allow","GET, HEAD");return error(405);}
    const file=await readAuthorizedPreviewRoute(dependencies,identity,viewer,url.pathname,request.signal);
    if(file.bytes===null) return error(404);
    const extension=file.path.split(".").at(-1)?.toLowerCase()??"",mime=Object.hasOwn(types,extension)?types[extension]:undefined;
    headers.set("Content-Type",mime??"application/octet-stream");
    if(!mime) headers.set("Content-Disposition","attachment");
    headers.set("Content-Length",String(file.bytes.byteLength));
    headers.set("Content-Security-Policy",`default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; worker-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${app.origin}; sandbox ${PRIVATE_PREVIEW_SANDBOX}`);
    return new Response(request.method==="HEAD"?null:new Uint8Array(file.bytes),{status:200,headers});
  }catch(errorValue){
    const code=(errorValue as {code?:string})?.code;
    return error(["P0002","42501","PREVIEW_UNAVAILABLE","PREVIEW_ORIGIN_INVALID"].includes(code??"")?404:503);
  }
}
