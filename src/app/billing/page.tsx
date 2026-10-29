import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/site-metadata";
import { subscriptionSummaries } from "@/lib/billing/subscription-summary";
import BillingWorkspace from "@/components/billing-workspace";
import { getAccountPrivileges } from "@/lib/account/privileges";
import { billingUser } from "@/lib/billing/access";
import { autotopupPanelVisible } from "@/lib/billing/autotopup";
import { billingDatabase } from "@/lib/billing/database";
import { loadUsageHistory } from "@/lib/billing/usage-history-server";
import { unavailableBilling } from "@/lib/billing/view";
import { getFreeTierOffer } from "@/lib/credits/server";
import { aiCostUsdPerCredit } from "@/lib/builder/pricing";
import { builderEstimates, MEASURED_RUN } from "@/lib/builder/credit-estimate";
import { BUILDER_EFFORT } from "@/lib/builder/pricing";
import { DEFAULT_EFFORT } from "@/lib/routing/effort";
import { CREATION_PLANS, TAX_NOTE, matchPlanTier, pricePerCreditCents, usd } from "@/lib/billing/plans";
import { configuredCreationOffers } from "@/lib/billing/creation-offers";
import { topupCheckoutOpen } from "@/lib/billing/topups";
import { authDestination } from "@/lib/supabase/auth-flow";
import { plansOnSale } from "@/lib/billing/plans-on-sale";
import { launchState } from "@/lib/launch/config";
import PlansOpenLine from "@/components/launch/plans-open-line";
import { accountPurchaseRecords } from "@/lib/legal/withdrawal";
import "./billing.css";
import "./billing-topup-return.css";

const credits = (value: number) => value.toLocaleString("en-US");
// Signed-out visitors (and crawlers) see the public plans and questions; account details need sign-in.
export const metadata: Metadata = publicPageMetadata("/billing", "Pricing: plans & credits", `Makeborne plans from ${usd(CREATION_PLANS[0].monthlyCents)} a month: ${credits(CREATION_PLANS[0].monthlyCredits)} to ${credits(CREATION_PLANS[CREATION_PLANS.length - 1].monthlyCredits)} monthly credits for websites, books and presentations, a built-in client CRM, and a credit limit shown before every request.`);
const LIVE = ["active", "canceling", "past_due"];
const PLAN_CHIPS = CREATION_PLANS.map(plan => ({ id: plan.id, name: plan.name, price: usd(plan.monthlyCents) }));
const PER_CREDIT = CREATION_PLANS.map(plan => pricePerCreditCents(plan.id));
export const dynamic = "force-dynamic";

export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [params, accountPrivileges, freeTier, user] = await Promise.all([searchParams, getAccountPrivileges(), getFreeTierOffer(), billingUser()]);
  // Itemized usage for one UTC month (?usage=YYYY-MM), one page at a time (?usageBefore=cursor),
  // read as the signed-in user's own session. The live balance also loads client-side from /api/credits.
  const [refundedPeriod, summary, showAutotopup, subscriptions, purchaseRecords] = user
    ? await Promise.all([accountRefundedPeriod(user.id), loadUsageHistory(user, { usage: params.usage, usageBefore: params.usageBefore }), autotopupPanelVisible(user.id), subscriptionSummaries(user.id), loadPurchaseRecords(user.id)])
    : [null, unavailableBilling, false, null, null] as const;
  const unlimited = accountPrivileges.unlimitedCredits === true;
  const live = Array.isArray(subscriptions) ? subscriptions.find(item => LIVE.includes(item.status)) ?? null : null;
  // Plans before the account for anyone without a plan; members keep the dashboard first.
  const plansFirst = !user || params.required === "membership" || refundedPeriod !== null || (Array.isArray(subscriptions) && !live && !unlimited);
  const currentTier = live ? live.tier ?? matchPlanTier(live.name) : null;
  const savedBrief = typeof params.next === "string" && /[?&](draft|claim)=/.test(authDestination(params.next));
  const offers = (() => { try { return configuredCreationOffers(); } catch { return []; } })();
  const topupsOpen = (() => { try { return topupCheckoutOpen(); } catch { return false; } })();
  const plansOpen = await plansOnSale(offers);
  // Informational launch line near the plans. It never changes what the plan buttons do.
  const launch = launchState();
  const launchLine = launch.enabled && launch.phase !== "after" && !plansOpen ? <PlansOpenLine launchAt={launch.launchAt} serverNow={launch.serverNow} dateText={launch.text} /> : null;
  return <BillingWorkspace launchLine={launchLine} purchaseRecords={purchaseRecords} plansFirst={plansFirst} savedBrief={savedBrief} planChips={PLAN_CHIPS} pricePerCredit={{ min: Math.min(...PER_CREDIT), max: Math.max(...PER_CREDIT) }} plansOpen={plansOpen} mediumCeilingCredits={BUILDER_EFFORT[DEFAULT_EFFORT].ceilingCredits} measuredRun={MEASURED_RUN} currentTier={currentTier} topupsOpen={topupsOpen} hasYearly={offers.some(offer => offer.interval === "yearly")} accountId={user?.id ?? null} taxNote={TAX_NOTE.long} subscriptions={subscriptions} topupOrderId={typeof params.topup === "string" ? params.topup : params.topup ? "" : undefined} signedIn={user !== null} accountPrivileges={accountPrivileges} trialCredits={freeTier.enabled ? freeTier.trialCredits : null} membershipRequired={params.required === "membership"} refundedPeriod={refundedPeriod} autotopupSetup={showAutotopup} costs={builderEstimates(aiCostUsdPerCredit())} summary={summary} />;
}

/** The current billing period when its payment was refunded or charged back (creation paused). Unknown shows nothing. */
async function accountRefundedPeriod(userId: string): Promise<{ periodEnd: string; reason: string } | null> {
  try {
    const { data, error } = await billingDatabase().rpc("makeborne_account_revoked_period", { p_user: userId });
    if (error || !data || typeof data !== "object") return null;
    const value = data as { periodEnd?: unknown; reason?: unknown };
    return typeof value.periodEnd === "string" && typeof value.reason === "string" ? { periodEnd: value.periodEnd, reason: value.reason } : null;
  } catch { return null; }
}

/** Purchase confirmations and withdrawal notices; unavailable storage shows nothing (never an error page). */
async function loadPurchaseRecords(userId: string) {
  try { const db = billingDatabase(); return await accountPurchaseRecords((name, args) => db.rpc(name, args), userId); } catch { return null; }
}
