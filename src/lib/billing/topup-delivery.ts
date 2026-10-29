import "server-only";
import { z } from "zod";
import { RequestError } from "@/lib/server/http";
import { billingConfig } from "./config";
import { billingDatabase } from "./database";
import { whopGet } from "./whop";
import { CreditTopupPurchaseSchema } from "./topups-contracts";
import { normalizeWhopTopupPayment } from "./topup-fulfillment";
import { confirmAfterFulfillment } from "./purchase-confirmations";

const referenceSchema = z.object({
  id: z.string().regex(/^pay_[A-Za-z0-9]+$/),
  company: z.object({ id: z.string().regex(/^biz_[A-Za-z0-9]+$/) }),
  plan: z.object({ id: z.string().regex(/^plan_[A-Za-z0-9]+$/) }).nullable(),
  checkout_configuration_id: z.string().regex(/^ch_[A-Za-z0-9]+$/).nullable(),
});
const storedSchema = z.object({
  id: z.string().uuid(), user_id: z.string().uuid(), request_id: z.string().uuid(),
  pack_id: z.string(), catalog_version: z.string(), credits: z.number().int().positive().safe(), price_cents: z.number().int().positive().safe(),
  merchant_id: z.string(), plan_id: z.string(), whop_user_id: z.string(), checkout_id: z.string(), created_at: z.string(),
});

export function storedTopupPurchase(value: unknown) {
  const row = storedSchema.parse(value);
  return CreditTopupPurchaseSchema.parse({ id: row.id, userId: row.user_id, creditAccountId: row.user_id,
    requestId: row.request_id, packId: row.pack_id, catalogVersion: row.catalog_version, credits: String(row.credits),
    priceCents: String(row.price_cents), currency: "usd", merchantId: row.merchant_id, planId: row.plan_id,
    whopUserId: row.whop_user_id, checkoutId: row.checkout_id, createdAt: new Date(row.created_at).toISOString() });
}

/** Only call after signature + merchant checks. Never use event data as payment evidence. */
export function topupEventPaymentId(event: { type: string; data: Record<string, unknown> }) {
  const candidate = event.type.startsWith("payment.") ? event.data.id
    : event.type.startsWith("refund.") || event.type.startsWith("dispute.")
      ? z.object({ id: z.string() }).safeParse(event.data.payment).data?.id : null;
  return typeof candidate === "string" && /^pay_[A-Za-z0-9]+$/.test(candidate) ? candidate : null;
}

/** Also used by scheduled reconciliation: refunds keep working with checkout closed. */
export async function deliverTopupPayment(paymentId: string): Promise<boolean> {
  if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) throw new RequestError("INVALID_PAYMENT", "Payment could not be verified.", 400);
  const raw = await whopGet(`/payments/${paymentId}`, { attempts: 2 });
  const reference = referenceSchema.safeParse(raw);
  if (!reference.success || reference.data.id !== paymentId) throw new RequestError("PAYMENT_UNVERIFIED", "Payment evidence is unavailable.", 503);
  if (reference.data.company.id !== billingConfig().companyId) throw new RequestError("WRONG_MERCHANT", "Payment belongs to another merchant.", 403);
  if (!reference.data.checkout_configuration_id || !reference.data.plan) return false;
  const db = billingDatabase();
  const { data: lookup, error: lookupError } = await db.rpc("makeborne_find_topup_payment", {
    p_payment: paymentId, p_checkout: reference.data.checkout_configuration_id,
    p_plan: reference.data.plan.id, p_merchant: reference.data.company.id,
  });
  if (lookupError || !lookup || typeof lookup.knownPack !== "boolean") throw new RequestError("TOPUP_STORAGE_UNAVAILABLE", "Credit delivery is awaiting verification.", 503);
  if (!lookup.purchase) {
    if (lookup.knownPack) throw new RequestError("TOPUP_BINDING_PENDING", "Credit purchase binding is awaiting verification. Retry delivery.", 503);
    return false;
  }
  let funded = false;
  try {
    const purchase = storedTopupPurchase(lookup.purchase);
    const payment = normalizeWhopTopupPayment(purchase, raw);
    const { data: result, error } = await db.rpc("makeborne_reconcile_topup", { p_user: purchase.userId, p_order: purchase.id, p_payment: payment });
    if (error || !result || !["updated", "duplicate", "stale", "ignored_attempt"].includes(result.outcome)) throw new Error("Unconfirmed ledger result");
    funded = result.state === "funded";
  } catch {
    // No provider payload or purchaser information is exposed in an API error.
    throw new RequestError("TOPUP_DELIVERY_UNVERIFIED", "Credit delivery requires verification. Retry delivery or contact support.", 503);
  }
  // Durable purchase confirmation at the moment of fulfilment, on every delivery path (webhook and
  // reconcile). Idempotent per payment; it never throws, so it cannot fail or repeat a delivery.
  if (funded) await confirmAfterFulfillment(paymentId);
  return true;
}
