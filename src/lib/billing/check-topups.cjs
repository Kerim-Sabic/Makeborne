/* eslint-disable @typescript-eslint/no-require-imports -- Offline pure top-up contract and access checks. */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const cache = new Map();
function load(file, overrides = {}) {
  const filename = path.resolve(__dirname, file);
  if (cache.has(filename) && !Object.keys(overrides).length) return cache.get(filename);
  const context = { exports: {}, BigInt, Date, JSON, Number, Intl, Response, process: { env: { WHOP_TOPUPS_ENABLED: "true", MAKEBORNE_CREDIT_LEDGER_VERIFIED: "true" } }, require: name => {
    if (name in overrides) return overrides[name];
    if (name === "server-only") return {};
    if (name.startsWith("@/")) return load(path.resolve(__dirname, "../..", name.slice(2)) + ".ts");
    if (name.startsWith(".")) return load(path.resolve(path.dirname(filename), name) + ".ts");
    return require(name);
  } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  if (!Object.keys(overrides).length) cache.set(filename, context.exports);
  return context.exports;
}
const catalog = load("topups-catalog.ts");
const contracts = load("topups-contracts.ts");
const { reconcileCreditTopup: reconcile } = load("topups-reconcile.ts");
const uuid = "48c9c4c5-4238-4b5a-97ea-27c499e76c82";
const purchase = { id: uuid, requestId: uuid, userId: uuid, creditAccountId: uuid, packId: "boost_100", catalogVersion: catalog.CREDIT_TOPUP_CATALOG_VERSION, credits: "100", priceCents: "1200", currency: "usd", merchantId: "biz_test", planId: "plan_topup", checkoutId: "ch_test", whopUserId: "user_test", createdAt: "2026-10-05T00:00:00.000Z" };
const payment = { id: "pay_test", merchantId: purchase.merchantId, planId: purchase.planId, checkoutId: purchase.checkoutId, whopUserId: purchase.whopUserId, currency: "usd", principalCents: "1200", refundedPrincipalCents: "0", status: "paid", dispute: "none", updatedAt: "2026-10-05T00:01:00.000Z" };
const later = (minute, values = {}) => ({ ...payment, updatedAt: `2026-10-05T00:${String(minute).padStart(2,"0")}:00.000Z`, ...values });
assert.equal(catalog.CREDIT_TOPUP_PACKS.length, 3);
assert.equal(catalog.formatCreditTopupPrice(1200), "$12");
assert.equal(catalog.formatCreditTopupPrice(1299), "$12.99");
assert.equal(contracts.CreditTopupInputSchema.safeParse({ packId: "boost_100", requestId: uuid }).success, true);
for (const extra of [{ priceCents: 1 }, { credits: 100000 }, { userId: uuid }, { planId: "plan_other" }]) assert.equal(contracts.CreditTopupInputSchema.safeParse({ packId: "boost_100", requestId: uuid, ...extra }).success, false);
assert.equal(contracts.CreditTopupInputSchema.safeParse({ packId: "unknown", requestId: uuid }).success, false);
assert.equal(contracts.CreditTopupInputSchema.safeParse({ packId: "boost_100", requestId: "invalid" }).success, false);
assert.throws(() => reconcile({ ...purchase, credits: "9999" }, null, payment));
assert.throws(() => reconcile({ ...purchase, priceCents: "1" }, null, payment));
assert.throws(() => reconcile(purchase, null, { ...payment, refundedPrincipalCents: "1201" }));
assert.throws(() => reconcile(purchase, null, { ...payment, currency: "eur" }));
for (const malformed of ["not a number", "1.5", "-1", "", "01", "9223372036854775808", "9".repeat(30)]) {
  for (const field of ["credits", "priceCents"]) assert.equal(contracts.CreditTopupPurchaseSchema.safeParse({ ...purchase, [field]: malformed }).success, false);
  for (const field of ["principalCents", "refundedPrincipalCents"]) assert.equal(contracts.CreditTopupPaymentSchema.safeParse({ ...payment, [field]: malformed }).success, false);
  for (const field of ["grantedCredits", "reversedCredits"]) assert.equal(contracts.CreditTopupStateSchema.safeParse({ purchaseId: uuid, payment, revision: 0, status: "funded", grantedCredits: "100", reversedCredits: "0", [field]: malformed }).success, false);
}
for (const [key, value] of Object.entries({ merchantId: "biz_other", planId: "plan_other", checkoutId: "ch_other", whopUserId: "user_other", principalCents: "1" })) assert.throws(() => reconcile(purchase, null, { ...payment, [key]: value }), error => error.code === "BINDING_MISMATCH");
const first = reconcile(purchase, null, payment);
assert.equal(first.state.status, "funded");
assert.equal(first.effects[0].kind, "grant");
assert.equal(first.effects[0].credits, "100");
assert.equal(first.effects[0].eventKey, "credit_topup:pay_test:grant");
assert.equal(reconcile(purchase, first.state, payment).outcome, "duplicate");
assert.equal(reconcile(purchase, first.state, { ...payment, updatedAt: "2026-10-05T00:01:00Z" }).outcome, "duplicate");
assert.throws(() => reconcile(purchase, first.state, { ...payment, updatedAt: "2026-10-05T00:01:00Z", dispute: "open" }), error => error.code === "CONFLICTING_EVIDENCE");
assert.equal(reconcile(purchase, first.state, later(0)).outcome, "stale");
assert.throws(() => reconcile(purchase, first.state, { ...payment, dispute: "open" }), error => error.code === "CONFLICTING_EVIDENCE");
assert.throws(() => reconcile(purchase, first.state, later(2, { id: "pay_other" })), error => error.code === "STATE_MISMATCH");
assert.equal(reconcile(purchase, first.state, later(2)).effects.length, 0);
for (const status of ["pending", "failed"]) assert.equal(reconcile(purchase, null, { ...payment, status }).effects.length, 0);
const partial = reconcile(purchase, first.state, later(2, { refundedPrincipalCents: "100" }));
assert.equal(partial.state.status, "held");
assert.equal(partial.needsReview, true);
assert.equal(partial.effects[0].kind, "hold");
assert.throws(() => reconcile(purchase, partial.state, later(3)), error => error.code === "REFUND_REGRESSION");
const refundPayment = later(3, { status: "refunded", refundedPrincipalCents: "1200" });
const refund = reconcile(purchase, partial.state, refundPayment);
assert.equal(refund.state.status, "reversed");
assert.equal(refund.effects[0].kind, "reversal");
assert.equal(refund.effects[0].credits, "100");
assert.equal(refund.effects[1].kind, "release_hold");
assert.equal("credits" in refund.effects[1], false);
assert.equal(reconcile(purchase, refund.state, refundPayment).effects.length, 0);
const refundedFirst = reconcile(purchase, null, refundPayment);
assert.equal(refundedFirst.effects.length, 0);
assert.equal(refundedFirst.state.status, "reversed");
assert.equal(reconcile(purchase, refundedFirst.state, payment).effects.length, 0);
const dispute = reconcile(purchase, first.state, later(2, { dispute: "open" }));
assert.equal(dispute.state.status, "held");
const won = reconcile(purchase, dispute.state, later(3, { dispute: "won" }));
assert.equal(won.state.status, "funded");
assert.equal(won.effects.length, 1);
assert.equal(won.effects[0].kind, "release_hold");
assert.equal("credits" in won.effects[0], false);
const heldBeforeGrant = reconcile(purchase, null, later(2, { dispute: "open" }));
assert.equal(heldBeforeGrant.state.grantedCredits, "0");
assert.equal("credits" in heldBeforeGrant.effects[0], false);
const clearedBeforeGrant = reconcile(purchase, heldBeforeGrant.state, later(3, { dispute: "won" }));
assert.equal(clearedBeforeGrant.effects[0].kind, "grant");
assert.equal(clearedBeforeGrant.effects[0].credits, "100");
assert.equal(clearedBeforeGrant.effects[1].kind, "release_hold");
assert.equal(reconcile(purchase, first.state, later(2, { dispute: "lost" })).state.status, "held");
assert.throws(() => reconcile(purchase, first.state, later(2, { status: "failed" })), error => error.code === "CONFLICTING_EVIDENCE");

async function checkAvailability() {
  for (const [user, eligible] of [[null, false], [{ id: uuid }, false], [{ id: uuid }, true]]) {
    const server = load("topups.ts", { "./access": { billingUser: async () => user, verifyCreationAccess: async () => eligible } });
    const result = await server.creditTopupAvailability();
    assert.equal(result.available, false); // Even with invented enablement flags.
    assert.equal(result.authenticated, Boolean(user));
    assert.equal(result.eligible, eligible);
  }
  const unavailable = load("topups.ts", { "./access": { billingUser: async () => ({ id: uuid }), verifyCreationAccess: async () => { throw new Error("Provider unavailable"); } } });
  const result = await unavailable.creditTopupAvailability();
  assert.equal(result.available, false);
  assert.equal(result.eligible, false);
  class RequestError extends Error { constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; } }
  for (const [authenticated, eligible, payload, status] of [
    [false, false, { packId: "boost_100", requestId: uuid }, 401],
    [true, false, { packId: "boost_100", requestId: uuid }, 402],
    [true, true, { packId: "boost_100", requestId: uuid }, 503],
    [true, true, { packId: "boost_100", requestId: uuid, priceCents: 1 }, 400],
  ]) {
    const route = load("../../app/api/billing/topups/route.ts", {
      "@/lib/billing/access": { requireBillingUser: async () => { if (!authenticated) throw new RequestError("AUTH_REQUIRED", "Sign in", 401); return { id: uuid }; }, requireCreationAccess: async () => { if (!eligible) throw new RequestError("MEMBERSHIP_REQUIRED", "Membership required", 402); } },
      "@/lib/billing/topups": { CREDIT_TOPUPS_NOT_OPEN: "Not yet open", creditTopupAvailability: async () => result },
      "@/lib/server/http": { RequestError, sameOrigin: () => {}, boundedJson: async request => request.json(), apiError: error => Response.json({ code: error.code }, { status: error.status ?? 500 }) },
    });
    const response = await route.POST(new Request("https://makeborne.vercel.app/api/billing/topups", { method: "POST", body: JSON.stringify(payload) }));
    assert.equal(response.status, status);
    if (status === 503) assert.equal((await response.json()).code, "TOPUPS_NOT_OPEN");
  }
  console.log("PASS: proposed catalog, strict purchase inputs, exact amounts, ownership binding, duplicate/stale evidence, grant/refund/dispute transitions, and fail-closed availability. No live services called.");
}
void checkAvailability().catch(error => { console.error(error); process.exitCode = 1; });
