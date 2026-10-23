/* eslint-disable @typescript-eslint/no-require-imports -- In-memory stand-in for the operation RPCs, copied from src/lib/agency/check-agency.cjs (stage 1) so the review harness exercises the same contract without editing that harness. SQL semantics are proven by supabase/check-agency-operations*.sql. */
const { randomUUID } = require("node:crypto");
let W, P, ACTOR;
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
    return { data: { workspaceId: W, projectId: P, clientId: null, artifactId: a.p_artifact, currentVersion: db.artifactVersion,
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
module.exports = {
  setup(ids) { ({ W, P, ACTOR } = ids); },
  reset() { db = freshDb(); rpcLog = []; failNext = {}; },
  get db() { return db; }, get rpcLog() { return rpcLog; }, get failNext() { return failNext; },
  rpc,
};
