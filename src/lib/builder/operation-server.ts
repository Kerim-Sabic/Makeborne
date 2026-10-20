import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { billingDatabase } from "../billing/database";
import { RequestError, apiError } from "../server/http";
import { canonicalSourceJson } from "../projects/canonical-json";
import { aiCostUsdPerCredit } from "./pricing";
import { SitePlanSchema, StoredPlanSchema, estimatePlanCredits, recommendedEffort, type SitePlan } from "./plan";
import { RunSpend, SpendError, type SpendGate } from "../ai/run-spend";
import { databaseGate, SETTLEMENT_WINDOW_MS, CLOCK_SKEW_MS } from "../ai/live-run";
import type { CreditHold } from "../credits/server";
import type { EffortLevel } from "../routing/effort";
import { OperationSnapshotSchema, OperationStatusSchema, type OperationRequest, type OperationSnapshot, type OperationStatus } from "./operation-contract";

const internalSnapshot = OperationSnapshotSchema.extend({ rateMicrousd: z.number().int().positive(), providerRemainingMicrousd: z.number().int().nonnegative() });
const runSchema = z.object({ id: z.string().uuid(), reference: z.string(), fence: z.string().uuid(), amount: z.number().int().nonnegative(), exempt: z.boolean(), reservedAt: z.union([z.string(), z.number()]), expiresAt: z.union([z.string(), z.number()]) });
const object = z.record(z.string(), z.unknown());
export type OperationRun = {
  actor: string; workspaceId: string; artifactId: string; id: string; fence: string;
  hold: CreditHold; operation: OperationSnapshot; rateMicrousd: number; providerAllowanceMicrousd: number; expiresAt: number;
  originalMessage?: string;
  originalPlan?: SitePlan;
  finalizationStarted?: boolean;
};
export type OperationCandidate = {
  content: unknown; style: unknown; assetIds: string[]; summary: string; expectedVersion: number;
} | { stored: unknown };
export type OperationOutcome = "saved" | "review_no_change" | "incomplete" | "failed" | "plan";
export type OperationFinalization = OperationStatus & { charged: number; outcome: string };

export class OperationError extends RequestError {
  constructor(code: string, message: string, status: number, readonly operation?: OperationSnapshot) { super(code, message, status); }
}

const unavailable = () => new OperationError("OPERATION_UNAVAILABLE", "The request's spending record is temporarily unavailable. Check its status before retrying.", 503);
const messages: Record<string, string> = {
  OPERATION_BUDGET_REACHED: "This request has reached its authorized budget. Your saved work is safe. Approve additional credits to continue.",
  OPERATION_BUSY: "This request is still running. Check its status before starting another step.",
  OPERATION_EXPIRED: "This request's authorization expired. Your saved work is safe.",
  OPERATION_CONFLICT: "This request changed. Reload its status before continuing.",
  INSUFFICIENT_CREDITS: "There are not enough available credits to start the next step. Your saved work is safe.",
};
async function call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const request = billingDatabase().rpc(name, args);
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) {
    if (error.code === "42501") throw new OperationError("OPERATION_FORBIDDEN", "This request is unavailable to this account.", 403);
    if (error.code === "P0002") throw new OperationError("OPERATION_NOT_FOUND", "This request could not be found.", 404);
    if (error.code === "PT409" || error.code === "MB409" || error.code === "23505") throw new OperationError("OPERATION_CONFLICT", messages.OPERATION_CONFLICT, 409);
    if (error.code === "MB402") throw new OperationError("INSUFFICIENT_CREDITS", messages.INSUFFICIENT_CREDITS, 402);
    throw unavailable();
  }
  const parsed = object.safeParse(data);
  if (!parsed.success) throw unavailable();
  return parsed.data;
}
function snapshot(value: unknown): OperationSnapshot {
  const parsed = OperationSnapshotSchema.safeParse(value);
  if (!parsed.success) throw unavailable();
  return normalizedSnapshot(parsed.data);
}
/** Settled Stops use the legacy wire status so an application rollback can
 * still read their receipt. Only an explicit, validated marker means Stop. */
