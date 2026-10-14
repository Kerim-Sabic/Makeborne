import { CREATION_PLANS, type BillingInterval, type PlanId } from "./plans";

/** How one Whop plan ID earns credits: which tier, billed how often. */
export type PlanCreditRule = { planId: string; tier: PlanId; interval: BillingInterval };
export type PlanConfigIssue = { value: string; problem: string };

const PLAN_ID = /^plan_[A-Za-z0-9]+$/;
const TIERS = new Set<string>(CREATION_PLANS.map(plan => plan.id));

/**
 * Whop plan ID -> credit rule. The fixed catalogue plans are monthly. Overrides
 * come from WHOP_PLAN_CREDIT_MAP as comma-separated `plan_id:tier[:interval]`
 * (interval `monthly` or `yearly`, default `monthly`) and may add plans or
 * change a catalogue plan's tier/interval. Malformed entries never resolve and
 * are reported, so an unknown plan grants no credits and no access.
 */
export function parsePlanCreditRules(catalog: Readonly<Record<string, string>>, overrides: string, excluded: readonly string[] = []) {
  const rules = new Map<string, PlanCreditRule>();
  const issues: PlanConfigIssue[] = [];
  for (const [tier, planId] of Object.entries(catalog)) {
    if (TIERS.has(tier) && PLAN_ID.test(planId) && !excluded.includes(planId)) rules.set(planId, { planId, tier: tier as PlanId, interval: "monthly" });
  }
  for (const raw of overrides.split(",").map(value => value.trim()).filter(Boolean)) {
    const [planId, tier, interval = "monthly", extra] = raw.split(":").map(value => value.trim());
    if (extra !== undefined || !planId || !PLAN_ID.test(planId)) { issues.push({ value: raw, problem: "expected plan_id:tier[:monthly|yearly]" }); continue; }
    if (excluded.includes(planId)) { issues.push({ value: raw, problem: "this plan can never grant credits" }); continue; }
    if (!tier || !TIERS.has(tier)) { issues.push({ value: raw, problem: `unknown tier "${tier ?? ""}"` }); continue; }
    if (interval !== "monthly" && interval !== "yearly") { issues.push({ value: raw, problem: `unknown interval "${interval}"` }); continue; }
    rules.set(planId, { planId, tier: tier as PlanId, interval });
  }
  return { rules, issues };
}

/**
 * Plan IDs that grant creation access: those listed in WHOP_ACCESS_PLAN_IDS
 * that also resolve to a credit rule. Anything else (unknown, malformed, the
 * support plan) is dropped and reported, so it fails closed.
 */
export function parseAccessPlanIds(raw: string, rules: ReadonlyMap<string, PlanCreditRule>, excluded: readonly string[] = []) {
  const ids: string[] = [];
  const issues: PlanConfigIssue[] = [];
  for (const value of raw.split(",").map(item => item.trim()).filter(Boolean)) {
    if (excluded.includes(value)) issues.push({ value, problem: "this plan can never grant access" });
    else if (!rules.has(value)) issues.push({ value, problem: "no credit rule for this plan (add it to the catalogue or WHOP_PLAN_CREDIT_MAP)" });
    else if (!ids.includes(value)) ids.push(value);
  }
  return { ids, issues };
}

// Allocation months, the tier owed for each and the billing anchor are computed
// in the database from recorded billing history (migration
// 20261012100000_plan_entitlement_history.sql), never from today's plan.
