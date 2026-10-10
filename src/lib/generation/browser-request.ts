import {z} from "zod";
import {GenerationPreparationSchema, PreparedGenerationSchema, GenerationProgressSchema} from "./submission-contract";

export const GenerationReferenceSchema = z.object({version:z.literal(1), accountId:z.string().uuid(),
  requestKey:z.string().uuid(), input:GenerationPreparationSchema, prepared:PreparedGenerationSchema.nullable(),
  jobId:z.string().uuid().nullable(),autoStart:z.boolean().optional()}).strict();
export type GenerationReference = z.infer<typeof GenerationReferenceSchema>;
type Scope = GenerationReference["input"]["scope"];
type Storage = Pick<globalThis.Storage,"getItem"|"setItem"|"removeItem">;
const sameScope=(a:z.infer<typeof GenerationProgressSchema>["scope"],b:Scope)=>a.workspaceId===b.workspaceId&&a.projectId===b.projectId&&a.artifactId===b.artifactId;
export class GenerationBrowserError extends Error {
  constructor(message:string, readonly code:string, readonly uncertain=false) {super(message);}
}
export function generationStorageKey(accountId:string,scope:Scope) {
  return `makeborne.generation.v1.${accountId}.${scope.workspaceId}.${scope.artifactId}`;
}
export function readGenerationReference(storage:Storage,accountId:string,scope:Scope) {
  const raw=storage.getItem(generationStorageKey(accountId,scope));
  if(raw===null)return null;
  try {
    if(raw.length>64_000)throw Error();
    const reference=GenerationReferenceSchema.parse(JSON.parse(raw));
    if(reference.accountId!==accountId||!sameScope(reference.input.scope,scope))throw Error();
    return reference;
  } catch {throw new GenerationBrowserError("An earlier creation request could not be read. Its reference has been preserved on this device.","REFERENCE_INVALID");}
}
export function saveGenerationReference(storage:Storage,reference:GenerationReference) {
  const checked=GenerationReferenceSchema.parse(reference);
  try {storage.setItem(generationStorageKey(checked.accountId,checked.input.scope),JSON.stringify(checked));}
  catch {throw new GenerationBrowserError("This browser could not save your request reference. Retry from this project before starting another request.","REFERENCE_STORAGE_UNAVAILABLE",true);}
}
type Boundary = {fetch:typeof fetch; current:()=>boolean; signal:AbortSignal};
async function call(boundary:Boundary,accountId:string,path:string,method:string,body?:unknown,key?:string) {
  if(!boundary.current()||boundary.signal.aborted)throw new GenerationBrowserError("Your account or project changed. Reopen the original project to continue.","ACCOUNT_CHANGED");
  let response:Response,value:unknown;
  try {
    // Native browser fetch must retain its global receiver when injected as a
    // dependency; calling it as boundary.fetch can throw Illegal invocation.
    response=await boundary.fetch.call(globalThis,path,{method,credentials:"same-origin",cache:"no-store",redirect:"error",signal:boundary.signal,
      headers:{"X-Makeborne-Account":accountId,...(body?{"Content-Type":"application/json"}:{}),...(key?{"Idempotency-Key":key}:{})},
      body:body?JSON.stringify(body):undefined});
    value=await response.json();
  } catch {throw new GenerationBrowserError("The outcome could not be confirmed. Retry with the saved request reference.","OUTCOME_UNKNOWN",method!=="GET");}
  if(!boundary.current()||boundary.signal.aborted)throw new GenerationBrowserError("Your account changed during this request. Reopen the original project to confirm its outcome.","ACCOUNT_CHANGED",method!=="GET");
  if(!response.ok) {
    const error=z.object({error:z.object({code:z.string().max(100),message:z.string().max(1000)})}).safeParse(value);
    throw new GenerationBrowserError(error.success?error.data.error.message:"The request could not be confirmed. Retry with the same reference.",error.success?error.data.error.code:"OUTCOME_UNKNOWN",response.status>=500&&method!=="GET");
  }
  return value;
}
/** Called under an exclusive browser lock for this account/artifact. Persist
 * each reference before its network side effect. Retries never rotate keys or
 * replay a paid provider call directly; server authorities remain decisive. */
export async function continueGeneration(reference:GenerationReference,storage:Storage,boundary:Boundary) {
  let saved=GenerationReferenceSchema.parse(reference);
  if(!saved.prepared) {
    saveGenerationReference(storage,saved);
    const value=await call(boundary,saved.accountId,"/api/generate/prepare","POST",saved.input,saved.requestKey);
    const result=z.object({prepared:PreparedGenerationSchema}).strict().safeParse(value);
    if(!result.success)throw new GenerationBrowserError("Preparation could not be verified. Retry with the same reference.","OUTCOME_UNKNOWN",true);
    saved={...saved,prepared:result.data.prepared};saveGenerationReference(storage,saved);
  }
  if(!saved.jobId) {
    const prepared=saved.prepared;
    if(!prepared)throw new GenerationBrowserError("Preparation could not be confirmed. Keep the same reference.","OUTCOME_UNKNOWN",true);
    // A previous submission may have committed before its response was lost.
    // Recover it even after the original approval/session/plan expires; this
    // read never renews authorization or creates replacement work.
    const recovered=await call(boundary,saved.accountId,`/api/generate/requests/${saved.requestKey}?proposalId=${prepared.proposalId}`,"GET");
    const found=z.object({job:GenerationProgressSchema.nullable()}).strict().safeParse(recovered);
    if(!found.success||found.data.job&&!sameScope(found.data.job.scope,saved.input.scope))throw new GenerationBrowserError("The original request could not be confirmed. Keep its saved reference.","OUTCOME_UNKNOWN",true);
    if(found.data.job) {saved={...saved,jobId:found.data.job.id,autoStart:false};saveGenerationReference(storage,saved);return found.data.job;}
    const value=await call(boundary,saved.accountId,"/api/generate","POST",{
      proposalId:prepared.proposalId,approvalHash:prepared.approvalHash,inputHash:prepared.inputHash,
      processingConsent:saved.input.processingConsent,externalProcessingConsent:saved.input.externalProcessingConsent,sourceRightsConfirmed:saved.input.sourceRightsConfirmed},saved.requestKey);
    const result=z.object({job:GenerationProgressSchema}).strict().safeParse(value);
    if(!result.success||!sameScope(result.data.job.scope,saved.input.scope))throw new GenerationBrowserError("Creation could not be verified. Retry with the same reference.","OUTCOME_UNKNOWN",true);
    saved={...saved,jobId:result.data.job.id,autoStart:false};saveGenerationReference(storage,saved);
    return result.data.job;
  }
  return generationProgress(saved,boundary);
}
export async function generationProgress(reference:GenerationReference,boundary:Boundary,cancel=false) {
  if(!reference.jobId)throw new GenerationBrowserError("Confirm the original creation request before continuing.","JOB_UNCONFIRMED");
  const value=await call(boundary,reference.accountId,`/api/generate/${reference.jobId}`,cancel?"DELETE":"GET");
  const result=z.object({job:GenerationProgressSchema}).strict().safeParse(value);
  if(!result.success||result.data.job.id!==reference.jobId||!sameScope(result.data.job.scope,reference.input.scope))throw new GenerationBrowserError("Progress could not be verified. Your saved request has been preserved.","OUTCOME_UNKNOWN",cancel);
  return result.data.job;
}
