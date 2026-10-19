import "server-only";
import { billingDatabase } from "@/lib/billing/database";
import { RequestError } from "@/lib/server/http";
import { subscriptionRevenue, type SubscriptionGroup } from "./revenue";

/**
 * Read-only administrator data for /admin. Every call passes the verified
 * session's user id as the actor; the database functions refuse anyone who is
 * not an administrator (20261013100000_admin_console.sql), so this module adds
 * no authority of its own. Nothing here writes.
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
