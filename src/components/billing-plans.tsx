"use client";

import { ShieldCheck } from "lucide-react";
import BillingTopups from "./billing-topups";
import CreationPlans from "./creation-plans";
import PlanAssurances from "./plan-assurances";
import type { PlanId } from "@/lib/billing/plans";
import type { BuilderEstimates, MeasuredRun } from "@/lib/builder/credit-estimate";

/** Plans for everyone; buying reassurance only without a plan; credit packs only for members on a limited allowance.
 * Coffee support and the effort preview are no longer on /billing (the support route and terms stay). */
export default function BillingPlans({ unlimitedCredits = false, isMember = false, topupsOpen = false, hasYearly = false, estimates = null, mediumCeilingCredits = null, currentTier = null, measuredRun = null, accountId = null }: { unlimitedCredits?: boolean; /** Active, canceling or past-due creation subscription (or unknown because subscriptions failed to load). */ isMember?: boolean; topupsOpen?: boolean; /** A yearly offer is configured (drops "Yearly billing." from what isn't ready). */ hasYearly?: boolean; estimates?: BuilderEstimates | null; mediumCeilingCredits?: number | null; currentTier?: PlanId | null; measuredRun?: MeasuredRun | null; accountId?: string | null }) {
  const buying = !isMember && !unlimitedCredits;
  return <>
    <CreationPlans estimates={estimates} mediumCeilingCredits={mediumCeilingCredits} currentTier={currentTier} measuredRun={measuredRun} accountId={accountId} />
    {buying && <PlanAssurances topupsOpen={topupsOpen} hasYearly={hasYearly} />}
    {unlimitedCredits ? <section className="billing-unlimited-topups" aria-label="Credit top-ups"><ShieldCheck size={19} aria-hidden="true" /><div><h2>You’re covered.</h2><p>Your unlimited administrator allowance means you do not need credit top-ups.</p></div></section> : isMember && <BillingTopups currentTier={currentTier} />}
  </>;
}
