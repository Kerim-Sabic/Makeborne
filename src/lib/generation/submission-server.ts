import "server-only";
import {z} from "zod";
import {cloudContext, cloudBody, databaseError, requestKey, validId} from "../cloud/server";
import {requestAccountMatches} from "../cloud/request-account";
import {billingDatabase} from "../billing/database";
import {requireCreationAccess} from "../billing/access";
import {getAccountPrivileges} from "../account/privileges";
import {RequestError, sameOrigin} from "../server/http";
import {verifyGenerationApproval, type GenerationProposal} from "../routing/proposal";
import {GenerationProgressSchema, GenerationSubmissionSchema} from "./submission-contract";
import {generationOperation} from "./execution-operation";

/** getUser verifies identity with Auth; getClaims verifies the actual JWT whose
 * session/expiry will be checked again in SQL. Never decode a cookie as proof. */
export async function submissionContext(request: Request, write = false) {
  const context = await cloudContext();
  if (!requestAccountMatches(request.headers.get("X-Makeborne-Account"), context.user.id)) throw new RequestError("ACCOUNT_CHANGED", "Your account changed. Reopen the project before continuing.", 409);
  const {data, error} = await context.client.auth.getClaims();
  const parsed = z.object({sub: z.literal(context.user.id), session_id: z.string().uuid(), exp: z.number().int().positive(), role: z.literal("authenticated"), is_anonymous: z.literal(false)}).passthrough().safeParse(data?.claims);
  if (error || !parsed.success || parsed.data.exp * 1000 <= Date.now()) throw new RequestError("AUTH_REQUIRED", "Sign in again before continuing.", 401);
  if (write) await requireCreationAccess(context.user);
  return {...context, trusted: {p_actor: context.user.id, p_session: parsed.data.session_id,
    p_expires: new Date(Math.min(parsed.data.exp * 1000, Date.now() + 60 * 60_000)).toISOString()}};
}
function progress(value: unknown) {
  const parsed = GenerationProgressSchema.safeParse(value);
  if (!parsed.success) throw new RequestError("GENERATION_OUTCOME_UNKNOWN", "Job progress could not be confirmed. Keep the same request reference before retrying.", 503);
  return parsed.data;
}

export async function submitGeneration(request: Request) {
  sameOrigin(request);
  const context = await submissionContext(request, true);
  await requireSubmissionGate(context.user.id);
  const body = await cloudBody(request, GenerationSubmissionSchema, 4096), key = requestKey(request), db = billingDatabase();
  const {data: stored, error: readError} = await db.rpc("makeborne_submission_proposal", {p_proposal: body.proposalId, ...context.trusted});
  databaseError(readError);
  const row = z.object({snapshot: z.unknown(), expiresAt: z.string().datetime({offset: true})}).strict().safeParse(stored);
  if (!row.success) throw new RequestError("PROPOSAL_UNAVAILABLE", "Prepare a new generation request for this project.", 409);
  const proposal = row.data.snapshot as GenerationProposal;
  try {verifyGenerationApproval(proposal, body.approvalHash, proposal.input, new Date().toISOString());}
  catch {throw new RequestError("PROPOSAL_CHANGED", "This generation request changed or expired. Prepare it again.", 409);}
  if (proposal.inputHash !== body.inputHash) throw new RequestError("PROPOSAL_CHANGED", "The approved project input changed. Prepare it again.", 409);
  let operation:ReturnType<typeof generationOperation>;
  try {operation=generationOperation(proposal);}
  catch {throw new RequestError("FORMAT_NOT_READY", "This generation operation is not enabled yet.", 503);}
  if(operation==='presentation_composition'&&process.env.MAKEBORNE_PRESENTATION_SUBMISSIONS_ENABLED!=='true'){
    throw new RequestError("FORMAT_NOT_READY","Presentation composition is being prepared. Your saved slides are unchanged.",503);
  }
  // Use the immutable proposal deadline on every replay, not a freshly extended
  // deadline. The SQL authority separately binds the approving token/session.
  const {data, error} = await db.rpc("makeborne_submit_generation", {p_proposal: body.proposalId, p_request_key: key,
    ...context.trusted, p_approval_hash: body.approvalHash, p_input_hash: body.inputHash,
    p_deadline: new Date(Math.min(Date.parse(row.data.expiresAt), Date.parse(proposal.workflow.preparedAt) + 10 * 60_000)).toISOString(),
    p_processing_consent: body.processingConsent, p_external_consent: body.externalProcessingConsent, p_source_rights_confirmed: body.sourceRightsConfirmed});
  databaseError(error);
  return progress(data);
}

/** Shared default-closed operator gate; neither policy nor an administrator
 * allowance proves provider/worker health or enables public generation. */
export async function requireSubmissionGate(userId: string) {
  if (process.env.MAKEBORNE_DURABLE_SUBMISSIONS_ENABLED !== "true" || !(await getAccountPrivileges(userId)).isAdmin) {
    throw new RequestError("GENERATION_NOT_ENABLED", "Generation is being prepared. Your saved project is unchanged.", 503);
  }
}

export async function readGeneration(request: Request, jobId: string) {
  validId(jobId);
  const {trusted} = await submissionContext(request);
  const {data, error} = await billingDatabase().rpc("makeborne_generation_progress", {p_job: jobId, ...trusted});
  databaseError(error); return progress(data);
}
export async function cancelGeneration(request: Request, jobId: string) {
  sameOrigin(request); validId(jobId);
  // A current editor can stop existing work even after creation access expires.
  const {trusted} = await submissionContext(request);
  const {data, error} = await billingDatabase().rpc("makeborne_cancel_generation", {p_job: jobId, ...trusted});
  databaseError(error); return progress(data);
}
export async function recoverGeneration(request: Request, key: string) {
  validId(key);
  const proposal = validId(new URL(request.url).searchParams.get("proposalId") ?? "");
  const {trusted} = await submissionContext(request);
  const {data, error} = await billingDatabase().rpc("makeborne_recover_generation_request", {p_proposal:proposal, p_request_key:key, ...trusted});
  databaseError(error);
  return data === null ? null : progress(data);
}
