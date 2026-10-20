/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for the automatic top-up panel's display rules (audit: revoke reachable, saved vs active, uncertain outcomes). No charging exists. Mounted journey: scripts/check-autotopup-panel-browser.cjs. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { postOutcome, panelHeading, offerChanged, reconcile } = require("./autotopup-panel.ts");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const offer = (extra = {}) => ({ chargingEnabled: false, termsVersion: "v1", credits: 100, priceCents: 1200, maxMonthlyCharges: 6, maxDailyCharges: 2, thresholds: [25, 50, 100], ...extra });
const authorization = (extra = {}) => ({ id: 7, termsVersion: "v1", credits: 100, priceCents: 1200, thresholdCredits: 50, monthlyLimitCharges: 4, dailyLimitCharges: 2, authorizedAt: "2026-10-20T10:00:00.000Z", ...extra });
const status = (o, a) => ({ offer: o, authorization: a, attempts: [] });

check("only a status body or an explicit refusal is a definite outcome", () => {
  const body = status(offer(), null);
  assert.deepEqual(postOutcome(true, 200, body), { kind: "saved", status: body });
  assert.deepEqual(postOutcome(true, 200, null), { kind: "uncertain" }, "unparseable success is not 'nothing changed'");
  assert.deepEqual(postOutcome(true, 200, { ok: true }), { kind: "uncertain" });
  assert.deepEqual(postOutcome(false, 409, { error: { message: "The offer changed." } }), { kind: "rejected", message: "The offer changed." });
  assert.deepEqual(postOutcome(false, 400, { error: { message: "Review the details." } }).kind, "rejected");
  for (const code of [500, 502, 503, 504, 408]) assert.deepEqual(postOutcome(false, code, { error: { message: "Unavailable" } }), { kind: "uncertain" }, String(code));
  assert.deepEqual(postOutcome(false, 400, null), { kind: "uncertain" }, "a refusal without a message is not trusted");
});

check("saved consent is not called active charging", () => {
  assert.equal(panelHeading(status(offer(), null)), "Automatic top-ups");
  assert.equal(panelHeading(status(offer(), authorization())), "Automatic top-ups: authorization saved");
  assert.equal(panelHeading(status(offer({ chargingEnabled: true }), authorization())), "Automatic top-ups are on");
});

check("an authorization differs from the offer when price, terms or availability changed", () => {
  assert.equal(offerChanged(status(offer(), authorization())), false);
  assert.equal(offerChanged(status(offer({ priceCents: null }), authorization())), true, "withdrawn price");
  assert.equal(offerChanged(status(offer({ priceCents: 1500 }), authorization())), true);
  assert.equal(offerChanged(status(offer({ termsVersion: "v2" }), authorization())), true);
  assert.equal(offerChanged(status(offer({ priceCents: null }), null)), false, "nothing to compare without an authorization");
});

check("an unknown result is decided by the server's status", () => {
  const before = status(offer(), authorization());
  assert.deepEqual(reconcile("disable", before, status(offer(), null), null).saved, true);
  assert.match(reconcile("disable", before, before, null).message, /still saved/);
  const choice = { termsVersion: "v2", priceCents: 1500, threshold: 25, monthlyLimit: 2 };
  const replaced = status(offer({ termsVersion: "v2", priceCents: 1500 }), authorization({ id: 8, termsVersion: "v2", priceCents: 1500, thresholdCredits: 25, monthlyLimitCharges: 2 }));
  assert.equal(reconcile("enable", before, replaced, choice).saved, true);
  assert.equal(reconcile("enable", before, before, choice).saved, false, "the old authorization is not the new one");
  assert.equal(reconcile("enable", status(offer(), null), status(offer(), authorization({ id: 9, thresholdCredits: 100 })), { termsVersion: "v1", priceCents: 1200, threshold: 50, monthlyLimit: 4 }).saved, false, "different choices were saved: not ours");
  assert.equal(reconcile("enable", status(offer(), null), status(offer(), null), null).saved, false);
});

check("the panel keeps revoke independent of the offer and has no 'Nothing was changed' guess", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "components", "billing-autotopup.tsx"), "utf8");
  assert.ok(!source.includes("Nothing was changed"));
  assert.ok(!/if \(offer\.priceCents === null\) return/.test(source), "no early return before the authorization");
  assert.ok(source.includes('onClick={() => void submit("disable")}'));
  assert.ok(source.includes("confirmed: true") && source.includes("I authorize these automatic charges"), "explicit consent is preserved");
});

console.log(`\n${passed} automatic top-up panel checks passed.`);
