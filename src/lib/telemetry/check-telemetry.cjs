/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for first-party error tracking and visit counting (mocked database, no network). */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const src = path.join(__dirname, "..", "..");
globalThis.fetch = async () => { throw new Error("Network forbidden"); };

let calls = [], failRpc = false;
const stubs = {
  "server-only": {},
  "@/lib/billing/database": { billingDatabase: () => ({ rpc: async (name, args) => { calls.push({ name, args }); if (failRpc) throw new Error("db down"); return { data: null, error: null }; } }) },
};
const cache = {};
function load(file) {
  if (cache[file]) return cache[file].exports;
  const compiled = { exports: {} }; cache[file] = compiled;
  const localRequire = id => {
    if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id];
    if (!id.startsWith(".") && !id.startsWith("@/")) return require(id);
    const base = id.startsWith("@/") ? path.join(src, id.slice(2)) : path.resolve(path.dirname(file), id);
    const resolved = [base, `${base}.ts`, `${base}.tsx`].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!resolved) throw new Error(`Cannot resolve ${id}`);
    return load(resolved);
  };
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function("require", "module", "exports", js)(localRequire, compiled, compiled.exports);
  return compiled.exports;
}
const scrub = load(path.join(src, "lib/telemetry/scrub.ts"));
const route = load(path.join(src, "app/api/telemetry/route.ts"));
const instrumentation = load(path.join(src, "instrumentation.ts"));

const checks = [];
const check = (name, fn) => checks.push([name, fn]);
const ORIGIN = "https://makeborne.com";
const post = (body, headers = { origin: ORIGIN }) => route.POST(new Request(`${ORIGIN}/api/telemetry`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));

check("scrubbing removes personal data and secrets; routes become patterns", () => {
  assert.equal(scrub.scrubMessage("Failed for ana.reed@example.com on 7e1a0c55-5c3e-4d0b-9a51-3f1f00e0d001 with probe_ABCDEFGHIJKLMNOPQRSTUVWX012345 order 48211 https://x.com/a?token=secret"),
    "Failed for <email> on <id> with <token> order <n> https://x.com/a");
  assert.equal(scrub.scrubMessage("word ".repeat(200)).length, 300);
  assert.equal(scrub.scrubMessage(new TypeError("boom")), "boom");
  assert.equal(scrub.scrubMessage({}), "");
  assert.equal(scrub.routePattern("/studio/7e1a0c55-5c3e-4d0b-9a51-3f1f00e0d001/edit?tab=x#y"), "/studio/[id]/edit");
  assert.equal(scrub.routePattern("/portal/join/AxqyiSWPscmAmQiBlCunGJiOUuAuU51si6DMK0Ff6YE"), "/portal/join/[token]");
  assert.equal(scrub.routePattern("/api/x/123/y"), "/api/x/[n]/y");
  assert.equal(scrub.routePattern("/studio/7e1a0c55-5c3e-4d0b-9a51-3f1f00e0d001"), "/studio/[id]", "repeat calls are stable");
  assert.equal(scrub.errorKind(new RangeError("x")), "RangeError"); assert.equal(scrub.errorKind("text"), "Error"); assert.equal(scrub.errorKind({ name: "a b" }), "Error");
  assert.equal(scrub.fingerprintSource("client", "E", "Order 12 failed", "/a"), scrub.fingerprintSource("client", "E", "Order 99 failed", "/a"), "counters do not split groups");
  assert.deepEqual(["/", "/billing", "/login", "/studio", "/studio/x", "/portal/sites/x", "/help/intro", "/admin", "/privacy"].map(scrub.telemetryPage),
    ["home", "pricing", "login", "studio", "studio", "portal", "help", null, null]);
  assert.ok(scrub.IGNORED_CLIENT_ERROR.test("ResizeObserver loop completed with undelivered notifications."));
});

