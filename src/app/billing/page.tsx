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
import { builderEstimates } from "@/lib/builder/credit-estimate";
import { launchState } from "@/lib/launch/config";
import { salesOpenNow } from "@/lib/launch/sales-open";
import PlansOpenLine from "@/components/launch/plans-open-line";
import "./billing.css";
import "./billing-topup-return.css";

// Signed-out visitors (and crawlers) see the public plans and questions; account details need sign-in.
export const metadata: Metadata = publicPageMetadata("/billing", "Pricing: plans & credits | Makeborne", "Makeborne plans from $29 a month: monthly credits for websites, books and presentations, unlimited websites (fair use), credit packs, and a built-in client CRM.");
export const dynamic = "force-dynamic";

export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [params, accountPrivileges, freeTier, user] = await Promise.all([searchParams, getAccountPrivileges(), getFreeTierOffer(), billingUser()]);
  // Itemized usage for one UTC month (?usage=YYYY-MM), one page at a time (?usageBefore=cursor),
  // read as the signed-in user's own session. The live balance also loads client-side from /api/credits.
  const [refundedPeriod, summary, showAutotopup, subscriptions] = user
    ? await Promise.all([accountRefundedPeriod(user.id), loadUsageHistory(user, { usage: params.usage, usageBefore: params.usageBefore }), autotopupPanelVisible(user.id), subscriptionSummaries(user.id)])
    : [null, unavailableBilling, false, null] as const;
  // Informational launch line near the plans, shown only while plans are not on sale. It never changes what the plan buttons do.
  const launch = launchState();
  const launchLine = launch.enabled && launch.phase !== "after" && !(await salesOpenNow()) ? <PlansOpenLine launchAt={launch.launchAt} serverNow={launch.serverNow} dateText={launch.text} /> : null;
  return <BillingWorkspace launchLine={launchLine} subscriptions={subscriptions} topupOrderId={typeof params.topup === "string" ? params.topup : params.topup ? "" : undefined} signedIn={user !== null} accountPrivileges={accountPrivileges} trialCredits={freeTier.enabled ? freeTier.trialCredits : null} membershipRequired={params.required === "membership"} refundedPeriod={refundedPeriod} autotopupSetup={showAutotopup} costs={builderEstimates(aiCostUsdPerCredit())} summary={summary} />;
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
