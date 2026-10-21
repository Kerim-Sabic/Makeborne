/* eslint-disable @typescript-eslint/no-require-imports -- Offline operation integration: all database/provider calls mocked. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const {createHash}=require("node:crypto");
const attachmentHash=value=>createHash("sha256").update(require("../projects/canonical-json.ts").canonicalSourceJson(value)).digest("hex");
const ids = Array.from({ length: 8 }, (_, i) => `${i + 1}`.repeat(8) + `-${String(i + 1).repeat(4)}-4${String(i + 1).repeat(3)}-8${String(i + 1).repeat(3)}-${String(i + 1).repeat(12)}`);
const [actor, workspaceId, artifactId, actionKey, stepKey, operationId, runId, fence] = ids;
let calls = [], handler, websiteAgent, documentAgent, planner, cloudClient;
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  if (name === "@/lib/cloud/server") return { cloudContext: async () => ({ user: { id: actor }, client: cloudClient }), validId: () => {}, databaseError: error => { if (error) throw Error(error.message ?? error.code); } };
  if (name.startsWith("@/")) return load.call(this, path.join(__dirname, "../..", name.slice(2)), parent, main);
  if (/(^|\/)billing\/database$/.test(name)) return { billingDatabase: () => ({ rpc: (name, args) => { calls.push({ name, args }); const result = Promise.resolve(handler(name, args)); result.abortSignal = () => result; return result; } }) };
  if (/(^|\/)credits\/server$/.test(name)) return { HOLD_LIFETIME_MS: 900000, settleRun() { throw Error("Legacy settlement bypass"); }, releaseRun() { throw Error("Legacy release bypass"); }, holdIsActive() { throw Error("Legacy hold bypass"); } };
  if (name === "./agent" && parent.filename.endsWith("website-run.ts")) return { runBuilder: input => websiteAgent(input) };
  if (name === "./docs-agent" && parent.filename.endsWith("docs-run.ts")) return { runDocumentBuilder: input => documentAgent(input) };
  if (name === "./planner" && parent.filename.endsWith("plan-run.ts")) return { runPlanner: input => planner(input) };
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const api = require("./operation-server.ts"), contract = require("./operation-contract.ts");
const { websiteBuildResponse } = require("./website-run.ts"), { documentBuildResponse } = require("./docs-run.ts"), { planStreamResponse } = require("./plan-run.ts");
const { ProjectFiles } = require("./files.ts");
const snapshot = (extra = {}) => ({ id: operationId, revision: 2, kind: "build", effort: "medium", authorizedCredits: 50, chargedCredits: 0, reservedCredits: 50, remainingCredits: 0, maximumAdditionalCredits: 50, status: "running", pendingKind: null, lastVersion: 1, canContinue: false, recoverable: false, expiresAt: new Date(Date.now() + 86400000).toISOString(), rateMicrousd: 30000, providerRemainingMicrousd: 1500000, ...extra });
const status = (result = null, extra = {}) => ({ operation: snapshot(), result, recovery: null, ...extra });
const input = (extra = {}) => ({ actor, workspaceId, artifactId, expectedVersion: 1, effort: "medium", kind: "build", ceiling: 50, request: { message: "Build a useful site", attachments: [{ data: "private attachment" }] }, envelope: { actionKey, stepKey }, ...extra });
const now = Date.now();
function rpc(name, args) {
  if (name === "makeborne_ai_operation_create") return { data: snapshot(), error: null };
  if (name === "makeborne_ai_operation_begin") return { data: { ...status(), requestContext: { message: "Build a useful site" }, replayed: false, run: { id: runId, reference: `operation:${runId}`, fence, amount: 50, exempt: false, reservedAt: now, expiresAt: now + 900000 } }, error: null };
  if (name === "makeborne_ai_operation_read") return { data: {...status(),requestContext:{attachmentsSha256:attachmentHash(input().request.attachments)}}, error: null };
  if (name === "makeborne_ai_operation_provider_begin") return { data: { started: true }, error: null };
  if (name === "makeborne_provider_call_finish") return { data: {}, error: null };
  if (name === "makeborne_ai_operation_finish") {
    const charged = args.p_outcome === "failed" ? 0 : Math.ceil(args.p_measured_microusd / 30000);
    const result = { ...args.p_detail, runId, charged, ...(args.p_outcome === "saved" ? { version: 2 } : {}), ...(args.p_outcome === "plan" ? { stored: { ...args.p_candidate.stored, charged }, persisted: true } : {}) };
    return { data: { ...status(result, { operation: snapshot({ status: "active", reservedCredits: 0, chargedCredits: charged, remainingCredits: 50 - charged }) }), charged, outcome: args.p_outcome }, error: null };
  }
  throw Error(`Unexpected RPC ${name}`);
}
let passed = 0;
async function check(name, fn) { calls = []; handler = rpc; await fn(); passed++; console.log(`PASS ${name}`); }
async function fresh() { return (await api.beginOperation(input())).run; }
const finishCall = () => calls.find(call => call.name === "makeborne_ai_operation_finish");
const events = async response => (await response.text()).split("\n\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
function files() {
  const source = new ProjectFiles();
  source.write("index.html", '<!doctype html><html><head><title>T</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>');
  source.write("src/main.tsx", 'import { createRoot } from "react-dom/client"; import App from "./App"; import "./styles.css"; createRoot(document.getElementById("root")!).render(<App />);');
  source.write("src/App.tsx", 'export default function App() { return <main><h1>Hello</h1></main>; }');
  source.write("src/styles.css", "body{margin:0}");
  return new ProjectFiles(source.toSource());
}
function runnerInput(run) {
  const spend = api.createOperationSpend(run, Date.now() + 280000); spend.confirmedMicrousd = 45000;
  return { client: { rpc() { throw Error("Nonatomic save bypass"); } }, hold: run.hold, operation: run, spend, workspaceId,
    artifact: { id: artifactId, project_id: actionKey, kind: "book", title: "Example", current_version: 1 },
    current: { number: 1, assetIds: [], content: { title: "Example", sections: [] }, style: {} }, project: { brief: "Brief", styleId: "" }, versions: [],
    files: files(), reviewing: false, message: "Continue the saved request", effort: "medium", request: "Continue", context: "Context", attachments: [], maxDuration: 300 };
}
const plan = { kind: "new_site", title: "Example", summary: "Clear site", goal: "Book", audience: "Owners", positioning: "Calm", pages: [{ name: "Home", path: "/", purpose: "Inform", sections: [{ name: "Hero", purpose: "Introduce", content: "Example business" }] }], design: { concept: "Calm", typography: { display: "Fraunces", body: "Inter", rationale: "Contrast" }, palette: [{ name: "Paper", hex: "#FFFFFF", role: "background" }, { name: "Ink", hex: "#000000", role: "text" }, { name: "Sky", hex: "#0000FF", role: "accent" }], layout: ["Split"], imagery: "Rooms", signatureInteraction: "Reveal" }, changes: [], questions: [], assumptions: [] };

(async () => {
  await check("server binds actor, scope, initial version, policy cap and canonical request digest; context excludes attachments", async () => {
    await api.beginOperation(input());
    const create = calls[0].args;
    assert.deepEqual([create.p_actor, create.p_workspace, create.p_artifact, create.p_credit_cap, create.p_initial_version], [actor, workspaceId, artifactId, 50, 1]);
    assert.match(create.p_input_hash, /^[a-f0-9]{64}$/); assert.deepEqual(create.p_context, { message: "Build a useful site", attachmentsSha256:attachmentHash(input().request.attachments) });
    assert.equal(JSON.stringify(create.p_context).includes("private attachment"),false);
    await api.beginOperation(input({ request: { attachments: [{ data: "private attachment" }], message: "Build a useful site" } }));
    assert.equal(calls[2].args.p_input_hash, create.p_input_hash);
    await api.beginOperation(input({ request: { message: "Different" } })); assert.notEqual(calls[4].args.p_input_hash, create.p_input_hash);
  });
  await check("continuation checks scoped operation and pinned effort before allocation", async () => {
    await assert.rejects(api.beginOperation(input({ effort: "ultra", envelope: { id: operationId, stepKey, kind: "continuation" } })), error => error.code === "OPERATION_CONFLICT");
    assert.deepEqual(calls.map(c => c.name), ["makeborne_ai_operation_read"]);
    assert.deepEqual(calls[0].args, { p_actor: actor, p_workspace: workspaceId, p_artifact: artifactId, p_operation: operationId, p_action: null });
  });
  await check("continuation admits exact references and rejects changed or missing bytes before a hold",async()=>{
    const continued=input({envelope:{id:operationId,stepKey,kind:"continuation"}});
    const accepted=await api.beginOperation(continued);assert.ok(accepted.run);
    for(const attachments of [[],[{data:"different private attachment"}]]){
      calls=[];
      await assert.rejects(api.beginOperation({...continued,request:{...continued.request,attachments}}),error=>error.code==="OPERATION_REFERENCES_CHANGED");
      assert.deepEqual(calls.map(call=>call.name),["makeborne_ai_operation_read"]);
    }
  });
  await check("legacy reference state cannot authorize a silent continuation; status stays private",async()=>{
    handler=(name,args)=>name==="makeborne_ai_operation_read"?{data:{...status(),requestContext:{message:"Legacy"}},error:null}:rpc(name,args);
    await assert.rejects(api.beginOperation(input({envelope:{id:operationId,stepKey,kind:"continuation"}})),error=>error.code==="OPERATION_REFERENCES_UNAVAILABLE");
    assert.equal(calls.length,1);
    const visible=await api.readOperation({actor,workspaceId,artifactId,id:operationId});
    assert.equal("requestContext" in visible,false);assert.equal("attachmentsSha256" in visible,false);
  });
  await check("visual review uses fresh screenshots instead of requiring original upload bytes",async()=>{
    const reviewed=await api.beginOperation(input({kind:"review",request:{message:"Review",attachments:[],review:{desktop:"new capture"}},envelope:{id:operationId,stepKey,kind:"review"}}));
    assert.ok(reviewed.run);assert.deepEqual(calls.map(call=>call.name),["makeborne_ai_operation_read","makeborne_ai_operation_begin"]);
  });
  await check("structured atomic budget refusals preserve the operation snapshot", async () => {
    handler = (name, args) => name.endsWith("_begin") ? { data: { operation: snapshot(), error: { code: "OPERATION_BUDGET_REACHED" } } } : rpc(name, args);
    await assert.rejects(api.beginOperation(input()), error => error.code === "OPERATION_BUDGET_REACHED" && error.operation.id === operationId);
  });
  await check("replayed step has no executable run and streams its durable result", async () => {
    handler = (name, args) => name === "makeborne_ai_operation_begin" ? { data: { ...status({ runId, version: 2, finished: true, charged: 3 }), replayed: true } } : rpc(name, args);
    const replay = await api.beginOperation(input()); assert.equal(replay.run, null);
    const stream = await events(api.operationReplayResponse(replay.status));
    assert.deepEqual(stream.map(e => e.type), ["operation", "done"]); assert.equal(stream.at(-1).charged, 3);
    assert.equal(calls.length, 2);
  });
  await check("provider calls bind run and fence, obey residual exposure, and never replay an existing ticket", async () => {
    const run = await fresh(); run.providerAllowanceMicrousd = 70000; run.hold.exempt = true;
    const spend = api.createOperationSpend(run, now + 2000000);
    assert.equal(spend.allowanceMicrousd, 70000); assert.equal(spend.deadline, run.expiresAt - 90000);
    const ticket = await spend.begin("anthropic", "model", 50000);
    const sent = calls.at(-1); assert.equal(sent.name, "makeborne_ai_operation_provider_begin");
    assert.deepEqual([sent.args.p_actor, sent.args.p_run, sent.args.p_fence], [actor, runId, fence]);
    await spend.finish(ticket, { actualMicrousd: null, partialMicrousd: 10000 }); assert.equal(spend.remainingMicrousd, 20000);
    await assert.rejects(spend.begin("openai", "image", 20001), error => error.code === "RUN_BUDGET");
    handler = () => ({ data: { started: false } });
    await assert.rejects(spend.begin("openai", "image", 10000), error => error.code === "SPEND_UNAVAILABLE");
    assert.equal(spend.pendingMicrousd, 0);
  });
  await check("atomic finish carries full measured cost and candidate, with no independent save or settlement", async () => {
    const run = await fresh(); const candidate = { content: {}, style: {}, assetIds: [], expectedVersion: 1, summary: "Saved" };
    const finished = await api.finishOperation(run, 45000.1, "saved", { finished: true }, candidate);
    assert.equal(run.finalizationStarted, true); assert.equal(finishCall().args.p_measured_microusd, 45001); assert.deepEqual(finishCall().args.p_candidate, candidate);
    assert.equal(finished.result.charged, 2); assert.equal(finished.result.runId, runId);
  });
  await check("multibyte model summary cannot exceed the durable audit envelope", async () => {
    await api.finishOperation(await fresh(), 1, "saved", { summary: "😀".repeat(8000), changed: true, finished: false, providerMicrousd: 1 });
    assert.equal(Buffer.byteLength(finishCall().args.p_detail.summary), 2000); assert.ok(Buffer.byteLength(JSON.stringify(finishCall().args.p_detail)) < 3800);
  });
  await check("brand-new projects provide the same valid version-zero view to planner and builder", async () => {
    const { blankVersion } = require("./blank-version.ts");
    const version = blankVersion(artifactId, "website", "New project", actor);
    assert.equal(version.number, 0); assert.equal(version.content.title, "New project"); assert.deepEqual(version.content.sections, []); assert.ok(version.style.typography.bodyFont);
    const source = fs.readFileSync(path.join(__dirname, "../../app/api/build/plan/route.ts"), "utf8");
    assert.match(source, /artifact.current_version === 0 \? blankVersion\(/);
  });
  await check("ambiguous finish resolves only its own durable run result; stale previous result cannot claim success", async () => {
    const run = await fresh(), spend = api.createOperationSpend(run, Date.now() + 280000);
    handler = (name, args) => name.endsWith("_finish") ? { error: { code: "NETWORK" } } : rpc(name, args);
    await assert.rejects(api.finishOperation(run, 50000, "saved", { finished: true }));
    handler = () => ({ data: status({ runId, version: 2, charged: 2, finished: true }) });
    const done = await api.operationFailure(run, spend, { code: "BUILD_FAILED" }); assert.equal(done.type, "done"); assert.equal(done.charged, 2);
    handler = () => ({ data: status({ runId: stepKey, version: 1, charged: 1 }) });
    assert.equal((await api.operationFailure(run, spend, { code: "BUILD_FAILED" })).code, "OPERATION_RECOVERY_PENDING");
    assert.equal(calls.filter(c => c.name === "makeborne_ai_operation_finish").length, 1, "never a contradictory failure/release after ambiguous settlement");
  });
  await check("status validates charged/boolean/run identity and strips internal spend fields", async () => {
    const read = await api.readOperation({ actor, workspaceId, artifactId, actionKey }); assert.equal(read.operation.rateMicrousd, undefined);
    for (const result of [{ runId: "wrong", charged: 0 }, { runId, charged: -1 }, { runId, charged: 0, finished: "true" }]) {
      handler = () => ({ data: status(result) }); await assert.rejects(api.readOperation({ actor, workspaceId, artifactId, actionKey }), error => error.code === "OPERATION_UNAVAILABLE");
    }
    assert.equal(contract.OperationAuthorizationSchema.safeParse({ workspaceId, artifactId, id: operationId, expectedRevision: 1, authorizationKey: actionKey, additionalCredits: 241, acknowledged: true }).success, false);
  });
  await check("recovery requires a scoped matching run before the provider-free recovery transaction", async () => {
    await assert.rejects(api.recoverOperation({ actor, workspaceId, artifactId, id: operationId, runId, expectedVersion: 2 }), error => error.code === "OPERATION_CONFLICT");
    assert.equal(calls.length, 1);
    handler = (name) => ({ data: name.endsWith("_read") ? status({ runId, charged: 0 }, { recovery: { runId, candidate: { content: {} } } }) : status({ runId, charged: 0, version: 3 }) });
    const saved = await api.recoverOperation({ actor, workspaceId, artifactId, id: operationId, runId, expectedVersion: 2 });
    assert.equal(saved.result.version, 3); assert.equal(calls.at(-1).name, "makeborne_ai_operation_recover"); assert.equal(calls.at(-1).args.p_expected_version, 2);
  });
  await check("status and authorization routes bind authenticated actor and validate explicit consent", async () => {
    const route = require("../../app/api/build/operations/route.ts");
    const query = new URLSearchParams({ workspaceId, artifactId, actionKey });
    const response = await route.GET(new Request(`http://localhost/api/build/operations?${query}`));
    assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store"); assert.equal(calls.at(-1).args.p_actor, actor);
    const authorization = { workspaceId, artifactId, id: operationId, expectedRevision: 2, authorizationKey: actionKey, additionalCredits: 50, acknowledged: true };
    const request = body => new Request("http://localhost/api/build/operations", { method: "PATCH", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: JSON.stringify(body) });
    const before = calls.length;
    assert.equal((await route.PATCH(request({ ...authorization, acknowledged: false }))).status, 400); assert.equal(calls.length, before);
    assert.equal((await route.PATCH(request({ ...authorization, actor: stepKey }))).status, 400);
    handler = () => ({ data: status(null, { operation: snapshot({ authorizedCredits: 100, revision: 3 }) }) });
    const increased = await route.PATCH(request(authorization)); assert.equal(increased.status, 200);
    assert.equal(calls.at(-1).name, "makeborne_ai_operation_authorize"); assert.equal(calls.at(-1).args.p_expected_revision, 2); assert.equal(calls.at(-1).args.p_actor, actor);
  });
  await check("manual plan PUT requires displayed revision and returns the database's new revision", async () => {
    const route = require("../../app/api/build/plan/route.ts");
    let saved = { plan, status: "draft", basedOnVersion: 1, revision: 2, charged: 3 }, writes = 0;
    cloudClient = { from(table) {
      const chain = { select() { return chain; }, eq() { return chain; }, async maybeSingle() { return { data: table === "artifacts" ? { id: artifactId, project_id: actionKey, kind: "website", title: "Example", current_version: 1 } : { plan: saved } }; },
        update(row) { writes++; saved = { ...row.plan, revision: row.plan.revision + 1 }; return chain; }, insert() { throw Error("Existing plan must not use insert/upsert"); }, async single() { return { data: { plan: saved } }; } }; return chain;
    } };
    const request = body => new Request("http://localhost/api/build/plan", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const body = { workspaceId, artifactId, plan: { ...plan, title: "Edited title" }, status: "draft" };
    assert.equal((await route.PUT(request(body))).status, 400);
    assert.equal((await route.PUT(request({ ...body, expectedRevision: 1 }))).status, 409); assert.equal(writes, 0);
    const response = await route.PUT(request({ ...body, expectedRevision: 2 }));
    assert.equal(response.status, 200); assert.equal((await response.json()).stored.revision, 3); assert.equal(writes, 1);
  });
  await check("website saved partial retains finished=false and uses atomic candidate+charge", async () => {
    websiteAgent = async input => { input.files.write("src/App.tsx", 'export default function App(){return <main>Updated</main>}'); return { summary: "Partial", finished: false }; };
    const stream = await events(websiteBuildResponse(runnerInput(await fresh())));
    assert.equal(stream[0].type, "operation"); assert.equal(stream.at(-1).finished, false); assert.equal(stream.at(-1).charged, 2);
    assert.equal(finishCall().args.p_outcome, "saved"); assert.ok(finishCall().args.p_candidate.content.websiteSource);
  });
  await check("no-change review remains chargeable and only claims captured views", async () => {
    websiteAgent = async () => ({ summary: "", finished: true });
    const stream = await events(websiteBuildResponse({ ...runnerInput(await fresh()), reviewing: true }));
    assert.equal(stream.at(-1).charged, 2); assert.equal(stream.at(-1).changed, false); assert.equal(stream.at(-1).summary, "No changes needed in the captured views."); assert.equal(finishCall().args.p_outcome, "review_no_change");
  });
  await check("a step that saved nothing usable is never charged (released, cost absorbed)", async () => {
    websiteAgent = async () => ({ summary: "", finished: false });
    const stream = await events(websiteBuildResponse(runnerInput(await fresh())));
    assert.equal(stream.at(-1).code, "BUILD_INCOMPLETE"); assert.equal(stream.at(-1).charged, 0); assert.equal(finishCall().args.p_outcome, "failed"); assert.equal(finishCall().args.p_candidate, null);
  });
  await check("document continuation includes original request and persists truthful finished flag", async () => {
    documentAgent = async input => { assert.match(input.context, /Original authorized request: Build a useful site/); input.editor.apply("write_chapter", { chapter: { id: "intro", title: "Introduction", text: "A useful first draft." } }); return { summary: "First chapter", finished: false }; };
    const stream = await events(documentBuildResponse(runnerInput(await fresh())));
    assert.equal(stream.at(-1).type, "done"); assert.equal(stream.at(-1).finished, false); assert.equal(finishCall().args.p_candidate.content.document.kind, "book");
  });
  await check("planning stores and charges together; replay includes usable estimates and recommendation", async () => {
    planner = async () => ({ plan });
    const stream = await events(planStreamResponse({ ...runnerInput(await fresh()), previousPlan: null, previousRevision: 0, basedOnVersion: 1, persist() { throw Error("Independent plan persistence bypass"); } }));
    const event = stream.find(e => e.type === "plan"); assert.equal(event.persisted, true); assert.equal(event.stored.charged, 2); assert.ok(event.estimate.medium); assert.ok(event.recommended);
    assert.equal(finishCall().args.p_outcome, "plan");
    const replay = await events(api.operationReplayResponse(status({ runId, charged: 2, stored: event.stored, persisted: true })));
    assert.deepEqual(replay.find(e => e.type === "plan").estimate, event.estimate);
  });
  await check("provider failure finalizes zero-charge failed outcome and preserves validated partial source", async () => {
    websiteAgent = async input => { input.files.write("src/App.tsx", 'export default function App(){return <main>Partial</main>}'); throw Object.assign(Error("refused"), { code: "REFUSED" }); };
    const stream = await events(websiteBuildResponse(runnerInput(await fresh())));
    assert.equal(stream.at(-1).charged, 0); assert.equal(finishCall().args.p_outcome, "failed"); assert.ok(finishCall().args.p_candidate.content.websiteSource);
  });
  await check("production routes require operation envelope and cannot bypass durable spend", async () => {
    for (const file of ["../../app/api/build/route.ts", "../../app/api/build/plan/route.ts"]) {
      const source = fs.readFileSync(path.join(__dirname, file), "utf8");
      assert.match(source, /OPERATION_REQUIRED/); assert.match(source, /await beginOperation\(/); assert.match(source, /createOperationSpend\(/); assert.doesNotMatch(source, /await reserveCredits\(/);
    }
    const priorKey = process.env.ANTHROPIC_API_KEY, priorEnabled = process.env.MAKEBORNE_LIVE_BUILDER_ENABLED;
    process.env.ANTHROPIC_API_KEY = "offline-not-sent"; process.env.MAKEBORNE_LIVE_BUILDER_ENABLED = "true";
    try {
      for (const name of ["../../app/api/build/route.ts", "../../app/api/build/plan/route.ts"]) {
        const route = require(name), before = calls.length;
        const response = await route.POST(new Request("http://localhost/api/build", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, artifactId, expectedVersion: 1, ...(name.includes("plan") ? { expectedRevision: 0 } : {}), message: "Build", effort: "medium" }) }));
        assert.equal(response.status, 409); assert.equal((await response.json()).error.code, "OPERATION_REQUIRED"); assert.equal(calls.length, before);
      }
    } finally {
      if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = priorKey;
      if (priorEnabled === undefined) delete process.env.MAKEBORNE_LIVE_BUILDER_ENABLED; else process.env.MAKEBORNE_LIVE_BUILDER_ENABLED = priorEnabled;
    }
  });
  await check("Stop route binds scope and actor, requires same origin and never needs a new credit authorization", async () => {
    const route = require("../../app/api/build/operations/route.ts");
    handler = (name,args) => name === "makeborne_ai_operation_cancel" ? {data:status(null,{operation:snapshot({cancelRequested:true})}),error:null} : rpc(name,args);
    const request = origin => new Request("http://localhost/api/build/operations",{method:"DELETE",headers:{"Content-Type":"application/json",Origin:origin},body:JSON.stringify({workspaceId,artifactId,id:operationId,expectedRevision:2})});
    assert.equal((await route.DELETE(request("https://foreign.example"))).status,403); assert.equal(calls.length,0);
    const response=await route.DELETE(request("http://localhost")); assert.equal(response.status,200);
    assert.deepEqual(calls.map(call=>call.name),["makeborne_ai_operation_read","makeborne_ai_operation_cancel"]);
    assert.deepEqual(calls[1].args,{p_actor:actor,p_operation:operationId,p_expected_revision:2});
  });
  await check("a cancelled provider gate refuses this and every subsequent attempt before a call is sent", async () => {
    const run=await fresh(),spend=api.createOperationSpend(run,Date.now()+280000);
    handler=(name,args)=>name==="makeborne_ai_operation_provider_begin"?{data:null,error:{code:"MB499"}}:rpc(name,args);
    await assert.rejects(spend.begin("anthropic","fixture",1000),error=>error.code==="CANCELLED");assert.equal(spend.stopped,"CANCELLED");
    const before=calls.length;await assert.rejects(spend.begin("anthropic","fixture",1000),error=>error.code==="CANCELLED");assert.equal(calls.length,before);assert.equal(spend.pendingMicrousd,0);
  });
  await check("durable cancellation aborts an active website stream and finalizes confirmed usage with recoverable source", async () => {
    const input=runnerInput(await fresh());input.compile=async()=>({status:"passed"});
    handler=(name,args)=>name==="makeborne_ai_operation_read"?{data:status(null,{operation:snapshot({cancelRequested:true})}),error:null}
      :name==="makeborne_ai_operation_finish"?{data:{...status({runId,charged:2,summary:"Stopped",changed:false,finished:true},{operation:snapshot({status:"cancelled",cancelRequested:true,reservedCredits:0,chargedCredits:2})}),charged:2,outcome:"cancelled"},error:null}:rpc(name,args);
    let signal;
    websiteAgent=async input=>{signal=input.signal;input.files.write("src/App.tsx",'export default function App(){return <main>Retained partial</main>}');await new Promise((resolve,reject)=>input.signal.addEventListener("abort",()=>reject(input.signal.reason),{once:true}));};
    const stream=await events(websiteBuildResponse(input));assert.equal(signal.aborted,true);assert.equal(stream.at(-1).charged,2);assert.equal(stream.at(-1).operation.status,"cancelled");
    assert.equal(finishCall().args.p_measured_microusd,45000);assert.ok(finishCall().args.p_candidate.content.websiteSource);
  });
  await check("unavailable Stop status aborts conservatively and a disposed watcher performs no later poll", async () => {
    const run=await fresh(),spend=api.createOperationSpend(run,Date.now()+280000),controller=new AbortController();
    handler=(name,args)=>name==="makeborne_ai_operation_read"?{data:null,error:{code:"unavailable"}}:rpc(name,args);
    const dispose=api.watchOperationCancellation(run,spend,controller,1);await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(controller.signal.aborted,true);assert.equal(controller.signal.reason.code,"SPEND_UNAVAILABLE");assert.equal(spend.stopped,null,"does not fabricate user consent");
    dispose();const before=calls.length;await new Promise(resolve=>setTimeout(resolve,20));assert.equal(calls.length,before);
  });
  await check("Stop interrupts document generation and settles through the same durable operation", async () => {
    const input=runnerInput(await fresh());
    handler=(name,args)=>name==="makeborne_ai_operation_read"?{data:status(null,{operation:snapshot({cancelRequested:true})}),error:null}
      :name==="makeborne_ai_operation_finish"?{data:{...status({runId,charged:2,summary:"Stopped",changed:false,finished:true},{operation:snapshot({status:"cancelled",cancelRequested:true,reservedCredits:0,chargedCredits:2})}),charged:2,outcome:"cancelled"},error:null}:rpc(name,args);
    documentAgent=async input=>{await new Promise((resolve,reject)=>input.signal.addEventListener("abort",()=>reject(input.signal.reason),{once:true}));};
    const stream=await events(documentBuildResponse(input));assert.equal(stream.at(-1).operation.status,"cancelled");assert.equal(finishCall().args.p_measured_microusd,45000);assert.equal(stream.at(-1).charged,2);
  });
  await check("Stop interrupts Plan mode without bypassing settlement or persisting a partial plan", async () => {
    const run=await fresh(),spend=api.createOperationSpend(run,Date.now()+280000);spend.confirmedMicrousd=45000;
    handler=(name,args)=>name==="makeborne_ai_operation_read"?{data:status(null,{operation:snapshot({cancelRequested:true})}),error:null}
      :name==="makeborne_ai_operation_finish"?{data:{...status({runId,charged:2,summary:"Stopped",changed:false,finished:true},{operation:snapshot({status:"cancelled",cancelRequested:true,reservedCredits:0,chargedCredits:2})}),charged:2,outcome:"cancelled"},error:null}:rpc(name,args);
    planner=async input=>{await new Promise((resolve,reject)=>input.signal.addEventListener("abort",()=>reject(input.signal.reason),{once:true}));};
    const stream=await events(planStreamResponse({hold:run.hold,operation:run,spend,context:"",message:"Plan",previousPlan:null,attachments:[],effort:"medium",basedOnVersion:1,previousRevision:0,maxDuration:300,persist:()=>{throw Error("Partial plan saved");}}));
    assert.equal(stream.at(-1).operation.status,"cancelled");assert.equal(finishCall().args.p_measured_microusd,45000);assert.equal(finishCall().args.p_candidate,null);
  });
  await check("settled Stop remains readable after an old-app rollback and new app renders Stopped", async () => {
    const raw=snapshot({status:"completed",cancelRequested:true,reservedCredits:0,canContinue:false,maximumAdditionalCredits:0});
    const legacy=contract.OperationSnapshotSchema.omit({cancelRequested:true}).extend({status:require("zod").z.enum(["active","running","paused","completed","expired"])});
    assert.equal(legacy.parse(raw).status,"completed");assert.equal(legacy.parse(raw).canContinue,false);
    handler=()=>({data:status({runId,charged:2,changed:false,finished:true},{operation:raw}),error:null});
    const current=await api.readOperation({actor,workspaceId,artifactId,id:operationId});assert.equal(current.operation.status,"cancelled");assert.equal(current.result.charged,2);assert.equal(calls.length,1);
    const unchanged=snapshot({status:"completed",reservedCredits:0});handler=()=>({data:status(null,{operation:unchanged}),error:null});
    assert.equal((await api.readOperation({actor,workspaceId,artifactId,id:operationId})).operation.status,"completed","successful completion cannot be relabelled Stop");
  });
  console.log(`${passed} operation integration groups passed. Database and providers mocked; no network or paid calls.`);
})().catch(error => { console.error(error); process.exit(1); });
