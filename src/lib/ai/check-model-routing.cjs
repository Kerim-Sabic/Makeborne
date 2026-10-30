/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for the routing policy (routing-policy-v2): deterministic decisions,
 * capability and price rejection, off/shadow baseline compatibility, design and risk signals, the repair/escalation state machine and its
 * accounting, durable counts across restarts, repeated-failure stop, model handoff without thinking replay, missing verification, the credit
 * maximum and customer-facing fields. The website path runs the real builder loop, budgeted calls, RunSpend and durable settlement against a
 * fake provider and a mocked operation database. No network, no paid calls. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict"), Module = require("node:module");
const ids = Array.from({ length: 8 }, (_, i) => `${i + 1}`.repeat(8) + `-${String(i + 1).repeat(4)}-4${String(i + 1).repeat(3)}-8${String(i + 1).repeat(3)}-${String(i + 1).repeat(12)}`);
const [actor, workspaceId, artifactId, actionKey, stepKey, operationId, runId, fence] = ids;
let rpcCalls = [], documentAgent, planner, readRuns = [];
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
for (const key of ["MAKEBORNE_MODEL_ROUTING", "MAKEBORNE_BUILDER_MODEL", "MAKEBORNE_BUILDER_FALLBACK_MODELS", "MAKEBORNE_IMAGE_MODEL", "MAKEBORNE_IMAGE_MODELS", "OPENAI_API_KEY", "MAKEBORNE_ROUTE_FIRST_STEP"]) delete process.env[key];
process.env.MAKEBORNE_AI_COST_USD_PER_CREDIT = "0.03";
const logs = [];
console.error = () => undefined; console.info = (...args) => { logs.push(args.join(" ")); };

