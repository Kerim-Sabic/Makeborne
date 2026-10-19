import "server-only";
import { billingDatabase } from "../billing/database";
import { aiCostUsdPerCredit } from "../builder/pricing";
import { HOLD_LIFETIME_MS, type CreditHold } from "../credits/server";
import { RunSpend, SpendError, type SpendGate } from "./run-spend";
import { AI_STOP_MESSAGES } from "./failure";
import { RequestError } from "../server/http";
import type { ProviderCapacity } from "../builder/availability";

/**
 * Preflight before any credit hold: refuses with a retryable 503 when the
 * provider's spending is paused/stopped or today's limit is used up, so work
 * that cannot start never touches credits. Only a reason is returned, never amounts.
 */
export async function requireProviderCapacity(provider: "anthropic" | "openai") {
  const capacity = await providerCapacity(provider);
  if (capacity === "available") return;
  if (capacity === "unavailable") throw new RequestError("AI_UNAVAILABLE", AI_STOP_MESSAGES.AI_UNAVAILABLE, 503);
  if (capacity === "limit") throw new RequestError("AI_DAILY_LIMIT", AI_STOP_MESSAGES.AI_DAILY_LIMIT, 503);
  throw new RequestError("AI_PAUSED", AI_STOP_MESSAGES.AI_PAUSED, 503);
}

/** The same preflight as a reason, for saying what can be offered before work is requested. */
export async function providerCapacity(provider: "anthropic" | "openai"): Promise<ProviderCapacity> {
  try {
    const { data, error } = await billingDatabase().rpc("makeborne_provider_spend_status", { p_provider: provider });
    if (error || !data || typeof data !== "object") return "unavailable";
    const status = data as { available?: unknown; reason?: unknown };
    if (status.available === true) return "available";
    return status.reason === "limit" ? "limit" : "paused";
  } catch { return "unavailable"; }
}

/**
 * Hold timing. The database reclaims a hold 15 minutes after it was created
 * (database clock). Every provider call must END by the run deadline:
 *   deadline = min(platform deadline, reservedAt + 15 min - SETTLEMENT_WINDOW_MS - CLOCK_SKEW_MS)
 * reservedAt is taken before the reserve call (app clock), so it is no later
 * than the hold's creation; CLOCK_SKEW_MS covers app/database clock skew.
 * Calls get a hard timeout of the time left, retries wait only within it, and
 * no call starts with under 30 s left. The settlement window covers the hold
 * check, the save and the settle; the hold check runs on the database clock.
 */
export const SETTLEMENT_WINDOW_MS = 60_000;
export const CLOCK_SKEW_MS = 30_000;
/** Total margin before the hold's end (kept for callers of the old name). */
export const HOLD_SAFETY_MS = SETTLEMENT_WINDOW_MS + CLOCK_SKEW_MS;

/** Platform-wide daily provider limits, enforced atomically in the database. */
export function databaseGate(userId: string | null): SpendGate {
  return {
    async begin(call) {
      const { error } = await billingDatabase().rpc("makeborne_provider_call_begin", {
        p_call: call.id, p_user: userId, p_run: call.run, p_provider: call.provider, p_model: call.model, p_bound: call.boundMicrousd,
      });
      if (!error) return;
      if (error.code === "MB402") throw new SpendError("PROVIDER_LIMIT", AI_STOP_MESSAGES.AI_DAILY_LIMIT);
      if (error.code === "MB423") throw new SpendError("PROVIDER_DISABLED", AI_STOP_MESSAGES.AI_PAUSED);
      throw new SpendError("SPEND_UNAVAILABLE", AI_STOP_MESSAGES.AI_UNAVAILABLE);
    },
    async finish(id, outcome) {
      const { error } = await billingDatabase().rpc("makeborne_provider_call_finish", {
        p_call: id, p_actual: outcome.actualMicrousd, p_partial: outcome.partialMicrousd, p_detail: outcome.detail ?? {},
      });
      // The call stays open and later expires at its full bound; stop the run.
      if (error) throw new SpendError("SPEND_UNAVAILABLE", "AI spending controls are unavailable; the run stopped.");
    },
  };
}

/**
 * Spending for one live run. providerCapCredits is the effort ceiling (provider
 * dollars, applies to everyone); the hold is the customer's limit (none when
 * exempt). No call starts after the platform deadline or near the hold's end.
 */
export function createRunSpend(input: { hold: CreditHold; providerCapCredits: number; platformDeadline: number; gate?: SpendGate }) {
  const rate = aiCostUsdPerCredit();
  return new RunSpend({
    run: input.hold.reference,
    providerCapMicrousd: Math.floor(input.providerCapCredits * rate * 1e6),
    customerCapMicrousd: input.hold.exempt ? null : Math.floor(input.hold.amount * rate * 1e6),
    gate: input.gate ?? databaseGate(input.hold.userId),
    deadline: Math.min(input.platformDeadline, input.hold.reservedAt + HOLD_LIFETIME_MS - SETTLEMENT_WINDOW_MS - CLOCK_SKEW_MS),
  });
}

/** Settlement detail for audit: provider cost as this process saw it. */
export function spendDetail(spend: RunSpend) {
  return { calls: spend.calls.length, providerMicrousd: spend.providerMicrousd, uncertainMicrousd: spend.uncertainMicrousd,
    confirmedMicrousd: spend.confirmedMicrousd, stopped: spend.stopped };
}
