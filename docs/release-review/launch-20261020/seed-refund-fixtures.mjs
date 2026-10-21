// Seeds the DISPOSABLE local stack (makeborne-rc-20261019) for the refund and auto top-up screens:
// an administrator, a customer whose subscription payment was fully refunded (simulated provider
// evidence through makeborne_reconcile_plan_payment), and a customer with an unused, refundable
// payment. Passwords go to work/launch-20261020/fixtures.private.json (ignored); nothing is printed.
// Usage (worktree root, after both 20261020 migrations are applied to the stack):
//   node docs/release-review/launch-20261020/seed-refund-fixtures.mjs
import crypto from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const status = JSON.parse(readFileSync("../rc-20261019/work/rc-stack/status.json", "utf8"));
assert.equal(status.API_URL, "http://127.0.0.1:55481", "Refusing: not the disposable rc stack API");
const sql = text => {
  const result = spawnSync("docker", ["exec", "-i", "supabase_db_makeborne-rc-20261019", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt"],
    { input: text, encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};
const admin = createClient(status.API_URL, status.SECRET_KEY, { auth: { persistSession: false } });
const must = (result, label) => { if (result.error) throw new Error(`${label}: ${result.error.message}`); return result.data; };
async function user(label) {
  const email = `${label}-${Date.now().toString(36)}@launch.example.invalid`, password = crypto.randomBytes(18).toString("base64url");
  const created = must(await admin.auth.admin.createUser({ email, password, email_confirm: true }), `create ${label}`);
  return { label, id: created.user.id, email, password };
}
const operator = await user("operator"), refunded = await user("refunded"), eligible = await user("eligible");
sql(`insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values('${operator.id}',true,false,'Local launch fixture');
update makeborne_private.billing_settings set creation_enabled=true, free_tier_enabled=false where singleton;
insert into makeborne_private.billing_access_plans(plan_id,enabled) values('plan_launchCreate',true) on conflict (plan_id) do update set enabled=true;`);
const start = new Date(Math.floor(Date.now() / 1000) * 1000 - 3600_000), end = new Date(start.getTime() + 30 * 86400_000);
async function member(account, key) {
  must(await admin.from("billing_checkouts").insert({ request_id: crypto.randomUUID(), user_id: account.id, plan_id: "plan_launchCreate", checkout_id: `ch_${key}`, return_path: "/studio", status: "ready" }), "checkout");
  must(await admin.rpc("makeborne_record_whop_membership", { p_event_id: `evt_${key}`, p_user_id: account.id, p_membership_id: `mem_${key}`, p_checkout_id: `ch_${key}`,
    p_whop_user_id: `user_${key}`, p_plan_id: "plan_launchCreate", p_status: "active", p_period_end: end.toISOString(), p_verified_until: new Date(Date.now() + 240_000).toISOString() }), "membership");
  const payment = updated => ({ id: `pay_${key}`, membershipId: `mem_${key}`, planId: "plan_launchCreate", billingReason: "subscription_create", currency: "usd",
    principalCents: "2900", refundedPrincipalCents: "0", status: "paid", dispute: "none", paidAt: new Date(start.getTime() + 1000).toISOString(), updatedAt: updated });
  must(await admin.rpc("makeborne_reconcile_plan_payment", { p_user: account.id, p_membership: `mem_${key}`, p_payment: payment(new Date(Date.now() - 600_000).toISOString()),
    p_period_start: start.toISOString(), p_period_end: end.toISOString() }), "payment");
  must(await admin.rpc("makeborne_record_plan_observation", { p_user: account.id, p_membership: `mem_${key}`, p_whop_plan_id: "plan_launchCreate", p_tier: "create", p_interval: "monthly",
    p_monthly_credits: 300, p_status: "active", p_paid: true, p_period_start: start.toISOString(), p_period_end: end.toISOString(), p_source: "webhook" }), "observation");
  return payment;
}
const refundedPayment = await member(refunded, "launchRefunded");
must(await admin.rpc("makeborne_reconcile_plan_payment", { p_user: refunded.id, p_membership: "mem_launchRefunded",
  p_payment: { ...refundedPayment(new Date(Date.now() - 60_000).toISOString()), refundedPrincipalCents: "2900", status: "refunded" },
  p_period_start: start.toISOString(), p_period_end: end.toISOString() }), "refund");
await member(eligible, "launchEligible");
mkdirSync("work/launch-20261020", { recursive: true });
writeFileSync("work/launch-20261020/fixtures.private.json", JSON.stringify({ at: new Date().toISOString(), users: [operator, refunded, eligible] }, null, 2));
const wallet = id => Number(sql(`select makeborne_private.credit_available('${id}')`));
console.log(JSON.stringify({ seeded: ["operator (admin)", "refunded", "eligible"], refundedAvailable: wallet(refunded.id), eligibleAvailable: wallet(eligible.id) }));
