import "server-only";
import { CREATION_CATALOG, SUPPORT } from "./config";
import { CREATION_PLANS } from "./plans";
import { parsePlanCreditRules, type PlanCreditRule } from "./plan-schedule";

/**
 * Whop plan ID -> credit rule (tier and billing interval). CREATION_CATALOG
 * plans are monthly; `WHOP_PLAN_CREDIT_MAP=plan_abc:create:yearly,plan_def:studio`
 * adds or overrides plans (interval defaults to monthly). The support plan never
 * resolves. Unknown or malformed plans resolve to nothing: no credits, no access.
 */
export function planCreditRules(raw = process.env.WHOP_PLAN_CREDIT_MAP ?? "") {
  return parsePlanCreditRules(CREATION_CATALOG, raw, [SUPPORT.planId]);
}

export type CreditRule = PlanCreditRule & { monthlyCredits: number };

/** The credit rule for a Whop plan ID, or null when the plan grants no credits. */
export function creditRuleFor(planId: string): CreditRule | null {
  const rule = planCreditRules().rules.get(planId);
  const plan = rule && CREATION_PLANS.find(item => item.id === rule.tier);
  return rule && plan ? { ...rule, monthlyCredits: plan.monthlyCredits } : null;
}

/** Resolves a creation tier ID ("create") or a Whop plan ID ("plan_...") to its plan. */
export function creditPlanFor(planId: string) {
  const tier = CREATION_PLANS.some(plan => plan.id === planId) ? planId : creditRuleFor(planId)?.tier;
  return CREATION_PLANS.find(plan => plan.id === tier) ?? null;
}
