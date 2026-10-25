import "server-only";
import type { WhopMembership, WhopPaymentEvidence } from "./whop";

/**
 * Plan credit reconciliation job (cron). One run:
 *  1. takes the job lease (no overlapping runs; a crashed run's lease expires
 *     and the next run marks it abandoned);
 *  2. refreshes the stalest bound memberships from Whop, oldest observation
 *     first, in pages, within a time budget (missed runs only mean more rows
 *     are due; nothing is skipped by date);
 *  3. reads each refreshed membership's recent payments from Whop: retrieves
 *     and reconciles each one's current state (refunds and disputes revoke the
 *     refunded period's access and withhold its credits; Whop keeps a refunded
 *     membership active), and records paid ones as allocation evidence for
 *     memberships with open no-evidence issues;
 *  4. runs the database reconcile for every recorded entitlement;
 *  5. records the outcome (succeeded / partial / failed) with stats.
 * Every write is idempotent, so a retried or repeated run is safe.
 */

export type DueMembership = { membership_id: string; user_id: string; plan_id: string; checkout_id: string; whop_user_id: string; needs_payments: boolean };
type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };

export type ReconcileJobDeps = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
  updateMembership: (membershipId: string, userId: string, fields: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
  fetchMembership: (membershipId: string) => Promise<WhopMembership>;
  listPayments: (membershipId: string) => Promise<{ payments: WhopPaymentEvidence[]; skipped: number; complete: boolean }>;
  recordObservation: (userId: string, observation: { membershipId: string; planId: string; status: string; paid: boolean;
    periodStart: string | null; periodEnd: string | null; source: "reconcile" }) => Promise<{ outcome: string; granted: number }>;
  recordPayment: (userId: string, membershipId: string, payment: WhopPaymentEvidence) => Promise<{ outcome: string; granted: number }>;
  /** Retrieves one payment and records its verified state (makeborne_reconcile_plan_payment). */
  reconcilePayment?: (userId: string, membership: WhopMembership, paymentId: string) => Promise<{ outcome: string; state?: string }>;
  isActive: (membership: WhopMembership) => boolean;
  hasCreditRule: (planId: string) => boolean;
  companyId: string;
  recoverCheckouts?: () => Promise<{ processed: number; recovered: number; failed: number; backlog: boolean }>;
  now?: () => number;
  log?: (event: Record<string, unknown>) => void;
};

export type ReconcileJobOptions = { pageSize?: number; maxMemberships?: number; staleSeconds?: number; leaseSeconds?: number; budgetMs?: number; paymentLookbackDays?: number };

export type ReconcileJobResult = {
  status: "skipped" | "succeeded" | "partial" | "failed"; runId: number | null;
  stats: { processed: number; failed: number; bindingMismatch: number; unknownPlan: number; observationsGranted: number;
    paymentsRecorded: number; paymentsGranted: number; paymentsReconciled: number; paymentsNotFunded: number; paymentPagesIncomplete: number; paymentEvidenceSkipped: number; reconciledMemberships: number; reconcileGranted: number; expiryWallets: number; expiredProviderCalls: number; budgetExhausted: boolean; backlog: boolean; checkoutRecoveryBacklog: boolean; checkoutRecoveries: number; checkoutRecoveryFailures: number };
  errors: string[];
};

