import "server-only";
import { createHash } from "node:crypto";
import { RequestError } from "@/lib/server/http";
import { autotopupConsentText, type AutotopupStatus } from "./autotopup-consent";
import { billingDatabase } from "./database";

/**
 * Automatic top-up setup (authorization only). Charging is not implemented:
 * no code path calls Whop to charge, and the database switch ships off. The
 * setup screen is shown only where MAKEBORNE_AUTOTOPUP_SETUP_ENABLED=true
 * (local or staging qualification); production leaves it unset.
 */
export const autotopupSetupEnabled = (env: Record<string, string | undefined> = process.env) => env.MAKEBORNE_AUTOTOPUP_SETUP_ENABLED === "true";

function requireSetup() {
  if (!autotopupSetupEnabled()) throw new RequestError("AUTOTOPUP_NOT_AVAILABLE", "Automatic top-ups are not available.", 404);
}

const rpcFailure = (error: { code?: string } | null) => {
  if (error?.code === "PT503") return new RequestError("AUTOTOPUP_PRICE_PENDING", "Automatic top-ups do not have an approved price yet.", 409);
  if (error?.code === "PT409") return new RequestError("AUTOTOPUP_OFFER_CHANGED", "The automatic top-up offer changed. Review it again before enabling.", 409);
  if (error?.code === "22023") return new RequestError("AUTOTOPUP_INVALID_CHOICE", "Choose one of the offered amounts.", 400);
  if (error?.code === "42501") return new RequestError("AUTH_REQUIRED", "Confirm your account email first.", 401);
  return new RequestError("AUTOTOPUP_UNAVAILABLE", "Automatic top-up settings are unavailable right now. Nothing was changed.", 503);
};

export async function autotopupStatus(userId: string) {
  const { data, error } = await billingDatabase().rpc("makeborne_autotopup_status", { p_user: userId });
  if (error || !data) throw rpcFailure(error);
  return { ...data as AutotopupStatus, setupEnabled: autotopupSetupEnabled() };
}

/** Hiding new setup must never hide an existing customer's right to revoke.
 * On an uncertain read, show the retryable panel instead of assuming no consent. */
export async function autotopupPanelVisible(userId: string): Promise<boolean> {
  if (autotopupSetupEnabled()) return true;
  try { return Boolean((await autotopupStatus(userId)).authorization); }
  catch { return true; }
}

export async function authorizeAutotopup(userId: string, choice: { termsVersion: string; priceCents: number; threshold: number; monthlyLimit: number }) {
  requireSetup();
  // The consent text names the current daily limit, so read the offer the customer saw.
  const { offer } = await autotopupStatus(userId);
  const consent = autotopupConsentText(offer, choice.priceCents, choice.threshold, choice.monthlyLimit, offer.maxDailyCharges);
  const { data, error } = await billingDatabase().rpc("makeborne_autotopup_authorize", { p_user: userId, p_terms_version: choice.termsVersion,
    p_price_cents: choice.priceCents, p_threshold: choice.threshold, p_monthly_limit: choice.monthlyLimit,
    p_consent_sha256: createHash("sha256").update(consent, "utf8").digest("hex") });
  if (error || !data) throw rpcFailure(error);
  return { ...data as AutotopupStatus, setupEnabled: autotopupSetupEnabled() };
}

export async function revokeAutotopup(userId: string) {
  const { data, error } = await billingDatabase().rpc("makeborne_autotopup_revoke", { p_user: userId, p_reason: "Turned off by the customer" });
  if (error || !data) throw rpcFailure(error);
  return { ...data as AutotopupStatus, setupEnabled: autotopupSetupEnabled() };
}
