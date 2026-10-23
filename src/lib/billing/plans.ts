/** Public prices in integer USD cents. Provider IDs and credentials stay server-side.
 * Set on 23 Oct 2026 at or below the main competitors' plans; the comparison is in
 * docs/market/teardown-2026-10-23/deep/pricing-economics.md. */
export const BILLING_TERMS_VERSION = "2026-10-23-standard-v8";
export const CREATION_PLANS = [
  { id: "create", name: "Create", monthlyCents: 2000, monthlyCredits: 300, sites: "unlimited", description: "For your next independent project.", features: ["Websites, books and presentations", "Client tracking and follow-ups", "Custom styles and editable exports"] },
  { id: "studio", name: "Studio", monthlyCents: 4900, monthlyCredits: 750, sites: "unlimited", description: "For a growing client business.", features: ["Everything in Create", "More monthly credits for client projects", "Shared reviews and spending controls"] },
  { id: "scale", name: "Scale", monthlyCents: 9900, monthlyCredits: 1550, sites: "unlimited", description: "For a larger monthly workload.", features: ["Everything in Studio", "Our largest monthly credit allowance", "Websites, books and presentations"] },
] as const;
export type PlanId = typeof CREATION_PLANS[number]["id"];
/** Yearly billing: twelve months at this percentage off. */
export const YEARLY_DISCOUNT_PERCENT = 20;
/** Founding offer: this percentage off the first term (first month or first year).
 * None at launch: the standard prices are already at or below the field. Any
 * future discount must keep MARGIN_POLICY.enforcedMinAiMargin (./margins.ts). */
export const FOUNDING_DISCOUNT_PERCENT = 0;
export type BillingInterval = "monthly" | "yearly";
export function planPrice(planId: PlanId, interval: BillingInterval, founding: boolean) {
  const plan = CREATION_PLANS.find(item => item.id === planId);
  if (!plan) throw new Error("Unknown plan");
  const standardCents = interval === "yearly" ? plan.monthlyCents * 12 * (100 - YEARLY_DISCOUNT_PERCENT) / 100 : plan.monthlyCents;
  return { standardCents, priceCents: founding ? Math.round(standardCents * (100 - FOUNDING_DISCOUNT_PERCENT) / 100) : standardCents, months: interval === "yearly" ? 12 : 1, monthlyCredits: plan.monthlyCredits };
}
export function usd(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}
