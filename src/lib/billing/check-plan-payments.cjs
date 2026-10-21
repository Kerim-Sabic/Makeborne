/* eslint-disable @typescript-eslint/no-require-imports -- Offline subscription payment evidence and refund-ordering checks. */
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), ts = require("typescript");
class RequestError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
function load(file, modules) {
  const output = ts.transpileModule(fs.readFileSync(require.resolve(file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {}, Buffer, Date, URL, process: { env: { MAKEBORNE_BILLING_MIGRATIONS_VERIFIED: "true" } }, require: name => name === "server-only" ? {} : modules[name] ?? require(name) };
  vm.runInNewContext(output, context);
  return context.exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
const whopTime = value => { const ms = typeof value === "number" ? value * 1000 : Date.parse(value); return Number.isFinite(ms) ? new Date(ms).toISOString() : null; };
let providerBody = null; const rpcCalls = []; let rpcError = null;
const payments = load("./plan-payments.ts", {
  "@/lib/server/http": { RequestError }, "./config": { billingConfig: () => ({ companyId: "biz_fixture" }) },
  "./database": { billingDatabase: () => ({ rpc: async (name, args) => { rpcCalls.push({ name, args: plain(args) }); return rpcError ? { data: null, error: rpcError } : { data: { outcome: "updated", state: "reversed" }, error: null }; } }) },
  "./whop": { whopGet: async () => providerBody, whopTime },
});
// Shape of the real sandbox subscription payment after a full dashboard refund (2026-10-19 observation):
// status stays "paid", substatus "refunded", total 29, refunded 29, billing_reason subscription_create.
const refunded = { id: "pay_ynelkmZIkiTzqO", company: { id: "biz_fixture" }, plan: { id: "plan_00mHHGVMtYzRL" }, membership: { id: "mem_PVCq7nFvMrnKhQ" },
  billing_reason: "subscription_create", currency: "usd", status: "paid", substatus: "refunded", total: 29, refunded_amount: 29, disputes: [],
  paid_at: "2026-10-19T13:33:08.497Z", updated_at: "2026-10-19T13:38:24.873Z" };
const PE = error => error.code === "PLAN_PAYMENT_UNVERIFIED";
(async () => {
  const full = payments.normalizeWhopPlanPayment(refunded);
  assert.deepEqual(plain(full), { id: "pay_ynelkmZIkiTzqO", membershipId: "mem_PVCq7nFvMrnKhQ", planId: "plan_00mHHGVMtYzRL", billingReason: "subscription_create",
    currency: "usd", principalCents: "2900", paidAt: "2026-10-19T13:33:08.497Z", updatedAt: "2026-10-19T13:38:24.873Z", refundedPrincipalCents: "2900", status: "refunded", dispute: "none" });
  const paid = payments.normalizeWhopPlanPayment({ ...refunded, substatus: "succeeded", refunded_amount: 0 });
  assert.equal(paid.status, "paid"); assert.equal(paid.refundedPrincipalCents, "0");
  const partial = payments.normalizeWhopPlanPayment({ ...refunded, substatus: "partially_refunded", refunded_amount: "10.50" });
  assert.equal(partial.status, "paid"); assert.equal(partial.refundedPrincipalCents, "1050");
  // Full refund follows the substatus even when the refunded amount excludes tax.
  assert.equal(payments.normalizeWhopPlanPayment({ ...refunded, total: "31.32", refunded_amount: 29 }).refundedPrincipalCents, "3132");
  assert.equal(payments.normalizeWhopPlanPayment({ ...refunded, substatus: "dispute_needs_response", refunded_amount: 0 }).dispute, "open");
  assert.equal(payments.normalizeWhopPlanPayment({ ...refunded, substatus: "dispute_lost", refunded_amount: 0 }).dispute, "lost");
  assert.equal(payments.normalizeWhopPlanPayment({ ...refunded, substatus: "dispute_won", refunded_amount: 0 }).dispute, "won");
  assert.equal(payments.normalizeWhopPlanPayment({ ...refunded, substatus: "succeeded", refunded_amount: 0, disputes: [{ status: "under_review" }] }).dispute, "open");
  const failed = payments.normalizeWhopPlanPayment({ ...refunded, status: "open", substatus: "failed", refunded_amount: 0, paid_at: null });
  assert.equal(failed.status, "failed"); assert.equal(failed.refundedPrincipalCents, "0");
  assert.equal(payments.normalizeWhopPlanPayment({ ...refunded, total: 0, substatus: "succeeded", refunded_amount: 0 }).principalCents, "0", "$0 trial payment is recorded, not refundable");
  for (const bad of [{ substatus: "partially_refunded", refunded_amount: 29 }, { substatus: "partially_refunded", refunded_amount: 0 }, { substatus: "succeeded", refunded_amount: 5 },
    { substatus: "mystery_state" }, { total: "29.001" }, { total: 0, substatus: "refunded" }, { paid_at: null }, { disputes: [{ status: "unknown" }] },
    { membership: null }, { company: { id: "evil" } }, { updated_at: "yesterday" }])
    assert.throws(() => payments.normalizeWhopPlanPayment({ ...refunded, ...bad }), PE, JSON.stringify(bad));

  assert.equal(payments.eventPaymentId({ type: "payment.succeeded", data: { id: "pay_abc" } }), "pay_abc");
  for (const type of ["refund.created", "refund.updated", "dispute.created", "dispute.updated"]) assert.equal(payments.eventPaymentId({ type, data: { payment: { id: "pay_abc" } } }), "pay_abc");
  assert.equal(payments.eventPaymentId({ type: "refund.created", data: { payment: { id: "../bad" } } }), null);
  assert.equal(payments.eventPaymentId({ type: "membership.activated", data: { id: "mem_x" } }), null);

  providerBody = refunded;
  assert.equal((await payments.retrieveVerifiedPlanPayment("pay_ynelkmZIkiTzqO")).status, "refunded");
  await assert.rejects(payments.retrieveVerifiedPlanPayment("pay_other"), PE, "retrieved payment must be the requested one");
  providerBody = { ...refunded, company: { id: "biz_other" } };
  await assert.rejects(payments.retrieveVerifiedPlanPayment("pay_ynelkmZIkiTzqO"), error => error.code === "WRONG_MERCHANT");

  const membership = { id: "mem_PVCq7nFvMrnKhQ", renewal_period_start: "2026-10-19T13:33:07.177Z", renewal_period_end: "2026-11-18T13:33:07.177Z" };
  await payments.reconcilePlanPayment("account_fixture", membership, full);
  assert.deepEqual(rpcCalls.at(-1), { name: "makeborne_reconcile_plan_payment", args: { p_user: "account_fixture", p_membership: "mem_PVCq7nFvMrnKhQ", p_payment: plain(full),
    p_period_start: membership.renewal_period_start, p_period_end: membership.renewal_period_end } });
  await payments.reconcilePlanPayment("account_fixture", { ...membership, renewal_period_start: null }, full);
  assert.equal(rpcCalls.at(-1).args.p_period_start, null, "no period hint without a valid live period");
  await assert.rejects(payments.reconcilePlanPayment("account_fixture", { ...membership, id: "mem_other" }, full), PE);
  rpcError = { code: "PT409" };
  await assert.rejects(payments.reconcilePlanPayment("account_fixture", membership, full), error => error.code === "PLAN_PAYMENT_STORAGE_UNAVAILABLE" && error.status === 503);
  console.log("PASS plan payments: real refunded-subscription shape, partial/tax/dispute/unpaid mapping, strict refusal of inconsistent evidence, event payment ids, merchant check, reconcile RPC with live period hints, retryable storage failure");
})().catch(error => { console.error(error); process.exitCode = 1; });
