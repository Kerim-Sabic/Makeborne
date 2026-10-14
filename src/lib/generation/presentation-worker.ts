import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import type {AnthropicTextConfig,AnthropicTextDependencies} from "../providers/anthropic-text";
import {resolveAnthropicEffort} from "../providers/anthropic-effort";
import {quotePlainTextUsage} from "../providers/text-metering";
import {GenerationInputSchema,verifyGenerationApproval,type GenerationProposal} from "../routing/proposal";
import {RouteSchema} from "../routing/contracts";
import {canonicalSourceJson} from "../projects/canonical-json";
import {SourceAssetSchema} from "../projects/website-source";
import {accountExportRequest} from "../cloud/account-export";
import {reviewNativePresentation,NativePresentationLayoutError,prepareExport,ExportRequestSchema} from "../server/export";
import {expandNativeTextBoxes} from "../presentations/layout-repair";
import {RequestError} from "../server/http";
import {createAnthropicPresentationGenerator} from "./presentation-generators";
import {buildPresentationDesignPrompt,validatePresentationDesignContext} from "./presentation-design-contract";
import {preparePresentationComposition} from "./presentation-proposal";
import {preparePresentationQualification} from "./qualification-proposal";
import {WorkerLeaseSchema,createWorkerAccounting,type WorkerLease,type WorkerAccountingDependencies} from "./worker-accounting";

export type PresentationWorkerDependencies=WorkerAccountingDependencies&{
  configurationRef:string;
  provider:Pick<AnthropicTextDependencies,'spendingAllowed'|'countInputTokens'|'fetch'>;
  /** Existing server-owned scope resolver supplies verified registered originals. */
  resolveAssets(lease:WorkerLease,input:z.infer<typeof GenerationInputSchema>,signal:AbortSignal):Promise<{
    descriptors:unknown;artwork:{id:string;path:string;sha256:string;mediaType:string;bytes:Uint8Array}[];
  }>;
};
const failure=(suffix:string)=>Object.assign(new Error(`PRESENTATION_WORKER_${suffix}`),{code:`PRESENTATION_WORKER_${suffix}`});

/** Restricted worker integration. One approved composition, real layout review,
 * private evidence and original atomic version/outcome writer. Never publishes,
 * grants credits, settles accepted-work charges or silently retries a model. */
