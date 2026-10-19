/* eslint-disable -- Evidence script: reuses the check-live-spend.cjs preamble verbatim (unused helpers included) to reproduce one scenario. */
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
  if (/(^|\/)credits\/server$/.test(name) && !parent?.filename?.endsWith("compile-timeout-at-finish.cjs")) return billing;
  if (/(^|\/)billing\/database$/.test(name)) return { billingDatabase: () => { throw new Error("database not available offline"); } };
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);

const prices = require("../../../../src/lib/ai/prices.ts");
const { RunSpend, SpendError, memoryGate } = require("../../../../src/lib/ai/run-spend.ts");
const { budgetedStream, ContextMeter, builderModels } = require("../../../../src/lib/ai/anthropic-call.ts");
const { startBudgetedImage } = require("../../../../src/lib/ai/image-call.ts");
const { websiteBuildResponse } = require("../../../../src/lib/builder/website-run.ts");
const { documentBuildResponse } = require("../../../../src/lib/builder/docs-run.ts");
const { planStreamResponse } = require("../../../../src/lib/builder/plan-run.ts");
const { ProjectFiles } = require("../../../../src/lib/builder/files.ts");
const { MIN_STEP_TOKENS } = require("../../../../src/lib/builder/agent.ts");
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
      log.streams.push({ model: params.model, max_tokens: params.max_tokens, maxRetries: requestOptions.maxRetries, fallbacks: params.fallbacks, betas: params.betas, toolNames: (params.tools ?? []).map(tool => tool.name), messages: params.messages });
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
    request: "Update the heading", context: "<project/>", attachments: [], maxDuration: 300, anthropic, imageClient: extra.imageClient, storeImage, stepGuardMs: extra.stepGuardMs, compile: extra.compile });
  return { db, response };
}


const compileApi = require("../../../../src/lib/builder/compile.ts");
const { newRunMeter, meterEvent, runReceipt } = require("../../../../src/lib/builder/run-receipt.ts");
(async () => {
  const hold = billing.hold(50);
  const { spend } = spendFor(hold);
  // Fault injection: the compiler engine times out (infrastructure), not a project error.
  const engineTimedOut = async () => ({ ok: null, ms: 20000, reason: "compile timed out" });
  // Same fault on either API: before the repair compileProblems, after it compileVerdict.
  const timedOut = files => (compileApi.compileVerdict ?? compileApi.compileProblems)(files, engineTimedOut);
  const fake = fakeAnthropic([{ usage: { input_tokens: 5000, output_tokens: 900 }, content: [toolUse("write_file", { path: "src/App.tsx", content: app }), toolUse("finish", { summary: "Done.", title: "T" })] }]);
  const { response, db } = websiteRun(hold, spend, fake.client, { compile: timedOut });
  const events = await sse(response);
  const meter = newRunMeter(0); for (const event of events) meterEvent(meter, event);
  const receipt = runReceipt(meter, { website: true, unlimited: false, now: 1000 });
  const done = events.at(-1);
  console.log(JSON.stringify({ scenario: "compiler timed out at finish", api: compileApi.compileVerdict ? "compileVerdict" : "compileProblems", saves: db.saves.length, terminal: { type: done.type, finished: done.finished, build: done.build ?? null, changed: done.changed },
    statusMessages: events.filter(e => e.type === "status").map(e => e.message), receiptChecks: receipt.checks }, null, 2));
})().catch(error => { console.error(error); process.exit(1); });
