import type { BuilderEstimates } from "../builder/credit-estimate";

/** Public prices in integer USD cents. Provider IDs and credentials stay server-side.
 * Set on 23 Oct 2026 at or below the main competitors' plans; the comparison is in
 * docs/market/teardown-2026-10-23/deep/pricing-economics.md. */
export const BILLING_TERMS_VERSION = "2026-10-25-beta-v9";
export const CREATION_PLANS = [
  { id: "create", name: "Create", monthlyCents: 2000, monthlyCredits: 300, sites: "unlimited", description: "For your own projects, one at a time." },
  { id: "studio", name: "Studio", monthlyCents: 4900, monthlyCredits: 750, sites: "unlimited", description: "For freelancers delivering client work every month." },
  { id: "scale", name: "Scale", monthlyCents: 9900, monthlyCredits: 1550, sites: "unlimited", description: "For agencies with several clients at once." },
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

/** Studio is steered to honestly: centre card, one highlight, what it is for. Never a popularity
 * claim ("Most popular" needs recorded subscription data; docs/pricing/OUTCOME_FIGURES.md). */
export const RECOMMENDED_PLAN: PlanId = "studio";
export const RECOMMENDED_BADGE = "Best for client work";
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
/** Risk reversal beside the plans, true under today's terms (/billing/terms). */
export const PLAN_PROMISES = Object.freeze([
  { id: "limit", title: "Limit shown first", body: "Every request shows the most it can charge before it starts. Going past it needs your OK." },
  { id: "errors", title: "Errors and unsaved work cost nothing", body: "A request that stops with an error, runs out of time before saving, or can’t be saved isn’t charged. A request that runs but doesn’t give you a usable change is charged for what it used." },
  { id: "carry", title: "Credits carry over", body: "Unused plan credits stay usable for two months after their month ends, soonest-expiring first." },
  { id: "cancel", title: "Cancel any time", body: "Cancel in your Whop account before your next renewal and keep access to the end of the period you paid for." },
  { id: "refund", title: "Refundable until used", body: "A payment is refundable in full while none of its credits have been used. Email admin@makeborne.com with your Whop payment reference. Your statutory rights still apply." },
] as const);
/** The integrity cue under the promises. `when` hides an item once the thing ships. */
export const NOT_READY_YET = Object.freeze([
  { id: "domains", text: "Custom domains: sites use a Makeborne web address for now." },
  { id: "print", text: "Print-ready books: books export for reading on screen and haven’t passed print checks." },
  { id: "yearly", text: "Yearly billing.", when: "noYearly" },
  { id: "switching", text: "Switching plans inside the app: email us instead." },
  { id: "packs", text: "One-time credit packs: planned for members after launch.", when: "packsClosed" },
] as const);
export function notReadyYet({ hasYearly, topupsOpen }: { hasYearly: boolean; topupsOpen: boolean }) {
  return NOT_READY_YET.filter(item => !("when" in item) || (item.when === "noYearly" ? !hasYearly : !topupsOpen));
}

/** Below this many measured runs a range is a rough guide, and the card says how many tests it rests on. */
export const FEW_SAMPLES = 5;
export const OUTCOME_KINDS = ["website", "presentation", "book"] as const;
export type PlanOutcome = { kind: typeof OUTCOME_KINDS[number]; low: number; typical: number; samples: number; few: boolean };
/** A month of credits as first builds of one kind, rounded down: from the most expensive measured
 * build (low) to the typical one (typical). Null without measurements; nothing is extrapolated. */
export function planOutcomes(credits: number, estimates: BuilderEstimates | null | undefined): PlanOutcome[] | null {
  if (!estimates) return null;
  return OUTCOME_KINDS.map(kind => {
    const range = estimates.firstBuild[kind];
    return { kind, low: Math.floor(credits / Math.max(1, range.max)), typical: Math.floor(credits / Math.max(1, range.median)), samples: range.samples, few: range.samples < FEW_SAMPLES };
  });
}
/** Requests a month of credits always covers at the default effort, each capped at its ceiling. */
export function mediumFloor(credits: number, ceilingCredits: number | null | undefined) {
  return ceilingCredits && ceilingCredits > 0 ? Math.floor(credits / ceilingCredits) : null;
}
/** What a customer pays per plan credit, in cents to one decimal. Never the AI cost per credit. */
export function pricePerCreditCents(planId: PlanId) {
  const plan = CREATION_PLANS.find(item => item.id === planId);
  if (!plan) throw new Error("Unknown plan");
  return Math.round(plan.monthlyCents / plan.monthlyCredits * 10) / 10;
}
/** Credits against the smallest plan: "2.5×", or "over 5×" when not a round tenth. Null for the smallest. */
export function creditMultiple(planId: PlanId) {
  const base = CREATION_PLANS[0], plan = CREATION_PLANS.find(item => item.id === planId);
  if (!plan || plan.id === base.id) return null;
  const ratio = plan.monthlyCredits / base.monthlyCredits;
  return Math.abs(ratio * 10 - Math.round(ratio * 10)) < 1e-9 ? `${Math.round(ratio * 10) / 10}×` : `over ${Math.floor(ratio)}×`;
}
/** A plan from a provider product name ("Makeborne Studio"): one whole-word match, else null. */
export function matchPlanTier(name: string | null | undefined): PlanId | null {
  if (!name) return null;
  const found = CREATION_PLANS.filter(plan => new RegExp(`\\b${plan.id}\\b`, "i").test(name));
  return found.length === 1 ? found[0].id : null;
}
