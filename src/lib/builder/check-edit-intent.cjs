/* eslint-disable @typescript-eslint/no-require-imports -- Offline M08 intent checks: pure rules plus the real /api/build route with every database, provider and builder call mocked. No paid call. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const ids = Array.from({ length: 9 }, (_, i) => `${i + 1}`.repeat(8) + `-${String(i + 1).repeat(4)}-4${String(i + 1).repeat(3)}-8${String(i + 1).repeat(3)}-${String(i + 1).repeat(12)}`);
const [actor, workspaceId, artifactId, projectId, actionKey, stepKey] = ids;

// ---------- Route harness: real route + real operation-server, mocked stores ----------
let db, model, builds, rpcCalls;
const load = Module._load;
const root = path.join(__dirname, "../..");
const query = table => {
  const q = { select: () => q, eq: () => q, order: () => q,
    limit: async () => ({ data: table === "artifact_versions" ? db.versions : [], error: null }),
    maybeSingle: async () => ({ data: table === "artifacts" ? db.artifact : table === "projects" ? db.project : table === "artifact_plans" ? (db.plan ? { plan: db.plan } : null) : null, error: null }) };
  return q;
};
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  if (name === "@/lib/cloud/server") return { cloudContext: async () => ({ user: { id: actor }, client: { from: query } }), validId: () => {}, databaseError: error => { if (error) throw Error(error.message ?? error.code); } };
  if (name === "@/lib/cloud/mappers") return { mapProject: row => row, mapVersion: row => row };
  if (name === "@/lib/builder/agent") return { builderModel: () => "fixture-model" };
  if (name === "@/lib/builder/prompt") return { styleDirection: () => "" };
  if (name === "@/lib/builder/website-run") return { websiteBuildResponse: input => { builds.push(input); return new Response(`data: ${JSON.stringify({ type: "done", version: 2 })}\n\n`, { headers: { "Content-Type": "text/event-stream" } }); } };
  if (name === "@/lib/builder/docs-run") return { documentBuildResponse: () => { throw Error("Unexpected document build"); } };
  if (name === "@/lib/builder/availability") return { builderAvailability: async () => ({}) };
  if (name === "@/lib/brand/server") return { projectBrandKit: async () => null, ensureBrandLogo: async () => null };
  if (name === "@/lib/leads/redesign-server") return { importTheirPhotos: async () => [], photosContext: () => "" };
  if (name === "@/lib/ai/model-check") return { requirePricedModel: () => undefined };
  if (name === "@/lib/ai/live-run") return { ...load.call(this, path.join(root, "lib/ai/live-run"), parent, main), requireProviderCapacity: async () => undefined, providerCapacity: async () => ({}) };
  if (name.startsWith("@/")) return load.call(this, path.join(root, name.slice(2)), parent, main);
  if (/(^|\/)billing\/database$/.test(name)) return { billingDatabase: () => ({ rpc: (rpcName, args) => { rpcCalls.push({ name: rpcName, args }); const result = Promise.resolve(rpc(rpcName, args)); result.abortSignal = () => result; return result; } }) };
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);

/** In-memory stand-in for the SQL operation contract: create is idempotent per action key
 * (same input only), begin replays an existing step key, refuses a stale base version and
 * reserves one hold per new step. supabase/check-plan-approval-idempotency.sql proves the
 * same properties against the real local database. */
