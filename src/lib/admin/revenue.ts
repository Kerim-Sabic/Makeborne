import { CREATION_PLANS, planPrice, type BillingInterval, type PlanId } from "@/lib/billing/plans";

export type SubscriptionGroup = { status: string; tier: string; interval: string; current: boolean; count: number };

/**
 * Recurring revenue implied by current subscriptions, at standard list prices
 * from the plan catalog. Founding first-term discounts, taxes, fees and refunds
 * are not reflected, so this is an estimate. Yearly plans count one twelfth per
 * month. Subscriptions whose plan has not been observed yet are reported as
 * unpriced instead of guessed.
 */
export function subscriptionRevenue(groups: readonly SubscriptionGroup[]) {
  const byPlan = new Map<string, { tier: PlanId; interval: BillingInterval; subscribers: number; monthlyCents: number }>();
  let monthlyCents = 0, current = 0, unpriced = 0;
  for (const group of groups) {
    if (!group.current) continue;
    current += group.count;
    const plan = CREATION_PLANS.find(item => item.id === group.tier);
    if (!plan || (group.interval !== "monthly" && group.interval !== "yearly")) { unpriced += group.count; continue; }
    const price = planPrice(plan.id, group.interval, false);
    const perMonth = price.standardCents / price.months;
    const key = `${plan.id}:${group.interval}`;
    const entry = byPlan.get(key) ?? { tier: plan.id, interval: group.interval, subscribers: 0, monthlyCents: 0 };
    entry.subscribers += group.count;
    entry.monthlyCents += perMonth * group.count;
    byPlan.set(key, entry);
    monthlyCents += perMonth * group.count;
  }
  const plans = [...byPlan.values()].map(entry => ({ ...entry, monthlyCents: Math.round(entry.monthlyCents) }))
    .sort((a, b) => b.monthlyCents - a.monthlyCents);
  return { monthlyCents: Math.round(monthlyCents), annualCents: Math.round(monthlyCents * 12), currentSubscribers: current, unpricedSubscribers: unpriced, plans };
}
