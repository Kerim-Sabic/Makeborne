import "server-only";
import {GenerationInputSchema,verifyGenerationApproval,type GenerationProposal} from "../routing/proposal";
import {WorkerLeaseSchema,type WorkerLease} from "./worker-accounting";
import {generationOperation} from "./execution-operation";

type Execute=(lease:WorkerLease,signal:AbortSignal)=>Promise<unknown>;
/** Trusted consumer callback registry. No default provider, credential, route,
 * fallback or paid execution. Queue lifecycle retains lease/heartbeat authority. */
export function createGenerationExecutor(handlers:{website?:Execute;presentationComposition?:Execute}){
  // Snapshot the registry; later caller mutation must not redirect approved work.
  const website=handlers.website,presentation=handlers.presentationComposition;
  return async(input:unknown,signal:AbortSignal)=>{
    signal.throwIfAborted();
    const lease=WorkerLeaseSchema.parse(input),proposal=lease.approvedInput.proposal as GenerationProposal;
    verifyGenerationApproval(proposal,proposal.approvalHash,GenerationInputSchema.parse(proposal.input),new Date().toISOString());
    if(proposal.input.scope.workspaceId!==lease.workspaceId)throw Object.assign(new Error('GENERATION_SCOPE_INVALID'),{code:'GENERATION_SCOPE_INVALID'});
    const operation=generationOperation(proposal),execute=operation==='website'?website:presentation;
    if(!execute)throw Object.assign(new Error('GENERATION_EXECUTOR_UNAVAILABLE'),{code:'GENERATION_EXECUTOR_UNAVAILABLE'});
    return execute(lease,signal);
  };
}
