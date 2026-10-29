/* eslint-disable @typescript-eslint/no-require-imports -- Behavioural checks for /api/build/questions: the one-credit hold is released with whole credits
 * on success and on failure (a fractional value used to be refused and the hold lapsed for 15 minutes), and a failed release is logged, not hidden.
 * The real route is transpiled and run with authentication, credits and the provider replaced by recording fakes. Offline, no network. */
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), ts = require("typescript"), assert = require("node:assert/strict");
const file = path.join(__dirname, "..", "..", "app", "api", "build", "questions", "route.ts");
const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const z = require("zod");
const RATE = 0.03;

function load(settings) {
  const releases = [], logged = [];
  class RequestError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
  // The real releaseRun refuses anything but whole credits (credits/server.ts wholeCredits); the fake keeps that contract.
  const releaseRun = async (hold, measured, reason) => {
    releases.push({ reference: hold.reference, measured, reason });
    if (!Number.isSafeInteger(measured) || measured < 0) throw new RequestError("INVALID_CREDIT_AMOUNT", "Credit amounts must be whole numbers.", 400);
    if (settings.releaseFails) throw Object.assign(new Error("database unavailable"), { code: "CREDITS_UNAVAILABLE" });
  };
  class RunSpend {
    constructor() { this.calls = []; this.providerMicrousd = 0; this.uncertainMicrousd = 0; this.confirmedMicrousd = 0; }
    customerCredits(usdPerCredit) { return Math.max(0, Math.ceil(this.confirmedMicrousd / 1e6 / usdPerCredit - 1e-9)); }
  }
  const stubs = {
    zod: z,
    "@/lib/cloud/server": {
      cloudContext: async () => ({ user: { id: "11111111-1111-4111-8111-111111111111" }, workspace: { role: "owner" },
        client: { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "a", kind: "website" }, error: null }) }) }) }) }) } }),
      databaseError: () => {}, validId: () => {},
    },
    "@/lib/server/http": { RequestError, sameOrigin: () => {}, boundedJson: async request => request.json(), apiError: error => Response.json({ error: { code: error.code, message: error.message } }, { status: error.status ?? 500 }) },
    "@/lib/credits/server": { HOLD_LIFETIME_MS: 900_000, reserveCredits: async (user, n, reference) => ({ userId: user, reference, reservedAt: Date.now(), exempt: false }), releaseRun },
    "@/lib/ai/live-run": { CLOCK_SKEW_MS: 1000, SETTLEMENT_WINDOW_MS: 90_000, databaseGate: () => ({}), requireProviderCapacity: async () => {} },
    "@/lib/ai/run-spend": { RunSpend },
    "@/lib/ai/model-check": { requirePricedModel: () => {} },
    "@/lib/builder/pricing": { aiCostUsdPerCredit: () => RATE },
    "@/lib/builder/website-run": { logAiStop: () => {} },
    "@/lib/builder/ai-brief-questions": { QUESTIONS_MODEL: "fake", aiBriefQuestions: async ({ spend }) => {
      spend.calls.push({}); spend.confirmedMicrousd = settings.confirmedMicrousd; spend.providerMicrousd = settings.confirmedMicrousd;
      if (settings.providerFails) throw new Error("provider overloaded");
      return [{ id: "q1", text: "Question?" }];
    } },
  };
  const routeModule = { exports: {} };
  const context = vm.createContext({ module: routeModule, exports: routeModule.exports, require: name => name in stubs ? stubs[name] : name === "node:crypto" ? require(name) : (() => { throw new Error(`Unexpected dependency ${name}`); })(),
    process: { env: { MAKEBORNE_LIVE_BUILDER_ENABLED: "true", ANTHROPIC_API_KEY: "fake-not-a-key" } }, Response, Request, AbortController, setTimeout, clearTimeout,
    console: { ...console, error: line => logged.push(String(line)) }, JSON, Math, Number, Date, Error, Object, Boolean, String, Set, Promise, fetch: () => { throw new Error("Network forbidden"); } });
  new vm.Script(compiled, { filename: file }).runInContext(context);
  return { POST: routeModule.exports.POST, releases, logged };
}
const request = () => new Request("https://test.invalid/api/build/questions", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ workspaceId: "22222222-2222-4222-8222-222222222222", artifactId: "33333333-3333-4333-8333-333333333333", kind: "website", brief: "A bakery site" }) });

let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`); };
(async () => {
  await check("a successful reading releases the hold with whole credits (the absorbed cost, rounded up) and returns the questions", async () => {
    const route = load({ confirmedMicrousd: 1234 }); // $0.001234: 0.04 credits, recorded as 1 absorbed credit
    const reply = await route.POST(request());
    assert.equal(reply.status, 200); assert.equal((await reply.json()).questions.length, 1);
    assert.deepEqual(route.releases.map(item => [item.measured, item.reason]), [[1, "brief_questions"]]);
    assert.deepEqual(route.logged, [], "nothing to report");
  });
  await check("a failed reading also releases with whole credits, and says nothing was charged", async () => {
    const route = load({ confirmedMicrousd: 0, providerFails: true });
    const reply = await route.POST(request());
    assert.equal(reply.status, 503); assert.match((await reply.json()).error.message, /Nothing was charged/);
    assert.deepEqual(route.releases.map(item => item.measured), [0]);
  });
  await check("a release that fails is logged with its reference and code (no brief text), never swallowed silently", async () => {
    const route = load({ confirmedMicrousd: 500, releaseFails: true });
    const reply = await route.POST(request());
    assert.equal(reply.status, 200);
    assert.equal(route.logged.length, 1);
    const entry = JSON.parse(route.logged[0]);
    assert.equal(entry.event, "brief_questions_release_failed"); assert.equal(entry.code, "CREDITS_UNAVAILABLE"); assert.match(entry.reference, /^brief_questions:/);
    assert.doesNotMatch(route.logged[0], /bakery/i, "the client's brief is not logged");
  });
  console.log(`${passed} questions route checks passed (fakes only, no network).`);
})().catch(error => { console.error(error); process.exit(1); });
