/* eslint-disable @typescript-eslint/no-require-imports -- Offline end-to-end: a pack fulfilled by the reconcile job is confirmed at that moment, once; a later webhook replay adds nothing. */
// Real modules: topup-reconcile-job, topup-delivery, topup-fulfillment, purchase-confirmations, the confirmation text,
// the transactional mailer and webhook.ts. Faked: Whop, the database (an in-memory model of the SQL functions, with
// the same one-per-payment and one-per-key uniqueness as migration 20261028100000) and Resend's HTTP endpoint.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), ts = require("typescript"), assert = require("node:assert/strict");
const uuid = "00000000-0000-4000-8000-000000000001", order = "00000000-0000-4000-8000-0000000000aa";
const env = { MAKEBORNE_PURCHASE_CONFIRMATIONS_SINCE: "2026-10-29T20:00:00Z", MAKEBORNE_TRANSACTIONAL_MAIL_ENABLED: "true", RESEND_API_KEY: "re_fixtureKey0123456789",
  MAKEBORNE_TOPUP_MIGRATIONS_VERIFIED: "true", MAKEBORNE_BILLING_MIGRATIONS_VERIFIED: "true" };
const purchase = { id: order, user_id: uuid, request_id: uuid, pack_id: "boost_100", catalog_version: "credit-packs-preview-2026-10-05", credits: 100, price_cents: 1200,
  merchant_id: "biz_Test", plan_id: "plan_Test", whop_user_id: "user_Test", checkout_id: "ch_Test", created_at: "2026-10-30 09:00:00+00" };
const providerPayment = { id: "pay_Pack1", company: { id: "biz_Test" }, plan: { id: "plan_Test" }, user: { id: "user_Test" }, checkout_configuration_id: "ch_Test",
  billing_reason: "one_time", currency: "usd", status: "paid", substatus: "succeeded", subtotal: 12, total: 12, tax_amount: null, tax_refunded_amount: null,
  refunded_amount: 0, tax_behavior: "exclusive", promo_code: null, disputes: [], updated_at: "2026-10-30T09:00:30Z" };

