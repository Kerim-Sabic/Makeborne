/* eslint-disable @typescript-eslint/no-require-imports -- Mocked transport; no network or credentials. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..").replaceAll("\\", "/");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8").replaceAll('"@/', `"${root}/`), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { api, setCloudAccount, getPendingCloudWrites } = require("./cloud-api.ts");
const { requestAccountMatches } = require("../lib/cloud/request-account.ts");
const a = "11111111-1111-4111-8111-111111111111", b = "22222222-2222-4222-8222-222222222222";
const records = new Map();
global.localStorage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key), key: index => [...records.keys()][index] ?? null, get length() { return records.size; } };
global.window = { dispatchEvent() {} };
let count = 0;
function pass(name) { count++; console.log(`PASS ${name}`); }
function deferredTransport() {
  let resolveResponse, started;
  const sent = new Promise(resolve => { started = resolve; });
  global.fetch = () => { started(); return new Promise(resolve => { resolveResponse = resolve; }); };
  return { sent, respond: data => resolveResponse(new Response(JSON.stringify(data))) };
}
(async () => {
  assert.equal(requestAccountMatches(a, a), true);
  assert.equal(requestAccountMatches(b, a), false);
  assert.equal(requestAccountMatches(null, a), true);
  for (const invalid of ["", "invalid", a + "," + b]) assert.equal(requestAccountMatches(invalid, a), false);
  pass("server identity constraint accepts only absent or matching valid identity");
  setCloudAccount(null);
  await assert.rejects(api("/api/workspaces", { name: "Fixture" }), error => error.code === "ACCOUNT_REQUIRED");
  pass("anonymous writes are rejected");

  setCloudAccount(a);
  let transport = deferredTransport();
  let request = api("/api/workspaces");
  await transport.sent;
  setCloudAccount(b); setCloudAccount(a);
  transport.respond({ workspaces: [] });
  await assert.rejects(request, error => error.code === "ACCOUNT_CHANGED" && !error.uncertain);
  pass("a read is discarded even after switching away and back");

  transport = deferredTransport();
  request = api("/api/workspaces");
  await transport.sent;
  setCloudAccount(a);
  transport.respond({ workspaces: [] });
  assert.deepEqual(await request, { workspaces: [] });
  pass("reaffirming the same account does not invalidate reads");

  let fetched = false;
  global.fetch = () => { fetched = true; throw new Error("Unexpected network"); };
  request = api("/api/workspaces", { name: "Never sent" });
  setCloudAccount(b);
  await assert.rejects(request, error => error.code === "ACCOUNT_CHANGED" && !error.uncertain);
  assert.equal(fetched, false); assert.equal(records.size, 0);
  pass("account switch during hashing prevents storage and network write");

  setCloudAccount(a);
  transport = deferredTransport();
  request = api("/api/workspaces", { name: "Recoverable fixture" });
  await transport.sent;
  const original = getPendingCloudWrites(a)[0];
  assert.ok(original);
  setCloudAccount(b);
  transport.respond({});
  await assert.rejects(request, error => error.code === "ACCOUNT_CHANGED" && error.uncertain);
  assert.equal(getPendingCloudWrites(a)[0].key, original.key);
  assert.equal(getPendingCloudWrites(b).length, 0);
  pass("in-flight creation retains original owner and request identity");

  setCloudAccount(a);
  global.fetch = async (_path, options) => {
    assert.equal(options.headers["Idempotency-Key"], original.key);
    assert.equal(options.headers["X-Makeborne-Account"], a);
    return new Response(JSON.stringify({ workspace: { id: a, name: "Recoverable fixture", role: "owner" }, mutation: { idempotencyKey: original.key, replayed: true } }));
  };
  await api(original.path, JSON.parse(original.body));
  assert.equal(getPendingCloudWrites(a).length, 0);
  pass("original account can reconcile the exact request and clear recovery");

  transport = deferredTransport();
  request = api(`/api/cloud/workspaces/${a}/clients/${b}`, { name: "Patch" }, "PATCH");
  await transport.sent;
  setCloudAccount(b);
  transport.respond({});
  await assert.rejects(request, error => error.code === "ACCOUNT_CHANGED" && error.uncertain);
  pass("in-flight updates are not reported as saved to the new account");
  setCloudAccount(a); records.clear();
  const stableKey = "33333333-3333-4333-8333-333333333333";
  let writes = 0;
  global.fetch = async (_path, options) => {
    writes++; assert.equal(options.headers["Idempotency-Key"], stableKey);
    return Response.json({ workspace: { id: a, name: "Durable intent", role: "owner" }, mutation: { idempotencyKey: stableKey, replayed: writes > 1 } });
  };
  for (let i = 0; i < 2; i++) {
    await api("/api/workspaces", { name: "Durable intent" }, "POST", { idempotencyKey: stableKey });
    assert.equal(getPendingCloudWrites(a).length, 0);
  }
  assert.equal(writes, 2); pass("supplied original key survives confirmed-response transport cleanup");
  global.fetch = async () => { throw Error("Lost response"); };
  await assert.rejects(api("/api/workspaces", { name: "Durable intent" }, "POST", { idempotencyKey: stableKey }), e => e.uncertain);
  const preserved = getPendingCloudWrites(a)[0]; assert.equal(preserved.key, stableKey);
  global.fetch = async () => { throw Error("Must not send a replacement key"); };
  await assert.rejects(api("/api/workspaces", { name: "Durable intent" }, "POST", { idempotencyKey: b }), e => e.code === "PENDING_STORAGE_UNAVAILABLE");
  assert.equal(getPendingCloudWrites(a)[0].key, stableKey); pass("conflicting supplied key cannot rotate an unresolved transport request");
  await assert.rejects(api("/api/workspaces", undefined, "GET", { idempotencyKey: stableKey }), e => e.code === "UNSUPPORTED_REQUEST_KEY");
  pass("unsupported operations reject creation key options before network");
  console.log(`${count} account race checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