export async function runPlanCreditReconcileJob(deps: ReconcileJobDeps, options: ReconcileJobOptions = {}): Promise<ReconcileJobResult> {
  const now = deps.now ?? Date.now, started = now();
  const pageSize = options.pageSize ?? 50, maxMemberships = options.maxMemberships ?? 200, staleSeconds = options.staleSeconds ?? 20 * 3600;
  const leaseSeconds = options.leaseSeconds ?? 300, budgetMs = options.budgetMs ?? 240_000, lookbackMs = (options.paymentLookbackDays ?? 120) * 86_400_000;
  const stats: ReconcileJobResult["stats"] = { processed: 0, failed: 0, bindingMismatch: 0, unknownPlan: 0, observationsGranted: 0,
    paymentsRecorded: 0, paymentsGranted: 0, paymentsReconciled: 0, paymentsNotFunded: 0, paymentPagesIncomplete: 0, paymentEvidenceSkipped: 0, reconciledMemberships: 0, reconcileGranted: 0, expiryWallets: 0, expiredProviderCalls: 0, budgetExhausted: false, backlog: false, checkoutRecoveryBacklog: false, checkoutRecoveries: 0, checkoutRecoveryFailures: 0 };
  const errors: string[] = [];
  const begin = await deps.rpc("makeborne_billing_job_begin", { p_job: "plan_credits", p_lease_seconds: leaseSeconds });
  if (begin.error) throw new Error(`Job lease unavailable: ${begin.error.code ?? begin.error.message ?? "error"}`);
  const runId = typeof begin.data === "number" ? begin.data : begin.data == null ? null : Number(begin.data);
  if (runId == null || !Number.isFinite(runId)) {
    deps.log?.({ job: "plan_credits", status: "skipped", reason: "another run holds the lease" });
    return { status: "skipped", runId: null, stats, errors };
  }
  const attempted = new Set<string>();
  const note = (membershipId: string, error: unknown) => {
    stats.failed++;
    if (errors.length < 20) errors.push(`${membershipId}: ${(error as { code?: string }).code ?? (error as Error).message ?? "error"}`);
  };
  try {
    if (deps.recoverCheckouts) {
      const discovery = await deps.recoverCheckouts();
      stats.checkoutRecoveries = discovery.recovered;
      stats.checkoutRecoveryFailures = discovery.failed;
      // Unchecked checkout lookahead includes ordinary abandoned/unpaid links.
      // It is not a failed financial pass; keep it visible independently while
      // actual discovery failures/review outcomes still make the run partial.
      stats.checkoutRecoveryBacklog = discovery.backlog;
    }
    pages: while (attempted.size < maxMemberships) {
      if (now() - started > budgetMs) { stats.budgetExhausted = true; break; }
      const due = await deps.rpc("makeborne_billing_job_due_memberships", { p_limit: pageSize + attempted.size + 1, p_stale_seconds: staleSeconds });
      if (due.error) throw new Error(`Due memberships unavailable: ${due.error.code ?? "error"}`);
      const candidates = ((due.data as DueMembership[] | null) ?? []).filter(row => !attempted.has(row.membership_id));
      if (candidates.length > maxMemberships - attempted.size) stats.backlog = true;
      const fresh = candidates.slice(0, pageSize);
      if (!fresh.length) break;
      for (const row of fresh) {
        if (attempted.size >= maxMemberships) break pages;
        if (now() - started > budgetMs) { stats.budgetExhausted = true; break pages; }
        attempted.add(row.membership_id);
        try {
          const membership = await deps.fetchMembership(row.membership_id);
          // Same binding rules as webhooks: merchant, checkout, Whop user and plan must match what was bought.
          if (membership.company.id !== deps.companyId || membership.checkout_configuration_id !== row.checkout_id
            || membership.user?.id !== row.whop_user_id || membership.plan.id !== row.plan_id) { stats.bindingMismatch++; continue; }
          if (!deps.hasCreditRule(membership.plan.id)) { stats.unknownPlan++; continue; }
          const active = deps.isActive(membership);
          const verifiedUntil = active ? new Date(Math.min(Date.parse(membership.renewal_period_end!), now() + 5 * 60_000)).toISOString() : new Date(0).toISOString();
          const updated = await deps.updateMembership(row.membership_id, row.user_id, { status: membership.status, verified_until: verifiedUntil,
            period_end: membership.renewal_period_end, checked_at: new Date(now()).toISOString() });
          if (updated.error) throw Object.assign(new Error("Membership row update failed"), { code: "MEMBERSHIP_STORAGE" });
          let financialEvidenceComplete = true;
          if (row.needs_payments || deps.reconcilePayment) {
            const list = await deps.listPayments(row.membership_id);
            if (!list.complete) stats.paymentPagesIncomplete++;
            stats.paymentEvidenceSkipped += list.skipped;
            financialEvidenceComplete = list.complete && list.skipped === 0;
            for (const payment of list.payments) {
              // Current state first: a refund recorded here blocks this period's allocation below.
              if (deps.reconcilePayment && Date.parse(payment.paidAt) > now() - lookbackMs) {
                const reconciled = await deps.reconcilePayment(row.user_id, membership, payment.id);
                stats.paymentsReconciled++;
                if (reconciled.state && reconciled.state !== "funded") stats.paymentsNotFunded++;
              }
              if (!row.needs_payments) continue;
              const recorded = await deps.recordPayment(row.user_id, row.membership_id, payment);
              if (recorded.outcome !== "duplicate") stats.paymentsRecorded++;
              stats.paymentsGranted += recorded.granted;
            }
          }
          // Only a complete financial pass advances the daily-job checkpoint.
          // A login checks membership status, not refunds; failed or partial
          // payment reads must remain due on the next run.
          if (financialEvidenceComplete) {
            const observed = await deps.recordObservation(row.user_id, { membershipId: row.membership_id, planId: membership.plan.id, status: membership.status,
              paid: active, periodStart: membership.renewal_period_start ?? null, periodEnd: membership.renewal_period_end, source: "reconcile" });
            stats.observationsGranted += observed.granted;
          }
          stats.processed++;
          if (stats.processed % 10 === 0) await deps.rpc("makeborne_billing_job_heartbeat", { p_run: runId, p_lease_seconds: leaseSeconds });
        } catch (error) { note(row.membership_id, error); }
      }
    }
    // Database catch-up for every recorded entitlement (no provider calls).
    const reconciled = await deps.rpc("makeborne_reconcile_plan_credits", { p_limit: 500 });
    if (reconciled.error) throw new Error(`Database reconcile failed: ${reconciled.error.code ?? "error"}`);
    const summary = (reconciled.data ?? {}) as Record<string, unknown>;
    stats.reconciledMemberships = Number(summary.memberships ?? 0); stats.reconcileGranted = Number(summary.granted ?? 0);
    // Records ended allocations and timed-out holds in the ledger. Balances are
    // already exact without it (reads exclude expired credits); this keeps the
    // ledger and wallet cache current for accounts that are not active.
    const expired = await deps.rpc("makeborne_credit_expire_due", { p_limit: 500 });
    if (expired.error) throw new Error(`Credit expiry failed: ${expired.error.code ?? "error"}`);
    stats.expiryWallets = Number(((expired.data ?? {}) as Record<string, unknown>).wallets ?? 0);
    // Live AI calls left open by killed processes are recorded as spent at their bound.
    const calls = await deps.rpc("makeborne_provider_calls_expire", { p_limit: 500 });
    if (calls.error) throw new Error(`Provider call expiry failed: ${calls.error.code ?? "error"}`);
    stats.expiredProviderCalls = Number(((calls.data ?? {}) as Record<string, unknown>).expired ?? 0);
    const status = stats.failed > 0 || stats.checkoutRecoveryFailures > 0 || stats.bindingMismatch > 0 || stats.unknownPlan > 0
      || stats.paymentPagesIncomplete > 0 || stats.paymentEvidenceSkipped > 0 || stats.budgetExhausted || stats.backlog ? "partial" : "succeeded";
    await deps.rpc("makeborne_billing_job_finish", { p_run: runId, p_status: status, p_stats: stats, p_error: errors.length ? errors.join("; ") : null });
    deps.log?.({ job: "plan_credits", status, runId, ...stats, ms: now() - started });
    return { status, runId, stats, errors };
  } catch (error) {
    const message = (error as Error).message ?? "error";
    await deps.rpc("makeborne_billing_job_finish", { p_run: runId, p_status: "failed", p_stats: stats, p_error: message });
    deps.log?.({ job: "plan_credits", status: "failed", runId, error: message });
    return { status: "failed", runId, stats, errors: [...errors, message] };
  }
}
