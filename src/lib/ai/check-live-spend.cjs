/* eslint-disable @typescript-eslint/no-require-imports -- Offline live-builder spending checks: mocked providers and billing, no network, no paid calls. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");

// ---------------------------------------------------------------------------
// Loader: TypeScript on the fly, server-only stubbed, billing replaced by an
// in-memory model of the SQL semantics (hold cap, outcomes, hold lifetime).
// ---------------------------------------------------------------------------
const billing = {
  holds: new Map(), outcomes: [], active: () => true, now: () => Date.now(), HOLD_LIFETIME_MS: 15 * 60_000,
  reset() { this.holds.clear(); this.outcomes.length = 0; this.active = () => true; },
  hold(amount, extra = {}) {
    const hold = { userId: "11111111-1111-4111-8111-111111111111", reference: `run-${this.holds.size + 1}-${Math.random().toString(36).slice(2, 8)}`, amount, exempt: false, reservedAt: Date.now(), ...extra };
    if (!hold.exempt && !extra.missing) this.holds.set(hold.reference, { amount, status: "reserved", charged: null });
    return hold;
  },
  async settleRun(hold, measured, detail) {
    let outcome, charged = 0;
    const row = billing.holds.get(hold.reference);
    if (hold.exempt) outcome = "exempt";
    else if (!row) outcome = "missing_hold";
    else if (row.status === "released") outcome = "released_hold";
    else if (row.status === "settled") { outcome = "replayed"; charged = row.charged; }
    else { outcome = "settled"; charged = Math.min(measured, row.amount); Object.assign(row, { status: "settled", charged }); }
    const result = { outcome, charged, absorbed: Math.max(measured - charged, 0), providerMicrousd: detail?.providerMicrousd ?? 0 };
    billing.outcomes.push({ kind: "settle", reference: hold.reference, measured, ...result, detail });
    return result;
  },
  async releaseRun(hold, measured, reason, detail) {
    const row = billing.holds.get(hold.reference);
    if (row && row.status === "reserved") row.status = "released";
    billing.outcomes.push({ kind: "release", reference: hold.reference, measured, reason, charged: 0, absorbed: measured, detail });
  },
  async holdIsActive(hold) { return hold.exempt || (billing.holds.get(hold.reference)?.status === "reserved" && billing.active(hold)); },
};
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  if (/(^|\/)credits\/server$/.test(name) && !parent?.filename?.endsWith("check-live-spend.cjs")) return billing;
  if (/(^|\/)billing\/database$/.test(name)) return { billingDatabase: () => { throw new Error("database not available offline"); } };
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);

const prices = require("./prices.ts");
const { RunSpend, SpendError, memoryGate } = require("./run-spend.ts");
const { budgetedStream, ContextMeter, builderModels } = require("./anthropic-call.ts");
const { startBudgetedImage } = require("./image-call.ts");
const { websiteBuildResponse } = require("../builder/website-run.ts");
const { documentBuildResponse } = require("../builder/docs-run.ts");
const { planStreamResponse } = require("../builder/plan-run.ts");
const { ProjectFiles } = require("../builder/files.ts");
const { MIN_STEP_TOKENS } = require("../builder/agent.ts");
const { APIError } = require("@anthropic-ai/sdk");

const RATE = 0.03, MICRO = 1e6;
const credits = microusd => Math.max(0, Math.ceil(microusd / MICRO / RATE - 1e-9));

let passed = 0;
async function check(name, fn) { billing.reset(); await fn(); passed++; console.log(`PASS ${name}`); }

// ---------------------------------------------------------------------------
// Mocked providers
// ---------------------------------------------------------------------------
const apiError = (status, beforeStart = true) => Object.assign(APIError.generate(status, { type: "error", error: { type: status === 529 ? "overloaded_error" : "api_error" } }, "mock", new Headers()), { __beforeStart: beforeStart });
const midStreamError = () => APIError.generate(undefined, { type: "error", error: { type: "overloaded_error" } }, "mock mid-stream", undefined);
const toolUse = (name, input, id = `tu_${Math.random().toString(36).slice(2, 10)}`) => ({ type: "tool_use", id, name, input });

/** Each stream() consumes the next step: { usage, content, stop, model, error, started, partialOutput, events }. */
function fakeAnthropic(steps, options = {}) {
  const log = { counts: 0, streams: [] };
  return { log, client: { beta: { messages: {
    async countTokens() { log.counts++; if (options.countError) throw options.countError; return { input_tokens: options.inputTokens ?? 5000 }; },
    stream(params, requestOptions) {
      log.streams.push({ model: params.model, max_tokens: params.max_tokens, maxRetries: requestOptions.maxRetries, fallbacks: params.fallbacks, betas: params.betas, toolNames: (params.tools ?? []).map(tool => tool.name), messages: params.messages, system: params.system });
      const step = steps.shift();
      if (!step) throw new Error("Mock script exhausted: unexpected provider call.");
      const listeners = [];
      const stream = {
        currentMessage: undefined,
        on(_event, fn) { listeners.push(fn); return stream; },
        async finalMessage() {
          const signal = requestOptions.signal;
          log.timeouts = [...(log.timeouts ?? []), requestOptions.timeout];
          if (step.slowMs) stream.currentMessage = { model: params.model, usage: { input_tokens: step.usage?.input_tokens ?? 5000, output_tokens: 0 }, content: [], stop_reason: null };
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, step.slowMs ?? options.delayMs ?? 0);
            signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason ?? new Error("aborted")); }, { once: true });
          });
          const model = step.model ?? params.model;
          if (step.error && !step.started) throw step.error;
          stream.currentMessage = { model, usage: { input_tokens: step.usage?.input_tokens ?? 5000, output_tokens: step.partialOutput ?? 0 }, content: [], stop_reason: null };
          for (const event of step.events ?? []) for (const fn of listeners) fn(event);
          if (step.error) throw step.error;
          const message = { model, usage: step.usage, content: step.content ?? [], stop_reason: step.stop ?? "tool_use" };
          stream.currentMessage = message;
          return message;
        },
      };
      return stream;
    },
  } } } };
}
function fakeImages(results) {
  const log = { calls: [] };
  return { log, client: { images: { async generate(body, options) {
    log.calls.push({ body, maxRetries: options.maxRetries });
    const next = results.shift();
    if (!next) throw new Error("Mock image script exhausted.");
    if (next.error) throw next.error;
    return { data: [{ b64_json: Buffer.from("fake-webp").toString("base64") }], usage: next.usage };
  } } } };
}
// gpt-image-2 medium portrait: the bound allows 1,384 output tokens (published $0.041 per image).
const IMAGE_USAGE = { input_tokens: 50, output_tokens: 1300, input_tokens_details: { text_tokens: 50, image_tokens: 0 } };
const IMAGE_COST = 50 * 5 + 1300 * 30;
// Image runs need an explicit key and model; the key is never used because every client is a fake.
process.env.OPENAI_API_KEY = "sk-offline-test-never-sent";
process.env.MAKEBORNE_IMAGE_MODEL = "gpt-image-2";
const storeImage = async (request) => ({ id: "aaaaaaaa-aaaa-5aaa-aaaa-aaaaaaaaaaaa".replace(/a{4}$/, Math.random().toString(16).slice(2, 6).padEnd(4, "0")), path: `public/images/${request.name}.webp`,
  sha256: "a".repeat(64), bytes: 9, mediaType: "image/webp", url: `/images/${request.name}.webp` });

function spendFor(hold, options = {}) {
  const gate = options.gate ?? memoryGate();
  const spend = new RunSpend({ run: hold.reference, providerCapMicrousd: Math.floor((options.providerCapCredits ?? 50) * RATE * MICRO),
    customerCapMicrousd: hold.exempt ? null : Math.floor(hold.amount * RATE * MICRO), gate,
    deadline: options.deadline ?? Math.min(Date.now() + 280_000, hold.reservedAt + 15 * 60_000 - 90_000) });
  return { spend, gate };
}
function baseFiles() {
  const files = new ProjectFiles();
  files.write("index.html", '<!doctype html><html><head><title>T</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>');
  files.write("src/main.tsx", 'import { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./styles.css";\ncreateRoot(document.getElementById("root")!).render(<App />);');
  files.write("src/App.tsx", 'export default function App() { return <main><h1>Hello</h1></main>; }');
  files.write("src/styles.css", "body { margin: 0 }");
  return new ProjectFiles(files.toSource());
}
function fakeSupabase() {
  const saves = [];
  return { saves, client: { async rpc(name, args) { saves.push({ name, args }); return { data: { version: { version_number: args.p_expected_version + 1 } }, error: null }; } } };
}
async function sse(response) {
  const text = await new Response(response.body).text();
  return text.split("\n\n").filter(chunk => chunk.startsWith("data: ")).map(chunk => JSON.parse(chunk.slice(6)));
}
const app = 'export default function App() { return <main><h1>Updated</h1></main>; }';
function websiteRun(hold, spend, anthropic, extra = {}) {
  const db = fakeSupabase();
  const response = websiteBuildResponse({ client: db.client, hold, spend, workspaceId: "22222222-2222-4222-8222-222222222222",
    artifact: { id: "33333333-3333-4333-8333-333333333333", project_id: "44444444-4444-4444-8444-444444444444", title: "T", current_version: 1 },
    current: { assetIds: [], content: { title: "T" }, style: {} }, files: extra.files ?? baseFiles(), reviewing: false, message: "Update the heading", effort: "medium",
    request: "Update the heading", context: "<project/>", snapshot: extra.snapshot, attachments: [], maxDuration: 300, anthropic, imageClient: extra.imageClient, storeImage, stepGuardMs: extra.stepGuardMs, compile: extra.compile });
  return { db, response };
}

