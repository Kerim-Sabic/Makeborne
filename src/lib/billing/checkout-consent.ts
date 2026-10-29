import "server-only";
import { RequestError } from "@/lib/server/http";
import { WITHDRAWAL_CONSENT_TEXT, PACK_WITHDRAWAL_CONSENT_TEXT } from "@/lib/legal/versions";
import { BILLING_TERMS_VERSION, WITHDRAWAL_CONSENT_VERSION } from "./plans";
import { billingDatabase } from "./database";

/** Require the displayed version; persist server-timed evidence against the
 * actual order, including resumes. This does not waive statutory rights. */
export function requireCheckoutConsent(version: unknown) {
  if (version !== WITHDRAWAL_CONSENT_VERSION)
    throw new RequestError("CHECKOUT_CONSENT_REQUIRED", "Please read and tick the immediate-start request before continuing to checkout.", 400);
}

export async function recordCheckoutConsent(userId: string, requestId: string, kind: "plan" | "pack") {
  const { data, error } = await billingDatabase().rpc("makeborne_record_checkout_consent", {
    p_user: userId, p_request: requestId, p_kind: kind,
    p_version: WITHDRAWAL_CONSENT_VERSION, p_terms: BILLING_TERMS_VERSION,
    p_text: kind === "plan" ? WITHDRAWAL_CONSENT_TEXT : PACK_WITHDRAWAL_CONSENT_TEXT,
  });
  if (error || data !== true)
    throw new RequestError("CHECKOUT_CONSENT_UNSAVED", "Your checkout agreement could not be saved. No new payment link has been opened. Please try again later.", 503);
}

/** Reserve the new plan checkout AND consent in one transaction. A failed
 * evidence write must not strand a pending checkout before Whop was contacted.
 * Preserve existing checkout-trigger error codes for the route's resume guard. */
export async function prepareConsentedPlanCheckout(userId: string, requestId: string, planId: string, returnPath: string) {
  const result = await billingDatabase().rpc("makeborne_prepare_consented_checkout", {
    p_user: userId, p_request: requestId, p_plan: planId, p_return: returnPath,
    p_version: WITHDRAWAL_CONSENT_VERSION, p_terms: BILLING_TERMS_VERSION, p_text: WITHDRAWAL_CONSENT_TEXT,
  });
  if (!result.error && result.data !== true)
    throw new RequestError("CHECKOUT_CONSENT_UNSAVED", "Your checkout agreement could not be saved. Please try again later.", 503);
  return result;
}
