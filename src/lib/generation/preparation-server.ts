import "server-only";
import {z} from "zod";
import {cloudBody, databaseError, requestKey} from "../cloud/server";
import {billingDatabase} from "../billing/database";
import {RequestError, sameOrigin} from "../server/http";
import {submissionContext, requireSubmissionGate} from "./submission-server";
import {GenerationPreparationSchema, PreparedGenerationSchema} from "./submission-contract";
import {prepareSavedWebsiteProposal, WebsitePreparationPolicySchema} from "./prepare-saved-website";
import {prepareSavedPresentationProposal,PresentationPreparationPolicySchema} from "./prepare-saved-presentation";
import type {GenerationProposal} from "../routing/proposal";

function configuredPolicy(kind:'website'|'presentation') {
  const encoded = kind==='website'?process.env.MAKEBORNE_WEBSITE_PREPARATION_POLICY:process.env.MAKEBORNE_PRESENTATION_PREPARATION_POLICY;
  if (!encoded || Buffer.byteLength(encoded, "utf8") > 64_000) throw unavailable();
  try {return (kind==='website'?WebsitePreparationPolicySchema:PresentationPreparationPolicySchema).parse(JSON.parse(encoded));}
  catch {throw unavailable();}
}
function unavailable() {return new RequestError("GENERATION_POLICY_UNAVAILABLE", "Generation is not configured for this project yet. Your saved project is unchanged.", 503);}
function safePrepared(value: unknown) {
  const parsed = PreparedGenerationSchema.safeParse(value);
  if (!parsed.success) throw new RequestError("PREPARATION_OUTCOME_UNKNOWN", "Preparation could not be confirmed. Retry with the same request reference.", 503);
  return parsed.data;
}

export async function prepareGeneration(request: Request) {
  sameOrigin(request);
  const context = await submissionContext(request, true);
  await requireSubmissionGate(context.user.id);
  const body = await cloudBody(request, GenerationPreparationSchema, 16_384), key = requestKey(request);
  const db = billingDatabase(), parameters = {p_request: body, p_request_key: key, ...context.trusted};
  const {data, error} = await db.rpc("makeborne_read_generation_preparation", parameters);
  databaseError(error);
  const loaded = z.union([z.object({prepared: PreparedGenerationSchema}).strict(),
    z.object({records: z.unknown(), stateHash: z.string().regex(/^[a-f0-9]{64}$/)}).strict()]).safeParse(data);
  if (!loaded.success) throw new RequestError("PREPARATION_OUTCOME_UNKNOWN", "Preparation could not be confirmed. Retry with the same request reference.", 503);
  // Recover the original receipt even if policy has since changed/expired.
  // An expired proposal still cannot pass the independent submission authority.
  if ("prepared" in loaded.data) return loaded.data.prepared;
  // Infer format only from the authorized saved records, never a browser field.
  const format=z.object({artifact:z.object({kind:z.enum(['website','presentation'])})}).safeParse(loaded.data.records);
  if(!format.success)throw new RequestError("SAVED_INPUT_INVALID","This saved project cannot be prepared for generation yet.",409);
  const kind=format.data.artifact.kind,policy = configuredPolicy(kind);
  let prepared:{proposal:GenerationProposal|null};
  try {prepared = (kind==='website'?prepareSavedWebsiteProposal:prepareSavedPresentationProposal)(loaded.data.records, policy,
    {processingConsent: body.processingConsent, externalProcessingConsent: body.externalProcessingConsent,
      sourceRightsConfirmed: body.sourceRightsConfirmed}, new Date().toISOString());}
  catch(error) {
    if(error instanceof Error&&error.message==='PRESENTATION_COMPOSITION_ROUTE_UNAVAILABLE')throw unavailable();
    throw new RequestError("SAVED_INPUT_INVALID", "The saved brief or its references cannot be used yet. Review this project before creating.", 409);
  }
  if (!prepared.proposal) throw unavailable();
  const {data: stored, error: writeError} = await db.rpc("makeborne_store_generation_preparation", {...parameters,
    p_state_hash: loaded.data.stateHash, p_snapshot: prepared.proposal});
  databaseError(writeError);
  return safePrepared(stored);
}