export function createClaudePresentationWorker(configuration:AnthropicTextConfig,dependencies:PresentationWorkerDependencies){return presentationWorker(configuration,dependencies,false);}
/** Explicit operator-only evaluator; never selected by the customer executor. */
export function createClaudePresentationQualificationWorker(configuration:AnthropicTextConfig,dependencies:PresentationWorkerDependencies){return presentationWorker(configuration,dependencies,true);}
function presentationWorker(configuration:AnthropicTextConfig,dependencies:PresentationWorkerDependencies,qualification:boolean){
  return async(leaseInput:unknown,signal:AbortSignal)=>{
    const lease=WorkerLeaseSchema.parse(leaseInput);signal.throwIfAborted();
    const proposal=lease.approvedInput.proposal as GenerationProposal;
    const input=GenerationInputSchema.parse(proposal.input);
    verifyGenerationApproval(proposal,proposal.approvalHash,input,new Date().toISOString());
    if(!('purpose' in proposal)||proposal.purpose!==(qualification?'operator_qualification':'presentation_composition')||input.content.kind!=='presentation'
      ||!input.baseVersionId||!input.scope.artifactId||input.scope.workspaceId!==lease.workspaceId
      ||!Number.isFinite(Date.parse(lease.deadlineAt))||!Number.isFinite(Date.parse(lease.approvedInput.authorizationExpiresAt))
      ||Date.now()>=Math.min(Date.parse(lease.deadlineAt),Date.parse(lease.approvedInput.authorizationExpiresAt)))throw failure('SCOPE_INVALID');
    if(proposal.workflow.stages.length!==1)throw failure('ROUTE_INVALID');
    const stage=proposal.workflow.stages[0],route=RouteSchema.parse(stage.route);
    const expected=qualification?preparePresentationQualification(input,{now:proposal.workflow.preparedAt,effort:proposal.workflow.effort.level,processingConsent:true,externalProcessingConsent:true,sourceRightsConfirmed:true}):preparePresentationComposition(input,{now:proposal.workflow.preparedAt,effort:proposal.workflow.effort.level,
      maximumInputTokens:Number(stage.request.usage.find(line=>line.unit==='input_tokens')?.maximum),maximumOutputTokens:Number(stage.request.usage.find(line=>line.unit==='output_tokens')?.maximum),
      maximumVendorMicrousd:stage.request.maximumVendorMicrousd,maximumCustomerCredits:stage.request.maximumCustomerCredits,
      externalProcessingAllowed:true,sourceRightsConfirmed:true},[route]).proposal;
    if(canonicalSourceJson(expected)!==canonicalSourceJson(proposal))throw failure('POLICY_CHANGED');
    if(route.provider!=='anthropic'||route.dataBoundary!=='external'||route.model!==configuration.model
      ||route.configurationRef!==dependencies.configurationRef||!route.price||Date.parse(route.price.expiresAt)<=Date.now())throw failure('ROUTE_INVALID');
    const effort=resolveAnthropicEffort(configuration.model,proposal.workflow.effort.reasoningIntensity);
    if(configuration.effort!==undefined&&configuration.effort!==effort)throw failure('EFFORT_MISMATCH');
    for(const [unit,maximum]of [['input_tokens',configuration.maximumInputTokens],['output_tokens',configuration.maximumOutputTokens]]as const){
      if(!Number.isSafeInteger(maximum)||maximum<1||BigInt(maximum)>BigInt(stage.request.usage.find(line=>line.unit===unit)!.maximum))throw failure('TOKEN_BOUND_INVALID');
    }
    if(BigInt(quotePlainTextUsage(route,{input_tokens:String(configuration.maximumInputTokens),output_tokens:String(configuration.maximumOutputTokens)}))>BigInt(stage.maximumVendorMicrousd))throw failure('PRICE_BOUND_INVALID');
    const assets=await dependencies.resolveAssets(lease,input,signal),descriptors=z.array(SourceAssetSchema).max(100).parse(assets.descriptors);
    if(descriptors.length&&!route.capabilities.includes('image_input'))throw failure('IMAGE_INPUT_ROUTE_REQUIRED');
    if(descriptors.some(asset=>asset.bytes>3_000_000)||descriptors.reduce((sum,asset)=>sum+asset.bytes,0)>12_000_000)throw failure('ASSET_BOUND_INVALID');
    const context=validatePresentationDesignContext({input,presentationMode:'editable',sourceMaterial:lease.approvedInput.sourceMaterial,availableAssetIds:descriptors.map(asset=>asset.id)});
    if(context.sourceMaterial.length!==input.sourceIds.length)throw failure('SOURCES_INVALID');
    buildPresentationDesignPrompt(context);
    if(assets.artwork.length!==descriptors.length||new Set(assets.artwork.map(asset=>asset.id)).size!==assets.artwork.length
      ||descriptors.some(asset=>!assets.artwork.some(original=>original.id===asset.id&&original.path===asset.path&&original.mediaType===asset.mediaType
        &&original.sha256===asset.sha256&&original.bytes.byteLength===asset.bytes&&createHash('sha256').update(original.bytes).digest('hex')===asset.sha256)))throw failure('ASSETS_INVALID');
    const normalized=await prepareExport(ExportRequestSchema.parse({format:'pdf',kind:'presentation',title:input.content.title,
      blocks:assets.artwork.map(asset=>({id:asset.id,type:'image',text:'',image:`data:${asset.mediaType};base64,${Buffer.from(asset.bytes).toString('base64')}`}))}));
    const artwork=new Map(normalized.blocks.map(block=>[block.id,block.image!]));
    signal.throwIfAborted();
    const accounting=createWorkerAccounting(lease,route,dependencies,signal,'PRESENTATION_WORKER');
    const generate=createAnthropicPresentationGenerator({...configuration,effort},{...dependencies.provider,claimDispatch:accounting.claimDispatch});
    const result=await generate(lease.jobId,context,signal,assets.artwork.map(asset=>({assetId:asset.id,mediaType:asset.mediaType as 'image/png'|'image/jpeg'|'image/webp',sha256:asset.sha256,data:Buffer.from(asset.bytes).toString('base64')})));
    if(result.status==='not_dispatched')return {state:'not_dispatched' as const,reason:result.reason};
    if(result.status!=='presentation_candidate'){
      const values=await accounting.retain(result.evidence,{operation:'presentation_composition',status:'provider_rejected',reason:result.reason});
      await accounting.recordFailure(values);return {state:'attempt_failed' as const,reason:result.reason};
    }
    let candidate=result.candidate;
    let layoutRepair: {strategy:"expand_text_height_v1";adjustments:ReturnType<typeof expandNativeTextBoxes>["adjustments"];initialReview:NativePresentationLayoutError["review"]}|undefined;
    let review:Awaited<ReturnType<typeof reviewNativePresentation>>;
    const documentId=input.scope.artifactId;
    const measure=()=>reviewNativePresentation(accountExportRequest(candidate.content,candidate.style,{format:'pdf',documentId},artwork));
    try{
      try{review=await measure();}
      catch(error){
        if(!(error instanceof NativePresentationLayoutError)||error.code!=='SLIDE_CONTENT_OVERFLOW')throw error;
        const repaired=expandNativeTextBoxes(candidate.content,error.review);
        if(!repaired.adjustments.length)throw error;
        layoutRepair={strategy:'expand_text_height_v1',adjustments:repaired.adjustments,initialReview:error.review};
        candidate={...candidate,content:repaired.content};
        review=await measure();
      }
    }
    catch(error){
      const reason=error instanceof RequestError?error.code:'LAYOUT_REVIEW_UNCONFIRMED';
      const values=await accounting.retain(result.evidence,{operation:'presentation_composition',status:'layout_rejected',reason,candidate,...(layoutRepair?{layoutRepair}:{}),...(error instanceof NativePresentationLayoutError?{review:error.review}:{})});
      await accounting.recordFailure(values);return {state:'attempt_failed' as const,reason};
    }
    const values=await accounting.retain(result.evidence,{operation:'presentation_composition',status:'layout_checked',candidate,review,...(layoutRepair?{layoutRepair}:{})});
    const manifest=[...new Set([...candidate.style.referenceAssetIds,...candidate.content.sections.flatMap(section=>section.blocks.flatMap(block=>block.assetId?[block.assetId]:[]))])];
    const receipt=await accounting.commit(values,candidate.content,candidate.style,manifest,'Generated slide composition; measured layout passed, visual review required.');
    return {state:'visual_review_required' as const,versionId:receipt.versionId,outcomeId:receipt.outcomeId,readyForPublication:false as const};
  };
}
