import "server-only";
import { readAgencyTask, runAgencyTask, type AgencyRunDeps, type AgencyRunOutcome } from "../agency/run";
import type { AgencyTask } from "../agency/task";
import { ModelReviewSchema, ReviewResultSchema, sameSubject, type ClaimsCheck, type Finding, type ModelReview, type ReviewRequest, type ReviewResult, type ReviewSubject } from "./contract";
import { defaultClaimsCheck } from "./claims";
import { buildResult } from "./validate";
import { REVIEW_RESULT_DESCRIPTION, REVIEWER_SYSTEM, observedReviewer, reviewerImages, reviewerText, unavailableReason } from "./reviewer";

/**
 * The independent review as an agency operation kind (independent_review) on
 * the stage 1 contract: one envelope, the existing durable operation, its run,
 * fence, credit hold and provider gate, a bounded loop, one finish with the
 * `result` outcome (typed data, no project write). The existing in-build
 * review (builder/review.ts) is untouched and still runs as before.
 *
 * Server-side flag: MAKEBORNE_INDEPENDENT_REVIEW=on (off by default). The
 * paid model reviewer also needs MAKEBORNE_AGENCY_TASKS=on and "independent_review"
 * in MAKEBORNE_AGENCY_TASK_KINDS. The kind IS qualified in AGENCY_SETTINGS, so with
 * those switches off only the deterministic part runs (review_unavailable), and
 * listing the kind starts paid calls.
 */
export function independentReviewEnabled(env: Record<string, string | undefined> = process.env) { return env.MAKEBORNE_INDEPENDENT_REVIEW === "on"; }

export type ReviewRunOutcome = Readonly<{ result: ReviewResult; run: AgencyRunOutcome }>;

export async function runIndependentReview(input: {
  task: AgencyTask; request: ReviewRequest; deterministic: readonly Finding[]; claims?: ClaimsCheck;
  /** The approved-facts context digest the request was assembled from (null: none). With deps.knowledge, the step
   * re-reads the knowledge bound to its operation and refuses to run (uncharged) if it differs. */
  knowledgeSha256?: string | null;
  deps: Omit<AgencyRunDeps, "specialists">;
}): Promise<ReviewRunOutcome> {
  const { task, request } = input;
  if (task.kind !== "independent_review") throw new Error("Not an independent review task.");
  if (task.expectedRevision !== request.subject.version || task.artifactId !== request.subject.artifactId) throw new Error("The review task and its evidence describe different revisions.");
  const claims = input.claims ?? defaultClaimsCheck;
  const { port, observed } = observedReviewer(input.deps.model);
  const run = await runAgencyTask<ModelReview>(task, {
    system: REVIEWER_SYSTEM, result: ModelReviewSchema, resultDescription: REVIEW_RESULT_DESCRIPTION,
    content: [{ type: "text", text: reviewerText(request) }, ...reviewerImages(request)],
    // The approved facts are already in the reviewer text (request.facts); the prompt does not repeat them.
    knowledgeInContent: true,
    ...(input.deps.knowledge && input.knowledgeSha256 !== undefined ? { expectKnowledgeSha256: input.knowledgeSha256 } : {}),
    // Stored on the run: the grounded, server-validated review bound to this revision, not the raw answer.
    finalize: review => buildResult({ request, deterministic: input.deterministic, model: { ok: true, review }, claims }),
  }, { ...input.deps, model: port, specialists: [] });
  const stored = run.outcome === "result" ? ReviewResultSchema.safeParse(run.status?.result?.data) : null;
  if (stored?.success && sameSubject(stored.data.subject, request.subject)) return { result: stored.data, run };
  const reason = stored && !stored.success ? "malformed" : unavailableReason(run.code, observed.reason);
  return { result: buildResult({ request, deterministic: input.deterministic, model: { ok: false, reason, detail: run.message }, claims }), run };
}

/** Deterministic-only result (the reviewer is not qualified, disabled, or not requested). Never "acceptable". */
export function deterministicOnly(request: ReviewRequest, deterministic: readonly Finding[], reason: "reviewer_not_qualified" | "reviewer_disabled", claims: ClaimsCheck = defaultClaimsCheck): ReviewResult {
  return buildResult({ request, deterministic, model: { ok: false, reason, detail: "" }, claims });
}

/** Reconnect/read: the recorded review only, flagged stale when the project has moved on (stale reviews are never applied). */
export async function readIndependentReview(input: { actor: string; workspaceId: string; artifactId: string; id: string }, current: ReviewSubject) {
  const state = await readAgencyTask(input);
  const parsed = ReviewResultSchema.safeParse(state.result?.data);
  const result = parsed.success ? parsed.data : null;
  return { message: state.message, operation: state.operation, result, stale: result ? !sameSubject(result.subject, current) : false };
}
