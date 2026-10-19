/* eslint-disable @typescript-eslint/no-require-imports -- Offline builder availability checks: database and providers mocked, no network or paid calls. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
let rpcCalls = [], spendStatus = async () => ({ data: { available: true, reason: null }, error: null }), database = () => ({ rpc: async (name, args) => { rpcCalls.push({ name, args }); return spendStatus(name, args); } });
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  if (name === "@/lib/cloud/server") return { cloudContext: async () => { throw Error("GET must not authenticate"); }, validId: () => {}, databaseError: () => {} };
  if (name.startsWith("@/")) return load.call(this, path.join(__dirname, "../..", name.slice(2)), parent, main);
  if (/(^|\/)billing\/database$/.test(name)) return { billingDatabase: () => database() };
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const { builderAvailability, parseBuilderAvailability, BUILDER_OFF, BUILDER_WAITING_COPY } = require("./availability.ts");
const { providerCapacity, requireProviderCapacity } = require("../ai/live-run.ts");
const route = require("../../app/api/build/route.ts");

let passed = 0;
async function check(name, fn) { rpcCalls = []; await fn(); passed++; console.log(`PASS ${name}`); }
const env = (values, fn) => async () => {
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  try { await fn(); } finally { for (const [key, value] of Object.entries(before)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
};
const status = (data, error = null) => async () => ({ data, error });
// The GET body carries availability plus measured credit ranges (credits only); availability is asserted exactly, estimates by shape.
const get = async () => {
  const response = await route.GET(); assert.equal(response.headers.get("Cache-Control"), "no-store");
  const { estimates, ...availability } = await response.json();
  assert.ok(estimates && estimates.firstBuild && estimates.reviewRound, "credit estimates accompany every answer");
  assert.ok(!/micro|usd|cost|budget/i.test(JSON.stringify(estimates)), "estimates are credit ranges, never provider amounts");
  return availability;
};

(async () => {
  await check("an unconfigured builder is off and never reads provider spending", async () => {
    let probed = false;
    assert.deepEqual(await builderAvailability({ configured: false, priced: () => { probed = true; }, capacity: async () => { probed = true; return "available"; } }), BUILDER_OFF);
    assert.equal(probed, false);
  });
  await check("configured is not runnable: each provider state is reported, and only 'available' can start work", async () => {
    for (const [capacity, expected] of [["available", { available: true, configured: true, state: "ready" }], ["paused", { available: false, configured: true, state: "paused" }],
      ["limit", { available: false, configured: true, state: "limit" }], ["unavailable", { available: false, configured: true, state: "unavailable" }]])
      assert.deepEqual(await builderAvailability({ configured: true, priced: () => {}, capacity: async () => capacity }), expected, capacity);
  });
  await check("an unpriced model or a failing preflight is unavailable, never ready", async () => {
    let probed = false;
    assert.deepEqual(await builderAvailability({ configured: true, priced: () => { throw Error("unpriced"); }, capacity: async () => { probed = true; return "available"; } }), { available: false, configured: true, state: "unavailable" });
    assert.equal(probed, false, "the price check runs first, as in a build request");
    assert.deepEqual(await builderAvailability({ configured: true, priced: () => {}, capacity: async () => { throw Error("network"); } }), { available: false, configured: true, state: "unavailable" });
  });
  await check("provider capacity reads the database preflight as a reason, failing closed", async () => {
    for (const [result, expected] of [[status({ available: true, reason: null }), "available"], [status({ available: false, reason: "paused" }), "paused"], [status({ available: false, reason: "limit" }), "limit"],
      [status({ available: false }), "paused"], [status(null, { code: "XX000" }), "unavailable"], [status("yes"), "unavailable"]]) {
      spendStatus = result;
      assert.equal(await providerCapacity("anthropic"), expected);
    }
    assert.deepEqual(rpcCalls.at(-1), { name: "makeborne_provider_spend_status", args: { p_provider: "anthropic" } });
    const configured = database;
    database = () => { throw Error("service role not configured"); };
    try { assert.equal(await providerCapacity("anthropic"), "unavailable"); } finally { database = configured; }
  });
  await check("build requests keep their retryable 503 codes for the same reasons", async () => {
    for (const [result, code] of [[status({ available: false, reason: "paused" }), "AI_PAUSED"], [status({ available: false, reason: "limit" }), "AI_DAILY_LIMIT"], [status(null, { code: "XX000" }), "AI_UNAVAILABLE"]]) {
      spendStatus = result;
      await assert.rejects(() => requireProviderCapacity("anthropic"), error => error.code === code && error.status === 503, code);
    }
    spendStatus = status({ available: true, reason: null });
    await requireProviderCapacity("anthropic");
  });
  await check("GET /api/build: builder off answers off without touching the database", env({ MAKEBORNE_LIVE_BUILDER_ENABLED: "false", ANTHROPIC_API_KEY: "offline-not-sent" }, async () => {
    assert.deepEqual(await get(), { available: false, configured: false, state: "off" });
    assert.equal(rpcCalls.length, 0);
  }));
  await check("GET /api/build: no key answers off", env({ MAKEBORNE_LIVE_BUILDER_ENABLED: undefined, ANTHROPIC_API_KEY: undefined }, async () => {
    assert.deepEqual(await get(), { available: false, configured: false, state: "off" });
  }));
  await check("GET /api/build: configured with spending paused at zero is not available (the audited production state)", env({ MAKEBORNE_LIVE_BUILDER_ENABLED: undefined, ANTHROPIC_API_KEY: "offline-not-sent" }, async () => {
    spendStatus = status({ available: false, reason: "paused" });
    const body = await get();
    assert.deepEqual(body, { available: false, configured: true, state: "paused" });
    assert.ok(!/micro|usd|limit_|budget/i.test(JSON.stringify(body)), "reasons only, never amounts");
    spendStatus = status({ available: false, reason: "limit" });
    assert.deepEqual(await get(), { available: false, configured: true, state: "limit" });
    spendStatus = status({ available: true, reason: null });
    assert.deepEqual(await get(), { available: true, configured: true, state: "ready" });
  }));
  await check("the studio reads current, older and malformed answers safely", async () => {
    assert.deepEqual(parseBuilderAvailability({ available: true }), { available: true, configured: true, state: "ready" }, "a server from before this change");
    assert.deepEqual(parseBuilderAvailability({ available: false }), BUILDER_OFF);
    for (const junk of [null, "ready", 1, [], { state: "bogus", configured: true, available: true }, { state: "ready", available: true }, { state: "off", configured: true, available: true }])
      assert.deepEqual(parseBuilderAvailability(junk), BUILDER_OFF, JSON.stringify(junk));
    assert.deepEqual(parseBuilderAvailability({ state: "ready", configured: true, available: false }), { available: false, configured: true, state: "unavailable" }, "contradictory answers never offer work");
    assert.deepEqual(parseBuilderAvailability({ state: "paused", configured: true, available: true }), { available: false, configured: true, state: "paused" });
    for (const state of ["paused", "limit", "unavailable"]) {
      assert.deepEqual(parseBuilderAvailability({ state, configured: true, available: false }), { available: false, configured: true, state });
      assert.match(BUILDER_WAITING_COPY[state], /saved work is safe/);
      assert.doesNotMatch(BUILDER_WAITING_COPY[state], /charged/, "said before any request, so nothing to refund");
      assert.doesNotMatch(BUILDER_WAITING_COPY[state], /export/i, "production has no standard export for outline records, so the builder copy promises none");
    }
  });
  console.log(`PASS ${passed} builder availability checks: configured, runnable and paused states are distinct; database and providers mocked.`);
})().catch(error => { console.error(error); process.exit(1); });
