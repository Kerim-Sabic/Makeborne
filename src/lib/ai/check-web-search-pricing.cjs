/* eslint-disable @typescript-eslint/no-require-imports -- Offline conservative search and long-context spending checks. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const src = path.join(__dirname, "..", "..");
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  if (name.startsWith("@/")) return load.call(this, path.join(src, `${name.slice(2)}.ts`), parent, main);
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
globalThis.fetch = async () => { throw new Error("Network forbidden"); };
const prices = require("./prices.ts");
const { budgetedStream, ContextMeter } = require("./anthropic-call.ts");
const { RunSpend, memoryGate } = require("./run-spend.ts");
const HAIKU = "claude-haiku-5-5";
const search = (extra = {}) => ({ type: "web_search_20250305", name: "web_search", max_uses: 3, ...extra });
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
const makeSpend = (cap = 200_000) => new RunSpend({ run: "offline", providerCapMicrousd: cap, customerCapMicrousd: cap, gate: memoryGate(), deadline: Date.now() + 120_000 });
const call = (spend, client, extra = {}) => budgetedStream({ client, spend, meter: new ContextMeter(async () => 1500), models: [HAIKU], maxTokens: 2000, minTokens: 500, signal: new AbortController().signal, params: { messages: [] }, ...extra });
(async () => {
  await check("search is refused without a guaranteed result-token bound, even with max_uses", () => {
    assert.equal(prices.WEB_SEARCH.resultTokensPerSearch, null);
    for (const max_uses of [1, 3, 5]) {
      assert.throws(() => prices.assertSupportedTextRequest({ model: HAIKU, tools: [search({ max_uses })] }), /no documented or provider-enforced/);
      assert.throws(() => prices.serverToolBoundMicrousd(HAIKU, [search({ max_uses })]), /no documented or provider-enforced/);
    }
    for (const type of ["web_search_20260209", "web_fetch_20250910", "code_execution_20250825"])
      assert.throws(() => prices.assertSupportedTextRequest({ model: HAIKU, tools: [{ type, name: "web_search" }] }), error => error.code === "UNSUPPORTED_AI_CONFIG");
    assert.equal(prices.serverToolBoundMicrousd(HAIKU, [{ type: "custom", name: "x" }]), 0);
  });
  await check("search refusal occurs before provider stream and spending reservation", async () => {
    const spend = makeSpend(); let contacted = false, counted = false;
    const client = { beta: { messages: { stream() { contacted = true; throw new Error("not allowed"); } } } };
    await assert.rejects(call(spend, client, { meter: new ContextMeter(async () => { counted = true; return 1500; }), params: { messages: [], tools: [search()] } }), /no documented or provider-enforced/);
    assert.equal(contacted, false); assert.equal(counted, false); assert.equal(spend.pendingMicrousd, 0); assert.equal(spend.calls.length, 0);
  });
  await check("historical search usage stays priced; invalid usage fails closed", () => {
    const base = prices.textUsageMicrousd(HAIKU, { input_tokens: 6000, output_tokens: 900 });
    assert.equal(prices.textUsageMicrousd(HAIKU, { input_tokens: 6000, output_tokens: 900, server_tool_use: { web_search_requests: 2 } }), base + 20_000);
    for (const usage of [{}, { input_tokens: -1, output_tokens: 0 }, { input_tokens: 10, output_tokens: NaN }, { input_tokens: 1, output_tokens: 1, server_tool_use: { web_search_requests: -1 } }])
      assert.throws(() => prices.textUsageMicrousd(HAIKU, usage), /invalid.*usage|invalid usage/);
    assert.throws(() => prices.textUsageMicrousd(HAIKU, { input_tokens: 10, output_tokens: 10, server_tool_use: { web_fetch_requests: 1 } }), error => error.code === "UNPRICED_MODEL");
  });
  await check("Haiku reservation uses the full expensive tier above the threshold, including output", () => {
    for (const input of [100_000, 100_001]) {
      const tier = input > 100_000 ? 5 : 1;
      const bound = prices.textCallBoundMicrousd(HAIKU, input, 1000);
      assert.equal(bound, Math.ceil((input * prices.maxInputTokenMicrousd(HAIKU) + 1000 * prices.maxOutputTokenMicrousd(HAIKU)) * tier + 1e-6));
      assert.ok(bound >= prices.textUsageMicrousd(HAIKU, { input_tokens: 0, cache_creation_input_tokens: input, cache_creation: { ephemeral_5m_input_tokens: input }, output_tokens: 1000, inference_geo: "us" }));
    }
  });
  await check("long-context output room shares the capped budget with earlier spend", async () => {
    const spend = makeSpend(90_000);
    const prior = await spend.begin("anthropic", HAIKU, 10_000); await spend.finish(prior, { actualMicrousd: 10_000 });
    let max;
    const client = { beta: { messages: { stream(params) { max = params.max_tokens; return { on() {}, async finalMessage() { return { model: HAIKU, usage: { input_tokens: 100_001, output_tokens: params.max_tokens }, content: [], stop_reason: "end_turn" }; } }; } } } };
    await call(spend, client, { meter: new ContextMeter(async () => 100_001), maxTokens: 50_000 });
    assert.ok(max < 6000, "5x output rate shrinks output room");
    assert.ok(spend.providerMicrousd <= 90_000); assert.equal(spend.stopped, null);
  });
  await check("malformed final usage is recorded at the full bound and not charged", async () => {
    const spend = makeSpend();
    const client = { beta: { messages: { stream() { return { on() {}, async finalMessage() { return { model: HAIKU, usage: {}, content: [], stop_reason: "end_turn" }; } }; } } } };
    await assert.rejects(call(spend, client), /invalid token usage/);
    assert.equal(spend.calls.length, 1); assert.equal(spend.calls[0].actualMicrousd, null);
    assert.equal(spend.providerMicrousd, spend.calls[0].boundMicrousd); assert.equal(spend.confirmedMicrousd, 0); assert.equal(spend.pendingMicrousd, 0);
  });
  await check("synchronous stream failure resolves its ticket once at the full uncertain bound", async () => {
    const spend = makeSpend();
    const client = { beta: { messages: { stream() { throw new Error("transport failed"); } } } };
    await assert.rejects(call(spend, client), /transport failed/);
    assert.equal(spend.calls.length, 1); assert.equal(spend.calls[0].actualMicrousd, null); assert.equal(spend.pendingMicrousd, 0);
  });
  console.log(`\n${passed} web search pricing checks passed.`);
})().catch(error => { console.error(error); process.exit(1); });
