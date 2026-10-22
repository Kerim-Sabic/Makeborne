/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for model routing: classifier rules, configuration, escalation bounds,
 * the credit maximum and receipt fields. The website path runs the real builder loop, budgeted calls, RunSpend and durable settlement
 * against a fake provider and a mocked operation database. No network, no paid calls. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict"), Module = require("node:module");
const ids = Array.from({ length: 8 }, (_, i) => `${i + 1}`.repeat(8) + `-${String(i + 1).repeat(4)}-4${String(i + 1).repeat(3)}-8${String(i + 1).repeat(3)}-${String(i + 1).repeat(12)}`);
const [actor, workspaceId, artifactId, actionKey, stepKey, operationId, runId, fence] = ids;
let rpcCalls = [], documentAgent, planner;
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  if (name.startsWith("@/")) return load.call(this, path.resolve(__dirname, "..", "..", name.slice(2)), parent, main);
  if (/(^|\/)billing\/database$/.test(name)) return { billingDatabase: () => ({ rpc: (rpcName, args) => { rpcCalls.push({ name: rpcName, args }); const result = Promise.resolve(rpc(rpcName, args)); result.abortSignal = () => result; return result; } }) };
  if (/(^|\/)credits\/server$/.test(name)) return { HOLD_LIFETIME_MS: 900000, settleRun() { throw Error("Legacy settlement bypass"); }, releaseRun() { throw Error("Legacy release bypass"); }, holdIsActive() { throw Error("Legacy hold bypass"); } };
  if (name === "./images" && /builder[\\/]agent\.ts$/.test(parent?.filename ?? "")) return { imageConfiguration: () => ({ model: null, models: [] }), IMAGE_SIZES: { portrait: "1024x1536" }, openaiImageClient: () => null, storeGeneratedImage: async () => null };
  if (name === "./docs-agent" && parent.filename.endsWith("docs-run.ts")) return { runDocumentBuilder: input => documentAgent(input) };
  if (name === "./planner" && parent.filename.endsWith("plan-run.ts")) return { runPlanner: input => planner(input) };
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
for (const key of ["MAKEBORNE_MODEL_ROUTING", "MAKEBORNE_BUILDER_MODEL", "MAKEBORNE_BUILDER_FALLBACK_MODELS", "MAKEBORNE_IMAGE_MODEL", "MAKEBORNE_IMAGE_MODELS", "OPENAI_API_KEY"]) delete process.env[key];
process.env.MAKEBORNE_AI_COST_USD_PER_CREDIT = "0.03";
console.error = () => undefined; console.info = (...args) => { logs.push(args.join(" ")); };
const logs = [];

const routing = require("./model-routing.ts");
const { RunSpend, SpendError, memoryGate } = require("./run-spend.ts");
const { textUsageMicrousd } = require("./prices.ts");
const api = require("../builder/operation-server.ts");
const { websiteBuildResponse } = require("../builder/website-run.ts"), { documentBuildResponse } = require("../builder/docs-run.ts"), { planStreamResponse } = require("../builder/plan-run.ts");
const { ProjectFiles } = require("../builder/files.ts");
const { newRunMeter, meterEvent, runReceipt } = require("../builder/run-receipt.ts");
const { BUILDER_EFFORT } = require("../builder/pricing.ts");

