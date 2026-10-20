/** Public prices in integer USD cents. Provider IDs and credentials stay server-side. */
export const BILLING_TERMS_VERSION = "2026-10-20-standard-v7";
export const CREATION_PLANS = [
  { id: "create", name: "Create", monthlyCents: 2900, monthlyCredits: 300, sites: "unlimited", description: "For your next independent project.", features: ["Websites, books and presentations", "Client tracking and follow-ups", "Custom styles and editable exports"] },
  { id: "studio", name: "Studio", monthlyCents: 7900, monthlyCredits: 850, sites: "unlimited", description: "For a growing client business.", features: ["Everything in Create", "More monthly credits for client projects", "Shared reviews and spending controls"] },
  { id: "scale", name: "Scale", monthlyCents: 19900, monthlyCredits: 2200, sites: "unlimited", description: "For a larger monthly workload.", features: ["Everything in Studio", "Our largest monthly credit allowance", "Websites, books and presentations"] },
] as const;
export type PlanId = typeof CREATION_PLANS[number]["id"];
/** Yearly billing: twelve months at this percentage off. */
export const YEARLY_DISCOUNT_PERCENT = 20;
/** Live founding offer: this percentage off the first term (first month or first year).
 * Margins are enforced in ./margins.ts; a draft 15% yearly founding discount is modelled there. */
export const FOUNDING_DISCOUNT_PERCENT = 30;
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