check("telemetry route: same origin only, small bodies, scrubbed grouped errors, ignored noise, never fails the page", async () => {
  calls = [];
  assert.equal((await post({ type: "error", message: "x", path: "/" }, {})).status, 403, "no Origin");
  assert.equal((await post({ type: "error", message: "x", path: "/" }, { origin: "https://evil.example" })).status, 403);
  assert.equal(calls.length, 0);
  assert.equal((await post("not json")).status, 204);
  assert.equal((await post("x".repeat(5000))).status, 204);
  assert.equal((await post({ type: "error", message: "ResizeObserver loop limit exceeded", path: "/studio" })).status, 204);
  assert.equal(calls.length, 0, "bad bodies and noise record nothing");
  assert.equal((await post({ type: "error", kind: "TypeError", message: "Cannot read x of ana@example.com", path: "/studio/7e1a0c55-5c3e-4d0b-9a51-3f1f00e0d001" })).status, 204);
  const [error] = calls;
  assert.equal(error.name, "makeborne_record_app_error");
  assert.deepEqual([error.args.p_source, error.args.p_kind, error.args.p_message, error.args.p_route], ["client", "TypeError", "Cannot read x of <email>", "/studio/[id]"]);
  assert.equal(error.args.p_fingerprint, crypto.createHash("sha256").update("client|TypeError|Cannot read x of <email>|/studio/[id]").digest("hex"));
  failRpc = true;
  assert.equal((await post({ type: "error", message: "y", path: "/" })).status, 204, "a database failure never surfaces");
  failRpc = false;
});

check("visits: allow-listed pages only, respects Global Privacy Control and Do Not Track, first forwarded IP", async () => {
  calls = [];
  await post({ type: "visit", path: "/admin" });
  await post({ type: "visit", path: "/studio" }, { origin: ORIGIN, "sec-gpc": "1" });
  await post({ type: "visit", path: "/studio" }, { origin: ORIGIN, dnt: "1" });
  assert.equal(calls.length, 0);
  await post({ type: "visit", path: "/billing?plan=x" }, { origin: ORIGIN, "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "UA" });
  assert.deepEqual(calls, [{ name: "makeborne_record_studio_visit", args: { p_page: "pricing", p_ip: "203.0.113.7", p_user_agent: "UA" } }]);
});

check("server errors: onRequestError records the scrubbed error with the route pattern, only in Node", async () => {
  calls = [];
  process.env.NEXT_RUNTIME = "edge";
  await instrumentation.onRequestError(new Error("x"), { path: "/a", method: "GET", headers: {} }, { routePath: "/a", routeType: "route" });
  assert.equal(calls.length, 0, "edge runtime skipped");
  process.env.NEXT_RUNTIME = "nodejs";
  await instrumentation.onRequestError(new SyntaxError("Unexpected token in 1234567 for bo@example.com"), { path: "/api/build?x=1", method: "POST", headers: {} },
    { routerKind: "App Router", routePath: "/api/build", routeType: "route" });
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].args.p_source, calls[0].args.p_kind, calls[0].args.p_message, calls[0].args.p_route], ["server", "SyntaxError", "Unexpected token in <n> for <email>", "/api/build"]);
  failRpc = true;
  await instrumentation.onRequestError(new Error("z"), { path: "/", method: "GET", headers: {} }, { routePath: "/", routeType: "render" });
  failRpc = false;
  delete process.env.NEXT_RUNTIME;
});

check("wiring: client instrumentation reports errors and visits; error pages report and offer retry; admin Health tab", () => {
  const read = file => fs.readFileSync(path.join(src, file), "utf8");
  const client = read("instrumentation-client.ts");
  assert.match(client, /addEventListener\("error"/); assert.match(client, /addEventListener\("unhandledrejection"/);
  assert.match(client, /export function onRouterTransitionStart/);
  assert.match(client, /event\.filename && !event\.filename\.startsWith\(location\.origin\)/, "third-party script errors ignored");
  assert.match(read("lib/telemetry/client.ts"), /reports >= 10/, "at most ten reports per page load");
  assert.match(read("app/error.tsx"), /if \(!error\.digest\) reportClientError\(error\)/, "server-rendered errors are not double counted");
  assert.match(read("app/error.tsx"), /onClick=\{\(\) => retry\(\)\}/);
  assert.match(read("app/global-error.tsx"), /<html lang="en">/);
  assert.match(read("app/admin/page.tsx"), /\{ id: "health", label: "Health" \}/);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of checks) {
    try { await fn(); console.log(`PASS ${name}`); }
    catch (error) { failed++; console.log(`FAIL ${name}\n${error.stack}`); }
  }
  console.log(`${checks.length - failed}/${checks.length} telemetry checks passed.`);
  if (failed) process.exitCode = 1;
})();
