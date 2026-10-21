import { billingConfig } from "@/lib/billing/config";
import { billingDatabase } from "@/lib/billing/database";
import { creditRuleFor } from "@/lib/billing/plan-credits";
import { reconcilePlanPayment, retrieveVerifiedPlanPayment } from "@/lib/billing/plan-payments";
import { runPlanCreditReconcileJob } from "@/lib/billing/reconcile-job";
import { activeMembership, fetchMembership, listMembershipPayments } from "@/lib/billing/whop";
import { recordPlanObservation, recordPlanPayment } from "@/lib/credits/server";
import { authorizedCron } from "@/lib/server/cron-auth";
import { recoverDueCreationCheckouts } from "@/lib/billing/checkout-recovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const headers = { "Cache-Control": "no-store" };

/**
 * Plan credit reconciliation (Vercel Cron sends GET with the bearer secret).
 * Disabled unless MAKEBORNE_BILLING_RECONCILE_ENABLED=true; production
 * scheduling stays off until reviewed (docs/BILLING_PLAN_CREDITS.md).
 * `?health=1` returns the monitoring view without running the job.
 */
async function handle(request: Request) {
  if (process.env.MAKEBORNE_BILLING_RECONCILE_ENABLED !== "true")
    return Response.json({ error: { code: "JOB_DISABLED", message: "Plan credit reconciliation is disabled." } }, { status: 503, headers });
  if (!authorizedCron(request)) return Response.json({ error: { code: "UNAUTHORIZED", message: "Not authorized." } }, { status: 401, headers });
  const config = billingConfig();
  if (!config.configured || !config.companyId)
    return Response.json({ error: { code: "BILLING_NOT_CONFIGURED", message: "Billing is not configured." } }, { status: 503, headers });
  const db = billingDatabase();
  if (new URL(request.url).searchParams.get("health") === "1") {
    const [{ data, error }, recovery] = await Promise.all([db.rpc("makeborne_billing_job_health"), db.rpc("makeborne_checkout_recovery_health")]);
    if (error || recovery.error) return Response.json({ error: { code: "HEALTH_UNAVAILABLE", message: "Job health is unavailable." } }, { status: 503, headers });
    return Response.json({ health: { ...data, openIssues: Number(data?.openIssues ?? 0) + Number(recovery.data?.needsReview ?? 0), checkoutRecovery: recovery.data } }, { headers });
  }
  const result = await runPlanCreditReconcileJob({
    rpc: (name, args) => db.rpc(name, args),
    updateMembership: (membershipId, userId, fields) => db.from("billing_memberships").update(fields).eq("membership_id", membershipId).eq("user_id", userId),
    fetchMembership: membershipId => fetchMembership(membershipId),
    listPayments: membershipId => listMembershipPayments(membershipId),
    recordObservation: (userId, observation) => recordPlanObservation(userId, observation),
    recordPayment: (userId, membershipId, payment) => recordPlanPayment(userId, membershipId, payment),
    reconcilePayment: async (userId, membership, paymentId) => reconcilePlanPayment(userId, membership, await retrieveVerifiedPlanPayment(paymentId)),
    isActive: activeMembership,
    hasCreditRule: planId => creditRuleFor(planId) !== null,
    companyId: config.companyId,
    recoverCheckouts: recoverDueCreationCheckouts,
    log: event => console.info(JSON.stringify(event)),
  });
  return Response.json(result, { status: result.status === "failed" ? 500 : 200, headers });
}

export const GET = handle;
export const POST = handle;
