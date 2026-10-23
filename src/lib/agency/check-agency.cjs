/* eslint-disable @typescript-eslint/no-require-imports -- Offline agency contract harness: database and provider are in-memory fakes; no network, no paid call. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");

// ---- In-memory stand-in for the operation RPCs (SQL semantics are proven by supabase/check-agency-operations*.sql) ----
let db, rpcLog, failNext = {};
const err = (code, message = code) => ({ data: null, error: { code, message } });
function freshDb() { return { ops: new Map(), runs: new Map(), calls: new Map(), byAction: new Map(), artifactVersion: 3, forbiddenWorkspace: null }; }
function snap(op) {
  const used = [...db.runs.values()].filter(run => run.op === op.id).flatMap(run => [...db.calls.values()].filter(call => call.run === run.id)).reduce((total, call) => total + (call.charged ?? call.bound), 0);
  const reserved = [...db.runs.values()].filter(run => run.op === op.id && run.status === "active").reduce((total, run) => total + run.amount, 0);
  return { id: op.id, revision: op.revision, kind: op.kind, effort: op.effort, authorizedCredits: op.cap, chargedCredits: op.charged, reservedCredits: reserved,
    remainingCredits: Math.max(0, op.cap - op.charged - reserved), maximumAdditionalCredits: op.cancel ? 0 : op.cap, status: op.cancel && !reserved ? "completed" : reserved ? "running" : "active",
    cancelRequested: op.cancel, pendingKind: op.pending, lastVersion: op.version, canContinue: false, recoverable: false, expiresAt: new Date(Date.now() + 86400000).toISOString(),
    rateMicrousd: op.rate, providerRemainingMicrousd: Math.max(0, op.cap * op.rate - used - (op.providerUsedOutside ?? 0)) };
}
const lastResult = op => [...db.runs.values()].filter(run => run.op === op.id && run.result).at(-1)?.result ?? null;
const status = op => ({ operation: snap(op), result: lastResult(op), recovery: null });
const handlers = {
  makeborne_agency_task_scope(a) {
    if (a.p_artifact === db.forbiddenArtifact) return err("42501");
    if (a.p_inputs.some(input => input.sha256 === "f".repeat(64))) return err("PT409");
    return { data: { workspaceId: W, projectId: P, clientId: db.clientId ?? null, artifactId: a.p_artifact, currentVersion: db.artifactVersion,
      inputs: a.p_inputs.map(input => ({ kind: input.kind, id: input.id, sha256: input.sha256 ?? "c".repeat(64), version: input.version ?? null, projectId: P })) }, error: null };
  },
  makeborne_ai_operation_create(a) {
    if (a.p_workspace === db.forbiddenWorkspace || a.p_actor !== ACTOR) return err("42501");
    const key = `${a.p_actor}:${a.p_action}`;
    let op = db.byAction.get(key);
    if (op && (op.hash !== a.p_input_hash || JSON.stringify(op.context) !== JSON.stringify(a.p_context))) return err("PT409");
    if (!op) {
      if (a.p_initial_version !== db.artifactVersion) return err("PT409");
      op = { id: randomUUID(), actor: a.p_actor, kind: a.p_kind, effort: a.p_effort, hash: a.p_input_hash, context: a.p_context, cap: a.p_credit_cap, rate: a.p_rate_microusd,
        charged: 0, revision: 1, cancel: false, pending: null, version: a.p_initial_version, providerUsedOutside: db.nextOutside ?? 0 };
      db.ops.set(op.id, op); db.byAction.set(key, op);
    }
    return { data: snap(op), error: null };
  },
  makeborne_ai_operation_begin(a) {
    const op = db.ops.get(a.p_operation);
    if (!op || op.actor !== a.p_actor) return err("P0002");
    if (a.p_kind !== op.kind) return err("PT409");
    const existing = [...db.runs.values()].find(run => run.op === op.id && run.step === a.p_step);
    if (existing) return { data: { ...status(op), replayed: true, result: existing.result, run: runJson(existing) }, error: null };
    if (op.cancel) return err("PT409");
    if ([...db.runs.values()].some(run => run.op === op.id && run.status === "active")) return { data: { operation: snap(op), error: { code: "OPERATION_BUSY" } }, error: null };
    if (a.p_expected_version !== op.version || db.artifactVersion !== a.p_expected_version) return err("PT409");
    const run = { id: randomUUID(), op: op.id, step: a.p_step, fence: randomUUID(), amount: Math.min(a.p_stage_cap, op.cap - op.charged), status: "active", result: null, exempt: db.exempt ?? false,
      expiresAt: Date.now() + (db.leaseMs ?? 900000) };
    run.reference = `operation:${run.id}`;
    db.runs.set(run.id, run);
    return { data: { ...status(op), requestContext: op.context, replayed: false, run: runJson(run) }, error: null };
  },
  makeborne_ai_operation_provider_begin(a) {
    const run = db.runs.get(a.p_run), op = run && db.ops.get(run.op);
    if (!run) return err("P0002");
    if (op.cancel) return err("MB499");
    if (a.p_fence !== run.fence) return err("PT409");
    if (db.calls.has(a.p_call)) return { data: { started: false, replayed: true }, error: null };
    if (run.status !== "active") return err("PT409");
    db.calls.set(a.p_call, { id: a.p_call, run: run.id, bound: a.p_bound, provider: a.p_provider, model: a.p_model, status: "open", charged: null });
    return { data: { started: true }, error: null };
  },
  makeborne_provider_call_finish(a) {
    const call = db.calls.get(a.p_call);
    call.status = a.p_actual === null ? "uncertain" : "settled";
    call.charged = a.p_actual === null ? call.bound : a.p_actual;
    return { data: {}, error: null };
  },
  makeborne_ai_operation_heartbeat(a) {
    const run = db.runs.get(a.p_run), op = run && db.ops.get(run.op);
    if (!run || op.actor !== a.p_actor) return err("P0002");
    if (a.p_fence !== run.fence) return err("PT409");
    if (run.status !== "active" || op.cancel) return { data: { active: false, cancelRequested: op.cancel, status: run.status, expiresAt: new Date(run.expiresAt).toISOString(), renewed: false }, error: null };
    run.progress = a.p_progress ?? run.progress;
    const renewed = Boolean(a.p_renew && run.exempt);
    if (renewed) run.expiresAt = Date.now() + 900000;
    return { data: { active: true, cancelRequested: false, status: "active", expiresAt: new Date(run.expiresAt).toISOString(), renewed }, error: null };
  },
  makeborne_ai_operation_read(a) {
    const op = a.p_operation ? db.ops.get(a.p_operation) : null;
    if (a.p_workspace === db.forbiddenWorkspace) return err("42501");
    if (!op || op.actor !== a.p_actor) return err("P0002");
    return { data: { ...status(op), requestContext: op.context, runs: [] }, error: null };
  },
  makeborne_ai_operation_progress(a) {
    if (a.p_workspace === db.forbiddenWorkspace) return err("42501");
    const op = db.ops.get(a.p_operation);
    if (!op || op.actor !== a.p_actor) return err("P0002");
    const runs = [...db.runs.values()].filter(run => run.op === op.id);
    const calls = runs.flatMap(run => [...db.calls.values()].filter(call => call.run === run.id));
    return { data: { operation: snap(op), runs: runs.map(run => ({ id: run.id, kind: op.kind, status: run.status, outcome: run.outcome ?? null, heartbeatAt: null, progress: run.progress ?? null,
      expiresAt: new Date(run.expiresAt).toISOString(), cancelRequested: op.cancel })),
      calls: { inProgress: calls.filter(c => c.status === "open").length, uncertain: calls.filter(c => c.status === "uncertain").length, settled: calls.filter(c => c.status === "settled").length } }, error: null };
  },
  makeborne_ai_operation_cancel(a) {
    const op = db.ops.get(a.p_operation);
    if (!op || op.actor !== a.p_actor) return err("P0002");
    op.cancel = true; op.revision++;
    return { data: status(op), error: null };
  },
  makeborne_ai_operation_finish(a) {
    const run = db.runs.get(a.p_run), op = run && db.ops.get(run.op);
    if (!run) return err("P0002");
    if (a.p_fence !== run.fence) return err("PT409");
    if (run.status === "finished") return { data: { ...status(op), charged: run.charged, outcome: run.outcome, result: run.result, replayed: true }, error: null };
    let outcome = a.p_outcome, charged = Math.min(Math.ceil(a.p_measured_microusd / op.rate), run.amount), result = { ...a.p_detail };
    if (op.cancel) outcome = "cancelled";
    else if (a.p_outcome === "failed") charged = 0;
    else if (a.p_outcome === "saved") {
      if (db.artifactVersion !== a.p_candidate.expectedVersion) { outcome = "conflict"; charged = 0; result = { code: "REVISION_CONFLICT", saved: false }; }
      else { db.artifactVersion++; op.version = db.artifactVersion; result = { ...result, version: db.artifactVersion, changed: true }; }
    } else if (a.p_outcome === "result") result = { ...result, data: a.p_candidate.data, basedOnVersion: op.version, persisted: true, finished: true };
    if (failNext.finishAfterCommit) { failNext.finishAfterCommit = false; Object.assign(run, { status: "finished", outcome, charged, result: { ...result, charged, runId: run.id } }); op.charged += charged; return err("XX000"); }
    Object.assign(run, { status: "finished", outcome, charged, result: { ...result, charged, runId: run.id }, measured: a.p_measured_microusd, detail: a.p_detail, candidate: a.p_candidate });
    op.charged += charged;
    return { data: { ...status(op), charged, outcome, result: run.result, replayed: false }, error: null };
  },
};
function runJson(run) { return { id: run.id, reference: run.reference, fence: run.fence, amount: run.amount, exempt: run.exempt, reservedAt: Date.now(), expiresAt: run.expiresAt, status: run.status }; }
function rpc(name, args) {
  rpcLog.push({ name, args });
  const handler = handlers[name];
  if (!handler) throw Error(`Unexpected RPC ${name}`);
  return handler(args);
}

const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  if (name.startsWith("@/")) return load.call(this, path.join(__dirname, "../..", name.slice(2)), parent, main);
  if (/(^|\/)billing\/database$/.test(name)) return { billingDatabase: () => ({ rpc: (n, a) => { const result = Promise.resolve().then(() => rpc(n, a)); result.abortSignal = () => result; return result; } }) };
  if (/(^|\/)credits\/server$/.test(name)) return { HOLD_LIFETIME_MS: 900000 };
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);

const { z } = require("zod");
const task = require("./task.ts"), loop = require("./loop.ts"), specialist = require("./specialist.ts"), run = require("./run.ts"), port = require("./model-port.ts");
const server = require("../builder/operation-server.ts");
const knowledgeTask = require("../knowledge/task-context.ts"), knowledgeContext = require("../knowledge/context.ts");
const { RunSpend, SpendError, memoryGate } = require("../ai/run-spend.ts");
const { aiCostUsdPerCredit } = require("../builder/pricing.ts");
const RATE = Math.round(aiCostUsdPerCredit() * 1_000_000);

const ACTOR = randomUUID(), W = randomUUID(), P = randomUUID(), ARTIFACT = randomUUID(), SOURCE = randomUUID();
const qualified = Object.freeze([Object.freeze({ profile: "standard", model: "claude-sonnet-5-5", effort: "medium", intensity: "medium", maxOutputTokens: 4000, maxTurns: 6,
  qualifiedKinds: Object.freeze(["research", "ingest", "image_edit", "data_report", "independent_review"]), evidence: "offline fixture" })]);
const body = (extra = {}) => ({ artifactId: ARTIFACT, actionKey: randomUUID(), stepKey: randomUUID(), kind: "research", objective: "Summarise the approved brochure for the About page.",
  inputs: [{ kind: "source", id: SOURCE, sha256: "a".repeat(64) }], permittedTools: ["read_input"], settings: "standard", ceilingCredits: 20, expectedRevision: 3, ...extra });
const resolve = (extra = {}, deps = {}) => task.resolveAgencyTask(ACTOR, body(extra), { scope: server.resolveAgencyScope, settings: qualified, rateMicrousd: RATE, ...deps });
const Result = z.object({ summary: z.string().min(1), facts: z.array(z.string()).max(10) }).strict();
const lead = { system: "You are the lead.", result: Result, resultDescription: "Submit the summary." };
let toolRuns = 0;
const tools = { read_input: Object.freeze({ name: "read_input", effect: "read", description: "Read an input.", args: z.object({ index: z.number().int().min(0) }).strict(),
  async run(args, context) { toolRuns++; return context.readInput(args.index); } }) };
const deps = (model, extra = {}) => ({ model, tools, readInput: async index => `input ${index} text`, platformDeadline: Date.now() + 280000, pollMs: 15, heartbeatMs: 25, ...extra });
/** A fake model turn: reserves its bound through the given RunSpend, then records a cost (null = unknown). */
function scripted(turns, options = {}) {
  const seen = [];
  const model = async request => {
    seen.push({ ...request, last: request.messages.at(-1) });
    const step = turns[seen.length - 1];
    if (!step) throw Error("Unscripted model turn");
    const ticket = await request.spend.begin("anthropic", "claude-sonnet-5-5", step.bound ?? 30000);
    if (step.wait) await step.wait(request);
    if (step.throws) { await request.spend.finish(ticket, { actualMicrousd: null, partialMicrousd: step.partial ?? 0 }); throw step.throws; }
    await request.spend.finish(ticket, { actualMicrousd: step.cost ?? 10000 });
    return { content: step.content, stopReason: "tool_use" };
  };
  model.seen = seen; Object.assign(model, options);
  return model;
}
const use = (name, input) => ({ type: "tool_use", id: `toolu_${randomUUID().slice(0, 8)}`, name, input });
const names = () => rpcLog.map(entry => entry.name);
const finishCall = () => rpcLog.find(entry => entry.name === "makeborne_ai_operation_finish");
let passed = 0, finished = false;
// Worker timers are unref'd (as in production); keep the harness alive and treat a silent drain as failure.
const keepAlive = setInterval(() => {}, 1000);
process.on("exit", code => { if (!finished && code === 0) { console.error("Harness ended before all checks ran."); process.exitCode = 1; } });
async function check(name, fn) { db = freshDb(); rpcLog = []; failNext = {}; toolRuns = 0; await fn(); passed++; console.log(`PASS ${name}`); }
async function rejects(promise, code) { await assert.rejects(promise, error => { assert.equal(error.code, code); return true; }); }

