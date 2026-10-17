/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for the website analytics summary and its route. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { summarise, rangeDays, dimensionLabel } = require("./site-analytics.ts");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const now = Date.parse("2026-10-14T15:00:00Z");

check("ranges end today (UTC) and compare with the same span before", () => {
  const range = rangeDays(7, now);
  assert.deepEqual([range.from, range.to, range.previousFrom, range.days.length, range.days[0], range.days[6]], ["2026-10-08", "2026-10-14", "2026-10-01", 7, "2026-10-08", "2026-10-14"]);
});

check("totals, previous-period change, enquiry rate and a zero-filled daily series", () => {
  const days = [
    { day: "2026-10-02", views: 30, visitors: 20 }, { day: "2026-10-05", views: 30, visitors: 20 },   // previous period: 40 visitors
    { day: "2026-10-08", views: 50, visitors: 30 }, { day: "2026-10-14", views: 80, visitors: 50 },   // current: 80 visitors
    { day: "2026-09-01", views: 999, visitors: 999 },                                               // outside both
  ];
  const enquiries = [{ created_at: "2026-10-14T09:00:00Z", email: "Ana@Example.test" }, { created_at: "2026-10-09T12:00:00Z", email: "marko@example.test" }, { created_at: "2026-10-03T08:00:00Z", email: "old@example.test" }];
  const clients = [{ email: "ana@example.test", stage: "Won" }, { email: "MARKO@example.test", stage: "Lead" }, { email: "old@example.test", stage: "Won" }, { email: "", stage: "Won" }];
  const summary = summarise({ range: 7, days, breakdowns: [], enquiries, clients, now });
  assert.deepEqual(summary.totals.visitors, { value: 80, previous: 40, change: 100 });
  assert.deepEqual(summary.totals.views, { value: 130, previous: 60, change: 116.7 });
  assert.deepEqual(summary.totals.enquiries, { value: 2, previous: 1, change: 100 });
  assert.deepEqual(summary.totals.conversion, { value: 2.5, previous: 2.5, change: 0 });
  assert.equal(summary.totals.leads, 2, "clients whose email wrote in this period, case-insensitive");
  assert.equal(summary.totals.won, 1, "a win from an older enquiry isn't credited to this period");
  assert.equal(summary.series.length, 7);
  assert.deepEqual(summary.series.find(day => day.day === "2026-10-10"), { day: "2026-10-10", views: 0, visitors: 0, enquiries: 0 });
  assert.deepEqual(summary.series.find(day => day.day === "2026-10-14"), { day: "2026-10-14", views: 80, visitors: 50, enquiries: 1 });
  assert.equal(summary.hasData, true);
});

check("changes from nothing read as new, and empty periods have no data", () => {
  const summary = summarise({ range: 7, days: [{ day: "2026-10-14", views: 3, visitors: 2 }], breakdowns: [], enquiries: [], clients: [], now });
  assert.equal(summary.totals.visitors.change, null);
  assert.equal(summary.totals.conversion.value, 0);
  const empty = summarise({ range: 30, days: [], breakdowns: [], enquiries: [], clients: [], now });
  assert.equal(empty.hasData, false); assert.equal(empty.series.length, 30);
});

check("top lists merge days, keep the top 8 by views and give shares", () => {
  const breakdowns = [];
  for (let index = 0; index < 10; index++) breakdowns.push({ day: "2026-10-13", dimension: "path", value: `/p${index}`, views: index + 1 }, { day: "2026-10-14", dimension: "path", value: `/p${index}`, views: index + 1 });
  breakdowns.push({ day: "2026-10-14", dimension: "referrer", value: "(direct)", views: 6 }, { day: "2026-10-14", dimension: "referrer", value: "google.com", views: 4 }, { day: "2026-09-01", dimension: "referrer", value: "old.com", views: 100 });
  const summary = summarise({ range: 7, days: [{ day: "2026-10-14", views: 1, visitors: 1 }], breakdowns, enquiries: [], clients: [], now });
  assert.equal(summary.top.path.length, 8);
  assert.deepEqual(summary.top.path[0], { value: "/p9", views: 20, share: 18.2 });
  assert.deepEqual(summary.top.referrer.map(item => [item.value, item.share]), [["(direct)", 60], ["google.com", 40]], "out-of-range rows are excluded");
  assert.deepEqual(summary.top.country, []);
});

check("labels read naturally", () => {
  assert.equal(dimensionLabel("path", "/"), "Home page");
  assert.equal(dimensionLabel("referrer", "(direct)"), "Direct or unknown");
  assert.equal(dimensionLabel("device", "mobile"), "Phone");
  assert.equal(dimensionLabel("country", "(other)"), "Other");
});

check("the route is owner-only, validates the range and scopes every query to the site", () => {
  const route = fs.readFileSync(path.join(__dirname, "..", "..", "app", "api", "cloud", "workspaces", "[workspaceId]", "artifacts", "[artifactId]", "analytics", "route.ts"), "utf8");
  assert.match(route, /ANALYTICS_RANGES\.includes\(range\)/);
  assert.match(route, /role !== "owner"\) throw new RequestError\("OWNER_REQUIRED"/);
  assert.match(route, /const scoped = \(table: string, columns: string\) => client\.from\(table\)\.select\(columns\)\.eq\("workspace_id", workspaceId\)\.eq\("artifact_id", artifactId\)/);
  assert.equal((route.match(/scoped\("/g) ?? []).length, 3, "views, breakdowns and enquiries all go through the scoped helper");
  assert.doesNotMatch(route, /billingDatabase/, "reads use the owner's own permissions");
  assert.match(route, /available: false/, "missing tables read as not set up, not as an error");
});

console.log(`\n${passed} site analytics checks passed.`);
