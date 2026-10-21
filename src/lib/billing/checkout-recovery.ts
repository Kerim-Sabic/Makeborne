import "server-only";
import { z } from "zod";
import { billingConfig } from "./config";
import { billingDatabase } from "./database";
import { activeMembership, fetchMembership, whopGet } from "./whop";
import { normalizeWhopPlanPayment, reconcilePlanPayment } from "./plan-payments";
import { recordPlanObservation } from "@/lib/credits/server";
import { RequestError } from "@/lib/server/http";

const providerId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]+$`));
const claimSchema = z.object({ request_id: z.string().uuid(), user_id: z.string().uuid(), checkout_id: providerId("ch"), plan_id: providerId("plan"), lease: z.string().uuid() });
const identity = z.object({ id: providerId("pay"), company: z.object({ id: providerId("biz") }), plan: z.object({ id: providerId("plan") }),
  user: z.object({ id: providerId("user") }), membership: z.object({ id: providerId("mem") }).nullable(), checkout_configuration_id: providerId("ch"), status: z.string() });
const pageSchema = z.object({ data: z.array(identity).max(50), page_info: z.object({ has_next_page: z.boolean(), end_cursor: z.string().max(2000).nullable() }) });
const checkoutSchema = z.object({ id: providerId("ch"), company_id: providerId("biz"), plan: z.object({ id: providerId("plan") }), metadata: z.object({ makeborne_request_id: z.string().uuid() }) });
export type CheckoutRecoveryResult = "pending" | "recovered" | "review" | "skipped";
const refuse = () => new RequestError("CHECKOUT_RECOVERY_UNVERIFIED", "Payment confirmation needs another check. Your purchase has not been charged again.", 503);

/** No browser-supplied provider IDs, email matching, forged events, or provider writes.
 * A database lease bounds simultaneous return polls and cron. One exact-checkout
 * page (max50) must be complete before binding; ambiguous purchases need review. */
export async function recoverCreationCheckout(userId: string, requestId: string): Promise<CheckoutRecoveryResult> {
  if (!z.string().uuid().safeParse(userId).success || !z.string().uuid().safeParse(requestId).success) throw refuse();
  const config = billingConfig();
  // Recovery remains available when NEW sales are closed, for already-issued links.
  if (!config.configured || !config.companyId || process.env.MAKEBORNE_BILLING_MIGRATIONS_VERIFIED !== "true") return "skipped";
  const db = billingDatabase();
  const claimed = await db.rpc("makeborne_claim_checkout_recovery", { p_user: userId, p_request: requestId });
  if (claimed.error) throw refuse();
  if (claimed.data === null) return "skipped";
  const parsed = claimSchema.safeParse(claimed.data);
  if (!parsed.success || parsed.data.user_id !== userId || parsed.data.request_id !== requestId) throw refuse();
  const row = parsed.data;
  const finish = async (state: "pending" | "recovered" | "review", code: string) => {
    const r = await db.rpc("makeborne_finish_checkout_recovery", { p_request: requestId, p_lease: row.lease, p_state: state, p_code: code });
    if (r.error || r.data !== true) throw refuse();
    return state;
  };
  try {
    if (!config.accessPlanIds.includes(row.plan_id)) return await finish("review", "plan_not_allowlisted");
    const checkout = checkoutSchema.safeParse(await whopGet(`/checkout_configurations/${row.checkout_id}`, { attempts: 1 }));
    if (!checkout.success || checkout.data.id !== row.checkout_id || checkout.data.company_id !== config.companyId
      || checkout.data.plan.id !== row.plan_id || checkout.data.metadata.makeborne_request_id !== requestId) throw refuse();
    const params = new URLSearchParams({ company_id: config.companyId, first: "50", order: "created_at", direction: "asc" });
    // Same exact filter qualified by the credit-pack path; `query=ch_...` is NOT a checkout lookup.
    params.append("checkout_configuration_ids[]", row.checkout_id);
    const page = pageSchema.safeParse(await whopGet(`/payments?${params}`, { attempts: 1 }));
    if (!page.success) throw refuse();
    if (page.data.page_info.has_next_page) return await finish("review", "incomplete_payment_list");
    if (page.data.data.some(p => p.company.id !== config.companyId || p.plan.id !== row.plan_id || p.checkout_configuration_id !== row.checkout_id)
      || new Set(page.data.data.map(p => p.id)).size !== page.data.data.length) throw refuse();
    const candidates = page.data.data.filter(p => p.status === "paid");
    if (!candidates.length) return await finish("pending", "payment_pending");
    if (candidates.length !== 1 || !candidates[0].membership) return await finish("review", "ambiguous_payment");
    const listed = candidates[0];
    const raw = await whopGet(`/payments/${listed.id}`, { attempts: 1 });
    const p = identity.safeParse(raw);
    const payment = normalizeWhopPlanPayment(raw);
    if (!p.success || p.data.id !== listed.id || p.data.company.id !== config.companyId || p.data.checkout_configuration_id !== row.checkout_id
      || p.data.plan.id !== row.plan_id || p.data.user.id !== listed.user.id || p.data.membership?.id !== listed.membership!.id) throw refuse();
    if (payment.status !== "paid" || payment.dispute !== "none" || payment.refundedPrincipalCents !== "0"
      || payment.currency !== "usd" || payment.billingReason !== "subscription_create" || BigInt(payment.principalCents) <= BigInt(0))
      return await finish("review", "payment_not_funded");
    const membership = await fetchMembership(listed.membership!.id, { attempts: 1 });
    if (membership.company.id !== config.companyId || membership.checkout_configuration_id !== row.checkout_id || membership.plan.id !== row.plan_id
      || membership.user?.id !== p.data.user.id || membership.id !== payment.membershipId) throw refuse();
    if (!activeMembership(membership) || !membership.renewal_period_start || !payment.paidAt
      || Date.parse(payment.paidAt) < Date.parse(membership.renewal_period_start) - 60_000
      || Date.parse(payment.paidAt) >= Date.parse(membership.renewal_period_end!)) return await finish("review", "period_not_current");
    // Dedicated recovery receipt; never mislabel this poll as a signed webhook.
    // Inserted memberships start UNVERIFIED. Existing immutable bindings and
    // duplicate/replacement triggers still apply; no wallet is updated here.
    const bound = await db.rpc("makeborne_bind_checkout_recovery", { p_request: requestId, p_lease: row.lease, p_membership: membership.id,
      p_whop_user: membership.user.id, p_payment: payment.id, p_status: membership.status, p_period_end: membership.renewal_period_end });
    if (bound.error || bound.data !== true) throw refuse();
    const settled = await reconcilePlanPayment(userId, membership, payment);
    if (settled.state !== "funded") return await finish("review", "payment_requires_review");
    const observation = await recordPlanObservation(userId, { membershipId: membership.id, planId: row.plan_id, status: membership.status, paid: true,
      periodStart: membership.renewal_period_start, periodEnd: membership.renewal_period_end, source: "reconcile" });
    if (!["recorded", "extended", "unchanged", "evidence", "manual"].includes(observation.outcome)) return await finish("review", "entitlement_requires_review");
    return await finish("recovered", "funded");
  } catch {
    // Retry after cooldown, including a process that bound the membership but
    // died before settlement. SQL/financial calls are idempotent on replay.
    await finish("pending", "verification_retry");
    throw refuse();
  }
}

/** Cron also discovers purchases when the purchaser never returns to the app. */
export async function recoverDueCreationCheckouts() {
  const db = billingDatabase(), start = Date.now();
  const r = await db.rpc("makeborne_due_checkout_recoveries", { p_limit: 11 });
  if (r.error || !Array.isArray(r.data)) throw refuse();
  let processed = 0, recovered = 0, failed = 0;
  for (const row of r.data.slice(0, 10)) {
    if (Date.now() - start > 25_000) break; // each admitted lookup has at most four 8s GETs
    try {
      const result = await recoverCreationCheckout(row.user_id, row.request_id);
      if (result === "recovered") recovered++;
      if (result === "review") failed++;
    }
    catch { failed++; }
    processed++;
  }
  return { processed, recovered, failed, backlog: r.data.length > processed };
}
