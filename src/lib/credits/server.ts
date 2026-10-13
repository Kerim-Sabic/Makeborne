import "server-only";
import { getAccountPrivileges } from "@/lib/account/privileges";
import { billingDatabase } from "@/lib/billing/database";
import { creditRuleFor } from "@/lib/billing/plan-credits";
import { RequestError } from "@/lib/server/http";

/**
 * Per-user credit wallet. Every mutation runs in one service-only SQL function
 * that locks the wallet row, so callers never read-modify-write balances.
 * Callers must pass a verified Auth user ID, never a client-supplied one.
 */
/** The soonest-expiring plan credits still available: an exact UTC instant (expired at it). */
export type CreditExpiry = { at: string; credits: number };
export type CreditBalance = { balance: number; reserved: number; available: number; unlimited: boolean; nextExpiry: CreditExpiry | null };

const INSUFFICIENT_MESSAGE = "You don't have enough credits for this. Add credits or choose a plan to keep creating.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unavailable(): never {
  throw new RequestError("CREDITS_UNAVAILABLE", "Credit balance is temporarily unavailable. Please try again.", 503);
}

function userIdOf(userId: string) {
  if (typeof userId !== "string" || !UUID.test(userId)) throw new RequestError("AUTH_REQUIRED", "Sign in to use credits.", 401);
  return userId;
}

function referenceOf(reference: string) {
  if (typeof reference !== "string" || reference.length < 1 || reference.length > 200)
    throw new RequestError("INVALID_CREDIT_REFERENCE", "A credit reference of 1-200 characters is required.", 400);
  return reference;
}

function wholeCredits(value: number, allowZero: boolean) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 1_000_000_000)
    throw new RequestError("INVALID_CREDIT_AMOUNT", "Credit amounts must be whole numbers.", 400);
  return value;
}

function count(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(number) ? number : 0;
}

function expiryOf(value: unknown): CreditExpiry | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const at = typeof data.at === "string" ? Date.parse(data.at) : NaN;
  const credits = count(data.credits);
  return Number.isFinite(at) && credits > 0 ? { at: new Date(at).toISOString(), credits } : null;
}

async function unlimitedSession(userId: string) {
  const privileges = await getAccountPrivileges(userId);
  return privileges.isAdmin || privileges.unlimitedCredits;
}

export async function getCreditBalance(userId: string): Promise<CreditBalance> {
  const id = userIdOf(userId);
  const [sessionUnlimited, wallet] = await Promise.all([
    unlimitedSession(id),
    billingDatabase().rpc("makeborne_credit_wallet", { p_user: id }),
  ]);
  if (wallet.error || !wallet.data || typeof wallet.data !== "object") unavailable();
  const data = wallet.data as Record<string, unknown>;
  return {
    balance: count(data.balance), reserved: count(data.reserved), available: count(data.available),
    unlimited: sessionUnlimited || data.unlimited === true, nextExpiry: expiryOf(data.nextExpiry),
  };
}

export type FreeTierOffer = { enabled: boolean; trialCredits: number };

/** The live free-tier offer (off unless the operator enables it). Public copy
 * reads this so it never promises a trial that is switched off; any failure
 * reads as "off". */
export async function getFreeTierOffer(): Promise<FreeTierOffer> {
  try {
    const { data, error } = await billingDatabase().rpc("makeborne_free_tier_offer");
    if (error || !data) return { enabled: false, trialCredits: 0 };
    const trialCredits = count((data as Record<string, unknown>).trialCredits);
    return { enabled: (data as Record<string, unknown>).enabled === true && trialCredits > 0, trialCredits };
  } catch {
    return { enabled: false, trialCredits: 0 };
  }
}

/**
 * Records a Whop payment as entitlement evidence. Only paid, unrefunded
 * subscription_create / subscription_cycle payments count; others are kept for
 * review. Idempotent per payment. Returns the database outcome.
 */
export async function recordPlanPayment(userId: string, membershipId: string, payment: { id: string; planId: string; billingReason: string; paidAt: string; refunded: boolean }) {
  const id = userIdOf(userId);
  const rule = creditRuleFor(payment.planId);
  if (!rule) return { outcome: "unknown_plan", granted: 0 };
  const { data, error } = await billingDatabase().rpc("makeborne_record_plan_payment", {
    p_user: id, p_membership: membershipId, p_payment_id: payment.id, p_whop_plan_id: payment.planId, p_tier: rule.tier,
    p_interval: rule.interval, p_monthly_credits: rule.monthlyCredits, p_billing_reason: payment.billingReason.slice(0, 40),
    p_paid_at: payment.paidAt, p_refunded: payment.refunded,
  });
  if (error || !data || typeof data !== "object") unavailable();
  const result = data as Record<string, unknown>;
  return { outcome: String(result.outcome ?? ""), granted: count(result.granted) };
}

/** Grants the one-time free-tier trial when eligible. Cheap and idempotent. */
export async function ensureTrialCredits(userId: string): Promise<void> {
  const { error } = await billingDatabase().rpc("makeborne_credit_ensure_trial", { p_user: userIdOf(userId) });
  if (error) unavailable();
}

/**
 * A credit hold for one billable run. Exempt holds (unlimited accounts) hold
 * nothing; their runs still go through provider spending limits.
 * The database reclaims a hold 15 minutes after `reservedAt`.
 */
export type CreditHold = { userId: string; reference: string; amount: number; exempt: boolean; reservedAt: number };
export const HOLD_LIFETIME_MS = 15 * 60_000;