function rpc(name, args) {
  const snapshot = op => ({ id: op.id, revision: 1, kind: "build", effort: op.effort, authorizedCredits: 50, chargedCredits: 0, reservedCredits: op.reserved, remainingCredits: 50 - op.reserved, maximumAdditionalCredits: 50, status: op.reserved ? "running" : "active", pendingKind: null, lastVersion: op.lastVersion, canContinue: false, recoverable: false, expiresAt: new Date(Date.now() + 86400000).toISOString(), rateMicrousd: 30000, providerRemainingMicrousd: 1500000 });
  if (name === "makeborne_ai_operation_create") {
    const existing = model.ops.get(args.p_action);
    if (!existing && args.p_initial_version !== db.artifact.current_version) return { data: null, error: { code: "PT409" } };
    if (existing && existing.hash !== args.p_input_hash) return { data: null, error: { code: "PT409" } };
    if (!existing) model.ops.set(args.p_action, { id: ids[6 + model.ops.size], hash: args.p_input_hash, effort: args.p_effort, context: args.p_context, lastVersion: args.p_initial_version, reserved: 0 });
    return { data: snapshot(model.ops.get(args.p_action)), error: null };
  }
  const op = [...model.ops.values()].find(item => item.id === args.p_operation) ?? [...model.ops.values()][0];
  if (name === "makeborne_ai_operation_begin") {
    const run = model.runs.get(args.p_step);
    const shape = r => ({ id: r.id, reference: `operation:${r.id}`, fence: ids[8], amount: 50, exempt: false, reservedAt: Date.now(), expiresAt: Date.now() + 900000 });
    if (run) {
      if (run.hash !== args.p_input_hash) return { data: null, error: { code: "PT409" } };
      return { data: { operation: snapshot(op), result: null, recovery: null, requestContext: op.context, replayed: true, run: shape(run) }, error: null };
    }
    if ([...model.runs.values()].some(item => item.op === op.id && item.active)) return { data: { operation: snapshot(op), error: { code: "OPERATION_BUSY" } }, error: null };
    if (args.p_expected_version !== op.lastVersion || args.p_expected_version !== db.artifact.current_version) return { data: null, error: { code: "PT409" } };
    const created = { id: ids[7], op: op.id, hash: args.p_input_hash, active: true };
    model.runs.set(args.p_step, created); model.holds++; op.reserved = 50;
    return { data: { operation: snapshot(op), result: null, recovery: null, requestContext: op.context, replayed: false, run: shape(created) }, error: null };
  }
  if (name === "makeborne_ai_operation_finish") {
    model.finishes++;
    return { data: { operation: { ...snapshot(op), reservedCredits: 0, status: "active" }, result: { charged: 0, code: "REQUEST_FAILED" }, recovery: null, charged: 0, outcome: "failed" }, error: null };
  }
  throw Error(`Unexpected RPC ${name}`);
}

const files = () => {
  const { ProjectFiles } = require("./files.ts");
  const source = new ProjectFiles();
  source.write("index.html", '<!doctype html><html><head><title>T</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>');
  source.write("src/main.tsx", 'import { createRoot } from "react-dom/client"; import App from "./App"; createRoot(document.getElementById("root")!).render(<App />);');
  source.write("src/App.tsx", "export default function App() { return <main><h1>Hello</h1></main>; }");
  return source.toSource();
};
const plan = { kind: "new_site", title: "Fictional Atelier", summary: "Calm studio site", goal: "Book a consultation", audience: "Homeowners", positioning: "Calm craft",
  pages: [{ name: "Home", path: "/", purpose: "Win trust", sections: [{ name: "Hero", purpose: "Introduce", content: "Fictional studio" }] }],
  design: { concept: "Quiet", typography: { display: "Fraunces", body: "Inter", rationale: "Contrast" }, palette: [{ name: "Paper", hex: "#FFFFFF", role: "background" }, { name: "Ink", hex: "#111111", role: "text" }, { name: "Clay", hex: "#B4532A", role: "accent" }], layout: ["Split"], imagery: "Rooms", signatureInteraction: "Reveal" },
  changes: [], questions: [], assumptions: [] };
