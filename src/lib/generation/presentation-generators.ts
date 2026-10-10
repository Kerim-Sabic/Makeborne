import "server-only";
import {createAnthropicTextAdapter,type AnthropicTextConfig,type AnthropicTextDependencies} from "../providers/anthropic-text";
import {createOpenAITextAdapter,type OpenAITextConfig,type TextDependencies,type TextOutcome} from "../providers/openai-text";
import {buildPresentationDesignPrompt,validatePresentationDesignContext,validateGeneratedPresentationDesign,PresentationDesignResponseSchema,PresentationDesignError,type PresentationDesignResponse} from "./presentation-design-contract";

import {ModelInputImagesSchema, type ModelInputImage} from "../providers/input-images";

type Generate=(input:unknown,signal:AbortSignal)=>Promise<TextOutcome<PresentationDesignResponse>>;
/** One bounded composition attempt through the existing dispatch/usage gates.
 * The workflow still owns renderer review, version persistence and settlement. */
function presentationGenerator(generate:Generate){
  return async(attemptId:string,context:unknown,signal:AbortSignal,images?:readonly ModelInputImage[])=>{
    // Zod parsing creates a detached authority snapshot before any async work.
    // Never apply a response against caller data changed during generation.
    const approvedContext=validatePresentationDesignContext(context);
    const prompt=buildPresentationDesignPrompt(approvedContext);
    const originals=ModelInputImagesSchema.parse(images??[]);
    if(originals.length!==approvedContext.availableAssetIds.length
      || originals.some(image=>!approvedContext.availableAssetIds.some(id=>id.toLowerCase()===image.assetId.toLowerCase())))throw new PresentationDesignError('artwork');
    const result=await generate({attemptId,...prompt,...(originals.length?{images:originals}:{})},signal);
    if(result.status!=='accepted')return result;
    try{return {status:'presentation_candidate' as const,candidate:validateGeneratedPresentationDesign(approvedContext,result.value),evidence:result.evidence};}
    catch(error){if(!(error instanceof PresentationDesignError))throw error;return {status:'presentation_rejected' as const,reason:error.code,evidence:result.evidence};}
  };
}
export function createAnthropicPresentationGenerator(config:AnthropicTextConfig,dependencies:AnthropicTextDependencies){
  return presentationGenerator(createAnthropicTextAdapter(config,{name:'makeborne_presentation_design',schema:PresentationDesignResponseSchema},dependencies));
}
export function createOpenAIPresentationGenerator(config:OpenAITextConfig,dependencies:TextDependencies){
  return presentationGenerator(createOpenAITextAdapter(config,{name:'makeborne_presentation_design',schema:PresentationDesignResponseSchema},dependencies));
}