// In-memory model of the stored state and the SQL functions this flow calls.
const store = { funded: false, observedAt: null, confirmations: [], mail: [], sent: [] };
const rpc = async (name, args) => {
  switch (name) {
    case "makeborne_find_topup_payment": return { data: { knownPack: true, purchase }, error: null };
    case "makeborne_reconcile_topup": {
      const first = !store.funded; store.funded = true; store.observedAt ??= "2026-10-30T09:00:30Z";
      return { data: { outcome: first ? "updated" : "duplicate", state: "funded" }, error: null };
    }
    case "makeborne_purchase_confirmation_candidates": {
      const due = store.funded && store.observedAt >= args.p_since && !store.confirmations.some(c => c.payment === "pay_Pack1") && (!args.p_payment || args.p_payment === "pay_Pack1");
      return { data: due ? [{ kind: "pack", payment_id: "pay_Pack1", user_id: uuid, request_id: uuid, plan_id: "plan_Test", pack_id: "boost_100", credits: 100, amount_cents: 1200,
        currency: "usd", paid_at: store.observedAt, recipient: "buyer@example.test", consent_version: "withdrawal-2026-10-26", terms_version: "terms-v9",
        consent_text: "I want my credit pack to be available immediately.", consent_accepted_at: "2026-10-30T08:59:00Z" }] : [], error: null };
    }
    case "makeborne_record_purchase_confirmation": {
      const existing = store.confirmations.find(c => c.payment === args.p_payment);
      if (existing) return { data: existing.id, error: null };
      if (!args.p_body.includes(args.p_payment) || !args.p_body.includes("I want my credit pack to be available immediately.")) return { data: null, error: { code: "22023" } };
      const id = `conf-${store.confirmations.length + 1}`;
      store.confirmations.push({ id, payment: args.p_payment, body: args.p_body });
      const key = `purchase-confirmation:${args.p_payment}`;
      if (!store.mail.some(m => m.key === key)) store.mail.push({ id: `mail-${store.mail.length + 1}`, key, recipient: "buyer@example.test", subject: args.p_subject, body: args.p_body, status: "pending", attempts: 0 });
      return { data: id, error: null };
    }
    case "makeborne_transactional_mail_claim": {
      const due = store.mail.filter(m => m.status === "pending").slice(0, args.p_limit);
      for (const m of due) { m.status = "sending"; m.attempts++; }
      return { data: due.map(m => ({ id: m.id, recipient: m.recipient, subject: m.subject, body: m.body, idempotency_key: m.key, attempts: m.attempts })), error: null };
    }
    case "makeborne_transactional_mail_result": {
      const m = store.mail.find(x => x.id === args.p_id); m.status = args.p_sent ? "sent" : "pending"; return { data: m.status, error: null };
    }
    // The reconcile job's queue and lease.
    case "makeborne_billing_job_begin": return { data: 7, error: null };
    case "makeborne_topup_due_orders": return { data: [{ id: order, user_id: uuid, merchant_id: "biz_Test", plan_id: "plan_Test", whop_user_id: "user_Test", checkout_id: "ch_Test", payment_id: "pay_Pack1", payment_scan_cursor: null }], error: null };
    case "makeborne_billing_job_heartbeat": case "makeborne_topup_record_check": case "makeborne_billing_job_finish": return { data: true, error: null };
    default: throw new Error(`unexpected rpc ${name}`);
  }
};
const fakeFetch = async (url, init) => { store.sent.push({ url, key: init.headers["Idempotency-Key"], to: JSON.parse(init.body).to[0] }); return { ok: true, status: 200, json: async () => ({ id: `email_${store.sent.length}` }) }; };
class RequestError extends Error { constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; } }
const config = { billingConfig: () => ({ apiKey: "fixture", secretKey: "fixture", companyId: "biz_Test", accessPlanIds: [] }) };
const mocks = {
  "server-only": {}, "@/lib/server/http": { RequestError }, "./config": config,
  "./database": { billingDatabase: () => ({ rpc, from: () => { throw new Error("pack deliveries never read membership tables"); } }) },
  "./whop": { whopGet: async () => providerPayment, retrieveMembership: async () => { throw new Error("not a membership event"); }, activeMembership: () => false, retrievePaymentMembership: async () => null },
  "./plan-credits": { creditRuleFor: () => null }, "@/lib/credits/server": { recordPlanObservation: async () => { throw new Error("not a plan"); } },
  "./plan-payments": { eventPaymentId: () => null, reconcilePlanPayment: async () => { throw new Error("not a plan"); }, retrieveVerifiedPlanPayment: async () => { throw new Error("not a plan"); } },
};
const cache = new Map();
function load(file) {
  const filename = path.resolve(__dirname, file);
  if (cache.has(filename)) return cache.get(filename);
  const context = { exports: {}, Date, JSON, BigInt, Number, Set, String, Buffer, URL, AbortSignal, console: { info() {}, warn() {} }, fetch: fakeFetch, process: { env }, require: name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith("@/")) return load(path.resolve(__dirname, "../..", name.slice(2)) + ".ts");
    if (name.startsWith(".")) return load(path.resolve(path.dirname(filename), name) + ".ts");
    return require(name);
  } };
  cache.set(filename, context.exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.exports;
}
const { runTopupReconcileJob } = load("topup-reconcile-job.ts");
const { deliverTopupPayment } = load("topup-delivery.ts");
const { reconcileWhopEvent } = load("webhook.ts");

(async () => {
  // 1. The webhook was missed; the reconcile job fulfils the pack.
  const run = await runTopupReconcileJob({ rpc, deliver: deliverTopupPayment, listPayments: async () => ({ paymentIds: [], complete: true, nextCursor: null, skipped: 0 }) });
  assert.equal(run.status, "succeeded"); assert.equal(run.stats.payments, 1);
  assert.equal(store.confirmations.length, 1, "the reconcile-fulfilled pack has exactly one confirmation");
  assert.equal(store.mail.length, 1, "and exactly one outbox message");
  assert.equal(store.mail[0].status, "sent", "sent right after it was queued, not by the next daily run");
  assert.deepEqual(store.sent.map(s => s.key), ["purchase-confirmation:pay_Pack1"]); assert.equal(store.sent[0].to, "buyer@example.test");
  assert.match(store.confirmations[0].body, /Credit pack: 100 credits, a one-time payment that does not renew/);
  // 2. The late webhook for the same payment arrives: delivery is a duplicate and nothing new is recorded or sent.
  await reconcileWhopEvent({ id: "evt_late", type: "payment.succeeded", account_id: "biz_Test", data: { id: "pay_Pack1" } });
  assert.equal(store.confirmations.length, 1, "a webhook replay creates no second confirmation");
  assert.equal(store.mail.length, 1, "and no second outbox message");
  assert.equal(store.sent.length, 1, "and sends nothing again");
  // 3. Another reconcile pass over the same order changes nothing either.
  await runTopupReconcileJob({ rpc, deliver: deliverTopupPayment, listPayments: async () => ({ paymentIds: ["pay_Pack1"], complete: true, nextCursor: null, skipped: 0 }) });
  assert.equal(store.confirmations.length, 1); assert.equal(store.mail.length, 1); assert.equal(store.sent.length, 1);
  console.log("PASS confirmation at fulfilment: a reconcile-fulfilled pack gets one confirmation and one outbox message, sent at once; a later webhook replay and a second reconcile add nothing");
})().catch(error => { console.error(error); process.exitCode = 1; });
