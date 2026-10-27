/** Public prices in integer USD cents. Provider IDs and credentials stay server-side.
 * Set on 23 Oct 2026 at or below the main competitors' plans; the comparison is in
 * docs/market/teardown-2026-10-23/deep/pricing-economics.md. */
export const BILLING_TERMS_VERSION = "2026-10-25-beta-v9";
export const CREATION_PLANS = [
  { id: "create", name: "Create", monthlyCents: 2000, monthlyCredits: 300, sites: "unlimited", description: "For your own projects, one at a time.", features: ["Websites, books and presentations", "Client tracking, follow-ups and client reviews", "Spending controls and usage history"] },
  { id: "studio", name: "Studio", monthlyCents: 4900, monthlyCredits: 750, sites: "unlimited", description: "For freelancers delivering client work every month.", features: ["Everything in Create", "More monthly credits for client projects"] },
  { id: "scale", name: "Scale", monthlyCents: 9900, monthlyCredits: 1550, sites: "unlimited", description: "For agencies with several clients at once.", features: ["Everything in Studio", "Our largest monthly credit allowance"] },
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

/** One switch for tax and fee wording beside every price. The terms say taxes and checkout fees are
 * shown by Whop before payment, so a bare "$49 today" is not the total. After the EU/UK launch gate
 * (Whop tax-inclusive consumer prices on, no buyer checkout fee confirmed), switch to:
 * { short: "Price includes any tax that applies.", inline: ", including any tax", long: "Prices include any tax that applies." } */
export const TAX_NOTE = Object.freeze({
  short: "Tax and any checkout fee shown before you pay.",
  inline: " plus any tax or checkout fee Whop shows",
  long: "Any tax or checkout fee is shown by Whop before you pay.",
});
/** Every plan includes all of this; plans differ only in monthly credits. Each item cites the code
 * path that verifies it in docs/pricing/OUTCOME_FIGURES.md. The fair-use sentence appears once. */
export const PLAN_INCLUDES = Object.freeze([
  "Websites, books and presentations",
  "Unlimited websites while your plan is active. Fair use: 50 new sites per day, 1,000 live sites per workspace.",
  "Publishing and hosting for your sites at no credit cost while your plan is active",
  "Client tracking and follow-ups in the built-in CRM, plus client reviews",
  "Editing by hand, previews, versions and source download at no credit cost",
  "Spending controls: a low-balance alert and a monthly usage limit",
  "Usage history showing the project and action behind each charge",
] as const);
export const PLAN_INCLUDES_FOOTNOTE = "Custom-domain connections are not available yet.";
