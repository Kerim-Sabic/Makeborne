import "server-only";
import { CREATION_CATALOG } from "./config";
import { CREATION_PLANS, type PlanId } from "./plans";

/**
 * Whop plan ID -> creation tier for monthly credit grants. CREATION_CATALOG is
 * the default; `WHOP_PLAN_CREDIT_MAP=plan_abc:create,plan_def:studio` adds or
 * overrides entries (e.g. yearly or test plans). Malformed pairs are ignored.
 */
export function whopPlanCreditMap(raw = process.env.WHOP_PLAN_CREDIT_MAP ?? ""): Map<string, PlanId> {
  const tiers = new Set<string>(CREATION_PLANS.map(plan => plan.id));
  const map = new Map<string, PlanId>(Object.entries(CREATION_CATALOG).map(([tier, planId]) => [planId, tier as PlanId]));
  for (const pair of raw.split(",")) {
    const [planId, tier, extra] = pair.split(":").map(value => value.trim());
    if (extra === undefined && planId && tier && /^plan_[A-Za-z0-9]+$/.test(planId) && tiers.has(tier)) map.set(planId, tier as PlanId);
  }
  return map;
}

/** Resolves a creation tier ID ("create") or a Whop plan ID ("plan_...") to its plan. */
export function creditPlanFor(planId: string) {
  const tier = CREATION_PLANS.some(plan => plan.id === planId) ? planId : whopPlanCreditMap().get(planId);
  return CREATION_PLANS.find(plan => plan.id === tier) ?? null;
}
