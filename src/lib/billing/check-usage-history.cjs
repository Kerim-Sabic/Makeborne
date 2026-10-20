/* eslint-disable @typescript-eslint/no-require-imports -- Offline TypeScript fixture runner. */
// Usage history (audit F08), offline. The fixture is the real read result of
// supabase/check-usage-history.sql captured on a disposable local database
// (rolled back; fictional data). No database, account or payment is touched here.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const usage = require("./usage-history.ts");
const view = require("./view.ts");
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/usage-history/local-rpc.json"), "utf8"));
const root = path.join(__dirname, "../../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
const quiet = fn => { const original = console.error; console.error = () => {}; try { return fn(); } finally { console.error = original; } };
const clone = value => JSON.parse(JSON.stringify(value));

const now = new Date(Date.parse(fixture.full.generatedAt));
const period = usage.usagePeriod(fixture.period.start.slice(0, 7), now);
const full = usage.usageHistoryView(fixture.full, period, null);
const first = usage.usageHistoryView(fixture.firstPage, period, null);
const firstCursor = first.status === "ready" ? usage.decodeUsageCursor(first.history.olderCursor) : null;
const second = usage.usageHistoryView(fixture.secondPage, period, firstCursor);
const byProject = name => full.entries.filter(entry => entry.project === name);
const credits = entries => entries.reduce((sum, entry) => sum + BigInt(entry.credits), 0n);

// Periods and cursors
check("period is one UTC calendar month", () => assert.deepEqual(usage.usagePeriod("2026-10", now), { key: "2026-10", start: "2026-10-01T00:00:00.000Z", end: "2026-11-01T00:00:00.000Z", label: "October 2026 (UTC)" }));
check("future, early and malformed months fall back to the current month", () => {
  for (const input of ["2026-11", "2026-09", "2026-13", "26-10", ["2026-10"], undefined, "2026-10 "]) assert.equal(usage.usagePeriod(input, now).key, "2026-10", String(input));
});
check("year rollover", () => assert.equal(usage.usagePeriod("2026-12", new Date("2027-01-05T00:00:00Z")).end, "2027-01-01T00:00:00.000Z"));
check("month navigation stops at the first and current month", () => {
  assert.deepEqual(usage.adjacentUsagePeriods("2026-10", now), { previous: null, next: null });
  assert.deepEqual(usage.adjacentUsagePeriods("2026-11", new Date("2026-12-02T00:00:00Z")), { previous: "2026-10", next: "2026-12" });
});
check("cursor round-trips the exact database instant and id", () => {
  const last = fixture.firstPage.entries.at(-1);
  const encoded = usage.encodeUsageCursor({ at: last.occurredAt, id: last.id });
  assert.match(encoded, /^[0-9TZ~a-z-]+$/, "URL-safe without escaping");
  assert.deepEqual(usage.decodeUsageCursor(encoded), { at: last.occurredAt, id: last.id });
});
check("tampered cursors are ignored", () => {
  for (const input of ["operation:1", "20261020T115824993925Z~mystery-abc", "20261020T115824Z~hold-" + "a".repeat(32), "x".repeat(200), 7, null]) assert.equal(usage.decodeUsageCursor(input), null, String(input));
});

// The captured read, mapped
check("complete month is ready with authoritative totals", () => {
  assert.equal(full.status, "ready");
  assert.equal(full.available, fixture.authoritative.walletAvailable);
  assert.equal(full.reserved, fixture.authoritative.walletReserved);
  assert.equal(full.used, "54");
  assert.deepEqual(full.history, { periodKey: "2026-10", total: 11, newer: 0, olderCursor: null });
  assert.equal(full.entries.length, 11);
});
check("RECONCILE: Charged rows sum to the period's used, the settled reservations and the spent lots", () => {
  const charged = credits(full.entries.filter(entry => entry.status === "Charged"));
  assert.equal(charged, BigInt(full.used));
  assert.equal(charged, BigInt(fixture.authoritative.settledReservationCharges));
  assert.equal(charged, BigInt(fixture.authoritative.lotSpent));
});
check("RECONCILE: reversals stay separate rows and never net into used", () => {
  const count = status => full.entries.filter(entry => entry.status === status).length;
  assert.deepEqual(["Charged", "Released", "Reserved", "Refunded", "Withheld", "Restored"].map(count), [4, 2, 1, 1, 2, 1]);
  assert.equal(credits(full.entries.filter(entry => entry.status === "Refunded")), 6n);
  assert.equal(credits(full.entries.filter(entry => entry.status === "Withheld")), 55n);
  assert.equal(credits(full.entries.filter(entry => entry.status === "Restored")), 40n);
});
check("RECONCILE: an unmapped charge is shown and counted", () => {
  const [unknown] = byProject("Unrecognized activity");
  assert.equal(unknown.status, "Charged"); assert.equal(unknown.credits, "5"); assert.equal(unknown.category, "Account");
});
check("project mapping: readable, revoked and deleted projects", () => {
  const [own] = byProject("Field guide");
  assert.deepEqual([own.action, own.category, own.status, own.credits], ["Website build · 50 reserved, rest returned", "Creation", "Charged", "12"]);
  const [hidden] = byProject("Project no longer shared with you");
  assert.deepEqual([hidden.action, hidden.credits], ["Presentation review", "30"]);
  const [deleted] = byProject("Deleted project");
  assert.deepEqual([deleted.action, deleted.credits], ["Project step · 20 reserved, rest returned", "7"]);
});
check("feature mapping: holds, release, timeout and payment reviews", () => {
  const actions = Object.fromEntries(full.entries.map(entry => [`${entry.project}|${entry.status}`, entry.action]));
  assert.equal(actions["No project yet|Released"], "Briefing questions");
  assert.equal(actions["No project|Reserved"], "Expert chat · in progress");
  assert.equal(actions["Client CRM|Released"], "Lead finder · timed out");
  assert.equal(actions["Account|Refunded"], "Credits refunded");
  assert.equal(actions["Account|Restored"], "Payment review resolved: credits returned");
  const withheld = full.entries.filter(entry => entry.status === "Withheld").map(entry => entry.action).sort();
  assert.deepEqual(withheld, ["Credit pack payment refunded: unused credits removed", "Payment disputed: unused credits on hold"]);
});
check("no raw references, payment ids or internal reasons reach the view", () => {
  const text = JSON.stringify(full);
  assert.doesNotMatch(text, /operation:|mystery|brief_questions|lead_find|pay_|merchant|hold timeout/);
  assert.ok(full.entries.every(entry => entry.model === undefined));
});

// Pagination
check("pages are partial, ordered and non-overlapping", () => {
  assert.equal(first.status, "ready"); assert.equal(second.status, "ready");
  assert.deepEqual([first.entries.length, first.history.newer, first.history.total], [4, 0, 11]);
  assert.ok(first.history.olderCursor);
  assert.deepEqual([second.entries.length, second.history.newer], [4, 4]);
  const ids = [...first.entries, ...second.entries].map(entry => entry.id);
  assert.equal(new Set(ids).size, 8);
  assert.deepEqual(ids, full.entries.slice(0, 8).map(entry => entry.id), "pages follow the complete order");
  assert.equal(first.used, "54", "used is the whole period, not the page");
});
check("partial pages say so", () => {
  assert.equal(view.usageCoverage(first).text, "Showing 1–4 of 11 recorded in October 2026 (UTC)");
  assert.equal(view.usageCoverage(second).text, "Showing 5–8 of 11 recorded in October 2026 (UTC)");
  assert.equal(view.usageCoverage(full).text, "All 11 recorded in October 2026 (UTC)");
});

// Fail closed: unavailable, never a fake empty history
const unavailable = (name, input, cursor = null, at = period) => check(`fails closed: ${name}`, () => {
  const result = quiet(() => usage.usageHistoryView(input, at, cursor));
  assert.equal(result.status, "unavailable"); assert.equal(result.entries.length, 0); assert.equal(result.used, null);
});
unavailable("no data", null);
unavailable("database error shape", { code: "42501", message: "permission denied" });
unavailable("complete month whose charges do not reconcile", { ...clone(fixture.full), period: { ...fixture.full.period, used: "53" } });
unavailable("complete month missing a row", { ...clone(fixture.full), entries: fixture.full.entries.slice(1) });
unavailable("unknown field (raw reference)", { ...clone(fixture.full), entries: [{ ...fixture.full.entries[0], reference: "operation:x" }, ...fixture.full.entries.slice(1)] });
unavailable("numeric credits", { ...clone(fixture.full), entries: [{ ...fixture.full.entries[0], credits: 15 }, ...fixture.full.entries.slice(1)] });
unavailable("unordered rows", { ...clone(fixture.full), entries: [...fixture.full.entries].reverse() });
unavailable("row outside the period", { ...clone(fixture.full), entries: [{ ...fixture.full.entries[0], occurredAt: "2026-09-30T23:59:59.000000Z" }, ...fixture.full.entries.slice(1)] });
unavailable("another period's result", fixture.full, null, usage.usagePeriod("2026-11", new Date("2026-11-03T00:00:00Z")));
unavailable("later page without its cursor", fixture.secondPage);
unavailable("page overlapping its cursor", fixture.firstPage, firstCursor);
unavailable("unknown status", { ...clone(fixture.full), entries: [{ ...fixture.full.entries[0], status: "Pending" }, ...fixture.full.entries.slice(1)] });
check("view schema rejects a page that disagrees with its totals", () => {
  assert.equal(view.readBillingView({ ...full, history: { ...full.history, total: 12 } }).status, "unavailable");
  assert.equal(view.readBillingView({ ...first, history: { ...first.history, olderCursor: null } }).status, "unavailable");
});

// Statement
check("statement coverage is truthful for complete, partial and filtered views", () => {
  const complete = JSON.parse(view.billingStatement(full, "All activity", ""));
  assert.match(complete.coverage, /^Every recorded item in October 2026 \(UTC\)\. Lists credit holds, charges, releases, credit refunds and payment-review adjustments\./);
  assert.match(complete.coverage, /grants and credit expiry are not listed; not a complete account ledger or invoice\.$/);
  assert.deepEqual(complete.history, { complete: true, total: 11, from: 1, to: 11 });
  assert.equal(complete.usedInPeriod, "54"); assert.equal(complete.entries.length, 11);
  const partial = JSON.parse(view.billingStatement(first, "All activity", ""));
  assert.match(partial.coverage, /^Items 1–4 of 11 recorded in October 2026 \(UTC\); the rest are on other pages\./);
  assert.equal(partial.history.complete, false);
  const filtered = JSON.parse(view.billingStatement(full, "Account", ""));
  assert.match(filtered.coverage, /narrowed by the selected filters/);
  assert.ok(filtered.entries.every(entry => entry.category === "Account"));
  assert.equal(filtered.entries.length, 5);
});

// Rendered page
function loadWorkspace() {
  const filename = path.join(root, "src/components/billing-workspace.tsx");
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const React = require("react");
  const stub = () => null;
  const modules = {
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "./brand-mark": { default: stub }, "./billing-plans": { default: stub }, "./billing-topup-return": { default: stub }, "./billing-autotopup": { default: stub },
    "./billing-credit-costs": { default: stub }, "./credit-balance": { default: stub, creditExpiryLabel: () => "" },
    "./billing-amount": require("../../components/billing-amount.ts"), "@/lib/billing/view": view, "@/lib/billing/usage-history": usage,
  };
  const context = { exports: {}, require: name => {
    if (Object.hasOwn(modules, name)) return modules[name];
    if (["react", "react/jsx-runtime", "lucide-react"].includes(name)) return require(name);
    throw new Error(`Unexpected usage check dependency: ${name}`);
  } };
  vm.runInNewContext(compiled, context, { filename });
  return props => require("react-dom/server").renderToStaticMarkup(React.createElement(context.exports.default, props));
}
const render = loadWorkspace();
check("page lists mapped rows with period coverage", () => {
  const html = render({ summary: full });
  for (const text of ["Field guide", "Deleted project", "Unrecognized activity", "Project no longer shared with you", "Withheld", "Restored", "Refunded", "All 11 recorded in October 2026 (UTC)", "Used · October 2026 (UTC)"]) assert.ok(html.includes(text), text);
  assert.match(html, /Download usage \(JSON\)/);
  assert.doesNotMatch(html, /Older activity|Latest activity|Previous month/);
});
check("partial pages link to older and latest activity", () => {
  const firstHtml = render({ summary: first });
  assert.ok(firstHtml.includes("Showing 1–4 of 11"));
  assert.ok(firstHtml.includes(`href="/billing?usage=2026-10&amp;usageBefore=${encodeURIComponent(first.history.olderCursor)}#activity"`));
  assert.doesNotMatch(firstHtml, /Latest activity/);
  const secondHtml = render({ summary: second });
  assert.ok(secondHtml.includes("Showing 5–8 of 11"));
  assert.ok(secondHtml.includes('href="/billing?usage=2026-10#activity"'), "back to the latest page");
});
check("an unavailable read never claims there is no activity", () => {
  const html = render({ summary: view.unavailableBilling });
  assert.match(html, /Usage history is unavailable right now/);
  assert.doesNotMatch(html, /No credit activity/);
  assert.doesNotMatch(html, /Download usage/);
});
check("an empty month says which month", () => {
  const empty = view.readBillingView({ status: "ready", unit: "whole_customer_credits", available: "5", reserved: "0", used: "0", period: "October 2026 (UTC)", entries: [], history: { periodKey: "2026-10", total: 0, newer: 0, olderCursor: null } });
  assert.match(render({ summary: empty }), /No credit activity in October 2026 \(UTC\)/);
});

// Wiring and database boundary (static)
check("billing page loads the history instead of a hard-coded unavailable summary", () => {
  const page = read("src/app/billing/page.tsx");
  assert.match(page, /loadUsageHistory\(user, \{ usage: params\.usage, usageBefore: params\.usageBefore \}\)/);
  assert.doesNotMatch(page, /status: "unavailable", unit:/);
});
check("server read uses the signed-in session and passes no account id", () => {
  const server = read("src/lib/billing/usage-history-server.ts");
  assert.match(server, /import "server-only"/);
  assert.match(server, /await createClient\(\)/);
  assert.match(server, /claims\?\.claims\?\.sub !== user\.id/);
  assert.doesNotMatch(server, /billingDatabase|p_user|SUPABASE_SECRET_KEY/);
  assert.match(server, /rpc\("makeborne_usage_history", \{\s*p_period_start/);
});
check("migration is read-only, caller-scoped and granted to authenticated only", () => {
  const sql = read("supabase/migrations/20261020110000_usage_history_read.sql").replace(/^\s*--.*$/gm, "");
  assert.doesNotMatch(sql, /\b(insert into|update [a-z_.]+ set|delete from|alter table|drop |truncate)\b/i);
  assert.doesNotMatch(sql, /p_user/);
  assert.match(sql, /v_user uuid := auth\.uid\(\)/);
  assert.match(sql, /makeborne_rpc\.makeborne_usage_history[\s\S]*?security definer set search_path = ''/);
  assert.match(sql, /public\.makeborne_usage_history[\s\S]*?security invoker set search_path = ''/);
  const grants = [...sql.matchAll(/grant execute on function ([a-z_.]+)\([^)]*\) to ([a-z_, ]+);/g)].map(match => `${match[1]} ${match[2]}`);
  assert.deepEqual(grants, ["makeborne_rpc.makeborne_usage_history authenticated", "public.makeborne_usage_history authenticated"]);
  assert.equal((sql.match(/from public, anon, authenticated, service_role;/g) || []).length, 2);
});
console.log(`${checks} offline usage-history checks passed. Fixture captured from a disposable local database; no live account, payment or provider.`);
