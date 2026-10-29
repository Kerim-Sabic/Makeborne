import "server-only";
import { billingUser, verifyCreationAccess } from "./access";
import type { CreditTopupAvailability } from "./topups-catalog";
import { CREDIT_TOPUP_CATALOG_VERSION, CREDIT_TOPUP_PACKS } from "./topups-catalog";
import { billingConfig } from "./config";
import { billingDatabase } from "./database";
import { checkoutForTopup } from "./topup-checkout";
import { requireCheckoutConsent, recordCheckoutConsent } from "./checkout-consent";
import { RequestError } from "@/lib/server/http";
import type { z } from "zod";
import type { CreditTopupInputSchema } from "./topups-contracts";

export const CREDIT_TOPUPS_NOT_OPEN = "Credit packs are being prepared. Checkout opens when automatic credit delivery is ready.";

export function topupCheckoutOpen() {
  const config = billingConfig();
  // billingConfig's sandbox enablement is restricted to the isolated local
  // auth stack/merchant and refuses Vercel. Test mode cannot open live sales.
  const qualified = process.env.MAKEBORNE_TOPUP_CHECKOUT_QUALIFIED === "true"
    || (config.sandbox && process.env.MAKEBORNE_TOPUP_SANDBOX_TEST === "true");
  return process.env.WHOP_TOPUPS_ENABLED === "true" && qualified
    && process.env.MAKEBORNE_TOPUP_MIGRATIONS_VERIFIED === "true" && config.enabled;
}

async function catalogVerified() {
  const { data, error } = await billingDatabase().rpc("makeborne_topup_catalog_available", { p_version: CREDIT_TOPUP_CATALOG_VERSION, p_merchant: billingConfig().companyId });
  return !error && Array.isArray(data) && data.length === CREDIT_TOPUP_PACKS.length && CREDIT_TOPUP_PACKS.every(pack =>
    data.filter(row => row?.id === pack.id && row.credits === pack.credits && row.priceCents === pack.priceCents).length === 1);
}

export async function creditTopupAvailability(): Promise<CreditTopupAvailability> {
  const user = await billingUser();
  let eligible = false;
  if (user) {
    try { eligible = await verifyCreationAccess(user); }
    catch { return { available: false, authenticated: true, eligible: false, reason: "We could not confirm your membership. Please try again shortly." }; }
  }
  const available = Boolean(user && eligible && topupCheckoutOpen() && await catalogVerified());
  return { available, reason: available ? null : CREDIT_TOPUPS_NOT_OPEN, authenticated: Boolean(user), eligible };
}

/** Caller authenticates and requires a paid creation membership before invoking. */
export async function createTopupCheckout(userId: string, input: z.infer<typeof CreditTopupInputSchema>) {
  requireCheckoutConsent(input.withdrawalConsent);
  if (!topupCheckoutOpen() || !await catalogVerified()) throw new RequestError("TOPUPS_NOT_OPEN", CREDIT_TOPUPS_NOT_OPEN, 503);
  const db = billingDatabase(), now = new Date().toISOString();
  const { data: memberships, error } = await db.from("billing_memberships").select("whop_user_id")
    .eq("user_id", userId).in("status", ["active", "canceling"]).gt("verified_until", now).gt("period_end", now).limit(10);
  const identities = new Set((memberships ?? []).map(row => row.whop_user_id).filter(id => /^user_[A-Za-z0-9]+$/.test(id ?? "")));
  if (error || (memberships?.length ?? 0) >= 10 || identities.size !== 1) throw new RequestError("TOPUP_IDENTITY_UNVERIFIED", "Confirm your paid membership before buying credits.", 409);
  const { data: purchase, error: preparationError } = await db.rpc("makeborne_prepare_topup", { p_user: userId, p_request: input.requestId,
    p_pack: input.packId, p_version: CREDIT_TOPUP_CATALOG_VERSION, p_whop_user: [...identities][0] });
  if (preparationError || !purchase || purchase.user_id !== userId) throw new RequestError("TOPUP_PREPARATION_FAILED", "Your credit pack checkout needs confirmation. Please try again or contact support.", 409);
  // The prepare RPC may resume an older order. Bind its actual frozen request.
  await recordCheckoutConsent(userId, purchase.request_id, "pack");
  return checkoutForTopup(purchase);
}
