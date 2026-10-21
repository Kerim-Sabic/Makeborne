import "server-only";
import { z } from "zod";
import { RequestError } from "@/lib/server/http";
import { billingConfig } from "./config";
import { billingDatabase } from "./database";
import { whopGet, whopTime, type WhopMembership } from "./whop";

/**
 * Subscription payment evidence. Whop keeps a membership "active" after its
 * payment is refunded (real sandbox, 2026-10-19), so the payment itself, freshly
 * retrieved, is the authority for that period's credits and creation access.
 * The database records it (makeborne_reconcile_plan_payment) and converges
 * credits, access and review issues; nothing here changes balances directly.
 */
export class PlanPaymentEvidenceError extends Error {
  readonly code = "PLAN_PAYMENT_UNVERIFIED";
  constructor() { super("Subscription payment evidence needs review before access or credits change."); }
}

export type PlanPaymentEvidence = {
  id: string; membershipId: string; planId: string; billingReason: string; currency: string;
  principalCents: string; refundedPrincipalCents: string; status: "paid" | "refunded" | "pending" | "failed";
  dispute: "none" | "open" | "won" | "lost"; paidAt: string | null; updatedAt: string;
};

const money = z.union([z.number().finite().nonnegative(), z.string()]);
const rawPayment = z.object({
  id: z.string().regex(/^pay_[A-Za-z0-9]+$/),
  company: z.object({ id: z.string().regex(/^biz_[A-Za-z0-9]+$/) }),
  plan: z.object({ id: z.string().regex(/^plan_[A-Za-z0-9]+$/) }),
  membership: z.object({ id: z.string().regex(/^mem_[A-Za-z0-9]+$/) }),
  billing_reason: z.string().min(1).max(40),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  status: z.string().min(1).max(40),
  substatus: z.string().min(1).max(60),
  total: money,
  refunded_amount: money.nullable(),
  disputes: z.array(z.object({ status: z.string() })).max(100).optional(),
  paid_at: z.union([z.string(), z.number()]).nullable().optional(),
  updated_at: z.string().datetime({ offset: true }),
});

/** Exact hundredths of the payment currency; never round imprecise values. */
function exactCents(value: number | string): bigint {
  const text = String(value);
  if (!/^(0|[1-9][0-9]{0,12})(?:\.[0-9]{1,2})?$/.test(text)) throw new PlanPaymentEvidenceError();
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
}

// Same provider vocabulary as credit-pack evidence (topup-fulfillment.ts).
const HELD = new Set(["dispute_warning", "dispute_needs_response", "dispute_warning_needs_response", "resolution_needs_response",
  "dispute_under_review", "dispute_warning_under_review", "resolution_under_review", "dispute_closed", "open_dispute", "open_resolution"]);
const LOST = new Set(["dispute_lost", "resolution_lost"]);
const WON = new Set(["dispute_won", "resolution_won", "dispute_warning_closed"]);
const DISPUTE_STATUSES = new Set(["won", "lost", "needs_response", "under_review", "warning_needs_response", "warning_under_review", "warning_closed"]);

function disputeOf(substatus: string, disputes: { status: string }[]): PlanPaymentEvidence["dispute"] {
  const statuses = disputes.map(item => item.status);
  if (statuses.some(status => !DISPUTE_STATUSES.has(status))) throw new PlanPaymentEvidenceError();
  if (LOST.has(substatus)) statuses.push("lost");
  if (HELD.has(substatus)) statuses.push("needs_response");
  if (WON.has(substatus)) statuses.push("won");
  if (statuses.includes("lost")) return "lost";
  if (statuses.some(status => status !== "won" && status !== "warning_closed")) return "open";
  return statuses.length ? "won" : "none";
}

/**
 * Retrieve-payment fields at the pinned API version (whopGet). Full versus partial
 * refund follows the provider substatus; inconsistent amounts or unknown states
 * stop here (the webhook answers 503 and Whop retries; the job reports a failure).
 */