const OPUS = "claude-opus-5-5", SONNET = "claude-sonnet-5-5";
const RATE = 30000; // micro-USD per credit
const snapshot = (extra = {}) => ({ id: operationId, revision: 2, kind: "build", effort: "light", authorizedCredits: 20, chargedCredits: 0, reservedCredits: 20, remainingCredits: 0, maximumAdditionalCredits: 50, status: "running", pendingKind: null, lastVersion: 1, canContinue: false, recoverable: false, expiresAt: new Date(Date.now() + 86400000).toISOString(), rateMicrousd: RATE, providerRemainingMicrousd: 20 * RATE, ...extra });
const status = (result = null, extra = {}) => ({ operation: snapshot(), result, recovery: null, ...extra });
let providerBegin = () => ({ data: { started: true }, error: null });
function rpc(name, args) {
  if (name === "makeborne_ai_operation_begin") return { data: { ...status(), requestContext: { message: "Edit" }, replayed: false, run: { id: runId, reference: `operation:${runId}`, fence, amount: 20, exempt: false, reservedAt: Date.now(), expiresAt: Date.now() + 900000 } }, error: null };
  if (name === "makeborne_ai_operation_create") return { data: snapshot(), error: null };
  if (name === "makeborne_ai_operation_read") return { data: status(), error: null };
  if (name === "makeborne_ai_operation_provider_begin") return providerBegin(args);
  if (name === "makeborne_provider_call_finish") return { data: {}, error: null };
  if (name === "makeborne_ai_operation_finish") {
    // Like SQL: the charge is the measured amount, capped at the run's allocated credits.
    const billable = Math.min(args.p_measured_microusd, 20 * RATE), charged = args.p_outcome === "failed" ? 0 : Math.ceil(billable / RATE);
    const result = { ...args.p_detail, runId, charged, ...(args.p_outcome === "saved" ? { version: 2 } : {}), ...(args.p_outcome === "plan" ? { stored: { ...args.p_candidate.stored, charged }, persisted: true } : {}) };
    return { data: { ...status(result), charged, outcome: args.p_outcome }, error: null };
  }
  throw Error(`Unexpected RPC ${name}`);
}
const finishCall = () => rpcCalls.findLast(call => call.name === "makeborne_ai_operation_finish");
const events = async response => (await response.text()).split("\n\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
let passed = 0;
async function check(name, fn) { rpcCalls = []; logs.length = 0; providerBegin = () => ({ data: { started: true }, error: null }); await fn(); passed++; process.stdout.write(`PASS ${name}\n`); }

/** A scripted provider: `script(model, messages)` returns the next assistant message for that model. Records every call's model. */
const USAGE = { input_tokens: 20000, output_tokens: 4000 };
function provider(script) {
  const seen = [];
  return { seen, beta: { messages: {
    stream(params) { seen.push(params.model); const reply = script(params.model, params.messages); return { on() {}, currentMessage: undefined, finalMessage: async () => ({ model: params.model, usage: USAGE, stop_reason: reply.stop ?? "tool_use", content: reply.content }) }; },
    async countTokens() { return { input_tokens: 20000 }; },
  } } };
}
const tool = (name, input, id = `${name}-${Math.random().toString(36).slice(2, 8)}`) => ({ type: "tool_use", id, name, input });
const lastUserText = messages => JSON.stringify(messages.at(-1)?.content ?? "");
/** A model that edits App.tsx to `content` and calls finish (again when a gate blocks once). */
const editor = content => (model, messages) => /Not finished yet/.test(lastUserText(messages)) && !content.includes("BROKEN")
  ? { content: [tool("finish", { summary: "Changed the heading.", title: "Example" })] }
  : { content: [tool("write_file", { path: "src/App.tsx", content }), tool("finish", { summary: "Changed the heading.", title: "Example" })] };
const GOOD = 'export default function App() { return <main><h1>Fresh bread daily</h1><p>Open from seven.</p></main>; }';
const BROKEN = 'export default function App() { return <main>BROKEN';
const compile = async files => /BROKEN/.test(files.get("src/App.tsx") ?? "") ? { status: "failed", problems: ["src/App.tsx does not compile."] } : { status: "passed" };
function project() {
  const source = new ProjectFiles();
  source.write("index.html", '<!doctype html><html><head><title>T</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>');
  source.write("src/main.tsx", 'import { createRoot } from "react-dom/client"; import App from "./App"; import "./styles.css"; createRoot(document.getElementById("root")!).render(<App />);');
  source.write("src/App.tsx", 'export default function App() { return <main><h1>Hello</h1><p>Welcome.</p></main>; }');
  source.write("src/styles.css", "body{margin:0}");
  return new ProjectFiles(source.toSource());
}
async function websiteStage({ route, anthropic, message = "Make the heading say Fresh bread daily", effort = "light" }) {
  const run = (await api.beginOperation({ actor, workspaceId, artifactId, expectedVersion: 1, effort, kind: "build", ceiling: 20, request: { message }, envelope: { actionKey, stepKey } })).run;
  const spend = api.createOperationSpend(run, Date.now() + 280000);
  const files = project();
  const stream = await events(websiteBuildResponse({ client: { rpc() { throw Error("Nonatomic save bypass"); } }, hold: run.hold, operation: run, spend, workspaceId,
    artifact: { id: artifactId, project_id: actionKey, title: "Example", current_version: 1 }, current: { number: 1, assetIds: [], content: { title: "Example", sections: [] }, style: {} },
    files, reviewing: false, message, effort, request: message, context: "Context", attachments: [], maxDuration: 300, anthropic, compile, stepGuardMs: 0, ...(route ? { route } : {}) }));
  return { stream, spend, files, finish: finishCall() };
}
const routedEnv = { MAKEBORNE_MODEL_ROUTING: "on", MAKEBORNE_ROUTE_TARGETED_EDIT: SONNET };

(async () => {
  await check("classifier: fixed rules from stage, project size, plan, wording, effort, attachments and the visual-edit target", () => {
    const c = input => routing.classifyStage({ effort: "medium", ...input }).class;
    assert.equal(c({ stage: "build", files: 0, request: "Change the colour" }), "new-site", "an empty project is always a new site");
    assert.equal(c({ stage: "build", files: 9, request: "Change the colour", plan: true }), "redesign");
    for (const wording of ["Redesign the whole site", "Rebuild it from scratch", "Give it a new look", "Add two new pages for services", "Completely change the layout", "Restyle every section"]) assert.equal(c({ stage: "build", files: 9, request: wording }), "redesign", wording);
    assert.equal(c({ stage: "build", files: 9, request: "Make the heading bigger" }), "targeted-edit");
    assert.equal(c({ stage: "build", files: 9, request: `Change the <h1> "Hello" in src/App.tsx (line 4): bigger. ${"Context. ".repeat(80)}` }), "targeted-edit", "a picked element allows a longer targeted request");
    assert.equal(c({ stage: "build", files: 9, request: "x".repeat(routing.TARGETED_CHARS + 1) }), "edit");
    assert.equal(c({ stage: "build", files: 9, request: "Make the heading bigger", attachments: 1 }), "edit", "attachments are never a targeted edit");
    assert.equal(c({ stage: "build", files: 9, request: "Make the heading bigger", effort: "ultra" }), "edit", "deep effort is never routed as a targeted edit");
    assert.equal(c({ stage: "build", files: 9, request: "Make the heading bigger", effort: "super_high" }), "edit");
    assert.equal(c({ stage: "review" }), "review"); assert.equal(c({ stage: "plan" }), "plan"); assert.equal(c({ stage: "continuation", files: 9, request: "Make it bigger" }), "continuation");
    assert.equal(c({ stage: "document", emptyDocument: true }), "document-new"); assert.equal(c({ stage: "document", emptyDocument: false }), "document-edit");
    const reason = routing.classifyStage({ stage: "build", files: 3, effort: "medium", request: "Make the secret heading bigger" }).reason;
    assert.doesNotMatch(reason, /secret/, "reasons never carry request text");
  });

  await check("configuration: off is today's builder model for every class; on uses overrides or qualified defaults; bad values fall back", () => {
    const all = env => routing.TASK_CLASSES.map(taskClass => ({ taskClass, ...routing.routeStage(sample(taskClass), env) }));
    const samples = { "new-site": { stage: "build", files: 0 }, redesign: { stage: "build", files: 2, plan: true }, edit: { stage: "build", files: 2, request: "y".repeat(900) }, "targeted-edit": { stage: "build", files: 2, request: "Bigger" },
      continuation: { stage: "continuation" }, review: { stage: "review" }, plan: { stage: "plan" }, "document-new": { stage: "document", emptyDocument: true }, "document-edit": { stage: "document" } };
    const sample = taskClass => ({ effort: "medium", ...samples[taskClass] });
    for (const route of all({})) { assert.equal(route.class, route.taskClass); assert.equal(route.model, OPUS); assert.equal(route.escalation, null); assert.equal(route.routing, "off"); }
    for (const route of all({ MAKEBORNE_MODEL_ROUTING: "off", MAKEBORNE_ROUTE_TARGETED_EDIT: SONNET })) assert.equal(route.model, OPUS, "overrides do nothing while routing is off");
    for (const route of all({ MAKEBORNE_BUILDER_MODEL: SONNET })) assert.equal(route.model, SONNET, "MAKEBORNE_BUILDER_MODEL keeps its meaning when routing is off");
    for (const route of all({ MAKEBORNE_MODEL_ROUTING: "maybe", MAKEBORNE_ROUTE_TARGETED_EDIT: SONNET })) assert.equal(route.routing, "off", "an unknown switch value is off");
    const on = all(routedEnv);
    for (const route of on) {
      const expected = route.taskClass === "targeted-edit" ? SONNET : routing.QUALIFIED_ROUTES[route.taskClass] ?? OPUS;
      assert.equal(route.model, expected, route.taskClass); assert.equal(route.escalation, expected === OPUS ? null : OPUS);
    }
    assert.deepEqual(routing.routeModels(on.find(route => route.taskClass === "targeted-edit")), [SONNET, OPUS]);
    for (const bad of ["claude-haiku-5-5", "gpt-5", "claude-sonnet-5-5-20260101", ""]) assert.equal(routing.routeStage({ stage: "build", files: 2, request: "Bigger", effort: "medium" }, { MAKEBORNE_MODEL_ROUTING: "on", MAKEBORNE_ROUTE_TARGETED_EDIT: bad }).model, OPUS, `unroutable override ${bad} runs the builder model`);
    for (const model of routing.ROUTABLE_MODELS) assert.ok(require("./prices.ts").textPrice(model), `${model} is priced`);
  });

  await check("escalation bounds: a routed attempt gets half the budget and a share of the time; at most one escalation; the failed attempt is absorbed", async () => {
    const route = routing.routeStage({ stage: "build", files: 2, request: "Bigger", effort: "medium" }, routedEnv);
    const spend = new RunSpend({ run: "r", providerCapMicrousd: 1_500_000, customerCapMicrousd: 1_500_000, gate: memoryGate(), deadline: Date.now() + 280_000 });
    const seen = [], deadline = Date.now() + 280_000, emitted = [];
    const out = await routing.runRouted({ route, stage: "build", spend, deadline, singlePass: true, signal: new AbortController().signal, emit: event => emitted.push(event),
      attempt: async (model, attemptDeadline) => {
        seen.push({ model, remaining: spend.remainingMicrousd, attemptDeadline });
        // Each attempt spends everything it may: the worst case for the maximum.
        const ticket = await spend.begin("anthropic", model, spend.remainingMicrousd); await spend.finish(ticket, { actualMicrousd: ticket.boundMicrousd });
        return { finished: false, model };
      },
      failed: result => result.finished ? null : "did not pass the finish checks", reset: () => emitted.push({ type: "reset" }) });
    assert.deepEqual(seen.map(item => item.model), [SONNET, OPUS], "one escalation, never a third attempt even when the escalation also fails");
    assert.equal(seen[0].remaining, 750_000, "the routed attempt may use half the allowance");
    assert.ok(seen[0].attemptDeadline < deadline && seen[0].attemptDeadline <= Date.now() + 280_000 * routing.ROUTED_TIME_SHARE + 50, "a single-pass routed attempt ends early enough to leave room for the escalation");
    assert.equal(seen[1].remaining, 750_000, "the escalation gets everything left"); assert.equal(seen[1].attemptDeadline, deadline);
    assert.ok(spend.providerMicrousd <= spend.runAllowanceMicrousd, "both attempts together stay inside the stage allowance (the shown maximum)");
    assert.equal(spend.absorbedMicrousd, 750_000); assert.equal(spend.chargeableMicrousd, 750_000, "only the escalated attempt is chargeable");
    assert.equal(out.record.escalation, "did not pass the finish checks"); assert.deepEqual(out.record.models, [SONNET, OPUS]);
    assert.deepEqual(emitted.filter(event => event.type === "route").map(event => [event.model, event.escalated]), [[SONNET, false], [OPUS, true]]);
    assert.ok(emitted.findIndex(event => event.type === "reset") < emitted.findIndex(event => event.type === "route" && event.escalated), "the working copy is reset before the retry");
  });

  await check("escalation guards: spending stops, cancellation, too little time or budget never escalate; the builder model never escalates", async () => {
    const route = routing.routeStage({ stage: "build", files: 2, request: "Bigger", effort: "medium" }, routedEnv);
    const attempt = (fn, extra = {}) => { const spend = new RunSpend({ run: "r", providerCapMicrousd: 1_000_000, customerCapMicrousd: null, gate: memoryGate(), deadline: Date.now() + 280_000 }); const models = [];
      return routing.runRouted({ route, stage: "build", spend, deadline: Date.now() + 280_000, singlePass: true, signal: new AbortController().signal, emit() {}, reset() {}, failed: () => "unfinished", ...extra,
        attempt: async model => { models.push(model); return fn(spend, model); } }).then(out => ({ out, models, spend }), error => ({ error, models, spend })); };
    for (const code of ["CANCELLED", "HOLD_EXPIRED", "OVERRUN", "PROVIDER_LIMIT", "PROVIDER_DISABLED", "SPEND_UNAVAILABLE"]) {
      const result = await attempt(() => { throw new SpendError(code, "stop"); });
      assert.equal(result.error?.code, code); assert.deepEqual(result.models, [SONNET], `${code} is not escalated`); assert.ok(result.error.route, "the route record travels with the error");
    }
    const refused = await attempt((spend, model) => { if (model === SONNET) throw Object.assign(new Error("declined"), { code: "REFUSED" }); return { finished: true }; }, { failed: () => null });
    assert.deepEqual(refused.models, [SONNET, OPUS], "a refusal is escalated"); assert.equal(refused.out.record.escalation, "refusal");
    const http = await attempt((spend, model) => { if (model === SONNET) throw Object.assign(new Error("overloaded"), { status: 529 }); return { finished: true }; }, { failed: () => null });
    assert.deepEqual(http.models, [SONNET, OPUS], "a provider error after the call's own retries is escalated");
    const stopped = await attempt(spend => { spend.markOverrun(); return { finished: false }; });
    assert.deepEqual(stopped.models, [SONNET], "an overrun stops the run: no escalation");
    const late = await attempt(() => ({ finished: false }), { deadline: Date.now() + routing.MIN_ESCALATION_MS - 1000 });
    assert.deepEqual(late.models, [SONNET]); assert.match(late.out.record.attempts[0].reason, /not escalated: too little time left/);
    const poor = await attempt(async spend => { const ticket = await spend.begin("anthropic", SONNET, 500_000); await spend.finish(ticket, { actualMicrousd: 400_000 }); spend.confirmedMicrousd += 400_000; return { finished: false }; });
    assert.deepEqual(poor.models, [SONNET], "too little budget left"); assert.equal(poor.spend.absorbedMicrousd, 0, "an attempt that is kept is charged as before");
    const cancelled = new AbortController(); cancelled.abort();
    assert.deepEqual((await attempt(() => ({ finished: false }), { signal: cancelled.signal })).models, [SONNET]);
    const primary = routing.routeStage({ stage: "build", files: 2, request: "Bigger", effort: "medium" }, {});
    const spend = new RunSpend({ run: "r", providerCapMicrousd: 1_000_000, customerCapMicrousd: null, gate: memoryGate(), deadline: Date.now() + 280_000 });
    const calls = [];
    await routing.runRouted({ route: primary, stage: "build", spend, deadline: Date.now() + 280_000, singlePass: true, signal: new AbortController().signal, emit() {}, reset() {}, failed: () => "unfinished",
      attempt: async (model, attemptDeadline) => { calls.push({ model, remaining: spend.remainingMicrousd, attemptDeadline }); return { finished: false }; } });
    assert.equal(calls.length, 1); assert.equal(calls[0].model, OPUS); assert.equal(calls[0].remaining, 1_000_000, "no budget share on the builder model");
  });

  let opusCharge;
  await check("routing off: the website stage runs exactly as before on the builder model (same calls, same charge)", async () => {
    const before = await websiteStage({ anthropic: provider(editor(GOOD)) });
    const off = await websiteStage({ route: routing.routeStage({ stage: "build", files: 4, request: "Make the heading say Fresh bread daily", effort: "light" }, {}), anthropic: provider(editor(GOOD)) });
    for (const result of [before, off]) { assert.equal(result.stream.at(-1).type, "done"); assert.equal(result.finish.args.p_outcome, "saved"); }
    assert.equal(off.stream.at(-1).charged, before.stream.at(-1).charged); assert.equal(off.spend.calls.length, before.spend.calls.length);
    assert.deepEqual(off.spend.calls.map(call => call.model), before.spend.calls.map(call => call.model)); assert.ok(off.spend.calls.every(call => call.model === OPUS));
    const route = off.stream.filter(event => event.type === "route");
    assert.deepEqual(route.map(event => [event.model, event.class, event.escalated]), [[OPUS, "targeted-edit", false]], "the receipt still learns the class and model");
    assert.equal(off.finish.args.p_detail.route.class, "targeted-edit"); assert.deepEqual(off.finish.args.p_detail.route.models, [OPUS]);
    opusCharge = off.stream.at(-1).charged;
    assert.equal(off.finish.args.p_measured_microusd, off.spend.confirmedMicrousd);
  });

  await check("a cheaper routed model charges fewer credits end to end (same work, Sonnet at half the price)", async () => {
    const routed = await websiteStage({ route: routing.routeStage({ stage: "build", files: 4, request: "Make the heading say Fresh bread daily", effort: "light" }, routedEnv), anthropic: provider(editor(GOOD)) });
    assert.equal(routed.stream.at(-1).type, "done"); assert.ok(routed.spend.calls.every(call => call.model === SONNET));
    const perCall = { opus: textUsageMicrousd(OPUS, USAGE), sonnet: textUsageMicrousd(SONNET, USAGE) };
    assert.equal(perCall.sonnet * 2, perCall.opus);
    assert.equal(routed.finish.args.p_measured_microusd, routed.spend.calls.length * perCall.sonnet);
    assert.ok(routed.stream.at(-1).charged < opusCharge, `${routed.stream.at(-1).charged} < ${opusCharge}`);
    assert.equal(routed.stream.at(-1).charged, Math.ceil(routed.spend.calls.length * perCall.sonnet / RATE));
    assert.ok(logs.some(line => /"event":"ai_model_route"/.test(line) && /"models":\["claude-sonnet-5-5"\]/.test(line)), "telemetry records the model");
    assert.ok(logs.every(line => !/Fresh bread/.test(line)), "telemetry carries no prompt or file content");
  });

  await check("a routed attempt that fails the compile gate escalates once to Opus inside the same operation; only Opus is charged; the receipt shows both", async () => {
    const anthropic = provider((model, messages) => model === SONNET
      ? (/does not compile/.test(lastUserText(messages)) ? { content: [{ type: "text", text: "Stuck." }], stop: "max_tokens" } : { content: [tool("write_file", { path: "src/Extra.tsx", content: "export const Extra = 1;" }), tool("write_file", { path: "src/App.tsx", content: BROKEN }), tool("finish", { summary: "Done", title: "Example" })] })
      : editor(GOOD)(model, messages));
    const result = await websiteStage({ route: routing.routeStage({ stage: "build", files: 4, request: "Make the heading say Fresh bread daily", effort: "light" }, routedEnv), anthropic });
    const done = result.stream.at(-1);
    assert.equal(done.type, "done"); assert.equal(result.finish.args.p_outcome, "saved");
    assert.deepEqual(anthropic.seen, [SONNET, SONNET, OPUS, ...anthropic.seen.slice(3).map(() => OPUS)], "Sonnet first, then Opus only");
    const source = result.finish.args.p_candidate.content.websiteSource;
    assert.equal(source.files.find(file => file.path === "src/App.tsx").content, GOOD);
    assert.ok(!source.files.some(file => file.path === "src/Extra.tsx"), "the failed attempt's files are discarded");
    const sonnetMicrousd = result.spend.calls.filter(call => call.model === SONNET).reduce((sum, call) => sum + call.actualMicrousd, 0);
    const opusMicrousd = result.spend.calls.filter(call => call.model === OPUS).reduce((sum, call) => sum + call.actualMicrousd, 0);
    assert.equal(result.spend.absorbedMicrousd, sonnetMicrousd); assert.equal(result.finish.args.p_measured_microusd, opusMicrousd, "settlement measures the Opus attempt only");
    assert.equal(done.charged, Math.ceil(opusMicrousd / RATE)); assert.equal(done.charged, opusCharge, "the customer pays what Opus alone would have cost");
    assert.ok(result.spend.providerMicrousd <= 20 * RATE, "both attempts stay inside the operation's provider allowance"); assert.ok(done.charged <= 20, "the charge stays within the shown maximum");
    const detail = result.finish.args.p_detail.route;
    assert.deepEqual(detail.models, [SONNET, OPUS]); assert.equal(detail.class, "targeted-edit"); assert.equal(detail.absorbedMicrousd, sonnetMicrousd); assert.match(detail.escalation, /finish checks/);
    assert.equal(detail.attempts.length, 2); assert.deepEqual(detail.attempts.map(item => item.outcome), ["failed", "ok"]);
    assert.ok(Buffer.byteLength(JSON.stringify(result.finish.args.p_detail)) < 3800);
    // The client is told what was put back, then sees the retry.
    const deleteAt = result.stream.findIndex(event => event.type === "delete" && event.path === "src/Extra.tsx");
    const escalatedAt = result.stream.findIndex(event => event.type === "route" && event.escalated);
    assert.ok(deleteAt > 0 && deleteAt < escalatedAt);
    assert.ok(result.stream.some((event, index) => index < escalatedAt && index > deleteAt - 3 && event.type === "file" && event.path === "src/App.tsx" && event.content.includes("Hello")));
    const meter = newRunMeter(0);
    for (const event of result.stream) meterEvent(meter, event);
    const receipt = runReceipt(meter, { website: true, unlimited: false, now: 1000 });
    assert.deepEqual(receipt.models, ["Claude Sonnet 5.5 · targeted edit, retried with Claude Opus 5.5 (charged for the retry only)"]);
    assert.deepEqual(receipt.files, ["src/App.tsx"], "files the failed attempt touched are not listed as changes");
    assert.equal(receipt.charged, done.charged);
  });

  await check("finish gate: a finish sent with a failed edit in the same step is refused (seen in qualification: an absolute path, then finish)", async () => {
    const anthropic = provider((model, messages) => /tool call in this step failed/.test(lastUserText(messages))
      ? { content: [tool("write_file", { path: "src/App.tsx", content: GOOD }), tool("finish", { summary: "Changed the heading.", title: "Example" })] }
      : /Not finished yet/.test(lastUserText(messages)) ? { content: [tool("finish", { summary: "Changed the heading.", title: "Example" })] }
      : { content: [tool("edit_file", { path: "/src/App.tsx", old_string: "Hello", new_string: "Fresh bread daily" }), tool("finish", { summary: "Changed the heading.", title: "Example" })] });
    const result = await websiteStage({ route: routing.routeStage({ stage: "build", files: 4, request: "Make the heading say Fresh bread daily", effort: "light" }, routedEnv), anthropic });
    assert.equal(result.stream.at(-1).type, "done"); assert.equal(result.finish.args.p_detail.route.escalation, null, "fixed by the routed model itself after the gate");
    assert.equal(result.finish.args.p_candidate.content.websiteSource.files.find(file => file.path === "src/App.tsx").content, GOOD, "the saved version has the change the summary claims");
    assert.ok(result.stream.some(event => event.type === "tool_error" && event.tool === "finish" && /tool call in this step failed/.test(event.message)));
  });

  await check("a refusal on the routed model escalates; a failure on the escalation is final (no third attempt)", async () => {
    const refusing = provider((model, messages) => model === SONNET ? { content: [], stop: "refusal" } : editor(GOOD)(model, messages));
    const ok = await websiteStage({ route: routing.routeStage({ stage: "build", files: 4, request: "Bigger heading", effort: "light" }, routedEnv), anthropic: refusing });
    assert.equal(ok.stream.at(-1).type, "done"); assert.equal(ok.finish.args.p_detail.route.escalation, "refusal"); assert.deepEqual(refusing.seen.slice(0, 2), [SONNET, OPUS]);
    const bothRefuse = provider(() => ({ content: [], stop: "refusal" }));
    const failed = await websiteStage({ route: routing.routeStage({ stage: "build", files: 4, request: "Bigger heading", effort: "light" }, routedEnv), anthropic: bothRefuse });
    assert.deepEqual(bothRefuse.seen, [SONNET, OPUS]); assert.equal(failed.stream.at(-1).type, "error"); assert.equal(failed.stream.at(-1).charged, 0);
    assert.deepEqual(failed.finish.args.p_detail.route.models, [SONNET, OPUS]);
  });

  await check("a spending stop on the routed attempt is never escalated (provider daily limit)", async () => {
    providerBegin = () => ({ data: null, error: { code: "MB402" } });
    const anthropic = provider(editor(GOOD));
    const result = await websiteStage({ route: routing.routeStage({ stage: "build", files: 4, request: "Bigger heading", effort: "light" }, routedEnv), anthropic });
    assert.deepEqual(anthropic.seen, [], "nothing reached the provider"); assert.equal(result.stream.at(-1).code, "AI_DAILY_LIMIT");
    assert.deepEqual(result.stream.filter(event => event.type === "route").map(event => event.model), [SONNET]);
  });

  await check("the shown maximum is a true upper bound for every effort with a routed model and an escalation", () => {
    for (const [effort, policy] of Object.entries(BUILDER_EFFORT)) {
      const allowance = policy.ceilingCredits * RATE;
      const spend = new RunSpend({ run: effort, providerCapMicrousd: allowance, customerCapMicrousd: allowance, gate: memoryGate(), deadline: Date.now() + 280_000 });
      spend.capAttempt(Math.floor(spend.remainingMicrousd * routing.ROUTED_BUDGET_SHARE));
      assert.ok(spend.remainingMicrousd <= allowance / 2);
      spend.confirmedMicrousd = spend.remainingMicrousd; // the routed attempt used all it may
      spend.capAttempt(null); spend.absorb(spend.confirmedMicrousd);
      spend.confirmedMicrousd += spend.remainingMicrousd; // the escalation used everything left
      assert.ok(spend.providerMicrousd <= allowance); assert.ok(spend.customerCredits(RATE / 1e6) <= policy.ceilingCredits, `${effort}: charge within the ${policy.ceilingCredits}-credit maximum`);
    }
    assert.throws(() => new RunSpend({ run: "x", providerCapMicrousd: 1, customerCapMicrousd: 1, gate: memoryGate(), deadline: Date.now() + 1000 }).capAttempt(-1));
  });

  await check("documents and plans: a routed attempt that does not finish (or yields no plan) is retried once on the builder model", async () => {
    const run = async () => (await api.beginOperation({ actor, workspaceId, artifactId, expectedVersion: 1, effort: "light", kind: "build", ceiling: 20, request: { message: "Write" }, envelope: { actionKey, stepKey } })).run;
    const models = [];
    documentAgent = async input => {
      models.push(input.model);
      const spendTicket = await input.spend.begin("anthropic", input.model, 30000); await input.spend.finish(spendTicket, { actualMicrousd: 30000 });
      input.editor.apply("write_chapter", { chapter: { id: input.model === SONNET ? "draft" : "intro", title: "Introduction", text: "A useful first draft." } });
      return { summary: "Wrote it", finished: input.model !== SONNET };
    };
    const docRun = await run(), docSpend = api.createOperationSpend(docRun, Date.now() + 280000);
    const route = routing.routeStage({ stage: "document", emptyDocument: true, effort: "light" }, { MAKEBORNE_MODEL_ROUTING: "on", MAKEBORNE_ROUTE_DOCUMENT_NEW: SONNET });
    const stream = await events(documentBuildResponse({ client: {}, hold: docRun.hold, operation: docRun, spend: docSpend, workspaceId, artifact: { id: artifactId, project_id: actionKey, kind: "book", title: "Example", current_version: 1 },
      current: { number: 1, assetIds: [], content: { title: "Example", sections: [] }, style: {} }, project: { brief: "Brief", styleId: "" }, versions: [], message: "Write a book", effort: "light", attachments: [], maxDuration: 300, route }));
    assert.deepEqual(models, [SONNET, OPUS]); assert.equal(stream.at(-1).type, "done"); assert.equal(stream.at(-1).charged, 1, "only the Opus attempt is charged");
    const chapters = finishCall().args.p_candidate.content.document.chapters.map(chapter => chapter.id);
    assert.deepEqual(chapters, ["intro"], "the escalation starts from the saved document, not the failed draft");
    assert.ok(stream.some(event => event.type === "document" && !event.document.chapters.length), "the client's preview is reset before the retry");
    rpcCalls = [];
    const plans = [];
    const plan = { kind: "new_site", title: "Example", summary: "Clear site", goal: "Book", audience: "Owners", positioning: "Calm", pages: [{ name: "Home", path: "/", purpose: "Inform", sections: [{ name: "Hero", purpose: "Introduce", content: "Example business" }] }], design: { concept: "Calm", typography: { display: "Fraunces", body: "Inter", rationale: "Contrast" }, palette: [{ name: "Paper", hex: "#FFFFFF", role: "background" }, { name: "Ink", hex: "#000000", role: "text" }, { name: "Sky", hex: "#0000FF", role: "accent" }], layout: ["Split"], imagery: "Rooms", signatureInteraction: "Reveal" }, changes: [], questions: [], assumptions: [] };
    planner = async input => { plans.push(input.model); return { plan: input.model === SONNET ? null : plan }; };
    const planRun = await run();
    const planStream = await events(planStreamResponse({ hold: planRun.hold, operation: planRun, spend: api.createOperationSpend(planRun, Date.now() + 280000), context: "Context", message: "Plan it", previousPlan: null, attachments: [], effort: "light",
      basedOnVersion: 1, previousRevision: 0, persist() { throw Error("Independent plan persistence bypass"); }, maxDuration: 300, route: routing.routeStage({ stage: "plan", effort: "light" }, { MAKEBORNE_MODEL_ROUTING: "on", MAKEBORNE_ROUTE_PLAN: SONNET }) }));
    assert.deepEqual(plans, [SONNET, OPUS]); assert.ok(planStream.some(event => event.type === "plan")); assert.deepEqual(finishCall().args.p_detail.route.models, [SONNET, OPUS]);
    planner = async input => { plans.push(input.model); return { plan }; };
    plans.length = 0; rpcCalls = [];
    const offRun = await run();
    await events(planStreamResponse({ hold: offRun.hold, operation: offRun, spend: api.createOperationSpend(offRun, Date.now() + 280000), context: "Context", message: "Plan it", previousPlan: null, attachments: [], effort: "light",
      basedOnVersion: 1, previousRevision: 0, persist() { throw Error("bypass"); }, maxDuration: 300, route: routing.routeStage({ stage: "plan", effort: "light" }, {}) }));
    assert.deepEqual(plans, [OPUS]);
  });

  await check("routes wire every stage and fail closed on any unpriced model the stage may call", () => {
    const build = fs.readFileSync(path.join(__dirname, "../../app/api/build/route.ts"), "utf8"), plan = fs.readFileSync(path.join(__dirname, "../../app/api/build/plan/route.ts"), "utf8");
    for (const source of [build, plan]) { assert.match(source, /routeStage\(/); assert.match(source, /for \(const model of routeModels\(route\)\) requirePricedModel\(model\)/); }
    assert.match(build, /websiteBuildResponse\(\{ client, hold, spend, operation, route,/); assert.match(build, /documentBuildResponse\([\s\S]*?maxDuration, route \}\)/); assert.match(plan, /maxDuration, route \}\)/);
    // Settlement measures chargeable cost everywhere (confirmed minus an absorbed routed attempt).
    for (const file of ["website-run.ts", "docs-run.ts", "plan-run.ts", "operation-server.ts"]) assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "../builder", file), "utf8"), /finishOperation\([^)]*spend\.confirmedMicrousd/, file);
    const client = fs.readFileSync(path.join(__dirname, "../../components/live-builder.tsx"), "utf8");
    assert.match(client, /<dt>Model<\/dt>/);
  });

  process.stdout.write(`${passed} model-routing checks passed.\n`);
})().catch(error => { process.stderr.write(`${error.stack}\n`); process.exit(1); });
