import "server-only";
import { z } from "zod";
import { RequestError } from "@/lib/server/http";
import { billingConfig } from "./config";

// Pin the schema our validators implement, regardless of a newly rotated key's
// default version. Verified against a real sandbox membership on 2026-10-12.
export const WHOP_API_VERSION = "2025-01-01";

const id = z.string().regex(/^[a-z]+_[A-Za-z0-9]+$/);
/** Whop documents period fields both as date-time and as Unix timestamps.
 * Accept either; anything unparseable becomes null (no period, no grant). */
export function whopTime(value: unknown): string | null {
  const ms = typeof value === "number" ? value * 1000
    : typeof value === "string" && /^\d{9,11}$/.test(value) ? Number(value) * 1000
    : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}
const whopTimestamp = z.union([z.string(), z.number()]).nullable().optional().transform(value => value == null ? null : whopTime(value));
const paymentSchema = z.object({
  id: z.string().regex(/^pay_[A-Za-z0-9]+$/),
  company: z.object({ id }),
  membership: z.object({ id: z.string().regex(/^mem_[A-Za-z0-9]+$/) }).nullable(),
});
export const membershipSchema = z.object({
  id,
  status: z.string(),
  company: z.object({ id }),
  plan: z.object({ id }),
  user: z.object({ id }).nullable(),
  checkout_configuration_id: id.nullable(),
  renewal_period_start: whopTimestamp,
  renewal_period_end: whopTimestamp,
});
export type WhopMembership = z.infer<typeof membershipSchema>;