(async () => {
  await check("document finish refuses failed sibling tools and repairs before completing", async () => {
    const {runDocumentBuilder} = require("../builder/docs-agent.ts");
    const {DocumentEditor,emptyDocument} = require("../documents/editor.ts");
    const editor=new DocumentEditor(emptyDocument("book","Brief"));
    editor.apply("write_chapter",{chapter:{id:"intro",title:"Introduction",text:"Existing chapter."}});
    const fake=fakeAnthropic([
      {usage:{input_tokens:100,output_tokens:100},content:[toolUse("write_chapter",{chapter:"invalid string"}),toolUse("finish",{summary:"Premature"})]},
      {usage:{input_tokens:100,output_tokens:100},content:[toolUse("write_chapter",{chapter:{id:"checklist",title:"Checklist",text:"Confirm scope and approval."}}),toolUse("finish",{summary:"Complete"})]},
    ]);
    const hold=billing.hold(50),{spend}=spendFor(hold),events=[];
    const result=await runDocumentBuilder({client:fakeSupabase().client,scope:{workspaceId:"test",projectId:"test"},editor,effort:"light",spend,request:"Add checklist",context:"",attachments:[],emit:event=>events.push(event),signal:new AbortController().signal,deadline:Date.now()+280000,anthropic:fake.client});
    assert.equal(fake.log.streams.length,2);assert.equal(result.finished,true);
    assert.equal(editor.doc.chapters.length,2);assert.equal(editor.doc.chapters[0].text,"Existing chapter.");
    assert(events.some(event=>event.type==="tool_error"&&event.tool==="finish"));
  });
  // ---- 1. Prices: verified card, fail closed, per-attempt billing ---------
  await check("prices: verified card; unknown models, speeds and image sizes fail closed", async () => {
    assert.equal(prices.PRICES_VERIFIED_AT, "2026-10-12");
    assert.deepEqual(prices.TEXT_PRICES["claude-opus-5-5"], { input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20 });
    assert.deepEqual(prices.TEXT_PRICES["claude-sonnet-5-5"], { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1, output: 10 });
    assert.throws(() => prices.textPrice("claude-unknown"), prices.UnpricedModelError);
    assert.throws(() => prices.textPrice("__proto__"), prices.UnpricedModelError);
    assert.throws(() => prices.textUsageMicrousd("claude-opus-5-5", { input_tokens: 1, output_tokens: 1, speed: "fast" }), prices.UnpricedModelError);
    assert.throws(() => prices.imageCallBoundMicrousd("gpt-image-2", "medium", "1792x1024", "x"), prices.UnpricedModelError);
    assert.throws(() => prices.assertSupportedImageRequest({ model: "gpt-image-2", quality: "high", size: "1024x1024" }), prices.UnsupportedConfigurationError);
    assert.throws(() => prices.imageCallBoundMicrousd("gpt-image-9", "medium", "1024x1024", "x"), prices.UnpricedModelError);
  });
  await check("prices: fallback iterations are each billed at their own model; cache TTLs and US inference priced", async () => {
    const usage = { input_tokens: 412, output_tokens: 264, iterations: [
      { type: "message", model: "claude-opus-5-5", input_tokens: 535, output_tokens: 100 },
      { type: "fallback_message", model: "claude-sonnet-5-5", input_tokens: 412, output_tokens: 264 }] };
    assert.equal(prices.textUsageMicrousd("claude-opus-5-5", usage), Math.ceil(535 * 4 + 100 * 20 + 412 * 2 + 264 * 10));
    assert.throws(() => prices.textUsageMicrousd("claude-opus-5-5", { ...usage, iterations: [{ model: "claude-mystery", input_tokens: 1, output_tokens: 1 }] }), prices.UnpricedModelError);
    assert.equal(prices.textUsageMicrousd("claude-opus-5-5", { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 100, cache_creation: { ephemeral_5m_input_tokens: 60, ephemeral_1h_input_tokens: 40 } }), 60 * 5 + 40 * 8);
    assert.equal(prices.textUsageMicrousd("claude-opus-5-5", { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 100 }), 800, "no TTL breakdown: priced at the 1h rate");
    assert.equal(prices.textUsageMicrousd("claude-opus-5-5", { input_tokens: 1000, output_tokens: 0, inference_geo: "us" }), 4400);
    // The bound covers any usage within its limits, at the worst rates.
    const bound = prices.textCallBoundMicrousd("claude-opus-5-5", 10_000, 2_000);
    assert.ok(bound >= prices.textUsageMicrousd("claude-opus-5-5", { input_tokens: 0, output_tokens: 2000, cache_creation_input_tokens: 10_000, cache_creation: { ephemeral_5m_input_tokens: 10_000 }, inference_geo: "us" }));
    assert.equal(prices.imageUsageMicrousd("gpt-image-2", IMAGE_USAGE), IMAGE_COST);
    assert.ok(prices.imageCallBoundMicrousd("gpt-image-2", "medium", "1024x1536", "x".repeat(3000)) >= prices.imageUsageMicrousd("gpt-image-2", { input_tokens: 3000, output_tokens: 1384, input_tokens_details: { text_tokens: 3000, image_tokens: 0 } }));
  });

  // ---- 2. Run spending: caps, uncertainty, overrun, deadline -------------
  await check("run spend: provider and customer caps are separate; uncertain usage counts at the bound; overrun stops the run", async () => {
    const gate = memoryGate();
    const spend = new RunSpend({ run: "r", providerCapMicrousd: 1_000_000, customerCapMicrousd: 300_000, gate, deadline: Date.now() + 60_000 });
    assert.equal(spend.allowanceMicrousd, 300_000);
    const a = await spend.begin("anthropic", "claude-opus-5-5", 200_000);
    await assert.rejects(spend.begin("anthropic", "claude-opus-5-5", 200_000), error => error instanceof SpendError && error.code === "RUN_BUDGET", "pending bound blocks a second call");
    await spend.finish(a, { actualMicrousd: null, partialMicrousd: 50_000 });
    assert.equal(spend.confirmedMicrousd, 50_000); assert.equal(spend.uncertainMicrousd, 150_000); assert.equal(spend.providerMicrousd, 200_000);
    assert.equal(spend.remainingMicrousd, 100_000, "uncertain usage is never treated as zero");
    assert.equal(spend.customerCredits(RATE), credits(50_000), "only confirmed usage is chargeable");
    const b = await spend.begin("anthropic", "claude-opus-5-5", 10_000);
    await spend.finish(b, { actualMicrousd: 20_000 });
    assert.equal(spend.stopped, "OVERRUN");
    await assert.rejects(spend.begin("anthropic", "claude-opus-5-5", 1), error => error.code === "OVERRUN");
    const exempt = new RunSpend({ run: "x", providerCapMicrousd: 100, customerCapMicrousd: null, gate, deadline: Date.now() + 60_000 });
    assert.equal(exempt.allowanceMicrousd, 100, "admin exemption keeps the provider cap");
    const late = new RunSpend({ run: "y", providerCapMicrousd: 100, customerCapMicrousd: 100, gate, deadline: Date.now() - 1 });
    await assert.rejects(late.begin("anthropic", "claude-opus-5-5", 1), error => error.code === "HOLD_EXPIRED" && error.graceful);
    assert.equal(gate.log.begin.length, 2, "refused calls never reach the gate");
  });

  // ---- 3. Bounded calls: retries, fallback, partial failure --------------
  const streamCall = (fake, spend, extra = {}) => budgetedStream({ client: fake.client, spend, meter: new ContextMeter(async () => fake.client.beta.messages.countTokens({}).then(r => r.input_tokens)),
    models: extra.models ?? ["claude-opus-5-5"], params: { messages: [{ role: "user", content: "hi" }] }, maxTokens: extra.maxTokens ?? 8000, minTokens: 2048,
    signal: new AbortController().signal, sleep: async () => {}, retries: extra.retries });
  const okStep = (output = 1000) => ({ usage: { input_tokens: 5000, output_tokens: output }, content: [{ type: "text", text: "ok" }], stop: "end_turn" });

  await check("bounded call: max_tokens shrinks to the budget; too little budget never contacts the provider; SDK retries off; no server-side fallback", async () => {
    const hold = billing.hold(10); // 300,000 microusd
    const { spend } = spendFor(hold);
    const fake = fakeAnthropic([okStep()]);
    await streamCall(fake, spend, { maxTokens: 64_000 });
    const inputBound = Math.ceil(5000 * 1.02) + 512;
    assert.equal(fake.log.streams[0].max_tokens, Math.floor((300_000 - Math.ceil(inputBound * 5.5)) / 22));
    assert.equal(fake.log.streams[0].maxRetries, 0);
    assert.equal(fake.log.streams[0].fallbacks, undefined);
    const poor = spendFor(billing.hold(2)).spend; // 60,000 microusd
    const none = fakeAnthropic([]);
    await assert.rejects(streamCall(none, poor), error => error.code === "RUN_BUDGET");
    assert.equal(none.log.streams.length, 0);
    const failingCount = fakeAnthropic([], { countError: new Error("count down") });
    await assert.rejects(streamCall(failingCount, spendFor(billing.hold(50)).spend), error => error.code === "SPEND_UNAVAILABLE", "no bound, no call");
    assert.equal(failingCount.log.streams.length, 0);
    assert.deepEqual(builderModels("claude-opus-5-5", {}), ["claude-opus-5-5"], "explicit fallbacks are off by default");
    assert.deepEqual(builderModels("claude-opus-5-5", { MAKEBORNE_BUILDER_FALLBACK_MODELS: " claude-sonnet-5-5 ,claude-opus-5-5" }), ["claude-opus-5-5", "claude-sonnet-5-5"]);
  });

  await check("retries and fallback share one budget: overloaded attempts cost nothing, 5xx attempts count at their bound, fallback model priced", async () => {
    const { spend, gate } = spendFor(billing.hold(50));
    const fake = fakeAnthropic([{ error: apiError(529) }, { error: apiError(500) }, { error: apiError(529) }, okStep(2000)]);
    const result = await streamCall(fake, spend, { models: ["claude-opus-5-5", "claude-sonnet-5-5"], retries: 2 });
    assert.equal(result.model, "claude-sonnet-5-5");
    assert.deepEqual(fake.log.streams.map(s => s.model), ["claude-opus-5-5", "claude-opus-5-5", "claude-opus-5-5", "claude-sonnet-5-5"]);
    const [overloaded, server] = spend.calls;
    assert.equal(overloaded.actualMicrousd, 0);
    assert.equal(server.actualMicrousd, null, "a 5xx attempt's usage is unknown");
    assert.equal(spend.uncertainMicrousd, server.boundMicrousd);
    assert.equal(spend.confirmedMicrousd, 5000 * 2 + 2000 * 10);
    assert.ok(fake.log.streams[3].max_tokens <= Math.floor((spend.allowanceMicrousd - server.boundMicrousd - Math.ceil((Math.ceil(5000 * 1.02) + 512) * 2.75)) / 11));
    assert.equal(gate.log.begin.length, 4); assert.equal(gate.log.finish.length, 4);
  });

  await check("partial stream failure: confirmed tokens charged, the rest recorded at the bound, not retried", async () => {
    const { spend } = spendFor(billing.hold(50));
    const fake = fakeAnthropic([{ started: true, partialOutput: 1500, error: midStreamError() }]);
    await assert.rejects(streamCall(fake, spend));
    assert.equal(fake.log.streams.length, 1);
    const [call] = spend.calls;
    assert.equal(call.partialMicrousd, 5000 * 4 + 1500 * 20);
    assert.equal(spend.uncertainMicrousd, call.boundMicrousd - call.partialMicrousd);
    assert.equal(spend.customerCredits(RATE), credits(50_000));
  });

  await check("unpriced serving model (e.g. an unknown fallback) fails closed and is recorded at the bound", async () => {
    const { spend } = spendFor(billing.hold(50));
    const fake = fakeAnthropic([{ ...okStep(), usage: { input_tokens: 5000, output_tokens: 1000, iterations: [{ type: "fallback_message", model: "claude-mystery", input_tokens: 5000, output_tokens: 1000 }] } }]);
    await assert.rejects(streamCall(fake, spend), prices.UnpricedModelError);
    assert.equal(spend.uncertainMicrousd, spend.calls[0].boundMicrousd);
  });

  // ---- 3b. Cached conversations: what the previous call cached is reserved at the read price ----
  // A design review's 15-credit round: the cold first call (system, tools, site and screenshots, ~30K tokens written to the
  // cache) costs $0.27; priced as if nothing were cached, the next call's input alone no longer fits what is left.
  // What the cold call wrote to the cache (its 2 uncached input tokens are not part of the entry).
  const OPUS = "claude-opus-5-5", CACHED = 30_000;
  const coldStep = () => ({ usage: { input_tokens: 2, cache_creation_input_tokens: 30_000, cache_creation: { ephemeral_5m_input_tokens: 30_000, ephemeral_1h_input_tokens: 0 }, output_tokens: 6000 },
    content: [toolUse("edit_file", { path: "src/App.tsx", old_string: "Hello", new_string: "Hi" })], stop: "tool_use" });
  const warmStep = (usage = { input_tokens: 2, cache_read_input_tokens: CACHED, cache_creation_input_tokens: 6400, cache_creation: { ephemeral_5m_input_tokens: 6400, ephemeral_1h_input_tokens: 0 }, output_tokens: 1500 }) =>
    ({ usage, content: [{ type: "text", text: "done" }], stop: "end_turn" });
  function cachedLoop(fake, spend) {
    let t = 1_000_000;
    const meter = new ContextMeter(async () => fake.client.beta.messages.countTokens({}).then(r => r.input_tokens));
    const messages = [{ role: "user", content: [{ type: "text", text: "<current_files>…</current_files>" }, { type: "text", text: "Review the screenshots." }] }];
    const call = () => budgetedStream({ client: fake.client, spend, meter, models: [OPUS], params: { cache_control: { type: "ephemeral" }, messages }, maxTokens: 64_000, minTokens: MIN_STEP_TOKENS,
      signal: new AbortController().signal, sleep: async () => {}, now: () => t });
    const reply = message => {
      messages.push({ role: "assistant", content: message.content });
      meter.afterReply(message.usage, messages);
      const use = message.content.find(block => block.type === "tool_use");
      if (use) messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: use.id, content: "Edited src/App.tsx." }] });
    };
    return { meter, messages, call, reply, wait: ms => { t += ms; }, now: () => t };
  }
  const { CACHE_FRESH_MS, cacheKey, cachePositions } = require("./anthropic-call.ts");

  await check("cached conversation: the next call reserves the cached prefix at the read price, so a 15-credit round gets past its cold first call; the gate gets the worst case; tokens recorded", async () => {
    const { spend, gate } = spendFor(billing.hold(15), { providerCapCredits: 15 });
    const fake = fakeAnthropic([coldStep(), warmStep()], { inputTokens: 30_000 });
    const loop = cachedLoop(fake, spend);
    loop.reply((await loop.call()).message);
    assert.equal(spend.confirmedMicrousd, 30_000 * 5 + 2 * 4 + 6000 * 20, "the cold call: the whole prefix written to the cache");
    loop.wait(90_000);
    const inputBound = await loop.meter.bound(loop.messages), left = spend.remainingMicrousd;
    assert.ok(Math.ceil(inputBound * prices.maxInputTokenMicrousd(OPUS)) > left, "priced as uncached, the next call's input alone exceeds what is left (the old stop)");
    loop.reply((await loop.call()).message);
    const expectedInput = Math.ceil((inputBound - CACHED) * prices.maxInputTokenMicrousd(OPUS) + CACHED * prices.cachedInputTokenMicrousd(OPUS)) + 2;
    const maxTokens = fake.log.streams[1].max_tokens;
    assert.equal(maxTokens, Math.floor((left - expectedInput) / prices.maxOutputTokenMicrousd(OPUS)));
    assert.ok(maxTokens >= MIN_STEP_TOKENS);
    const [, second] = spend.calls;
    assert.equal(second.boundMicrousd, prices.textCallBoundMicrousd(OPUS, inputBound, maxTokens, CACHED));
    assert.equal(second.worstCaseMicrousd, prices.textCallBoundMicrousd(OPUS, inputBound, maxTokens));
    assert.equal(gate.log.begin[1].boundMicrousd, second.worstCaseMicrousd, "the platform gate reserves (and polices) the cost without the cache");
    assert.equal(gate.log.begin[0].boundMicrousd, spend.calls[0].boundMicrousd, "a call with nothing cached reserves its worst case, as before");
    assert.deepEqual({ ...gate.log.finish[1].detail, usage: undefined }, { model: OPUS, attempt: 0, stop: "end_turn", cachedTokens: CACHED, reservedMicrousd: second.boundMicrousd, usage: undefined });
    assert.equal(second.cacheMiss, false); assert.equal(spend.stopped, null);
    assert.deepEqual(gate.log.finish[1].detail.usage, { input: 2, cacheRead: CACHED, cacheWrite5m: 6400, cacheWrite1h: 0, output: 1500, imageInput: 0, webSearches: 0 });
    assert.deepEqual(spend.usageByModel(), { [OPUS]: { input: 4, cacheRead: CACHED, cacheWrite5m: 36_400, cacheWrite1h: 0, output: 7500, imageInput: 0, webSearches: 0, calls: 2, cacheMisses: 0 } });
    assert.ok(spend.providerMicrousd <= spend.allowanceMicrousd, "with the cache served, the round stays inside its allowance");
  });

  await check("cached conversation: only a cache that is surely alive counts (same model and settings, under 4 minutes, unchanged history, within the lookback); otherwise the worst case applies", async () => {
    const { spend } = spendFor(billing.hold(15), { providerCapCredits: 15 });
    const fake = fakeAnthropic([coldStep()], { inputTokens: 30_000 });
    const loop = cachedLoop(fake, spend);
    const startedAt = loop.now();
    loop.reply((await loop.call()).message);
    const key = cacheKey({ cache_control: { type: "ephemeral" }, messages: loop.messages, model: OPUS, max_tokens: 1 });
    assert.equal(loop.meter.cachedTokens(key, loop.messages, startedAt + 60_000), CACHED);
    assert.equal(loop.meter.cachedTokens(key, loop.messages, startedAt + CACHE_FRESH_MS), 0, "4 minutes after the last call started");
    assert.equal(loop.meter.cachedTokens(cacheKey({ cache_control: { type: "ephemeral" }, output_config: { effort: "low" }, model: OPUS }), loop.messages, startedAt + 60_000), 0, "another effort invalidates the cache");
    assert.equal(loop.meter.cachedTokens(cacheKey({ cache_control: { type: "ephemeral" }, model: "claude-haiku-5-5" }), loop.messages, startedAt + 60_000), 0, "caches are per model");
    const edited = structuredClone(loop.messages); edited[0].content[1].text = "Review the screenshots again.";
    assert.equal(loop.meter.cachedTokens(key, edited, startedAt + 60_000), 0, "an edited history is not the cached prefix");
    const many = [...loop.messages, { role: "user", content: Array.from({ length: 19 }, (_, i) => ({ type: "text", text: `note ${i}` })) }];
    assert.equal(loop.meter.cachedTokens(key, many, startedAt + 60_000), 0, "more new blocks than the lookback reaches");
    assert.equal(cachePositions([{ role: "user", content: Array.from({ length: 30 }, (_, i) => ({ type: "tool_result", tool_use_id: `t${i}`, content: "ok" })) }]), 1, "a run of tool results is one position");
    // The review's second call more than 4 minutes later: priced without the cache it cannot start, and nothing is sent.
    loop.wait(CACHE_FRESH_MS);
    await assert.rejects(loop.call(), error => error.code === "RUN_BUDGET");
    assert.equal(fake.log.streams.length, 1);
  });

  await check("cached conversation: a dropped cache costs more than the reservation but within the worst case: a cache miss, not an overrun; the run ends within its allowance plus the margin", async () => {
    const { spend, gate } = spendFor(billing.hold(15), { providerCapCredits: 15 });
    const miss = { input_tokens: 2, cache_creation_input_tokens: 36_400, cache_creation: { ephemeral_5m_input_tokens: 36_400, ephemeral_1h_input_tokens: 0 }, output_tokens: 3000 };
    const fake = fakeAnthropic([coldStep(), { ...warmStep(miss), content: [toolUse("edit_file", { path: "src/App.tsx", old_string: "Hi", new_string: "Hey" })], stop: "tool_use" }], { inputTokens: 30_000 });
    const loop = cachedLoop(fake, spend);
    loop.reply((await loop.call()).message);
    loop.wait(60_000);
    loop.reply((await loop.call()).message);
    const [, second] = spend.calls;
    assert.ok(second.actualMicrousd > second.boundMicrousd && second.actualMicrousd <= second.worstCaseMicrousd);
    assert.equal(second.cacheMiss, true); assert.equal(second.overrun, false); assert.equal(spend.stopped, null, "no overrun stop: the platform gate saw the worst case");
    assert.equal(gate.log.finish[1].detail.cacheMiss, true);
    assert.ok(spend.providerMicrousd > spend.allowanceMicrousd && spend.providerMicrousd <= spend.allowanceMicrousd * 1.5);
    assert.equal(spend.usageByModel()[OPUS].cacheMisses, 1);
    await assert.rejects(loop.call(), error => error.code === "RUN_BUDGET", "nothing is left: the run stops gracefully");
    assert.equal(fake.log.streams.length, 2);
    assert.ok(spend.customerCredits(RATE) > 15, "settlement caps the charge at the hold (see the website-run checks); the platform absorbs the rest");
  });

  await check("run spend worst cases: uncertain usage counts at the worst case; a worst case beyond the allowance plus the margin is refused; above the worst case is an overrun", async () => {
    const gate = memoryGate();
    const spend = new RunSpend({ run: "w", providerCapMicrousd: 100_000, customerCapMicrousd: null, gate, deadline: Date.now() + 60_000 });
    await assert.rejects(spend.begin("anthropic", OPUS, 10_000, { worstCaseMicrousd: 150_001 }), error => error.code === "RUN_BUDGET");
    await assert.rejects(spend.begin("anthropic", OPUS, 10_000, { worstCaseMicrousd: 9_999 }), /no lower than its bound/);
    assert.equal(gate.log.begin.length, 0);
    const a = await spend.begin("anthropic", OPUS, 10_000, { worstCaseMicrousd: 150_000 });
    assert.equal(gate.log.begin[0].boundMicrousd, 150_000); assert.equal(spend.remainingMicrousd, 90_000); assert.equal(spend.worstCaseRoomMicrousd, 0);
    await assert.rejects(spend.begin("anthropic", OPUS, 1), error => error.code === "RUN_BUDGET", "an open worst case holds the margin");
    await spend.finish(a, { actualMicrousd: null, partialMicrousd: 4_000 });
    assert.equal(spend.uncertainMicrousd, 146_000, "unknown usage counts at the worst case, as the gate records it"); assert.equal(spend.remainingMicrousd, 0);
    const b = new RunSpend({ run: "o", providerCapMicrousd: 100_000, customerCapMicrousd: null, gate, deadline: Date.now() + 60_000 });
    await b.finish(await b.begin("anthropic", OPUS, 10_000, { worstCaseMicrousd: 40_000 }), { actualMicrousd: 40_001 });
    assert.equal(b.stopped, "OVERRUN");
  });

  await check("token usage: cache writes by TTL (unsplit writes as 1-hour, as priced), fallback attempts summed, web searches, image tokens", async () => {
    assert.deepEqual(prices.textTokenUsage({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 40, cache_creation: { ephemeral_5m_input_tokens: 30, ephemeral_1h_input_tokens: 10 }, server_tool_use: { web_search_requests: 2 } }),
      { input: 10, cacheRead: 100, cacheWrite5m: 30, cacheWrite1h: 10, output: 5, imageInput: 0, webSearches: 2 });
    assert.equal(prices.textTokenUsage({ input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 40 }).cacheWrite1h, 40);
    assert.deepEqual(prices.textTokenUsage({ input_tokens: 9, output_tokens: 9, iterations: [{ model: OPUS, input_tokens: 3, output_tokens: 0 }, { model: "claude-sonnet-5-5", input_tokens: 4, output_tokens: 7 }] }),
      { ...prices.NO_TOKENS, input: 7, output: 7 });
    assert.deepEqual(prices.imageTokenUsage(IMAGE_USAGE), { ...prices.NO_TOKENS, input: 50, output: 1300 });
    assert.deepEqual(prices.imageTokenUsage({ input_tokens: 80, output_tokens: 10, input_tokens_details: { image_tokens: 30 } }), { ...prices.NO_TOKENS, input: 50, imageInput: 30, output: 10 });
  });

  await check("image calls: bound reserved before contact, actual usage recorded, failures at the bound, no SDK retries", async () => {
    const { spend } = spendFor(billing.hold(50));
    const images = fakeImages([{ usage: IMAGE_USAGE }, { error: Object.assign(new Error("server"), { status: 500 }) }]);
    const first = await startBudgetedImage({ client: images.client, spend, model: "gpt-image-2", prompt: "a calm harbour at dawn, watercolour", size: "1024x1536", quality: "medium", signal: new AbortController().signal });
    await first.done;
    const second = await startBudgetedImage({ client: images.client, spend, model: "gpt-image-2", prompt: "a calm harbour at dusk, watercolour", size: "1024x1536", quality: "medium", signal: new AbortController().signal });
    await assert.rejects(second.done);
    assert.equal(spend.calls[0].actualMicrousd, IMAGE_COST);
    assert.equal(spend.calls[1].actualMicrousd, null);
    assert.ok(images.log.calls.every(call => call.maxRetries === 0));
    const broke = spendFor(billing.hold(2)).spend;
    await assert.rejects(startBudgetedImage({ client: images.client, spend: broke, model: "gpt-image-2", prompt: "x".repeat(3000), size: "1024x1536", quality: "medium", signal: new AbortController().signal }), error => error.code === "RUN_BUDGET");
    assert.equal(images.log.calls.length, 2, "an unaffordable image never reaches the provider");
  });

  // ---- 4. Website runs end to end (route logic, mocked providers) --------
  await check("website run: full measured usage goes to settlement; the hold caps the charge; absorbed overspend recorded; overrun stops the run", async () => {
    const hold = billing.hold(20);
    const { spend } = spendFor(hold);
    // The provider reports more output than max_tokens allows (an overrun): cost far above the bound.
    const fake = fakeAnthropic([{ usage: { input_tokens: 5000, output_tokens: 50_000 }, content: [toolUse("write_file", { path: "src/App.tsx", content: app }), toolUse("finish", { summary: "Done.", title: "T" })] }]);
    const { response, db } = websiteRun(hold, spend, fake.client);
    const events = await sse(response);
    const measured = credits(5000 * 4 + 50_000 * 20);
    const settle = billing.outcomes.find(item => item.kind === "settle");
    assert.equal(settle.measured, measured, "settlement receives the full measured usage, not min(usage, budget)");
    assert.equal(settle.charged, 20); assert.equal(settle.absorbed, measured - 20);
    assert.equal(spend.stopped, "OVERRUN");
    assert.equal(events.at(-1).type, "done"); assert.equal(events.at(-1).charged, 20);
    assert.equal(db.saves.length, 1);
  });

  await check("website run: low balance stops before any provider call and charges nothing", async () => {
    const hold = billing.hold(2);
    const { spend } = spendFor(hold);
    const fake = fakeAnthropic([]);
    const { response, db } = websiteRun(hold, spend, fake.client);
    const events = await sse(response);
    assert.equal(fake.log.streams.length, 0);
    assert.equal(events.at(-1).code, "BUILD_INCOMPLETE");
    assert.equal(billing.outcomes[0].measured, 0); assert.equal(billing.outcomes[0].charged, 0);
    assert.equal(db.saves.length, 0);
  });

  await check("website run: interrupted mid-stream keeps finished files, charges only confirmed usage, provider cost includes the unknown remainder", async () => {
    const hold = billing.hold(50);
    const { spend } = spendFor(hold);
    const json = JSON.stringify({ path: "src/App.tsx", content: app });
    const fake = fakeAnthropic([{ started: true, partialOutput: 3000, error: midStreamError(), events: [
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu_1", name: "write_file", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: json } },
      { type: "content_block_stop", index: 0 }] }]);
    const { response, db } = websiteRun(hold, spend, fake.client);
    const events = await sse(response);
    assert.equal(db.saves.length, 1, "progress saved");
    const settle = billing.outcomes.find(item => item.kind === "settle");
    assert.equal(settle.measured, credits(5000 * 4 + 3000 * 20));
    assert.ok(settle.detail.uncertainMicrousd > 0 && settle.detail.providerMicrousd > 5000 * 4 + 3000 * 20);
    assert.equal(events.at(-1).type, "done");
  });

  const brokenApp = "export default function App() { return <main><h1>Updated</main>; }";
  await check("website run: finish compiles the site; build errors go back to the model and only the fixed version is saved", async () => {
    const hold = billing.hold(50);
    const { spend } = spendFor(hold);
    const fake = fakeAnthropic([
      { usage: { input_tokens: 5000, output_tokens: 900 }, content: [toolUse("write_file", { path: "src/App.tsx", content: brokenApp }), toolUse("finish", { summary: "Done.", title: "T" })] },
      { usage: { input_tokens: 6000, output_tokens: 900 }, content: [toolUse("write_file", { path: "src/App.tsx", content: app }), toolUse("finish", { summary: "Fixed.", title: "T" })] }]);
    const { response, db } = websiteRun(hold, spend, fake.client);
    const events = await sse(response);
    const refused = events.find(event => event.type === "tool_error" && event.tool === "finish");
    assert.ok(refused && /does not compile/.test(refused.message) && /src\/App\.tsx:1:/.test(refused.message), JSON.stringify(refused));
    const feedback = fake.log.streams[1].messages.flatMap(message => Array.isArray(message.content) ? message.content : []).find(block => block.type === "tool_result" && block.is_error);
    assert.match(feedback?.content ?? "", /does not compile[\s\S]*src\/App\.tsx/, "the build errors reach the model as finish problems");
    assert.equal(db.saves.length, 1);
    const saved = db.saves[0].args.p_content.websiteSource.files.find(file => file.path === "src/App.tsx").content;
    assert.equal(saved, app);
    assert.equal(events.at(-1).type, "done"); assert.equal(events.at(-1).finished, true);
    assert.equal(events.at(-1).build, "passed", "a compiled version is reported as a passed build");
  });

  await check("website run with the cached snapshot: system prompt and snapshot carry 5-minute markers ahead of everything per request; the context names only what changed since", async () => {
    const { snapshotText } = require("../builder/site-snapshot.ts");
    const hold = billing.hold(50);
    const { spend } = spendFor(hold);
    const files = baseFiles();
    // The snapshot is an earlier version: the saved site changed src/App.tsx since.
    const anchor = { number: 3, files: new Map([...files.files, ["src/App.tsx", "export default function App() { return <main><h1>Old</h1></main>; }"]]) };
    const fake = fakeAnthropic([{ usage: { input_tokens: 5000, output_tokens: 900 }, content: [toolUse("write_file", { path: "src/App.tsx", content: app }), toolUse("finish", { summary: "Done.", title: "T" })] }]);
    const { response, db } = websiteRun(hold, spend, fake.client, { files, snapshot: anchor });
    const events = await sse(response);
    assert.equal(events.at(-1).type, "done"); assert.equal(db.saves.length, 1);
    const [request] = fake.log.streams;
    assert.deepEqual(request.system.map(block => block.cache_control), [{ type: "ephemeral" }]);
    const [first, ...rest] = request.messages[0].content;
    assert.deepEqual(first, { type: "text", text: snapshotText(anchor), cache_control: { type: "ephemeral" } }, "the snapshot opens the request, with its own marker");
    const own = rest.at(-1).text;
    assert.match(own, /^<project\/>\n<changes_since_snapshot>\nThe project changed after the snapshot above \(v3\)\./);
    assert.ok(own.includes('<file path="src/App.tsx">\nexport default function App() { return <main><h1>Hello</h1></main>; }\n</file>'), "the current App.tsx, as saved");
    assert.ok(!own.includes('<file path="src/main.tsx">'), "unchanged files are read from the snapshot");
    assert.ok(own.indexOf("</changes_since_snapshot>") < own.indexOf("Image generation:") && own.indexOf("Image generation:") < own.indexOf("<request>"));
    assert.throws(() => prices.assertSupportedTextRequest({ model: "claude-opus-5-5", max_tokens: 10, messages: [{ role: "user", content: [{ type: "text", text: "x", cache_control: { type: "ephemeral", ttl: "1h" } }] }] }),
      /cache TTL other than 5 minutes/, "a message-block marker must be a 5-minute one too (bounds price writes at that rate)");
  });

  await check("website run: a 15-credit round (a design review's cap) continues past its cold first call on the cached prefix and settles with per-model tokens", async () => {
    const hold = billing.hold(15);
    const { spend, gate } = spendFor(hold, { providerCapCredits: 15 });
    const fake = fakeAnthropic([
      { usage: coldStep().usage, content: [toolUse("write_file", { path: "src/App.tsx", content: brokenApp }), toolUse("finish", { summary: "Done.", title: "T" })] },
      { usage: warmStep().usage, content: [toolUse("write_file", { path: "src/App.tsx", content: app }), toolUse("finish", { summary: "Fixed.", title: "T" })] }], { inputTokens: 30_000 });
    const { response, db } = websiteRun(hold, spend, fake.client);
    const events = await sse(response);
    assert.equal(fake.log.streams.length, 2, "the second call fits: the builder's history stays the cached prefix");
    assert.equal(gate.log.finish[1].detail.cachedTokens, CACHED); assert.equal(spend.calls[1].cacheMiss, false);
    assert.equal(events.at(-1).type, "done"); assert.equal(events.at(-1).finished, true);
    const settle = billing.outcomes.find(item => item.kind === "settle");
    assert.equal(settle.charged, credits(spend.confirmedMicrousd));
    assert.deepEqual(settle.detail.usage, spend.usageByModel());
    assert.equal(settle.detail.usage[OPUS].calls, 2); assert.equal(settle.detail.usage[OPUS].cacheRead, CACHED);
    assert.equal(db.saves.length, 1);
  });

  await check("website run: progress cut off before finish is not saved when it does not compile", async () => {
    const hold = billing.hold(50);
    const { spend } = spendFor(hold);
    const json = JSON.stringify({ path: "src/App.tsx", content: brokenApp });
    const fake = fakeAnthropic([{ started: true, partialOutput: 3000, error: midStreamError(), events: [
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu_1", name: "write_file", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: json } },
      { type: "content_block_stop", index: 0 }] }]);
    const { response, db } = websiteRun(hold, spend, fake.client);
    const events = await sse(response);
    assert.equal(db.saves.length, 0, "a version that does not build is never saved");
    assert.equal(events.at(-1).code, "BUILD_INCOMPLETE");
  });

  await check("website run: a compiler that times out or cannot start is never reported as a passed build; the work is kept as unverified", async () => {
    const { compileVerdict } = require("../builder/compile.ts");
    const { newRunMeter, meterEvent, runReceipt } = require("../builder/run-receipt.ts");
    const quiet = console.error; console.error = () => {};
    try {
      for (const reason of ["compile timed out", "Cannot find module 'esbuild-wasm'"]) {
        const down = files => compileVerdict(files, async () => ({ ok: null, ms: 20_000, reason }));
        // At finish.
        let hold = billing.hold(50), { spend } = spendFor(hold);
        let fake = fakeAnthropic([{ usage: { input_tokens: 5000, output_tokens: 900 }, content: [toolUse("write_file", { path: "src/App.tsx", content: app }), toolUse("finish", { summary: "Done.", title: "T" })] }]);
        let { response, db } = websiteRun(hold, spend, fake.client, { compile: down });
        let events = await sse(response);
        assert.equal(db.saves.length, 1, "the customer's work is preserved");
        assert.equal(events.at(-1).type, "done"); assert.equal(events.at(-1).build, "unverified", reason);
        assert.ok(events.some(event => event.type === "status" && /could not run/.test(event.message)), "the run says the build check could not run");
        const meter = newRunMeter(0); for (const event of events) meterEvent(meter, event);
        const checks = runReceipt(meter, { website: true, unlimited: false, now: 1000 }).checks;
        assert.ok(!checks.some(item => item.ok && /build/i.test(item.label)), JSON.stringify(checks));
        assert.ok(checks.some(item => !item.ok && /could not run/.test(item.label) && /not verified/.test(item.label)), JSON.stringify(checks));
        // Progress cut off before finish: kept, but unverified (a failed build would not be saved at all).
        hold = billing.hold(50); ({ spend } = spendFor(hold));
        fake = fakeAnthropic([{ started: true, partialOutput: 3000, error: midStreamError(), events: [
          { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu_1", name: "write_file", input: {} } },
          { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ path: "src/App.tsx", content: app }) } },
          { type: "content_block_stop", index: 0 }] }]);
        ({ response, db } = websiteRun(hold, spend, fake.client, { compile: down }));
        events = await sse(response);
        assert.equal(db.saves.length, 1); assert.equal(events.at(-1).finished, false); assert.equal(events.at(-1).build, "unverified");
      }
    } finally { console.error = quiet; }
  });

  await check("website run: images budgeted per call; a failed image costs its bound but is not charged", async () => {
    const hold = billing.hold(50);
    const { spend } = spendFor(hold);
    const images = fakeImages([{ usage: IMAGE_USAGE }, { error: Object.assign(new Error("server"), { status: 500 }) }]);
    const fake = fakeAnthropic([
      { usage: { input_tokens: 5000, output_tokens: 800 }, content: [toolUse("generate_image", { name: "hero-photo", prompt: "A sunlit bakery counter with fresh bread, warm tones", aspect: "landscape" }),
        toolUse("generate_image", { name: "team-photo", prompt: "Two bakers laughing in a flour-dusted kitchen, candid", aspect: "portrait" })] },
      { usage: { input_tokens: 6000, output_tokens: 900 }, content: [toolUse("write_file", { path: "src/App.tsx", content: app }), toolUse("finish", { summary: "Done.", title: "T" })] }]);
    const { response } = websiteRun(hold, spend, fake.client, { imageClient: images.client });
    const events = await sse(response);
    assert.equal(images.log.calls.length, 2);
    assert.ok(events.some(event => event.type === "image"));
    assert.ok(events.some(event => event.type === "tool_error" && /Image generation failed/.test(event.message)));
    const confirmed = 5000 * 4 + 800 * 20 + 6000 * 4 + 900 * 20 + IMAGE_COST;
    const settle = billing.outcomes.find(item => item.kind === "settle");
    assert.equal(settle.measured, credits(confirmed));
    assert.equal(spend.uncertainMicrousd, spend.calls.find(call => call.provider === "openai" && call.actualMicrousd === null).boundMicrousd);
  });

  await check("website run: a hold reclaimed before saving is never charged and the work is not saved against it", async () => {
    const hold = billing.hold(50);
    const { spend } = spendFor(hold);
    billing.active = () => false;
    const fake = fakeAnthropic([{ usage: { input_tokens: 5000, output_tokens: 900 }, content: [toolUse("write_file", { path: "src/App.tsx", content: app }), toolUse("finish", { summary: "Done.", title: "T" })] }]);
    const { response, db } = websiteRun(hold, spend, fake.client);
    const events = await sse(response);
    assert.equal(events.at(-1).code, "HOLD_EXPIRED");
    assert.equal(db.saves.length, 0);
    assert.deepEqual(billing.outcomes.map(item => [item.kind, item.reason, item.charged]), [["release", "hold_expired", 0]]);
  });

  await check("website run: no call starts after the hold's lifetime (interrupted or very late run)", async () => {
    const hold = billing.hold(50, { reservedAt: Date.now() - 14 * 60_000 });
    const { spend } = spendFor(hold); // deadline = reservedAt + 15 min - 90 s, already past
    const fake = fakeAnthropic([]);
    const { response } = websiteRun(hold, spend, fake.client);
    const events = await sse(response);
    assert.equal(fake.log.streams.length + fake.log.counts, 0);
    assert.equal(events.at(-1).code, "BUILD_INCOMPLETE");
  });

  await check("website run: admin exemption skips the credit charge but keeps the provider cap", async () => {
    const hold = billing.hold(0, { exempt: true });
    const { spend } = spendFor(hold, { providerCapCredits: 20 });
    const step = () => ({ usage: { input_tokens: 5000, output_tokens: 8000 }, content: [toolUse("write_file", { path: "src/App.tsx", content: app })] });
    const fake = fakeAnthropic([step(), step(), step(), step(), step()]);
    const { response } = websiteRun(hold, spend, fake.client);
    await sse(response);
    assert.ok(fake.log.streams.length < 5, "the provider cap ended the run");
    assert.ok(spend.providerMicrousd <= 20 * RATE * MICRO);
    const settle = billing.outcomes.find(item => item.kind === "settle");
    assert.equal(settle.outcome, "exempt"); assert.equal(settle.charged, 0);
  });

  await check("website run: a provider-spending limit fails the run cleanly with no charge", async () => {
    const hold = billing.hold(50);
    const limited = { async begin() { throw new SpendError("PROVIDER_LIMIT", "internal: global 999+1/1000"); }, async finish() {} };
    const { spend } = spendFor(hold, { gate: limited });
    const fake = fakeAnthropic([]);
    const { response, db } = websiteRun(hold, spend, fake.client);
    const events = await sse(response);
    assert.equal(fake.log.streams.length, 0);
    assert.equal(events.at(-1).code, "AI_DAILY_LIMIT"); assert.equal(events.at(-1).retryable, true);
    assert.match(events.at(-1).message, /Nothing was charged/); assert.doesNotMatch(events.at(-1).message, /[0-9]|global|internal/, "operator diagnostics stay private");
    assert.deepEqual(billing.outcomes.map(item => [item.kind, item.reason]), [["release", "build_failed"]]);
    assert.equal(db.saves.length, 0);
  });

  await check("settlement outcomes surface: missing and already-released holds are not silent successes", async () => {
    for (const [extra, mutate, expected] of [[{ missing: true }, () => {}, "missing_hold"], [{}, hold => { billing.holds.get(hold.reference).status = "released"; }, "released_hold"]]) {
      const hold = billing.hold(50, extra);
      const { spend } = spendFor(hold);
      const fake = fakeAnthropic([{ usage: { input_tokens: 5000, output_tokens: 900 }, content: [toolUse("write_file", { path: "src/App.tsx", content: app }), toolUse("finish", { summary: "Done.", title: "T" })] }]);
      billing.active = () => true;
      const original = billing.holdIsActive;
      billing.holdIsActive = async () => true; // the hold disappears between the check and the settle
      mutate(hold);
      const { response } = websiteRun(hold, spend, fake.client);
      const events = await sse(response);
      billing.holdIsActive = original;
      const settle = billing.outcomes.find(item => item.kind === "settle" && item.reference === hold.reference);
      assert.equal(settle.outcome, expected); assert.equal(settle.charged, 0);
      assert.equal(events.at(-1).charged, 0);
    }
  });

  await check("concurrent runs share platform limits: a daily gate admits only what fits", async () => {
    let reserved = 0, spent = 0; const limit = 700_000;
    const gate = { async begin(call) { await new Promise(resolve => setTimeout(resolve, 5)); if (spent + reserved + call.boundMicrousd > limit) throw new SpendError("PROVIDER_LIMIT", "Today's AI spending limit has been reached. Please try again later."); reserved += call.boundMicrousd; this.bounds.set(call.id, call.boundMicrousd); },
      async finish(id, outcome) { const bound = this.bounds.get(id); reserved -= bound; spent += outcome.actualMicrousd ?? bound; }, bounds: new Map() };
    const runs = [0, 1, 2].map(() => {
      const hold = billing.hold(50);
      const { spend } = spendFor(hold, { gate });
      const fake = fakeAnthropic([{ usage: { input_tokens: 5000, output_tokens: 900 }, content: [toolUse("write_file", { path: "src/App.tsx", content: app }), toolUse("finish", { summary: "Done.", title: "T" })] }], { delayMs: 100 });
      return { fake, ...websiteRun(hold, spend, fake.client) };
    });
    const results = await Promise.all(runs.map(run => sse(run.response)));
    const done = results.filter(events => events.at(-1).type === "done").length;
    assert.ok(done >= 1 && done < 3, `some runs admitted, some refused (${done} done)`);
    assert.ok(spent <= limit && reserved === 0);
    assert.equal(runs.reduce((total, run) => total + run.fake.log.streams.length, 0), done);
  });

  // ---- 5. Book/deck and plan runs ----------------------------------------
  await check("document run: settles full measured usage; failure releases with the measured usage recorded as absorbed", async () => {
    const hold = billing.hold(50);
    const { spend } = spendFor(hold);
    const fake = fakeAnthropic([{ usage: { input_tokens: 5000, output_tokens: 1200 }, content: [toolUse("write_chapter", { chapter: { id: "ch-1", title: "One", text: "It began at dawn." } }), toolUse("finish", { summary: "Wrote chapter one." })] }]);
    const db = fakeSupabase();
    const current = { assetIds: [], content: { title: "Book", sections: [] }, style: {} };
    const events = await sse(documentBuildResponse({ client: db.client, hold, spend, workspaceId: "22222222-2222-4222-8222-222222222222",
      artifact: { id: "33333333-3333-4333-8333-333333333333", project_id: "44444444-4444-4444-8444-444444444444", kind: "book", title: "Book", current_version: 1 },
      project: { brief: "", styleId: "" }, current, versions: [], message: "Write chapter one", effort: "medium", attachments: [], maxDuration: 300, anthropic: fake.client }));
    assert.equal(events.at(-1).type, "done", JSON.stringify(events.at(-1)));
    assert.equal(billing.outcomes[0].measured, credits(5000 * 4 + 1200 * 20));
    const failing = billing.hold(50);
    const second = spendFor(failing).spend;
    const broken = fakeAnthropic([{ started: true, partialOutput: 500, error: midStreamError() }]);
    const failed = await sse(documentBuildResponse({ client: db.client, hold: failing, spend: second, workspaceId: "22222222-2222-4222-8222-222222222222",
      artifact: { id: "33333333-3333-4333-8333-333333333333", project_id: "44444444-4444-4444-8444-444444444444", kind: "book", title: "Book", current_version: 1 },
      project: { brief: "", styleId: "" }, current, versions: [], message: "Write chapter one", effort: "medium", attachments: [], maxDuration: 300, anthropic: broken.client }));
    assert.equal(failed.at(-1).code, "BUILD_FAILED");
    const release = billing.outcomes.find(item => item.reference === failing.reference);
    assert.equal(release.kind, "release"); assert.equal(release.absorbed, credits(5000 * 4 + 500 * 20));
  });

  await check("plan run: no valid plan releases the hold and records the full measured usage as absorbed", async () => {
    const hold = billing.hold(30);
    const { spend } = spendFor(hold, { providerCapCredits: 30 });
    const fake = fakeAnthropic([{ usage: { input_tokens: 5000, output_tokens: 700 }, content: [{ type: "text", text: "Thinking." }], stop: "end_turn" }, { usage: { input_tokens: 5500, output_tokens: 600 }, content: [{ type: "text", text: "Still." }], stop: "end_turn" },
      { usage: { input_tokens: 6000, output_tokens: 500 }, content: [{ type: "text", text: "No plan." }], stop: "end_turn" }]);
    const events = await sse(planStreamResponse({ hold, spend, context: "<project/>\n<current_files>(empty)</current_files>", message: "Plan it", previousPlan: null, attachments: [], effort: "medium",
      basedOnVersion: 1, previousRevision: 0, persist: async () => true, maxDuration: 300, anthropic: fake.client }));
    assert.equal(events.at(-1).code, "PLAN_INCOMPLETE");
    const release = billing.outcomes[0];
    assert.equal(release.kind, "release"); assert.equal(release.absorbed, credits(5000 * 4 + 700 * 20 + 5500 * 4 + 600 * 20 + 6000 * 4 + 500 * 20));
  });


  // ---- 7. Review items: evidence, refused configurations, deadlines, stops --
  await check("pricing evidence: exact API IDs, sources, dates and every billable component; durable tariff agrees", async () => {
    for (const item of prices.PRICE_EVIDENCE) {
      assert.match(item.verifiedAt, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(item.idSource, /^https:\/\//); assert.ok(item.priceSources.length && item.priceSources.every(url => url.startsWith("https://")));
      assert.notEqual(item.model, item.label, "lookups use the API ID, not the display label");
    }
    for (const model of Object.keys(prices.TEXT_PRICES)) {
      const item = prices.PRICE_EVIDENCE.find(entry => entry.model === model);
      assert.deepEqual(Object.keys(item.components).sort(), ["cacheRead", "cacheWrite1h", "cacheWrite5m", "input", "output"]);
    }
    const image = prices.PRICE_EVIDENCE.find(entry => entry.model === "gpt-image-1");
    assert.deepEqual(Object.keys(image.components).sort(), ["imageCachedInput", "imageInput", "imageOutput", "textCachedInput", "textInput"]);
    assert.equal(Math.round(prices.IMAGE_PRICES["gpt-image-1"].outputTokens.medium["1024x1536"] * 40 / 1000) / 1000, 0.063, "matches the published per-image price");
    assert.throws(() => prices.textPrice("Claude Opus 5.5"), prices.UnpricedModelError, "a display label is not a model ID");
    const durable = fs.readFileSync(path.join(__dirname, "..", "generation", "qualification-proposal.ts"), "utf8");
    assert.match(durable, /provider: "anthropic", model: CLAUDE_QUALIFICATION_ROUND\.model/);
    assert.match(durable, /unit: "input_tokens", perUnits: "1000000", vendorMicrousd: "4000000"/);
    assert.match(durable, /unit: "output_tokens", perUnits: "1000000", vendorMicrousd: "20000000"/);
    assert.deepEqual([prices.TEXT_PRICES["claude-opus-5-5"].input, prices.TEXT_PRICES["claude-opus-5-5"].output], [4, 20]);
  });

  await check("unsupported configurations are refused before any provider contact", async () => {
    const base = { model: "claude-opus-5-5", max_tokens: 1000, messages: [], system: [], tools: [], thinking: { type: "adaptive" }, output_config: { effort: "medium" }, cache_control: { type: "ephemeral" }, betas: ["thinking-display-updates-2026-08-18"] };
    prices.assertSupportedTextRequest(base);
    for (const bad of [{ speed: "fast" }, { inference_geo: "us" }, { fallbacks: "default" }, { service_tier: "priority" }, { betas: ["server-side-fallback-2026-07-01"] },
      { tools: [{ type: "web_search_20260209", name: "web_search" }] }, { cache_control: { type: "ephemeral", ttl: "1h" } }, { output_config: { effort: "high", format: {} } }, { model: "claude-opus-latest" }]) {
      assert.throws(() => prices.assertSupportedTextRequest({ ...base, ...bad }), error => ["UNSUPPORTED_AI_CONFIG", "UNPRICED_MODEL"].includes(error.code), JSON.stringify(bad));
    }
    for (const bad of [{ quality: "high" }, { quality: "xhigh" }, { size: "1792x1024" }, { n: 2 }, { hasImageInput: true }, { model: "gpt-image-2.5-flare", size: "1024x1536", quality: "low" }, { model: "gpt-image-2.5-sunburst", quality: "high" }]) {
      assert.throws(() => prices.assertSupportedImageRequest({ model: "gpt-image-2", quality: "medium", size: "1024x1024", ...bad }), error => ["UNSUPPORTED_AI_CONFIG", "UNPRICED_MODEL"].includes(error.code), JSON.stringify(bad));
    }
    const { spend, gate } = spendFor(billing.hold(50));
    const fake = fakeAnthropic([okStep()]);
    await assert.rejects(budgetedStream({ client: fake.client, spend, meter: new ContextMeter(async () => 5000), models: ["claude-opus-5-5"], params: { messages: [], speed: "fast" },
      maxTokens: 8000, minTokens: 2048, signal: new AbortController().signal }), error => error.code === "UNSUPPORTED_AI_CONFIG");
    assert.equal(fake.log.streams.length, 0); assert.equal(gate.log.begin.length, 0);
  });

  await check("image configuration: opt-in key and model, no default, retired or unbounded models leave images off instead of failing runs", async () => {
    const { imageConfiguration } = require("../builder/images.ts");
    const saved = { key: process.env.OPENAI_API_KEY, model: process.env.MAKEBORNE_IMAGE_MODEL }, warn = console.warn, warnings = [];
    console.warn = message => warnings.push(message);
    try {
      delete process.env.OPENAI_API_KEY; process.env.MAKEBORNE_IMAGE_MODEL = "gpt-image-2";
      assert.equal(imageConfiguration().model, null, "no key: images off");
      process.env.OPENAI_API_KEY = "sk-offline-test-never-sent"; delete process.env.MAKEBORNE_IMAGE_MODEL;
      assert.deepEqual(imageConfiguration(), { model: null, models: [], issue: "MAKEBORNE_IMAGE_MODEL is not set" }, "no default model");
      // gpt-image-1 is never routed (shutdown 2026-10-23), even before its date.
      process.env.MAKEBORNE_IMAGE_MODEL = "gpt-image-1";
      assert.equal(imageConfiguration(Date.parse("2026-10-22T23:59:59Z")).model, null, "gpt-image-1 never routed");
      assert.equal(imageConfiguration(Date.parse("2026-10-23T00:00:00Z")).model, null, "retired model: images off");
      for (const model of [...prices.UNBOUNDED_IMAGE_MODELS, "gpt-image-9"]) { process.env.MAKEBORNE_IMAGE_MODEL = model; assert.equal(imageConfiguration().model, null, model); }
      assert.ok(warnings.length >= 3, "each unusable configured model is logged");
      process.env.MAKEBORNE_IMAGE_MODEL = " gpt-image-2 ";
      assert.deepEqual(imageConfiguration(), { model: "gpt-image-2", models: ["gpt-image-2"], issue: null });
      // The ordered allowlist wins over the single model and keeps its order; unusable entries are left out.
      process.env.MAKEBORNE_IMAGE_MODELS = "gpt-image-2.5-flare, gpt-image-1 ,gpt-image-2.5-sunburst,gpt-image-2,gpt-image-9";
      assert.deepEqual(imageConfiguration().models, ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-2"]);
      delete process.env.MAKEBORNE_IMAGE_MODELS;
      // A run with an unusable model proceeds without images: no image tool, no image call, the text step still settles.
      process.env.MAKEBORNE_IMAGE_MODEL = "gpt-image-9";
      const hold = billing.hold(50);
      const { spend } = spendFor(hold);
      const images = fakeImages([{ usage: IMAGE_USAGE }]);
      const fake = fakeAnthropic([{ usage: { input_tokens: 5000, output_tokens: 800 }, content: [toolUse("write_file", { path: "src/App.tsx", content: app }), toolUse("finish", { summary: "Done.", title: "T" })] }]);
      const events = await sse(websiteRun(hold, spend, fake.client, { imageClient: images.client }).response);
      assert.equal(images.log.calls.length, 0);
      assert.ok(!fake.log.streams[0].toolNames.includes("generate_image") && fake.log.streams[0].toolNames.includes("write_file"), "image tool not offered");
      assert.ok(JSON.stringify(fake.log.streams[0].messages).includes("Image generation: unavailable"));
      assert.ok(events.some(event => event.type === "done"), JSON.stringify(events.map(event => event.type)));
    } finally {
      console.warn = warn;
      for (const [name, value] of [["OPENAI_API_KEY", saved.key], ["MAKEBORNE_IMAGE_MODEL", saved.model]]) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    }
  });

  await check("image model replacement: gpt-image-2 bounded from published per-image prices; 2.5 models bounded by measured tokens x 1.5 (D8, 2026-10-21); gpt-image-1 refused from its retirement date", async () => {
    const two = prices.PRICE_EVIDENCE.find(item => item.model === "gpt-image-2");
    assert.ok(two && two.idSource.includes("gpt-image-2-2026-04-21"));
    assert.deepEqual([two.components.textInput, two.components.imageInput, two.components.imageOutput], [5, 8, 30]);
    // The bound covers the published per-image price (square medium $0.053, portrait/landscape $0.041) plus a full prompt.
    for (const [size, usd] of [["1024x1024", 0.053], ["1024x1536", 0.041], ["1536x1024", 0.041]]) {
      const bound = prices.imageCallBoundMicrousd("gpt-image-2", "medium", size, "x".repeat(3000));
      assert.ok(bound >= usd * 1e6 + 3000 * 5, `${size}: ${bound}`);
      assert.ok(bound <= ((usd + 0.0005) * 1e6 + 30) * 1.1 + (3064 * 5) * 1.1 + 1, `${size} bound stays tight: ${bound}`);
    }
    prices.assertSupportedImageRequest({ model: "gpt-image-2", quality: "medium", size: "1024x1536" });
    // D8 (owner, 2026-10-21): the 2.5 models are bounded by the measured counts of 2026-10-20 x 1.5; unmeasured cells stay refused.
    assert.deepEqual([...prices.UNBOUNDED_IMAGE_MODELS], []);
    assert.deepEqual(Object.keys(prices.MEASURED_IMAGE_OUTPUT_TOKENS).sort(), ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]);
    for (const model of ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
      assert.equal(prices.imageOutputTokenBound(model, "medium", "1024x1024"), Math.ceil(439 * 1.5));
      assert.equal(prices.imageOutputTokenBound(model, "low", "1536x1024"), Math.ceil(158 * 1.5));
      assert.throws(() => prices.imageOutputTokenBound(model, "low", "1024x1536"), prices.UnpricedModelError, "unmeasured cell refused");
      assert.ok(prices.MEASURED_IMAGE_OUTPUT_TOKENS[model].evidence.includes("image-research/20261020"));
    }
    for (const model of ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
      const item = prices.PRICE_EVIDENCE.find(entry => entry.model === model);
      assert.deepEqual([item.components.textInput, item.components.imageInput, item.components.imageOutput], [5, 8, 30]);
      assert.ok(item.idSource.includes("2026-09-08"));
    }
    assert.doesNotThrow(() => prices.imagePrice("gpt-image-1", Date.parse("2026-10-22T23:59:59Z")));
    assert.throws(() => prices.imagePrice("gpt-image-1", Date.parse("2026-10-23T00:00:00Z")), error => error.code === "UNSUPPORTED_AI_CONFIG" && /retired/.test(error.message));
    // Mocked end to end with the replacement model: usage-based cost, then the bound when usage is absent.
    const { spend } = spendFor(billing.hold(50));
    const images = fakeImages([{ usage: { input_tokens: 60, output_tokens: 1300, input_tokens_details: { text_tokens: 60, image_tokens: 0 } } }, { usage: null }]);
    await (await startBudgetedImage({ client: images.client, spend, model: "gpt-image-2", prompt: "A quiet harbour at dawn, watercolour", size: "1024x1536", quality: "medium", signal: new AbortController().signal })).done;
    await (await startBudgetedImage({ client: images.client, spend, model: "gpt-image-2", prompt: "A quiet harbour at dusk, watercolour", size: "1024x1536", quality: "medium", signal: new AbortController().signal })).done;
    assert.equal(spend.calls[0].actualMicrousd, 60 * 5 + 1300 * 30);
    assert.equal(spend.calls[1].actualMicrousd, null, "missing usage is recorded at the bound");
    assert.equal(images.log.calls[0].body.model, "gpt-image-2");
  });

  await check("a response from a different model than requested fails closed and is recorded at the bound", async () => {
    const { spend } = spendFor(billing.hold(50));
    const fake = fakeAnthropic([{ ...okStep(), model: "claude-sonnet-5-5" }]);
    await assert.rejects(streamCall(fake, spend), error => error.code === "UNSUPPORTED_AI_CONFIG");
    assert.equal(spend.uncertainMicrousd, spend.calls[0].boundMicrousd);
  });

  await check("hold deadline: every call gets a hard timeout within the run deadline; a call crossing it is stopped and recorded at its bound", async () => {
    const hold = billing.hold(50);
    const spend = new RunSpend({ run: hold.reference, providerCapMicrousd: 1_500_000, customerCapMicrousd: 1_500_000, gate: memoryGate(), deadline: Date.now() + 400, minCallMs: 50 });
    const fake = fakeAnthropic([{ slowMs: 5000, usage: { input_tokens: 5000, output_tokens: 900 } }]);
    const started = Date.now();
    await assert.rejects(streamCall(fake, spend), error => error.code === "HOLD_EXPIRED" && error.graceful);
    assert.ok(Date.now() - started < 2000, "stopped at the deadline, not after the provider's 5 s");
    assert.ok(fake.log.timeouts[0] <= 400, `timeout passed to the provider (${fake.log.timeouts[0]} ms) never exceeds the time left`);
    assert.equal(spend.calls[0].actualMicrousd, null); assert.equal(spend.uncertainMicrousd, spend.calls[0].boundMicrousd - spend.calls[0].partialMicrousd);
    await assert.rejects(spend.begin("anthropic", "claude-opus-5-5", 1), error => error.code === "HOLD_EXPIRED", "nothing starts after the deadline");
  });

  await check("hold deadline in a website run: work done before the deadline is not saved or charged once the hold is reclaimed", async () => {
    const hold = billing.hold(50);
    const spend = new RunSpend({ run: hold.reference, providerCapMicrousd: 1_500_000, customerCapMicrousd: 1_500_000, gate: memoryGate(), deadline: Date.now() + 1500, minCallMs: 50 });
    const fake = fakeAnthropic([{ usage: { input_tokens: 5000, output_tokens: 900 }, content: [toolUse("write_file", { path: "src/App.tsx", content: app })] }, { slowMs: 10_000 }]);
    billing.active = () => false; // the database reclaimed the hold meanwhile
    const { response, db } = websiteRun(hold, spend, fake.client, { stepGuardMs: 100 });
    const events = await sse(response);
    assert.equal(fake.log.streams.length, 2);
    assert.equal(events.at(-1).code, "HOLD_EXPIRED"); assert.equal(db.saves.length, 0);
    assert.deepEqual(billing.outcomes.map(item => [item.kind, item.reason, item.charged]), [["release", "hold_expired", 0]]);
  });

  await check("customer-facing stops: fixed retryable messages with no amounts or internal reasons", async () => {
    const { aiStop, AI_STOP_MESSAGES } = require("./failure.ts");
    assert.deepEqual(Object.keys(AI_STOP_MESSAGES).sort(), ["AI_DAILY_LIMIT", "AI_PAUSED", "AI_UNAVAILABLE"]);
    for (const message of Object.values(AI_STOP_MESSAGES)) { assert.match(message, /Nothing was charged/); assert.match(message, /try again/); assert.doesNotMatch(message, /[0-9]/); }
    assert.equal(aiStop(new SpendError("PROVIDER_DISABLED", "x")).code, "AI_PAUSED");
    assert.equal(aiStop(new SpendError("PROVIDER_LIMIT", "x")).code, "AI_DAILY_LIMIT");
    assert.equal(aiStop(new SpendError("SPEND_UNAVAILABLE", "x")).code, "AI_UNAVAILABLE");
    assert.equal(aiStop(new prices.UnpricedModelError("m")).code, "AI_UNAVAILABLE");
    assert.equal(aiStop(new Error("other")), null);
    const hold = billing.hold(50);
    const paused = { async begin() { throw new SpendError("PROVIDER_DISABLED", "internal: stopped by operator"); }, async finish() {} };
    const { spend } = spendFor(hold, { gate: paused });
    const events = await sse(websiteRun(hold, spend, fakeAnthropic([]).client).response);
    assert.deepEqual([events.at(-1).code, events.at(-1).retryable], ["AI_PAUSED", true]);
    assert.deepEqual(billing.outcomes.map(item => [item.kind, item.charged, item.measured]), [["release", 0, 0]], "work that never started is never charged");
  });

  // ---- 6. Every billable path reserves before contacting a provider ------
  await check("structure: every live provider path reserves first; no hidden retries or server-side fallback remain", async () => {
    const root = path.join(__dirname, "..", "..");
    const read = file => fs.readFileSync(path.join(root, file), "utf8");
    for (const [file, starts] of [["app/api/build/route.ts", ["documentBuildResponse(", "websiteBuildResponse("]], ["app/api/build/plan/route.ts", ["planStreamResponse("]]]) {
      const source = read(file);
      const reserve = source.indexOf("await beginOperation("), priced = source.indexOf("requirePricedModel("), spend = source.indexOf("createOperationSpend(");
      const capacity = source.indexOf("await requireProviderCapacity(");
      assert.ok(priced > 0 && capacity > priced && reserve > capacity && spend > reserve, `${file}: price check, capacity preflight, then hold, then spend`);
      assert.ok(source.indexOf('"OPERATION_REQUIRED"') < reserve, `${file}: every live request requires an operation envelope`);
      assert.doesNotMatch(source, /await reserveCredits\(/, `${file}: no independent child-run budget bypass`);
      for (const start of starts) assert.ok(source.indexOf(start) > spend, `${file}: ${start} only after the hold`);
    }
    const callers = { runBuilder: ["lib/builder/website-run.ts"], runDocumentBuilder: ["lib/builder/docs-run.ts"], runPlanner: ["lib/builder/plan-run.ts"],
      startBudgetedImage: ["lib/builder/agent.ts", "lib/builder/docs-agent.ts"] };
    const all = [];
    (function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (/\.(ts|tsx)$/.test(entry.name)) all.push(path.relative(root, full).split(path.sep).join("/")); } })(root);
    for (const [fn, allowed] of Object.entries(callers)) {
      const users = all.filter(file => new RegExp(`\\b${fn}\\(`).test(read(file)) && !new RegExp(`export (async )?function ${fn}\\(`).test(read(file)));
      assert.deepEqual(users.sort(), allowed.sort(), `${fn} is only called from the reserved run modules`);
    }
    for (const file of ["lib/builder/agent.ts", "lib/builder/docs-agent.ts", "lib/builder/planner.ts", "lib/builder/images.ts"]) {
      const source = read(file);
      assert.doesNotMatch(source, /fallbacks\s*:|server-side-fallback/, `${file}: no unbounded server-side fallback`);
      assert.doesNotMatch(source, /maxRetries:\s*[1-9]/, `${file}: no hidden SDK retries`);
      assert.doesNotMatch(source, /\.messages\.(stream|create)\(/, `${file}: provider calls go through budgetedStream`);
    }
    assert.doesNotMatch(read("lib/builder/images.ts"), /images\.generate\(/, "images go through startBudgetedImage");
    for (const file of ["lib/builder/website-run.ts", "lib/builder/docs-run.ts", "lib/builder/plan-run.ts"]) assert.doesNotMatch(read(file), /Math\.min\([^)]*credits/, `${file}: usage is never capped before settlement`);
  });

  assert.equal(MIN_STEP_TOKENS, 2048);
  console.log(`${passed} live spending checks passed (prices, caps, retries, fallback, partial failure, images, low balance, overrun, hold lifetime, exemption, limits, outcomes, concurrency, structure). Providers and billing are mocked.`);
})().catch(error => { console.error(error); process.exit(1); });
