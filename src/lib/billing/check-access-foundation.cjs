/* eslint-disable @typescript-eslint/no-require-imports -- Offline configuration and signature regression checks. */
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { Webhook } = require("standardwebhooks");
class RequestError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
function load(file, env, modules = {}) {
  const output = ts.transpileModule(fs.readFileSync(require.resolve(file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {}, process: { env }, Buffer, Date, URL, require: name => name === "server-only" ? {} : modules[name] ?? require(name) };
  vm.runInNewContext(output, context);
  return context.exports;
}
const env = { WHOP_API_KEY: "fake-api", WHOP_COMPANY_ID: "biz_CV9cZg1zFX3h7f", WHOP_WEBHOOK_SECRET: "ws_fake", SUPABASE_SECRET_KEY: "sb_secret_fake", WHOP_ACCESS_PLAN_IDS: "plan_B7Dgm9ZqM3V0M,plan_unknown", WHOP_CREATION_ENABLED: "true", MAKEBORNE_BILLING_MIGRATIONS_VERIFIED: "true" };
const config = load("./config.ts", env);
assert.equal(config.billingConfig().enabled, false);
assert.equal(config.billingConfig().accessPlanIds.length, 0);
env.WHOP_ACCESS_PLAN_IDS = config.CREATION_CATALOG.create;
assert.equal(config.billingConfig().enabled, true);
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
  "@/lib/server/http": { RequestError }, "./config": config, "./database": {}, "./whop": {},
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
    "@/lib/server/http": { RequestError }, "./config": config, "./database": {},
    "./whop": { retrievePaymentMembership: async id => { paymentReads.push(id); return "mem_resolved"; } },
  });
  const event = { id: "msg_test", type: "membership.activated", account_id: env.WHOP_COMPANY_ID, data: { id: "mem_test" } };
  assert.equal(await eventHandler.eventMembershipId(event), "mem_test");
  assert.equal(await eventHandler.eventMembershipId({ ...event, type: "payment.succeeded", data: { id: "pay_test", membership: { id: "mem_test" } } }), "mem_test");
  for (const type of ["refund.created", "refund.updated", "dispute.created", "dispute.updated"]) assert.equal(await eventHandler.eventMembershipId({ ...event, type, data: { payment: { id: "pay_test" } } }), "mem_resolved");
  assert.equal(await eventHandler.eventMembershipId({ ...event, type: "payment.succeeded", data: { id: "pay_test" } }), "mem_resolved");
  assert.equal(paymentReads.length, 5);
  const unlinkedPayment = load("./webhook.ts", env, {
    "@/lib/server/http": { RequestError }, "./config": config, "./database": {},
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
  }, rpc: async () => ({ data: true, error: null }) };
  const access = load("./access.ts", env, {
    "next/navigation": {}, "@/lib/supabase/auth-server": {}, "@/lib/supabase/server": {}, "@/lib/supabase/auth-flow": {}, "@/lib/server/http": { RequestError }, "./config": config, "./database": { billingDatabase: () => db },
    "./whop": { activeMembership: whop.activeMembership, retrieveMembership: async id => { readIds.push(id); return { ...active, id, checkout_configuration_id: id === "mem_active" ? "ch_active" : "ch_canceled", status: id === "mem_active" ? "active" : "canceled" }; } },
  });
  assert.equal(await access.verifyCreationAccess({ id: "account_test" }, "ch_canceled"), false);
  assert.deepEqual(readIds, ["mem_canceled"]);
  assert.equal(await access.verifyCreationAccess({ id: "account_test" }, "ch_active"), true);
  console.log("PASS: coffee exclusion, configuration gates, signatures/replay, membership lifecycle, exact checkout binding, refund/dispute reconciliation and redirect validation. No live services called.");
}
void lifecycleChecks().catch(error => { console.error(error); process.exitCode = 1; });