const routing = require("./model-routing.ts");
const prices = require("./prices.ts");
const acceptance = require("../builder/acceptance.ts");
const { RunSpend, SpendError, memoryGate } = require("./run-spend.ts");
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
  if (name === "makeborne_ai_operation_begin") return { data: { ...status(), requestContext: { message: "Edit", attachmentsSha256: "0".repeat(64) }, replayed: false, run: { id: runId, reference: `operation:${runId}`, fence, amount: 20, exempt: false, reservedAt: Date.now(), expiresAt: Date.now() + 900000 } }, error: null };
  if (name === "makeborne_ai_operation_create") return { data: snapshot(), error: null };
  if (name === "makeborne_ai_operation_read") return { data: { ...status(), runs: readRuns, requestContext: { message: "Edit", attachmentsSha256: require("node:crypto").createHash("sha256").update(require("../projects/canonical-json.ts").canonicalSourceJson([])).digest("hex") } }, error: null };
  if (name === "makeborne_ai_operation_provider_begin") return providerBegin(args);
  if (name === "makeborne_provider_call_finish") return { data: {}, error: null };
  if (name === "makeborne_ai_operation_finish") {
    // Like SQL: the charge is the measured amount, capped at the run's allocated credits; the result keeps the detail.
    const billable = Math.min(args.p_measured_microusd, 20 * RATE), charged = args.p_outcome === "failed" ? 0 : Math.ceil(billable / RATE);
    const result = { ...args.p_detail, runId, charged, ...(args.p_outcome === "saved" ? { version: 2 } : {}), ...(args.p_outcome === "plan" ? { stored: { ...args.p_candidate.stored, charged }, persisted: true } : {}) };
    return { data: { ...status(result), charged, outcome: args.p_outcome }, error: null };
  }
  throw Error(`Unexpected RPC ${name}`);
}
const finishCall = () => rpcCalls.findLast(call => call.name === "makeborne_ai_operation_finish");
const events = async response => (await response.text()).split("\n\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
let passed = 0;
async function check(name, fn) { rpcCalls = []; logs.length = 0; readRuns = []; providerBegin = () => ({ data: { started: true }, error: null }); await fn(); passed++; process.stdout.write(`PASS ${name}\n`); }

/** A scripted provider: `script(model, messages, params)` returns the next assistant message. Records every call. */
const USAGE = { input_tokens: 20000, output_tokens: 4000 };
function provider(script) {
  const calls = [];
  return { calls, get seen() { return calls.map(call => call.model); }, beta: { messages: {
    stream(params) { calls.push({ model: params.model, messages: structuredClone(params.messages), effort: params.output_config?.effort, maxTokens: params.max_tokens }); const reply = script(params.model, params.messages, params);
      if (reply.throw) throw reply.throw;
      return { on() {}, currentMessage: undefined, finalMessage: async () => ({ model: params.model, usage: USAGE, stop_reason: reply.stop ?? "tool_use", content: reply.content }) }; },
    async countTokens() { return { input_tokens: 20000 }; },
  } } };
}
const tool = (name, input, id = `${name}-${Math.random().toString(36).slice(2, 8)}`) => ({ type: "tool_use", id, name, input });
const lastUserText = messages => JSON.stringify(messages.at(-1)?.content ?? "");
const firstUserText = messages => JSON.stringify(messages[0]?.content ?? "");
/** A model that edits App.tsx to `content` and calls finish (again when a gate blocks once). */
const editor = content => (model, messages) => /Not finished yet/.test(lastUserText(messages)) && !content.includes("BROKEN")
  ? { content: [tool("finish", { summary: "Changed the heading.", title: "Example" })] }
  : { content: [tool("write_file", { path: "src/App.tsx", content }), tool("finish", { summary: "Changed the heading.", title: "Example" })] };
/** A model that writes broken code until told to stop, then gives up (an unfinished attempt with compile evidence). */
const breaker = (content = BROKEN) => (model, messages) => messages.length > 1 && /Not finished yet/.test(lastUserText(messages)) ? { content: [{ type: "text", text: "Stuck." }], stop: "max_tokens" }
  : { content: [{ type: "thinking", thinking: "", signature: `sig-${model}` }, tool("write_file", { path: "src/App.tsx", content }), tool("finish", { summary: "Done", title: "Example" })] };
const GOOD = 'export default function App() { return <main><h1>Fresh bread daily</h1><p>Open from seven.</p></main>; }';
const BROKEN = 'export default function App() { return <main>BROKEN';
const BROKEN_OTHER = 'export default function App() { return <main>BROKEN AGAIN';
let compileMode = "real";
const compile = async files => compileMode === "unverified" ? { status: "unverified" } : /BROKEN AGAIN/.test(files.get("src/App.tsx") ?? "") ? { status: "failed", problems: ["src/App.tsx line 1: unexpected end of input after <main>."] }
  : /BROKEN/.test(files.get("src/App.tsx") ?? "") ? { status: "failed", problems: ["src/App.tsx does not compile."] } : { status: "passed" };
function project() {
  const source = new ProjectFiles();
  source.write("index.html", '<!doctype html><html><head><title>T</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>');
  source.write("src/main.tsx", 'import { createRoot } from "react-dom/client"; import App from "./App"; import "./styles.css"; createRoot(document.getElementById("root")!).render(<App />);');
  source.write("src/App.tsx", 'export default function App() { return <main><h1>Hello</h1><p>Welcome.</p></main>; }');
  source.write("src/styles.css", "body{margin:0}");
  return new ProjectFiles(source.toSource());
}
const MESSAGE = "Make the heading say Fresh bread daily";
const routeFor = (env, extra = {}) => routing.routeStage({ stage: "build", artifact: "website", request: MESSAGE, files: 4, projectBytes: 600, effort: "light", attachments: 0, verification: { compile: true, contrast: true }, ...extra }, env);
async function websiteStage({ route, anthropic, message = MESSAGE, effort = "light", files = project(), contrast = true }) {
  const run = (await api.beginOperation({ actor, workspaceId, artifactId, expectedVersion: 1, effort, kind: "build", ceiling: 20, request: { message }, envelope: { actionKey, stepKey } })).run;
  const spend = api.createOperationSpend(run, Date.now() + 280000);
  const stream = await events(websiteBuildResponse({ client: { rpc() { throw Error("Nonatomic save bypass"); } }, hold: run.hold, operation: run, spend, workspaceId,
    artifact: { id: artifactId, project_id: actionKey, title: "Example", current_version: 1 }, current: { number: 1, assetIds: [], content: { title: "Example", sections: [] }, style: {} },
    files, reviewing: false, message, effort, request: message, context: `Context\n<current_files>\n${files.snapshot()}\n</current_files>\nExisting images: none`, attachments: [], maxDuration: 300, anthropic, compile, stepGuardMs: 0,
    ...(contrast ? { contrastCheck: async () => [] } : {}), ...(route ? { route } : {}) }));
  return { stream, spend, files, finish: finishCall() };
}
const ON = { MAKEBORNE_MODEL_ROUTING: "on", MAKEBORNE_ROUTE_TARGETED_EDIT: SONNET };
const microusd = (result, model) => result.spend.calls.filter(call => !model || call.model === model).reduce((sum, call) => sum + call.actualMicrousd, 0);

(async () => {
  await check("deterministic decisions: the same signals give the same versioned decision, with reason codes, parent ids, revision, checks and limits", () => {
    const input = { stage: "build", artifact: "website", request: MESSAGE, files: 4, projectBytes: 600, effort: "medium", verification: { compile: true, contrast: true }, operation: { id: operationId, runId, revision: 7 } };
    const a = routing.routeStage(input, ON), b = routing.routeStage(structuredClone(input), { ...ON });
    assert.deepEqual(a, b);
    assert.equal(a.policyVersion, routing.ROUTING_POLICY_VERSION); assert.equal(a.capabilityConfigVersion, prices.CAPABILITY_CONFIG_VERSION);
    assert.deepEqual(a.parent, { operationId, runId, stage: "build" }); assert.equal(a.inputRevision, 7); assert.equal(a.taskRole, "website-builder");
    assert.deepEqual(a.requiredChecks, { contract: "acceptance-v1", ids: ["W-H1", "W-H4", "W-H5", "W-H6", "W-D1", "W-D2"] });
    assert.equal(a.class, "targeted-edit"); assert.equal(a.model, SONNET); assert.equal(a.escalation, OPUS); assert.deepEqual(a.limits, { repairs: 1, escalations: 1 });
    assert.ok(a.reasonCodes.includes("MODE_ON") && a.reasonCodes.includes("SCOPE_NAMED_PART") && a.reasonCodes.includes("ROUTED_DOWN"), a.reasonCodes.join(" "));
    assert.ok(a.allocation.initialShare < 1 && a.allocation.initialShare + a.allocation.repairShare <= 1 - routing.MIN_ESCALATION_SHARE);
    assert.deepEqual(a.tools, { files: true, images: true, concept: false, webSearch: false }); assert.equal(a.context.selection, "project-snapshot");
    assert.equal(a.fallback, "preserve-valid-work");
    assert.doesNotMatch(JSON.stringify(a), /Fresh bread/, "a decision never carries request text");
  });

  await check("task contract as input: its acceptance checks are required (loop-established subset decides; the rest deferred, never passed), its scope is used, its limits only lower", () => {
    const { buildTaskContract } = require("../builder/task-contract.ts");
    const contract = buildTaskContract({ artifact: "website", objective: "edit", message: MESSAGE, revision: { expectedVersion: 3 }, target: { file: "src/App.tsx", line: 4, label: "Heading" }, limits: { capCredits: 20, repairs: 1, escalations: 0 } });
    const route = routeFor(ON, { contract });
    assert.deepEqual(route.requiredChecks.ids, contract.checks); assert.equal(route.requiredChecks.contract, "acceptance-v1");
    assert.deepEqual(route.inLoopChecks, ["W-H1", "W-H5", "W-D1", "W-D2"]);
    assert.ok(["W-H2", "W-H7", "O1", "O5"].every(id => route.deferredChecks.includes(id)));
    assert.equal(route.signals.affectedScope, "picked-element");
    assert.deepEqual(route.limits, { repairs: 1, escalations: 0 }); assert.equal(route.escalation, null); assert.ok(route.reasonCodes.includes("CONTRACT_LIMITS_LOWER"));
    const raised = routeFor(ON, { contract: { ...contract, limits: { ...contract.limits, repairs: 5, escalations: 9 } } });
    assert.deepEqual(raised.limits, { repairs: 1, escalations: 1 }, "a contract can never raise the policy's limits");
    const evidence = acceptance.websiteEvidence({ finished: true, build: "passed", contrast: "passed", problems: [] }, route.requiredChecks.ids);
    assert.ok(evidence.filter(result => result.status === "passed").every(result => route.inLoopChecks.includes(result.id)), "a check the loop cannot establish is never reported passed");
  });

  await check("classification uses scope and stage, not prompt length; plans, attachments and approved plans are never targeted", () => {
    const c = request => routing.classifyStage({ stage: "build", files: 9, effort: "medium", request }).class;
    assert.equal(c(`Change the button "Book now" in the footer to "Reserve". ${"Context about why. ".repeat(150)}`), "copy-edit", "a long request naming the exact replacement is a copy edit, whatever its length");
    assert.equal(c(`Move the button "Book now" in the footer above the map. ${"Context about why. ".repeat(150)}`), "targeted-edit", "a long request about one named part");
    assert.equal(c("Redesign it"), "redesign", "a short request for a whole-project change");
    assert.equal(c(`Change the <h1> "Hello" in src/App.tsx (line 4): bigger`), "targeted-edit");
    assert.equal(c("Make it better"), "edit", "no scope: a general edit");
    assert.equal(routing.classifyStage({ stage: "build", files: 0, effort: "medium", request: "Change the button" }).class, "new-site");
    assert.equal(routing.classifyStage({ stage: "build", files: 9, effort: "medium", request: "Change the button", attachments: 1 }).class, "edit");
    assert.equal(routing.classifyStage({ stage: "build", files: 9, effort: "medium", request: "Change the button", plan: true }).class, "redesign");
  });

  await check("capability registry (prices.ts): unknown, unpriced or unsupported models and combinations are rejected before any call", () => {
    assert.throws(() => prices.textCapabilities("claude-sonnet-9"), /No verified price/);
    assert.throws(() => prices.textCapabilities("gpt-image-2"), /No verified price|capability/);
    assert.equal(prices.capabilityIssue(OPUS, { effort: "max" }), null);
    assert.match(prices.capabilityIssue("claude-haiku-5-5", { effort: "medium" }), /thinking progress updates/);
    assert.match(prices.capabilityIssue(SONNET, { effort: "medium", taskClass: "targeted-edit", requireQualified: true }), /not qualified/);
    assert.match(prices.capabilityIssue(OPUS, { effort: "medium", outputTokens: 200_000 }), /output is capped/);
    for (const bad of ["claude-sonnet-9", "claude-sonnet-5-5-20260101"]) {
      const route = routeFor({ MAKEBORNE_MODEL_ROUTING: "on", MAKEBORNE_ROUTE_TARGETED_EDIT: bad });
      assert.equal(route.model, OPUS, bad); assert.ok(route.reasonCodes.includes("CAPABILITY_REJECTED"), bad);
    }
    // Website stages run without progress notes on models that lack them; plans and documents still need them.
    assert.equal(routeFor({ MAKEBORNE_MODEL_ROUTING: "on", MAKEBORNE_ROUTE_TARGETED_EDIT: "claude-haiku-5-5" }).model, "claude-haiku-5-5");
    const haikuPlan = routing.routeStage({ stage: "plan", artifact: "website", request: "Plan it", files: 4, effort: "light" }, { MAKEBORNE_MODEL_ROUTING: "on", MAKEBORNE_ROUTE_PLAN: "claude-haiku-5-5" });
    assert.equal(haikuPlan.model, OPUS); assert.ok(haikuPlan.reasonCodes.includes("CAPABILITY_REJECTED"));
    assert.equal(routing.routeIssue(routeFor(ON)), null);
    assert.match(routing.routeIssue({ ...routeFor(ON), escalation: "claude-unknown" }), /claude-unknown/);
    // No floating aliases and no automatic adoption: only exact ids with a capability record are eligible.
    assert.deepEqual(routeFor(ON).eligibleModels.sort(), [OPUS, SONNET]);
    assert.deepEqual(prices.textCapabilities(SONNET).qualified, [], "Sonnet is qualified for nothing (record 2026-10-22)");
  });

  await check("flag off and shadow: today's execution exactly (builder model, one attempt, first step low); shadow records what on would do", () => {
    for (const env of [{}, { ...ON, MAKEBORNE_MODEL_ROUTING: "off" }, { MAKEBORNE_MODEL_ROUTING: "maybe" }, { MAKEBORNE_MODEL_ROUTING: "shadow", MAKEBORNE_ROUTE_TARGETED_EDIT: SONNET }]) {
      const route = routeFor(env);
      assert.equal(route.model, OPUS); assert.equal(route.escalation, null); assert.deepEqual(route.limits, { repairs: 0, escalations: 0 });
      assert.deepEqual(route.allocation, { initialShare: 1, repairShare: 0, initialTimeShare: 1, repairTimeShare: 0 }); assert.deepEqual(route.firstStep, routing.FIRST_STEP_LOW);
    }
    assert.equal(routeFor({ MAKEBORNE_BUILDER_MODEL: SONNET }).model, SONNET, "MAKEBORNE_BUILDER_MODEL keeps its meaning");
    const shadow = routeFor({ MAKEBORNE_MODEL_ROUTING: "shadow", MAKEBORNE_ROUTE_TARGETED_EDIT: SONNET });
    assert.equal(shadow.mode, "shadow"); assert.deepEqual({ model: shadow.shadow.model, escalation: shadow.shadow.escalation }, { model: SONNET, escalation: OPUS });
    assert.equal(routeFor({}).shadow, null);
  });

  await check("signals: high design demand with low code complexity, short security- or business-sensitive requests, missing information or verification, deep effort and prior failure never route down", () => {
    const kept = (extra, code) => { const route = routeFor(ON, extra); assert.equal(route.model, OPUS, code); assert.ok(route.reasonCodes.includes(code), `${code}: ${route.reasonCodes.join(" ")}`); };
    kept({ request: "Make the heading colour warmer" }, "DESIGN_DEMAND_HIGH");
    assert.equal(routing.routeSignals({ stage: "build", files: 4, effort: "light", request: "Make the heading colour warmer" }, "targeted-edit").functionalComplexity, "low", "low code complexity, still kept");
    kept({ request: "Change the price in the footer to 20" }, "RISK_HIGH");
    kept({ request: "Add a password field to the form" }, "RISK_HIGH");
    kept({ request: "Change the footer text, I'll send the address later" }, "MISSING_INFORMATION");
    kept({ verification: { compile: true, contrast: false } }, "VERIFICATION_MISSING");
    kept({ effort: "ultra" }, "EFFORT_DEEP");
    kept({ previous: { repairs: 0, escalations: 1, signatures: [], interrupted: 0 } }, "PRIOR_FAILURE");
    kept({ deadlineMs: 60_000 }, "DEADLINE_SHORT");
    kept({ allowanceMicrousd: 100_000 }, "BUDGET_LOW");
    kept({ projectBytes: 2_000_000 }, "CONTEXT_LARGE");
    assert.equal(routeFor(ON).model, SONNET, "a plain, verifiable, low-risk targeted edit may route down");
  });

  let opusCharge;
  await check("routing off end to end: same provider calls and charge as without a decision; the client sees the task class, no model names", async () => {
    const before = await websiteStage({ anthropic: provider(editor(GOOD)) });
    const off = await websiteStage({ route: routeFor({}), anthropic: provider(editor(GOOD)) });
    for (const result of [before, off]) { assert.equal(result.stream.at(-1).type, "done"); assert.equal(result.finish.args.p_outcome, "saved"); }
    assert.equal(off.stream.at(-1).charged, before.stream.at(-1).charged); assert.deepEqual(off.spend.calls.map(call => call.model), before.spend.calls.map(call => call.model));
    const routeEvents = off.stream.filter(event => event.type === "route");
    assert.deepEqual(routeEvents.map(event => [event.class, event.role]), [["targeted-edit", "initial"]]);
    assert.doesNotMatch(JSON.stringify(off.stream), /claude|opus|sonnet|anthropic/i, "no model or provider names reach the customer");
    assert.equal(off.finish.args.p_detail.route.mode, "off"); assert.deepEqual(off.finish.args.p_detail.route.models, [OPUS]); assert.equal(off.finish.args.p_detail.route.outcome, "accept");
    opusCharge = off.stream.at(-1).charged;
    const shadow = await websiteStage({ route: routeFor({ MAKEBORNE_MODEL_ROUTING: "shadow", MAKEBORNE_ROUTE_TARGETED_EDIT: SONNET }), anthropic: provider(editor(GOOD)) });
    assert.deepEqual(shadow.spend.calls.map(call => call.model), before.spend.calls.map(call => call.model), "shadow makes no extra or different call");
    assert.equal(shadow.stream.at(-1).charged, before.stream.at(-1).charged);
    assert.deepEqual(shadow.finish.args.p_detail.route.shadow, { model: SONNET, escalation: OPUS, firstStep: "first-step-low-v1" });
    assert.ok(logs.some(line => /"event":"ai_model_route"/.test(line) && /"mode":"shadow"/.test(line)) && logs.every(line => !/Fresh bread/.test(line)), "telemetry without content");
  });

  await check("retry plus escalation accounting: a routed attempt that fails, then a repair that fails differently, escalates once; only the escalation is charged", async () => {
    const anthropic = provider((model, messages) => model === OPUS ? editor(GOOD)(model, messages) : /Repair:/.test(firstUserText(messages)) ? breaker(BROKEN_OTHER)(model, messages) : breaker(BROKEN)(model, messages));
    const result = await websiteStage({ route: routeFor(ON), anthropic });
    const done = result.stream.at(-1), detail = result.finish.args.p_detail.route;
    assert.equal(done.type, "done"); assert.equal(result.finish.args.p_outcome, "saved");
    assert.deepEqual(detail.attempts.map(item => [item.role, item.model, item.kind]), [["initial", SONNET, "quality"], ["repair", SONNET, "quality"], ["escalation", OPUS, "accept"]]);
    assert.equal(detail.repairs, 1); assert.equal(detail.escalations, 1); assert.equal(detail.outcome, "accept");
    assert.equal(result.spend.absorbedMicrousd, microusd(result, SONNET), "both routed attempts are absorbed");
    assert.equal(result.finish.args.p_measured_microusd, microusd(result, OPUS)); assert.equal(done.charged, opusCharge, "the customer pays what the builder model alone costs");
    assert.ok(result.spend.providerMicrousd <= 20 * RATE); assert.ok(done.charged <= 20);
    assert.equal(result.finish.args.p_candidate.content.websiteSource.files.find(file => file.path === "src/App.tsx").content, GOOD);
    assert.equal(done.route, undefined, "the durable route record never reaches the client's done event");
    const meter = newRunMeter(0); for (const event of result.stream) meterEvent(meter, event);
    const receipt = runReceipt(meter, { website: true, unlimited: false, now: 1000 });
    assert.deepEqual(receipt.tasks, ["Targeted edit, fixed in a second pass, retried once (charged for the retry only)"]);
    assert.doesNotMatch(JSON.stringify(receipt), /claude|opus|sonnet/i);
    assert.ok(Buffer.byteLength(JSON.stringify(result.finish.args.p_detail)) < 3800);
  });

  await check("a repair that fixes the routed attempt is accepted and charged (both attempts are the customer's work); no escalation", async () => {
    const anthropic = provider((model, messages) => /Repair:/.test(firstUserText(messages)) ? editor(GOOD)(model, messages) : breaker(BROKEN)(model, messages));
    const result = await websiteStage({ route: routeFor(ON), anthropic });
    const detail = result.finish.args.p_detail.route;
    assert.deepEqual(detail.attempts.map(item => [item.role, item.model, item.kind]), [["initial", SONNET, "quality"], ["repair", SONNET, "accept"]]);
    assert.equal(result.spend.absorbedMicrousd, 0); assert.equal(result.finish.args.p_measured_microusd, microusd(result));
    const repairCall = anthropic.calls.find(call => /Repair:/.test(JSON.stringify(call.messages[0])));
    assert.match(JSON.stringify(repairCall.messages[0]), /does not compile/, "the repair carries the gate evidence");
    assert.match(JSON.stringify(repairCall.messages[0]), /BROKEN/, "and starts from the current files");
  });

  await check("repeated non-progressing repair: the same normalized diagnostics stop the loop (no escalation)", async () => {
    const anthropic = provider((model, messages) => model === OPUS ? editor(GOOD)(model, messages) : breaker(BROKEN)(model, messages));
    const result = await websiteStage({ route: routeFor(ON), anthropic });
    const detail = result.finish.args.p_detail.route;
    assert.deepEqual(detail.models, [SONNET, SONNET]); assert.equal(detail.outcome, "stop"); assert.ok(detail.codes.includes("REPEATED_IDENTICAL_FAILURE"));
    assert.equal(detail.attempts[0].signature, detail.attempts[1].signature);
    assert.ok(!anthropic.seen.includes(OPUS));
    assert.equal(routing.failureSignature(["Contrast: 3.1:1 on \"Book\""]), routing.failureSignature(["contrast:  4.2:1 on 'Order'"]), "numbers and quoted text are normalized");
  });

  await check("model handoff: every attempt starts a new conversation; no thinking block is ever replayed to another model", async () => {
    const anthropic = provider((model, messages) => model === OPUS ? editor(GOOD)(model, messages) : /Repair:/.test(firstUserText(messages)) ? breaker(BROKEN_OTHER)(model, messages) : breaker(BROKEN)(model, messages));
    await websiteStage({ route: routeFor(ON), anthropic });
    const opusCalls = anthropic.calls.filter(call => call.model === OPUS);
    assert.ok(opusCalls.length >= 1);
    assert.equal(opusCalls[0].messages.length, 1, "the escalation's first request has only the user turn");
    for (const call of opusCalls) assert.doesNotMatch(JSON.stringify(call.messages), /"type":"thinking"|sig-claude-sonnet/, "no Sonnet thinking block in any Opus request");
    const repairFirst = anthropic.calls.find(call => /Repair:/.test(JSON.stringify(call.messages[0])));
    assert.equal(repairFirst.messages.length, 1, "a repair is a new conversation too");
  });

  await check("infrastructure, credential and spending failures never escalate; a refusal may", async () => {
    const http = status => provider(model => model === SONNET ? { throw: Object.assign(new Error("provider"), { status }) } : editor(GOOD)(model, []));
    for (const [statusCode, kind] of [[529, "infrastructure"], [500, "infrastructure"], [401, "credential"]]) {
      const anthropic = http(statusCode);
      const result = await websiteStage({ route: routeFor(ON), anthropic });
      assert.ok(!anthropic.seen.includes(OPUS), `${statusCode}: no escalation`); assert.equal(result.finish.args.p_detail.route.attempts[0].kind, kind);
    }
    providerBegin = () => ({ data: null, error: { code: "MB402" } });
    const limited = provider(editor(GOOD));
    const stopped = await websiteStage({ route: routeFor(ON), anthropic: limited });
    assert.deepEqual(limited.seen, []); assert.equal(stopped.stream.at(-1).code, "AI_DAILY_LIMIT");
    providerBegin = () => ({ data: { started: true }, error: null });
    const refusing = provider((model, messages) => model === SONNET ? { content: [], stop: "refusal" } : editor(GOOD)(model, messages));
    const refused = await websiteStage({ route: routeFor(ON), anthropic: refusing });
    assert.equal(refused.stream.at(-1).type, "done"); assert.deepEqual(refused.finish.args.p_detail.route.attempts.map(item => item.kind), ["refusal", "accept"]);
    for (const [error, kind] of [[new SpendError("CANCELLED", "x"), "cancelled"], [new SpendError("OVERRUN", "x"), "spend-stop"], [Object.assign(new Error("x"), { code: "UNSUPPORTED_AI_CONFIG" }), "deterministic"], [Object.assign(new Error("x"), { status: 403 }), "credential"], [new Error("socket hang up ECONNRESET"), "infrastructure"]])
      assert.equal(routing.errorKind(error), kind);
  });

  await check("missing verification is not a pass: an unverifiable build is preserved, never repaired or escalated", async () => {
    compileMode = "unverified";
    try {
      const anthropic = provider(editor(GOOD));
      const result = await websiteStage({ route: routeFor(ON), anthropic });
      const detail = result.finish.args.p_detail.route;
      assert.deepEqual(detail.attempts.map(item => item.kind), ["unverified"]); assert.equal(detail.outcome, "preserve"); assert.ok(detail.checks.notChecked.includes("W-H1"));
      assert.deepEqual(anthropic.seen.filter(model => model === OPUS), []); assert.equal(result.stream.at(-1).type, "done", "the work is still saved, as unverified");
    } finally { compileMode = "real"; }
    const checks = acceptance.websiteEvidence({ finished: true, build: "passed", contrast: "not_checked", problems: [] });
    assert.equal(acceptance.accepted(checks), false); assert.deepEqual(acceptance.uncheckedIds(checks), ["W-D2"]);
    const hardFailed = acceptance.websiteEvidence({ finished: true, build: "passed", contrast: "passed", problems: [], waived: ["Missing section: Opening hours"] });
    assert.equal(acceptance.accepted(hardFailed), false, "a waived hard finding stays failed; nothing offsets it"); assert.deepEqual(acceptance.failedIds(hardFailed), ["W-H6"]);
    assert.equal(acceptance.accepted([]), false, "no evidence is not acceptance");
  });

  await check("restart persistence: repair and escalation counts are read back from the operation's earlier runs and bound the next stage", async () => {
    const done = { route: { v: routing.ROUTING_POLICY_VERSION, repairs: 1, escalations: 1, attempts: [{ role: "initial", kind: "quality", signature: "abcd1234" }, { role: "escalation", kind: "accept", signature: null }] } };
    assert.deepEqual(routing.priorRoute([{ status: "finished", result: done }, { status: "active", result: null }]), { repairs: 1, escalations: 1, signatures: ["abcd1234"], interrupted: 1 });
    readRuns = [{ id: runId, status: "finished", result: done }];
    const continued = (await api.beginOperation({ actor, workspaceId, artifactId, expectedVersion: 1, effort: "light", kind: "build", ceiling: 20, request: { message: MESSAGE, attachments: [] }, envelope: { id: operationId, stepKey, kind: "continuation" } })).run;
    assert.deepEqual(continued.priorRoute, { repairs: 1, escalations: 1, signatures: ["abcd1234"], interrupted: 0 });
    const next = routeFor(ON, { previous: continued.priorRoute });
    assert.equal(next.model, OPUS, "prior failure evidence keeps the next stage on the builder model"); assert.deepEqual(next.limits, { repairs: 0, escalations: 0 });
    assert.ok(next.reasonCodes.includes("REPAIR_USED") && next.reasonCodes.includes("ESCALATION_USED"));
    const interrupted = routeFor({ ...ON }, { previous: { repairs: 0, escalations: 0, signatures: [], interrupted: 1 } });
    assert.deepEqual(interrupted.limits, { repairs: 0, escalations: 0 }); assert.ok(interrupted.reasonCodes.includes("PRIOR_INTERRUPTED_NO_RETRY"));
  });

  await check("first-step rule: off keeps effort low with no extra cap; on with the capped rule uses the policy intensity within a bounded first-step output", async () => {
    const empty = () => new ProjectFiles();
    const firstBuild = (model, messages) => messages.length === 1 ? { content: [tool("write_file", { path: "index.html", content: '<!doctype html><html><head><title>T</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>' }),
      tool("write_file", { path: "src/main.tsx", content: 'import { createRoot } from "react-dom/client"; import App from "./App"; createRoot(document.getElementById("root")!).render(<App />);' }), tool("write_file", { path: "src/App.tsx", content: GOOD })] }
      : { content: [tool("finish", { summary: "Built.", title: "Example" })] };
    const offProvider = provider(firstBuild);
    await websiteStage({ route: routing.routeStage({ stage: "build", artifact: "website", request: "Bakery site", files: 0, effort: "medium", verification: { compile: true, contrast: true } }, {}), anthropic: offProvider, files: empty(), effort: "medium" });
    assert.equal(offProvider.calls[0].effort, "low"); assert.equal(routing.FIRST_STEP_LOW.maxOutputTokens, null, "no extra cap when off"); assert.equal(offProvider.calls[1].effort, "medium");
    const capped = routing.routeStage({ stage: "build", artifact: "website", request: "Bakery site", files: 0, effort: "medium", verification: { compile: true, contrast: true } }, { MAKEBORNE_MODEL_ROUTING: "on", MAKEBORNE_ROUTE_FIRST_STEP: "capped" });
    assert.deepEqual(capped.firstStep, routing.FIRST_STEP_CAPPED); assert.ok(capped.reasonCodes.includes("FIRST_STEP_FIRST_STEP_CAPPED_V1"));
    const onProvider = provider(firstBuild);
    await websiteStage({ route: capped, anthropic: onProvider, files: empty(), effort: "medium" });
    assert.equal(onProvider.calls[0].effort, "medium"); assert.ok(onProvider.calls[0].maxTokens <= routing.FIRST_STEP_CAPPED.maxOutputTokens, "the first step stays within its bounded share");
    assert.equal(onProvider.calls[1].effort, "medium");
    assert.deepEqual(routing.routeStage({ stage: "build", files: 0, effort: "medium" }, { MAKEBORNE_MODEL_ROUTING: "on" }).firstStep, routing.FIRST_STEP_ON);
  });

  await check("the shown maximum is a true upper bound for every effort with a routed attempt, a repair and an escalation", () => {
    for (const [effort, policy] of Object.entries(BUILDER_EFFORT)) {
      const allowance = policy.ceilingCredits * RATE;
      const spend = new RunSpend({ run: effort, providerCapMicrousd: allowance, customerCapMicrousd: allowance, gate: memoryGate(), deadline: Date.now() + 280_000 });
      for (const share of [routing.ALLOCATION.routedInitialShare, routing.ALLOCATION.repairShare]) {
        spend.capAttempt(spend.providerMicrousd + Math.min(spend.remainingMicrousd, Math.floor(spend.runAllowanceMicrousd * share)));
        spend.confirmedMicrousd += spend.remainingMicrousd; spend.capAttempt(null);
      }
      assert.ok(spend.remainingMicrousd >= allowance * routing.MIN_ESCALATION_SHARE, `${effort}: the escalation keeps at least ${routing.MIN_ESCALATION_SHARE}`);
      spend.absorb(spend.confirmedMicrousd); spend.confirmedMicrousd += spend.remainingMicrousd;
      assert.ok(spend.providerMicrousd <= allowance); assert.ok(spend.customerCredits(RATE / 1e6) <= policy.ceilingCredits, `${effort}: within the ${policy.ceilingCredits}-credit maximum`);
    }
  });

  await check("documents and plans: a routed attempt that does not finish is repaired once, then escalated once; plans escalate when no valid plan", async () => {
    const run = async () => (await api.beginOperation({ actor, workspaceId, artifactId, expectedVersion: 1, effort: "light", kind: "build", ceiling: 20, request: { message: "Write" }, envelope: { actionKey, stepKey } })).run;
    const attempts = [];
    documentAgent = async input => {
      attempts.push({ model: input.model, repair: /Repair:/.test(input.request) });
      const ticket = await input.spend.begin("anthropic", input.model, 30000); await input.spend.finish(ticket, { actualMicrousd: 30000 });
      input.editor.apply("write_chapter", { chapter: { id: input.model === SONNET ? `draft-${attempts.length}` : "intro", title: "Introduction", text: "A useful first draft." } });
      return { summary: "Wrote it", finished: input.model !== SONNET };
    };
    const docRun = await run(), docSpend = api.createOperationSpend(docRun, Date.now() + 280000);
    const route = routing.routeStage({ stage: "document", artifact: "book", emptyDocument: true, effort: "light" }, { MAKEBORNE_MODEL_ROUTING: "on", MAKEBORNE_ROUTE_DOCUMENT_NEW: SONNET });
    assert.equal(route.model, OPUS, "a new book is high design demand: kept on the builder model even with an override");
    const forced = { ...route, model: SONNET, escalation: OPUS, limits: { repairs: 1, escalations: 1 }, allocation: { initialShare: 0.4, repairShare: 0.15, initialTimeShare: 0.5, repairTimeShare: 0.2 } };
    const stream = await events(documentBuildResponse({ client: {}, hold: docRun.hold, operation: docRun, spend: docSpend, workspaceId, artifact: { id: artifactId, project_id: actionKey, kind: "book", title: "Example", current_version: 1 },
      current: { number: 1, assetIds: [], content: { title: "Example", sections: [] }, style: {} }, project: { brief: "Brief", styleId: "" }, versions: [], message: "Write a book", effort: "light", attachments: [], maxDuration: 300, route: forced }));
    assert.deepEqual(attempts, [{ model: SONNET, repair: false }, { model: SONNET, repair: true }, { model: OPUS, repair: false }]);
    assert.equal(stream.at(-1).type, "done"); assert.equal(stream.at(-1).charged, 1, "only the escalation is charged");
    assert.deepEqual(finishCall().args.p_candidate.content.document.chapters.map(chapter => chapter.id), ["intro"], "the escalation starts from the saved document");
    rpcCalls = [];
    const plans = [];
    const plan = { kind: "new_site", title: "Example", summary: "Clear site", goal: "Book", audience: "Owners", positioning: "Calm", pages: [{ name: "Home", path: "/", purpose: "Inform", sections: [{ name: "Hero", purpose: "Introduce", content: "Example business" }] }], design: { concept: "Calm", typography: { display: "Fraunces", body: "Inter", rationale: "Contrast" }, palette: [{ name: "Paper", hex: "#FFFFFF", role: "background" }, { name: "Ink", hex: "#000000", role: "text" }, { name: "Sky", hex: "#0000FF", role: "accent" }], layout: ["Split"], imagery: "Rooms", signatureInteraction: "Reveal" }, changes: [], questions: [], assumptions: [] };
    planner = async input => { plans.push(input.model); return { plan: input.model === SONNET ? null : plan }; };
    const planRoute = routing.routeStage({ stage: "plan", effort: "light" }, { MAKEBORNE_MODEL_ROUTING: "on", MAKEBORNE_ROUTE_PLAN: SONNET });
    assert.equal(planRoute.model, SONNET); assert.deepEqual(planRoute.limits, { repairs: 0, escalations: 1 });
    const planRun = await run();
    const planStream = await events(planStreamResponse({ hold: planRun.hold, operation: planRun, spend: api.createOperationSpend(planRun, Date.now() + 280000), context: "Context", message: "Plan it", previousPlan: null, attachments: [], effort: "light",
      basedOnVersion: 1, previousRevision: 0, persist() { throw Error("Independent plan persistence bypass"); }, maxDuration: 300, route: planRoute }));
    assert.deepEqual(plans, [SONNET, OPUS]); assert.ok(planStream.some(event => event.type === "plan")); assert.deepEqual(finishCall().args.p_detail.route.models, [SONNET, OPUS]);
  });

  await check("routes wire every stage, re-take the decision with the operation's state, and fail closed on unpriced or unsupported models", () => {
    const build = fs.readFileSync(path.join(__dirname, "../../app/api/build/route.ts"), "utf8"), plan = fs.readFileSync(path.join(__dirname, "../../app/api/build/plan/route.ts"), "utf8");
    for (const source of [build, plan]) { assert.match(source, /requirePricedModel\(model\)/); assert.match(source, /routeIssue\(/); assert.match(source, /previous: operation\.priorRoute/); assert.match(source, /maxDuration, route \}\)/); }
    assert.match(build, /websiteBuildResponse\(\{ client, hold, spend, operation, route,/);
    for (const file of ["website-run.ts", "docs-run.ts", "plan-run.ts", "operation-server.ts"]) assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "../builder", file), "utf8"), /finishOperation\([^)]*spend\.confirmedMicrousd/, file);
    assert.match(fs.readFileSync(path.join(__dirname, "../../components/live-builder.tsx"), "utf8"), /<dt>Task<\/dt>/);
  });

  await check("v3 copy edits: named values to replace or remove, in English or Bosnian; design, behaviour, additions and block removals are not", () => {
    const c = request => routing.classifyStage({ stage: "build", files: 9, effort: "medium", request }).class;
    for (const request of ["Change the phone number to +387 61 123 456", 'Replace "Book a table" with "Reserve now"', 'Fix the typo: "Resturant" should be "Restaurant"',
      "Change opening hours on Saturday to 10:00–14:00", 'Remove the line "Free parking"', "Promijeni broj telefona na 061 123 456", "Obriši rečenicu „Besplatan parking“"]) assert.equal(c(request), "copy-edit", request);
    for (const request of ["Make the hero bolder and change the heading to \"Hi\"", 'Add a FAQ with "Do you deliver?"', "Remove the testimonials section",
      'Change the heading to "Book a table" and give the section a saffron background', "Change the button so the booking form checks the date", "Make it better"]) assert.notEqual(c(request), "copy-edit", request);
  });

  await check("v3 cells: a copy edit routes to the cheap model only by override, escalates at the requested effort, and runs lower effort only when asked", () => {
    const route = (request, env) => routing.routeStage({ stage: "build", artifact: "website", request, files: 4, projectBytes: 600, effort: "medium", attachments: 0, verification: { compile: true, contrast: true } }, env);
    const HAIKU = "claude-haiku-5-5", copy = "Change the phone number to +387 61 123 456";
    const off = route(copy, {});
    assert.equal(off.class, "copy-edit"); assert.equal(off.model, OPUS); assert.equal(off.effort, "medium"); assert.equal(off.escalation, null);
    assert.equal(route(copy, { MAKEBORNE_MODEL_ROUTING: "on" }).model, OPUS, "nothing routes down without an override or a qualified default");
    const on = route(copy, { MAKEBORNE_MODEL_ROUTING: "on", MAKEBORNE_ROUTE_COPY_EDIT: HAIKU });
    assert.equal(on.model, HAIKU); assert.equal(on.escalation, OPUS); assert.equal(on.escalationEffort, "medium"); assert.ok(on.reasonCodes.includes("ROUTED_DOWN"));
    const low = route(copy, { MAKEBORNE_MODEL_ROUTING: "on", MAKEBORNE_ROUTE_COPY_EDIT: HAIKU, MAKEBORNE_ROUTE_COPY_EDIT_EFFORT: "low" });
    assert.equal(low.effort, "low"); assert.equal(low.escalationEffort, "medium"); assert.ok(low.reasonCodes.includes("EFFORT_LOW"));
    assert.equal(route(copy, { MAKEBORNE_MODEL_ROUTING: "on", MAKEBORNE_ROUTE_COPY_EDIT_EFFORT: "high" }).effort, "medium", "effort is never raised");
    assert.equal(route(copy, { MAKEBORNE_MODEL_ROUTING: "on", MAKEBORNE_ROUTE_COPY_EDIT_EFFORT: "tiny" }).effort, "medium");
    const review = routing.routeStage({ stage: "review", artifact: "website", files: 4, effort: "medium", verification: { compile: true, contrast: true } }, { MAKEBORNE_MODEL_ROUTING: "on", MAKEBORNE_ROUTE_REVIEW_EFFORT: "low" });
    assert.equal(review.model, OPUS); assert.equal(review.effort, "low", "the builder model can run a class at lower effort");
    // Price words are content in a copy edit; security or legal content keeps it on the builder model.
    assert.equal(route("Change the price of a haircut to 25 KM", { MAKEBORNE_MODEL_ROUTING: "on", MAKEBORNE_ROUTE_COPY_EDIT: HAIKU }).model, HAIKU);
    assert.equal(route('Change the password reset text to "Send me a link"', { MAKEBORNE_MODEL_ROUTING: "on", MAKEBORNE_ROUTE_COPY_EDIT: HAIKU }).model, OPUS);
    assert.match(routing.attemptGuidance(on, HAIKU), /copy edit: change only/); assert.equal(routing.attemptGuidance(on, OPUS), "");
    assert.deepEqual(routing.CANDIDATE_CELLS["copy-edit"].map(cell => cell.model), [HAIKU, HAIKU]); assert.deepEqual(routing.QUALIFIED_ROUTES, {});
  });

  await check("v3 copy check end to end: a cheap attempt that misses the named text fails a check no model runs, and the builder model's fix is all the customer pays", async () => {
    const HAIKU = "claude-haiku-5-5", request = 'Replace "Hello" with "Fresh bread daily"';
    const route = routing.routeStage({ stage: "build", artifact: "website", request, files: 4, projectBytes: 600, effort: "light", attachments: 0, verification: { compile: true, contrast: true } },
      { MAKEBORNE_MODEL_ROUTING: "on", MAKEBORNE_ROUTE_COPY_EDIT: HAIKU });
    const wrong = 'export default function App() { return <main><h1>Fresh bread</h1><p>Welcome.</p></main>; }', right = 'export default function App() { return <main><h1>Fresh bread daily</h1><p>Welcome.</p></main>; }';
    const anthropic = provider((model, messages) => editor(model === OPUS ? right : wrong)(model, messages));
    const result = await websiteStage({ route, anthropic, message: request });
    const detail = result.finish.args.p_detail.route, done = result.stream.at(-1);
    assert.deepEqual(detail.attempts.map(item => [item.role, item.model, item.kind]), [["initial", HAIKU, "quality"], ["repair", HAIKU, "quality"], ["escalation", OPUS, "accept"]]);
    const repair = anthropic.calls.find(call => /Repair:/.test(JSON.stringify(call.messages[0])));
    assert.match(JSON.stringify(repair.messages[0]), /Fresh bread daily/, "the repair names the missing text");
    assert.match(JSON.stringify(anthropic.calls[0].messages[0]), /copy edit: change only/, "the cheap model gets its guidance in the request, not the system prompt");
    assert.equal(anthropic.calls.find(call => call.model === OPUS).effort, "low", "the escalation runs at the requested effort (light)");
    assert.equal(result.spend.absorbedMicrousd, microusd(result, HAIKU)); assert.equal(result.finish.args.p_measured_microusd, microusd(result, OPUS));
    assert.equal(done.type, "done");
    assert.equal(result.finish.args.p_candidate.content.websiteSource.files.find(file => file.path === "src/App.tsx").content, right);
    // A correct cheap attempt is accepted on its own, with nothing absorbed.
    const good = await websiteStage({ route, anthropic: provider(editor(right)), message: request });
    assert.deepEqual(good.finish.args.p_detail.route.attempts.map(item => [item.role, item.model, item.kind]), [["initial", HAIKU, "accept"]]);
    assert.equal(good.spend.absorbedMicrousd, 0);
  });

  await check("v4 effort cascade: the builder model at a lower effort escalates once to the requested effort; only the escalation is charged", async () => {
    const env = { MAKEBORNE_MODEL_ROUTING: "on", MAKEBORNE_ROUTE_TARGETED_EDIT_EFFORT: "low" };
    const route = routing.routeStage({ stage: "build", artifact: "website", request: MESSAGE, files: 4, projectBytes: 600, effort: "medium", attachments: 0, verification: { compile: true, contrast: true } }, env);
    assert.equal(route.model, OPUS); assert.equal(route.effort, "low"); assert.equal(route.escalation, OPUS); assert.equal(route.escalationEffort, "medium");
    assert.equal(route.allocation.initialShare, routing.ALLOCATION.routedInitialShare, "the cheaper cell leaves the escalation its share");
    assert.equal(routing.routeStage({ stage: "build", artifact: "website", request: MESSAGE, files: 4, projectBytes: 600, effort: "medium", attachments: 0, verification: { compile: true, contrast: true } }, { MAKEBORNE_MODEL_ROUTING: "on" }).escalation, null, "no cheaper cell, no escalation");
    // Low-effort attempts write broken code (the repair too); the escalation at medium fixes it.
    const anthropic = provider((model, messages, params) => params.output_config?.effort === "medium" ? editor(GOOD)(model, messages) : /Repair:/.test(firstUserText(messages)) ? breaker(BROKEN_OTHER)(model, messages) : breaker(BROKEN)(model, messages));
    const result = await websiteStage({ route, anthropic, effort: "medium" });
    const detail = result.finish.args.p_detail.route;
    // The repair runs inside its 15% share, so it may end out of room ("incomplete") rather than on a failed check; both escalate.
    assert.deepEqual(detail.attempts.map(item => [item.role, item.model]), [["initial", OPUS], ["repair", OPUS], ["escalation", OPUS]]);
    assert.equal(detail.attempts[0].kind, "quality"); assert.ok(["quality", "incomplete"].includes(detail.attempts[1].kind)); assert.equal(detail.attempts[2].kind, "accept");
    const efforts = [...new Set(anthropic.calls.map(call => call.effort))];
    assert.deepEqual(efforts, ["low", "medium"], "low until the escalation, then the requested effort");
    const escalationCalls = anthropic.calls.filter(call => call.effort === "medium").length, costPerCall = result.spend.calls[0].actualMicrousd;
    assert.ok(result.spend.absorbedMicrousd > 0, "the failed low-effort attempts are absorbed");
    assert.equal(result.finish.args.p_measured_microusd, escalationCalls * costPerCall, "the customer pays for the escalation only");
  });

  process.stdout.write(`${passed} model-routing checks passed.\n`);
})().catch(error => { process.stderr.write(`${error.stack}\n`); process.exit(1); });
