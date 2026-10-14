/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for the web search price card: what is allowed, how it is bounded, how usage is priced. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const src = path.join(__dirname, "..", "..");
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  if (name.startsWith("@/")) return load.call(this, path.join(src, `${name.slice(2)}.ts`), parent, main);
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const prices = require("./prices.ts");
const { budgetedStream, ContextMeter } = require("./anthropic-call.ts");
const { RunSpend, memoryGate } = require("./run-spend.ts");

const HAIKU = "claude-haiku-5-5";
const search = (extra = {}) => ({ type: "web_search_20250305", name: "web_search", max_uses: 3, ...extra });
const request = (tools, model = HAIKU) => ({ model, max_tokens: 2000, messages: [], system: [], tools, output_config: { effort: "low" } });
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }

(async () => {
  await check("only the basic, direct, capped web search on a verified model is allowed", () => {
    prices.assertSupportedTextRequest(request([search()]));
    prices.assertSupportedTextRequest(request([search({ allowed_domains: ["instagram.com"], allowed_callers: ["direct"], user_location: { type: "approximate", city: "Austin" } })]));
    const refused = [
      [search({ max_uses: undefined })], [search({ max_uses: 0 })], [search({ max_uses: 6 })], [search({ max_uses: 2.5 })],
      [search({ allowed_callers: ["code_execution_20260120"] })], [search({ name: "search" })], [search({ cache_ttl: 1 })],
      [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }], [{ type: "web_search_20260318", name: "web_search", max_uses: 3 }],
      [{ type: "web_fetch_20250910", name: "web_fetch", max_uses: 1 }], [{ type: "code_execution_20250825", name: "code_execution" }],
    ];
    for (const tools of refused) assert.throws(() => prices.assertSupportedTextRequest(request(tools)), error => error.code === "UNSUPPORTED_AI_CONFIG", JSON.stringify(tools));
    assert.throws(() => prices.assertSupportedTextRequest(request([search()], "claude-opus-5-5")), /web search on "claude-opus-5-5"/, "models not verified for search are refused");
  });

  await check("the bound reserves every allowed search's fee and result tokens", () => {
    const perSearch = prices.WEB_SEARCH.microusdPerSearch + prices.WEB_SEARCH.resultTokensPerSearch * prices.maxInputTokenMicrousd(HAIKU);
    assert.equal(prices.serverToolBoundMicrousd(HAIKU, [search({ max_uses: 4 })]), Math.ceil(4 * perSearch + 1e-6));
    assert.equal(prices.serverToolBoundMicrousd(HAIKU, undefined), 0);
    assert.equal(prices.serverToolBoundMicrousd(HAIKU, [{ type: "custom", name: "x" }]), 0);
    assert.throws(() => prices.serverToolBoundMicrousd(HAIKU, [search({ max_uses: 99 })]), error => error.code === "UNSUPPORTED_AI_CONFIG");
  });

  await check("usage pricing adds $0.01 per search, refuses unknown server tools and applies Haiku's long-prompt tier", () => {
    const base = prices.textUsageMicrousd(HAIKU, { input_tokens: 6000, output_tokens: 900 });
    assert.equal(prices.textUsageMicrousd(HAIKU, { input_tokens: 6000, output_tokens: 900, server_tool_use: { web_search_requests: 2 } }), base + 20_000);
    assert.equal(prices.textUsageMicrousd(HAIKU, { input_tokens: 6000, output_tokens: 900, server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } }), base, "zero counts are free");
    assert.throws(() => prices.textUsageMicrousd(HAIKU, { input_tokens: 10, output_tokens: 10, server_tool_use: { web_fetch_requests: 1 } }), error => error.code === "UNPRICED_MODEL");
    const short = prices.textUsageMicrousd(HAIKU, { input_tokens: 100_000, output_tokens: 1000 });
    const long = prices.textUsageMicrousd(HAIKU, { input_tokens: 100_001, output_tokens: 1000 });
    assert.ok(long > short * 4.9, "over 100k prompt tokens the whole call is 5x");
  });

  await check("a searching call is bounded before it starts and its fees are recorded", async () => {
    const gate = memoryGate();
    const spend = new RunSpend({ run: "search-test", providerCapMicrousd: 200_000, customerCapMicrousd: 200_000, gate, deadline: Date.now() + 120_000 });
    const message = { model: HAIKU, usage: { input_tokens: 9000, output_tokens: 700, server_tool_use: { web_search_requests: 3 } }, content: [{ type: "text", text: "{}" }], stop_reason: "end_turn" };
    const client = { beta: { messages: {
      async countTokens() { return { input_tokens: 1500 }; },
      stream(params) { assert.equal(params.tools[0].max_uses, 3); return { currentMessage: message, on() { return this; }, async finalMessage() { return message; } }; },
    } } };
    const result = await budgetedStream({ client, spend, meter: new ContextMeter(async () => 1500), models: [HAIKU], maxTokens: 2000, minTokens: 500, signal: new AbortController().signal,
      params: { system: [], messages: [{ role: "user", content: "find" }], tools: [search()] } });
    const begun = gate.log.begin[0];
    assert.ok(begun.boundMicrousd >= prices.serverToolBoundMicrousd(HAIKU, [search()]), "bound includes the search allowance");
    assert.equal(result.costMicrousd, prices.textUsageMicrousd(HAIKU, message.usage));
    assert.ok(result.costMicrousd >= 30_000, "three search fees recorded");
    assert.ok(result.costMicrousd <= begun.boundMicrousd, "within the bound, so no overrun");
  });

  await check("a run too small for its searches is refused before any provider contact", async () => {
    const spend = new RunSpend({ run: "small", providerCapMicrousd: 20_000, customerCapMicrousd: 20_000, gate: memoryGate(), deadline: Date.now() + 120_000 });
    let contacted = false;
    const client = { beta: { messages: { async countTokens() { return { input_tokens: 100 }; }, stream() { contacted = true; throw new Error("should not be called"); } } } };
    await assert.rejects(budgetedStream({ client, spend, meter: new ContextMeter(async () => 100), models: [HAIKU], maxTokens: 2000, minTokens: 500, signal: new AbortController().signal,
      params: { messages: [], tools: [search({ max_uses: 5 })] } }), error => error.code === "RUN_BUDGET");
    assert.equal(contacted, false);
  });

  console.log(`\n${passed} web search pricing checks passed.`);
})().catch(error => { console.error(error); process.exit(1); });
