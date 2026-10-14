import "server-only";
import {createHash,randomUUID} from "node:crypto";
import {z} from "zod";
import {ArtifactContentSchema,StyleProfileSchema} from "../domain";
import {meterPlainText} from "../providers/text-metering";
import type {TextEvidence} from "../providers/openai-text";
import type {ModelRoute} from "../routing/contracts";
import {canonicalSourceJson} from "../projects/canonical-json";

export const WorkerLeaseSchema=z.object({jobId:z.string().uuid(),workspaceId:z.string().uuid(),workerId:z.string().uuid(),
  fence:z.string().regex(/^[1-9][0-9]{0,15}$/),deadlineAt:z.string(),approvedInput:z.object({
    actorId:z.string().uuid(),authorizationExpiresAt:z.string(),proposal:z.unknown(),sourceMaterial:z.unknown(),
  }).strict()}).passthrough();
export type WorkerLease=z.infer<typeof WorkerLeaseSchema>;
export type MeteredWorkerAttempt=ReturnType<typeof meterPlainText>;
export type WorkerAccountingDependencies={
  sql:{query(text:string,values:unknown[]):Promise<{rows:Record<string,unknown>[]}>};
  retainEvidence(input:{lease:WorkerLease;dispatchId:string;metered:MeteredWorkerAttempt},signal:AbortSignal):Promise<{sha256:string}>;
};
type Accounting=[string,string,string,string,string,string,string|null,string,string,string];

/** Shared dispatch/cost/version authority. No route selection, retry or product
 * acceptance belongs here. The restricted SQL runtime rechecks the live fence. */
export function createWorkerAccounting(lease:WorkerLease,route:ModelRoute,dependencies:WorkerAccountingDependencies,signal:AbortSignal,prefix:string){
  const fail=(code:string)=>Object.assign(new Error(`${prefix}_${code}`),{code:`${prefix}_${code}`});
  let dispatchId:string|null=null;
  return {
    claimDispatch:async(binding:{attemptId:string;requestHash:string})=>{
      if(binding.attemptId!==lease.jobId||signal.aborted)return false;
      const claim=(await dependencies.sql.query('select makeborne_private.claim_capped_generation_dispatch($1,$2,$3,$4) as claim',[lease.jobId,lease.workerId,lease.fence,randomUUID()])).rows[0]?.claim;
      const parsed=z.object({claimed:z.literal(true),dispatchId:z.string().uuid()}).passthrough().safeParse(claim);
      if(!parsed.success)return false;dispatchId=parsed.data.dispatchId;return true;
    },
    retain:async(evidence:TextEvidence,detail?:unknown):Promise<Accounting>=>{
      if(!dispatchId)throw fail('DISPATCH_UNCONFIRMED');
      let metered:MeteredWorkerAttempt;
      try{metered=meterPlainText(route,evidence);}catch{throw fail('USAGE_UNCONFIRMED');}
      if(detail!==undefined){
        // Extend the existing private evidence envelope, never the cost inputs.
        // Candidate/artwork bytes are not needed here; registered IDs suffice.
        const payload={...metered.payload,result:detail},bytes=Buffer.from(canonicalSourceJson(payload));
        if(bytes.byteLength>1_000_000)throw fail('EVIDENCE_BOUND_INVALID');
        metered={...metered,payload,bytes,evidenceHash:createHash('sha256').update(bytes).digest('hex')};
      }
      const retained=await dependencies.retainEvidence({lease,dispatchId,metered},signal);
      if(retained.sha256!==metered.evidenceHash)throw fail('EVIDENCE_UNCONFIRMED');
      return [lease.jobId,lease.workerId,lease.fence,dispatchId,metered.actualVendorMicrousd,route.provider,route.model,metered.tariffVersion,metered.providerRequestId,metered.evidenceHash];
    },
    recordFailure:async(accounting:Accounting)=>{
      await dependencies.sql.query('select makeborne_private.record_capped_generation_outcome($1,$2,$3,$4,false,$5,$6,$7,$8,$9,$10,null)',accounting);
    },
    commit:async(accounting:Accounting,contentInput:unknown,styleInput:unknown,assetIds:string[],summary:string)=>{
      const content=ArtifactContentSchema.parse(contentInput),style=StyleProfileSchema.parse(styleInput);
      const manifest=z.array(z.string().uuid()).max(1000).refine(ids=>new Set(ids).size===ids.length).parse(assetIds);
      const saved=(await dependencies.sql.query('select makeborne_private.commit_generation_worker_result($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) as saved',
        [...accounting,content,style,JSON.stringify(manifest),summary])).rows[0]?.saved;
      return z.object({versionId:z.string().uuid(),outcomeId:z.string().uuid(),readyForPublication:z.literal(false)}).passthrough().parse(saved);
    },
  };
}
