import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { billingDatabase } from "../billing/database";
import { RequestError } from "../server/http";
import { canonicalSourceJson } from "../projects/canonical-json";
import { databaseGate } from "../ai/live-run";
import { SpendError, type RunSpend, type SpendGate } from "../ai/run-spend";
import { EnhanceActionSchema, actionMessage, type EnhanceAction } from "./enhance-action";

/** One durable brief-improvement action (supabase/migrations/20261022100000_brief_enhancement_actions.sql).
 * Every call is a service-only SQL function that checks the actor's editor permission on the artifact. */
export type EnhanceScope = { actor: string; workspaceId: string; artifactId: string; key: string };
export type EnhanceRun = { id: string; fence: string; reference: string; amount: number; exempt: boolean; reservedAt: number; leaseExpiresAt: number };
export type EnhanceOutcome = "completed" | "failed" | "cancelled";

const statusUnavailable = () => new RequestError("ENHANCE_STATUS_UNAVAILABLE", "This brief improvement's saved status couldn't be confirmed. Check it again before retrying; it will not be run twice.", 503);
const object = z.record(z.string(), z.unknown());
const runSchema = z.object({ id: z.string().uuid(), fence: z.string().uuid(), reference: z.string().min(1).max(200), amount: z.number().int().nonnegative(), exempt: z.boolean(),
  reservedAt: z.string(), leaseExpiresAt: z.string() });

async function call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  let response: { data: unknown; error: { code?: string } | null };
  try {
    const request = billingDatabase().rpc(name, args);
    response = await (signal ? request.abortSignal(signal) : request);
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw statusUnavailable();
  }
  const { data, error } = response;
  if (error) {
    if (error.code === "42501") throw new RequestError("EDITOR_REQUIRED", "Only owners and editors can improve a brief for this project.", 403);
    if (error.code === "P0002") throw new RequestError("ENHANCE_NOT_FOUND", "This brief improvement could not be found.", 404);
    if (error.code === "PT409" || error.code === "23505") throw new RequestError("ENHANCE_KEY_CONFLICT", "This brief improvement was already requested with different details. Start a new one.", 409);
    if (error.code === "MB402") throw new RequestError("INSUFFICIENT_CREDITS", "INSUFFICIENT_CREDITS", 402);
    if (error.code === "MB403") throw new RequestError("CREDIT_USAGE_LIMIT", "CREDIT_USAGE_LIMIT", 402);
    throw statusUnavailable();
  }
  const parsed = object.safeParse(data);
  if (!parsed.success) throw statusUnavailable();
  return parsed.data;
}

function action(value: unknown): EnhanceAction {
  const parsed = EnhanceActionSchema.safeParse(value);
  if (!parsed.success) throw statusUnavailable();
  return parsed.data;
}

/** The canonical request identity: the normalised body (validated, trimmed, defaults applied), sorted keys. */
export function enhanceInputDigest(body: object): string {
  return createHash("sha256").update(canonicalSourceJson(JSON.parse(JSON.stringify(body)))).digest("hex");
}

const scopeArgs = (scope: EnhanceScope) => ({ p_actor: scope.actor, p_workspace: scope.workspaceId, p_artifact: scope.artifactId, p_action: scope.key });

/** The action, or null when this key was never claimed (for this actor and project). */
export async function readEnhancement(scope: EnhanceScope, signal?: AbortSignal): Promise<EnhanceAction | null> {
  try { return action((await call("makeborne_brief_enhance_read", scopeArgs(scope), signal)).action); }
  catch (error) { if (error instanceof RequestError && error.code === "ENHANCE_NOT_FOUND") return null; throw error; }
}

/** Claims the action and its hold in one transaction; a repeat of the same request replays the stored action. */
export async function claimEnhancement(scope: EnhanceScope, input: { digest: string; mode: "enhance" | "analyze"; holdCredits: number; providerCapMicrousd: number }):
  Promise<{ replayed: true; action: EnhanceAction } | { replayed: false; action: EnhanceAction; run: EnhanceRun }> {
  const data = await call("makeborne_brief_enhance_claim", { ...scopeArgs(scope), p_input_hash: input.digest, p_mode: input.mode,
    p_hold_credits: input.holdCredits, p_provider_cap_microusd: input.providerCapMicrousd });
  const claimed = action(data.action);
  if (data.replayed === true) return { replayed: true, action: claimed };
  const run = runSchema.safeParse(data.run);
  if (data.replayed !== false || !run.success) throw statusUnavailable();
  const reservedAt = Date.parse(run.data.reservedAt), leaseExpiresAt = Date.parse(run.data.leaseExpiresAt);
  if (!Number.isFinite(reservedAt) || !Number.isFinite(leaseExpiresAt)) throw statusUnavailable();
  return { replayed: false, action: claimed, run: { ...run.data, reservedAt, leaseExpiresAt } };
}

export async function cancelEnhancement(scope: EnhanceScope): Promise<EnhanceAction> {
  return action((await call("makeborne_brief_enhance_cancel", scopeArgs(scope))).action);
}