export async function whopRequest(path: string, body?: unknown, options: { idempotencyKey?: string } = {}): Promise<unknown> {
  if (options.idempotencyKey && (body === undefined || !/^[A-Za-z0-9_-]{1,100}$/.test(options.idempotencyKey)))
    throw new RequestError("INVALID_PROVIDER_REQUEST", "The payment request could not be prepared.", 400);
  const { apiKey } = billingConfig();
  if (!apiKey) throw new RequestError("BILLING_NOT_CONFIGURED", "Membership verification is not available yet.", 503);
  try {
    const response = await fetch(`${whopApiBase()}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Api-Version-Date": WHOP_API_VERSION,
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("Provider request failed");
    return await response.json();
  } catch {
    throw new RequestError("PAYMENT_PROVIDER_UNAVAILABLE", "We could not verify your membership with Whop. Try again shortly.", 503);
  }
}

export async function retrieveMembership(membershipId: string) {
  if (!/^mem_[A-Za-z0-9]+$/.test(membershipId)) throw new RequestError("INVALID_MEMBERSHIP", "This membership could not be verified.", 403);
  const parsed = membershipSchema.safeParse(await whopRequest(`/memberships/${membershipId}`));
  if (!parsed.success || parsed.data.id !== membershipId) throw new RequestError("MEMBERSHIP_UNVERIFIED", "This membership could not be verified.", 503);
  return parsed.data;
}

/** Refund/dispute events identify a payment; resolve its current membership. */
export async function retrievePaymentMembership(paymentId: string) {
  if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) throw new RequestError("INVALID_PAYMENT", "This payment could not be verified.", 403);
  const parsed = paymentSchema.safeParse(await whopRequest(`/payments/${paymentId}`));
  if (!parsed.success || parsed.data.id !== paymentId) throw new RequestError("PAYMENT_UNVERIFIED", "This payment could not be verified.", 503);
  if (parsed.data.company.id !== billingConfig().companyId) throw new RequestError("WRONG_MERCHANT", "This payment belongs to a different merchant.", 403);
  return parsed.data.membership?.id ?? null;
}

export function activeMembership(membership: WhopMembership) {
  const config = billingConfig();
  return membership.company.id === config.companyId && config.accessPlanIds.includes(membership.plan.id)
    && Boolean(membership.user) && ["active", "canceling"].includes(membership.status)
    && membership.renewal_period_end !== null && Date.parse(membership.renewal_period_end) > Date.now();
}

export function checkoutUrl(value: unknown) {
  if (typeof value !== "string") throw new RequestError("CHECKOUT_UNVERIFIED", "The checkout link could not be verified.", 503);
  let url: URL;
  try { url = new URL(value); }
  catch { throw new RequestError("CHECKOUT_UNVERIFIED", "The checkout link could not be verified.", 503); }
  const origin = whopApiBase() === "https://sandbox-api.whop.com/api/v1" ? "https://sandbox.whop.com" : "https://whop.com";
  if (url.origin !== origin || url.username || url.password || !/^\/checkout\/(?:plan|ch)_[A-Za-z0-9]+\/?$/.test(url.pathname))
    throw new RequestError("CHECKOUT_UNVERIFIED", "The checkout link could not be verified.", 503);
  return url.href;
}

// ---------------------------------------------------------------------------
// Reconciliation job helpers: bounded retry/backoff and paginated payments.
// ---------------------------------------------------------------------------
const WHOP_API_BASES = ["https://api.whop.com/api/v1", "https://sandbox-api.whop.com/api/v1"] as const;
/** Production by default; WHOP_API_BASE_URL may select Whop's sandbox (and nothing else). */
export function whopApiBase(raw = process.env.WHOP_API_BASE_URL) {
  if (raw === undefined || raw === "") return WHOP_API_BASES[0];
  if (!(WHOP_API_BASES as readonly string[]).includes(raw))
    throw new RequestError("BILLING_ENVIRONMENT_INVALID", "The payment environment is not configured correctly.", 503);
  return raw;
}

export type WhopRetryOptions = { attempts?: number; baseDelayMs?: number; maxDelayMs?: number; sleep?: (ms: number) => Promise<void> };
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * GET with bounded retries: 429, 5xx, timeouts and network errors back off
 * exponentially (honouring Retry-After); other 4xx responses fail at once.
 */
export async function whopGet(path: string, options: WhopRetryOptions = {}): Promise<unknown> {
  const { apiKey } = billingConfig();
  if (!apiKey) throw new RequestError("BILLING_NOT_CONFIGURED", "Membership verification is not available yet.", 503);
  const attempts = Math.min(Math.max(options.attempts ?? 4, 1), 8), base = options.baseDelayMs ?? 500, cap = options.maxDelayMs ?? 30_000, sleep = options.sleep ?? pause;
  for (let attempt = 1; ; attempt++) {
    let retryAfterMs: number | null = null;
    try {
      const response = await fetch(`${whopApiBase()}${path}`, {
        method: "GET", headers: { Authorization: `Bearer ${apiKey}`, "Api-Version-Date": WHOP_API_VERSION }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000),
      });
      if (response.ok) return await response.json();
      if (response.status !== 429 && response.status < 500)
        throw Object.assign(new RequestError("WHOP_REQUEST_REJECTED", `Whop rejected the request (${response.status}).`, 502), { retryable: false });
      const header = Number(response.headers.get("retry-after"));
      if (Number.isFinite(header) && header > 0) retryAfterMs = header * 1000;
    } catch (error) {
      if ((error as { retryable?: boolean }).retryable === false) throw error;
    }
    if (attempt >= attempts) throw new RequestError("PAYMENT_PROVIDER_UNAVAILABLE", "Whop did not respond after retries.", 503);
    await sleep(Math.min(cap, retryAfterMs ?? base * 2 ** (attempt - 1) + Math.floor(Math.random() * base)));
  }
}

export async function fetchMembership(membershipId: string, options?: WhopRetryOptions) {
  if (!/^mem_[A-Za-z0-9]+$/.test(membershipId)) throw new RequestError("INVALID_MEMBERSHIP", "This membership could not be verified.", 403);
  const parsed = membershipSchema.safeParse(await whopGet(`/memberships/${membershipId}`, options));
  if (!parsed.success || parsed.data.id !== membershipId) throw new RequestError("MEMBERSHIP_UNVERIFIED", "This membership could not be verified.", 503);
  return parsed.data;
}

const paymentItemSchema = z.object({
  id: z.string().regex(/^pay_[A-Za-z0-9]+$/),
  status: z.string().nullable().optional(),
  substatus: z.string().nullable().optional(),
  billing_reason: z.string().nullable().optional(),
  paid_at: whopTimestamp,
  refunded_at: whopTimestamp,
  refunded_amount: z.union([z.number(), z.string()]).nullable().optional(),
  plan: z.object({ id }).nullable().optional(),
  membership: z.object({ id: z.string() }).nullable().optional(),
  company: z.object({ id }).nullable().optional(),
});
export type WhopPaymentEvidence = { id: string; planId: string; billingReason: string; paidAt: string; refunded: boolean };
const pageSchema = z.object({ data: z.array(z.unknown()), page_info: z.object({ end_cursor: z.string().nullable().optional(), has_next_page: z.boolean().optional() }).optional() });

/**
 * Paid payments of one membership, oldest first. Whop's `query` filter is a
 * fuzzy search, so every item must name exactly this membership (and this
 * merchant when reported). Bounded by maxPages.
 */
export async function listMembershipPayments(membershipId: string, options: WhopRetryOptions & { maxPages?: number } = {}) {
  if (!/^mem_[A-Za-z0-9]+$/.test(membershipId)) throw new RequestError("INVALID_MEMBERSHIP", "This membership could not be verified.", 403);
  const { companyId } = billingConfig();
  if (!companyId || !/^biz_[A-Za-z0-9]+$/.test(companyId)) throw new RequestError("WRONG_MERCHANT", "Payment merchant could not be verified.", 503);
  const payments: WhopPaymentEvidence[] = [];
  let after: string | null = null, skipped = 0;
  for (let page = 0; page < Math.min(options.maxPages ?? 5, 20); page++) {
    const params = new URLSearchParams({ company_id: companyId, query: membershipId, first: "50", order: "created_at", direction: "asc" });
    if (after) params.set("after", after);
    const parsed = pageSchema.safeParse(await whopGet(`/payments?${params}`, options));
    if (!parsed.success) throw new RequestError("PAYMENT_UNVERIFIED", "Whop payment list could not be read.", 503);
    for (const raw of parsed.data.data) {
      const item = paymentItemSchema.safeParse(raw);
      if (!item.success || item.data.membership?.id !== membershipId || !item.data.plan || (item.data.company && item.data.company.id !== companyId)) { skipped++; continue; }
      if (item.data.status !== "paid" || !item.data.paid_at) continue;
      const refunded = Boolean(item.data.refunded_at) || Number(item.data.refunded_amount ?? 0) > 0 || /refund/.test(item.data.substatus ?? "");
      payments.push({ id: item.data.id, planId: item.data.plan.id, billingReason: item.data.billing_reason ?? "unknown", paidAt: item.data.paid_at, refunded });
    }
    const info = parsed.data.page_info;
    if (!info?.has_next_page || !info.end_cursor) return { payments, skipped, complete: true };
    after = info.end_cursor;
  }
  return { payments, skipped, complete: false };
}
