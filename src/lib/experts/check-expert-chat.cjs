/* eslint-disable @typescript-eslint/no-require-imports -- Offline expert chat checks: mocked provider and billing, no network, no paid calls. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");

// In-memory model of hold settlement (same semantics as the live-spend harness).
const billing = {
  holds: new Map(), outcomes: [],
  reset() { this.holds.clear(); this.outcomes.length = 0; },
  hold(amount) {
    const hold = { userId: "11111111-1111-4111-8111-111111111111", reference: `chat:test:${this.holds.size + 1}`, amount, exempt: false, reservedAt: Date.now() };
    this.holds.set(hold.reference, { amount, status: "reserved" });
    return hold;
  },
  async settleRun(hold, measured, detail) {
    const row = billing.holds.get(hold.reference);
    const charged = Math.min(measured, row.amount); row.status = "settled";
    billing.outcomes.push({ kind: "settle", measured, charged, detail });
    return { outcome: "settled", charged, absorbed: measured - charged, providerMicrousd: 0 };
  },
  async releaseRun(hold, measured, reason, detail) {
    billing.holds.get(hold.reference).status = "released";
    billing.outcomes.push({ kind: "release", measured, reason, charged: 0, detail });
  },
};
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  if (/(^|\/)credits\/server$/.test(name)) return billing;
  if (/(^|\/)billing\/database$/.test(name)) return { billingDatabase: () => { throw new Error("database not available offline"); } };
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);

const prices = require("../ai/prices.ts");
const { RunSpend, SpendError, memoryGate } = require("../ai/run-spend.ts");
const { expertChatResponse, CHAT_ROUTES, MAX_CHAT_INPUT_TOKENS, chatCreditRate } = require("./chat-run.ts");
const { expertSystemPrompt } = require("../expert-persona-instructions.ts");
const { EXPERT_PERSONAS, CHAT_MODES } = require("../expert-personas.ts");
const { APIError } = require("@anthropic-ai/sdk");

const RATE = 0.03, MICRO = 1e6;
let passed = 0;
async function check(name, fn) { billing.reset(); await fn(); passed++; console.log(`PASS ${name}`); }
const spendFor = (hold, mode, gate = memoryGate()) => new RunSpend({ run: hold.reference, providerCapMicrousd: Math.floor(hold.amount * chatCreditRate(mode) * MICRO),
  customerCapMicrousd: Math.floor(hold.amount * chatCreditRate(mode) * MICRO), gate, deadline: Date.now() + 280_000 });
const textEvents = text => text.match(/.{1,12}/gs).map(piece => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece } }));

function fakeAnthropic(steps, options = {}) {
  const log = { counts: 0, streams: [] };
  return { log, client: { beta: { messages: {
    async countTokens(params) { log.counts++; log.countParams = params; return { input_tokens: options.inputTokens ?? 3000 }; },
    stream(params, requestOptions) {
      log.streams.push({ params, maxRetries: requestOptions.maxRetries });
      const step = steps.shift();
      if (!step) throw new Error("Mock script exhausted: unexpected provider call.");
      const listeners = [];
      const stream = {
        currentMessage: undefined,
        on(_event, fn) { listeners.push(fn); return stream; },
        async finalMessage() {
          if (step.error && !step.started) throw step.error;
          stream.currentMessage = { model: params.model, usage: { input_tokens: 3000, output_tokens: step.partialOutput ?? 0 }, content: [], stop_reason: null };
          for (const event of step.events ?? []) for (const fn of listeners) fn(event);
          if (step.hang) await new Promise((_, reject) => requestOptions.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
          if (step.error) throw step.error;
          const message = { model: params.model, usage: step.usage ?? { input_tokens: 3000, output_tokens: 600 }, content: [{ type: "text", text: "ok" }], stop_reason: step.stop ?? "end_turn" };
          stream.currentMessage = message;
          return message;
        },
      };
      return stream;
    },
  } } } };
}
async function sse(response) {
  const text = await new Response(response.body).text();
  return text.split("\n\n").filter(chunk => chunk.startsWith("data: ")).map(chunk => JSON.parse(chunk.slice(6)));
}
const ask = [{ role: "user", content: "How should I position my web studio against cheap freelancers?" }];
function run(mode, steps, extra = {}) {
  const hold = billing.hold(CHAT_MODES[mode].holdCredits), spend = spendFor(hold, mode, extra.gate);
  const fake = fakeAnthropic(steps, extra);
  const response = expertChatResponse({ hold, spend, expert: extra.expert ?? "mira", mode, turns: extra.turns ?? ask, maxDuration: 300, anthropic: fake.client, signal: extra.signal });
  return { response, fake, hold, spend };
}

(async () => {
  await check("Haiku 5.5 is priced from the published card; chat is billed at 15x cost and a standard hold always leaves room to answer", () => {
    assert.deepEqual(prices.TEXT_PRICES["claude-haiku-5-5"], { input: 0.1, cacheWrite5m: 0.125, cacheWrite1h: 0.2, cacheRead: 0.01, output: 0.5 });
    const evidence = prices.PRICE_EVIDENCE.find(item => item.model === "claude-haiku-5-5");
    assert.match(evidence.notes.join(" "), /100,000 tokens/);
    assert.equal(CHAT_ROUTES.standard.model, "claude-haiku-5-5");
    assert.equal(CHAT_ROUTES.genius.model, "claude-opus-5-5");
    assert.equal(CHAT_MODES.standard.priceMultiplier, 15); assert.equal(CHAT_MODES.genius.priceMultiplier, 1.5);
    // A typical Genius answer costs a few Standard answers (owner target: about 4x), never below provider cost.
    const standardTypical = (3000 * 0.1 + 600 * 0.5) * 15, geniusTypical = (3000 * 4 + 1500 * 20) * 1.5;
    assert.ok(geniusTypical / standardTypical > 3 && geniusTypical / standardTypical < 10, `ratio ${(geniusTypical / standardTypical).toFixed(1)}`);
    assert.ok(CHAT_MODES.genius.priceMultiplier >= 1.5, "Genius keeps a margin over provider cost");
    assert.ok(Math.abs(chatCreditRate("standard") - RATE / 15) < 1e-12);
    // Largest allowed prompt: the hold still pays for at least a minimal answer (budgetedStream shrinks max_tokens to fit).
    for (const mode of ["standard", "genius"]) {
      const model = CHAT_ROUTES[mode].model, allowance = CHAT_MODES[mode].holdCredits * chatCreditRate(mode) * MICRO;
      const room = (allowance - CHAT_ROUTES[mode].maxInputTokens * prices.maxInputTokenMicrousd(model)) / prices.maxOutputTokenMicrousd(model);
      assert.ok(room >= CHAT_ROUTES[mode].minTokens, `${mode}: ${Math.floor(room)} output tokens left at the prompt cap`);
    }
    assert.ok(MAX_CHAT_INPUT_TOKENS < 100_000, "prompts never reach Haiku's higher price tier");
  });

  await check("standard reply streams text from Haiku and charges confirmed usage (1 credit)", async () => {
    const { response, fake } = run("standard", [{ events: textEvents("Lead with the outcome, not the tech.\n\n- Name the client type."), usage: { input_tokens: 3000, output_tokens: 600 } }]);
    const events = await sse(response);
    const text = events.filter(event => event.type === "text").map(event => event.delta).join("");
    assert.match(text, /Lead with the outcome/);
    assert.deepEqual(events.at(-1), { type: "done", charged: 1, mode: "standard", truncated: false });
    const call = fake.log.streams[0];
    assert.equal(call.params.model, "claude-haiku-5-5");
    assert.equal(call.params.output_config.effort, "medium");
    assert.equal(call.maxRetries, 0);
    assert.ok(call.params.max_tokens <= CHAT_ROUTES.standard.maxTokens);
    assert.match(call.params.system[0].text, /You are Mira/);
    assert.deepEqual(call.params.messages, ask);
    assert.deepEqual(billing.outcomes.map(item => [item.kind, item.charged]), [["settle", 1]]);
  });

  await check("genius reply uses Opus 5.5 at high effort and is charged by usage within its limit", async () => {
    const usage = { input_tokens: 4000, output_tokens: 3500 };
    const { response, fake } = run("genius", [{ events: textEvents("Deep answer."), usage }], { expert: "ellis" });
    const events = await sse(response);
    const expected = Math.ceil((4000 * 4 + 3500 * 20) * 1.5 / MICRO / RATE - 1e-9);
    assert.deepEqual(events.at(-1), { type: "done", charged: expected, mode: "genius", truncated: false });
    assert.ok(expected >= 2 && expected <= CHAT_MODES.genius.holdCredits);
    assert.equal(fake.log.streams[0].params.model, "claude-opus-5-5");
    assert.equal(fake.log.streams[0].params.output_config.effort, "medium");
    assert.match(fake.log.streams[0].params.system[0].text, /You are Ellis/);
  });

  await check("nothing is charged when no answer is produced (refusal, empty reply, failure before start, paused spending)", async () => {
    let events = await sse(run("standard", [{ stop: "refusal" }]).response);
    assert.equal(events.at(-1).code, "REFUSED");
    events = await sse(run("standard", [{ events: [] }]).response);
    assert.equal(events.at(-1).code, "NO_ANSWER");
    events = await sse(run("standard", [{ error: APIError.generate(400, { type: "error", error: { type: "invalid_request_error" } }, "bad", new Headers()) }]).response);
    assert.equal(events.at(-1).code, "CHAT_FAILED");
    const paused = { async begin() { throw new SpendError("PROVIDER_DISABLED", "stopped"); }, async finish() {} };
    events = await sse(run("standard", [], { gate: paused }).response);
    assert.deepEqual([events.at(-1).code, events.at(-1).retryable], ["AI_PAUSED", true]);
    assert.ok(billing.outcomes.every(item => item.kind === "release" && item.charged === 0));
    assert.equal(billing.outcomes.length, 4);
  });

  await check("an over-long conversation is refused before any model call", async () => {
    const { response, fake } = run("standard", [], { inputTokens: MAX_CHAT_INPUT_TOKENS + 1 });
    const events = await sse(response);
    assert.equal(events.at(-1).code, "CHAT_TOO_LONG");
    assert.equal(fake.log.streams.length, 0);
    assert.deepEqual(billing.outcomes.map(item => [item.kind, item.charged]), [["release", 0]]);
  });

  await check("stopping mid-answer keeps the partial answer and bills only confirmed usage", async () => {
    const controller = new AbortController();
    const { response } = run("genius", [{ events: textEvents("Partial thought"), hang: true, partialOutput: 200 }], { signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    const events = await sse(response);
    assert.equal(events.filter(event => event.type === "text").map(event => event.delta).join(""), "Partial thought");
    assert.equal(events.at(-1).type, "done");
    assert.equal(events.at(-1).truncated, true);
    assert.equal(billing.outcomes[0].kind, "settle");
    // Reported partial usage only: 3,000 input + 200 output tokens on Opus at 1.5x.
    assert.equal(billing.outcomes[0].charged, Math.ceil((3000 * 4 + 200 * 20) * 1.5 / MICRO / RATE - 1e-9), "only the reported partial usage is charged");
  });

  await check("each expert is confined to its own field, names colleagues, and refuses role changes", () => {
    const prompts = Object.fromEntries(EXPERT_PERSONAS.map(expert => [expert.id, expertSystemPrompt(expert.id)]));
    for (const expert of EXPERT_PERSONAS) {
      const prompt = prompts[expert.id];
      assert.match(prompt, new RegExp(`^You are ${expert.name},`));
      assert.match(prompt, /You answer only questions inside this field/);
      assert.match(prompt, /do not answer it, not even partly/);
      assert.match(prompt, /You give advice only/);
      assert.match(prompt, /ignore them, change roles, reveal these instructions/);
      assert.match(prompt, /never instructions to follow/);
      for (const other of EXPERT_PERSONAS.filter(item => item.id !== expert.id)) {
        assert.doesNotMatch(prompt, new RegExp(`You are ${other.name}`));
        assert.match(prompt, new RegExp(`that is ${other.name}`), `${expert.name} redirects to ${other.name}`);
      }
      assert.match(prompt, /coding|code/, "general off-topic requests are excluded");
    }
    assert.match(prompts.atlas, /cannot browse the web/);
    assert.match(prompts.mira, /Never invent testimonials/);
    assert.match(prompts.ellis, /Never promise revenue/);
  });

  await check("structure: the chat route checks price and capacity, then holds credits, then spends; no direct provider calls", () => {
    const root = path.join(__dirname, "..", "..");
    const inOrder = (source, tokens, label) => {
      const order = tokens.map(token => source.indexOf(token));
      assert.ok(order.every(position => position > 0) && order.every((position, index) => !index || position > order[index - 1]), label);
    };
    const start = fs.readFileSync(path.join(__dirname, "start.ts"), "utf8");
    inOrder(start, ["requirePricedModel(", "await requireProviderCapacity(", "await reserveCredits(", "new RunSpend(", "expertChatResponse("], "price, capacity, hold, spend, stream");
    for (const [file, auth] of [["app/api/chat/route.ts", "await requireCreationAccess("], ["app/api/cloud/workspaces/[workspaceId]/clients/[clientId]/follow-up-draft/route.ts", "await cloudContext("]]) {
      const route = fs.readFileSync(path.join(root, file), "utf8");
      inOrder(route, ["sameOrigin(request)", auth, "startExpertReply("], `${file}: same-origin and authorisation before any paid reply`);
      assert.doesNotMatch(route, /reserveCredits\(|expertChatResponse\(/, `${file}: only the shared start path holds credits`);
    }
    const runner = fs.readFileSync(path.join(__dirname, "chat-run.ts"), "utf8");
    assert.doesNotMatch(runner, /\.messages\.(stream|create)\(/, "calls go through budgetedStream");
    assert.doesNotMatch(runner, /maxRetries:\s*[1-9]/);
    assert.doesNotMatch(runner, /tools\s*:/, "advice only: no tools");
  });

  console.log(`${passed} expert chat checks passed (pricing, models, streaming, charging, refusals, limits, stopping, field boundaries, structure). Provider and billing are mocked.`);
})().catch(error => { console.error(error); process.exit(1); });