/** Durably records the worker's outcome (before any release, so the result can never be lost or regenerated). */
export async function recordEnhancement(scope: EnhanceScope, run: EnhanceRun, outcome: { outcome: EnhanceOutcome; result: unknown; failure: unknown; measuredCredits: number; providerMicrousd: number }): Promise<EnhanceAction> {
  const data = await call("makeborne_brief_enhance_record", { p_actor: scope.actor, p_id: run.id, p_fence: run.fence, p_outcome: outcome.outcome,
    p_result: outcome.result ?? null, p_failure: outcome.failure ?? null, p_measured: Math.max(0, Math.ceil(outcome.measuredCredits)), p_provider_microusd: Math.max(0, Math.ceil(outcome.providerMicrousd)) });
  return action(data.action);
}

/** Returns the hold exactly once and verifies it; repeating it (recovery after a failed or lost reply) is a replay. */
export async function releaseEnhancement(scope: EnhanceScope): Promise<{ action: EnhanceAction; replayed: boolean }> {
  const data = await call("makeborne_brief_enhance_release", scopeArgs(scope));
  return { action: action(data.action), replayed: data.replayed === true };
}

/** The provider gate for this action's worker: the database refuses a call after Stop, after the lease or hold ended, or beyond the cap. */
export function enhancementGate(scope: EnhanceScope, run: EnhanceRun): SpendGate {
  const shared = databaseGate(scope.actor);
  return {
    async begin(ticket) {
      let response: { data: unknown; error: { code?: string } | null };
      try {
        response = await billingDatabase().rpc("makeborne_brief_enhance_provider_begin", { p_actor: scope.actor, p_id: run.id, p_fence: run.fence, p_call: ticket.id,
          p_provider: ticket.provider, p_model: ticket.model, p_bound: ticket.boundMicrousd });
      } catch { throw new SpendError("SPEND_UNAVAILABLE", "The spending record is unavailable."); }
      const { data, error } = response;
      if (error) {
        if (error.code === "MB499") throw new SpendError("CANCELLED", "This brief improvement was stopped.");
        if (error.code === "MB402") throw new SpendError("PROVIDER_LIMIT", "Today's AI capacity has been reached.");
        if (error.code === "MB423") throw new SpendError("PROVIDER_DISABLED", "AI generation is paused right now.");
        if (error.code === "PT409") throw new SpendError("HOLD_EXPIRED", "This brief improvement can no longer make paid calls.");
        throw new SpendError("SPEND_UNAVAILABLE", "The spending record is unavailable.");
      }
      const result = object.safeParse(data);
      if (!result.success) throw new SpendError("SPEND_UNAVAILABLE", "The spending record is unavailable.");
      if (result.data.error) throw new SpendError("RUN_BUDGET", "This brief improvement has no room for another paid call.");
      if (result.data.started !== true) throw new SpendError("SPEND_UNAVAILABLE", "This provider attempt was already recorded; it will not be sent twice.");
    },
    finish: shared.finish,
  };
}

/** Explicit, durable Stop (never a browser disconnect) interrupts the worker. An unreadable status stops it conservatively. */
export function watchEnhancementStop(scope: EnhanceScope, spend: RunSpend, controller: AbortController, pollMs = stopPollMs()) {
  let disposed = false, timer: ReturnType<typeof setTimeout>;
  const poll = async () => {
    try {
      const current = await readEnhancement(scope, AbortSignal.timeout(3000));
      if (disposed) return;
      if (!current || current.cancelRequested || current.status !== "running") { spend.cancel(); controller.abort(new SpendError("CANCELLED", "This brief improvement was stopped.")); return; }
    } catch {
      if (!disposed) controller.abort(new SpendError("SPEND_UNAVAILABLE", "The brief improvement could not be checked; it stopped."));
      return;
    }
    if (!disposed && !controller.signal.aborted) { timer = setTimeout(() => void poll(), pollMs); timer.unref?.(); }
  };
  timer = setTimeout(() => void poll(), pollMs); timer.unref?.();
  return () => { disposed = true; clearTimeout(timer); };
}
function stopPollMs() {
  const value = Number(process.env.MAKEBORNE_ENHANCE_STOP_POLL_MS);
  return Number.isFinite(value) && value >= 20 && value <= 5000 ? value : 1000;
}

/** One response shape for every enhance endpoint. Only a completed action with a verified release carries a usable result. */
export function enhanceActionResponse(current: EnhanceAction, replayed = false): Response {
  const headers = { "Cache-Control": "no-store" };
  if (current.status === "completed" && current.result && current.chargedCredits !== null)
    return Response.json({ action: current, replayed, mode: current.result.mode, enhanced: current.result.enhanced, text: current.result.text, charged: current.chargedCredits }, { headers });
  const status = current.status === "running" ? 202 : current.status === "cancelled" || current.status === "needs_review" ? 409 : 503;
  const code = { running: "ENHANCE_RUNNING", releasing: "ENHANCE_BILLING_PENDING", failed: "ENHANCE_UNAVAILABLE", expired: "ENHANCE_EXPIRED", cancelled: "ENHANCE_CANCELLED",
    needs_review: "ENHANCE_BILLING_REVIEW", completed: "ENHANCE_BILLING_PENDING" }[current.status];
  return Response.json({ action: current, replayed, error: { code, message: actionMessage(current) } }, { status, headers });
}
