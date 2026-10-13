import "server-only";
import { z } from "zod";
import { RequestError } from "@/lib/server/http";
import { BILLING_TERMS_VERSION } from "./plans";
import { billingConfig } from "./config";
import { billingDatabase } from "./database";
import { checkoutUrl, whopGet, whopRequest } from "./whop";
import { providerUsdCents } from "./topup-fulfillment";

const rowSchema = z.object({ id: z.string().uuid(), user_id: z.string().uuid(), request_id: z.string().uuid(),
  merchant_id: z.string().regex(/^biz_[A-Za-z0-9]+$/), plan_id: z.string().regex(/^plan_[A-Za-z0-9]+$/),
  whop_user_id: z.string().regex(/^user_[A-Za-z0-9]+$/), price_cents: z.number().int().positive().safe(),
  state: z.enum(["awaiting_payment", "funded", "held", "reversed"]),
  checkout_url: z.string().nullable(), checkout_request: z.record(z.string(), z.unknown()).nullable() });
const planSchema = z.object({ id: z.string(), company: z.object({ id: z.string() }), currency: z.literal("usd"),
  plan_type: z.literal("one_time"), initial_price: z.union([z.number(), z.string()]), renewal_price: z.union([z.number(), z.string()]),
  trial_period_days: z.number().nullable() });
const checkoutSchema = z.object({ id: z.string().regex(/^ch_[A-Za-z0-9]+$/), company_id: z.string(), plan: z.object({ id: z.string() }), purchase_url: z.string() });

/** Purchase is the server's frozen RPC row, never a browser-provided amount/identity. */
export async function checkoutForTopup(purchase: unknown) {
  const row = rowSchema.parse(purchase), config = billingConfig(), db = billingDatabase();
  if (row.merchant_id !== config.companyId) throw new RequestError("WRONG_MERCHANT", "This purchase could not be verified.", 403);
  if (row.state !== "awaiting_payment") throw new RequestError("CREDIT_PACK_CHECKOUT_RESOLVED", "This credit pack purchase is already paid or under review. Check your credits or contact support before paying again.", 409);
  if (row.checkout_url) return { url: checkoutUrl(row.checkout_url), purchaseId: row.id, resumed: true };
  const plan = planSchema.safeParse(await whopGet(`/plans/${row.plan_id}`, { attempts: 2 }));
  let verified = false;
  if (plan.success) {
    try { verified = plan.data.id === row.plan_id && plan.data.company.id === row.merchant_id
      && providerUsdCents(plan.data.initial_price) === BigInt(row.price_cents) && providerUsdCents(plan.data.renewal_price) === BigInt(0)
      && (plan.data.trial_period_days === null || plan.data.trial_period_days === 0); } catch { /* Refuse imprecise provider money. */ }
  }
  if (!verified)
    throw new RequestError("CREDIT_PACK_PRICE_UNVERIFIED", "Credit pack pricing could not be verified. No checkout was opened.", 503);
  const body = row.checkout_request ?? { plan_id: row.plan_id, mode: "payment",
    metadata: { makeborne_topup_order_id: row.id, makeborne_terms_version: BILLING_TERMS_VERSION },
    redirect_url: config.sandbox ? "https://sandbox.whop.com/" : `https://makeborne.com/billing?topup=${row.id}` };
  const { data: claim, error: claimError } = await db.rpc("makeborne_claim_topup_checkout", { p_user: row.user_id, p_order: row.id, p_request: body });
  if (claimError || !claim || typeof claim.claimed !== "boolean") throw new RequestError("CREDIT_PACK_RECOVERY_REQUIRED", "This checkout needs confirmation. Please contact support before starting another purchase.", 409);
  if (!claim.claimed) {
    const previous = rowSchema.parse(claim.purchase);
    if (previous.id !== row.id || previous.user_id !== row.user_id || previous.plan_id !== row.plan_id)
      throw new RequestError("CREDIT_PACK_CHECKOUT_UNVERIFIED", "Your checkout could not be confirmed.", 503);
    if (previous.state !== "awaiting_payment") throw new RequestError("CREDIT_PACK_CHECKOUT_RESOLVED", "This credit pack purchase is already paid or under review. Check your credits or contact support before paying again.", 409);
    if (previous.checkout_url) return { url: checkoutUrl(previous.checkout_url), purchaseId: row.id, resumed: true };
    throw new RequestError("CREDIT_PACK_CHECKOUT_PENDING", "Your checkout is being prepared. Please wait a moment and try again.", 409);
  }
  // Explicit header, immutable request, bounded database claims. No automatic
  // POST retries; an uncertain response can resume using the same key/body.
  const checkout = checkoutSchema.safeParse(await whopRequest("/checkout_configurations", body, { idempotencyKey: `makeborne-topup-${row.id}` }));
  if (!checkout.success || checkout.data.company_id !== row.merchant_id || checkout.data.plan.id !== row.plan_id)
    throw new RequestError("CREDIT_PACK_CHECKOUT_UNVERIFIED", "Your checkout could not be confirmed. Please wait before trying again.", 503);
  const url = checkoutUrl(checkout.data.purchase_url);
  const { data: saved, error } = await db.rpc("makeborne_save_topup_checkout", { p_user: row.user_id, p_order: row.id, p_checkout: checkout.data.id, p_url: url });
  if (error || !saved || saved.id !== row.id || saved.checkout_id !== checkout.data.id || saved.checkout_url !== url)
    throw new RequestError("CREDIT_PACK_CHECKOUT_UNVERIFIED", "Your checkout is awaiting confirmation. Please try again shortly.", 503);
  return { url, purchaseId: row.id, resumed: false };
}
