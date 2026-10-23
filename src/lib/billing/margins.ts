import { CREATION_PLANS, FOUNDING_DISCOUNT_PERCENT, planPrice, type BillingInterval, type PlanId } from "./plans";
import { CREDIT_TOPUP_PACKS } from "./topups-catalog";

/**
 * Margin guardrails for customer-facing credit prices.
 *
 * A credit is an internal unit of AI cost (`aiCostUsdPerCredit()` in
 * src/lib/builder/pricing.ts, $0.03 by default). Customers buy credits through
 * plans and top-ups at a higher price per credit. The AI-only gross margin of
 * an offer is the share of its price left after paying for every included
 * credit at that internal cost: 1 − credits × cost ÷ price. "Every credit used"
 * is the worst case; it excludes payment fees, hosting, storage and support.
 *
 * Accuracy caveat: these margins are only as accurate as usage costing. Live
 * builder usage is priced from the verified price card in src/lib/ai/prices.ts
 * (checked 2026-10-12 against the providers' published prices; unknown models
 * fail closed) using each response's reported usage, including per-attempt
 * fallback iterations and image token usage. Usage that cannot be confirmed is
 * recorded at its bound as provider cost but not charged to customers, which
 * lowers margins. Reconcile against real invoices before relying on these
 * figures; a stale price card silently lowers every margin computed here.
 */
export const MARGIN_POLICY = {
  /** Enforced now: no live offer may fall below this. The tightest live offer
   * is a yearly plan (Scale, 41.3%), so any change that lowers margins further fails. */
  enforcedMinAiMargin: 0.4,
  /** Target for monthly plans, which all meet it. Yearly plans sit between the
   * two floors so that prices stay at or below the field (owner, 23 Oct 2026). */
  proposedMinAiMargin: 0.5,
} as const;

export type Offer = {
  id: string;
  kind: "plan" | "topup";
  label: string;
  /** What the customer pays for `credits`, in USD cents (per month for plans). */
  revenueCents: number;
  credits: number;
};

const INTERVALS: BillingInterval[] = ["monthly", "yearly"];

/** Every way a customer can buy credits, including founding terms when a founding discount is set. */
export function creditOffers(): Offer[] {
  const offers: Offer[] = [];
  for (const plan of CREATION_PLANS) {
    for (const interval of INTERVALS) {
      for (const founding of FOUNDING_DISCOUNT_PERCENT ? [false, true] : [false]) {
        const price = planPrice(plan.id as PlanId, interval, founding);
        offers.push({
          id: `${plan.id}:${interval}${founding ? ":founding" : ""}`, kind: "plan",
          label: `${plan.name} ${interval}${founding ? ` founding (${FOUNDING_DISCOUNT_PERCENT}% off first term)` : ""}`,
          revenueCents: price.priceCents / price.months, credits: price.monthlyCredits,
        });
      }
    }
  }
  for (const pack of CREDIT_TOPUP_PACKS) offers.push({ id: `topup:${pack.id}`, kind: "topup", label: `Top-up ${pack.credits} credits`, revenueCents: pack.priceCents, credits: pack.credits });
  return offers;
}

export const revenuePerCreditUsd = (offer: Offer) => offer.revenueCents / 100 / offer.credits;

/** AI-only gross margin when every credit in the offer is used. */
export const aiMargin = (offer: Offer, aiCostUsdPerCredit: number) => 1 - aiCostUsdPerCredit / revenuePerCreditUsd(offer);

/** Highest internal AI cost per credit at which every offer keeps `floor`. */
export function maxAiCostUsdPerCredit(offers: Offer[], floor: number) {
  return Math.min(...offers.map(offer => revenuePerCreditUsd(offer) * (1 - floor)));
}

/** Offers below `floor` at the given AI cost per credit (worst first). */
export function offersBelow(offers: Offer[], aiCostUsdPerCredit: number, floor: number) {
  return offers.map(offer => ({ ...offer, margin: aiMargin(offer, aiCostUsdPerCredit) }))
    .filter(offer => offer.margin < floor).sort((a, b) => a.margin - b.margin);
}
