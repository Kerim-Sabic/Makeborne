import "server-only";
import { z } from "zod";
import { CreditTopupPaymentSchema, CreditTopupPurchaseSchema, type CreditTopupPayment } from "./topups-contracts";
import { reconcileCreditTopup } from "./topups-reconcile";
import { whopGet } from "./whop";

/** Provider evidence is deliberately separate from ledger fulfillment. Never
 * accept a browser/webhook body as a paid purchase or commit these effects
 * without the atomic database adapter and unique payment binding. */
export class TopupProviderEvidenceError extends Error {
  readonly code = "TOPUP_PROVIDER_EVIDENCE_UNVERIFIED";
  constructor() { super("Credit-pack payment evidence needs review before any balance changes."); }
}

const money = z.union([z.number().finite().nonnegative(), z.string()]);
const rawPayment = z.object({
  id: z.string().regex(/^pay_[A-Za-z0-9]+$/),
  company: z.object({ id: z.string().regex(/^biz_[A-Za-z0-9]+$/) }),
  plan: z.object({ id: z.string().regex(/^plan_[A-Za-z0-9]+$/) }),
  user: z.object({ id: z.string().regex(/^user_[A-Za-z0-9]+$/) }),
  checkout_configuration_id: z.string().regex(/^ch_[A-Za-z0-9]+$/),
  billing_reason: z.literal("one_time"),
  currency: z.literal("usd"),
  status: z.enum(["paid", "pending", "failed"]),
  substatus: z.string(),
  subtotal: money,
  total: money,
  tax_amount: money.nullable(),
  tax_refunded_amount: money.nullable(),
  refunded_amount: money.nullable(),
  tax_behavior: z.enum(["exclusive", "inclusive", "unspecified", "unable_to_collect"]).nullable(),
  promo_code: z.unknown().nullable(),
  disputes: z.array(z.object({ status: z.string() })).max(100),
  updated_at: z.string().datetime(),
});

/** Exact integer cents; never round imprecise/sub-cent provider values. */
export function providerUsdCents(value: number | string): bigint {
  const text = String(value);
  if (!/^(0|[1-9][0-9]{0,12})(?:\.[0-9]{1,2})?$/.test(text)) throw new TopupProviderEvidenceError();
  const [whole, fraction = ""] = text.split(".");
  const cents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new TopupProviderEvidenceError();
  return cents;
}

function disputeStatus(statuses: string[]): CreditTopupPayment["dispute"] {
  const allowed = new Set(["won", "lost", "needs_response", "under_review", "warning_needs_response", "warning_under_review", "warning_closed"]);
  if (statuses.some(status => !allowed.has(status))) throw new TopupProviderEvidenceError();
  if (statuses.includes("lost")) return "lost";
  if (statuses.some(status => status !== "won" && status !== "warning_closed")) return "open";
  return statuses.length ? "won" : "none";
}

/** Official retrieve-payment fields, pinned API version via whopGet. Unknown
 * tax/refund allocation or provider state stops here, rather than guessing.
 * Tax-free fulfillment is the initial supported subset until a taxed sandbox fixture
 * proves whether refunded_amount includes tax in the pinned API version.
 * Sources: docs.whop.com/api-reference/payments/retrieve-payment (2026-10-13). */
export function normalizeWhopTopupPayment(purchaseInput: unknown, providerInput: unknown): CreditTopupPayment {
  const purchase = CreditTopupPurchaseSchema.safeParse(purchaseInput);
  const result = rawPayment.safeParse(providerInput);
  if (!purchase.success || !result.success) throw new TopupProviderEvidenceError();
  const p = result.data;
  const tax = providerUsdCents(p.tax_amount ?? 0);
  const taxRefund = providerUsdCents(p.tax_refunded_amount ?? 0);
  const principal = providerUsdCents(p.subtotal);
  const total = providerUsdCents(p.total);
  const refunded = providerUsdCents(p.refunded_amount ?? 0);
  // Do not guess tax or promotion allocation from approximate totals. A taxed
  // record requires a reviewed pinned-version fixture before being enabled.
  if (tax !== BigInt(0) || taxRefund !== BigInt(0) || total !== principal || p.promo_code !== null || refunded > principal) throw new TopupProviderEvidenceError();
  if (p.status === "paid" && ["pending", "failed"].includes(p.substatus)) throw new TopupProviderEvidenceError();
  if (p.status !== "paid" && p.substatus !== p.status) throw new TopupProviderEvidenceError();
  const ordinary = new Set(["succeeded", "refunded", "partially_refunded", "pending", "failed"]);
  const held = new Set(["dispute_warning", "dispute_needs_response", "dispute_warning_needs_response", "resolution_needs_response",
    "dispute_under_review", "dispute_warning_under_review", "resolution_under_review", "dispute_closed", "open_dispute", "open_resolution"]);
  const lost = new Set(["dispute_lost", "resolution_lost"]);
  const won = new Set(["dispute_won", "resolution_won", "dispute_warning_closed"]);
  if (!ordinary.has(p.substatus) && !held.has(p.substatus) && !lost.has(p.substatus) && !won.has(p.substatus)) throw new TopupProviderEvidenceError();
  const statuses = [...p.disputes.map(d => d.status)];
  if (lost.has(p.substatus)) statuses.push("lost");
  if (held.has(p.substatus)) statuses.push("needs_response");
  if (won.has(p.substatus)) statuses.push("won");
  if (p.substatus === "refunded" && refunded !== principal) throw new TopupProviderEvidenceError();
  if (p.substatus === "partially_refunded" && (refunded === BigInt(0) || refunded === principal)) throw new TopupProviderEvidenceError();
  const payment = CreditTopupPaymentSchema.safeParse({
    id: p.id, merchantId: p.company.id, planId: p.plan.id,
    checkoutId: p.checkout_configuration_id, whopUserId: p.user.id,
    currency: p.currency, principalCents: principal.toString(), refundedPrincipalCents: refunded.toString(),
    status: refunded === principal && principal > BigInt(0) ? "refunded" : p.status,
    dispute: disputeStatus(statuses), updatedAt: p.updated_at,
  });
  if (!payment.success) throw new TopupProviderEvidenceError();
  // Existing reconciliation is the single source for ownership/amount binding.
  reconcileCreditTopup(purchase.data, null, payment.data);
  return payment.data;
}

export async function retrieveVerifiedTopupPayment(purchase: unknown, paymentId: string) {
  if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) throw new TopupProviderEvidenceError();
  const evidence = normalizeWhopTopupPayment(purchase, await whopGet(`/payments/${paymentId}`, { attempts: 2 }));
  if (evidence.id !== paymentId) throw new TopupProviderEvidenceError();
  return evidence;
}