/** Holds credits for work about to start. Must succeed before any provider call. */
export async function reserveCredits(userId: string, amount: number, reference: string): Promise<CreditHold> {
  const id = userIdOf(userId);
  const credits = wholeCredits(amount, false);
  const ref = referenceOf(reference);
  const reservedAt = Date.now();
  if (await unlimitedSession(id)) return { userId: id, reference: ref, amount: 0, exempt: true, reservedAt };
  // The SQL function also waives holds for unlimited accounts without a session.
  const { data, error } = await billingDatabase().rpc("makeborne_credit_reserve", { p_user: id, p_amount: credits, p_reference: ref });
  if (error?.code === "MB402") throw new RequestError("INSUFFICIENT_CREDITS", INSUFFICIENT_MESSAGE, 402);
  if (error || !data || typeof data !== "object") unavailable();
  const result = data as Record<string, unknown>;
  if (result.unlimited === true) return { userId: id, reference: ref, amount: 0, exempt: true, reservedAt };
  if (result.replayed === true || result.status !== "reserved" || count(result.amount) !== credits)
    throw new RequestError("CREDIT_HOLD_CONFLICT", "This run's credit hold could not be created. Please try again.", 409);
  return { userId: id, reference: ref, amount: credits, exempt: false, reservedAt };
}

/**
 * settled: charged min(measured, hold). replayed: an earlier settle stands.
 * exempt: unlimited account, nothing charged. missing_hold: no reservation
 * existed, a billing fault (nothing charged, logged). released_hold: the hold
 * was already released or timed out, so it cannot be charged.
 */
export type SettleOutcome = "settled" | "replayed" | "exempt" | "missing_hold" | "released_hold";
export type RunSettlement = { outcome: SettleOutcome; charged: number; absorbed: number; providerMicrousd: number };

/** Settles a run with its FULL measured usage; the database caps the charge at the hold and records the rest as absorbed. */
export async function settleRun(hold: CreditHold, measuredCredits: number, detail: Record<string, unknown> = {}): Promise<RunSettlement> {
  const measured = wholeCredits(measuredCredits, true);
  const { data, error } = await billingDatabase().rpc("makeborne_credit_settle_run", {
    p_user: hold.userId, p_reference: hold.reference, p_measured: measured, p_exempt: hold.exempt, p_detail: detail,
  });
  if (error || !data || typeof data !== "object") unavailable();
  const result = data as Record<string, unknown>;
  const outcome = String(result.outcome) as SettleOutcome;
  if (!["settled", "replayed", "exempt", "missing_hold", "released_hold"].includes(outcome)) unavailable();
  if (outcome === "missing_hold" || outcome === "released_hold")
    console.error(JSON.stringify({ event: "credit_settlement_anomaly", outcome, reference: hold.reference, measured }));
  return { outcome, charged: count(result.charged), absorbed: count(result.absorbed), providerMicrousd: count(result.providerMicrousd) };
}

/** Returns a hold without charging and records the run's measured usage as absorbed. */
export async function releaseRun(hold: CreditHold, measuredCredits: number, reason: string, detail: Record<string, unknown> = {}): Promise<void> {
  const { error } = await billingDatabase().rpc("makeborne_credit_release_run", {
    p_user: hold.userId, p_reference: hold.reference, p_measured: wholeCredits(measuredCredits, true), p_exempt: hold.exempt,
    p_reason: reason.slice(0, 120), p_detail: detail,
  });
  if (error) unavailable();
}

/** Whether the hold can still be charged (exempt holds always can). */
export async function holdIsActive(hold: CreditHold): Promise<boolean> {
  if (hold.exempt) return true;
  const { data, error } = await billingDatabase().rpc("makeborne_credit_hold_status", { p_user: hold.userId, p_reference: hold.reference });
  if (error || !data || typeof data !== "object") unavailable();
  return (data as Record<string, unknown>).active === true;
}

export type PlanObservation = {
  membershipId: string; planId: string; status: string; paid: boolean;
  periodStart: string | null; periodEnd: string | null; source: "webhook" | "access_check" | "reconcile";
};

/**
 * Records one verified observation of a Whop membership (its current state as
 * retrieved from Whop, never event payloads) and lets the database grant every
 * owed plan allocation from recorded history: each allocation month uses the
 * tier in force at its start, an upgrade tops up only the month it happens in,
 * and nothing is granted from a missing or inconsistent billing period.
 * Idempotent; safe on every webhook delivery and access check.
 */
export async function recordPlanObservation(userId: string, observation: PlanObservation): Promise<{ outcome: string; granted: number }> {
  const id = userIdOf(userId);
  const rule = creditRuleFor(observation.planId);
  if (!rule) throw new RequestError("UNKNOWN_CREDIT_PLAN", "This plan has no credit allowance.", 400);
  if (!/^mem_[A-Za-z0-9]+$/.test(observation.membershipId)) throw new RequestError("INVALID_MEMBERSHIP", "Membership reference is invalid.", 400);
  const { data, error } = await billingDatabase().rpc("makeborne_record_plan_observation", {
    p_user: id, p_membership: observation.membershipId, p_whop_plan_id: observation.planId, p_tier: rule.tier,
    p_interval: rule.interval, p_monthly_credits: rule.monthlyCredits, p_status: observation.status.slice(0, 40), p_paid: observation.paid,
    p_period_start: observation.periodStart, p_period_end: observation.periodEnd, p_source: observation.source,
  });
  if (error || !data || typeof data !== "object") unavailable();
  const result = data as Record<string, unknown>;
  return { outcome: String(result.outcome ?? ""), granted: count(result.granted) };
}
