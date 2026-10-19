import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/site-metadata";
import BillingWorkspace from "@/components/billing-workspace";
import { getAccountPrivileges } from "@/lib/account/privileges";
import { billingUser } from "@/lib/billing/access";
import { autotopupSetupEnabled } from "@/lib/billing/autotopup";
import { billingDatabase } from "@/lib/billing/database";
import { getFreeTierOffer } from "@/lib/credits/server";
import { aiCostUsdPerCredit } from "@/lib/builder/pricing";
import { builderEstimates } from "@/lib/builder/credit-estimate";
import "./billing.css";
import "./billing-topup-return.css";

// Signed-out visitors (and crawlers) see the public plans and questions; account details need sign-in.
export const metadata: Metadata = publicPageMetadata("/billing", "Pricing: plans & credits | Makeborne", "Makeborne plans from $29 a month: monthly credits for websites, books and presentations, unlimited websites (fair use), credit packs, and a built-in client CRM.");
export const dynamic = "force-dynamic";

export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [params, accountPrivileges, freeTier, user] = await Promise.all([searchParams, getAccountPrivileges(), getFreeTierOffer(), billingUser()]);
  const refundedPeriod = user ? await accountRefundedPeriod(user.id) : null;
  // The live balance loads client-side from /api/credits (CreditBalance). Itemized
  // usage rows stay unavailable here until they are mapped to project activity.
  return <BillingWorkspace topupOrderId={typeof params.topup === "string" ? params.topup : params.topup ? "" : undefined} signedIn={user !== null} accountPrivileges={accountPrivileges} trialCredits={freeTier.enabled ? freeTier.trialCredits : null} membershipRequired={params.required === "membership"} refundedPeriod={refundedPeriod} autotopupSetup={user !== null && autotopupSetupEnabled()} costs={builderEstimates(aiCostUsdPerCredit())} summary={{ status: "unavailable", unit: "whole_customer_credits", available: null, reserved: null, used: null, period: null, entries: [] }} />;
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