(async () => {
  await check("envelope: browser cannot set workspace, client, project or actor; unknown fields refused", async () => {
    for (const extra of [{ workspaceId: W }, { actorId: randomUUID() }, { clientId: randomUUID() }, { projectId: P }, { model: "claude-opus-5-5" }])
      await rejects(resolve(extra), "AGENCY_TASK_INVALID");
    await rejects(task.resolveAgencyTask("not-a-user", body(), { scope: server.resolveAgencyScope, settings: qualified, rateMicrousd: RATE }), "AGENCY_UNAUTHENTICATED");
    assert.equal(rpcLog.length, 0, "refused before any database call");
    const resolved = await resolve();
    assert.deepEqual([resolved.actorId, resolved.workspaceId, resolved.projectId, resolved.clientId], [ACTOR, W, P, null], "scope from the authenticated actor and SQL");
    assert.deepEqual(rpcLog.map(entry => entry.args.p_actor), [ACTOR]);
  });

  await check("qualified settings only: shipped registry qualifies only the kinds with a recorded run; unknown profile and unpriced model fail closed", async () => {
    // Proposed after the paid qualification of 2026-10-24: research, data_report, image_edit and (after the re-run) independent_review; ingest stays refused.
    assert.deepEqual(task.AGENCY_SETTINGS.flatMap(setting => setting.qualifiedKinds).sort(), ["data_report", "image_edit", "independent_review", "research"]);
    assert.ok(task.AGENCY_SETTINGS.every(setting => /agency-qualification-20261024/.test(setting.evidence)), "each qualified kind names its recorded run");
    for (const kind of ["ingest"])
      await rejects(task.resolveAgencyTask(ACTOR, body({ kind }), { scope: server.resolveAgencyScope, rateMicrousd: RATE }), "AGENCY_SETTINGS_UNQUALIFIED");
    await rejects(task.resolveAgencyTask(ACTOR, body(), { scope: server.resolveAgencyScope, settings: [], rateMicrousd: RATE }), "AGENCY_SETTINGS_UNQUALIFIED");
    await rejects(resolve({ settings: "turbo" }), "AGENCY_SETTINGS_UNQUALIFIED");
    await rejects(resolve({}, { settings: [{ ...qualified[0], model: "mystery-model-9" }] }), "AGENCY_SETTINGS_UNQUALIFIED");
    await rejects(resolve({ kind: "data_report" }, { settings: [{ ...qualified[0], qualifiedKinds: ["research"] }] }), "AGENCY_SETTINGS_UNQUALIFIED");
    assert.equal(rpcLog.length, 0);
  });

  await check("tools and ceilings: unpermitted, duplicate and reserved tool names refused; ceiling bounded by kind policy", async () => {
    await rejects(resolve({ permittedTools: ["publish_site"] }), "AGENCY_TOOL_REFUSED");
    await rejects(resolve({ permittedTools: ["read_input", "read_input"] }), "AGENCY_TOOL_REFUSED");
    await rejects(resolve({ permittedTools: ["delegate"] }), "AGENCY_TOOL_REFUSED");
    await rejects(resolve({ permittedTools: ["submit_result"] }), "AGENCY_TOOL_REFUSED");
    await rejects(resolve({ kind: "ingest", ceilingCredits: 41 }), "AGENCY_CEILING_REFUSED");
    const resolved = await resolve({ ceilingCredits: 20 });
    assert.deepEqual(resolved.ceilings, { customerCredits: 20, providerMicrousd: 20 * RATE });
  });

  await check("cross-workspace and changed inputs: SQL refusals map to forbidden/changed before any operation", async () => {
    db.forbiddenArtifact = ARTIFACT;
    await rejects(resolve(), "AGENCY_SCOPE_FORBIDDEN");
    db.forbiddenArtifact = null;
    await rejects(resolve({ inputs: [{ kind: "source", id: SOURCE, sha256: "f".repeat(64) }] }), "AGENCY_INPUT_CHANGED");
    assert.deepEqual(names(), ["makeborne_agency_task_scope", "makeborne_agency_task_scope"]);
    // A begun task never reads or stops another workspace's operation.
    const resolved = await resolve();
    const outcome = await run.runAgencyTask(resolved, lead, deps(scripted([{ content: [use("submit_result", { summary: "S", facts: [] })] }])));
    db.forbiddenWorkspace = W;
    await rejects(run.readAgencyTask({ actor: ACTOR, workspaceId: W, artifactId: ARTIFACT, id: outcome.status.operation.id }), "OPERATION_FORBIDDEN");
    await rejects(server.readOperationProgress({ actor: ACTOR, workspaceId: W, artifactId: ARTIFACT, id: outcome.status.operation.id }), "OPERATION_FORBIDDEN");
    await rejects(server.beginAgencyOperation({ actor: ACTOR, workspaceId: W, artifactId: ARTIFACT, kind: "research", effort: "medium", expectedVersion: 3, ceiling: 20,
      providerCapMicrousd: 20 * RATE, context: {}, digest: "a".repeat(64), actionKey: randomUUID(), stepKey: randomUUID() }), "OPERATION_FORBIDDEN");
  });

  await check("stale revision: refused before any operation; a stale change is never applied or charged", async () => {
    await rejects(resolve({ expectedRevision: 2 }), "AGENCY_STALE_REVISION");
    assert.deepEqual(names(), ["makeborne_agency_task_scope"]);
    const resolved = await resolve({ kind: "image_edit" });
    const apply = result => ({ expectedVersion: resolved.expectedRevision, content: { summary: result.summary }, style: {}, assetIds: [], summary: "Edited" });
    const model = scripted([{ wait: async () => { db.artifactVersion = 4; }, content: [use("submit_result", { summary: "S", facts: [] })] }]);
    const outcome = await run.runAgencyTask(resolved, { ...lead, apply }, deps(model));
    assert.equal(finishCall().args.p_outcome, "saved");
    assert.equal(finishCall().args.p_candidate.expectedVersion, 3, "the candidate carries the expected revision");
    assert.deepEqual([outcome.outcome, outcome.charged], ["conflict", 0]);
    assert.match(outcome.message, /nothing was applied/);
  });

  await check("happy path: one operation step, paid turns reserved through the run, typed data persisted with confirmed cost", async () => {
    const resolved = await resolve();
    const model = scripted([{ cost: 12000, content: [use("read_input", { index: 0 })] }, { cost: 9000, content: [use("submit_result", { summary: "About copy", facts: ["Founded 1998"] })] }]);
    const outcome = await run.runAgencyTask(resolved, lead, deps(model));
    const flow = names().filter(name => !/read$|heartbeat$|progress$/.test(name));
    assert.deepEqual(flow, ["makeborne_agency_task_scope", "makeborne_ai_operation_create", "makeborne_ai_operation_begin", "makeborne_ai_operation_provider_begin",
      "makeborne_provider_call_finish", "makeborne_ai_operation_provider_begin", "makeborne_provider_call_finish", "makeborne_ai_operation_finish"]);
    const create = rpcLog.find(entry => entry.name === "makeborne_ai_operation_create").args;
    assert.deepEqual([create.p_kind, create.p_effort, create.p_credit_cap, create.p_initial_version, create.p_workspace], ["research", "medium", 20, 3, W]);
    assert.deepEqual(create.p_context.task.inputs, resolved.inputs, "SQL receives exactly the verified inputs");
    assert.equal(JSON.stringify(create.p_context).includes("claude"), false, "no model name in the stored task context");
    const finish = finishCall().args;
    assert.deepEqual([finish.p_outcome, finish.p_measured_microusd, finish.p_candidate], ["result", 21000, { data: { summary: "About copy", facts: ["Founded 1998"] } }]);
    assert.deepEqual([outcome.outcome, outcome.charged, outcome.replayed], ["result", Math.ceil(21000 / RATE), false]);
    assert.equal(outcome.status.result.data.summary, "About copy", "the stored result keeps its typed data");
    assert.equal(toolRuns, 1);
    assert.equal(model.seen[0].tools.some(tool => tool.name === "delegate"), false, "a minor task gets no specialists");
  });

  await check("duplicate request: same action and step returns the stored outcome with no model call or second charge", async () => {
    const resolved = await resolve();
    const first = await run.runAgencyTask(resolved, lead, deps(scripted([{ content: [use("submit_result", { summary: "Once", facts: [] })] }])));
    rpcLog = [];
    const never = scripted([]);
    const again = await run.runAgencyTask(resolved, lead, deps(never));
    assert.equal(never.seen.length, 0, "no model call");
    assert.deepEqual(names().filter(name => /provider|finish/.test(name)), [], "no provider attempt or finish");
    assert.deepEqual([again.replayed, again.outcome, again.charged, again.status.result.data.summary], [true, "result", first.charged, "Once"]);
    // A different request under the same action key is a conflict, not a new budget.
    await rejects(run.runAgencyTask({ ...resolved, objective: "Something else entirely, with a different digest." }, lead, deps(scripted([]))), "OPERATION_CONFLICT");
  });

  await check("concurrent reservations: parallel steps on one operation -> one run, the other is busy and makes no call", async () => {
    const resolved = await resolve();
    let release; const gate = new Promise(resolveGate => { release = resolveGate; });
    const slow = scripted([{ wait: () => gate, content: [use("submit_result", { summary: "A", facts: [] })] }]);
    const other = scripted([{ content: [use("submit_result", { summary: "B", facts: [] })] }]);
    const first = run.runAgencyTask(resolved, lead, deps(slow));
    while (!slow.seen.length) await new Promise(r => setTimeout(r, 2));
    await rejects(run.runAgencyTask({ ...resolved, stepKey: randomUUID() }, lead, deps(other)), "OPERATION_BUSY");
    assert.equal(other.seen.length, 0);
    release();
    assert.equal((await first).outcome, "result");
    assert.equal([...db.runs.values()].length, 1);
  });

  await check("invalid tool arguments and unpermitted tools are refused before the tool runs; repeated misuse ends the step uncharged", async () => {
    const resolved = await resolve();
    const model = scripted([
      { content: [use("read_input", { index: "zero" })] },
      { content: [use("publish_site", { now: true })] },
      { content: [use("read_input", { index: 0, extra: 1 })] },
      { content: [use("submit_result", { summary: "never" })] },
    ]);
    const outcome = await run.runAgencyTask(resolved, lead, deps(model));
    assert.equal(toolRuns, 0, "no tool executed");
    assert.equal(model.seen.length, 3, "stopped after the third invalid call");
    assert.deepEqual([finishCall().args.p_outcome, finishCall().args.p_detail.code, outcome.charged], ["failed", "INVALID_TOOL_ARGUMENTS", 0]);
    const refusal = model.seen[1].last.content[0];
    assert.equal(refusal.is_error, true);
  });

  await check("typed result: an invalid result is refused and corrected; extra keys never pass", async () => {
    const resolved = await resolve();
    const model = scripted([{ content: [use("submit_result", { summary: "", facts: [], secret: 1 })] }, { content: [use("submit_result", { summary: "Fixed", facts: [] })] }]);
    const outcome = await run.runAgencyTask(resolved, lead, deps(model));
    assert.equal(model.seen[1].last.content[0].is_error, true);
    assert.deepEqual([outcome.outcome, finishCall().args.p_candidate.data], ["result", { summary: "Fixed", facts: [] }]);
  });

  await check("uncertain usage: the bound stays provider exposure, only confirmed cost is charged, the attempt id is kept and never retried", async () => {
    const resolved = await resolve();
    const timeout = new SpendError("HOLD_EXPIRED", "The call reached the run's time limit and was stopped.");
    const model = scripted([{ cost: 6000, content: [use("read_input", { index: 0 })] }, { bound: 50000, partial: 4000, throws: timeout }, { content: [] }]);
    const outcome = await run.runAgencyTask(resolved, lead, deps(model));
    assert.equal(model.seen.length, 2, "no automatic retry after an uncertain attempt");
    const finish = finishCall().args;
    assert.deepEqual([finish.p_outcome, finish.p_measured_microusd], ["incomplete", 10000], "customer pays confirmed 6,000 + partial 4,000 only");
    assert.equal(finish.p_detail.uncertainMicrousd, 46000, "uncertain remainder recorded");
    assert.equal(finish.p_detail.providerMicrousd, 56000, "provider exposure includes the full bound");
    const uncertainCall = [...db.calls.values()].find(call => call.status === "uncertain");
    assert.deepEqual(finish.p_detail.uncertainCalls, [uncertainCall.id], "the attempt id is persisted for reconciliation");
    assert.equal(outcome.outcome, "incomplete");
  });

  await check("model port: one attempt per turn (retries off), unknown usage recorded at the bound, unpriced model fails before any count or call", async () => {
    const attempts = [];
    const client = { beta: { messages: {
      countTokens: async () => ({ input_tokens: 1000 }),
      stream(params) { attempts.push(params);
        const error = Object.assign(new Error("upstream 503"), { status: 503 });
        return { on() { return this; }, async finalMessage() { throw error; }, currentMessage: undefined }; },
    } } };
    const spend = new RunSpend({ run: "operation:x", gate: memoryGate(), providerCapMicrousd: 2_000_000, customerCapMicrousd: null, deadline: Date.now() + 200000 });
    const model = port.anthropicModelPort(client, qualified[0]);
    await assert.rejects(model({ system: "s", messages: [{ role: "user", content: "hi" }], tools: [], maxOutputTokens: 1000, spend, signal: new AbortController().signal }));
    assert.equal(attempts.length, 1, "a 503 is not retried by the agency port");
    assert.equal(spend.calls.length, 1); assert.equal(spend.calls[0].actualMicrousd, null); assert.equal(spend.uncertainMicrousd, spend.calls[0].boundMicrousd);
    assert.equal(spend.confirmedMicrousd, 0, "nothing confirmed, so nothing chargeable");
    let counted = false;
    const unpriced = port.anthropicModelPort({ beta: { messages: { countTokens: async () => { counted = true; return { input_tokens: 1 }; }, stream() { throw Error("must not stream"); } } } }, { ...qualified[0], model: "mystery-model-9" });
    const outcome = await loop.runTaskLoop({ system: "s", prompt: "p", tools: [], result: Result, resultDescription: "r", maxTurns: 2, maxOutputTokens: 100, spend, signal: new AbortController().signal,
      model: unpriced, context: { readInput: async () => "", signal: new AbortController().signal, spend } });
    assert.deepEqual([outcome.ok, outcome.code, counted], [false, "UNSUPPORTED_CONFIGURATION", false]);
    // A reply whose usage cannot be priced (another model answered) is recorded at its full bound and ends the step.
    const other = { beta: { messages: { countTokens: async () => ({ input_tokens: 1000 }),
      stream() { return { on() { return this; }, async finalMessage() { return { model: "claude-unknown-9", usage: { input_tokens: 1000, output_tokens: 10 }, content: [], stop_reason: "end_turn" }; } }; } } } };
    const fresh = new RunSpend({ run: "operation:y", gate: memoryGate(), providerCapMicrousd: 2_000_000, customerCapMicrousd: null, deadline: Date.now() + 200000 });
    const unpricedReply = await loop.runTaskLoop({ system: "s", prompt: "p", tools: [], result: Result, resultDescription: "r", maxTurns: 2, maxOutputTokens: 1000, spend: fresh,
      signal: new AbortController().signal, model: port.anthropicModelPort(other, qualified[0]), context: { readInput: async () => "", signal: new AbortController().signal, spend: fresh } });
    assert.deepEqual([unpricedReply.code, fresh.calls.length, fresh.confirmedMicrousd, fresh.uncertainMicrousd], ["UNSUPPORTED_CONFIGURATION", 1, 0, fresh.calls[0].boundMicrousd]);
  });

  await check("crash/retry boundary: a replayed expired step makes no call; a new step gets only the operation's remaining provider allowance", async () => {
    const resolved = await resolve();
    db.leaseMs = 900000;
    // First worker dies mid-call: its attempt stays open (counted at its bound) and its run expires.
    const dying = scripted([{ wait: () => new Promise(() => {}), content: [] }]);
    void run.runAgencyTask(resolved, lead, deps(dying, { pollMs: 100000, heartbeatMs: 100000 }));
    while (!dying.seen.length) await new Promise(r => setTimeout(r, 2));
    const crashed = [...db.runs.values()][0];
    Object.assign(crashed, { status: "expired", result: { runId: crashed.id, code: "OPERATION_EXPIRED", message: "The step expired.", expired: true, charged: 0 } });
    rpcLog = [];
    const retry = scripted([]);
    const replay = await run.runAgencyTask(resolved, lead, deps(retry));
    assert.deepEqual([replay.replayed, replay.outcome, replay.charged, retry.seen.length], [true, "expired", 0, 0], "same step: recorded expiry, no relaunch");
    const next = { ...resolved, stepKey: randomUUID() };
    const started = await server.beginAgencyOperation({ actor: ACTOR, workspaceId: W, artifactId: ARTIFACT, kind: "research", effort: "medium", expectedVersion: 3, ceiling: 20,
      providerCapMicrousd: 20 * RATE, context: task.taskContext(next), digest: task.taskDigest(next), actionKey: next.actionKey, stepKey: next.stepKey });
    const spend = server.createOperationSpend(started.run, Date.now() + 280000);
    assert.equal(spend.allowanceMicrousd, Math.min(20 * RATE - 30000, started.run.hold.amount * RATE), "the open attempt's bound is not handed out again");
  });

  await check("expired hold: no call starts in the last 30 seconds; the step ends incomplete with nothing charged", async () => {
    const resolved = await resolve();
    db.leaseMs = 100000; // inside SETTLEMENT_WINDOW + CLOCK_SKEW + 30 s
    const model = scripted([{ content: [use("submit_result", { summary: "late", facts: [] })] }]);
    const outcome = await run.runAgencyTask(resolved, lead, deps(model));
    assert.equal(names().includes("makeborne_ai_operation_provider_begin"), false, "no paid attempt");
    assert.deepEqual([finishCall().args.p_outcome, finishCall().args.p_detail.code, outcome.charged], ["incomplete", "HOLD_EXPIRED", 0]);
  });

  await check("cancellation: Stop during a call ends the step, no new paid call or tool action, confirmed cost only, truthful message", async () => {
    const resolved = await resolve({ objective: "x".repeat(400) });
    const model = scripted([{ cost: 15000, wait: async request => { const op = [...db.ops.values()][0]; op.cancel = true; await new Promise(r => request.signal.addEventListener("abort", r, { once: true })); },
      content: [use("read_input", { index: 0 })] }, { content: [use("submit_result", { summary: "never", facts: [] })] }]);
    const outcome = await run.runAgencyTask(resolved, lead, deps(model));
    assert.equal(model.seen.length, 1, "no further model turn after Stop");
    assert.equal(toolRuns, 0, "the tool requested by the in-flight reply did not run");
    assert.deepEqual([finishCall().args.p_outcome, finishCall().args.p_measured_microusd, outcome.outcome, outcome.charged], ["failed", 15000, "cancelled", Math.ceil(15000 / RATE)]);
    // The SQL gate refuses a paid attempt after Stop even if the poll has not noticed yet.
    const spendRun = [...db.runs.values()][0];
    db.runs.set(spendRun.id, { ...spendRun, status: "active" });
    const spend = server.createOperationSpend({ actor: ACTOR, workspaceId: W, artifactId: ARTIFACT, id: spendRun.id, fence: spendRun.fence, hold: { userId: ACTOR, reference: spendRun.reference, amount: 20, exempt: false, reservedAt: Date.now() },
      operation: null, rateMicrousd: RATE, providerAllowanceMicrousd: 600000, expiresAt: Date.now() + 900000 }, Date.now() + 280000);
    await rejects(spend.begin("anthropic", "claude-sonnet-5-5", 1000), "CANCELLED");
    assert.equal(spend.stopped, "CANCELLED");
  });

  await check("Stop with a call still in flight: reported truthfully; reconnect shows recorded state and never relaunches", async () => {
    const resolved = await resolve();
    let release; const inFlight = new Promise(r => { release = r; });
    const model = scripted([{ wait: () => inFlight, content: [use("submit_result", { summary: "late", facts: [] })] }]);
    const running = run.runAgencyTask(resolved, lead, deps(model, { pollMs: 100000, heartbeatMs: 100000 }));
    while (!model.seen.length) await new Promise(r => setTimeout(r, 2));
    const id = [...db.ops.values()][0].id;
    const stopped = await run.stopAgencyTask({ actor: ACTOR, workspaceId: W, artifactId: ARTIFACT, id });
    assert.equal(stopped.inProgressCalls, 1);
    assert.equal(stopped.message, "Stopped. No new work will start. A step that was already running will finish or time out; you won't be charged beyond its confirmed cost.");
    rpcLog = [];
    const reconnect = await run.readAgencyTask({ actor: ACTOR, workspaceId: W, artifactId: ARTIFACT, id });
    assert.deepEqual(names(), ["makeborne_ai_operation_read", "makeborne_ai_operation_progress"], "reconnect only reads");
    assert.equal(reconnect.message, stopped.message);
    release();
    const outcome = await running;
    assert.equal(outcome.outcome, "cancelled");
    const after = await run.readAgencyTask({ actor: ACTOR, workspaceId: W, artifactId: ARTIFACT, id });
    assert.deepEqual([after.inProgressCalls, after.message], [0, "Stopped. You were charged only for confirmed work."]);
    for (const text of [stopped.message, after.message, ...Object.values(task.publicTaskView(resolved)).map(String)]) assert.equal(/claude|anthropic|opus|sonnet|haiku|openai/i.test(text), false);
  });

  await check("draft tools check Stop durably before acting", async () => {
    const resolved = await resolve();
    let drafted = 0;
    const draftTool = Object.freeze({ name: "read_input", effect: "draft", description: "Draft.", args: z.object({ index: z.number().int() }).strict(), async run() { drafted++; return "draft"; } });
    const model = scripted([{ wait: async () => { [...db.ops.values()][0].cancel = true; }, content: [use("read_input", { index: 0 })] }]);
    const outcome = await run.runAgencyTask(resolved, lead, deps(model, { tools: { read_input: draftTool }, pollMs: 100000, heartbeatMs: 100000 }));
    assert.equal(drafted, 0, "the durable heartbeat refused the action after Stop");
    assert.equal(outcome.outcome, "cancelled");
  });

  await check("heartbeat: progress recorded; an exempt lease renewal extends the in-process deadline; a paying run's does not", async () => {
    db.exempt = true;
    const resolved = await resolve();
    let deadlines = [];
    const model = scripted([{ wait: async request => { deadlines.push(request.spend.deadline); await new Promise(r => setTimeout(r, 80)); deadlines.push(request.spend.deadline); },
      content: [use("submit_result", { summary: "ok", facts: [] })] }]);
    await run.runAgencyTask(resolved, lead, deps(model, { platformDeadline: Date.now() + 3_600_000 }));
    assert.ok(deadlines[1] > deadlines[0], "renewed lease moved the deadline later");
    assert.ok(rpcLog.some(entry => entry.name === "makeborne_ai_operation_heartbeat" && entry.args.p_progress?.stage === "working"), "durable progress");
    db = freshDb(); rpcLog = []; deadlines = [];
    const paying = await resolve();
    const model2 = scripted([{ wait: async request => { deadlines.push(request.spend.deadline); await new Promise(r => setTimeout(r, 80)); deadlines.push(request.spend.deadline); },
      content: [use("submit_result", { summary: "ok", facts: [] })] }]);
    await run.runAgencyTask(paying, lead, deps(model2, { platformDeadline: Date.now() + 3_600_000 }));
    assert.equal(deadlines[1], deadlines[0]);
  });

  await check("specialist: child spend is capped by the parent's remaining allowance and spends through the same run and fence", async () => {
    const resolved = await resolve({ objective: "Compare the brochure with the current About page in detail. ".repeat(6), inputs: [{ kind: "source", id: SOURCE, sha256: "a".repeat(64) }, { kind: "source", id: randomUUID(), sha256: "b".repeat(64) }] });
    assert.equal(resolved.scale, "standard");
    const Facts = z.object({ facts: z.array(z.string()).max(5) }).strict();
    const spec = Object.freeze({ name: "fact_checker", purpose: "check facts", system: "Check facts.", result: Facts, resultDescription: "Facts.", tools: [], maxTurns: 2, maxOutputTokens: 500,
      capMicrousd: 10_000_000, maxShare: 0.5, maxContextBytes: 4000 });
    let childAllowance;
    const model = async request => {
      if (request.system === "Check facts.") {
        childAllowance = request.spend.allowanceMicrousd;
        const ticket = await request.spend.begin("anthropic", "claude-sonnet-5-5", 20000); await request.spend.finish(ticket, { actualMicrousd: 7000 });
        return { content: [use("submit_result", { facts: ["Founded 1998"] })], stopReason: "tool_use" };
      }
      const turn = model.lead++;
      const ticket = await request.spend.begin("anthropic", "claude-sonnet-5-5", 30000); await request.spend.finish(ticket, { actualMicrousd: 5000 });
      if (turn === 0) { assert.ok(request.tools.some(tool => tool.name === "delegate"), "standard research may delegate"); return { content: [use("delegate", { specialist: "fact_checker", objective: "Check founding year", inputs: [0] })], stopReason: "tool_use" }; }
      const delegated = JSON.parse(request.messages.at(-1).content[0].content);
      assert.deepEqual(delegated, { ok: true, result: { facts: ["Founded 1998"] } });
      return { content: [use("submit_result", { summary: "Checked", facts: delegated.result.facts })], stopReason: "tool_use" };
    };
    model.lead = 0;
    const outcome = await run.runAgencyTask(resolved, lead, deps(model, { specialists: [spec] }));
    const begins = rpcLog.filter(entry => entry.name === "makeborne_ai_operation_provider_begin");
    assert.equal(begins.length, 3);
    assert.equal(new Set(begins.map(entry => `${entry.args.p_run}:${entry.args.p_fence}`)).size, 1, "every attempt, lead or specialist, uses the same run and fence");
    assert.equal(rpcLog.filter(entry => entry.name === "makeborne_ai_operation_create" || entry.name === "makeborne_ai_operation_begin").length, 2, "no new operation or run for the specialist");
    const parentRemainingAtDelegation = 20 * RATE - 5000; // after the first lead turn
    assert.equal(childAllowance, Math.floor(parentRemainingAtDelegation * 0.5), "child cap = share of parent remaining");
    assert.deepEqual([finishCall().args.p_measured_microusd, outcome.outcome], [17000, "result"], "specialist spend is the parent's spend");
  });

  await check("specialist cannot grant itself tools, take oversized context or exceed the parent; parallel children share one allowance", async () => {
    const parentSpend = new RunSpend({ run: "operation:p", gate: memoryGate(), providerCapMicrousd: 100000, customerCapMicrousd: 80000, deadline: Date.now() + 200000 });
    const base = { name: "s", purpose: "p", system: "s", result: z.object({ ok: z.boolean() }).strict(), resultDescription: "r", tools: [], maxTurns: 2, maxOutputTokens: 100, capMicrousd: 1_000_000, maxShare: 1, maxContextBytes: 100 };
    const parent = { spend: parentSpend, signal: new AbortController().signal, model: async () => { throw Error("no call expected"); }, tools: [], context: { readInput: async () => "", signal: new AbortController().signal, spend: parentSpend } };
    assert.equal((await specialist.runSpecialist({ ...base, tools: ["read_input"] }, { objective: "o", context: [] }, parent)).code, "SPECIALIST_TOOL_REFUSED");
    assert.equal((await specialist.runSpecialist(base, { objective: "o", context: ["x".repeat(200)] }, parent)).code, "SPECIALIST_CONTEXT_TOO_LARGE");
    const child = specialist.childSpend(parentSpend, 10_000_000);
    assert.equal(child.allowanceMicrousd, 80000, "never above the parent's remaining (customer cap)");
    const a = specialist.childSpend(parentSpend, 60000), b = specialist.childSpend(parentSpend, 60000);
    const first = await a.begin("anthropic", "claude-sonnet-5-5", 50000);
    await rejects(b.begin("anthropic", "claude-sonnet-5-5", 50000), "RUN_BUDGET");
    await a.finish(first, { actualMicrousd: null, partialMicrousd: 1000 });
    assert.deepEqual([parentSpend.confirmedMicrousd, parentSpend.uncertainMicrousd, parentSpend.calls.length], [1000, 49000, 1], "the child's uncertain bound is the parent's");
    parentSpend.cancel();
    await rejects(a.begin("anthropic", "claude-sonnet-5-5", 1000), "CANCELLED");
    assert.equal(a.stopped, "CANCELLED");
    const invalid = await specialist.runSpecialist({ ...base, maxShare: 0 }, { objective: "o", context: [] }, parent);
    assert.equal(invalid.code, "SPECIALIST_INVALID");
  });

  await check("finish that may have committed is read back, not guessed", async () => {
    const resolved = await resolve();
    failNext.finishAfterCommit = true;
    const outcome = await run.runAgencyTask(resolved, lead, deps(scripted([{ content: [use("submit_result", { summary: "kept", facts: [] })] }])));
    assert.deepEqual([outcome.outcome, outcome.status.result.data.summary], ["result", "kept"]);
  });

  await check("model-routing compatibility: settlement uses chargeableMicrousd when RunSpend provides it", async () => {
    const spend = new RunSpend({ run: "r", gate: memoryGate(), providerCapMicrousd: 1000, customerCapMicrousd: null, deadline: Date.now() + 100000 });
    spend.confirmedMicrousd = 900;
    assert.equal(run.chargeableMicrousd(spend), 900);
    Object.defineProperty(spend, "chargeableMicrousd", { get: () => 400 });
    assert.equal(run.chargeableMicrousd(spend), 400);
    assert.equal(createHash("sha256").update("x").digest("hex").length, 64);
  });

  // ---- Integration: stage 3 knowledge in agency steps, stage 2 source choices in the envelope ----
  const CLIENT = randomUUID();
  const fact = (over = {}) => ({ id: randomUUID(), clientId: CLIENT, kind: "observed_fact", key: "price.flat_tyre_repair", label: "Flat tyre repair", valueText: "EUR 45", unit: null, currency: "EUR",
    validFrom: null, validTo: null, observedAt: null, status: "approved", supersedesId: null, conflictGroup: null, uncertainty: null, evidenceState: "live", revision: 2, trust: "approved", rank: 0, pending: [],
    evidence: [{ id: randomUUID(), kind: "source", refId: randomUUID(), projectId: P, sha256: "a".repeat(64), extractionVersion: null, locator: {}, quote: "Flat tyre repair: EUR 45", url: null, fetchedAt: null, title: "Price list" }], ...over });
  /** The real knowledgeForTask over a fake retriever and snapshot RPC (SQL semantics: supabase/check-client-knowledge.sql). */
  function knowledgeHook(items, { conflicts = 0 } = {}) {
    const log = { retrievals: 0, snapshots: [], requests: [] };
    let left = conflicts;
    const hook = async request => {
      log.requests.push(request);
      return knowledgeTask.knowledgeForTask(request, {
        retriever: { retrieve: async r => { log.retrievals++; return { epoch: 4, asOf: r.asOf, items: typeof items === "function" ? items(log.retrievals) : items }; } },
        rpc: async (name, args) => { log.snapshots.push({ name, args }); if (left-- > 0) return { data: null, error: { code: "PT409" } }; return { data: { id: randomUUID(), epoch: 5 }, error: null }; },
        onError: error => { throw Object.assign(new Error(error.message), { code: error.code }); },
      });
    };
    hook.log = log;
    return hook;
  }

  await check("knowledge: read once the step's run exists; snapshot carries the operation id; context in the prompt; snapshot id in the step detail", async () => {
    db.clientId = CLIENT;
    const resolved = await resolve();
    assert.equal(resolved.clientId, CLIENT, "client from the SQL scope, never the browser");
    const used = fact();
    const hook = knowledgeHook([used]);
    const model = scripted([{ content: [use("submit_result", { summary: "Repairs from EUR 45", facts: [] })] }]);
    const outcome = await run.runAgencyTask(resolved, lead, deps(model, { knowledge: hook }));
    assert.equal(outcome.outcome, "result");
    const begin = rpcLog.findIndex(entry => entry.name === "makeborne_ai_operation_begin");
    assert.ok(begin >= 0 && hook.log.requests.length === 1, "one knowledge read, after the step began");
    const request = hook.log.requests[0];
    assert.deepEqual([request.actorId, request.workspaceId, request.clientId, request.artifactId, request.operationId, request.purpose],
      [ACTOR, W, CLIENT, ARTIFACT, outcome.status.operation.id, "client research"]);
    const snapshot = hook.log.snapshots.at(-1).args;
    assert.equal(snapshot.p_operation, outcome.status.operation.id, "the snapshot is recorded WITH the operation");
    assert.deepEqual(snapshot.p_items.map(item => [item.factId, item.revision]), [[used.id, 2]]);
    const prompt = model.seen[0].messages[0].content;
    assert.ok(String(prompt).includes(knowledgeContext.KNOWLEDGE_FRAME_OPEN) && String(prompt).includes("EUR 45"), "the bounded knowledge block reaches the lead");
    const finish = finishCall().args;
    assert.equal(finish.p_detail.knowledge.used, 1);
    assert.match(finish.p_detail.knowledge.snapshotId, /^[0-9a-f-]{36}$/);
    assert.equal(finish.p_detail.knowledge.sha256, snapshot.p_context_sha256, "the step detail names the snapshotted context");
    // Kinds whose policy has no knowledge (image_edit, ingest) and tasks without a client never read it.
    const noPolicy = knowledgeHook([used]);
    await run.runAgencyTask(await resolve({ kind: "image_edit" }), lead, deps(scripted([{ content: [use("submit_result", { summary: "S", facts: [] })] }]), { knowledge: noPolicy }));
    db.clientId = null;
    const noClient = knowledgeHook([used]);
    await run.runAgencyTask(await resolve(), lead, deps(scripted([{ content: [use("submit_result", { summary: "S", facts: [] })] }]), { knowledge: noClient }));
    assert.deepEqual([noPolicy.log.requests.length, noClient.log.requests.length], [0, 0]);
    assert.deepEqual(Object.keys(task.AGENCY_KIND_POLICY).filter(kind => task.AGENCY_KIND_POLICY[kind].knowledge), ["research", "independent_review", "data_report"]);
  });

  await check("knowledge: a stale snapshot is retried once; changed twice ends the step failed and uncharged before any model call", async () => {
    db.clientId = CLIENT;
    const used = fact();
    const once = knowledgeHook(attempt => attempt === 1 ? [used] : [{ ...used, revision: 3 }], { conflicts: 1 });
    const model = scripted([{ content: [use("submit_result", { summary: "S", facts: [] })] }]);
    const outcome = await run.runAgencyTask(await resolve(), lead, deps(model, { knowledge: once }));
    assert.deepEqual([outcome.outcome, once.log.retrievals, once.log.snapshots.length], ["result", 2, 2]);
    assert.equal(once.log.snapshots.at(-1).args.p_items[0].revision, 3, "the retry snapshots the revision actually used");
    rpcLog = [];
    const twice = knowledgeHook([used], { conflicts: 2 });
    const silent = scripted([]);
    const failed = await run.runAgencyTask(await resolve(), lead, deps(silent, { knowledge: twice }));
    assert.deepEqual([failed.outcome, failed.charged, failed.code, silent.seen.length], ["failed", 0, "KNOWLEDGE_CHANGED", 0]);
    assert.equal(rpcLog.some(entry => entry.name === "makeborne_ai_operation_provider_begin"), false, "no provider call was opened");
    const unavailable = await run.runAgencyTask(await resolve(), lead, deps(scripted([]), { knowledge: async () => { throw Object.assign(new Error("down"), { code: "KNOWLEDGE_UNAVAILABLE" }); } }));
    assert.deepEqual([unavailable.outcome, unavailable.charged, unavailable.code], ["failed", 0, "KNOWLEDGE_UNAVAILABLE"]);
  });

  await check("knowledge: evidence prepared from an earlier read must match the step's own read; content functions receive it", async () => {
    db.clientId = CLIENT;
    const used = fact();
    const planned = knowledgeContext.buildKnowledgeContext([used]);
    let received = null;
    const content = knowledge => { received = knowledge; return [{ type: "text", text: `facts: ${knowledge?.context.used.length ?? 0}` }]; };
    const same = await run.runAgencyTask(await resolve(), { ...lead, content, knowledgeInContent: true, expectKnowledgeSha256: planned.sha256 },
      deps(scripted([{ content: [use("submit_result", { summary: "S", facts: [] })] }]), { knowledge: knowledgeHook([used]) }));
    assert.equal(same.outcome, "result");
    assert.equal(received.context.sha256, planned.sha256);
    const changed = scripted([]);
    const refused = await run.runAgencyTask(await resolve(), { ...lead, content, knowledgeInContent: true, expectKnowledgeSha256: planned.sha256 },
      deps(changed, { knowledge: knowledgeHook([{ ...used, valueText: "EUR 49" }]) }));
    assert.deepEqual([refused.outcome, refused.charged, refused.code, changed.seen.length], ["failed", 0, "KNOWLEDGE_CHANGED", 0]);
    // Prepared without knowledge (null): a step that now finds approved facts is refused too.
    const appeared = await run.runAgencyTask(await resolve(), { ...lead, expectKnowledgeSha256: null }, deps(scripted([]), { knowledge: knowledgeHook([used]) }));
    assert.equal(appeared.code, "KNOWLEDGE_CHANGED");
  });

  await check("source choices: bound into the task context and digest only when present; a different extraction is a different request", async () => {
    const resolved = await resolve();
    const reference = { sourceId: randomUUID(), sha256: "b".repeat(64), extractionVersion: "ingest-2026-10-23.1", format: "xlsx", status: "complete" };
    assert.equal("sources" in task.taskContext(resolved).task, false, "tasks without files keep their exact context and digest");
    assert.equal(task.bindTaskSources(resolved, { omitted: [], references: [] }), resolved);
    const bound = task.bindTaskSources(resolved, { omitted: [{ name: "old.docx", reason: "unreadable" }], references: [reference] });
    const recorded = task.taskContext(bound).task.sources;
    assert.deepEqual([recorded.omitted, recorded.references], [[{ name: "old.docx", reason: "unreadable" }], [reference]]);
    assert.equal(recorded.sha256, server.sourcesFingerprint({ omitted: [{ name: "old.docx", reason: "unreadable" }], references: [reference] }));
    assert.notEqual(task.taskDigest(bound), task.taskDigest(resolved));
    assert.equal(task.taskDigest(task.bindTaskSources(resolved, { omitted: [{ name: "old.docx", reason: "unreadable" }], references: [reference] })), task.taskDigest(bound), "same choices, same digest");
    assert.notEqual(task.taskDigest(task.bindTaskSources(resolved, { omitted: [{ name: "old.docx", reason: "unreadable" }], references: [{ ...reference, extractionVersion: "ingest-2026-11-01.1" }] })), task.taskDigest(bound));
    // A replay of the same action with a different extraction is refused by the operation (different input digest).
    const first = await run.runAgencyTask(bound, lead, deps(scripted([{ content: [use("submit_result", { summary: "S", facts: [] })] }])));
    assert.equal(first.outcome, "result");
    const create = rpcLog.find(entry => entry.name === "makeborne_ai_operation_create").args;
    assert.deepEqual(create.p_context.task.sources.references, [reference]);
    const other = task.bindTaskSources(resolved, { omitted: [], references: [{ ...reference, sha256: "c".repeat(64) }] });
    await rejects(run.runAgencyTask(other, lead, deps(scripted([]))), "OPERATION_CONFLICT");
  });

  finished = true; clearInterval(keepAlive);
  console.log(`\n${passed} agency contract checks passed.`);
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
