/* eslint-disable @typescript-eslint/no-require-imports -- Offline configuration and signature regression checks. */
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { Webhook } = require("standardwebhooks");
class RequestError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
function load(file, env, modules = {}) {
  const output = ts.transpileModule(fs.readFileSync(require.resolve(file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {}, process: { env }, Buffer, Date, URL, require: name => name === "server-only" ? {} : modules[name] ?? (name === "./topup-delivery" || name === "./plan-payments" ? {} : name === "./purchase-confirmations" ? { confirmAfterFulfillment: async () => {} } : require(name)) };
  vm.runInNewContext(output, context);
  return context.exports;
}
const env = { WHOP_API_KEY: "fake-api", WHOP_COMPANY_ID: "biz_CV9cZg1zFX3h7f", WHOP_WEBHOOK_SECRET: "ws_fake", SUPABASE_SECRET_KEY: "sb_secret_fake", WHOP_ACCESS_PLAN_IDS: "plan_B7Dgm9ZqM3V0M,plan_unknown", WHOP_CREATION_ENABLED: "true", MAKEBORNE_BILLING_MIGRATIONS_VERIFIED: "true" };
const schedule = load("./plan-schedule.ts", env, { "./plans": load("./plans.ts", env) });
const config = load("./config.ts", env, { "./plan-schedule": schedule });
assert.equal(config.billingConfig().enabled, false);
assert.equal(config.billingConfig().accessPlanIds.length, 0);
env.WHOP_ACCESS_PLAN_IDS = config.CREATION_CATALOG.create;
assert.equal(config.billingConfig().enabled, true);
// Local sandbox never opens against a cloud database or the production merchant.
const savedEnv = { ...env };
Object.assign(env, { WHOP_API_BASE_URL: "https://sandbox-api.whop.com/api/v1", MAKEBORNE_WHOP_SANDBOX: "true", WHOP_COMPANY_ID: "biz_sandbox", WHOP_SANDBOX_COMPANY_ID: "biz_sandbox", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55435" });
assert.equal(config.billingConfig().enabled, true);
env.NEXT_PUBLIC_SUPABASE_URL = "https://production.supabase.co";
assert.equal(config.billingConfig().enabled, false);
env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:55435";
env.VERCEL = "1";
assert.equal(config.billingConfig().enabled, false);
delete env.VERCEL;
env.WHOP_COMPANY_ID = config.SUPPORT.companyId;
assert.equal(config.billingConfig().enabled, false);

// Cloud qualification requires every reviewed staging identity and both explicit opt-ins.
const stagingEnv = {
  ...savedEnv, WHOP_API_BASE_URL: "https://sandbox-api.whop.com/api/v1",
  MAKEBORNE_WHOP_SANDBOX: "true", MAKEBORNE_WHOP_STAGING_SANDBOX: "true",
  VERCEL: "1", VERCEL_ENV: "preview", VERCEL_PROJECT_ID: "prj_c9h8fuyEmVAT8F3NHFMvzFR1BnLc",
  NEXT_PUBLIC_SUPABASE_URL: "https://xzwikrunwpurxnxgkznh.supabase.co",
  WHOP_COMPANY_ID: "biz_e4w3EGe3izP67k", WHOP_SANDBOX_COMPANY_ID: "biz_e4w3EGe3izP67k",
  WHOP_ACCESS_PLAN_IDS: "plan_SandboxFixture", WHOP_PLAN_CREDIT_MAP: "plan_SandboxFixture:create:monthly",
};
function setEnv(value) { for (const key of Object.keys(env)) delete env[key]; Object.assign(env, value); }
setEnv(stagingEnv);
assert.equal(config.billingConfig().configured, true);
assert.equal(config.billingConfig().enabled, true);
assert.equal(config.billingConfig().apiKey, "fake-api");
assert.equal(config.billingConfig().companyId, "biz_e4w3EGe3izP67k");
const deniedScopes = [
  { VERCEL: undefined }, { VERCEL: "true" }, { VERCEL_ENV: undefined }, { VERCEL_ENV: "production" }, { VERCEL_ENV: "development" },
  { VERCEL_TARGET_ENV: "production" }, { VERCEL_PROJECT_ID: undefined }, { VERCEL_PROJECT_ID: "prj_other" },
  { NEXT_PUBLIC_SUPABASE_URL: "https://production.supabase.co" }, { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55435" },
  { VERCEL: undefined, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55435" },
  { NEXT_PUBLIC_SUPABASE_URL: "https://xzwikrunwpurxnxgkznh.supabase.co/" },
  { NEXT_PUBLIC_SUPABASE_URL: "https://xzwikrunwpurxnxgkznh.supabase.co.evil.test" },
  { WHOP_COMPANY_ID: config.SUPPORT.companyId, WHOP_SANDBOX_COMPANY_ID: config.SUPPORT.companyId },
  { WHOP_COMPANY_ID: "biz_other", WHOP_SANDBOX_COMPANY_ID: "biz_other" },
  { WHOP_SANDBOX_COMPANY_ID: undefined }, { WHOP_SANDBOX_COMPANY_ID: "biz_other" },
  { MAKEBORNE_WHOP_SANDBOX: undefined }, { MAKEBORNE_WHOP_STAGING_SANDBOX: undefined }, { MAKEBORNE_WHOP_STAGING_SANDBOX: "false" },
  { WHOP_API_BASE_URL: undefined }, { WHOP_API_BASE_URL: "https://api.whop.com/api/v1" },
  { WHOP_API_BASE_URL: "https://sandbox-api.whop.com/api/v1/" }, { WHOP_API_BASE_URL: "https://sandbox-api.whop.com.evil.test/api/v1" },
  { WHOP_API_BASE_URL: "https://api.whop.com/api/v1", WHOP_COMPANY_ID: config.SUPPORT.companyId, WHOP_SANDBOX_COMPANY_ID: config.SUPPORT.companyId },
];
for (const override of deniedScopes) {
  setEnv({ ...stagingEnv, ...override });
  const denied = config.billingConfig();
  assert.equal(denied.configured, false, `scope ${Object.keys(override).join(",")} must refuse`);
  assert.equal(denied.enabled, false);
  assert.equal(denied.apiKey, undefined, "rejected sandbox must not expose provider credentials");
  assert.equal(denied.secretKey, undefined, "rejected sandbox must not expose DB credentials");
  assert.equal(denied.companyId, undefined);
}
for (const override of [{ WHOP_ACCESS_PLAN_IDS: config.SUPPORT.planId }, { WHOP_CREATION_ENABLED: "false" }, { MAKEBORNE_BILLING_MIGRATIONS_VERIFIED: "false" }]) {
  setEnv({ ...stagingEnv, ...override }); assert.equal(config.billingConfig().enabled, false);
}
// Even an otherwise local-looking environment cannot use sandbox in production.
setEnv({ ...stagingEnv, VERCEL: undefined, VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55435" });
assert.equal(config.billingConfig().enabled, false);
console.log(`PASS strict staging sandbox scope: reviewed preview accepted; ${deniedScopes.length} scope mismatches, live support plan, disabled flags and production local fallback refused.`);
for (const key of Object.keys(env)) delete env[key];
Object.assign(env, savedEnv);
env.WHOP_WEBHOOK_SECRET = "";
assert.equal(config.billingConfig().enabled, false);
env.WHOP_WEBHOOK_SECRET = "ws_fake";
env.WHOP_CREATION_ENABLED = "false";
assert.equal(config.billingConfig().enabled, false);
env.WHOP_CREATION_ENABLED = "true";
env.MAKEBORNE_BILLING_MIGRATIONS_VERIFIED = "false";
assert.equal(config.billingConfig().enabled, false);
const secret = "ws_fake_for_offline_signature_verification_only";
const webhook = load("./webhook.ts", { WHOP_WEBHOOK_SECRET: secret }, {
  "@/lib/server/http": { RequestError }, "./config": config, "./database": {}, "./plan-credits": {}, "@/lib/credits/server": {}, "./whop": {}, "./topup-delivery": {},
});
const body = JSON.stringify({ id: "msg_test", type: "membership.activated", account_id: "biz_CV9cZg1zFX3h7f", data: { id: "mem_test" } });
const now = new Date();
const signer = new Webhook(Buffer.from(secret).toString("base64"));
const headers = new Headers({ "webhook-id": "msg_test", "webhook-timestamp": String(Math.floor(now.getTime() / 1000)), "webhook-signature": signer.sign("msg_test", now, body) });
assert.equal(webhook.verifyWhopEvent(body, headers).id, "msg_test");
assert.throws(() => webhook.verifyWhopEvent(body + " ", headers), error => error.code === "INVALID_WEBHOOK");
const wrongId = new Headers(headers); wrongId.set("webhook-id", "msg_wrong");
assert.throws(() => webhook.verifyWhopEvent(body, wrongId), error => error.code === "INVALID_WEBHOOK");
const past = new Date(now.getTime() - 600_000);
const oldHeaders = new Headers({ "webhook-id": "msg_test", "webhook-timestamp": String(Math.floor(past.getTime() / 1000)), "webhook-signature": signer.sign("msg_test", past, body) });
assert.throws(() => webhook.verifyWhopEvent(body, oldHeaders), error => error.code === "INVALID_WEBHOOK");

async function lifecycleChecks() {
  env.MAKEBORNE_BILLING_MIGRATIONS_VERIFIED = "true";
  const whop = load("./whop.ts", env, { "@/lib/server/http": { RequestError }, "./config": config });
  const fixtures = require("./fixtures/whop-sandbox/memberships.json");
  for (const sample of fixtures.samples) {
    const parsed = whop.membershipSchema.safeParse(sample.response);
    assert(parsed.success, `Real sandbox membership failed: ${sample.case}`);
    assert(parsed.data.renewal_period_start && parsed.data.renewal_period_end);
  }
  const active = { id: "mem_test", company: { id: env.WHOP_COMPANY_ID }, plan: { id: config.CREATION_CATALOG.create }, user: { id: "user_test" }, checkout_configuration_id: "ch_test", status: "active", renewal_period_end: new Date(Date.now() + 60_000).toISOString() };
  assert.equal(whop.activeMembership(active), true);
  assert.equal(whop.activeMembership({ ...active, status: "canceling" }), true);
  for (const status of ["trialing", "past_due", "completed", "canceled", "expired", "unresolved", "drafted"]) assert.equal(whop.activeMembership({ ...active, status }), false);
  assert.equal(whop.activeMembership({ ...active, plan: { id: config.SUPPORT.planId } }), false);
  assert.equal(whop.activeMembership({ ...active, company: { id: "biz_other" } }), false);
  assert.equal(whop.activeMembership({ ...active, renewal_period_end: new Date(0).toISOString() }), false);
  assert.equal(whop.activeMembership({ ...active, renewal_period_end: "invalid" }), false);
  assert.equal(whop.activeMembership({ ...active, user: null }), false);
  assert.equal(whop.checkoutUrl("https://whop.com/checkout/ch_test"), "https://whop.com/checkout/ch_test");
  for (const bad of ["/checkout/ch_test", "https://evil.whop.com/checkout/ch_test", "https://whop.com.evil.test/checkout/ch_test", "https://name:pass@whop.com/checkout/ch_test", "https://whop.com/checkout/", "https://whop.com/checkout/ch_test/extra", "not a url"]) assert.throws(() => whop.checkoutUrl(bad), error => error.code === "CHECKOUT_UNVERIFIED");

  const paymentReads = [];
  const eventHandler = load("./webhook.ts", env, {
    "@/lib/server/http": { RequestError }, "./config": config, "./database": {}, "./plan-credits": {}, "@/lib/credits/server": {},
    "./whop": { retrievePaymentMembership: async id => { paymentReads.push(id); return "mem_resolved"; } },
  });
  const event = { id: "msg_test", type: "membership.activated", account_id: env.WHOP_COMPANY_ID, data: { id: "mem_test" } };
  assert.equal(await eventHandler.eventMembershipId(event), "mem_test");
  assert.equal(await eventHandler.eventMembershipId({ ...event, type: "payment.succeeded", data: { id: "pay_test", membership: { id: "mem_test" } } }), "mem_test");
  for (const type of ["refund.created", "refund.updated", "dispute.created", "dispute.updated"]) assert.equal(await eventHandler.eventMembershipId({ ...event, type, data: { payment: { id: "pay_test" } } }), "mem_resolved");
  assert.equal(await eventHandler.eventMembershipId({ ...event, type: "payment.succeeded", data: { id: "pay_test" } }), "mem_resolved");
  assert.equal(paymentReads.length, 5);
  const unlinkedPayment = load("./webhook.ts", env, {
    "@/lib/server/http": { RequestError }, "./config": config, "./database": {}, "./plan-credits": {}, "@/lib/credits/server": {},
    "./whop": { retrievePaymentMembership: async () => null },
  });
  await assert.rejects(unlinkedPayment.eventMembershipId({ ...event, type: "payment.succeeded", data: { id: "pay_test" } }), error => error.code === "PAYMENT_MEMBERSHIP_PENDING" && error.status === 503);
  assert.equal(await eventHandler.eventMembershipId({ ...event, type: "unknown.event", data: { membership: { id: "mem_test" } } }), null);
  assert.equal(await eventHandler.eventMembershipId({ ...event, type: "refund.created", data: { payment: { id: "../../bad" } } }), null);
  await assert.rejects(eventHandler.reconcileWhopEvent({ ...event, company_id: "biz_other" }), error => error.code === "WRONG_MERCHANT");

  // The checkout return passes an exact checkout constraint to the same live
  // verifier. The second, active checkout cannot satisfy the canceled first one.
  const records = [
    { membership_id: "mem_canceled", checkout_id: "ch_canceled", whop_user_id: "user_test", plan_id: config.CREATION_CATALOG.create },
    { membership_id: "mem_active", checkout_id: "ch_active", whop_user_id: "user_test", plan_id: config.CREATION_CATALOG.create },
  ];
  const readIds = [];
  const db = { from: () => {
    let rows = records;
    const query = { select: () => query, eq: (key, value) => { if (key === "checkout_id") rows = rows.filter(row => row[key] === value); return query; }, in: () => query, order: () => query, limit: async () => ({ data: rows, error: null }), update: () => { const update = { eq: () => update, then: resolve => resolve({ error: null }) }; return update; } };
    return query;
  }, rpc: async name => name === "makeborne_membership_access_revoked" ? (revokedError ? { data: null, error: { code: "42883" } } : { data: revoked, error: null }) : { data: true, error: null } };
  let revoked = false, revokedError = false;
  let sessionUser = "account_test", databaseAccess = true;
  const databaseCalls = [], trials = [], grants = [];
  let isAdmin = true;
  const access = load("./access.ts", env, {
    "@/lib/account/privileges": { getAccountPrivileges: async () => ({ isAdmin, unlimitedCredits: isAdmin }) },
    "next/navigation": {}, "@/lib/supabase/auth-server": {}, "@/lib/supabase/auth-flow": {}, "@/lib/server/http": { RequestError }, "./config": config, "./database": { billingDatabase: () => db },
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: sessionUser } }, error: null }) }, rpc: async name => { databaseCalls.push(name); return { data: databaseAccess, error: null }; } }) },
    "@/lib/credits/server": { ensureTrialCredits: async id => { trials.push(id); }, recordPlanObservation: async (...args) => { grants.push(JSON.parse(JSON.stringify(args))); return { outcome: "recorded", granted: 0 }; } },
    "./whop": { activeMembership: whop.activeMembership, retrieveMembership: async id => { readIds.push(id); return { ...active, id, checkout_configuration_id: id === "mem_active" ? "ch_active" : "ch_canceled", status: id === "mem_active" ? "active" : "canceled" }; } },
  });
  assert.equal(await access.verifyCreationAccess({ id: "account_test" }, "ch_canceled"), false);
  assert.deepEqual(readIds, ["mem_canceled"]);
  // A verified but unpaid membership is recorded as unpaid (stops allocations), never as paid.
  assert.deepEqual(grants, [["account_test", { membershipId: "mem_canceled", planId: config.CREATION_CATALOG.create, status: "canceled", paid: false, periodStart: null, periodEnd: active.renewal_period_end, source: "access_check" }]]);
  grants.length = 0;
  assert.equal(await access.verifyCreationAccess({ id: "account_test" }, "ch_active"), true);
  assert.deepEqual(grants, [["account_test", { membershipId: "mem_active", planId: config.CREATION_CATALOG.create, status: "active", paid: true, periodStart: null, periodEnd: active.renewal_period_end, source: "access_check" }]]);
  // A refunded period stays closed although Whop still reports the membership active; unknown fails closed.
  revoked = true; grants.length = 0;
  assert.equal(await access.verifyCreationAccess({ id: "account_test" }, "ch_active"), false);
  assert.deepEqual(grants, [], "a revoked period records no paid observation");
  revoked = false; revokedError = true;
  await assert.rejects(access.verifyCreationAccess({ id: "account_test" }, "ch_active"), error => error.code === "MEMBERSHIP_UNAVAILABLE");
  revokedError = false;
  // Database access (free tier/admin/recorded membership) comes first and grants the trial.
  assert.equal(await access.hasCreationAccess({ id: "account_test" }), true);
  assert.deepEqual(databaseCalls, ["makeborne_creation_access"]);
  assert.deepEqual(trials, ["account_test"]);
  // A session for another account cannot answer for this user; fall back to Whop.
  sessionUser = "someone_else";
  assert.equal(await access.hasCreationAccess({ id: "account_test" }), true);
  assert.equal(databaseCalls.length, 1);
  assert.equal(trials.length, 1);
  sessionUser = "account_test"; databaseAccess = false;
  assert.equal(await access.hasCreationAccess({ id: "account_test" }), true);
  assert.equal(trials.length, 1);
  env.WHOP_CREATION_ENABLED = "false";
  isAdmin = false;
  const readsBeforeClosedSales = readIds.length;
  assert.equal(await access.verifyCreationAccess({ id: "account_test" }), true);
  assert.ok(readIds.length > readsBeforeClosedSales, "closed checkout still verifies an ordinary paid subscriber with Whop");
  assert.equal(await access.verifyCreationAccess({ id: "account_test" }, "ch_canceled"), false);
  let lookedUp, lookupUser = { id: "account_test", email: "fixture@example.invalid", email_confirmed_at: new Date().toISOString(), is_anonymous: false };
  db.auth = { admin: { getUserById: async id => { lookedUp = id; return { data: { user: lookupUser }, error: null }; } } };
  await access.refreshCreationAccessForActor("account_test");
  assert.equal(lookedUp, "account_test");
  revoked = true;
  await assert.rejects(access.refreshCreationAccessForActor("account_test"), error => error.code === "MEMBERSHIP_REQUIRED");
  revoked = false; lookupUser = { ...lookupUser, banned_until: new Date(Date.now() + 60000).toISOString() };
  await assert.rejects(access.refreshCreationAccessForActor("account_test"), error => error.code === "MEMBERSHIP_REQUIRED");
  lookupUser = { ...lookupUser, id: "other_account" };
  await assert.rejects(access.refreshCreationAccessForActor("account_test"), error => error.code === "MEMBERSHIP_UNAVAILABLE");
  env.MAKEBORNE_BILLING_MIGRATIONS_VERIFIED = "false";
  assert.equal(await access.verifyCreationAccess({ id: "account_test" }), false, "qualification gate still applies with checkout closed");
  console.log("PASS: coffee exclusion, configuration gates, signatures/replay, membership lifecycle, exact checkout binding, plan credit self-heal, database-first creation access with trial grant, refund/dispute reconciliation and redirect validation. No live services called.");
}
void lifecycleChecks().catch(error => { console.error(error); process.exitCode = 1; });
