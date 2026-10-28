import "server-only";
import { composePurchaseConfirmation, type ConsentSnapshot } from "@/lib/legal/purchase-confirmation";
import { LEGAL_VERSION } from "@/lib/legal/versions";
import { sendTransactionalMail, transactionalMailEnabled, type SendResult, type TransactionalMail } from "@/lib/mail/transactional";
import { BILLING_TERMS_VERSION, CREATION_PLANS } from "./plans";
import { creditRuleFor } from "./plan-credits";
import { billingDatabase } from "./database";

/**
 * Purchase confirmations and the transactional outbox (migration 20261028100000).
 * - Records: one immutable confirmation per funded payment made at or after
 *   MAKEBORNE_PURCHASE_CONFIRMATIONS_SINCE (unset = off, so no earlier buyer is ever mailed).
 * - Mail: sent only while transactional mail is enabled; otherwise rows wait in the outbox.
 * Neither ever blocks or undoes fulfilment: the webhook calls confirmAfterFulfillment after
 * credits are recorded and ignores its outcome; the daily reconcile repeats both steps.
 */
type Rpc = (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
export type Candidate = {
  kind: "plan" | "pack"; payment_id: string; plan_id: string; pack_id: string | null; credits: number | null;
  amount_cents: number; currency: string; paid_at: string;
  consent_version: string | null; terms_version: string | null; consent_text: string | null; consent_accepted_at: string | null;
};
export type PlanLabel = { name: string; interval: "monthly" | "yearly"; credits: number };
export type ConfirmationDeps = {
  rpc: Rpc;
  since: string | null;
  planLabel: (planId: string) => PlanLabel | null;
  mailEnabled: boolean;
  send: (mail: TransactionalMail) => Promise<SendResult>;
  log?: (event: Record<string, unknown>) => void;
};

/** A valid ISO instant, or null (feature off). */
export function confirmationsSince(value = process.env.MAKEBORNE_PURCHASE_CONFIRMATIONS_SINCE) {
  if (!value || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function defaultPlanLabel(planId: string): PlanLabel | null {
  const rule = creditRuleFor(planId);
  const plan = rule && CREATION_PLANS.find(item => item.id === rule.tier);
  return rule && plan ? { name: plan.name, interval: rule.interval, credits: plan.monthlyCredits } : null;
}

export function defaultConfirmationDeps(): ConfirmationDeps {
  const db = billingDatabase();
  return { rpc: (name, args) => db.rpc(name, args), since: confirmationsSince(), planLabel: defaultPlanLabel,
    mailEnabled: transactionalMailEnabled(), send: mail => sendTransactionalMail(mail), log: event => console.info(JSON.stringify(event)) };
}

function consentOf(row: Candidate): ConsentSnapshot | null {
  return row.consent_text && row.consent_version && row.terms_version && row.consent_accepted_at
    ? { version: row.consent_version, termsVersion: row.terms_version, text: row.consent_text, acceptedAt: row.consent_accepted_at } : null;
}

/** Writes confirmations (and their outbox rows) for due payments; one payment when paymentId is given. */
export async function ensurePurchaseConfirmations(deps: ConfirmationDeps, options: { paymentId?: string; limit?: number } = {}) {
  const stats = { created: 0, skipped: 0, failed: 0 };
  if (!deps.since) return { ...stats, enabled: false };
  const { data, error } = await deps.rpc("makeborne_purchase_confirmation_candidates", { p_since: deps.since, p_payment: options.paymentId ?? null, p_limit: options.limit ?? 50 });
  if (error || !Array.isArray(data)) { deps.log?.({ job: "purchase_confirmations", status: "candidates_unavailable", code: error?.code ?? "invalid" }); return { ...stats, failed: 1, enabled: true }; }
  for (const row of data as Candidate[]) {
    const plan = row.kind === "plan" ? deps.planLabel(row.plan_id) : null;
    if (row.kind === "plan" && !plan) { stats.skipped++; deps.log?.({ job: "purchase_confirmations", status: "unknown_plan", payment: row.payment_id }); continue; }
    const credits = row.kind === "plan" ? plan!.credits : Number(row.credits);
    const { subject, body } = composePurchaseConfirmation({
      kind: row.kind, name: row.kind === "plan" ? plan!.name : "Credit pack", interval: row.kind === "plan" ? plan!.interval : null,
      credits, amountCents: Number(row.amount_cents), currency: row.currency, paidAt: row.paid_at, paymentId: row.payment_id,
      consent: consentOf(row), legalVersion: LEGAL_VERSION, billingTermsVersion: BILLING_TERMS_VERSION,
    });
    const product = row.kind === "plan" ? `${plan!.name} plan` : "Credit pack";
    const saved = await deps.rpc("makeborne_record_purchase_confirmation", { p_payment: row.payment_id, p_product: product,
      p_interval: row.kind === "plan" ? plan!.interval : null, p_credits: credits, p_subject: subject, p_body: body });
    if (saved.error || typeof saved.data !== "string") { stats.failed++; deps.log?.({ job: "purchase_confirmations", status: "record_failed", payment: row.payment_id, code: saved.error?.code ?? "invalid" }); }
    else stats.created++;
  }
  return { ...stats, enabled: true };
}

type Claimed = { id: string; recipient: string; subject: string; body: string; idempotency_key: string; attempts: number };

/** Sends due outbox rows. Disabled mail claims nothing, so rows stay pending for later. */
export async function drainTransactionalMail(deps: ConfirmationDeps, options: { limit?: number } = {}) {
  const stats = { claimed: 0, sent: 0, failed: 0 };
  if (!deps.mailEnabled) return { ...stats, enabled: false };
  const { data, error } = await deps.rpc("makeborne_transactional_mail_claim", { p_limit: options.limit ?? 20, p_lease_seconds: 120 });
  if (error || !Array.isArray(data)) { deps.log?.({ job: "transactional_mail", status: "claim_unavailable", code: error?.code ?? "invalid" }); return { ...stats, failed: 1, enabled: true }; }
  for (const row of data as Claimed[]) {
    stats.claimed++;
    let result: SendResult;
    try { result = await deps.send({ to: row.recipient, subject: row.subject, text: row.body, idempotencyKey: row.idempotency_key }); }
    catch { result = { ok: false, code: "MAIL_EXCEPTION", retry: true }; }
    const reported = await deps.rpc("makeborne_transactional_mail_result", result.ok
      ? { p_id: row.id, p_sent: true, p_provider_id: result.id, p_error: null, p_final: false }
      : { p_id: row.id, p_sent: false, p_provider_id: null, p_error: result.code, p_final: !result.retry });
    if (result.ok) stats.sent++; else stats.failed++;
    // An unrecorded result leaves the lease to expire; the idempotency key stops a duplicate send on the next claim.
    if (reported.error) deps.log?.({ job: "transactional_mail", status: "result_unrecorded", code: reported.error.code ?? "error" });
  }
  return { ...stats, enabled: true };
}

/** After a payment is fulfilled: confirm it and try to send. Never throws, never blocks the caller's result. */
export async function confirmAfterFulfillment(paymentId: string | null, deps?: ConfirmationDeps) {
  if (!paymentId || (!deps && !confirmationsSince())) return;
  try {
    const resolved = deps ?? defaultConfirmationDeps();
    if (!resolved.since) return;
    const made = await ensurePurchaseConfirmations(resolved, { paymentId, limit: 1 });
    if (made.created > 0) await drainTransactionalMail(resolved, { limit: 5 });
  } catch (error) {
    console.warn(JSON.stringify({ job: "purchase_confirmations", status: "after_fulfillment_failed", code: (error as { code?: string }).code ?? "error" }));
  }
}

/** Daily sweep (billing reconcile cron): confirmations first, then the whole due outbox. */
export async function runConfirmationSweep(deps?: ConfirmationDeps) {
  try {
    const resolved = deps ?? defaultConfirmationDeps();
    const confirmations = await ensurePurchaseConfirmations(resolved, { limit: 200 });
    const mail = await drainTransactionalMail(resolved, { limit: 100 });
    return { confirmations, mail };
  } catch (error) {
    return { error: (error as { code?: string }).code ?? "SWEEP_FAILED" };
  }
}
