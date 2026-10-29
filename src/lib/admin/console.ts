import "server-only";
import { billingDatabase } from "@/lib/billing/database";
import { RequestError } from "@/lib/server/http";
import { subscriptionRevenue, type SubscriptionGroup } from "./revenue";

/**
 * Administrator data for /admin. Every call passes the verified session's user
 * id as the actor; the database functions refuse anyone who is not an
 * administrator (20261013100000_admin_console.sql), so this module adds no
 * authority of its own. The only writes are the support refund begin/cancel
 * steps at the end of this file.
 */

export type AdminOverview = {
  generatedAt: string;
  users: { total: number; confirmed: number; new7d: number; new30d: number; active7d: number; admins: number };
  subscriptions: SubscriptionGroup[];
  checkouts: { open24h: number; total: number };
  credits: { balance: number; reserved: number; wallets: number; ledger30d: Record<string, { credits: number; entries: number }> };
  ai: {
    today: { scope: string; spentMicrousd: number; reservedMicrousd: number }[];
    runs7d: Record<string, { runs: number; chargedCredits: number; absorbedCredits: number; providerMicrousd: number }>;
    limits: { day: string; scopes: { scope: string; enabled: boolean; stopped: boolean; dailyLimitMicrousd: number; spentMicrousd: number; reservedMicrousd: number }[] | null } & Record<string, unknown>;
  };
  billingJobs: { lastSuccessAt: string | null; failuresLast24h: number; openIssues: number; overdue: boolean };
  openPlanIssues: number;
  hosting: { sites: number; live: number; interactive: number; enquiries7d: number };
  content: { workspaces: number; artifacts: Record<string, number> };
};

export type AdminMembership = { status: string; planId: string; periodEnd: string | null; current: boolean; tier: string | null; interval: string | null };
export type AdminCustomer = {
  id: string; email: string | null; createdAt: string; lastSignInAt: string | null; confirmed: boolean; isAdmin: boolean; unlimitedCredits: boolean;
  membership: AdminMembership | null; credits: { available: number; reserved: number }; workspaces: number; sites: number;
};
export type AdminCustomerPage = { total: number; limit: number; offset: number; rows: AdminCustomer[] };
export const CUSTOMER_FILTERS = ["all", "subscribed", "admin", "unconfirmed"] as const;
export type CustomerFilter = typeof CUSTOMER_FILTERS[number];
export const CUSTOMER_PAGE_SIZE = 25;

export type AdminCustomerDetail = {
  profile: { id: string; email: string | null; createdAt: string; lastSignInAt: string | null; confirmed: boolean; providers: string[] };
  privileges: { isAdmin: boolean; unlimitedCredits: boolean; reason: string | null; updatedAt: string } | null;
  memberships: (AdminMembership & { membershipId: string; checkedAt: string })[];
  periods: { membershipId: string; start: string; end: string; interval: string }[];
  openIssues: { kind: string; membershipId: string; allocationStart: string; firstSeenAt: string }[];
  credits: {
    available: number; balance: number; reserved: number;
    lots: { source: string; amount: number; spent: number; held: number; lapsed: number; expiresAt: string | null; createdAt: string }[];
    ledger: { delta: number; kind: string; balanceAfter: number; createdAt: string }[];
  };
  runs: { outcome: string; chargedCredits: number; absorbedCredits: number; providerMicrousd: number; recordedAt: string }[];
  workspaces: { id: string; name: string; artifacts: number }[];
  sites: { slug: string; live: boolean; interactive: boolean; enquiriesEnabled: boolean; updatedAt: string; enquiries: number }[];
};

export type AdminHealth = {
  generatedAt: string; days: number;
  errors: { last24h: number; window: number; byDay: { day: string; server: number; client: number }[];
    top: { fingerprint: string; source: "server" | "client"; kind: string; message: string; route: string; count: number; total: number; firstSeen: string; lastSeen: string; release: string }[] };
  visits: Record<string, number>;
  funnel: { signedUp: number; confirmed: number; createdProject: number; ranBuild: number; sharedReview: number; published: number; paid: number };
  signupsByDay: { day: string; count: number }[];
};

/** Errors, visits and the sign-up funnel for the last `days` (1-90). */
export async function adminHealth(actor: string, days: number) {
  const data = await call<AdminHealth>("makeborne_admin_health", { p_actor: actor, p_days: days });
  // jsonb sums arrive as numbers or numeric strings; normalise once.
  return { ...data, errors: { ...data.errors, last24h: Number(data.errors.last24h), window: Number(data.errors.window),
    byDay: data.errors.byDay.map(day => ({ day: day.day, server: Number(day.server ?? 0), client: Number(day.client ?? 0) })),
    top: data.errors.top.map(item => ({ ...item, count: Number(item.count), total: Number(item.total) })) } };
}

export type AdminLegalRequests = {
  generatedAt: string;
  withdrawals: { reference: string; received_at: string; source: string; email: string; name: string | null; payment_reference: string | null;
    payment_id: string | null; payment_kind: string | null; acknowledgement: string; statement: string; message: string | null; mail: string }[];
  mail: { pending: number; failed: number; retrying: number; sent7d: number; oldestPendingAt: string | null };
  problems: { kind: string; recipient: string; status: string; attempts: number; last_error: string | null; created_at: string; next_attempt_at: string }[];
  confirmations7d: number;
};

