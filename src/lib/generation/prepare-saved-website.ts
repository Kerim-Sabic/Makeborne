import "server-only";
import {z} from "zod";
import {ExactAmountSchema} from "../jobs/contracts";
import {RouteSchema, RoutingRequestSchema} from "../routing/contracts";
import {prepareGenerationProposal} from "../routing/proposal";
import {readSavedGenerationInput} from "./saved-generation-input";
import {GenerationConsentSchema} from "./submission-contract";

const requestFields = RoutingRequestSchema.shape;
const StagePolicySchema = z.object({usage: requestFields.usage, maximumAttempts: requestFields.maximumAttempts,
  minimumQuality: requestFields.minimumQuality, allowedProviders: requestFields.allowedProviders,
  maximumVendorMicrousd: requestFields.maximumVendorMicrousd,
  maximumCustomerCredits: requestFields.maximumCustomerCredits, preference: requestFields.preference}).strict();
/** Trusted operator policy, not an HTTP body or a catalogue of assumed prices.
 * No default route is executable; existing routing checks require current price,
 * evaluation, adapter, licence and processing-policy evidence on every route. */
export const WebsitePreparationPolicySchema = z.object({
  routes: z.array(RouteSchema).min(1).max(100),
  maximumVendorMicrousd: ExactAmountSchema,
  maximumCustomerCredits: ExactAmountSchema,
  stages: z.object({planning: StagePolicySchema, draft: StagePolicySchema, review: StagePolicySchema}).strict(),
}).strict();

/** Prepare from exact saved state using the existing immutable proposal and
 * routing authorities. No save, reservation, model call or authorization grant.
 * Caller must read these rows consistently under current session/editor access,
 * persist the result privately, and use the existing atomic submission boundary.
 * The SQL dispatch authority rechecks current revision and source fingerprints.
 * Image generation is deliberately not promised by this source-only executor.
 */
export function prepareSavedWebsiteProposal(records: unknown, trustedPolicy: unknown, consent: unknown, now: string) {
  const {input,effort}=readSavedGenerationInput(records,'website');
  const policy = WebsitePreparationPolicySchema.parse(trustedPolicy);
  const approved = GenerationConsentSchema.parse(consent);
  const at = z.string().datetime().parse(now);
  return prepareGenerationProposal(input, {output: "website", effort, includeImages: false,
    now: at, maximumVendorMicrousd: policy.maximumVendorMicrousd,
    maximumCustomerCredits: policy.maximumCustomerCredits,
    stages: (["planning", "draft", "review"] as const).map(stage => ({stage,
      request: {...policy.stages[stage], capabilities: [stage === "draft" ? "website_code" : "text"], now: at,
        externalProcessingAllowed: approved.externalProcessingConsent, sourceRightsConfirmed: approved.sourceRightsConfirmed}})),
  }, policy.routes);
}
