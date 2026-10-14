/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for customer custom domains (hostname rules, DNS records, Cloudflare client, routes). */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const src = path.join(__dirname, "..", "..");
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name.startsWith("@/")) return load.call(this, path.join(src, `${name.slice(2)}.ts`), parent, main);
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
globalThis.fetch = async () => { throw new Error("Network forbidden"); };
const { checkHostname, dnsRecords, domainState, statusLabel, customDomainConfig, cloudflareHostnames, CloudflareError } = require("./custom-domains.ts");
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
    assert.deepEqual(view.records, [{ type: "CNAME", name: "www", value: config.target, purpose: "p" }]);
    assert.equal(view.label, "Waiting for DNS"); assert.equal(view.url, "https://www.mybakery.com");
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

  console.log(`\n${passed} custom domain checks passed.`);
})().catch(error => { console.error(error); process.exit(1); });
