/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for customer custom domains (hostname rules, DNS records, Cloudflare client, routes). */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const src = path.join(__dirname, "..", "..");
// Route dependencies that need Next.js or a database are replaced with recorders (see the route checks below).
const db = { row: null, updates: [], reads: [] };
const route = { role: "owner" };
const stubs = {
  "server-only": {},
  "@/lib/cloud/server": {
    cloudContext: async workspaceId => ({ workspace: { id: workspaceId, role: route.role } }),
    cloudJson: (value, status = 200) => Response.json(value, { status }),
    cloudError: error => Response.json({ error: { code: error.code ?? "UNKNOWN", message: error.message } }, { status: error.status ?? 500 }),
    databaseError: error => { if (error) throw Object.assign(new Error("database"), { status: 500 }); },
    validId: value => { if (!/^[0-9a-f-]{36}$/.test(value)) throw Object.assign(new Error("Choose a valid workspace or record."), { code: "INVALID_ID", status: 400 }); return value; },
  },
  "@/lib/billing/database": {
    billingDatabase: () => ({ from: table => {
      assert.equal(table, "custom_domains");
      const filters = {};
      const query = {
        select: () => query,
        eq: (column, value) => { filters[column] = value; return query; },
        maybeSingle: async () => { db.reads.push({ ...filters }); const row = db.row && Object.entries(filters).every(([column, value]) => db.row[column] === value) ? db.row : null; return { data: row, error: null }; },
        update: patch => ({ eq: (column, value) => ({ select: () => ({ single: async () => {
          assert.equal(column, "id"); assert.equal(value, db.row.id); db.updates.push(patch); db.row = { ...db.row, ...patch }; return { data: db.row, error: null };
        } }) }) }),
      };
      return query;
    } }),
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
const { checkHostname, dnsRecords, dnsZone, domainState, statusLabel, customDomainConfig, cloudflareHostnames, CloudflareError } = require("./custom-domains.ts");
const { domainView } = require("./custom-domain-view.ts");

let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
const config = { zoneId: "0123456789abcdef0123456789abcdef", token: "t".repeat(40), target: "customers.makeborne.site" };

(async () => {
  await check("hostnames are cleaned up from what people paste", () => {
    for (const [input, hostname, apex] of [["https://www.MyBakery.com/menu?x=1", "www.mybakery.com", false], ["mybakery.com.", "mybakery.com", true], ["  Shop.Ovenbird.co.uk ", "shop.ovenbird.co.uk", false], ["ovenbird.co.uk", "ovenbird.co.uk", true], ["bäckerei.de", "xn--bckerei-5wa.de", true], ["www.studio.agency", "www.studio.agency", false]]) {
      const result = checkHostname(input);
      assert.deepEqual(result, { ok: true, hostname, apex }, input);
    }
  });

  await check("unsafe, reserved and malformed domains are refused", () => {
    for (const input of ["", "localhost", "10.0.0.1", "http://[::1]/", "bakery", "my bakery.com", "user:pass@bakery.com", "bakery.com:8443", "-bad.com", "bad-.com", "a..com", "shop.makeborne.site", "makeborne.com", "www.makeborne.com", "example.com", "x.internal", "bakery.123", `${"a".repeat(64)}.com`, `${"a.".repeat(130)}com`, "bakery.test"])
      assert.equal(checkHostname(input).ok, false, input);
    assert.equal(checkHostname("ovenbird.test", { allowTest: true }).ok, true, ".test only when explicitly allowed (local)");
  });

  await check("DNS records: one CNAME for subdomains, ALIAS guidance for root domains, plus optional ownership TXT", () => {
    assert.deepEqual(dnsRecords("www.mybakery.com", false, config.target).map(record => [record.type, record.name, record.value]), [["CNAME", "www", "customers.makeborne.site"]]);
    const root = dnsRecords("mybakery.com", true, config.target, [{ type: "TXT", name: "_cf-custom-hostname.mybakery.com", value: "abc", purpose: "x" }]);
    assert.deepEqual(root.map(record => record.type), ["ALIAS", "TXT"]);
    assert.match(root[0].purpose, /connect www instead/);
    assert.deepEqual(root.map(record => [record.name, record.fqdn, record.zone]), [["@", "mybakery.com", "mybakery.com"], ["_cf-custom-hostname", "_cf-custom-hostname.mybakery.com", "mybakery.com"]]);
  });

  await check("nested hostnames get their exact full name and the whole zone-relative name, never just the first label", () => {
    for (const [hostname, name, zone] of [
      ["www.mybakery.com", "www", "mybakery.com"],
      ["shop.eu.mybakery.com", "shop.eu", "mybakery.com"],
      ["a.b.c.mybakery.com", "a.b.c", "mybakery.com"],
      ["menu.shop.ovenbird.co.uk", "menu.shop", "ovenbird.co.uk"],
      ["shop.ovenbird.co.uk", "shop", "ovenbird.co.uk"],
    ]) {
      const checked = checkHostname(hostname);
      assert.equal(checked.ok && checked.apex, false, hostname);
      const [record] = dnsRecords(checked.hostname, checked.apex, config.target);
      assert.deepEqual({ type: record.type, name: record.name, fqdn: record.fqdn, zone: record.zone }, { type: "CNAME", name, fqdn: hostname, zone }, hostname);
      assert.equal(`${record.name}.${record.zone}`, record.fqdn, "name + zone is exactly the hostname");
      assert.equal(dnsZone(hostname), zone);
    }
    const nestedTxt = dnsRecords("shop.eu.mybakery.com", false, config.target, [{ type: "TXT", name: "_cf-custom-hostname.shop.eu.mybakery.com", value: "uuid", purpose: "x" }])[1];
    assert.deepEqual([nestedTxt.name, nestedTxt.fqdn, nestedTxt.zone], ["_cf-custom-hostname.shop.eu", "_cf-custom-hostname.shop.eu.mybakery.com", "mybakery.com"]);
  });

  await check("Cloudflare states map to plain statuses", () => {
    assert.equal(domainState({ id: "1", hostname: "h", status: "active", ssl: { status: "active" } }).status, "active");
    assert.equal(domainState({ id: "1", hostname: "h", status: "active", ssl: { status: "pending_validation" } }).status, "pending");
    assert.equal(domainState({ id: "1", hostname: "h", status: "pending", ssl: { status: "initializing" } }).status, "pending");
    const blocked = domainState({ id: "1", hostname: "h", status: "blocked", verification_errors: ["custom hostname does not CNAME to this zone."] });
    assert.deepEqual([blocked.status, blocked.error], ["failed", "custom hostname does not CNAME to this zone."]);
    const withTxt = domainState({ id: "1", hostname: "h", status: "pending", ownership_verification: { type: "txt", name: "_cf-custom-hostname.h", value: "uuid" } });
    assert.deepEqual(withTxt.extra.map(record => record.type), ["TXT"]);
    assert.equal(statusLabel("pending", "pending_issuance").label, "Securing");
    assert.equal(statusLabel("pending", "pending_validation").label, "Waiting for DNS");
    assert.equal(statusLabel("active", "active").label, "Live");
  });

  await check("certificate states are truthful: progress spins, timeouts, expiry, removal and unknown values stop and say what to do", () => {
    const table = [
      ["active", "active", "live", false, "Live"],
      ["pending", null, "waiting", true, "Waiting for DNS"], ["pending", "initializing", "waiting", true, "Waiting for DNS"], ["pending", "pending_validation", "waiting", true, "Waiting for DNS"],
      ["pending", "active", "waiting", true, "Waiting for DNS"],
      ["pending", "pending_issuance", "securing", true, "Securing"], ["pending", "pending_deployment", "securing", true, "Securing"], ["pending", "staging_deployment", "securing", true, "Securing"],
      ["pending", "validation_timed_out", "timed_out", false, "Certificate setup stopped"], ["pending", "initializing_timed_out", "timed_out", false, "Certificate setup stopped"],
      ["pending", "issuance_timed_out", "timed_out", false, "Certificate setup stopped"], ["pending", "deployment_timed_out", "timed_out", false, "Certificate setup stopped"],
      ["pending", "pending_expiration", "expiring", false, "Certificate expiring"], ["pending", "expired", "expired", false, "Certificate expired"],
      ["pending", "deleted", "removed", false, "Certificate removed"], ["pending", "revoked", "removed", false, "Certificate removed"], ["pending", "deactivating", "removed", false, "Certificate removed"],
      ["pending", "brand_new_state", "unknown", false, "Status unknown"],
      ["failed", "validation_timed_out", "failed", false, "Needs attention"], ["failed", null, "failed", false, "Needs attention"],
    ];
    for (const [status, ssl, phase, inProgress, label] of table) {
      const result = statusLabel(status, ssl);
      assert.deepEqual([result.phase, result.inProgress, result.label], [phase, inProgress, label], `${status}/${ssl}`);
      if (!inProgress && phase !== "live") assert.doesNotMatch(result.detail, /usually takes a few minutes|being issued/, `${ssl} is not normal progress`);
    }
    const timedOut = statusLabel("pending", "validation_timed_out").detail;
    assert.match(timedOut, /stopped trying/); assert.match(timedOut, /record below/); assert.match(timedOut, /doesn't restart certificate setup/, "Check now is not presented as a retry");
    assert.match(timedOut, /remove the domain and connect it again/); assert.match(timedOut, /contact support/);
    assert.match(statusLabel("pending", "brand_new_state").detail, /“brand_new_state”/);
    assert.doesNotMatch(statusLabel("pending", "<script>x").detail, /<script>/, "only plain identifiers are echoed");
    // Both must be active: a timed-out or expired certificate never makes the domain live.
    for (const ssl of ["validation_timed_out", "expired", "pending_expiration", "deleted", "brand_new_state", null])
      assert.equal(domainState({ id: "1", hostname: "h", status: "active", ssl: { status: ssl ?? undefined } }).status, "pending", String(ssl));
    assert.equal(domainState({ id: "1", hostname: "h", status: "pending", ssl: { status: "active" } }).status, "pending");
    const odd = domainState({ id: "1", hostname: "h", status: "mystery_state", ssl: { status: "pending_validation" } });
    assert.equal(odd.status, "pending"); assert.match(odd.error, /don't recognise \(“mystery_state”\)/);
    assert.equal(domainState({ id: "1", hostname: "h", status: "pending", ssl: { status: "pending_validation" } }).error, null, "known statuses add no note");
  });

  await check("configuration fails closed unless every value is valid", () => {
    assert.deepEqual(customDomainConfig({ CLOUDFLARE_SAAS_ZONE_ID: config.zoneId, CLOUDFLARE_SAAS_API_TOKEN: config.token, MAKEBORNE_CUSTOM_DOMAIN_TARGET: "Customers.Makeborne.Site" }), config);
    for (const env of [{}, { CLOUDFLARE_SAAS_ZONE_ID: "nope", CLOUDFLARE_SAAS_API_TOKEN: config.token, MAKEBORNE_CUSTOM_DOMAIN_TARGET: config.target }, { CLOUDFLARE_SAAS_ZONE_ID: config.zoneId, CLOUDFLARE_SAAS_API_TOKEN: "short", MAKEBORNE_CUSTOM_DOMAIN_TARGET: config.target }, { CLOUDFLARE_SAAS_ZONE_ID: config.zoneId, CLOUDFLARE_SAAS_API_TOKEN: config.token, MAKEBORNE_CUSTOM_DOMAIN_TARGET: "not a host" }])
      assert.equal(customDomainConfig(env), null);
  });

  await check("the Cloudflare client sends the right request and surfaces errors without leaking the token", async () => {
    const calls = [];
    const fake = async (url, init) => {
      calls.push({ url, init });
      if (init.method === "POST") return new Response(JSON.stringify({ success: true, errors: [], result: { id: "cf-1", hostname: "www.mybakery.com", status: "pending", ssl: { status: "initializing" } } }), { status: 200 });
      if (init.method === "GET") return new Response(JSON.stringify({ success: false, errors: [{ code: 1436, message: "Custom hostname not found" }] }), { status: 404 });
      return new Response(JSON.stringify({ success: false, errors: [{ code: 1405, message: "Duplicate custom hostname found." }] }), { status: 409 });
    };
    const client = cloudflareHostnames(config, fake);
    const created = await client.create("www.mybakery.com");
    assert.equal(created.id, "cf-1");
    assert.equal(calls[0].url, `https://api.cloudflare.com/client/v4/zones/${config.zoneId}/custom_hostnames`);
    assert.deepEqual(JSON.parse(calls[0].init.body), { hostname: "www.mybakery.com", ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } } });
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${config.token}`); assert.equal(calls[0].init.redirect, "error");
    await assert.rejects(client.get("cf-1"), error => error instanceof CloudflareError && error.status === 404 && !error.message.includes(config.token));
    await client.remove("gone").catch(() => assert.fail("a 409 is not a 404")).catch(() => undefined);
    const removed = cloudflareHostnames(config, async () => new Response(JSON.stringify({ success: false, errors: [{ message: "not found" }] }), { status: 404 }));
    await removed.remove("cf-1");
    await assert.rejects(cloudflareHostnames(config, async () => new Response("<html>", { status: 502 })).create("www.mybakery.com"), /unexpected response/);
  });

  await check("the browser view hides Cloudflare internals and keeps only well-formed records", () => {
    const view = domainView(config.target)({ id: "d1", hostname: "www.mybakery.com", status: "pending", ssl_status: null, error: null, created_at: "2026-10-14T10:00:00Z", last_checked_at: null, cloudflare_id: "cf-secret",
      verification: [{ type: "CNAME", name: "www", value: "old.target", purpose: "p" }, { type: "A", name: "x", value: "1.2.3.4", purpose: "p" }, "junk"] });
    assert.equal(JSON.stringify(view).includes("cf-secret"), false);
    assert.deepEqual(view.records.map(record => [record.type, record.name, record.value, record.fqdn, record.zone]), [["CNAME", "www", config.target, "www.mybakery.com", "mybakery.com"]]);
    assert.equal(view.label, "Waiting for DNS"); assert.equal(view.url, "https://www.mybakery.com");
    assert.deepEqual([view.phase, view.inProgress], ["waiting", true]);
    // Rows stored before exact names were kept (first label only) are shown with the right name.
    const legacy = domainView(config.target)({ id: "d2", hostname: "shop.eu.mybakery.com", status: "pending", ssl_status: "validation_timed_out", error: null, created_at: "2026-10-14T10:00:00Z", last_checked_at: null,
      verification: [{ type: "CNAME", name: "shop", value: "old.target", purpose: "p" }, { type: "TXT", name: "_cf-custom-hostname.shop.eu.mybakery.com", value: "uuid", purpose: "Optional" }] });
    assert.deepEqual(legacy.records.map(record => [record.type, record.name, record.fqdn, record.zone, record.value]), [
      ["CNAME", "shop.eu", "shop.eu.mybakery.com", "mybakery.com", config.target], ["TXT", "_cf-custom-hostname.shop.eu", "_cf-custom-hostname.shop.eu.mybakery.com", "mybakery.com", "uuid"]]);
    assert.deepEqual([legacy.phase, legacy.inProgress, legacy.label], ["timed_out", false, "Certificate setup stopped"]);
    assert.deepEqual(domainView(config.target)({ ...legacy, verification: "junk" }).records, [], "no stored records, none invented");
  });

  await check("routes: owner-only, validated before Cloudflare, compensating on failure, never blocked by abandoned claims", () => {
    const base = path.join(src, "app", "api", "cloud", "workspaces", "[workspaceId]", "artifacts", "[artifactId]", "domains");
    const list = fs.readFileSync(path.join(base, "route.ts"), "utf8"), item = fs.readFileSync(path.join(base, "[domainId]", "route.ts"), "utf8");
    assert.match(list, /async function owner[\s\S]{0,300}role !== "owner"/, "the owner check is in the shared helper");
    const order = ["export async function POST", "cloudBody(request", "await owner(context)", "customDomainConfig()", "checkHostname(body.hostname", "PUBLISH_FIRST", "STALE_PENDING_MS", "cloudflare.create(checked.hostname)", ".insert(", "cloudflare.remove(created.id)"];
    let at = -1;
    for (const marker of order) { const next = list.indexOf(marker, at + 1); assert.ok(next > at, `${marker} out of order`); at = next; }
    assert.match(list, /STALE_PENDING_MS = 72 \* 3_600_000/);
    assert.match(list, /\.neq\("status", "active"\)/, "only a non-active claim can be cleared");
    assert.doesNotMatch(list + item, /cloudflare_id[^\n]*cloudJson|cloudJson\([^)]*cloudflare_id/, "Cloudflare ids are never returned");
    assert.equal((item.match(/sameOrigin\(request\)/g) ?? []).length, 2, "check and delete require same-origin");
    assert.match(item, /remove\(row\.cloudflare_id\)[\s\S]*\.delete\(\)\.eq\("id", row\.id\)/, "Cloudflare first, then the row");
  });

  // ---- Check now route, executed with recorded database and Cloudflare --------
  const ids = { workspaceId: "11111111-1111-4111-8111-111111111111", artifactId: "22222222-2222-4222-8222-222222222222", domainId: "33333333-3333-4333-8333-333333333333" };
  Object.assign(process.env, { CLOUDFLARE_SAAS_ZONE_ID: config.zoneId, CLOUDFLARE_SAAS_API_TOKEN: config.token, MAKEBORNE_CUSTOM_DOMAIN_TARGET: config.target });
  const itemRoute = require(path.join(src, "app", "api", "cloud", "workspaces", "[workspaceId]", "artifacts", "[artifactId]", "domains", "[domainId]", "route.ts"));
  const forbidden = globalThis.fetch;
  const stored = { id: ids.domainId, workspace_id: ids.workspaceId, artifact_id: ids.artifactId, hostname: "shop.eu.mybakery.com", status: "active", ssl_status: "active", error: null, cloudflare_id: "cf-7",
    verification: [{ type: "CNAME", name: "shop", value: config.target, purpose: "p" }], created_at: "2026-10-14T10:00:00Z", last_checked_at: "2026-10-19T10:00:00Z" };
  async function checkNow(cloudflare, { role = "owner", params = ids } = {}) {
    db.row = { ...stored }; db.updates = []; db.reads = []; route.role = role;
    const sent = [];
    globalThis.fetch = async (url, init) => { sent.push({ url, method: init.method }); return cloudflare(url, init); };
    try {
      const response = await itemRoute.POST(new Request(`https://makeborne.com/api/cloud/workspaces/${params.workspaceId}/artifacts/${params.artifactId}/domains/${params.domainId}`, { method: "POST", headers: { Origin: "https://makeborne.com" } }), { params: Promise.resolve(params) });
      return { status: response.status, body: await response.json(), sent, updates: db.updates, row: db.row };
    } finally { globalThis.fetch = forbidden; }
  }
  const hostname = (status, ssl) => async () => Response.json({ success: true, errors: [], result: { id: "cf-7", hostname: "shop.eu.mybakery.com", status, ssl: { status: ssl } } });

  await check("Check now: a timed-out certificate is saved and shown as stopped, with the exact nested record; only a GET is sent", async () => {
    const result = await checkNow(hostname("active", "validation_timed_out"));
    assert.equal(result.status, 200);
    assert.deepEqual(result.sent, [{ url: `https://api.cloudflare.com/client/v4/zones/${config.zoneId}/custom_hostnames/cf-7`, method: "GET" }], "no PATCH, DELETE or POST: nothing is restarted or recreated");
    assert.deepEqual([result.updates[0].status, result.updates[0].ssl_status], ["pending", "validation_timed_out"], "a known-live row is not kept live once the certificate stops");
    assert.deepEqual(result.updates[0].verification.map(record => [record.name, record.fqdn, record.zone]), [["shop.eu", "shop.eu.mybakery.com", "mybakery.com"]]);
    const domain = result.body.domain;
    assert.deepEqual([domain.phase, domain.inProgress, domain.label], ["timed_out", false, "Certificate setup stopped"]);
    assert.equal(JSON.stringify(result.body).includes("cf-7"), false, "Cloudflare ids never reach the browser");
    for (const [ssl, phase] of [["expired", "expired"], ["brand_new_state", "unknown"], ["pending_issuance", "securing"], ["active", "live"]]) {
      const next = await checkNow(hostname("active", ssl));
      assert.equal(next.body.domain.phase, phase, ssl);
    }
  });

  await check("Check now: transient provider failures return 503 and leave the stored state exactly as it was", async () => {
    for (const failure of [
      async () => Response.json({ success: false, errors: [{ message: "Service unavailable" }] }, { status: 503 }),
      async () => Response.json({ success: false, errors: [{ message: "Internal error" }] }, { status: 500 }),
      async () => new Response("<html>bad gateway</html>", { status: 502 }),
      async () => { throw new TypeError("fetch failed"); },
      async () => Response.json({ success: false, errors: [{ code: 10000, message: "Authentication error" }] }, { status: 403 }),
    ]) {
      const result = await checkNow(failure);
      assert.equal(result.status, 503); assert.equal(result.body.error.code, "DOMAIN_PROVIDER_ERROR");
      assert.deepEqual(result.updates, [], "nothing is written");
      assert.deepEqual(result.row, stored, "the active row stays active");
    }
    const gone = await checkNow(async () => Response.json({ success: false, errors: [{ message: "not found" }] }, { status: 404 }));
    assert.equal(gone.status, 200); assert.equal(gone.updates[0].status, "failed", "only a confirmed 404 marks it failed");
  });

  await check("Check now: owner, workspace and site guards hold before Cloudflare is called", async () => {
    const editor = await checkNow(hostname("active", "active"), { role: "editor" });
    assert.equal(editor.status, 403); assert.deepEqual(editor.sent, []); assert.deepEqual(editor.updates, []);
    const other = await checkNow(hostname("active", "active"), { params: { ...ids, workspaceId: "44444444-4444-4444-8444-444444444444" } });
    assert.equal(other.status, 404); assert.deepEqual(other.sent, []);
    assert.deepEqual(db.reads.at(-1), { id: ids.domainId, workspace_id: "44444444-4444-4444-8444-444444444444", artifact_id: ids.artifactId }, "the row is looked up by id, workspace and site together");
    const site = await checkNow(hostname("active", "active"), { params: { ...ids, artifactId: "55555555-5555-4555-8555-555555555555" } });
    assert.equal(site.status, 404); assert.deepEqual(site.sent, []);
  });

  // ---- The real panel, rendered on the server with a fixed state ------------
  await check("the domains panel: no spinner or polling for stopped states, and the exact nested name is shown and copyable", async () => {
    const React = require("react");
    const { renderToStaticMarkup } = require("react-dom/server");
    const uiPath = path.join(src, "components", "website-domains.tsx");
    const previousTsx = require.extensions[".tsx"];
    require.extensions[".tsx"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
    let preset = null, first = true;
    // The panel loads its state after mounting; for this render its first useState starts from `preset`.
    stubs.react = { ...React, useState: initial => { if (first && preset) { first = false; return [preset, () => undefined]; } return React.useState(initial); } };
    stubs["@/app/website-domains.css"] = {};
    try {
      const WebsiteDomains = require(uiPath).default;
      const row = (id, hostname, status, ssl, verification) => ({ id, hostname, status, ssl_status: ssl, error: null, verification, created_at: "2026-10-14T10:00:00Z", last_checked_at: null });
      const domains = [
        row("d-timeout", "shop.eu.mybakery.com", "pending", "validation_timed_out", [{ type: "CNAME", name: "shop", value: config.target, purpose: "p" }]),
        row("d-expired", "www.ovenbird.co.uk", "pending", "expired", dnsRecords("www.ovenbird.co.uk", false, config.target)),
        row("d-unknown", "menu.mybakery.com", "pending", "brand_new_state", dnsRecords("menu.mybakery.com", false, config.target)),
        row("d-waiting", "order.mybakery.com", "pending", "pending_validation", dnsRecords("order.mybakery.com", false, config.target)),
        row("d-live", "mybakery.com", "active", "active", dnsRecords("mybakery.com", true, config.target)),
      ].map(domainView(config.target));
      preset = { configured: true, target: config.target, published: true, live: true, domains }; first = true;
      const html = renderToStaticMarkup(React.createElement(WebsiteDomains, { accountId: "acct", workspaceId: ids.workspaceId, artifactId: ids.artifactId }));
      const article = id => { const start = html.indexOf(`data-phase="${domains.find(domain => domain.id === id).phase}"`); assert.ok(start > 0, id); return html.slice(start, html.indexOf("</article>", start)); };
      for (const [id, chip, label] of [["d-timeout", "is-failed", "Certificate setup stopped"], ["d-expired", "is-failed", "Certificate expired"], ["d-unknown", "is-unknown", "Status unknown"]]) {
        const card = article(id);
        assert.match(card, new RegExp(`wd-chip ${chip}`), id); assert.ok(card.includes(label), id);
        assert.doesNotMatch(card.slice(0, card.indexOf("</header>")), /wd-spin/, `${id} shows no progress spinner`);
        assert.match(card, /Check now/);
      }
      const waiting = article("d-waiting");
      assert.match(waiting, /wd-chip is-pending/); assert.match(waiting.slice(0, waiting.indexOf("</header>")), /wd-spin/, "expected progress still shows a spinner");
      const nested = article("d-timeout");
      assert.match(nested, /<code>shop\.eu<\/code>/, "the zone-relative name is the whole prefix");
      assert.match(nested, /aria-label="Copy name shop\.eu \(in the mybakery\.com zone\)"/);
      assert.match(nested, /<code>shop\.eu\.mybakery\.com<\/code>/); assert.match(nested, /aria-label="Copy full name shop\.eu\.mybakery\.com"/);
      assert.match(nested, /DNS zone <strong>mybakery\.com<\/strong>/);
      assert.doesNotMatch(nested, /<code>shop<\/code>/, "never only the first label");
      assert.match(article("d-expired"), /<code>www<\/code>[\s\S]*DNS zone <strong>ovenbird\.co\.uk<\/strong>/);
      // Preferred-address policy (M17, docs/CUSTOM_DOMAINS.md): stated, and matching the Worker.
      assert.match(html, /wd-policy">Both addresses show the same site, and neither one redirects to the other\. Your Makeborne address stays the main address for search engines: every page names it as the original, and only it lists a sitemap\./);
      // Polling follows inProgress, not the stored status.
      const ui = fs.readFileSync(uiPath, "utf8");
      assert.match(ui, /domains\.filter\(domain => domain\.inProgress\)/);
      assert.doesNotMatch(ui, /domain\.status === "pending" \? <Loader2/, "the spinner is not tied to the stored pending status");
      assert.match(ui, /copy\(record\.fqdn!/);
    } finally { delete stubs.react; delete stubs["@/app/website-domains.css"]; require.extensions[".tsx"] = previousTsx; delete require.cache[uiPath]; }
  });

  await check("the last successful check is shown apart from a later attempt that didn't reach the provider", async () => {
    const { checkTimes } = require("./custom-domain-view.ts");
    const at = iso => iso.slice(11, 16);
    assert.deepEqual(checkTimes(null, null, at), { success: "No successful check yet", attempt: null });
    assert.deepEqual(checkTimes("2026-10-20T10:00:00Z", null, at), { success: "Last successful check 10:00", attempt: null });
    assert.deepEqual(checkTimes("2026-10-20T10:00:00Z", { at: "2026-10-20T10:20:00Z", ok: false }, at), { success: "Last successful check 10:00", attempt: "Last attempt 10:20 couldn’t reach the domain provider, so the status shown is from the last successful check." });
    assert.equal(checkTimes("2026-10-20T10:30:00Z", { at: "2026-10-20T10:20:00Z", ok: false }, at).attempt, null, "an older failed attempt is superseded");
    assert.equal(checkTimes("2026-10-20T10:20:00Z", { at: "2026-10-20T10:20:00Z", ok: true }, at).attempt, null);
    assert.match(checkTimes(null, { at: "2026-10-20T10:20:00Z", ok: false }, at).attempt, /^Last attempt 10:20/);
    // Only an answered check moves last_checked_at; a provider error writes nothing (see the 503 check above).
    const gone = await checkNow(async () => Response.json({ success: false, errors: [{ message: "not found" }] }, { status: 404 }));
    assert.ok(Date.parse(gone.updates[0].last_checked_at) > Date.parse(stored.last_checked_at), "a confirmed answer is a successful check");
    const failed = await checkNow(async () => { throw new TypeError("fetch failed"); });
    assert.deepEqual(failed.updates, []); assert.equal(failed.row.last_checked_at, stored.last_checked_at, "a failed attempt keeps the last successful time");
    const ui = fs.readFileSync(path.join(src, "components", "website-domains.tsx"), "utf8");
    assert.ok(ui.includes("checkTimes(domain.lastCheckedAt, attempts[domain.id] ?? null)"));
    assert.ok(ui.includes("catch (cause) { setAttempts(current => ({ ...current, [id]: { at: new Date().toISOString(), ok: false } }));"), "quiet polls record failed attempts too");
    assert.doesNotMatch(ui, />Checked \{new Date/, "no unlabelled 'Checked' time");
  });

  console.log(`\n${passed} custom domain checks passed.`);
})().catch(error => { console.error(error); process.exit(1); });
