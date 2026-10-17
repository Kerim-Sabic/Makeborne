/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for client care plans: validation, money and date formatting, portal and studio wiring. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const src = path.join(__dirname, "..", "..");
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name.startsWith("@/")) return load.call(this, path.join(src, `${name.slice(2)}.ts`), parent, main);
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
globalThis.fetch = async () => { throw new Error("Network forbidden"); };
const read = file => fs.readFileSync(path.join(src, "..", file), "utf8");
const care = require("./care.ts");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }

check("payment links: full https addresses only, same rule as the database", () => {
  for (const ok of ["https://buy.stripe.com/test_abc123", "https://www.paypal.com/paypalme/agency/49", "https://whop.com/checkout/plan_x?d=1&e=2", "https://pay.example.com:8443/inv/7#top"])
    assert.ok(care.PAYMENT_LINK.test(ok), ok);
  for (const bad of ["javascript:alert(1)", "http://pay.example.com", "https://user:pw@pay.example.com", "https://pay.example.com/a b", "https://pay.example.com/\"x", "//pay.example.com",
    "https://", "https://pay.example.com\\x", "data:text/html,x", "https://pay.example.com/<script>"]) assert.ok(!care.PAYMENT_LINK.test(bad), bad);
  const sql = read("supabase/migrations/20261018090000_client_care_plans.sql");
  assert.ok(sql.includes("^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]<>\"''`\\\\]*)?$"), "the database uses the same pattern");
});

check("plan updates: price needs its currency, labels are plain text, dates are calendar days", () => {
  const base = { label: "Website care", amountCents: 4900, currency: "eur", interval: "month", paymentUrl: "https://buy.stripe.com/x", paidThrough: "2026-11-30", active: true };
  assert.equal(care.CarePlanUpdateSchema.parse(base).currency, "EUR");
  assert.ok(care.CarePlanUpdateSchema.safeParse({ ...base, amountCents: null, currency: null }).success);
  for (const bad of [{ currency: null }, { amountCents: null }, { label: "<b>x</b>" }, { label: "" }, { interval: "week" }, { paidThrough: "30/11/2026" }, { paymentUrl: "http://x.com" }, { more: 1 }])
    assert.equal(care.CarePlanUpdateSchema.safeParse({ ...base, ...bad }).success, false, JSON.stringify(bad));
  assert.equal(care.CarePaymentCreateSchema.parse({}).note, "");
  assert.equal(care.CarePaymentCreateSchema.safeParse({ note: "<img>" }).success, false);
});

check("money, prices and days format for people", () => {
  assert.equal(care.parseAmount("49"), 4900); assert.equal(care.parseAmount("49,9"), 4990); assert.equal(care.parseAmount(" 0.05 "), 5);
  assert.equal(care.parseAmount(""), null); assert.equal(care.parseAmount("4.999"), undefined); assert.equal(care.parseAmount("-1"), undefined); assert.equal(care.parseAmount("1e3"), undefined);
  assert.equal(care.formatMoney(4900, "EUR", "en-IE"), "€49.00");
  assert.equal(care.formatMoney(null, null), "");
  assert.equal(care.formatPrice({ amountCents: 12000, currency: "USD", interval: "year" }, "en-US"), "$120.00 / year");
  assert.equal(care.formatPrice({ amountCents: null, currency: null, interval: "month" }), "");
  assert.equal(care.formatDay("2026-10-31", "en-GB"), "31 Oct 2026", "calendar day, never shifted by the time zone");
  assert.equal(care.formatDay(undefined), "");
});

check("portal: paused care plans make the editor read-only; Pay opens the agency's link safely; studio mounts the panel", () => {
  const editor = read("src/components/portal/portal-site-editor.tsx");
  assert.match(editor, /const paused = site\.billing\?\.status === "paused";/);
  assert.match(editor, /<fieldset disabled=\{pending \|\| paused \|\| busy\}>/);
  assert.match(editor, /if \(!edited\.current \|\| pending \|\| paused\) return;/, "no autosave while paused");
  assert.match(editor, /\{!pending && !paused && <div className="pe-actions">/, "no Send while paused");
  assert.match(editor, /<BillingNotice billing=\{site\.billing\} agency=\{agency\} \/>/);
  assert.match(read("src/components/portal/portal-home.tsx"), /<BillingNotice billing=\{grant\.billing\} agency=\{grant\.agency\.name\} \/>/);
  const notice = read("src/components/portal/portal-billing.tsx");
  assert.match(notice, /href=\{billing\.paymentUrl\} target="_blank" rel="noopener noreferrer"/);
  assert.match(read("src/components/account-clients.tsx"), /\{view === "brand" && <CarePlanPanel /);
  assert.match(read("src/components/care-plan-panel.tsx"), /headers: \{ "Idempotency-Key": key \}/, "a double click records one payment");
  assert.match(read("src/lib/portal/server.ts"), /code === "PB402"\) throw new RequestError\("PAYMENT_DUE"/);
});

console.log(`\n${passed} care plan checks passed.`);