/** Withdrawal notices and the confirmation/acknowledgement outbox (20261028100000). */
export async function adminLegalRequests(actor: string) {
  const data = await call<AdminLegalRequests>("makeborne_admin_legal_requests", { p_actor: actor });
  return { ...data, mail: { ...data.mail, pending: Number(data.mail?.pending ?? 0), failed: Number(data.mail?.failed ?? 0), retrying: Number(data.mail?.retrying ?? 0), sent7d: Number(data.mail?.sent7d ?? 0) },
    confirmations7d: Number(data.confirmations7d ?? 0) };
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await billingDatabase().rpc(fn, args);
  if (error) {
    if (error.code === "42501") throw new RequestError("ADMIN_REQUIRED", "Administrator access is required.", 403);
    throw new RequestError("ADMIN_DATA_UNAVAILABLE", "Administrator data could not be loaded.", 503);
  }
  return data as T;
}

export async function adminOverview(actor: string) {
  const overview = await call<AdminOverview>("makeborne_admin_overview", { p_actor: actor });
  return { ...overview, revenue: subscriptionRevenue(overview.subscriptions) };
}

export function adminCustomers(actor: string, query: { search: string; filter: CustomerFilter; page: number }) {
  return call<AdminCustomerPage>("makeborne_admin_users", {
    p_actor: actor, p_search: query.search.slice(0, 200) || null, p_filter: query.filter,
    p_limit: CUSTOMER_PAGE_SIZE, p_offset: Math.max(0, query.page - 1) * CUSTOMER_PAGE_SIZE,
  });
}

export function adminCustomer(actor: string, customerId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customerId)) return Promise.resolve(null);
  return call<AdminCustomerDetail | null>("makeborne_admin_user", { p_actor: actor, p_user: customerId });
}

// ---------------------------------------------------------------------------
// Payments and the support refund workflow (20261020090000). Reads use the same
// administrator check; begin/cancel are the console's only writes and change
// credits only through the audited database functions. Refunds themselves are
// issued by support in the Whop dashboard; the runtime key has no refund scope.
// ---------------------------------------------------------------------------
export const REFUND_DECISIONS = ["eligible", "not_eligible_used", "blocked_active_hold", "refund_in_progress", "already_refunded", "held_for_review",
  "manual_review_unattributed", "manual_review_no_credits", "nothing_to_refund", "not_paid", "unknown_payment"] as const;
export type RefundDecision = typeof REFUND_DECISIONS[number];
export type AdminPaymentRefund = {
  payment: string; kind: "subscription" | "credit_pack"; decision: RefundDecision;
  provider: { state: string; principalCents: number; refundedCents: number; currency: string; dispute: string };
  subscription: { membershipId: string; billingReason: string; paidAt: string; attribution: string; periodStart: string | null; periodEnd: string | null; consumedExposureCredits: number; revoked: boolean } | null;
  creditPack: { orderId: string; packId: string; credits: number; withheldCredits: number; consumedExposureCredits: number } | null;
  credits: { spent: number; unused: number; withheld: number; activeHolds: number; lots: { lot: number; source: string; amount: number; spent: number; held: number; lapsed: number; expiresAt: string | null }[] };
  refundCase: { id: number; state: "pending" | "completed" | "canceled"; reason: string; withheldCredits: number; openedAt: string; closedAt: string | null; closeReason: string | null } | null;
  usage?: { reference: string; status: string; held: number; charged: number | null; returned: number | null; createdAt: string }[];
  ledger?: { kind: string; delta: number; reference: string; balanceAfter: number; createdAt: string }[];
};
export type AdminCustomerPayments = {
  subscriptionPayments: AdminPaymentRefund[]; creditPackPayments: AdminPaymentRefund[];
  revocations: { payment: string; membershipId: string; periodStart: string; periodEnd: string; reason: string; revokedAt: string; liftedAt: string | null }[];
};

export function adminCustomerPayments(actor: string, customerId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customerId)) return Promise.resolve(null);
  return call<AdminCustomerPayments>("makeborne_admin_user_payments", { p_actor: actor, p_user: customerId });
}

const PAYMENT_ID = /^pay_[A-Za-z0-9]{1,64}$/;
/** Begin withholds the payment's unused credits under the wallet lock (eligible payments only); cancel restores them if Whop shows no refund. */
export async function supportRefund(actor: string, action: "check" | "begin" | "cancel", paymentId: string, reason: string) {
  if (!PAYMENT_ID.test(paymentId)) throw new RequestError("INVALID_PAYMENT", "Enter a Whop payment ID (pay_…).", 400);
  const trimmed = reason.trim();
  if (action !== "check" && (trimmed.length < 5 || trimmed.length > 500)) throw new RequestError("REASON_REQUIRED", "Give a reason of 5–500 characters.", 400);
  const fn = action === "check" ? "makeborne_support_payment_refund_check" : action === "begin" ? "makeborne_support_payment_refund_begin" : "makeborne_support_payment_refund_cancel";
  return call<AdminPaymentRefund & { began?: boolean; canceled?: boolean; blocked?: string; withheldCredits?: number; restoredCredits?: number }>(fn,
    action === "check" ? { p_actor: actor, p_payment: paymentId } : { p_actor: actor, p_payment: paymentId, p_reason: trimmed });
}
