import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import {GenerationInputSchema,type GenerationProposal} from "../routing/proposal";
import {selectRoute,RoutingRequestSchema,type ModelRoute} from "../routing/contracts";
import {ExactAmountSchema} from "../jobs/contracts";
import {EffortLevelSchema,getEffortPolicy} from "../routing/effort";
import {canonicalSourceJson} from "../projects/canonical-json";
import {MAX_MODEL_INPUT_IMAGES} from "../providers/input-images";
import {buildPresentationDesignPrompt} from "./presentation-design-contract";

const OptionsSchema=z.object({now:z.string().datetime(),effort:EffortLevelSchema,
  maximumInputTokens:z.number().int().min(1).max(1_000_000),maximumOutputTokens:z.number().int().min(16).max(100000),
  maximumVendorMicrousd:ExactAmountSchema,maximumCustomerCredits:ExactAmountSchema,
  externalProcessingAllowed:z.literal(true),sourceRightsConfirmed:z.literal(true),
}).strict();
const digest=(value:unknown)=>createHash('sha256').update(canonicalSourceJson(value)).digest('hex');
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

/** One explicitly approved composition operation on saved copy. This does not
 * replace the separate narrative/artwork workflow or quote them as completed. */
export function preparePresentationComposition(input:unknown,options:unknown,routes:readonly ModelRoute[]){
  const parsed=GenerationInputSchema.parse(input),policy=OptionsSchema.parse(options),effort=getEffortPolicy(policy.effort);
  if(!parsed.baseVersionId||!parsed.scope.artifactId||parsed.content.kind!=='presentation')throw new Error('PRESENTATION_SAVED_COPY_REQUIRED');
  const availableAssetIds=[...new Set([...parsed.style.referenceAssetIds,...parsed.content.sections.flatMap(section=>section.blocks.flatMap(block=>block.assetId?[block.assetId]:[]))])];
  if(availableAssetIds.length>MAX_MODEL_INPUT_IMAGES)throw new Error('PRESENTATION_IMAGE_BATCH_LIMIT');
  buildPresentationDesignPrompt({input:parsed,presentationMode:'editable',availableAssetIds,sourceMaterial:[]});
  const request=RoutingRequestSchema.parse({capabilities:['text','slide_content',...(availableAssetIds.length?['image_input']:[])],
    usage:[{unit:'input_tokens',maximum:String(policy.maximumInputTokens)},{unit:'output_tokens',maximum:String(policy.maximumOutputTokens)}],
    maximumAttempts:1,minimumQuality:effort.minimumQuality,allowedProviders:['anthropic'],externalProcessingAllowed:policy.externalProcessingAllowed,
    sourceRightsConfirmed:policy.sourceRightsConfirmed,maximumVendorMicrousd:policy.maximumVendorMicrousd,maximumCustomerCredits:policy.maximumCustomerCredits,preference:'quality',now:policy.now});
  const selected=selectRoute(request,routes).selected;if(!selected)throw new Error('PRESENTATION_COMPOSITION_ROUTE_UNAVAILABLE');
  const expiresAt=new Date(Math.min(Date.parse(policy.now)+15*60_000,Date.parse(selected.route.price!.expiresAt))).toISOString();
  const stage={stage:'draft' as const,maximumExecutions:1,request,route:selected.route,maximumVendorMicrousd:selected.maximumVendorMicrousd,maximumCustomerCredits:selected.customerCredits};
  const payload={version:'generation-proposal-v1' as const,purpose:'presentation_composition' as const,input:parsed,inputHash:digest(parsed),
    workflow:{version:'workflow-v1' as const,effort,output:'presentation' as const,presentationMode:'editable' as const,includeImages:false,
      preparedAt:policy.now,expiresAt,stages:[stage],maximumVendorMicrousd:selected.maximumVendorMicrousd,maximumCustomerCredits:selected.customerCredits,maximumExecutions:1,approved:false as const}};
  const proposal={...payload,approvalHash:digest(payload)} satisfies GenerationProposal;
  return freeze({proposal,customerView:{operation:'Design presentation',maximumCredits:selected.customerCredits,changesCopy:false,createsArtwork:false,readyForApproval:true}});
}
