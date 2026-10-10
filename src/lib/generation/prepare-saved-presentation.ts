import "server-only";
import {z} from "zod";
import {ExactAmountSchema} from "../jobs/contracts";
import {RouteSchema} from "../routing/contracts";
import {GenerationConsentSchema} from "./submission-contract";
import {readSavedGenerationInput} from "./saved-generation-input";
import {validatePresentationDesignContext} from "./presentation-design-contract";
import {preparePresentationComposition} from "./presentation-proposal";

/** Trusted, evidence-bearing configuration only; never accepted from a browser. */
export const PresentationPreparationPolicySchema=z.object({
  routes:z.array(RouteSchema).min(1).max(100),maximumVendorMicrousd:ExactAmountSchema,maximumCustomerCredits:ExactAmountSchema,
  maximumInputTokens:z.number().int().min(1).max(1_000_000),maximumOutputTokens:z.number().int().min(16).max(100000),
}).strict();

/** Compose exact saved copy/artwork. The shared state boundary checks scope,
 * latest revision, format, source selection and registered asset references.
 * Database authorization/fingerprints and worker byte verification remain
 * required independently; this pure preparation module grants no authority. */
export function prepareSavedPresentationProposal(records:unknown,trustedPolicy:unknown,consent:unknown,now:string){
  const {input,effort,context}=readSavedGenerationInput(records,'presentation');
  const policy=PresentationPreparationPolicySchema.parse(trustedPolicy),approved=GenerationConsentSchema.parse(consent);
  validatePresentationDesignContext(context);
  if(!approved.externalProcessingConsent)throw new Error('PRESENTATION_EXTERNAL_PROCESSING_REQUIRED');
  return preparePresentationComposition(input,{now,effort,maximumInputTokens:policy.maximumInputTokens,
    maximumOutputTokens:policy.maximumOutputTokens,maximumVendorMicrousd:policy.maximumVendorMicrousd,
    maximumCustomerCredits:policy.maximumCustomerCredits,externalProcessingAllowed:true,sourceRightsConfirmed:true},policy.routes);
}
