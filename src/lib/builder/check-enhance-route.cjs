/* eslint-disable @typescript-eslint/no-require-imports -- Behavioural checks for POST /api/build/enhance (free prompt help): the route runs with its cloud, credit, capacity and model modules replaced by recording fakes, so its refusals, holds and releases are observed, not read from the source. Offline, no network. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const src = path.join(__dirname, "..", "..");
const routeFile = path.join(src, "app", "api", "build", "enhance", "route.ts");

// Recording fakes for the route's server dependencies; every other module is the real one.
const calls = [];
const state = {};
function reset(overrides = {}) {
  calls.length = 0;
  Object.assign(state, { capacity: null, reserve: null, release: null, enhanced: "ok", role: "owner", kind: "website", ...overrides });
}
class RequestError extends Error { constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; } }
const fakes = {
  "@/lib/server/http": {
    RequestError,
    sameOrigin: () => undefined,
    boundedJson: async request => request.json(),
    apiError: error => error instanceof RequestError
      ? Response.json({ error: { code: error.code, message: error.message } }, { status: error.status })
      : Response.json({ error: { code: "REQUEST_FAILED", message: String(error?.message ?? error) } }, { status: 500 }),
  },
  "@/lib/cloud/server": {
    validId: () => undefined, databaseError: error => { if (error) throw error; },
    cloudContext: async () => ({ user: { id: "u1" }, workspace: { role: state.role }, client: { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "a1", kind: state.kind, title: "Fixture" }, error: null }) }) }) }) }) } }),
  },
  "@/lib/credits/server": {
    HOLD_LIFETIME_MS: 15 * 60_000,
    reserveCredits: async (user, amount, reference) => { calls.push(["reserve", amount]); if (state.reserve) throw state.reserve; return { userId: user, reference, amount, exempt: false, reservedAt: Date.now() }; },
    releaseRun: async (hold, measured, reason) => { calls.push(["release", reason]); if (state.release) throw state.release; },
    settleRun: async () => { calls.push(["settle"]); return { outcome: "settled", charged: 1 }; },
  },
  "@/lib/ai/live-run": {
    CLOCK_SKEW_MS: 1000, SETTLEMENT_WINDOW_MS: 60_000, databaseGate: () => ({ check: async () => undefined }),
    requireProviderCapacity: async () => { calls.push(["capacity"]); if (state.capacity) throw state.capacity; },
  },
  "@/lib/ai/model-check": { requirePricedModel: () => undefined },
  "@/lib/builder/website-run": { logAiStop: () => { calls.push(["stop"]); return null; } },
  "@/lib/builder/brief-enhancer": {
    ENHANCER_MODEL: "claude-haiku-5-5",
    enhanceBrief: async input => { calls.push(["enhance", input.mode]); if (state.enhanced === "throw") throw new Error("provider"); if (state.enhanced === null) { input.onReply?.('{"business":"SECRET-CLIENT-TEXT"', "max_tokens"); return null; } return briefFixture; },
    unusableReason: text => (text.endsWith("}") ? "fields" : "invalid JSON"),
  },
};
const briefFixture = {
  business: "A bakery.", workingName: null, goal: "Sell bread.", primaryAction: { label: "Pre-order", kind: "buy" }, audience: "Locals.",
  sections: [{ name: "Bakes", anchor: "bakes", purpose: "The bread.", include: [] }], tone: "loud", toneWhy: "Food.",
  imagery: { plan: "illustration", notes: "Drawn loaves.", textInImage: null }, factsGiven: [], factsMissing: [], conflicts: [], constraints: [], answersUsed: [],
};
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  if (parent?.filename === routeFile && fakes[name]) return fakes[name];
  if (name.startsWith("@/")) return load.call(this, path.join(src, `${name.slice(2)}.ts`), parent, main);
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
globalThis.fetch = async () => { throw new Error("Network forbidden"); };
process.env.MAKEBORNE_LIVE_BUILDER_ENABLED = "true";
process.env.ANTHROPIC_API_KEY = "sk-offline-never-sent";
const { POST } = require(routeFile);
const { ENHANCER_CREDITS } = require("./enhanced-brief.ts");

const body = brief => ({ workspaceId: "00000000-0000-4000-8000-000000000001", artifactId: "00000000-0000-4000-8000-000000000002", brief, original: brief });
const post = brief => POST(new Request("http://127.0.0.1:3000/api/build/enhance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body(brief)) }));
const short = "Website for my bakery", detailed = "word ".repeat(80).trim();

let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }

(async () => {
  await check("a detailed brief is analysed (never rewritten) inside a one-credit hold that is released, never settled; the reply says charged 0", async () => {
    reset();
    const response = await post(detailed), value = await response.json();
    assert.equal(response.status, 200);
    assert.equal(value.mode, "analyze"); assert.equal(value.charged, 0);
    assert.deepEqual(calls, [["capacity"], ["reserve", ENHANCER_CREDITS], ["enhance", "analyze"], ["release", "brief_analysis"]]);
  });
  await check("a short brief is enhanced; still released and never charged", async () => {
    reset();
    const value = await (await post(short)).json();
    assert.equal(value.mode, "enhance"); assert.equal(value.charged, 0);
    assert.ok(!calls.some(([kind]) => kind === "settle"));
    assert.deepEqual(calls.at(-1), ["release", "brief_enhance"]);
  });
  await check("an unusable or failed reading releases the hold and says nothing was charged", async () => {
    for (const enhanced of [null, "throw"]) {
      reset({ enhanced });
      const logged = [], error = console.error;
      console.error = line => logged.push(String(line));
      let response;
      try { response = await post(short); } finally { console.error = error; }
      // Every failure is logged with its shape or cause, never the client's text.
      assert.ok(logged.some(line => enhanced === null ? /brief_enhance_unusable/.test(line) && /"stop":"max_tokens"/.test(line) && /invalid JSON/.test(line) : /brief_enhance_failed/.test(line) && /Error: provider/.test(line)), logged.join("\n"));
      assert.ok(!logged.some(line => /SECRET-CLIENT-TEXT/.test(line)), "no reply content in the log");
      const value = await response.json();
      assert.equal(response.status, 503); assert.equal(value.error.code, "ENHANCE_UNAVAILABLE"); assert.match(value.error.message, /Nothing was charged/);
      assert.deepEqual(calls.at(-1), ["release", "brief_enhance_unusable"]);
    }
  });
  await check("no room for the hold (no credits, or the monthly limit): the reading does not run and the reply says why, plainly", async () => {
    for (const [code, words] of [["INSUFFICIENT_CREDITS", /no credits left[\s\S]*add credits/], ["CREDIT_USAGE_LIMIT", /monthly credit usage limit[\s\S]*Billing/]]) {
      reset({ reserve: new RequestError(code, "raw", 402) });
      const response = await post(detailed), value = await response.json();
      assert.equal(response.status, 402); assert.equal(value.error.code, code);
      assert.match(value.error.message, /wasn't read: reading it is free/); assert.match(value.error.message, words);
      assert.ok(!calls.some(([kind]) => kind === "enhance" || kind === "release"), "no provider call and nothing to release");
    }
  });
  await check("a paused provider or a reached daily cap refuses before any hold, with the server's own code", async () => {
    reset({ capacity: new RequestError("AI_PAUSED", "AI is paused.", 503) });
    const value = await (await post(short)).json();
    assert.equal(value.error.code, "AI_PAUSED");
    assert.deepEqual(calls, [["capacity"]]);
  });
  await check("a failed release is logged, not turned into a failed reading (the database reclaims the hold unspent)", async () => {
    reset({ release: new Error("db down") });
    const logged = [], error = console.error;
    console.error = line => logged.push(String(line));
    try {
      const response = await post(detailed);
      assert.equal(response.status, 200);
      assert.ok(logged.some(line => /credit_release_failed/.test(line) && /brief_analysis/.test(line)), logged.join("\n"));
    } finally { console.error = error; }
  });
  await check("reviewers and non-website projects are refused before any hold", async () => {
    reset({ role: "reviewer" });
    assert.equal((await (await post(short)).json()).error.code, "EDITOR_REQUIRED");
    reset({ kind: "presentation" });
    assert.equal((await (await post(short)).json()).error.code, "NOT_FOUND");
    assert.ok(!calls.some(([kind]) => kind === "reserve"));
  });
  console.log(`${passed} enhance route checks passed (fakes only, no network).`);
})().catch(error => { console.error(error); process.exit(1); });
