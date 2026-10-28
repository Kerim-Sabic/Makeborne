/* eslint-disable @typescript-eslint/no-require-imports -- Offline check of confirmation creation and the outbox drain; the database and mail are faked. */
const fs = require("node:fs"), vm = require("node:vm"), ts = require("typescript"), assert = require("node:assert/strict"), path = require("node:path");
const transpile = file => ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function load(file, modules) {
  const context = { exports: {}, Date, JSON, console: { info() {}, warn() {} }, process: { env: {} }, require: name => name === "server-only" ? {} : modules[name] ?? require(name) };
  vm.runInNewContext(transpile(file), context);
  return context.exports;
}
const texts = load(path.join(__dirname, "../legal/purchase-confirmation.ts"), {});
const mod = load(path.join(__dirname, "purchase-confirmations.ts"), {
  "@/lib/legal/purchase-confirmation": texts, "@/lib/legal/versions": { LEGAL_VERSION: "2026-10-26" },
  "@/lib/mail/transactional": { sendTransactionalMail: async () => ({ ok: false, code: "UNUSED", retry: true }), transactionalMailEnabled: () => false },
  "./plans": { BILLING_TERMS_VERSION: "terms-v9", CREATION_PLANS: [] }, "./plan-credits": { creditRuleFor: () => null },
  "./database": { billingDatabase: () => { throw new Error("no database in this check"); } },
});
const consentText = "I want my plan to start immediately. I understand that if I withdraw within 14 days, I’ll pay for the credits I’ve used, and that I lose my right to withdraw once the service has been fully provided.";
const candidates = [
  { kind: "plan", payment_id: "pay_Plan1", plan_id: "plan_studio", pack_id: null, credits: null, amount_cents: 4900, currency: "usd", paid_at: "2026-10-29T20:04:00Z",
    consent_version: "withdrawal-2026-10-26", terms_version: "terms-v9", consent_text: consentText, consent_accepted_at: "2026-10-29T20:03:00Z" },
  { kind: "pack", payment_id: "pay_Pack1", plan_id: "plan_pack", pack_id: "boost_300", credits: 300, amount_cents: 3200, currency: "usd", paid_at: "2026-10-30T09:00:00Z",
    consent_version: null, terms_version: null, consent_text: null, consent_accepted_at: null },
  { kind: "plan", payment_id: "pay_Unknown", plan_id: "plan_unknown", pack_id: null, credits: null, amount_cents: 2000, currency: "usd", paid_at: "2026-10-30T10:00:00Z",
    consent_version: null, terms_version: null, consent_text: null, consent_accepted_at: null },
];
function fakeDb(options = {}) {
  const calls = [], results = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (name === "makeborne_purchase_confirmation_candidates")
      return options.candidatesError ? { data: null, error: { code: "XX000" } } : { data: candidates.filter(c => !args.p_payment || c.payment_id === args.p_payment), error: null };
    if (name === "makeborne_record_purchase_confirmation")
      return options.recordFails === args.p_payment ? { data: null, error: { code: "22023" } } : { data: `conf-${args.p_payment}`, error: null };
    if (name === "makeborne_transactional_mail_claim") return { data: options.claimed ?? [], error: null };
    if (name === "makeborne_transactional_mail_result") { results.push(args); return { data: "sent", error: options.resultError ? { code: "XX000" } : null }; }
    throw new Error(`unexpected ${name}`);
  };
  return { rpc, calls, results };
}
const label = id => id === "plan_studio" ? { name: "Studio", interval: "monthly", credits: 750 } : null;
const deps = (db, extra = {}) => ({ rpc: db.rpc, since: "2026-10-29T20:00:00.000Z", planLabel: label, mailEnabled: false, send: async () => ({ ok: true, id: "email_1" }), ...extra });
let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`); };

(async () => {
  await check("off without MAKEBORNE_PURCHASE_CONFIRMATIONS_SINCE: no database call at all", async () => {
    const db = fakeDb();
    const result = await mod.ensurePurchaseConfirmations(deps(db, { since: null }));
    assert.equal(result.enabled, false); assert.equal(db.calls.length, 0);
    assert.equal(mod.confirmationsSince(undefined), null); assert.equal(mod.confirmationsSince("tomorrow"), null); assert.equal(mod.confirmationsSince(""), null);
    assert.equal(mod.confirmationsSince("2026-10-29T20:00:00Z"), "2026-10-29T20:00:00.000Z");
  });

  await check("each due payment gets one record with the composed text; unknown plans are skipped, not guessed", async () => {
    const db = fakeDb();
    const result = await mod.ensurePurchaseConfirmations(deps(db));
    assert.equal(result.created, 2); assert.equal(result.skipped, 1); assert.equal(result.failed, 0);
    const [candidatesCall, planRecord, packRecord] = db.calls;
    assert.equal(candidatesCall.args.p_since, "2026-10-29T20:00:00.000Z");
    assert.equal(planRecord.args.p_payment, "pay_Plan1"); assert.equal(planRecord.args.p_product, "Studio plan");
    assert.equal(planRecord.args.p_interval, "monthly"); assert.equal(planRecord.args.p_credits, 750);
    assert.ok(planRecord.args.p_body.includes("pay_Plan1") && planRecord.args.p_body.includes(`"${consentText}"`), "quotes what the database checks");
    assert.equal(packRecord.args.p_interval, null); assert.equal(packRecord.args.p_credits, 300);
    assert.match(packRecord.args.p_body, /no request to start immediately is on record/);
    assert.ok(!db.calls.some(call => call.name === "makeborne_record_purchase_confirmation" && call.args.p_payment === "pay_Unknown"));
  });

  await check("a failed record is counted and the rest continue; unavailable candidates fail softly", async () => {
    const result = await mod.ensurePurchaseConfirmations(deps(fakeDb({ recordFails: "pay_Plan1" })));
    assert.equal(result.failed, 1); assert.equal(result.created, 1);
    const down = await mod.ensurePurchaseConfirmations(deps(fakeDb({ candidatesError: true })));
    assert.equal(down.failed, 1); assert.equal(down.created, 0);
  });

  await check("mail off claims nothing, so every row waits in the outbox", async () => {
    const db = fakeDb({ claimed: [{ id: "m1" }] });
    const result = await mod.drainTransactionalMail(deps(db));
    assert.equal(result.enabled, false); assert.equal(db.calls.length, 0);
  });

  await check("mail on: each claimed row is sent with its idempotency key and its result recorded; permanent refusals end retries", async () => {
    const claimed = [
      { id: "m1", recipient: "a@b.example", subject: "S1", body: "B1", idempotency_key: "purchase-confirmation:pay_Plan1", attempts: 1 },
      { id: "m2", recipient: "c@d.example", subject: "S2", body: "B2", idempotency_key: "withdrawal-ack:w1", attempts: 1 },
      { id: "m3", recipient: "e@f.example", subject: "S3", body: "B3", idempotency_key: "withdrawal-ack:w2", attempts: 3 },
      { id: "m4", recipient: "g@h.example", subject: "S4", body: "B4", idempotency_key: "withdrawal-ack:w3", attempts: 1 }];
    const db = fakeDb({ claimed });
    const sent = [];
    const send = async mail => {
      sent.push(mail);
      if (mail.idempotencyKey.endsWith("w1")) return { ok: false, code: "MAIL_RATE_LIMITED", retry: true };
      if (mail.idempotencyKey.endsWith("w2")) return { ok: false, code: "MAIL_HTTP_422", retry: false };
      if (mail.idempotencyKey.endsWith("w3")) throw new Error("boom");
      return { ok: true, id: "email_1" };
    };
    const result = await mod.drainTransactionalMail(deps(db, { mailEnabled: true, send }));
    assert.equal(result.claimed, 4); assert.equal(result.sent, 1); assert.equal(result.failed, 3);
    assert.deepEqual(sent.map(m => m.idempotencyKey), claimed.map(c => c.idempotency_key));
    assert.deepEqual({ ...db.results[0] }, { p_id: "m1", p_sent: true, p_provider_id: "email_1", p_error: null, p_final: false });
    assert.deepEqual({ ...db.results[1] }, { p_id: "m2", p_sent: false, p_provider_id: null, p_error: "MAIL_RATE_LIMITED", p_final: false });
    assert.deepEqual({ ...db.results[2] }, { p_id: "m3", p_sent: false, p_provider_id: null, p_error: "MAIL_HTTP_422", p_final: true });
    assert.equal(db.results[3].p_error, "MAIL_EXCEPTION");
    const unrecorded = await mod.drainTransactionalMail(deps(fakeDb({ claimed: claimed.slice(0, 1), resultError: true }), { mailEnabled: true, send: async () => ({ ok: true, id: "x" }) }));
    assert.equal(unrecorded.sent, 1, "an unrecorded result is logged; the lease and idempotency key stop a duplicate");
  });

  await check("after fulfilment: confirms just that payment, sends only when a record was made, and never throws", async () => {
    const db = fakeDb();
    await mod.confirmAfterFulfillment("pay_Pack1", deps(db, { mailEnabled: true }));
    assert.equal(db.calls[0].args.p_payment, "pay_Pack1"); assert.equal(db.calls[0].args.p_limit, 1);
    assert.ok(db.calls.some(call => call.name === "makeborne_transactional_mail_claim"));
    const quiet = fakeDb();
    await mod.confirmAfterFulfillment("pay_Unknown", deps(quiet, { mailEnabled: true }));
    assert.ok(!quiet.calls.some(call => call.name === "makeborne_transactional_mail_claim"), "nothing new, nothing to send");
    await mod.confirmAfterFulfillment(null, deps(fakeDb()));
    await mod.confirmAfterFulfillment("pay_Plan1", { ...deps(fakeDb()), rpc: async () => { throw Object.assign(new Error("down"), { code: "NET" }); } });
    const off = fakeDb();
    await mod.confirmAfterFulfillment("pay_Plan1", deps(off, { since: null }));
    assert.equal(off.calls.length, 0);
  });

  await check("the daily sweep runs both steps and reports instead of throwing", async () => {
    const result = await mod.runConfirmationSweep(deps(fakeDb()));
    assert.equal(result.confirmations.created, 2); assert.equal(result.mail.enabled, false);
    const failed = await mod.runConfirmationSweep({ ...deps(fakeDb()), rpc: async () => { throw Object.assign(new Error("x"), { code: "DOWN" }); } });
    assert.equal(failed.error, "DOWN");
  });

  console.log(`purchase confirmations: ${passed} checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