function normalizedSnapshot(value: OperationSnapshot): OperationSnapshot {
  return value.status === "completed" && value.cancelRequested === true && value.reservedCredits === 0
    ? { ...value, status: "cancelled" } : value;
}
function checkRefusal(data: Record<string, unknown>) {
  if (!data.error) return;
  const refusal = object.safeParse(data.error);
  const code = refusal.success && typeof refusal.data.code === "string" ? refusal.data.code : "OPERATION_CONFLICT";
  throw new OperationError(code, messages[code] ?? "This request cannot continue. Check its saved status.", code === "INSUFFICIENT_CREDITS" ? 402 : 409, data.operation ? snapshot(data.operation) : undefined);
}
function publicStatus(data: Record<string, unknown>): OperationStatus {
  const parsed = OperationStatusSchema.safeParse({ operation: data.operation, result: data.result ?? null, recovery: data.recovery ?? null });
  if (!parsed.success) throw unavailable();
  return { ...parsed.data, operation: normalizedSnapshot(parsed.data.operation) };
}

/** Bind reference bytes without retaining private uploads in SQL or returning
 * them in operation status. A continuation must resupply the exact originals. */
function attachmentFingerprint(request: unknown): string {
  const attachments = typeof request === "object" && request !== null && "attachments" in request
    ? (request as { attachments?: unknown }).attachments ?? [] : [];
  return createHash("sha256").update(canonicalSourceJson(attachments)).digest("hex");
}

export async function readOperation(input: { actor: string; workspaceId: string; artifactId: string; id?: string; actionKey?: string }, signal?: AbortSignal): Promise<OperationStatus> {
  const data = await call("makeborne_ai_operation_read", { p_actor: input.actor, p_workspace: input.workspaceId, p_artifact: input.artifactId, p_operation: input.id ?? null, p_action: input.actionKey ?? null }, signal);
  checkRefusal(data);
  return publicStatus(data);
}

export async function cancelOperation(input: { actor: string; workspaceId: string; artifactId: string; id?: string; actionKey?: string; expectedRevision?: number }): Promise<OperationStatus> {
  // Resolve within the authenticated workspace/artifact before the service-only
  // RPC. An ID or action key from another project can never stop this request.
  const current = await readOperation(input);
  const data = await call("makeborne_ai_operation_cancel", { p_actor: input.actor, p_operation: current.operation.id,
    p_expected_revision: input.expectedRevision ?? current.operation.revision });
  checkRefusal(data);
  return publicStatus(data);
}

/** Browser disconnects do not cancel paid work. Explicit durable Stop does.
 * A sequential, bounded poll interrupts an in-flight provider stream; the SQL
 * provider gate independently denies new calls immediately. An unavailable
 * cancellation read stops the worker conservatively, never clears the marker. */
export function watchOperationCancellation(run: OperationRun | undefined, spend: RunSpend, controller: AbortController, pollMs = 1000) {
  if (!run) return () => undefined;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout>;
  const poll = async () => {
    try {
      const status = await readOperation({ actor: run.actor, workspaceId: run.workspaceId, artifactId: run.artifactId, id: run.operation.id }, AbortSignal.timeout(3000));
      if (disposed) return;
      if (status.operation.cancelRequested || status.operation.status === "cancelled") {
        spend.cancel(); controller.abort(new SpendError("CANCELLED", "This request was stopped.")); return;
      }
    } catch {
      if (!disposed) controller.abort(new SpendError("SPEND_UNAVAILABLE", "The operation could not be checked; the worker stopped."));
      return;
    }
    if (!disposed && !controller.signal.aborted) { timer = setTimeout(() => void poll(), pollMs); timer.unref?.(); }
  };
  timer = setTimeout(() => void poll(), pollMs); timer.unref?.();
  return () => { disposed = true; clearTimeout(timer); };
}

