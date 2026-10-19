/* eslint-disable @typescript-eslint/no-require-imports -- Offline automatic top-up authorization checks (no charging exists). */
const assert = require("node:assert/strict"), crypto = require("node:crypto"), fs = require("node:fs"), vm = require("node:vm"), ts = require("typescript");
class RequestError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
function load(file, modules, env) {
  const output = ts.transpileModule(fs.readFileSync(require.resolve(file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {}, Buffer, Intl, process: { env }, require: name => name === "server-only" ? {} : modules[name] ?? require(name) };
  vm.runInNewContext(output, context);
  return context.exports;
}
const plans = load("./plans.ts", {}, {});
const consent = load("./autotopup-consent.ts", { "./plans": plans }, {});
const offer = { termsVersion: "autotopup-2026-10-20-v1", credits: 100 };
const text = consent.autotopupConsentText(offer, 1200, 50, 4);
assert.equal(text, "When my available Makeborne credits fall below 50, Makeborne may charge my payment method saved with Whop $12 for 100 credits, up to 4 times per calendar month and at most 2 times a day (at most $48 a month). Each top-up is a separate credit-pack payment and its credits do not expire. I can turn automatic top-ups off at any time in Billing, which stops future charges; a top-up already sent to Whop completes or fails normally, and its credits are added only if it succeeds. A top-up is refundable while none of its credits have been used. Terms version autotopup-2026-10-20-v1.");
assert.match(consent.autotopupConsentText(offer, 1250, 25, 1, 1), /\$12\.50 for 100 credits, once per calendar month and at most once a day \(at most \$12\.50 a month\)/);
const env = {}; const calls = []; let failure = null;
const db = { rpc: async (name, args) => {
  calls.push({ name, args: JSON.parse(JSON.stringify(args)) });
  if (name === "makeborne_autotopup_status") return { data: { offer: { maxDailyCharges: 2 }, authorization: null, attempts: [] }, error: null };
  return failure ? { data: null, error: failure } : { data: { offer: {}, authorization: null, attempts: [] }, error: null }; } };
const server = load("./autotopup.ts", { "@/lib/server/http": { RequestError }, "./autotopup-consent": consent, "./database": { billingDatabase: () => db } }, env);
(async () => {
  await assert.rejects(server.autotopupStatus("account"), error => error.code === "AUTOTOPUP_NOT_AVAILABLE" && error.status === 404, "setup is hidden unless flagged");
  assert.equal(calls.length, 0);
  env.MAKEBORNE_AUTOTOPUP_SETUP_ENABLED = "true";
  await server.authorizeAutotopup("account", { termsVersion: offer.termsVersion, priceCents: 1200, threshold: 50, monthlyLimit: 4 });
  assert.deepEqual(calls.at(-1), { name: "makeborne_autotopup_authorize", args: { p_user: "account", p_terms_version: offer.termsVersion, p_price_cents: 1200, p_threshold: 50,
    p_monthly_limit: 4, p_consent_sha256: crypto.createHash("sha256").update(text, "utf8").digest("hex") } }, "the stored hash is of the exact text shown");
  for (const [code, expected] of [["PT503", "AUTOTOPUP_PRICE_PENDING"], ["PT409", "AUTOTOPUP_OFFER_CHANGED"], ["22023", "AUTOTOPUP_INVALID_CHOICE"], ["XX000", "AUTOTOPUP_UNAVAILABLE"]]) {
    failure = { code };
    await assert.rejects(server.authorizeAutotopup("account", { termsVersion: offer.termsVersion, priceCents: 1200, threshold: 50, monthlyLimit: 4 }), error => error.code === expected);
  }
  failure = null;
  await server.revokeAutotopup("account");
  assert.equal(calls.at(-1).name, "makeborne_autotopup_revoke");
  assert.ok(!fs.readFileSync(require.resolve("./autotopup.ts"), "utf8").includes("whop"), "no provider call exists in the setup module");
  console.log("PASS auto top-up setup: hidden without the flag, exact consent text and hash, offer-change/price-pending refusals mapped, revoke; no charging path");
})().catch(error => { console.error(error); process.exitCode = 1; });
