/** Public prices in integer USD cents. Provider IDs and credentials stay server-side. */
export const BILLING_TERMS_VERSION = "2026-10-05-subscription-v2";
export const CREATION_PLANS = [
  { id: "create", name: "Create", monthlyCents: 2900, monthlyCredits: 300, seats: 1, sites: 1, storage: "2 GB", description: "For your next independent project.", features: ["Websites, books and presentations", "Client tracking and follow-ups", "Custom styles and editable exports"] },
  { id: "studio", name: "Studio", monthlyCents: 7900, monthlyCredits: 1000, seats: 3, sites: 5, storage: "10 GB", description: "For a growing client business.", features: ["Everything planned for Create", "More capacity for client projects", "Shared reviews and spending controls"] },
  { id: "scale", name: "Scale", monthlyCents: 19900, monthlyCredits: 2800, seats: 5, sites: 15, storage: "30 GB", description: "For a team with bigger ambitions.", features: ["Everything planned for Studio", "More work running at once", "Expanded hosting and asset storage"] },
] as const;
export type PlanId = typeof CREATION_PLANS[number]["id"];
export type BillingInterval = "monthly" | "yearly";
export function planPrice(planId: PlanId, interval: BillingInterval, founding: boolean) {
  const plan = CREATION_PLANS.find(item => item.id === planId);
  if (!plan) throw new Error("Unknown plan");
  const standardCents = interval === "yearly" ? plan.monthlyCents * 12 * 80 / 100 : plan.monthlyCents;
  return { standardCents, priceCents: founding ? Math.round(standardCents * 70 / 100) : standardCents, months: interval === "yearly" ? 12 : 1, monthlyCredits: plan.monthlyCredits };
}
export function usd(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}
