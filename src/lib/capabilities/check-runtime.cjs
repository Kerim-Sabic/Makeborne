/* eslint-disable @typescript-eslint/no-require-imports -- Explicit local production-server smoke check. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {randomUUID} = require("node:crypto");

// Next's local production request URLs use localhost. Keep the actual Origin
// aligned with that host instead of weakening the production origin guard.
const origin = new URL(process.argv[2] ?? "http://localhost:3036");
assert(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname), "Run this unauthenticated smoke check against a local server only.");
assert(!origin.username && !origin.password);
const results = [];

async function get(route) {
  const response = await fetch(new URL(route, origin), {redirect: "manual", signal: AbortSignal.timeout(15_000)});
  return {response, body: response.headers.get("Content-Type")?.includes("application/json") ? await response.json() : null};
}

async function deniedPost(route, body = {}) {
  const response = await fetch(new URL(route, origin), {
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(15_000),
    headers: {Origin: origin.origin, "Content-Type": "application/json", "Idempotency-Key": randomUUID()},
    body: JSON.stringify(body),
  });
  const value = await response.json();
  assert.equal(response.status, 401, `${route} must require a verified session before work.`);
  assert.equal(value.error.code, "AUTH_REQUIRED");
  results.push({route, method: "POST", status: response.status, outcome: "unauthenticated_request_denied"});
}

async function main() {
  const capabilities = await get("/api/capabilities?administrator=true");
  assert.equal(capabilities.response.status, 200);
  assert.equal(capabilities.response.headers.get("Cache-Control"), "no-store");
  assert.equal(capabilities.body.schemaVersion, 1);
  assert.equal(capabilities.body.health, "unverified");
  assert.equal(capabilities.body.aiGeneration.available, false);
  assert.equal(capabilities.body.manualExports.available, false, "This check expects the production build.");
  assert.equal(capabilities.body.payments.support.grantsCreationAccess, false);
  assert(!Object.hasOwn(capabilities.body, "operations"));
  assert(!/sk-ant-|sb_secret_|billing-secret/.test(JSON.stringify(capabilities.body)));
  results.push({route: "/api/capabilities", method: "GET", status: 200, outcome: "safe_public_snapshot", body: capabilities.body});

  const generation = await get("/api/generate?administrator=true");
  assert.equal(generation.response.status, 200);
  assert.equal(generation.body.available, false);
  assert.equal(generation.body.scope, "administrator_testing");
  assert.equal(generation.response.headers.get("Cache-Control"), "private, no-store");
  assert(generation.response.headers.get("Vary").split(",").some(value => value.trim().toLowerCase() === "cookie"));
  results.push({route: "/api/generate", method: "GET", status: 200, outcome: "signed_out_pilot_unavailable"});

  const admin = await get("/admin");
  assert([303, 307].includes(admin.response.status));
  assert.equal(new URL(admin.response.headers.get("Location"), origin).pathname, "/login");
  results.push({route: "/admin", method: "GET", status: admin.response.status, outcome: "redirect_to_login"});

  await deniedPost("/api/generate");
  await deniedPost("/api/export");
  await deniedPost("/api/billing/checkout");
  await deniedPost("/api/billing/support-checkout");
  await deniedPost(`/api/cloud/workspaces/${randomUUID()}/artifacts/${randomUUID()}/publication`, {live: true, slug: "fixture-only", version: 1, revision: 0, acknowledged: true});

  const crossOrigin = await fetch(new URL("/api/generate", origin), {
    method: "POST", headers: {Origin: "https://unrelated.example", "Content-Type": "application/json"}, body: "{}", signal: AbortSignal.timeout(15_000),
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal((await crossOrigin.json()).error.code, "ORIGIN_DENIED");
  results.push({route: "/api/generate", method: "POST", status: 403, outcome: "cross_origin_request_denied"});

  // Allow each increment to retain its own evidence without rewriting an older
  // run's scope. Existing standalone usage keeps its original default.
  const evidence = path.resolve(process.argv[3] ?? "docs/execution/evidence/M00-T03-R01");
  fs.mkdirSync(evidence, {recursive: true});
  fs.writeFileSync(path.join(evidence, "runtime-results.json"), JSON.stringify({
    checkedAt: new Date().toISOString(), environment: "local_next_production_server", origin: origin.origin,
    scope: "Real HTTP handlers and anonymous access denials; no signed-in success or live external provider verification.",
    results,
  }, null, 2) + "\n");
  console.log(`${results.length} local production HTTP checks passed; unauthenticated writes denied and public/private capability boundaries preserved.`);
}

main().catch(error => {console.error(error); process.exitCode = 1;});
