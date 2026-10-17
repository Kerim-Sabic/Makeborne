/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for review link view tracking (summaries, beacon clock, heartbeat route, wiring). */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const src = path.join(__dirname, "..", "..");
const root = path.join(src, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

// Route dependencies that need Next.js or a database are replaced with recorders.
const calls = [];
let cookieNames = [];
const fakeDatabase = kind => ({ rpc: async (name, args) => { calls.push({ kind, name, args }); if (args.p_session === "00000000-0000-4000-8000-00000000dead") throw new Error("database down"); return { data: null, error: { code: "42883" } }; } });
const stubs = {
  "server-only": {},
  "next/headers": { cookies: async () => ({ getAll: () => cookieNames.map(name => ({ name, value: "x" })) }) },
  "@/lib/supabase/server": { createClient: async () => fakeDatabase("cookie") },
  "@/lib/client-review/server": {
    anonymousReviewDatabase: () => fakeDatabase("anon"),
    requireReviewToken: value => { if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw Object.assign(new Error("not found"), { status: 404 }); return value; },
  },
};
const load = Module._load;
Module._load = function(name, parent, main) {
  if (Object.prototype.hasOwnProperty.call(stubs, name)) return stubs[name];
  if (name.startsWith("@/")) return load.call(this, path.join(src, `${name.slice(2)}.ts`), parent, main);
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
globalThis.fetch = async () => { throw new Error("Network forbidden"); };

const views = require("./views.ts");
const { ViewBeatSchema, ViewClock, deviceClass, summariseViews, pagesInOrder, mostTime, formatDuration, relativeTime, deviceMix, viewRefLabel, loadReviewViews, MAX_BEAT_BYTES } = views;
const route = require(path.join(src, "app", "api", "review", "[token]", "view", "route.ts"));

let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
const session = "11111111-1111-4111-8111-111111111111";
const token = "abc_DEF-123abc_DEF-123abc_DEF-123abc_DEF-12";

(async () => {
  await check("heartbeats are strict and bounded like the database (20 slices, whole seconds 0–60, safe refs)", () => {
    const ok = { session, device: "phone", open: true, slices: [{ ref: "slide:5", label: "Slide 6 · Pricing", seconds: 12 }] };
    assert.equal(ViewBeatSchema.safeParse(ok).success, true);
    assert.equal(ViewBeatSchema.parse({ ...ok, slices: [{ ref: "page", seconds: 0 }] }).slices[0].label, "");
    for (const bad of [
      { ...ok, session: "nope" }, { ...ok, device: "watch" }, { ...ok, open: "yes" }, { ...ok, ip: "1.2.3.4" }, { ...ok, userAgent: "x" },
      { ...ok, slices: [{ ref: "bad ref", seconds: 1 }] }, { ...ok, slices: [{ ref: "slide:1", seconds: 61 }] }, { ...ok, slices: [{ ref: "slide:1", seconds: 1.5 }] },
      { ...ok, slices: [{ ref: "slide:1", seconds: -1 }] }, { ...ok, slices: [{ ref: "slide:1", seconds: 1, extra: 1 }] }, { ...ok, slices: [{ ref: "slide:1", seconds: 1, label: "x".repeat(161) }] },
      { ...ok, slices: Array.from({ length: 21 }, (_, index) => ({ ref: `slide:${index}`, seconds: 0 })) },
    ]) assert.equal(ViewBeatSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 80));
    assert.ok(MAX_BEAT_BYTES <= 4_000);
  });

  await check("device class is coarse: phone, tablet or desktop only", () => {
    assert.equal(deviceClass(390, true), "phone");
    assert.equal(deviceClass(820, true), "tablet");
    assert.equal(deviceClass(1024, true), "tablet");
    assert.equal(deviceClass(900, false), "desktop");
    assert.equal(deviceClass(1440, true), "desktop");
    assert.equal(deviceClass(0, false), "desktop");
  });

  await check("beacon clock: time per slide while visible, hidden time excluded, new slides reported once", () => {
    const clock = new ViewClock(0, true);
    clock.setLocation("slide:0", "Slide 1 · Welcome", 0);
    clock.setLocation("slide:1", "  Slide 2 ·\n Problem ", 4_000);
    clock.setVisible(false, 10_000);
    clock.setVisible(true, 70_000);           // a minute in another tab
    clock.setLocation("slide:5", "Slide 6 · Pricing", 72_000);
    const first = clock.take(80_000);
    assert.deepEqual(first, [
      { ref: "slide:1", label: "Slide 2 · Problem", seconds: 8 },   // 6 s, hidden for a minute, then 2 s more
      { ref: "slide:5", label: "Slide 6 · Pricing", seconds: 8 },
      { ref: "slide:0", label: "Slide 1 · Welcome", seconds: 4 },
    ]);
    assert.deepEqual(clock.take(80_000), [], "nothing new to say");
    assert.deepEqual(clock.take(95_000), [{ ref: "slide:5", label: "Slide 6 · Pricing", seconds: 15 }]);
    clock.setLocation("slide:6", "Slide 7", 95_000);
    assert.deepEqual(clock.take(95_000), [{ ref: "slide:6", label: "Slide 7", seconds: 0 }], "a slide seen briefly is still reported");
    clock.setLocation("bad ref!", "x", 96_000);
    assert.deepEqual(clock.take(100_000), [{ ref: "slide:6", label: "Slide 7", seconds: 5 }], "unsafe refs are ignored");
  });

  await check("beacon clock caps each heartbeat at 60 s and 20 slices", () => {
    const clock = new ViewClock(0, true);
    clock.setLocation("slide:0", "", 0);
    assert.deepEqual(clock.take(300_000), [{ ref: "slide:0", label: "", seconds: 60 }]);
    for (let index = 1; index <= 30; index++) clock.setLocation(`slide:${index}`, "", 300_000 + index * 3_000);
    const slices = clock.take(400_000);
    assert.equal(slices.length, 20);
    assert.ok(slices.reduce((sum, slice) => sum + slice.seconds, 0) <= 60);
    assert.ok(slices.every(slice => slice.seconds >= 0 && slice.seconds <= 60));
  });

  const rows = [
    { link_id: "a", started_at: "2026-10-15T08:00:00Z", last_seen_at: "2026-10-15T08:04:00Z", active_seconds: 240, opens: 2, device: "desktop",
      pages: { "slide:0": { s: 20, l: "Slide 1 · Welcome" }, "slide:5": { s: 150, l: "Slide 6 · Prices" }, "slide:10": { s: 70, l: "" } } },
    { link_id: "a", started_at: "2026-10-15T10:00:00Z", last_seen_at: "2026-10-15T10:01:30Z", active_seconds: 90, opens: 1, device: "phone",
      pages: { "slide:5": { s: 60, l: "Slide 6 · Pricing" }, "slide:1": { s: 30, l: "Slide 2 · Problem" }, "bad ref!": { s: 999, l: "x" }, "slide:2": "nonsense" } },
    { link_id: "a", started_at: "2026-10-14T10:00:00Z", last_seen_at: "2026-10-14T10:00:00Z", active_seconds: -5, opens: 0, device: "fridge", pages: [] },
  ];
  await check("summaries: opens, visits, total time, last opened, device mix and time per slide across visits", () => {
    const summary = summariseViews(rows);
    assert.equal(summary.opens, 4, "a session counts at least one open");
    assert.equal(summary.sessions, 3);
    assert.equal(summary.totalSeconds, 330, "negative seconds clamp to 0");
    assert.equal(summary.lastOpenedAt, "2026-10-15T10:01:30.000Z");
    assert.deepEqual(summary.devices, { phone: 1, tablet: 0, desktop: 2 }, "unknown devices count as desktop");
    assert.deepEqual(summary.pages.map(page => [page.ref, page.label, page.seconds]), [
      ["slide:5", "Slide 6 · Pricing", 210], ["slide:10", "Slide 11", 70], ["slide:1", "Slide 2 · Problem", 30], ["slide:0", "Slide 1 · Welcome", 20],
    ], "summed per slide, newest label wins, unsafe refs and malformed entries dropped");
    assert.equal(summary.pages[0].share, 63.6);
    assert.deepEqual(mostTime(summary), summary.pages[0]);
    assert.deepEqual(pagesInOrder(summary.pages).map(page => page.ref), ["slide:0", "slide:1", "slide:5", "slide:10"], "reading order is numeric");
    assert.deepEqual(summary.recent.map(item => [item.at, item.seconds, item.device]), [
      ["2026-10-15T10:01:30.000Z", 90, "phone"], ["2026-10-15T08:04:00.000Z", 240, "desktop"], ["2026-10-14T10:00:00.000Z", 0, "desktop"],
    ]);
  });

  await check("summaries stay bounded with hostile or huge input", () => {
    const pages = Object.fromEntries(Array.from({ length: 400 }, (_, index) => [`slide:${index}`, { s: 1e12, l: "y".repeat(500) }]));
    const many = Array.from({ length: 40 }, (_, index) => ({ link_id: "a", started_at: "2026-10-15T08:00:00Z", last_seen_at: `2026-10-15T08:${String(index).padStart(2, "0")}:00Z`, active_seconds: 1e9, opens: 1e9, device: "tablet", pages }));
    const summary = summariseViews(many);
    assert.equal(summary.totalSeconds, 40 * 14_400, "each visit counts at most 4 hours");
    assert.equal(summary.opens, 40 * 1000);
    assert.equal(summary.pages.length, 50, "top 50 pages");
    assert.ok(summary.pages.every(page => page.label.length <= 80 && page.seconds === 40 * 14_400));
    assert.equal(summary.recent.length, 5);
    assert.equal(summary.recent[0].at, "2026-10-15T08:39:00.000Z");
    const empty = summariseViews([]);
    assert.deepEqual([empty.opens, empty.sessions, empty.totalSeconds, empty.lastOpenedAt, empty.pages.length], [0, 0, 0, null, 0]);
    assert.equal(mostTime({ pages: [{ ref: "slide:0", label: "Slide 1", seconds: 0, share: 0 }] }), null, "nothing held attention");
  });

  await check("plain-English durations, relative times, device mix and default labels", () => {
    assert.deepEqual([0, 45, 59, 60, 89, 240, 3_599, 3_600, 3_900, 14_400].map(formatDuration), ["0 sec", "45 sec", "59 sec", "1 min", "1 min", "4 min", "1 h", "1 h", "1 h 5 min", "4 h"]);
    const now = Date.parse("2026-10-15T12:00:00Z");
    assert.deepEqual(["2026-10-15T11:59:30Z", "2026-10-15T11:55:00Z", "2026-10-15T10:00:00Z", "2026-10-14T09:00:00Z", "2026-10-12T12:00:00Z", "2026-10-15T12:05:00Z"].map(value => relativeTime(value, now)),
      ["just now", "5 min ago", "2h ago", "yesterday", "3 days ago", "just now"]);
    assert.equal(relativeTime("2026-09-01T12:00:00Z", now), "Sep 1");
    assert.equal(relativeTime(null, now), "never");
    assert.equal(relativeTime("garbage", now), "never");
    assert.equal(deviceMix({ phone: 1, tablet: 2, desktop: 3 }), "3 on desktop, 1 on a phone, 2 on tablets");
    assert.equal(deviceMix({ phone: 2, tablet: 0, desktop: 0 }), "2 on phones");
    assert.deepEqual(["slide:5", "page:0", "page:3", "page", "chapter:1", "section:2", "front:pages"].map(ref => viewRefLabel(ref)), ["Slide 6", "Cover", "Page 3", "Website", "Chapter 2", "Section 3", "Page"]);
    assert.equal(viewRefLabel("slide:5", "  Pricing "), "Pricing");
  });

  await check("owner reads: missing migration says 'being set up', read errors never fail the panel, rows grouped per link", async () => {
    const reader = result => ({ from: table => { assert.equal(table, "client_review_views"); const chain = { select: columns => { assert.ok(!/session_id|ip|agent/.test(columns), "never reads session ids"); return chain; }, eq: () => chain, in: () => chain, order: () => chain, limit: async () => result }; return chain; } });
    assert.deepEqual(await loadReviewViews(reader({ data: null, error: { code: "PGRST205" } }), "w", ["a"]), { available: false, reason: "setup" });
    assert.deepEqual(await loadReviewViews(reader({ data: null, error: { code: "42P01" } }), "w", ["a"]), { available: false, reason: "setup" });
    assert.deepEqual(await loadReviewViews(reader({ data: null, error: { code: "42501" } }), "w", ["a"]), { available: false, reason: "error" });
    assert.deepEqual(await loadReviewViews({ from: () => { throw new Error("must not query"); } }, "w", []), { available: true, byLink: {} });
    const result = await loadReviewViews(reader({ data: [...rows, { ...rows[0], link_id: "b" }], error: null }), "w", ["a", "b"]);
    assert.equal(result.available, true);
    assert.deepEqual(Object.keys(result.byLink).sort(), ["a", "b"]);
    assert.equal(result.byLink.a.sessions, 3); assert.equal(result.byLink.b.sessions, 1);
  });

  const post = (body, options = {}) => route.POST(new Request(`https://makeborne.test/api/review/${options.token ?? token}/view`, {
    method: "POST", body, headers: { "content-type": options.type ?? "text/plain;charset=UTF-8", ...(options.origin === undefined ? { origin: "https://makeborne.test" } : options.origin ? { origin: options.origin } : {}) },
  }), { params: Promise.resolve({ token: options.token ?? token }) });
  const beat = JSON.stringify({ session, device: "tablet", open: true, slices: [{ ref: "slide:5", label: "Slide 6 · Pricing", seconds: 15 }] });
  await check("heartbeat route: valid beats reach the anonymous RPC; everything answers 204 with no body", async () => {
    calls.length = 0; cookieNames = [];
    const response = await post(beat);
    assert.equal(response.status, 204); assert.equal(await response.text(), "");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(calls, [{ kind: "anon", name: "makeborne_record_client_review_view", args: { p_token: token, p_session: session, p_device: "tablet", p_open: true, p_slices: [{ ref: "slide:5", label: "Slide 6 · Pricing", seconds: 15 }] } }]);
    calls.length = 0;
    assert.equal((await post(beat, { type: "application/json" })).status, 204);
    assert.equal(calls.length, 1, "fetch fallbacks may send JSON");
  });

  await check("heartbeat route: bad input, other origins, bad tokens, oversize bodies and database failures are silent", async () => {
    calls.length = 0; cookieNames = [];
    const responses = [
      await post("not json"), await post(JSON.stringify({ session, device: "watch", open: true, slices: [] })), await post(beat, { type: "text/html" }),
      await post(beat, { origin: "https://evil.example" }), await post(beat, { token: "short" }), await post("x".repeat(MAX_BEAT_BYTES + 1)),
      await post(JSON.stringify({ session, device: "phone", open: true, slices: [], padding: "x".repeat(MAX_BEAT_BYTES) })),
    ];
    assert.ok(responses.every(response => response.status === 204));
    assert.equal(calls.length, 0, "nothing reached the database");
    const failing = await post(JSON.stringify({ session: "00000000-0000-4000-8000-00000000dead", device: "phone", open: false, slices: [] }));
    assert.equal(failing.status, 204); assert.equal(calls.length, 1, "a throwing database is swallowed");
    calls.length = 0;
    assert.equal((await post(beat, { origin: null })).status, 204);
    assert.equal(calls.length, 1, "sendBeacon without an Origin header still counts");
  });

  await check("heartbeat route: a signed-in visitor's session is passed so owner and member previews are skipped", async () => {
    calls.length = 0;
    cookieNames = ["sb-127-auth-token"]; await post(beat);
    cookieNames = ["sb-127-auth-token.0", "sb-127-auth-token.1"]; await post(beat);
    cookieNames = ["sb-127-auth-token-code-verifier", "theme"]; await post(beat);
    assert.deepEqual(calls.map(call => call.kind), ["cookie", "cookie", "anon"]);
    cookieNames = [];
  });

  await check("migration: additive, private by default, bounded, no IP/user agent/cookie storage", () => {
    const sql = read("supabase/migrations/20261015100000_review_link_views.sql");
    const code = sql.split("\n").filter(line => !line.trim().startsWith("--")).join("\n");
    assert.match(sql, /^begin;$/m); assert.match(sql, /^commit;$/m);
    assert.ok(!/\b(alter|drop)\s+(table|function)\s+public\.client_review_(links|comments|snapshots)\b/i.test(code), "existing review objects untouched");
    assert.ok(!/create or replace function public\.makeborne_(read|add|decide)_client_review/i.test(code), "existing review functions untouched");
    assert.ok(!/\b(ip|ip_address|user_agent|useragent|cookie|email|name)\b\s+(text|inet|cidr)/i.test(code), "no personal columns");
    assert.match(code, /security definer set search_path=''/);
    assert.match(code, /client_review_live_link\(p_token,false\)/, "token validated by the shared live-link helper");
    assert.match(code, /makeborne_private\.can_read\(r\.workspace_id\)/, "members skipped");
    assert.match(code, /makeborne_private\.can_read\(workspace_id\)/, "RLS by workspace");
    assert.match(code, /revoke all on public\.client_review_views from public,anon,authenticated;/);
    assert.match(code, /revoke all on function public\.makeborne_record_client_review_view\(text,uuid,text,boolean,jsonb\) from public,anon,authenticated,service_role;/);
    assert.match(code, /grant execute on function public\.makeborne_record_client_review_view\(text,uuid,text,boolean,jsonb\) to anon,authenticated,service_role;/);
    assert.match(code, /on delete cascade/);
    for (const limit of [/between 0 and 14400/, /least\(60,/, />=200/, />20 then/, /<200 then/, /interval '1 second'/]) assert.match(code, limit);
    const check = read("supabase/check-review-link-views.sql");
    assert.match(check, /^\\set ON_ERROR_STOP on$/m); assert.match(check, /^begin;$/m); assert.match(check, /^rollback;$/m);
    assert.ok(!/^commit;$/m.test(check));
    assert.ok((check.match(/raise notice 'PASS /g) ?? []).length >= 9);
  });

  await check("viewer wiring: beacon only on the review page, 15 s while visible, final beat on hide, no cookies or third parties", () => {
    const beacon = read("src/components/client-review-beacon.tsx");
    assert.match(beacon, /navigator\.sendBeacon\(url, body\)/);
    assert.match(beacon, /"visibilitychange"/); assert.match(beacon, /"pagehide"/);
    assert.match(beacon, /BEAT_INTERVAL_MS/); assert.match(beacon, /document\.visibilityState === "visible"\) send\(false\)/);
    assert.match(beacon, /`\/api\/review\/\$\{token\}\/view`/);
    assert.match(beacon, /sessionStorage/);
    assert.ok(!/document\.cookie|localStorage|userAgent|https?:\/\//.test(beacon), "no cookies, persistent storage, user agent or external hosts");
    assert.equal(views.BEAT_INTERVAL_MS, 15_000);
    const page = read("src/components/client-review-page.tsx");
    assert.match(page, /<ClientReviewBeacon token=\{token\} where=\{where\} \/>/);
    assert.equal((page.match(/onView=\{setFrameView\}/g) ?? []).length, 2, "website and document frames report what is in view");
    assert.match(page, /querySelectorAll\("section\.slide"\)/, "decks: slide in view");
    assert.match(page, /ref: `chapter:\$\{chapter\+\+\}`/, "books: chapter in view");
    assert.match(page, /ref: `slide:\$\{slide\}`/, "content decks: current slide");
    const routeSource = read("src/app/api/review/[token]/view/route.ts");
    assert.match(routeSource, /export const runtime = "nodejs"/);
    assert.match(routeSource, /requireReviewToken\(/); assert.match(routeSource, /anonymousReviewDatabase\(\)/);
    assert.match(routeSource, /boundedBytes\(request, MAX_BEAT_BYTES/);
    assert.ok(!/headers\.get\("(x-forwarded-for|user-agent|x-real-ip)"\)/i.test(routeSource), "never reads IP or user agent");
  });

  await check("owner stats render: totals, device mix, most time and a per-slide toggle; 'Not opened yet' when empty", () => {
    require.extensions[".tsx"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
    const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
    const LinkViewStats = require(path.join(src, "components", "client-review-views.tsx")).default;
    const summary = { ...summariseViews(rows), lastOpenedAt: new Date(Date.now() - 2 * 3_600_000).toISOString() };
    const html = renderToStaticMarkup(React.createElement(LinkViewStats, { summary, kind: "presentation", linkLabel: "Sarah" }));
    const text = html.replace(/<[^>]+>/g, "");
    assert.match(text, /Opened 4 times · 3 visits · 6 min in total · last opened 2h ago/);
    assert.match(text, /2 on desktop, 1 on a phone/);
    assert.match(text, /Most time: Slide 6 · Pricing \(4 min\)/);
    assert.match(text, /Show time per slide \(4 slides\)/);
    assert.ok(!/<script|javascript:/i.test(html));
    const book = renderToStaticMarkup(React.createElement(LinkViewStats, { summary, kind: "book", linkLabel: "Sarah" })).replace(/<[^>]+>/g, "");
    assert.match(book, /Show time per page \(4 pages\)/);
    assert.match(renderToStaticMarkup(React.createElement(LinkViewStats, { summary: null, kind: "website", linkLabel: "x" })), /Not opened yet/);
  });

  await check("owner wiring: links and client feeds carry views; panel and feed explain the setup state in plain English", () => {
    for (const file of ["src/app/api/cloud/workspaces/[workspaceId]/artifacts/[artifactId]/reviews/route.ts", "src/app/api/cloud/workspaces/[workspaceId]/clients/[clientId]/reviews/route.ts"])
      assert.match(read(file), /loadReviewViews\(client, workspaceId, (ids|linkIds)\)/, file);
    const panel = read("src/components/client-review-panel.tsx");
    assert.match(panel, /View tracking is being set up/);
    assert.match(panel, /Your own previews aren&rsquo;t counted/);
    assert.match(panel, /<LinkViewStats /);
    const stats = read("src/components/client-review-views.tsx");
    assert.match(stats, /Most time: <strong>\{top\.label\}<\/strong>/);
    assert.match(stats, /Show time per \$\{one\}/);
    const feed = read("src/components/client-review-feed.tsx");
    assert.match(feed, /Viewed \{item\.artifact\?\.title \?\? "the project"\} · \{formatDuration\(entry\.view\.seconds\)\} · \{relativeTime\(entry\.view\.at\)\}/);
    assert.ok(!/method: "(POST|PATCH|PUT)"/.test(feed), "the feed never writes CRM records");
  });

  console.log(`${passed} review view checks passed.`);
})().catch(error => { console.error(error); process.exit(1); });
