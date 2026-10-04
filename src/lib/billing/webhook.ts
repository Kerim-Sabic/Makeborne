import "server-only";
import { Webhook } from "standardwebhooks";
import { z } from "zod";
import { RequestError } from "@/lib/server/http";
import { billingConfig } from "./config";
import { billingDatabase } from "./database";
import { activeMembership, retrieveMembership, retrievePaymentMembership } from "./whop";

const eventSchema = z.object({ id: z.string().min(1).max(200), type: z.string().min(1).max(100), account_id: z.string().optional(), company_id: z.string().optional(), data: z.record(z.string(), z.unknown()) });

export async function eventMembershipId(event: z.infer<typeof eventSchema>) {
  if (event.type.startsWith("membership.")) return typeof event.data.id === "string" && /^mem_[A-Za-z0-9]+$/.test(event.data.id) ? event.data.id : null;
  if (event.type.startsWith("payment.")) {
    const membership = z.object({ id: z.string().regex(/^mem_[A-Za-z0-9]+$/) }).safeParse(event.data.membership);
    if (membership.success) return membership.data.id;
    // A payment may arrive before its membership is attached. Resolve it from
    // the provider instead of acknowledging a successful charge without a link.
    if (typeof event.data.id === "string" && /^pay_[A-Za-z0-9]+$/.test(event.data.id)) {
      const membershipId = await retrievePaymentMembership(event.data.id);
      if (!membershipId && event.type === "payment.succeeded") throw new RequestError("PAYMENT_MEMBERSHIP_PENDING", "The paid membership is not available yet. Retry this delivery.", 503);
      return membershipId;
    }
  }
  if (event.type.startsWith("refund.") || event.type.startsWith("dispute.")) {
    const payment = z.object({ id: z.string().regex(/^pay_[A-Za-z0-9]+$/) }).safeParse(event.data.payment);
    if (payment.success) return retrievePaymentMembership(payment.data.id);
  }
  return null;
}

export function verifyWhopEvent(raw: string, headers: Headers) {
  const key = process.env.WHOP_WEBHOOK_SECRET;
  if (!key) throw new RequestError("WEBHOOK_NOT_CONFIGURED", "Webhook verification is not configured.", 503);
  let body: unknown;
  try {
    // Whop signs with the literal ws_ secret bytes. This matches the current
    // official SDK helper; standardwebhooks itself expects a base64 key.
    body = new Webhook(Buffer.from(key, "utf8").toString("base64")).verify(raw, Object.fromEntries(headers));
  } catch { throw new RequestError("INVALID_WEBHOOK", "Webhook signature could not be verified.", 400); }
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success || parsed.data.id !== headers.get("webhook-id")) throw new RequestError("INVALID_WEBHOOK", "Webhook event could not be verified.", 400);
  return parsed.data;
}

export async function reconcileWhopEvent(event: z.infer<typeof eventSchema>) {
  const config = billingConfig();
  if (!config.apiKey || !config.secretKey || process.env.MAKEBORNE_BILLING_MIGRATIONS_VERIFIED !== "true") throw new RequestError("WEBHOOK_NOT_CONFIGURED", "Membership storage is not configured.", 503);
  const merchantIds = [event.account_id, event.company_id].filter(value => value !== undefined);
  if (!merchantIds.length || merchantIds.some(value => value !== config.companyId)) throw new RequestError("WRONG_MERCHANT", "This event belongs to a different merchant.", 403);
  const db = billingDatabase();
  const { data: existing, error: eventError } = await db.from("billing_webhook_events").select("id").eq("id", event.id).maybeSingle();
  if (eventError) throw new RequestError("WEBHOOK_STORAGE_UNAVAILABLE", "Membership storage is unavailable.", 503);
  if (existing) return;
  const membershipId = await eventMembershipId(event);
  if (!membershipId) return;
  // Event data may be delayed or delivered out of order. Retrieve current state
  // from Whop instead of treating the event's reported status as authority.
  const membership = await retrieveMembership(membershipId);
  if (membership.company.id !== config.companyId || !config.accessPlanIds.includes(membership.plan.id)) return;
  if (!membership.checkout_configuration_id) return;
  const { data: checkout, error: checkoutError } = await db.from("billing_checkouts").select("user_id,plan_id").eq("checkout_id", membership.checkout_configuration_id).maybeSingle();
  if (checkoutError) throw new RequestError("WEBHOOK_STORAGE_UNAVAILABLE", "Checkout binding is unavailable.", 503);
  if (!checkout || checkout.plan_id !== membership.plan.id || !membership.user) return;
  const active = activeMembership(membership);
  const verifiedUntil = active ? new Date(Math.min(Date.parse(membership.renewal_period_end!), Date.now() + 5 * 60_000)).toISOString() : new Date(0).toISOString();
  // The service-only SQL function writes the membership + event receipt in one
  // transaction, preserves the original binding, and safely ignores duplicates.
  const { error } = await db.rpc("makeborne_record_whop_membership", {
    p_event_id: event.id, p_user_id: checkout.user_id, p_membership_id: membership.id,
    p_checkout_id: membership.checkout_configuration_id, p_whop_user_id: membership.user.id,
    p_plan_id: membership.plan.id, p_status: membership.status, p_period_end: membership.renewal_period_end,
    p_verified_until: verifiedUntil,
  });
  if (error) throw new RequestError("WEBHOOK_STORAGE_UNAVAILABLE", "Membership update could not be confirmed.", 503);
}
