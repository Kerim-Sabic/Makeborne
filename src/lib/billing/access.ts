import "server-only";
import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { accountsEnabled } from "@/lib/supabase/auth-server";
import { createClient, getVerifiedUser } from "@/lib/supabase/server";
import { ensureTrialCredits, grantPlanCredits } from "@/lib/credits/server";
import { authDestination } from "@/lib/supabase/auth-flow";
import { RequestError } from "@/lib/server/http";
import { billingConfig } from "./config";
import { billingDatabase } from "./database";
import { activeMembership, retrieveMembership } from "./whop";
import { getAccountPrivileges } from "@/lib/account/privileges";

export async function billingUser(): Promise<User | null> {
  if (!accountsEnabled()) return null;
  try {
    const user = await getVerifiedUser();
    return user && !user.is_anonymous && user.email && user.email_confirmed_at ? user : null;
  } catch { return null; }
}

export async function requireBillingUser() {
  const user = await billingUser();
  if (!user) throw new RequestError("AUTH_REQUIRED", "Sign in before continuing to payment or your workspace.", 401);
  return user;
}

export async function verifyCreationAccess(user: User, checkoutId?: string): Promise<boolean> {
  // An operator grant unlocks the workspace, but never marks a checkout paid.
  if (checkoutId === undefined && (await getAccountPrivileges(user.id)).isAdmin) return true;
  if (!billingConfig().enabled) return false;
  const db = billingDatabase();
  let query = db.from("billing_memberships")
    .select("membership_id,checkout_id,whop_user_id,plan_id").eq("user_id", user.id).in("plan_id", billingConfig().accessPlanIds);
  // A checkout return must verify that purchase specifically. Another active
  // membership on the account cannot turn a failed checkout into a success.
  if (checkoutId !== undefined) query = query.eq("checkout_id", checkoutId);
  const { data: memberships, error } = await query.order("checked_at", { ascending: false }).limit(20);
  if (error) throw new RequestError("MEMBERSHIP_UNAVAILABLE", "Membership verification is temporarily unavailable.", 503);
  for (const stored of memberships ?? []) {
    const membership = await retrieveMembership(stored.membership_id);
    const matches = membership.checkout_configuration_id === stored.checkout_id && membership.user?.id === stored.whop_user_id && membership.plan.id === stored.plan_id;
    const active = matches && activeMembership(membership);
    const verifiedUntil = active ? new Date(Math.min(Date.parse(membership.renewal_period_end!), Date.now() + 5 * 60_000)).toISOString() : new Date(0).toISOString();
    const { error: updateError } = await db.from("billing_memberships").update({ status: membership.status, verified_until: verifiedUntil, period_end: membership.renewal_period_end, checked_at: new Date().toISOString() }).eq("membership_id", stored.membership_id).eq("user_id", user.id);
    if (updateError) throw new RequestError("MEMBERSHIP_UNAVAILABLE", "Membership verification is temporarily unavailable.", 503);
    if (active) {
      const { data: enabled, error: enabledError } = await db.rpc("makeborne_billing_creation_enabled", { p_plan_id: membership.plan.id });
      const allowed = !enabledError && enabled === true;
      // Self-heal a missed webhook grant; idempotent per membership period.
      if (allowed) await grantPlanCredits(user.id, membership.plan.id, stored.membership_id, membership.renewal_period_end!).catch(() => undefined);
      return allowed;
    }
  }
  return false;
}

/**
 * The database decides first: admins, the free tier for confirmed accounts and
 * recently verified memberships. It runs as the signed-in user, so it can only
 * answer for the session that matches `user`. Failures fall back to Whop.
 */
async function databaseCreationAccess(user: User): Promise<boolean> {
  try {
    const client = await createClient();
    const { data: claims, error: claimsError } = await client.auth.getClaims();
    if (claimsError || claims?.claims?.sub !== user.id) return false;
    const { data, error } = await client.rpc("makeborne_creation_access");
    return !error && data === true;
  } catch { return false; }
}

async function grantTrialCredits(user: User) {
  // Idempotent and cheap after the first grant; never blocks access on failure.
  try { await ensureTrialCredits(user.id); } catch { /* Retried on the next access. */ }
}

/** Database access (free tier, admins, recorded memberships) or live Whop verification. */
export async function hasCreationAccess(user: User): Promise<boolean> {
  if (await databaseCreationAccess(user)) { await grantTrialCredits(user); return true; }
  return verifyCreationAccess(user);
}

export async function requireCreationAccess(user?: User) {
  const verified = user ?? await requireBillingUser();
  if (verified.is_anonymous || !verified.email || !verified.email_confirmed_at) throw new RequestError("AUTH_REQUIRED", "Confirm your account email before creating a project.", 401);
  if (!await hasCreationAccess(verified)) throw new RequestError("MEMBERSHIP_REQUIRED", "Creation access is not available for this account right now. Choose a plan to continue; support purchases do not unlock creation.", 402);
  return verified;
}

export async function requireCreationPage(next: string) {
  const destination = authDestination(next);
  const user = await billingUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(destination)}`);
  let allowed = false;
  try { allowed = await hasCreationAccess(user); } catch { /* Keep the gate closed during provider outages. */ }
  if (!allowed) redirect(`/billing?required=membership&next=${encodeURIComponent(destination)}`);
  return user;
}

export function pageDestination(pathname: string, searchParams: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) if (typeof value === "string") query.set(key, value);
  return authDestination(`${pathname}${query.size ? `?${query}` : ""}`);
}
