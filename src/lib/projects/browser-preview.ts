import {z} from "zod";
import {GenerationProgressSchema} from "../generation/submission-contract";
import {PreviewLaunchSchema,PREVIEW_SESSION_MAX_MS,PREVIEW_HANDOFF_MAX_MS,PREVIEW_CLOCK_SKEW_MS} from "./preview-session-contract";

const errors:Record<number,string>={401:"Sign in again to open this preview.",403:"You no longer have access to this preview.",404:"This build is no longer available. Reopen the latest saved version.",409:"Your account changed. Reopen this project before continuing.",429:"Too many previews are open. Wait a moment before trying again.",503:"Private previews are being prepared. Your saved website is unchanged."};

/** Opaque handoff lives only in this request and its immediately submitted form.
 * It must never enter project data, browser storage or a navigation URL. */
export async function requestPrivatePreview(accountId:string,jobId:string,signal:AbortSignal,applicationOrigin:string,transport:typeof fetch=fetch) {
  z.string().uuid().parse(accountId);z.string().uuid().parse(jobId);signal.throwIfAborted();
  const response=await transport.call(globalThis,`/api/generate/${jobId}/preview`,{method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",signal,headers:{"X-Makeborne-Account":accountId}});
  if(!response.ok)throw Error(errors[response.status]??"The preview could not be opened. Try again from this project.");
  const parsed=PreviewLaunchSchema.safeParse((await response.json()).preview);
  if(!parsed.success)throw Error("The preview could not be verified. Try again from this project.");
  const launch=parsed.data;signal.throwIfAborted();
  const app=new URL(applicationOrigin),url=new URL(launch.url),now=Date.now();
  const local=(hostname:string)=>hostname==="localhost"||hostname.endsWith(".localhost");
  if(url.origin===app.origin||url.username||url.password||url.search||url.hash||url.pathname!=="/.makeborne/preview"
    ||!(url.protocol==="https:"||url.protocol==="http:"&&app.protocol==="http:"&&local(app.hostname)&&local(url.hostname))
    ||Date.parse(launch.handoffUntil)<=now||Date.parse(launch.handoffUntil)>now+PREVIEW_HANDOFF_MAX_MS+PREVIEW_CLOCK_SKEW_MS
    ||Date.parse(launch.handoffUntil)>Date.parse(launch.expiresAt)||Date.parse(launch.expiresAt)<=now
    ||Date.parse(launch.expiresAt)>now+PREVIEW_SESSION_MAX_MS+PREVIEW_CLOCK_SKEW_MS)
    throw Error("The preview address could not be verified. Reopen this project.");
  return launch;
}

export async function readSavedWebsitePreview(accountId:string,scope:{workspaceId:string;projectId:string;artifactId:string},versionId:string,signal:AbortSignal,transport:typeof fetch=fetch) {
  for(const id of [accountId,scope.workspaceId,scope.projectId,scope.artifactId,versionId])z.string().uuid().parse(id);
  signal.throwIfAborted();
  const response=await transport.call(globalThis,`/api/cloud/workspaces/${scope.workspaceId}/artifacts/${scope.artifactId}/preview?versionId=${versionId}`,{
    method:"GET",credentials:"same-origin",cache:"no-store",redirect:"error",signal,headers:{"X-Makeborne-Account":accountId}});
  if(!response.ok)throw Error(errors[response.status]??"The saved website could not be checked. Try again from this project.");
  const parsed=z.object({job:GenerationProgressSchema.nullable()}).strict().safeParse(await response.json());
  signal.throwIfAborted();
  if(!parsed.success)throw Error("The saved website could not be verified.");
  const job=parsed.data.job;
  if(job&&(job.scope.workspaceId!==scope.workspaceId||job.scope.projectId!==scope.projectId||job.scope.artifactId!==scope.artifactId||job.outputVersionId!==versionId))
    throw Error("The saved website does not match this project revision.");
  return job;
}

export function submitPreviewHandoff(launch:z.infer<typeof PreviewLaunchSchema>,frame:HTMLIFrameElement) {
  if(!frame.isConnected||!frame.name)throw Error("The preview was closed. Open it again from this project.");
  const form=document.createElement("form"),input=document.createElement("input");
  form.method="POST";form.action=launch.url;form.target=frame.name;form.hidden=true;
  input.type="hidden";input.name="handoff";input.value=launch.handoff;form.append(input);document.body.append(form);
  try {form.submit();} finally {input.value="";form.remove();}
}