export function normalizeWhopPlanPayment(input: unknown): PlanPaymentEvidence {
  const parsed = rawPayment.safeParse(input);
  if (!parsed.success) throw new PlanPaymentEvidenceError();
  const p = parsed.data;
  const principal = exactCents(p.total);
  const refundedAmount = exactCents(p.refunded_amount ?? 0);
  const paidAt = p.paid_at == null ? null : whopTime(p.paid_at);
  const base = { id: p.id, membershipId: p.membership.id, planId: p.plan.id, billingReason: p.billing_reason, currency: p.currency.toLowerCase(),
    principalCents: principal.toString(), paidAt, updatedAt: new Date(Date.parse(p.updated_at)).toISOString() };
  if (p.status !== "paid") {
    // Unpaid attempts fund nothing; the database ignores them unless a recorded payment regresses.
    return { ...base, refundedPrincipalCents: "0", status: p.substatus === "failed" ? "failed" : "pending", dispute: "none" };
  }
  if (!paidAt) throw new PlanPaymentEvidenceError();
  const dispute = disputeOf(p.substatus, p.disputes ?? []);
  let refunded: bigint;
  if (p.substatus === "refunded") {
    if (principal === BigInt(0)) throw new PlanPaymentEvidenceError();
    refunded = principal;
  } else if (p.substatus === "partially_refunded") {
    if (refundedAmount === BigInt(0) || refundedAmount >= principal) throw new PlanPaymentEvidenceError();
    refunded = refundedAmount;
  } else if (p.substatus === "succeeded") {
    if (refundedAmount !== BigInt(0)) throw new PlanPaymentEvidenceError();
    refunded = BigInt(0);
  } else if (HELD.has(p.substatus) || LOST.has(p.substatus) || WON.has(p.substatus)) {
    if (refundedAmount > principal) throw new PlanPaymentEvidenceError();
    refunded = refundedAmount;
  } else throw new PlanPaymentEvidenceError();
  const status = refunded === principal && principal > BigInt(0) ? "refunded" : "paid";
  return { ...base, refundedPrincipalCents: refunded.toString(), status, dispute };
}

export async function retrieveVerifiedPlanPayment(paymentId: string) {
  if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) throw new PlanPaymentEvidenceError();
  const raw = await whopGet(`/payments/${paymentId}`, { attempts: 2 });
  const company = (raw as { company?: { id?: unknown } } | null)?.company?.id;
  if (company !== billingConfig().companyId) throw new RequestError("WRONG_MERCHANT", "This payment belongs to a different merchant.", 403);
  const evidence = normalizeWhopPlanPayment(raw);
  if (evidence.id !== paymentId) throw new PlanPaymentEvidenceError();
  return evidence;
}

export type PlanPaymentOutcome = { outcome: string; state?: string; attribution?: string; revoked?: boolean; needsReview?: boolean;
  withheldCredits?: number; consumedExposureCredits?: number };

/** Records the payment and converges credits/access. The live membership's period helps attribute a payment that arrives first. */
export async function reconcilePlanPayment(userId: string, membership: Pick<WhopMembership, "id" | "renewal_period_start" | "renewal_period_end">, payment: PlanPaymentEvidence) {
  if (payment.membershipId !== membership.id) throw new PlanPaymentEvidenceError();
  const hints = membership.renewal_period_start && membership.renewal_period_end && Date.parse(membership.renewal_period_end) > Date.parse(membership.renewal_period_start)
    ? { p_period_start: membership.renewal_period_start, p_period_end: membership.renewal_period_end } : { p_period_start: null, p_period_end: null };
  const { data, error } = await billingDatabase().rpc("makeborne_reconcile_plan_payment", { p_user: userId, p_membership: membership.id, p_payment: payment, ...hints });
  if (error) throw new RequestError("PLAN_PAYMENT_STORAGE_UNAVAILABLE", "The subscription payment could not be reconciled. Retry this delivery.", 503);
  return data as PlanPaymentOutcome;
}

/** Payment referenced by a payment, refund or dispute event. */
export function eventPaymentId(event: { type: string; data: Record<string, unknown> }): string | null {
  const valid = (value: unknown) => typeof value === "string" && /^pay_[A-Za-z0-9]+$/.test(value) ? value : null;
  if (event.type.startsWith("payment.")) return valid(event.data.id);
  if (event.type.startsWith("refund.") || event.type.startsWith("dispute.")) {
    const payment = event.data.payment;
    return payment && typeof payment === "object" ? valid((payment as { id?: unknown }).id) : null;
  }
  return null;
}
