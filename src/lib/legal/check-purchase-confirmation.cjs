/* eslint-disable @typescript-eslint/no-require-imports -- Offline check of the confirmation and withdrawal texts and the notice flow; no database or mail. */
const fs = require("node:fs"), vm = require("node:vm"), ts = require("typescript"), assert = require("node:assert/strict"), path = require("node:path");
const root = path.resolve(__dirname, "../../..");
function load(file, modules = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = { exports: {}, Date, require: name => name === "server-only" ? {} : modules[name] ?? require(name) };
  vm.runInNewContext(output, context);
  return context.exports;
}
class RequestError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
const texts = load("purchase-confirmation.ts");
const versions = load("versions.ts", { "../billing/plans": { WITHDRAWAL_CONSENT_VERSION: "withdrawal-2026-10-26" } });
const withdrawal = load("withdrawal.ts", { "@/lib/server/http": { RequestError }, "./purchase-confirmation": texts });
let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`); };

(async () => {
  const consent = { version: "withdrawal-2026-10-26", termsVersion: "2026-10-25-beta-v9", text: versions.WITHDRAWAL_CONSENT_TEXT, acceptedAt: "2026-10-29T20:03:10Z" };
  const plan = { kind: "plan", name: "Studio", interval: "monthly", credits: 750, amountCents: 4900, currency: "usd", paidAt: "2026-10-29T20:04:00Z", paymentId: "pay_Fixture1", consent, legalVersion: "2026-10-26", billingTermsVersion: "2026-10-25-beta-v9" };

  await check("a plan confirmation carries every Art. 8(7) element, word for word", () => {
    const { subject, body } = texts.composePurchaseConfirmation(plan);
    assert.equal(subject, "Your Makeborne purchase confirmation: Studio plan, monthly");
    for (const needle of ["Studio plan, billed monthly: 750 credits for each month of access", "Amount paid: US$49.00", "29 October 2026, 20:04 UTC", "Whop payment reference: pay_Fixture1",
      "renews monthly at the plan price until you cancel in your Whop account", `"${versions.WITHDRAWAL_CONSENT_TEXT}"`, "version withdrawal-2026-10-26", "within 14 days of the day it was made",
      "https://makeborne.com/withdraw", "lose the right to withdraw once the service has been fully provided", "Model withdrawal form", texts.WITHDRAWAL_STATEMENT_START,
      "Terms of Service, version 2026-10-26: https://makeborne.com/terms", "Subscription, credit and refund terms, version 2026-10-25-beta-v9", texts.STATUTORY_RIGHTS_LINE, texts.SELLER_LINE,
      "fully refundable while none of its credits are used"])
      assert.ok(body.includes(needle), needle);
    assert.ok(body.includes(plan.paymentId) && body.includes(consent.text), "the database requires both quoted");
    assert.doesNotMatch(body, /\bfree\b|\btrial\b/i);
  });

  await check("yearly plans and credit packs describe their own renewal; a missing request means a full refund", () => {
    const yearly = texts.composePurchaseConfirmation({ ...plan, interval: "yearly", amountCents: 47040 });
    assert.match(yearly.body, /billed yearly: 750 credits for each month of access, released month by month/);
    assert.match(yearly.body, /renews yearly/); assert.match(yearly.body, /US\$470\.40/);
    const pack = texts.composePurchaseConfirmation({ ...plan, kind: "pack", name: "Credit pack", interval: null, credits: 300, amountCents: 3200, consent: { ...consent, text: versions.PACK_WITHDRAWAL_CONSENT_TEXT } });
    assert.equal(pack.subject, "Your Makeborne purchase confirmation: credit pack, 300 credits");
    assert.match(pack.body, /300 credits, a one-time payment that does not renew/); assert.doesNotMatch(pack.body, /renews/);
    assert.ok(pack.body.includes(versions.PACK_WITHDRAWAL_CONSENT_TEXT));
    assert.match(pack.body, /supply of the following service: Makeborne credit pack, 300 credits/);
    const none = texts.composePurchaseConfirmation({ ...plan, consent: null });
    assert.match(none.body, /get a full refund: no request to start immediately is on record/);
    assert.doesNotMatch(none.body, /in proportion/);
    assert.match(none.body, /Subscription, credit and refund terms, version 2026-10-25-beta-v9/);
  });

  await check("the acknowledgement template keeps the database's reference and time tokens", () => {
    const ack = texts.composeWithdrawalAcknowledgement({ statement: texts.withdrawalStatement("Makeborne Studio plan, billed monthly"), paymentId: "pay_Fixture1", paymentReference: null, name: "Ana", message: null });
    assert.equal(ack.subject, "We received your withdrawal notice ({{reference}})");
    assert.equal(ack.template.match(/\{\{reference\}\}/g).length, 1); assert.equal(ack.template.match(/\{\{received\}\}/g).length, 1);
    for (const needle of ["Whop payment reference: pay_Fixture1", "Name: Ana", "within 14 days of receiving your notice", "does not decide the refund by itself", texts.STATUTORY_RIGHTS_LINE, "cancel your membership in your Whop account"])
      assert.ok(ack.template.includes(needle), needle);
    assert.equal(texts.withdrawalStatement("  Makeborne   plan  "), `${texts.WITHDRAWAL_STATEMENT_START} Makeborne plan.`);
  });

  const label = id => id === "plan_studio" ? { name: "Studio", interval: "monthly", credits: 750 } : null;
  const payments = [{ paymentId: "pay_Fixture1", kind: "plan", planId: "plan_studio", amountCents: 4900, currency: "usd", paidAt: "2026-10-29T20:04:00Z" },
    { paymentId: "pay_Pack1", kind: "pack", packId: "boost_300", credits: 300, amountCents: 3200, currency: "usd", paidAt: "2026-10-30T09:00:00Z" }];

  await check("the notice names the chosen purchase; signed-out notices need an address and cannot pick a payment", async () => {
    const calls = [];
    const rpc = async (name, args) => { calls.push({ name, args }); return { data: { reference: "WD-0A1B2C3D", receivedAt: "2026-10-31T10:00:00Z", acknowledgement: "queued", paymentId: args.p_payment_id }, error: null }; };
    const user = { id: "user-1", email: "ana@example.test" };
    const result = await withdrawal.submitWithdrawal(rpc, user, { paymentId: "pay_Fixture1", confirm: true }, payments, label);
    assert.equal(calls[0].name, "makeborne_record_withdrawal_request");
    assert.equal(calls[0].args.p_user, "user-1"); assert.equal(calls[0].args.p_email, null); assert.equal(calls[0].args.p_payment_id, "pay_Fixture1");
    assert.match(calls[0].args.p_statement, /supply of the following service: Makeborne Studio plan, billed monthly \(US\$49\.00, ordered on 29 October 2026, Whop payment reference pay_Fixture1\)\.$/);
    assert.ok(calls[0].args.p_ack_template.includes("{{reference}}") && calls[0].args.p_ack_template.includes(calls[0].args.p_statement));
    assert.equal(result.reference, "WD-0A1B2C3D"); assert.equal(result.email, "ana@example.test");
    await assert.rejects(withdrawal.submitWithdrawal(rpc, user, { paymentId: "pay_NotMine", confirm: true }, payments, label), e => e.code === "WITHDRAWAL_PAYMENT" && e.status === 403);
    await assert.rejects(withdrawal.submitWithdrawal(rpc, null, { email: "not-an-email", confirm: true }, [], label), e => e.code === "WITHDRAWAL_EMAIL");
    await assert.rejects(withdrawal.submitWithdrawal(rpc, null, { email: "a@b.example", paymentId: "pay_Fixture1", confirm: true }, [], label), e => e.code === "WITHDRAWAL_SIGN_IN");
    calls.length = 0;
    await withdrawal.submitWithdrawal(rpc, null, { email: "Buyer@Example.test", paymentReference: " pay_Typed1 ", confirm: true }, [], label);
    assert.equal(calls[0].args.p_user, null); assert.equal(calls[0].args.p_payment_reference, "pay_Typed1"); assert.equal(calls[0].args.p_payment_id, null);
    assert.match(calls[0].args.p_statement, /Makeborne purchase with the payment reference pay_Typed1\.$/);
    calls.length = 0;
    await withdrawal.submitWithdrawal(rpc, null, { email: "Buyer@Example.test", confirm: true }, [], label);
    assert.match(calls[0].args.p_statement, /Makeborne purchase on the account buyer@example\.test\.$/);
  });

  await check("database refusals map to clear, honest messages; an unconfirmed save never claims success", async () => {
    const fail = code => async () => ({ data: null, error: { code } });
    const user = { id: "u", email: "a@b.example" };
    await assert.rejects(withdrawal.submitWithdrawal(fail("53400"), user, { confirm: true }, [], label), e => e.status === 429);
    await assert.rejects(withdrawal.submitWithdrawal(fail("42501"), user, { confirm: true }, [], label), e => e.status === 403);
    await assert.rejects(withdrawal.submitWithdrawal(fail("22023"), user, { confirm: true }, [], label), e => e.status === 400);
    await assert.rejects(withdrawal.submitWithdrawal(fail("XX000"), user, { confirm: true }, [], label), e => e.status === 503 && /the date you send it counts/.test(e.message));
    await assert.rejects(withdrawal.submitWithdrawal(async () => ({ data: { reference: 1 }, error: null }), user, { confirm: true }, [], label), e => e.code === "WITHDRAWAL_UNSAVED");
  });

  await check("form input is strict: confirmation required, no unknown fields, bounded lengths", () => {
    assert.equal(withdrawal.withdrawalInput.safeParse({ confirm: true }).success, true);
    assert.equal(withdrawal.withdrawalInput.safeParse({}).success, false);
    assert.equal(withdrawal.withdrawalInput.safeParse({ confirm: true, refund: "now" }).success, false);
    assert.equal(withdrawal.withdrawalInput.safeParse({ confirm: true, paymentId: "pay_bad id" }).success, false);
    assert.equal(withdrawal.withdrawalInput.safeParse({ confirm: true, message: "x".repeat(2001) }).success, false);
  });

  await check("the migration keeps records immutable, service-only and bound to stored evidence", () => {
    const sql = fs.readFileSync(path.join(root, "supabase/migrations/20261028100000_purchase_confirmations.sql"), "utf8");
    assert.match(sql, /payment_id text not null unique/);
    assert.match(sql, /before update on makeborne_private\.purchase_confirmations/); assert.match(sql, /before update on makeborne_private\.withdrawal_requests/);
    assert.match(sql, /position\(p_payment in p_body\) = 0 or \(c->>'consent_text' is not null and position\(c->>'consent_text' in p_body\) = 0\)/);
    assert.match(sql, /d\.paid_at >= p_since/, "never mails purchases made before the feature was switched on");
    assert.match(sql, /lower\(email\) = v_email\) then v_ack := 'queued'/, "signed-out acknowledgements only go to the paying account's address");
    assert.match(sql, />= 5 then\s+raise exception 'Too many withdrawal notices today' using errcode='53400'/);
    assert.doesNotMatch(sql, /refund_cases|makeborne_reconcile|credit_lots|billing_memberships set/i, "no refund, credit or access change");
    for (const fn of [...sql.matchAll(/create function (public\.[a-z_]+)\(/g)].map(m => m[1])) {
      const body = sql.slice(sql.indexOf(`create function ${fn}(`)); assert.match(body.slice(0, body.indexOf("$$;") + 3), /security invoker/, `${fn} must be SECURITY INVOKER`);
    }
    assert.doesNotMatch(sql, /grant [a-z, ]+ on [^;]* to (anon|authenticated)/i);
    assert.match(sql, /revoke all on makeborne_private\.purchase_confirmations, makeborne_private\.withdrawal_requests, makeborne_private\.transactional_mail\s+from public, anon, authenticated, service_role/);
  });

  console.log(`purchase confirmation and withdrawal: ${passed} checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
