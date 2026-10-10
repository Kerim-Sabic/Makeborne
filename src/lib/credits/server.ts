import "server-only";
import { getAccountPrivileges } from "@/lib/account/privileges";
import { billingDatabase } from "@/lib/billing/database";
import { creditPlanFor } from "@/lib/billing/plan-credits";
import { RequestError } from "@/lib/server/http";

/**
 * Per-user credit wallet. Every mutation runs in one service-only SQL function
 * that locks the wallet row, so callers never read-modify-write balances.
 * Callers must pass a verified Auth user ID, never a client-supplied one.
 */
export type CreditBalance = { balance: number; reserved: number; available: number; unlimited: boolean };

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
    unlimited: sessionUnlimited || data.unlimited === true,
  };
}

/** Grants the one-time free-tier trial when eligible. Cheap and idempotent. */
export async function ensureTrialCredits(userId: string): Promise<void> {
  const { error } = await billingDatabase().rpc("makeborne_credit_ensure_trial", { p_user: userIdOf(userId) });
  if (error) unavailable();
}

/** Holds credits for work about to start. Replays with the same reference are no-ops. */
export async function reserveCredits(userId: string, amount: number, reference: string): Promise<void> {
  const id = userIdOf(userId);
  const credits = wholeCredits(amount, false);
  const ref = referenceOf(reference);
  if (await unlimitedSession(id)) return;
  // The SQL function also waives holds for unlimited accounts without a session.
  const { error } = await billingDatabase().rpc("makeborne_credit_reserve", { p_user: id, p_amount: credits, p_reference: ref });
  if (error?.code === "MB402") throw new RequestError("INSUFFICIENT_CREDITS", INSUFFICIENT_MESSAGE, 402);
  if (error) unavailable();
}

/** Charges min(actual, held + available) and returns any unused hold. Idempotent per reference. */
export async function settleCredits(userId: string, reference: string, actual: number): Promise<{ charged: number }> {
  const id = userIdOf(userId);
  const credits = wholeCredits(actual, true);
  const ref = referenceOf(reference);
  if (await unlimitedSession(id)) return { charged: 0 };
  const { data, error } = await billingDatabase().rpc("makeborne_credit_settle", { p_user: id, p_reference: ref, p_actual: credits });
  if (error?.code === "PT409") throw new RequestError("CREDITS_RELEASED", "This credit hold was already released.", 409);
  if (error || !data || typeof data !== "object") unavailable();
  return { charged: count((data as Record<string, unknown>).charged) };
}

/** Returns a hold without charging. Unknown or already-resolved references are no-ops. */
export async function releaseCredits(userId: string, reference: string): Promise<void> {
  const { error } = await billingDatabase().rpc("makeborne_credit_release", { p_user: userIdOf(userId), p_reference: referenceOf(reference) });
  if (error) unavailable();
}

/** Grants a plan's monthly credits once per membership billing period. */
export async function grantPlanCredits(userId: string, planId: string, membershipId: string, periodEnd: string): Promise<void> {
  const id = userIdOf(userId);
  const plan = creditPlanFor(planId);
  if (!plan) throw new RequestError("UNKNOWN_CREDIT_PLAN", "This plan has no credit allowance.", 400);
  if (!/^mem_[A-Za-z0-9]+$/.test(membershipId)) throw new RequestError("INVALID_MEMBERSHIP", "Membership reference is invalid.", 400);
  const end = Date.parse(periodEnd);
  if (!Number.isFinite(end)) throw new RequestError("INVALID_MEMBERSHIP", "Membership period is invalid.", 400);
  const period = new Date(end).toISOString();
  const { error } = await billingDatabase().rpc("makeborne_credit_grant", {
    p_user: id, p_amount: plan.monthlyCredits, p_kind: "plan_grant", p_reference: `plan:${membershipId}:${period}`,
    p_metadata: { plan: plan.id, whopPlanId: planId.startsWith("plan_") ? planId : null, membershipId, periodEnd: period },
  });
  if (error) unavailable();
}
