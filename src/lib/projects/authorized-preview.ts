import "server-only";
import {z} from "zod";
import {parseBuildReceipt} from "./build-receipt";
import {readCompiledOutputFile, type CompiledOutputStore} from "./compiled-output";

import {PreviewIdentitySchema,PreviewViewerSchema as ViewerSchema} from "./preview-session-contract";
const AuthorizedSchema = z.object({jobId:z.string().uuid(),versionId:z.string().uuid(),
  scope:z.object({workspaceId:z.string().uuid(),projectId:z.string().uuid(),artifactId:z.string().uuid()}).strict(),
  receipt:z.unknown()}).strict();
export type PreviewIdentity = z.infer<typeof PreviewIdentitySchema>;
export type PreviewViewer = z.infer<typeof ViewerSchema>;
export type PreviewDependencies = {store:CompiledOutputStore;
  /** Call the service-only read RPC with verified Auth identity/session fields.
   * Do not derive viewer from request JSON, unsigned cookies or user metadata. */
  authorize(identity:PreviewIdentity,viewer:PreviewViewer,signal:AbortSignal):Promise<unknown>};
const fail = ():never => {throw Object.assign(new Error("PREVIEW_UNAVAILABLE"),{code:"PREVIEW_UNAVAILABLE"});};

function authorized(value:unknown, identity:PreviewIdentity) {
  const parsed=AuthorizedSchema.parse(value),receipt=parseBuildReceipt(parsed.receipt);
  if(parsed.jobId!==identity.jobId || parsed.versionId!==identity.versionId
    || receipt.revisionId!==identity.versionId || receipt.artifactId!==parsed.scope.artifactId
    || receipt.buildHash!==identity.buildHash) fail();
  return {...parsed,receipt};
}

/** Exact private preview bytes, without serving generated code on the app's
 * origin. Isolated gateway wiring owns verified viewer identity, host binding,
 * routing/MIME/CSP and browser lifecycle. Every file read checks current SQL
 * authority both before and after potentially slow object-store I/O. */
async function readPreview(dependencies:PreviewDependencies,identityInput:PreviewIdentity,
  viewerInput:PreviewViewer,resolvePath:(receipt:ReturnType<typeof parseBuildReceipt>)=>string,signal:AbortSignal) {
  signal.throwIfAborted();
  const identity=PreviewIdentitySchema.parse(identityInput),viewer=ViewerSchema.parse(viewerInput);
  const current=()=>{signal.throwIfAborted();const expires=Date.parse(viewer.p_expires);
    if(expires<=Date.now() || expires>Date.now()+60*60_000) fail();};
  current();
  const before=authorized(await dependencies.authorize(identity,viewer,signal),identity);
  current();
  const path=resolvePath(before.receipt);
  const bytes=await readCompiledOutputFile(dependencies.store,before.scope.workspaceId,before.receipt,path,signal);
  current();
  const after=authorized(await dependencies.authorize(identity,viewer,signal),identity);
  current();
  if(after.scope.workspaceId!==before.scope.workspaceId || after.scope.projectId!==before.scope.projectId
    || after.scope.artifactId!==before.scope.artifactId) fail();
  return {bytes,path};
}

export async function readAuthorizedPreviewFile(dependencies:PreviewDependencies,identity:PreviewIdentity,
  viewer:PreviewViewer,path:string,signal:AbortSignal) {
  return (await readPreview(dependencies,identity,viewer,()=>path,signal)).bytes;
}

/** SPA fallback is restricted to explicitly saved routes, never missing assets. */
export async function readAuthorizedPreviewRoute(dependencies:PreviewDependencies,identity:PreviewIdentity,
  viewer:PreviewViewer,pathname:string,signal:AbortSignal) {
  return readPreview(dependencies,identity,viewer,receipt=>{
    if(pathname.length>1000 || !pathname.startsWith("/") || /[%\\\x00-\x1f]/.test(pathname)) fail();
    const file=pathname.slice(1);
    if(receipt.files.some(entry=>entry.path===file)) return file;
    return receipt.routes.some(route=>route.path===pathname) ? "index.html" : file;
  },signal);
}