/** The server derives the cap, rate, actor and request digest. Client keys only identify replays. */
export async function beginOperation(input: {
  actor: string; workspaceId: string; artifactId: string; expectedVersion: number; effort: EffortLevel;
  kind: "build" | "review" | "plan"; ceiling: number; request: unknown; envelope: OperationRequest;
}): Promise<{ run: OperationRun | null; status: OperationStatus }> {
  const digest = createHash("sha256").update(canonicalSourceJson(input.request)).digest("hex");
  const attachmentsSha256 = attachmentFingerprint(input.request);
  let id: string;
  if ("actionKey" in input.envelope) {
    const created = await call("makeborne_ai_operation_create", {
      p_actor: input.actor, p_workspace: input.workspaceId, p_artifact: input.artifactId,
      p_action: input.envelope.actionKey, p_kind: input.kind, p_effort: input.effort,
      p_initial_version: input.expectedVersion, p_input_hash: digest, p_credit_cap: input.ceiling,
      p_rate_microusd: Math.round(aiCostUsdPerCredit() * 1_000_000),
      p_context: { attachmentsSha256, ...(typeof input.request === "object" && input.request ? { message: (input.request as { message?: unknown }).message ?? "", ...((input.request as { plan?: unknown }).plan ? { plan: (input.request as { plan?: unknown }).plan } : {}) } : {}) },
    });
    checkRefusal(created);
    id = snapshot(created.operation ?? created).id;
  } else {
    id = input.envelope.id;
    // An operation on another artifact must not fund this route's source or images.
    const existingData = await call("makeborne_ai_operation_read", { p_actor: input.actor, p_workspace: input.workspaceId, p_artifact: input.artifactId, p_operation: id, p_action: null });
    checkRefusal(existingData);
    const existing = publicStatus(existingData);
    if (existing.operation.effort !== input.effort) throw new OperationError("OPERATION_CONFLICT", "Continue with the effort originally authorized for this request.", 409, existing.operation);
    // A visual-review stage deliberately supplies its own current screenshots.
    // Build/plan continuation must preserve the original reference set. Older
    // operations without a reference fingerprint cannot prove that equivalence.
    if (input.envelope.kind !== "review") {
      const original = z.object({ attachmentsSha256: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(existingData.requestContext);
      if (!original.success) throw new OperationError("OPERATION_REFERENCES_UNAVAILABLE", "This request was started with an older builder. Start a new request with your original reference files.", 409, existing.operation);
      if (original.data.attachmentsSha256 !== attachmentsSha256) throw new OperationError("OPERATION_REFERENCES_CHANGED", "Continue with the same reference files used for this request. Restore the originals or start a new request with your current files.", 409, existing.operation);
    }
  }
  const kind = "id" in input.envelope ? input.envelope.kind : input.kind;
  if ((input.kind === "plan") !== (kind === "plan") || (input.kind === "review" && kind !== "review") || (input.kind === "build" && kind === "review"))
    throw new OperationError("OPERATION_CONFLICT", "The operation stage does not match this request.", 409);
  const data = await call("makeborne_ai_operation_begin", {
    p_actor: input.actor, p_operation: id, p_step: input.envelope.stepKey, p_kind: kind,
    p_input_hash: digest, p_expected_version: input.expectedVersion, p_stage_cap: input.ceiling,
  });
  checkRefusal(data);
  const status = publicStatus(data);
  if (data.replayed === true) return { run: null, status };
  const parsedRun = runSchema.safeParse(data.run), parsedOperation = internalSnapshot.safeParse(data.operation);
  if (!parsedRun.success || !parsedOperation.success) throw unavailable();
  const value = parsedRun.data, op = parsedOperation.data;
  const epoch = (value: string | number) => typeof value === "number" ? value : Date.parse(value);
  const reservedAt = epoch(value.reservedAt), expiresAt = epoch(value.expiresAt);
  if (!Number.isFinite(reservedAt) || !Number.isFinite(expiresAt)) throw unavailable();
  return { status, run: { actor: input.actor, workspaceId: input.workspaceId, artifactId: input.artifactId, id: value.id, fence: value.fence,
    hold: { userId: input.actor, reference: value.reference, amount: value.amount, exempt: value.exempt, reservedAt },
    operation: status.operation, rateMicrousd: op.rateMicrousd, providerAllowanceMicrousd: op.providerRemainingMicrousd, expiresAt,
    originalMessage: typeof (data.requestContext as { message?: unknown } | null)?.message === "string" ? (data.requestContext as { message: string }).message : undefined,
    originalPlan: SitePlanSchema.safeParse((data.requestContext as { plan?: unknown } | null)?.plan).data } };
}

export function createOperationSpend(run: OperationRun, platformDeadline: number): RunSpend {
  const original = databaseGate(run.actor);
  const gate: SpendGate = {
    async begin(ticket) {
      const { data, error } = await billingDatabase().rpc("makeborne_ai_operation_provider_begin", {
        p_actor: run.actor, p_run: run.id, p_fence: run.fence, p_call: ticket.id,
        p_provider: ticket.provider, p_model: ticket.model, p_bound: ticket.boundMicrousd,
      });
      if (error) {
        if (error.code === "MB499") throw new SpendError("CANCELLED", "This request was stopped.");
        if (error.code === "MB402") throw new SpendError("PROVIDER_LIMIT", "Today's AI capacity has been reached.");
        if (error.code === "MB423") throw new SpendError("PROVIDER_DISABLED", "AI generation is paused right now.");
        if (error.code === "MB409" || error.code === "PT409") throw new SpendError("HOLD_EXPIRED", "This operation step can no longer make paid calls.");
        throw new SpendError("SPEND_UNAVAILABLE", "The spending record is unavailable.");
      }
      const result = object.safeParse(data);
      if (!result.success) throw new SpendError("SPEND_UNAVAILABLE", "The spending record is unavailable.");
      if (result.data.error) throw new SpendError("RUN_BUDGET", "This operation has no room for another paid call.");
      if (result.data.started !== true) throw new SpendError("SPEND_UNAVAILABLE", "This provider attempt was already recorded; it will not be sent twice.");
    },
    finish: original.finish,
  };
  return new RunSpend({ run: run.hold.reference, gate,
    providerCapMicrousd: Math.min(run.providerAllowanceMicrousd, run.hold.amount * run.rateMicrousd),
    customerCapMicrousd: run.hold.exempt ? null : run.hold.amount * run.rateMicrousd,
    deadline: Math.min(platformDeadline, run.expiresAt - SETTLEMENT_WINDOW_MS - CLOCK_SKEW_MS),
  });
}

/** A single durable transaction stores the result and applies its customer charge. */
export async function finishOperation(run: OperationRun, measuredMicrousd: number, outcome: OperationOutcome, detail: Record<string, unknown>, candidate?: OperationCandidate): Promise<OperationFinalization> {
  // Model summaries may be very long or multibyte. Keep the bounded audit
  // envelope valid so an otherwise usable result is not stranded by its prose.
  const boundedDetail = Object.fromEntries(Object.entries(detail).map(([key, value]) => {
    if (typeof value !== "string") return [key, value];
    const limit = key === "summary" ? 2000 : key === "message" ? 1000 : 256;
    let bytes = 0, text = "";
    for (const character of value) { bytes += Buffer.byteLength(character); if (bytes > limit) break; text += character; }
    return [key, text];
  }));
  if (!Number.isSafeInteger(Math.ceil(measuredMicrousd)) || measuredMicrousd < 0 || Buffer.byteLength(JSON.stringify(boundedDetail)) > 3800) throw unavailable();
  run.finalizationStarted = true;
  const data = await call("makeborne_ai_operation_finish", {
    p_actor: run.actor, p_run: run.id, p_fence: run.fence, p_measured_microusd: Math.max(0, Math.ceil(measuredMicrousd)),
    p_outcome: outcome, p_detail: boundedDetail, p_candidate: candidate ?? null,
  });
  checkRefusal(data);
  const status = publicStatus(data);
  const charged = z.number().int().nonnegative().safeParse(data.charged);
  if (!charged.success || typeof data.outcome !== "string") throw unavailable();
  run.operation = status.operation;
  return { ...status, charged: charged.data, outcome: data.outcome };
}

export function operationTerminal(status: OperationStatus): Record<string, unknown> {
  const result = status.result;
  return result ? { ...result, type: result.code ? "error" : "done", operation: status.operation, recoverable: Boolean(status.recovery) }
    : { type: "error", code: "OPERATION_RECOVERY_PENDING", message: "Checking this request's saved result and credit charge. Use its recovery status before retrying.", operation: status.operation };
}

/** Once finalization may have committed, read its durable result instead of
 * issuing a contradictory release or claiming that nothing was charged. */
export async function operationFailure(run: OperationRun, spend: RunSpend, detail: Record<string, unknown>, candidate?: OperationCandidate): Promise<Record<string, unknown>> {
  try {
    if (!run.finalizationStarted) return operationTerminal(await finishOperation(run, spend.confirmedMicrousd, "failed", detail, candidate));
    const status = await readOperation({ actor: run.actor, workspaceId: run.workspaceId, artifactId: run.artifactId, id: run.operation.id });
    if (status.result?.runId === run.id) return operationTerminal(status);
    return operationTerminal({ ...status, result: null });
  } catch {
    return { type: "error", code: "OPERATION_RECOVERY_PENDING", message: "Checking this request's saved result and credit charge. Use its recovery status before retrying.", operation: run.operation };
  }
}

export async function recoverOperation(input: { actor: string; workspaceId: string; artifactId: string; id: string; runId: string; expectedVersion: number }): Promise<OperationStatus> {
  const current = await readOperation(input);
  if (current.recovery?.runId !== input.runId && current.result?.runId !== input.runId)
    throw new OperationError("OPERATION_CONFLICT", "Choose this request's recoverable result.", 409, current.operation);
  const data = await call("makeborne_ai_operation_recover", { p_actor: input.actor, p_run: input.runId, p_expected_version: input.expectedVersion });
  checkRefusal(data);
  return publicStatus(data);
}

export async function authorizeOperation(input: { actor: string; workspaceId: string; artifactId: string; id: string; expectedRevision: number; authorizationKey: string; additionalCredits: number }): Promise<OperationStatus> {
  await readOperation(input);
  const data = await call("makeborne_ai_operation_authorize", { p_actor: input.actor, p_operation: input.id, p_expected_revision: input.expectedRevision, p_request: input.authorizationKey, p_additional_credits: input.additionalCredits });
  checkRefusal(data);
  return publicStatus(data);
}

export function operationApiError(error: unknown): Response {
  if (error instanceof OperationError) return Response.json({ error: { code: error.code, message: error.message }, ...(error.operation ? { operation: error.operation } : {}) }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  return apiError(error);
}

/** Exact completed-step replay uses saved output, without another provider call. */
export function operationReplayResponse(status: OperationStatus): Response {
  const events: unknown[] = [{ type: "operation", operation: status.operation }];
  const result = status.result;
  if (!result) events.push({ type: "error", code: "OPERATION_RECOVERY_PENDING", message: "This request is still being recovered. Check its status before retrying.", operation: status.operation });
  else {
    const stored = StoredPlanSchema.safeParse(result.stored);
    if (stored.success) events.push({ type: "plan", stored: stored.data, estimate: estimatePlanCredits(stored.data.plan), recommended: recommendedEffort(stored.data.plan), persisted: result.persisted === true });
    events.push(result.code ? { ...result, type: "error", operation: status.operation } : { ...result, type: "done", operation: status.operation });
  }
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}