function reset({ currentVersion = 1, stored = { plan, status: "draft", basedOnVersion: 1, revision: 3, charged: 1 } } = {}) {
  db = { artifact: { id: artifactId, project_id: projectId, kind: "website", title: "Fictional", current_version: currentVersion },
    project: { brief: "A fictional studio", styleId: "", clientId: null },
    versions: [{ number: currentVersion, content: { title: "Fictional", sections: [], websiteSource: files() }, style: {}, changeSummary: "Fixture" }],
    plan: stored };
  model = { ops: new Map(), runs: new Map(), holds: 0, finishes: 0 };
  builds = []; rpcCalls = [];
}
const post = (body, route) => route.POST(new Request("http://127.0.0.1/api/build", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const approval = (extra = {}) => ({ workspaceId, artifactId, expectedVersion: 1, message: "Build the approved plan: Fictional Atelier", effort: "medium", attachments: [], plan, planRevision: 3, operation: { actionKey, stepKey }, ...extra });

let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }

(async () => {
  process.env.ANTHROPIC_API_KEY = "offline-fixture-never-sent";
  delete process.env.MAKEBORNE_LIVE_BUILDER_ENABLED;
  const intent = require("./edit-intent.ts");
  const { answeredQuestionIds } = require("./brief-questions.ts");
  const { parseQuestions } = require("./ai-brief-questions.ts");

  await check("a selected element binds to the saved file it was picked from", () => {
    const target = { path: "src/App.tsx", line: 1, label: "the <h1>", source: "A", version: 4 };
    const text = `Change the <h1> "Hello" in ${intent.targetReference(target)}: bigger`;
    assert.equal(intent.targetIssue(target, text, { "src/App.tsx": "A" }, 5), null, "unchanged file after an unrelated save is still the same target");
    assert.match(intent.targetIssue(target, text, { "src/App.tsx": "B" }, 5), /changed after you selected it.*version 4.*version 5.*Nothing was sent/);
    assert.match(intent.targetIssue(target, text, {}, 5), /no longer exists in version 5/);
    assert.equal(intent.targetIssue(target, "Make the footer darker", { "src/App.tsx": "B" }, 5), null, "a message that no longer names the target is not bound to it");
    assert.equal(intent.targetIssue(null, text, {}, 5), null);
  });
  await check("approval binds the exact saved plan revision and content", () => {
    const stored = { plan, status: "draft", basedOnVersion: 1, revision: 3, charged: 0 };
    assert.equal(intent.approvedPlanIssue(stored, { plan, revision: 3 }), null);
    const reordered = JSON.parse(JSON.stringify(plan, Object.keys(plan).reverse()));
    assert.equal(intent.approvedPlanIssue(stored, { plan: { ...reordered, design: plan.design, pages: plan.pages }, revision: 3 }), null, "key order is not content");
    assert.match(intent.approvedPlanIssue(stored, { plan, revision: 2 }), /approved revision 2; the saved plan is revision 3/);
    assert.match(intent.approvedPlanIssue(stored, { plan: { ...plan, title: "Edited locally" }, revision: 3 }), /differs from the saved plan/);
    assert.match(intent.approvedPlanIssue({ ...stored, status: "built" }, { plan, revision: 3 }), /already built/);
    assert.match(intent.approvedPlanIssue(null, { plan, revision: 3 }), /no longer saved/);
    assert.match(intent.approvedPlanIssue(stored, { plan, revision: undefined }), /Reload the plan/);
    assert.notEqual(intent.planApprovalIdentity({ revision: 3, effort: "medium", version: 1 }), intent.planApprovalIdentity({ revision: 3, effort: "high", version: 1 }), "an effort change is a different approval");
    assert.notEqual(intent.planApprovalIdentity({ revision: 3, effort: "medium", version: 1 }), intent.planApprovalIdentity({ revision: 4, effort: "medium", version: 1 }), "a plan edit is a different approval");
  });
  await check("Undo restores the base only while the AI result is current and nothing is pending", () => {
    const change = { from: 4, to: 5 };
    assert.equal(intent.undoIssue(change, { version: 5, blocked: null, available: true }), null);
    assert.match(intent.undoIssue(change, { version: 6, blocked: null, available: true }), /Version 6 was saved after this change/);
    assert.equal(intent.undoIssue(change, { version: 5, blocked: "Save or resolve the current draft before undoing.", available: true }), "Save or resolve the current draft before undoing.");
    assert.match(intent.undoIssue(change, { version: 5, blocked: null, available: false }), /History/);
    assert.match(intent.undoIssue(null, { version: 5, blocked: null, available: true }), /no AI change/);
  });
  await check("a sent request's text is kept per account and project, text only, and expires", () => {
    const scope = intent.pendingRequestKey(actor, workspaceId, artifactId), other = intent.pendingRequestKey(actor, workspaceId, projectId);
    assert.throws(() => intent.pendingRequestKey("not-an-id", workspaceId, artifactId));
    const now = Date.parse("2026-10-20T12:00:00Z"), request = { text: "Make the hero bolder", mode: "create", baseVersion: 4, target: "the <h1> · src/App.tsx (line 1)", sentAt: now };
    const raw = intent.encodePendingRequest(request, scope);
    assert.deepEqual(intent.decodePendingRequest(raw, scope, now + 1000), request);
    assert.equal(intent.decodePendingRequest(raw, other, now), null, "another project never sees it");
    assert.equal(intent.decodePendingRequest(raw, scope, now + intent.PENDING_REQUEST_TTL_MS + 1), null, "expires");
    assert.equal(intent.decodePendingRequest(JSON.stringify({ ...JSON.parse(raw), operation: { actionKey } }), scope, now), null, "no request identity, approval or quote may ride along");
    assert.equal(intent.decodePendingRequest("{", scope, now), null);
    const store = new Map(), storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) };
    assert.equal(intent.savePendingRequest(storage, scope, request), true);
    assert.deepEqual(intent.readPendingRequest(storage, scope, now), request);
    store.set(scope, "corrupt"); assert.equal(intent.readPendingRequest(storage, scope, now), null); assert.equal(store.has(scope), false, "unreadable copies are removed");
    assert.equal(intent.savePendingRequest({ setItem() { throw Error("quota"); } }, scope, request), false);
  });
  await check("questions stay optional and facts already in the brief are not asked again, even by the tailored AI set", () => {
    const brief = "A minimal one-page site for local homeowners to book a consultation. Our logo is attached.";
    const known = answeredQuestionIds("website", brief, { attachments: 1 });
    for (const id of ["style", "scope", "goal", "brand"]) assert.ok(known.has(id), id);
    const reply = JSON.stringify({ questions: [
      { id: "style", question: "What should it feel like?", why: "The look matters most.", topic: "Look and feel", options: [{ label: "Warm" }, { label: "Bold" }] },
      { id: "goal", question: "What should visitors do first?", why: "Every page leads to it.", topic: "Main action", options: [{ label: "Book" }, { label: "Call" }] },
      { id: "service-area", question: "Which neighbourhoods do you cover?", why: "Sets the local copy.", topic: "Service area" } ] });
    assert.deepEqual(parseQuestions("website", reply, { brief, attachments: 1 }).map(question => question.id), ["service-area"]);
    assert.deepEqual(parseQuestions("website", reply).map(question => question.id), ["style", "goal", "service-area"], "without the brief, parsing is unchanged");
  });

  const route = require("../../app/api/build/route.ts");
  await check("route: the approved saved revision builds once and binds plan + revision into the request digest", async () => {
    reset();
    const response = await post(approval(), route);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(builds.length, 1); assert.equal(model.holds, 1);
    const create = rpcCalls.find(call => call.name === "makeborne_ai_operation_create").args;
    assert.equal(create.p_action, actionKey); assert.deepEqual(create.p_context.plan, plan);
    assert.match(builds[0].context, /<approved_plan>/);
    const hashA = create.p_input_hash;
    reset(); db.plan = { ...db.plan, revision: 4 };
    await post(approval({ planRevision: 4 }), route);
    const hashB = rpcCalls[0].args.p_input_hash;
    assert.notEqual(hashA, hashB, "the approved revision is part of the request identity");
  });
  await check("route: a repeated approval (double click, retry) creates one operation, one hold and one build", async () => {
    reset();
    const [first, second] = await Promise.all([post(approval(), route), post(approval(), route)]);
    const bodies = [await first.text(), await second.text()];
    assert.equal(model.ops.size, 1, "one operation"); assert.equal(model.holds, 1, "one credit hold"); assert.equal(builds.length, 1, "one build");
    const creates = rpcCalls.filter(call => call.name === "makeborne_ai_operation_create");
    assert.equal(creates.length, 2); assert.equal(creates[0].args.p_input_hash, creates[1].args.p_input_hash);
    assert.ok(bodies.some(body => /still being recovered/.test(body)), "the duplicate joins the recorded request instead of starting work");
  });
  await check("route: a stale plan revision, unsaved content, built plan or missing revision is refused before any operation or hold", async () => {
    for (const [body, stored, pattern] of [
      [approval({ planRevision: 2 }), undefined, /approved revision 2; the saved plan is revision 3/],
      [approval({ plan: { ...plan, title: "Unsaved local edit" } }), undefined, /differs from the saved plan/],
      [approval(), { plan, status: "built", basedOnVersion: 1, revision: 3, charged: 1 }, /already built/],
      [approval({ planRevision: undefined }), undefined, /Reload the plan/],
      [approval(), null, /no longer saved/],
    ]) {
      reset(stored === undefined ? {} : { stored });
      const response = await post(body, route);
      const value = await response.json();
      assert.equal(response.status, 409, JSON.stringify(value)); assert.equal(value.error.code, "PLAN_REVISION_CONFLICT"); assert.match(value.error.message, pattern);
      assert.equal(rpcCalls.length, 0, "no operation, hold or provider call"); assert.equal(builds.length, 0);
    }
  });
  await check("route: a request written for an older version is refused with both versions named, without a hold", async () => {
    reset({ currentVersion: 2 });
    const response = await post({ workspaceId, artifactId, expectedVersion: 1, message: "Make the hero bolder", effort: "light", attachments: [], operation: { actionKey, stepKey } }, route);
    const value = await response.json();
    assert.equal(response.status, 409); assert.equal(value.error.code, "VERSION_CONFLICT");
    assert.equal(value.error.message, intent.staleBaseMessage(1, 2));
    assert.equal(model.holds, 0); assert.equal(builds.length, 0);
    reset({ currentVersion: 2 });
    const current = await post({ workspaceId, artifactId, expectedVersion: 2, message: "Make the hero bolder", effort: "light", attachments: [], operation: { actionKey, stepKey } }, route);
    assert.equal(current.status, 200); assert.equal(model.holds, 1);
  });
  console.log(`${passed} edit-intent checks passed; no provider, database or paid call.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
