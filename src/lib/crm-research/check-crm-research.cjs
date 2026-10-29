/* eslint-disable @typescript-eslint/no-require-imports -- Offline CRM-research harness: a local HTTP fixture server (127.0.0.1 only) and an in-memory database; no public network, no AI, no paid call. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict"), http = require("node:http");
const { randomUUID } = require("node:crypto");

process.env.MAKEBORNE_CLIENT_KNOWLEDGE = "on";
class RequestError extends Error { constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; } }
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  if (name.startsWith("@/")) return load.call(this, path.join(__dirname, "../..", name.slice(2)), parent, main);
  if (/(^|\/)server\/http$/.test(name)) return { RequestError };
  if (/(^|\/)cloud\/server$/.test(name)) return {
    databaseError(error) { if (!error) return; if (error.code === "PT409") throw new RequestError("REVISION_CONFLICT", "changed", 409); if (error.code === "42501") throw new RequestError("ACCESS_DENIED", "denied", 403); throw new RequestError("DB", error.code ?? "db", 503); },
    cloudError: error => ({ error }),
  };
  if (/(^|\/)knowledge\/server$/.test(name)) return { clientKnowledgeEnabled: () => process.env.MAKEBORNE_CLIENT_KNOWLEDGE === "on" };
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);

const siteCheck = require("./site-check.ts"), score = require("./score.ts"), match = require("./match.ts"), pipeline = require("./pipeline.ts"), timeline = require("./timeline.ts");
const draftMod = require("./draft.ts"), facts = require("./facts.ts"), server = require("./server.ts");
const { canonicalProposal } = require("../knowledge/types.ts");

// ---------- local fixture sites (hosts routed by the Host header; sockets only to 127.0.0.1) ----------
const YEAR = new Date().getUTCFullYear();
const GOOD = `<!doctype html><html><head><title>Mlin Bistro — Sarajevo</title><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Bosnian dishes cooked fresh every day in Sarajevo's old town.">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Restaurant","name":"Mlin Bistro","telephone":"+387 33 123 456","address":{"streetAddress":"Ferhadija 12","addressLocality":"Sarajevo"},"openingHours":"Mo-Su 10:00-22:00"}</script></head>
<body><header><nav><a href="/menu">Menu</a><a href="/about">About</a></nav></header><main><h1>Fresh Bosnian food in the old town</h1>
<p>Mlin Bistro cooks burek, ćevapi and seasonal stews every morning with flour from our own family mill near Visoko.</p>
<p>Book a table for lunch or dinner, or order for collection. Groups of up to twenty people are welcome in our upstairs room.</p>
<a href="tel:+38733123456">Call +387 33 123 456</a> <a href="/contact">Book a table</a>
<form action="/contact" method="post"><label>Name<input name="name"></label><button>Send</button></form></main>
<footer><p>Ferhadija 12, Sarajevo</p><p>© ${YEAR} Mlin Bistro</p></footer></body></html>`;
const OLD = `<html><head><title>Dental Studio Lana</title></head><body><center><font face="Arial">
<table width="760" bgcolor="#ffffff"><tr><td><nav><a href="/about">About us</a><a href="/gallery">Gallery</a><a href="/team">Our team</a></nav>
<p>Dental Studio Lana has looked after families in Tuzla since 1998 with gentle check-ups and modern treatment.</p>
<p>Phone: 035 555 0101</p></td></tr></table></font></center><p>Copyright © 2018 Dental Studio Lana</p></body></html>`;
const page = (title, text) => `<!doctype html><html><head><title>${title}</title><meta name="viewport" content="width=device-width"><meta name="description" content="${text}"></head><body><h1>${title}</h1><p>${text} ${text}</p></body></html>`;
const routes = {
  "mlin.test": { "/": { body: GOOD }, "/menu": { body: page("Menu", "Burek, ćevapi and stews, with daily soups and fresh bread from our oven.") }, "/about": { body: page("About", "A family bistro using flour from our own mill since 1987.") }, "/contact": { body: page("Contact", "Find us on Ferhadija in the old town of Sarajevo.") } },
  "lana.test": { "/": { body: OLD }, "/about": { body: page("About us", "Dental Studio Lana was founded in Tuzla in 1998 by Dr Lana.") }, "/team": { body: page("Our team", "Our dentists and hygienists look after families.") } },
  "slow.test": { "/": { body: GOOD.replace("Mlin Bistro — Sarajevo", "Slow Bistro"), delay: 3_400 } },
  "plain.test": { "/": { body: GOOD.replace("Mlin Bistro — Sarajevo", "Plain Bistro") } },
  "robots.test": { "/robots.txt": { body: "User-agent: *\nDisallow: /\n", type: "text/plain" }, "/": { body: GOOD } },
  "jump.test": { "/": { status: 302, location: "http://intranet.test/" } },
};
let hits = [];
const fixture = http.createServer((req, res) => {
  const host = (req.headers.host ?? "").split(":")[0];
  hits.push(`${host}${req.url}`);
  const route = routes[host]?.[req.url];
  if (!route) { res.writeHead(404); res.end(); return; }
  const send = () => {
    if (route.status && route.status >= 300) { res.writeHead(route.status, route.location ? { location: route.location } : {}); res.end(); return; }
    res.writeHead(200, { "content-type": `${route.type ?? "text/html"}; charset=utf-8` }); res.end(route.body ?? "");
  };
  if (route.delay) { const timer = setTimeout(send, route.delay); res.on("close", () => clearTimeout(timer)); } else send();
});
let port = 0;
const fixtureFetcher = (raw, init) => new Promise((resolve, reject) => {
  const url = new URL(raw);
  const request = http.request({ host: "127.0.0.1", port, path: `${url.pathname}${url.search}`, method: "GET", headers: { ...Object.fromEntries(new Headers(init.headers)), host: url.hostname }, signal: init.signal ?? undefined }, response => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(response.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    const status = response.statusCode ?? 502;
    if (status < 200 || status >= 300) { resolve(new Response(null, { status, headers })); response.destroy(); return; }
    const chunks = [];
    response.on("data", chunk => chunks.push(chunk)); response.on("end", () => resolve(new Response(Buffer.concat(chunks), { status, headers }))); response.on("error", reject);
  });
  request.on("error", reject); request.end();
});
const resolve = async host => {
  if (host === "intranet.test") return [{ address: "10.1.2.3", family: 4 }];
  if (routes[host]) return [{ address: "203.0.113.10", family: 4 }];
  throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
};
const deps = { fetcher: fixtureFetcher, resolve };
const run = (url, extra = {}) => siteCheck.checkWebsite(url, { deps: { ...deps, ...extra } });

// ---------- in-memory database with the query shapes server.ts uses ----------
function fakeDb(seed = {}) {
  const tables = { clients: [], crm_site_checks: [], crm_suppressions: [], crm_duplicate_dismissals: [], crm_next_steps: [], ...seed };
  const keys = new Map(), calls = [];
  const rpcs = {
    makeborne_create_record(a) {
      const prior = keys.get(a.p_request_key);
      if (prior) return { data: { record: prior, replayed: true }, error: null };
      const record = { id: randomUUID(), workspace_id: a.p_workspace_id, ...a.p_payload, outreach: null, tags: [], lead_source: "", created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      tables.clients.push(record); keys.set(a.p_request_key, record);
      return { data: { record, replayed: false }, error: null };
    },
    // The server-only save (20261026120000): author from the session, expiry set in SQL, check time bounded.
    makeborne_crm_site_check_save(a) {
      const at = Date.parse(a.p_check.checkedAt), now = Date.now();
      if (!(at <= now + 300_000 && at >= now - 3_600_000)) return { data: null, error: { code: "22023" } };
      const row = { id: randomUUID(), workspace_id: a.p_workspace, client_id: a.p_client, url: a.p_check.url, final_url: a.p_check.finalUrl, status: a.p_check.status, reason: a.p_check.reason,
        score: a.p_check.score, result: a.p_check.result, checker_version: a.p_check.checkerVersion, checked_at: a.p_check.checkedAt, created_by: a.p_actor, created_at: new Date(now).toISOString(),
        expires_at: a.p_client ? null : new Date(Math.min(at, now) + 30 * 86_400_000).toISOString() };
      tables.crm_site_checks.push(row);
      return { data: row.id, error: null };
    },
  };
  function from(name) {
    const state = { op: "select", filters: [], values: null, limit: null, onConflict: null, ignore: false };
    const rows = () => tables[name].filter(row => state.filters.every(fn => fn(row)));
    const exec = () => {
      calls.push(`${state.op}:${name}`);
      if (state.op === "select") { const out = rows().slice(0, state.limit ?? undefined); return state.one ? { data: out[0] ?? null, error: null } : { data: out, error: null }; }
      if (state.op === "insert" || state.op === "upsert") {
        const list = Array.isArray(state.values) ? state.values : [state.values], out = [];
        for (const value of list) {
          const cols = state.onConflict ? state.onConflict.split(",") : null;
          if (cols && tables[name].some(row => cols.every(col => row[col] === value[col]))) { if (state.ignore) continue; }
          const row = { id: randomUUID(), created_at: new Date().toISOString(), ...value };
          tables[name].push(row); out.push(row);
        }
        return state.one ? { data: out[0] ?? null, error: null } : { data: out, error: null };
      }
      if (state.op === "update") { const out = rows(); for (const row of out) Object.assign(row, state.values, name === "clients" ? { updated_at: new Date(Date.now() + 1).toISOString() } : {}); return { data: out, error: null }; }
      if (state.op === "delete") { const out = rows(); tables[name] = tables[name].filter(row => !out.includes(row)); return { data: out, error: null }; }
      return { data: null, error: { code: "UNSUPPORTED" } };
    };
    const builder = {
      select() { return builder; }, insert(v) { state.op = "insert"; state.values = v; return builder; },
      upsert(v, options = {}) { state.op = "upsert"; state.values = v; state.onConflict = options.onConflict; state.ignore = options.ignoreDuplicates; return builder; },
      update(v) { state.op = "update"; state.values = v; return builder; }, delete() { state.op = "delete"; return builder; },
      eq(col, value) { state.filters.push(row => row[col] === value); return builder; }, is(col, value) { state.filters.push(row => (row[col] ?? null) === value); return builder; },
      in(col, values) { state.filters.push(row => values.includes(row[col])); return builder; }, not() { return builder; },
      order() { return builder; }, limit(n) { state.limit = n; return builder; },
      single() { state.one = true; return Promise.resolve(exec()); }, maybeSingle() { state.one = true; return Promise.resolve(exec()); },
      then(onFulfilled, onRejected) { return Promise.resolve(exec()).then(onFulfilled, onRejected); },
    };
    return builder;
  }
  return { tables, calls, from, rpc: async (name, args) => { calls.push(`rpc:${name}`); return rpcs[name] ? rpcs[name](args) : { data: null, error: { code: "PGRST202" } }; } };
}
const knowledgeRpc = () => {
  const proposals = [], log = [];
  const rpc = async (name, args) => {
    log.push(name);
    if (name === "makeborne_knowledge_review") throw Error("Never approve from CRM research");
    if (name !== "makeborne_knowledge_propose") return { data: null, error: { code: "PGRST202" } };
    proposals.push(args); return { data: { id: randomUUID(), status: "proposed", deduplicated: false }, error: null };
  };
  return { rpc, proposals, log };
};

let passed = 0, finished = false;
const keepAlive = setInterval(() => {}, 1000);
process.on("exit", code => { if (!finished && code === 0) { console.error("Harness ended before all checks ran."); process.exitCode = 1; } });
async function check(name, fn) { hits = []; await fn(); passed++; console.log(`PASS ${name}`); }
const W = randomUUID(), USER = randomUUID();

(async () => {
  await new Promise(done => fixture.listen(0, "127.0.0.1", done));
  port = fixture.address().port;

  await check("a good site: read with its pages, few findings, strengths cited, contacts cited with the exact page line", async () => {
    const out = await run("mlin.test");
    assert.equal(out.status, "checked"); assert.equal(out.finalUrl, "https://mlin.test/");
    assert.ok(out.score !== null && out.score < 20, `low opportunity for a good site (${out.score})`);
    assert.equal(out.band, "low");
    for (const id of ["https", "mobile", "cta", "form", "no_contact", "slow", "broken_links", "dated", "structured"]) assert.ok(!out.findings.some(item => item.id === id), `no ${id} finding`);
    assert.ok(out.strengths.some(item => item.id === "structured" && /Restaurant/.test(item.title)));
    assert.ok(out.pages.length >= 2 && out.pages.every(item => /^[a-f0-9]{64}$/.test(item.sha256) && item.fetchedAt));
    const phone = out.contacts.find(item => item.kind === "phone");
    assert.ok(phone && phone.evidence.quote === `Phone: ${phone.value}` && /^[a-f0-9]{64}$/.test(phone.evidence.sha256));
    assert.ok(out.notChecked.some(item => /Google Business Profile/.test(item)), "what wasn't checked is listed");
  });

  await check("an outdated site: every finding is measured on a page we read and cites url + checked-at + quote or measurement; broken link found", async () => {
    const out = await run("https://lana.test/");
    assert.equal(out.status, "checked");
    const ids = out.findings.map(item => item.id);
    for (const id of ["mobile", "cta", "form", "dated", "legacy", "structured", "broken_links", "description", "h1", "hours"]) assert.ok(ids.includes(id), `finds ${id} (${ids})`);
    assert.ok(!ids.includes("https") && !ids.includes("no_contact"), "https site with a phone number");
    assert.equal(out.links.broken.length, 1); assert.equal(out.links.broken[0].label, "Gallery");
    for (const finding of out.findings) {
      assert.ok(finding.evidence.url.startsWith("https://lana.test/") && Date.parse(finding.evidence.checkedAt), `${finding.id} cites the page and time`);
      assert.ok(finding.evidence.quote || finding.evidence.measured, `${finding.id} has a quote or measurement`);
      assert.equal(finding.points, score.FINDING_POINTS[finding.id].points);
    }
    const dated = out.findings.find(item => item.id === "dated");
    assert.equal(dated.evidence.quote, "© 2018"); assert.match(dated.detail, /© 2018/);
    assert.ok(out.score >= 45 && out.band === "strong", `strong opportunity (${out.score})`);
    assert.deepEqual(out.findings.map(item => item.level), [...out.findings.map(item => item.level)].sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a] - ({ high: 0, medium: 1, low: 2 })[b]), "most important first");
  });

  await check("slow, no-https and unreadable sites: slow is one labelled measurement; robots and private redirects are never read; no score without a read", async () => {
    const slow = await run("slow.test");
    assert.ok(slow.findings.some(item => item.id === "slow" && /one measurement from our server/.test(item.detail)), "slow measured and labelled");
    const plain = await run("http://plain.test/");
    assert.ok(plain.findings.some(item => item.id === "https" && item.level === "high"));
    const robots = await run("robots.test");
    assert.equal(robots.status, "inaccessible"); assert.equal(robots.reason, "robots"); assert.equal(robots.score, null); assert.equal(robots.findings.length, 0);
    assert.ok(!hits.includes("robots.test/"), "a disallowed home page is never requested");
    const jump = await run("jump.test");
    assert.equal(jump.reason, "private"); assert.ok(!hits.some(hit => hit.startsWith("intranet.test")), "never connects to the private target");
    const missing = await run("missing.test"); assert.equal(missing.reason, "not_found"); assert.equal(missing.band, "unknown");
    const none = await run(""); assert.equal(none.status, "no_website"); assert.equal(none.score, null); assert.match(none.summary, /confirm before you say so/);
    const social = await run("https://instagram.com/mlinbistro"); assert.equal(social.reason, "login", "social profiles are not read");
    // The production guard itself, with no fixture fetcher: private targets refused before any socket opens.
    for (const url of ["http://127.0.0.1/", "http://10.0.0.8/", "http://localhost/", "http://[::1]/", "https://user:pw@mlin.test/", "https://mlin.test:8443/"]) {
      const out = await siteCheck.checkWebsite(url, { deps: { resolve } });
      assert.ok(["private", "invalid"].includes(out.reason), `${url} refused (${out.reason})`);
    }
  });

  await check("fit score: deterministic, transparent points; do-not-contact and existing clients are hard stops", async () => {
    const out = await run("https://lana.test/");
    const input = { check: out, website: "https://lana.test/", email: "", phone: "035 555 0101", category: "Dentist", targets: ["dentist", "clinic"] };
    const a = score.fitScore(input), b = score.fitScore(JSON.parse(JSON.stringify(input)));
    assert.deepEqual(a, b, "same input, same score and reasons");
    assert.equal(a.score, Math.max(0, Math.min(100, a.reasons.reduce((sum, item) => sum + item.points, 0))), "score is the sum of its visible reasons");
    assert.ok(a.reasons.some(item => /Category you serve/.test(item.text)));
    assert.equal(score.fitScore({ website: "", email: "a@b.test" }).reasons[0].points, 40, "no website listed is the natural offer");
    assert.equal(score.fitScore({ ...input, suppressed: true }).tier, "excluded");
    const existing = score.fitScore({ ...input, existing: true });
    assert.equal(existing.tier, "excluded"); assert.ok(existing.score <= 10);
    assert.equal(score.fitScore({ check: { status: "inaccessible", score: null, reason: "robots" }, website: "x.test" }).reasons[0].points, 5, "an unreadable site never scores as an opportunity");
    // Same findings in any order give the same check score.
    const shuffled = score.scoreFindings([...out.findings].reverse());
    assert.deepEqual(shuffled.findings.map(item => item.id), out.findings.map(item => item.id)); assert.equal(shuffled.score, out.score);
  });

  await check("duplicates: domain, email, email domain, phone (from notes) and name; free mail and shared hosts don't match; dismissed pairs stay dismissed", async () => {
    const rows = [
      { id: "a", name: "Mlin Bistro d.o.o.", website: "https://www.mlin.test/", email: "" },
      { id: "b", name: "Mlin", website: "http://mlin.test", email: "info@mlin.test" },
      { id: "c", name: "Ana", email: "ana@gmail.com", notes: "Phone: +387 33 123 456" },
      { id: "d", name: "Ana Studio", email: "studio@gmail.com", notes: "Call 033 123 456\nPhone: 033 123 456" },
      { id: "e", name: "Mlin Bistro", website: "https://mlin-bistro.wixsite.com/home" },
      { id: "f", name: "Other", website: "https://shop.wixsite.com/x" },
    ];
    const pairs = match.duplicatePairs(rows);
    const find = (x, y) => pairs.find(pair => (pair.a === x && pair.b === y) || (pair.a === y && pair.b === x));
    assert.ok(find("a", "b").reasons.some(item => item.kind === "domain"), "www and scheme ignored");
    assert.equal(find("a", "b").strength, "strong");
    assert.ok(find("c", "d").reasons.some(item => item.kind === "phone"), "phones normalised on the last 8 digits");
    assert.ok(!find("c", "d").reasons.some(item => item.kind === "email_domain"), "gmail is not a business domain");
    assert.ok(find("a", "e").reasons.some(item => item.kind === "name") && find("a", "e").strength === "possible", "legal suffix ignored; name-only is possible");
    assert.ok(!find("e", "f"), "a shared host isn't a business domain");
    assert.ok(!match.duplicatePairs(rows, [["b", "a"]]).some(pair => pair.a === "a" && pair.b === "b"), "dismissal is order-insensitive");
    const matches = match.matchesFor({ id: "", name: "Mlin", website: "mlin.test", email: "" }, rows);
    assert.ok(matches.length >= 1 && matches[0].strength === "strong");
    assert.equal(match.normalizePhone("+387 (33) 123-456"), match.normalizePhone("033 123 456"));
  });

  await check("do-not-contact: email and whole domain (with subdomains); normalised; blocks drafts", async () => {
    const list = [match.normalizeSuppression("email", " Owner@Lana.test "), match.normalizeSuppression("domain", "https://www.mlin.test/contact")];
    assert.deepEqual(list.map(item => item.value), ["owner@lana.test", "mlin.test"]);
    assert.equal(match.normalizeSuppression("domain", "info@shop.mlin.test").value, "shop.mlin.test");
    assert.ok(match.suppressionFor(list, { email: "OWNER@lana.test" }));
    assert.ok(match.suppressionFor(list, { website: "https://booking.mlin.test" }));
    assert.ok(match.suppressionFor(list, { email: "x@mlin.test" }));
    assert.equal(match.suppressionFor(list, { email: "info@lana.test", website: "lana.test" }), null, "an email entry doesn't block the whole domain");
    assert.equal(match.normalizeSuppression("email", "not an email"), null);
    assert.throws(() => draftMod.openingDraft({ sender: { name: "Kerim" }, recipient: { name: "Lana" }, suppressed: true }), error => error.code === "SUPPRESSED");
  });

  await check("needs attention: overdue, no next step, stalled per stage from the activity log; closed deals ignored", async () => {
    const today = "2026-10-25";
    const stalled = { id: "1", name: "Lana", createdAt: "2026-08-01T10:00:00Z", outreach: { stage: "Proposal", nextFollowUp: "2026-10-20", activity: [{ at: "2026-08-02T10:00:00Z", text: "Stage: Lead → Contacted" }, { at: "2026-09-30T09:00:00Z", text: "Stage: Conversation → Proposal" }] } };
    const items = pipeline.attentionFor(stalled, today);
    assert.deepEqual(items.map(item => item.kind).sort(), ["overdue", "stalled"]);
    assert.equal(items.find(item => item.kind === "overdue").days, 5);
    assert.equal(pipeline.stageSince(stalled), "2026-09-30T09:00:00Z");
    assert.deepEqual(pipeline.attentionFor({ id: "2", name: "New", createdAt: "2026-10-24T08:00:00Z", outreach: { stage: "Lead", nextFollowUp: null, activity: [] } }, today).map(item => item.kind), ["no_next_step"]);
    assert.deepEqual(pipeline.attentionFor({ id: "3", name: "Won", outreach: { stage: "Won", nextFollowUp: "2026-01-01" } }, today), []);
    const fresh = { id: "4", name: "Fresh", createdAt: "2026-08-01T00:00:00Z", outreach: { stage: "Contacted", nextFollowUp: "2026-10-30", lastContact: "2026-10-24", activity: [] } };
    assert.deepEqual(pipeline.attentionFor(fresh, today), [], "a recent contact resets the stall clock");
    const list = pipeline.needsAttention([fresh, stalled, { id: "2", name: "New", outreach: { stage: "Lead" } }], today);
    assert.deepEqual(list.map(item => item.id), ["1", "2"], "most urgent first");
    assert.equal(pipeline.cleanNextStep("  Send <b>quote</b>\n"), "Send b quote /b");
  });

  await check("timeline: every source merged newest first, missing sources simply absent", async () => {
    const events = timeline.buildTimeline({
      activity: [{ id: "a1", at: "2026-10-01T10:00:00Z", text: "Stage: Lead → Contacted", type: "update" }],
      emails: [{ id: "m1", direction: "out", status: "sent", subject: "Hello", created_at: "2026-10-02T10:00:00Z", sent_at: "2026-10-02T10:01:00Z" }, { id: "m2", direction: "in", status: "received", subject: "Re: Hello", created_at: "2026-10-03T10:00:00Z" }],
      reviews: [{ id: "r1", created_at: "2026-10-04T10:00:00Z", recipient_name: "Lana", decision: "approved", decided_at: "2026-10-05T10:00:00Z", decision_name: "Lana", project_title: "Clinic site" }],
      projects: [{ id: "p1", title: "Clinic site", kind: "website", created_at: "2026-10-03T12:00:00Z" }],
      facts: [{ id: "f1", label: "Phone", status: "approved", created_at: "2026-10-06T10:00:00Z", approved_at: "2026-10-07T10:00:00Z" }],
      checks: [{ id: "c1", checked_at: "2026-09-30T10:00:00Z", status: "checked", score: 62, url: "https://lana.test/" }],
    });
    assert.deepEqual(events.map(item => item.kind), ["fact", "fact", "review_decision", "review_sent", "project", "email_in", "email_out", "outreach", "site_check"]);
    assert.equal(timeline.buildTimeline({}).length, 0);
    assert.ok(events.every(item => !/[<>]/.test(item.detail)));
  });

  await check("honest first email: only measured findings and approved facts, sender identity, opt-out; polish refused until qualified and guarded with a fake", async () => {
    const out = await run("https://lana.test/");
    const draft = draftMod.openingDraft({ sender: { name: "Kerim Sabic", business: "Horalix Studio" }, recipient: { name: "Lana Hadžić", company: "Dental Studio Lana", email: "info@lana.test" },
      check: { status: out.status, checkedAt: "2026-10-25T09:00:00Z", host: out.host, findings: out.findings }, facts: [{ id: "k1", label: "Opening hours", valueText: "Mon–Fri 08:00–16:00" }] });
    assert.match(draft.body, /^Hi Lana,/); assert.match(draft.body, /I'm Kerim Sabic from Horalix Studio\./); assert.ok(draft.body.includes(draftMod.OPT_OUT));
    assert.match(draft.body, /When I looked at lana\.test on 25 Oct/);
    assert.equal(draft.uses.filter(item => item.kind === "finding").length, 3, "at most three findings");
    for (const use of draft.uses.filter(item => item.kind === "finding")) assert.ok(out.findings.some(item => item.id === use.ref));
    assert.ok(draft.body.includes("Opening hours: Mon–Fri 08:00–16:00"));
    // Nothing numeric beyond the check date and the approved fact.
    const numbers = draft.body.match(/\d+/g) ?? [];
    assert.ok(numbers.every(value => ["25", "08", "00", "16"].includes(value)), `no invented figures (${numbers})`);
    assert.ok(!/revenue|followers|customers per|% more|guarantee/i.test(draft.body));
    const noCheck = draftMod.openingDraft({ sender: { name: "Kerim" }, recipient: { name: "Lana" } });
    assert.ok(!/When I looked/.test(noCheck.body) && noCheck.warnings.some(item => /No website check/.test(item)));
    const refused = await draftMod.polishDraft(draft);
    assert.equal(refused.polished, false); assert.equal(refused.draft, draft);
    const honest = { qualified: true, polish: async value => ({ subject: value.subject, body: value.body.replace("These are quick to fix", "Each of these is quick to fix") }) };
    assert.equal((await draftMod.polishDraft(draft, honest)).polished, true);
    const inventive = { qualified: true, polish: async value => ({ subject: value.subject, body: `${value.body}\nClients like you see 40% more bookings.` }) };
    const blocked = await draftMod.polishDraft(draft, inventive);
    assert.equal(blocked.polished, false); assert.ok(blocked.problems.some(item => /40%/.test(item)));
    const dropsOptOut = { qualified: true, polish: async value => ({ subject: value.subject, body: value.body.replace(draftMod.OPT_OUT, "") }) };
    assert.ok((await draftMod.polishDraft(draft, dropsOptOut)).problems.some(item => /opt-out/.test(item)));
  });

  await check("check → PROPOSED facts: contacts and findings cite url + fetched_at + sha256 (+ exact line); all valid knowledge proposals; unreadable sites propose nothing", async () => {
    const out = await run("mlin.test");
    const proposals = facts.proposalsFromCheck(out);
    assert.ok(proposals.length >= 2);
    for (const proposal of proposals) {
      const canonical = canonicalProposal(proposal);
      assert.equal(canonical.kind, "observed_fact");
      assert.equal(canonical.evidence[0].kind, "url"); assert.match(canonical.evidence[0].sha256, /^[a-f0-9]{64}$/); assert.ok(Date.parse(canonical.evidence[0].fetchedAt));
    }
    const phone = proposals.find(item => item.key === "contact.phone");
    assert.ok(phone && phone.evidence[0].quote === `Phone: ${phone.valueText}`);
    const lana = facts.proposalsFromCheck(await run("https://lana.test/"));
    assert.ok(lana.some(item => item.key === "website.issue.mobile"));
    assert.equal(facts.proposalsFromCheck(await run("robots.test")).length, 0);
  });

  await check("lead → client: duplicate and do-not-contact refusals first, idempotent create, check attached, facts PROPOSED (never approved), lead source and follow-up set", async () => {
    const db = fakeDb({ clients: [{ id: randomUUID(), workspace_id: W, name: "Mlin Bistro", website: "https://mlin.test/", email: "", notes: "", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", outreach: null }] });
    const out = await run("https://lana.test/");
    const checkId = await server.storeCheck(db.rpc, { workspaceId: W, userId: USER, clientId: null, check: out });
    const stored = db.tables.crm_site_checks[0];
    assert.ok(stored.expires_at && Date.parse(stored.expires_at) - Date.parse(out.checkedAt) <= 31 * 86_400_000, "a prospect check expires");
    assert.ok(db.calls.includes("rpc:makeborne_crm_site_check_save") && !db.calls.includes("insert:crm_site_checks"), "stored by the server-only function, never a browser-style insert");
    assert.equal(stored.created_by, USER);
    // A refusal from the database becomes a plain error, never a silent success.
    await assert.rejects(server.storeCheck(async () => ({ data: null, error: { code: "42501" } }), { workspaceId: W, userId: USER, clientId: null, check: out }), error => error.status === 403);
    await assert.rejects(server.storeCheck(async () => ({ data: null, error: { code: "22023" } }), { workspaceId: W, userId: USER, clientId: null, check: out }), error => error.code === "CHECK_NOT_SAVED");
    const k = knowledgeRpc();
    const prospect = server.ProspectSchema.parse({ name: "Dental Studio Lana", website: "lana.test", phone: "035 555 0101", category: "Dentist", source: "Lead finder", tag: "dentists tuzla" });
    // A business already in the CRM is refused until confirmed.
    await assert.rejects(server.addProspect(db, { workspaceId: W, userId: USER, requestKey: randomUUID(), prospect: server.ProspectSchema.parse({ name: "Mlin", website: "https://www.mlin.test" }), checkId: null, allowDuplicate: false, today: "2026-10-25", rpc: k.rpc }),
      error => error.code === "POSSIBLE_DUPLICATE" && error.details.matches[0].reasons.some(item => item.kind === "domain"));
    // Do-not-contact blocks adding, whatever the duplicate setting.
    db.tables.crm_suppressions.push({ id: randomUUID(), workspace_id: W, kind: "domain", value: "lana.test", reason: "asked" });
    await assert.rejects(server.addProspect(db, { workspaceId: W, userId: USER, requestKey: randomUUID(), prospect, checkId, allowDuplicate: true, today: "2026-10-25", rpc: k.rpc }), error => error.code === "CONTACT_SUPPRESSED");
    db.tables.crm_suppressions = [];
    const key = randomUUID();
    const first = await server.addProspect(db, { workspaceId: W, userId: USER, requestKey: key, prospect, checkId, allowDuplicate: false, today: "2026-10-25", rpc: k.rpc });
    assert.equal(first.replayed, false); assert.equal(first.attached, true); assert.ok(first.knowledge.proposed >= 3);
    const created = db.tables.clients.find(row => row.id === first.clientId);
    assert.equal(created.website, "https://lana.test/"); assert.equal(created.lead_source, "Lead finder"); assert.deepEqual(created.tags, ["dentists tuzla"]);
    assert.equal(created.outreach.stage, "Lead"); assert.equal(created.outreach.nextFollowUp, "2026-10-25"); assert.equal(created.outreach.channel, "Phone");
    assert.match(created.notes, /Phone: 035 555 0101/); assert.match(created.notes, /Website check .*room to improve/);
    assert.equal(stored.client_id, first.clientId); assert.equal(stored.expires_at, null, "an attached check is kept with the client");
    assert.ok(k.proposals.every(item => item.p_operation === null && item.p_actor === USER && item.p_client === first.clientId));
    assert.ok(k.proposals.every(item => item.p_evidence.every(evidence => evidence.kind === "url" && /^[a-f0-9]{64}$/.test(evidence.sha256))));
    assert.ok(!k.log.includes("makeborne_knowledge_review"));
    // Replay with the same key: no second client, no second proposal round, the check can't be reused.
    const count = db.tables.clients.length, proposalCount = k.proposals.length;
    await assert.rejects(server.addProspect(db, { workspaceId: W, userId: USER, requestKey: key, prospect, checkId, allowDuplicate: true, today: "2026-10-25", rpc: k.rpc }), error => error.code === "CHECK_ALREADY_USED");
    const replay = await server.addProspect(db, { workspaceId: W, userId: USER, requestKey: key, prospect, checkId: null, allowDuplicate: true, today: "2026-10-25", rpc: k.rpc });
    assert.equal(replay.replayed, true); assert.equal(replay.clientId, first.clientId); assert.equal(db.tables.clients.length, count); assert.equal(k.proposals.length, proposalCount);
    // Knowledge off: the client is still added, nothing is proposed.
    process.env.MAKEBORNE_CLIENT_KNOWLEDGE = "off";
    const plain = await server.addProspect(db, { workspaceId: W, userId: USER, requestKey: randomUUID(), prospect: server.ProspectSchema.parse({ name: "Plain Bistro", website: "plain.test" }), checkId: await server.storeCheck(db.rpc, { workspaceId: W, userId: USER, clientId: null, check: await run("http://plain.test/") }), allowDuplicate: false, today: "2026-10-25", rpc: k.rpc });
    assert.equal(plain.knowledge.available, false); assert.equal(plain.knowledge.proposed, 0); assert.equal(k.proposals.length, proposalCount);
    process.env.MAKEBORNE_CLIENT_KNOWLEDGE = "on";
    // A permission change mid-way stops proposing.
    const denied = await server.proposeFacts(async () => ({ data: null, error: { code: "42501" } }), { actorId: USER, workspaceId: W, clientId: first.clientId }, facts.proposalsFromCheck(out));
    assert.equal(denied.stopped, "PERMISSION_CHANGED"); assert.equal(denied.proposed, 0);
  });

  await check("daily limit (S12): a website check takes one use after the busy checks and before any page is read; a refusal reads nothing; both routes take it", async () => {
    const order = [];
    const out = await server.guardedCheck(USER, "https://lana.test/", deps, async () => { order.push(hits.length); });
    assert.equal(out.status, "checked"); assert.deepEqual(order, [0], "taken before the first request");
    hits = [];
    const refuse = server.siteCheckAdmission(async () => ({ data: { allowed: false, limit: 100, used: 100 }, error: null }), USER, W);
    await assert.rejects(server.guardedCheck(USER, "https://lana.test/", deps, refuse), error => error.code === "DAILY_LIMIT" && error.status === 429 && /100 website checks/.test(error.message));
    assert.equal(hits.length, 0, "no page read after a refusal");
    // Busy refusals come first and use nothing; the slot is released after a refusal.
    let taken = 0;
    const slow = server.guardedCheck(USER, "https://lana.test/", deps, async () => { taken++; });
    await assert.rejects(server.guardedCheck(USER, "https://mlin.test/", deps, async () => { taken++; }), error => error.code === "CHECK_BUSY");
    await slow; assert.equal(taken, 1);
    const calls = [];
    await server.siteCheckAdmission(async (name, args) => { calls.push([name, args]); return { data: { allowed: true }, error: null }; }, USER, W)();
    assert.deepEqual(calls, [["makeborne_research_daily_take", { p_actor: USER, p_workspace: W, p_kind: "site_check" }]]);
    const app = path.join(__dirname, "../../app/api/cloud/workspaces/[workspaceId]");
    for (const file of ["crm/route.ts", "clients/[clientId]/crm/route.ts"])
      assert.match(fs.readFileSync(path.join(app, file), "utf8"), /guardedCheck\(user\.id, [^)]*\|\| null, undefined, siteCheckAdmission\(serviceRpc\(\), user\.id, workspaceId\)\)/, `${file} takes a daily use`);
  });

  await check("small writes: suppression normalised and idempotent, dismissal ordered, next-step conflict surfaces as 409", async () => {
    const db = fakeDb();
    await server.addSuppression(db, W, USER, "email", "Owner@Lana.Test", "asked <not> to be contacted");
    await server.addSuppression(db, W, USER, "email", "owner@lana.test", "again");
    assert.equal(db.tables.crm_suppressions.length, 1); assert.equal(db.tables.crm_suppressions[0].reason, "asked not to be contacted");
    await assert.rejects(server.addSuppression(db, W, USER, "domain", "!!!", ""), error => error.code === "INVALID_CONTACT");
    const a = randomUUID(), b = randomUUID();
    await server.dismissDuplicate(db, W, USER, b, a);
    assert.equal(db.tables.crm_duplicate_dismissals[0].client_a, a < b ? a : b);
    await assert.rejects(server.dismissDuplicate(db, W, USER, a, a), error => error.code === "INVALID_PAIR");
    const conflict = { rpc: async () => ({ data: null, error: { code: "PT409" } }) };
    await assert.rejects(server.setNextStep(conflict, W, a, "Send quote", 3), error => error.code === "NEXT_STEP_CHANGED" && error.status === 409);
    await assert.rejects(server.removeRow(db, "crm_site_checks", W, randomUUID()), error => error.status === 404);
  });

  await check("boundaries: flag off by default; every handler checks it first; editors only for writes; nothing sends mail or approves; no provider or model names in customer copy", async () => {
    assert.equal(server.crmResearchEnabled({}), false); assert.equal(server.crmResearchEnabled({ MAKEBORNE_CRM_RESEARCH: "true" }), false); assert.equal(server.crmResearchEnabled({ MAKEBORNE_CRM_RESEARCH: "on" }), true);
    assert.throws(() => server.requireCrmResearch({}), error => error.status === 404);
    assert.throws(() => server.requireEditor("reviewer"), error => error.status === 403); server.requireEditor("editor");
    const app = path.join(__dirname, "../../app/api/cloud/workspaces/[workspaceId]");
    for (const file of [path.join(app, "crm/route.ts"), path.join(app, "clients/[clientId]/crm/route.ts")]) {
      const source = fs.readFileSync(file, "utf8");
      const handlers = source.split(/export async function /).slice(1);
      assert.ok(handlers.length >= 2);
      for (const handler of handlers) assert.match(handler.split("\n").slice(0, 3).join("\n"), /requireCrmResearch\(\);/, `${file} checks the flag first`);
      const post = handlers.find(handler => handler.startsWith("POST"));
      assert.match(post, /requireEditor\(workspace\?\.role\)/, "writes are for owners and editors");
    }
    const lib = fs.readdirSync(__dirname).filter(file => file.endsWith(".ts")).map(file => fs.readFileSync(path.join(__dirname, file), "utf8")).join("\n");
    assert.ok(!/sendEmail|mail\/engine|\/mail\b.*POST|knowledge_review|publish\(/.test(lib), "no sending, approving or publishing");
    const ui = ["crm/crm-insights.tsx", "crm/client-crm.tsx", "crm/website-check-card.tsx", "crm/lead-website-check.tsx"].map(file => path.join(__dirname, "../../components", file)).map(file => fs.readFileSync(file, "utf8"));
    const customer = [...ui, JSON.stringify(siteCheck.NOT_CHECKED), lib.match(/"[^"\n]{12,}"/g).join("\n")].join("\n");
    assert.ok(!/claude|anthropic|openai|\bgpt|sonnet|opus|haiku|gemini|\bllm\b/i.test(customer), "customer copy names no provider or model");
    const sql = fs.readFileSync(path.join(__dirname, "../../../supabase/migrations/20261025300000_crm_research.sql"), "utf8");
    assert.ok(!/supabase db push/.test(sql) && /enable row level security/.test(sql));
    assert.deepEqual([...sql.matchAll(/kind in \('email','domain'\)/g)].length, 1);
    // S9: checks are inserted only by the server; next steps change only through the compare-and-set function.
    const writes = fs.readFileSync(path.join(__dirname, "../../../supabase/migrations/20261026120000_crm_server_writes.sql"), "utf8");
    assert.match(writes, /revoke insert on public\.crm_site_checks from authenticated;/);
    assert.match(writes, /revoke insert, update, delete on public\.crm_next_steps from authenticated;/);
    assert.match(writes, /grant execute on function public\.makeborne_crm_site_check_save\(uuid, uuid, uuid, jsonb\) to service_role;/);
    assert.ok(!/makeborne_crm_site_check_save[^;]*to authenticated/.test(writes), "the browser cannot call the save");
    assert.ok(!/from\("crm_site_checks"\)\.insert|from\("crm_next_steps"\)\.(insert|update|upsert)/.test(lib), "no direct check insert or next-step write in the server code");
  });

  await check("journey audit 26 Oct: a business is never greeted by its first word, a missing sender name never reads \"I'm I.\", match reasons say which key matched, overviews name clients as the list does", async () => {
    const at = { status: "checked", checkedAt: "2026-10-26T09:00:00Z", host: "oliveandthyme.test", findings: [{ id: "mobile", title: "Not built for phones", detail: "", level: "high" }] };
    // The real reproduction: a client named after the business, a signed-in person without a display name.
    const olive = draftMod.openingDraft({ sender: { name: "" }, recipient: { name: "Olive & Thyme Deli", company: "Olive & Thyme Ltd", email: "hello@oliveandthyme.test" }, check: at });
    assert.match(olive.body, /^Hi there,/); assert.doesNotMatch(olive.body, /I'm I\.|\nI$/);
    assert.match(olive.body, /I'm \[your name\]\./); assert.match(olive.body, /Best,\n\[your name\]/);
    assert.ok(olive.warnings.some(item => /\[your name\]/.test(item)), "the person is told to add their name");
    for (const [name, company, hello] of [["Saffron Table", "", "there"], ["North Street Barbers", "North Street Barbers", "there"], ["Bright Smile Dental", "Bright Smile Dental Care", "there"], ["Rana Haddad", "Saffron Table", "Rana"], ["Lana Hadžić", "Dental Studio Lana", "Lana"], ["rana", "Saffron Table", "there"]])
      assert.match(draftMod.openingDraft({ sender: { name: "Kerim" }, recipient: { name, company } }).body, new RegExp(`^Hi ${hello},`), `${name} / ${company}`);
    assert.match(draftMod.openingDraft({ sender: { name: "Kerim Sabic", business: "Horalix Studio" }, recipient: { name: "Rana Haddad", company: "Saffron Table" } }).body, /I'm Kerim Sabic from Horalix Studio\.\n[\s\S]*Best,\nKerim Sabic\nHoralix Studio$/);
    // Email at a client's website domain is reported as such, not as "Same website".
    const reasons = match.matchReasons({ id: "n", name: "Olive and Thyme", email: "orders@oliveandthyme.test", website: "http://localhost:3061/" }, { id: "o", name: "Olive & Thyme Deli", company: "Olive & Thyme Ltd", website: "https://oliveandthyme.test" });
    assert.ok(reasons.some(item => item.kind === "domain" && /email/i.test(item.text) && item.text.includes("oliveandthyme.test")), JSON.stringify(reasons));
    assert.ok(!reasons.some(item => item.text.startsWith("Same website")));
    assert.ok(match.matchReasons({ id: "x", name: "A", website: "https://olive.test" }, { id: "y", name: "B", website: "olive.test" }).some(item => item.text === "Same website (olive.test)"));
    // Needs attention, duplicates and do-not-contact name each client as the client list does (name first).
    const ws = randomUUID(), rows = [
      { id: randomUUID(), workspace_id: ws, name: "Olive & Thyme Deli", company: "Olive & Thyme Ltd", email: "hello@oliveandthyme.test", website: "https://oliveandthyme.test", notes: "", outreach: { stage: "Lead" }, created_at: "2026-10-20T00:00:00Z" },
      { id: randomUUID(), workspace_id: ws, name: "Olive and Thyme", company: "", email: "orders@oliveandthyme.test", website: "", notes: "", outreach: { stage: "Lead" }, created_at: "2026-10-21T00:00:00Z" },
    ];
    const db = fakeDb({ clients: rows, crm_suppressions: [{ id: randomUUID(), workspace_id: ws, kind: "email", value: "hello@oliveandthyme.test", created_at: "2026-10-22T00:00:00Z" }] });
    const view = await server.overview(db, ws, "2026-10-26");
    assert.ok(view.attention.some(item => item.name === "Olive & Thyme Deli" && item.company === "Olive & Thyme Ltd"));
    assert.deepEqual(view.suppressedClients.map(item => item.name), ["Olive & Thyme Deli"]);
    assert.ok(view.duplicates.some(pair => [pair.aName, pair.bName].includes("Olive & Thyme Deli")), JSON.stringify(view.duplicates));
    const insights = fs.readFileSync(path.join(__dirname, "../../components/crm/crm-insights.tsx"), "utf8");
    assert.match(insights, /<strong>\{item\.name \|\| item\.company\}<\/strong>/, "the attention list leads with the client's name");
  });

  finished = true;
  console.log(`\n${passed} CRM research checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { clearInterval(keepAlive); fixture.closeAllConnections?.(); fixture.close(); });
