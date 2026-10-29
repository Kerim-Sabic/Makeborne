import "server-only";
import { z } from "zod";
import { billingConfig, CREATION_CATALOG, SUPPORT } from "./config";
import { billingDatabase } from "./database";
import { parsePlanCreditRules } from "./plan-schedule";
import { planPrice, type PlanId, type BillingInterval } from "./plans";
import { whopGet } from "./whop";
import { providerUsdCents } from "./topup-fulfillment";

const providerPlan = z.object({ id: z.string(), company: z.object({ id: z.string() }), currency: z.literal("usd"),
  // A USD catalogue alone does not prevent automatic foreign-currency charges.
  // Missing-webhook recovery is USD-qualified; refuse BEFORE payment until
  // another currency's complete lifecycle is independently qualified.
  adaptive_pricing_enabled: z.literal(false),
  plan_type: z.literal("renewal"), billing_period: z.number(), initial_price: z.union([z.string(), z.number()]),
  renewal_price: z.union([z.string(), z.number()]), trial_period_days: z.number().nullable(),
  release_method: z.literal("buy_now"), stock: z.number().int().nonnegative().nullable(), unlimited_stock: z.boolean() });

/** Only unambiguous, allowlisted tier/cadence mappings are purchasable. */
export function configuredCreationOffers() {
  const config = billingConfig();
  if (!config.enabled || config.planConfigIssues.length) return [];
  const { rules } = parsePlanCreditRules(CREATION_CATALOG, process.env.WHOP_PLAN_CREDIT_MAP ?? "", [SUPPORT.planId]);
  let offers = [...rules.values()].filter(rule => config.accessPlanIds.includes(rule.planId));
  // Entitlement mappings also include retired plans whose subscriptions still
  // renew. An explicit checkout list must not remove those historical rules.
  const checkoutSelection = process.env.WHOP_CREATION_CHECKOUT_PLAN_IDS;
  if (checkoutSelection !== undefined) {
    const ids = checkoutSelection.split(",").map(value => value.trim());
    const allowed = new Set(ids);
    if (!ids.length || allowed.size !== ids.length || ids.some(id =>
      !/^plan_[A-Za-z0-9]+$/.test(id) || !offers.some(offer => offer.planId === id))) return [];
    offers = offers.filter(offer => allowed.has(offer.planId));
  }
  return offers.filter(rule => offers.filter(other => other.tier === rule.tier && other.interval === rule.interval).length === 1);
}

/** Recheck database gate and provider money immediately before a new checkout. */
export async function verifiedCreationOffer(selection: { tier: PlanId; interval: BillingInterval } | { planId: string }) {
  const offer = configuredCreationOffers().find(item => "planId" in selection ? item.planId === selection.planId : item.tier === selection.tier && item.interval === selection.interval);
  if (!offer) return null;
  const { data, error } = await billingDatabase().rpc("makeborne_billing_creation_enabled", { p_plan_id: offer.planId });
  if (error || data !== true) return null;
  const parsed = providerPlan.safeParse(await whopGet(`/plans/${offer.planId}`, { attempts: 1 }));
  if (!parsed.success) return null;
  const plan = parsed.data, price = planPrice(offer.tier, offer.interval, false);
  try {
    if (plan.id !== offer.planId || plan.company.id !== billingConfig().companyId
      || plan.billing_period !== (offer.interval === "yearly" ? 365 : 30)
      || (plan.trial_period_days !== null && plan.trial_period_days !== 0)
      // Whop explicitly ignores stock for unlimited plans (which commonly return zero).
      || (!plan.unlimited_stock && (plan.stock === null || plan.stock <= 0))
      || providerUsdCents(plan.initial_price) !== BigInt(0)
      || providerUsdCents(plan.renewal_price) !== BigInt(price.standardCents)) return null;
  } catch { return null; }
  return { ...offer, totalCents: price.standardCents, monthlyCredits: price.monthlyCredits };
}
