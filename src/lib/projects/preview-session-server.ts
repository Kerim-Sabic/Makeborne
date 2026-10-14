import "server-only";
import {submissionContext} from "../generation/submission-server";
import {billingDatabase} from "../billing/database";
import {databaseError,validId} from "../cloud/server";
import {RequestError} from "../server/http";
import {opaquePreviewToken,previewTokenHash,previewGatewayOrigin,requirePreviewApplicationRequest,PREVIEW_HANDOFF_PATH,type PreviewGatewayConfig,type PreviewSessionRpc} from "./preview-gateway";
import {PreviewIssuedSchema,PreviewLaunchSchema,PREVIEW_HANDOFF_MAX_MS,PREVIEW_CLOCK_SKEW_MS} from "./preview-session-contract";
import {GenerationProgressSchema} from "../generation/submission-contract";

/** Explicit operator configuration until the private gateway, wildcard TLS and
 * cloud store are deployed and verified. A flag never provisions those services. */
export function previewGatewayConfiguration():PreviewGatewayConfig {
  if(process.env.MAKEBORNE_PRIVATE_PREVIEWS_ENABLED!=="true")
    throw new RequestError("PREVIEW_NOT_ENABLED","Private website previews are being prepared.",503);
  const applicationOrigin=process.env.MAKEBORNE_PREVIEW_APPLICATION_ORIGIN,baseOrigin=process.env.MAKEBORNE_PREVIEW_BASE_ORIGIN;
  if(!applicationOrigin||!baseOrigin) throw new RequestError("PREVIEW_NOT_CONFIGURED","Private website previews are not configured yet.",503);
  const config={applicationOrigin,baseOrigin,allowLocalhost:process.env.MAKEBORNE_PREVIEW_ALLOW_LOCALHOST==="true"};
  try{previewGatewayOrigin(config,"0".repeat(64));}
  catch{throw new RequestError("PREVIEW_NOT_CONFIGURED","Private website previews are not configured yet.",503);}
  return config;
}

export function privatePreviewsConfigured() {
  try {previewGatewayConfiguration();return true;} catch {return false;}
}

export async function readSavedWebsiteGeneration(request:Request,workspaceId:string,artifactId:string) {
  validId(workspaceId);validId(artifactId);
  const query=new URL(request.url).searchParams;
  if([...query.keys()].length!==1||!query.has("versionId"))throw new RequestError("INVALID_ID","Choose one saved website revision.");
  const versionId=validId(query.get("versionId")??"");
  const {trusted}=await submissionContext(request);
  previewGatewayConfiguration(); // Default closed; a read never enables generation.
  const {data,error}=await billingDatabase().rpc("makeborne_saved_website_generation",{p_workspace:workspaceId,p_artifact:artifactId,p_version:versionId,...trusted}).abortSignal(request.signal);
  databaseError(error);request.signal.throwIfAborted();
  if(data===null)return null;
  const progress=GenerationProgressSchema.parse(data);
  if(progress.scope.workspaceId!==workspaceId||progress.scope.artifactId!==artifactId||progress.outputVersionId!==versionId)
    throw new RequestError("PREVIEW_UNAVAILABLE","This saved website could not be verified.",503);
  return progress;
}

export async function launchPrivatePreview(request:Request,jobId:string) {
  validId(jobId);
  // Identity is verified before any preview credential is issued. No paid
  // creation gate is needed for reading previously saved work.
  const {trusted}=await submissionContext(request);
  const config=previewGatewayConfiguration();
  requirePreviewApplicationRequest(request,config);
  const handoff=opaquePreviewToken();request.signal.throwIfAborted();
  const {data,error}=await billingDatabase().rpc("makeborne_issue_preview_session",{p_job:jobId,p_handoff_hash:previewTokenHash(handoff),...trusted}).abortSignal(request.signal);
  databaseError(error);request.signal.throwIfAborted();
  const issued=PreviewIssuedSchema.parse(data);
  if(issued.identity.jobId!==jobId || Date.parse(issued.handoffUntil)<=Date.now()
    ||Date.parse(issued.handoffUntil)>Date.now()+PREVIEW_HANDOFF_MAX_MS+PREVIEW_CLOCK_SKEW_MS
    ||Date.parse(issued.handoffUntil)>Date.parse(issued.expiresAt)||Date.parse(issued.expiresAt)>Date.parse(trusted.p_expires))
    throw new RequestError("PREVIEW_UNAVAILABLE","The preview could not be opened. Try again from this project.",503);
  return PreviewLaunchSchema.parse({url:previewGatewayOrigin(config,issued.identity.buildHash)+PREVIEW_HANDOFF_PATH,
    handoff,handoffUntil:issued.handoffUntil,expiresAt:issued.expiresAt});
}

/** Server-only RPC adapter for the dedicated gateway. Its database credential
 * stays outside generated-code execution and is never sent to a preview page. */
export function previewSessionRpc():PreviewSessionRpc {
  const db=billingDatabase();
  return {
    async consume(handoffHash,cookieHash,buildHash,signal){
      const {data,error}=await db.rpc("makeborne_consume_preview_handoff",{p_handoff_hash:handoffHash,p_cookie_hash:cookieHash,p_build_hash:buildHash}).abortSignal(signal);
      databaseError(error);return data;
    },
    async read(cookieHash,buildHash,signal){
      const {data,error}=await db.rpc("makeborne_read_preview_session",{p_cookie_hash:cookieHash,p_build_hash:buildHash}).abortSignal(signal);
      databaseError(error);return data;
    },
  };
}
