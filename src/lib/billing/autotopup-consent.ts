import { usd } from "./plans";

/** Automatic top-up offer as stored (makeborne_autotopup_status). priceCents is null until the owner approves a price. */
export type AutotopupOffer = { chargingEnabled: boolean; termsVersion: string; credits: number; priceCents: number | null; maxMonthlyCharges: number; maxDailyCharges: number; thresholds: number[] };
export type AutotopupAuthorization = { id: number; termsVersion: string; credits: number; priceCents: number; thresholdCredits: number; monthlyLimitCharges: number; dailyLimitCharges: number; authorizedAt: string };
export type AutotopupStatus = { offer: AutotopupOffer; authorization: AutotopupAuthorization | null; attempts: { state: string; credits: number; priceCents: number; createdAt: string; resolvedAt: string | null; failureCode: string | null }[] };

/**
 * The exact authorization the customer confirms. The server rebuilds it from the
 * submitted choices and stores its SHA-256 with the authorization, so the record
 * shows precisely what was agreed. Any change to this text needs a new terms version.
 */
export function autotopupConsentText(offer: Pick<AutotopupOffer, "termsVersion" | "credits">, priceCents: number, threshold: number, monthlyLimit: number, dailyLimit = 2) {
  const times = monthlyLimit === 1 ? "once" : `up to ${monthlyLimit} times`;
  return `When my available Makeborne credits fall below ${threshold}, Makeborne may charge my payment method saved with Whop ${usd(priceCents)} for ${offer.credits} credits, `
    + `${times} per calendar month and at most ${dailyLimit === 1 ? "once" : `${dailyLimit} times`} a day (at most ${usd(priceCents * monthlyLimit)} a month). `
    + `Each top-up is a separate credit-pack payment and its credits do not expire. I can turn automatic top-ups off at any time in Billing, which stops future charges; `
    + `a top-up already sent to Whop completes or fails normally, and its credits are added only if it succeeds. A top-up is refundable while none of its credits have been used. `
    + `Terms version ${offer.termsVersion}.`;
}
