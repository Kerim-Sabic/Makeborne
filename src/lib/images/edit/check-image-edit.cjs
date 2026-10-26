/* eslint-disable @typescript-eslint/no-require-imports -- Offline image-edit harness: database, storage, Claude and the image API are in-memory fakes; no network, no paid call. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const sharp = require("sharp");

globalThis.fetch = async () => { throw new Error("Network access is not allowed in this offline check."); };
const sha = value => createHash("sha256").update(value).digest("hex");
const W = randomUUID(), P = randomUUID(), OTHER_P = randomUUID(), OTHER_W = randomUUID(), ACTOR = randomUUID(), ARTIFACT = randomUUID();

// ---- In-memory storage, tables and operation RPCs (SQL semantics are proven by the supabase/check-agency-operations*.sql checks) ----
let mem, rpcLog, imageCalls, modelCalls;
const err = (code, message = code) => ({ data: null, error: { code, message } });
function fresh() {
  mem = { tables: { assets: [], artifacts: [], artifact_versions: [], projects: [{ id: P, workspace_id: W }, { id: OTHER_P, workspace_id: W }] }, objects: new Map(),
    ops: new Map(), runs: new Map(), calls: new Map(), byAction: new Map(), wallet: Infinity, emergency: false, saves: new Map() };
  rpcLog = []; imageCalls = []; modelCalls = 0;
}
const artifactRow = () => mem.tables.artifacts.find(row => row.id === ARTIFACT);
function snap(op) {
  const reserved = [...mem.runs.values()].filter(run => run.op === op.id && run.status === "active").reduce((total, run) => total + run.amount, 0);
  const used = [...mem.runs.values()].filter(run => run.op === op.id).flatMap(run => [...mem.calls.values()].filter(call => call.run === run.id)).reduce((total, call) => total + (call.charged ?? call.bound), 0);
  return { id: op.id, revision: op.revision, kind: op.kind, effort: op.effort, authorizedCredits: op.cap, chargedCredits: op.charged, reservedCredits: reserved,
    remainingCredits: Math.max(0, op.cap - op.charged - reserved), maximumAdditionalCredits: op.cap, status: reserved ? "running" : "active", cancelRequested: op.cancel,
    pendingKind: null, lastVersion: op.version, canContinue: false, recoverable: false, expiresAt: new Date(Date.now() + 86400000).toISOString(),
    rateMicrousd: op.rate, providerRemainingMicrousd: Math.max(0, op.cap * op.rate - used) };
}
const status = (op, result) => ({ operation: snap(op), result: result ?? ([...mem.runs.values()].filter(run => run.op === op.id && run.result).at(-1)?.result ?? null), recovery: null });
const runJson = run => ({ id: run.id, reference: run.reference, fence: run.fence, amount: run.amount, exempt: false, reservedAt: Date.now(), expiresAt: run.expiresAt, status: run.status });
const rpcHandlers = {
  makeborne_agency_task_scope(a) {
    const artifact = artifactRow();
    if (a.p_artifact !== ARTIFACT || !artifact) return err("42501");
    const inputs = [];
    for (const input of a.p_inputs) {
      const row = mem.tables.assets.find(item => item.id === input.id);
      if (!row || row.workspace_id !== W || row.project_id !== P) return err("42501");
      if (row.sha256 !== input.sha256) return err("PT409");
      inputs.push({ kind: input.kind, id: input.id, sha256: input.sha256, version: null, projectId: P });
    }
    return { data: { workspaceId: W, projectId: P, clientId: null, artifactId: ARTIFACT, currentVersion: artifact.current_version, inputs }, error: null };
  },
  makeborne_ai_operation_create(a) {
    if (a.p_actor !== ACTOR || a.p_workspace !== W) return err("42501");
    const key = `${a.p_actor}:${a.p_action}`;
    let op = mem.byAction.get(key);
    if (op && (op.hash !== a.p_input_hash || JSON.stringify(op.context) !== JSON.stringify(a.p_context))) return err("PT409");
    if (!op) {
      if (a.p_initial_version !== artifactRow().current_version) return err("PT409");
      op = { id: randomUUID(), actor: a.p_actor, kind: a.p_kind, effort: a.p_effort, hash: a.p_input_hash, context: a.p_context, cap: a.p_credit_cap, rate: a.p_rate_microusd, charged: 0, revision: 1, cancel: false, version: a.p_initial_version };
      mem.ops.set(op.id, op); mem.byAction.set(key, op);
    }
    return { data: snap(op), error: null };
  },
  makeborne_ai_operation_begin(a) {
    const op = mem.ops.get(a.p_operation);
    if (!op || op.actor !== a.p_actor) return err("P0002");
    if (a.p_kind !== op.kind) return err("PT409");
    const existing = [...mem.runs.values()].find(run => run.op === op.id && run.step === a.p_step);
    if (existing) {
      if (existing.stageCap !== a.p_stage_cap || existing.hash !== a.p_input_hash) return err("PT409");
      return { data: { ...status(op, existing.result), replayed: true, run: runJson(existing) }, error: null };
    }
    if (op.cancel) return err("PT409");
    if ([...mem.runs.values()].some(run => run.op === op.id && run.status === "active")) return { data: { operation: snap(op), error: { code: "OPERATION_BUSY" } }, error: null };
    if (a.p_expected_version !== op.version || artifactRow().current_version !== a.p_expected_version) return err("PT409");
    const reserved = [...mem.runs.values()].filter(run => run.op === op.id && run.status === "active").reduce((total, run) => total + run.amount, 0);
    let amount = Math.min(a.p_stage_cap, op.cap - op.charged - reserved);
    if (amount <= 0) return { data: { operation: snap(op), error: { code: "OPERATION_BUDGET_REACHED" } }, error: null };
    amount = Math.min(amount, mem.wallet);
    if (amount <= 0) return err("MB402");
    mem.wallet -= amount;
    const run = { id: randomUUID(), op: op.id, step: a.p_step, hash: a.p_input_hash, stageCap: a.p_stage_cap, fence: randomUUID(), amount, status: "active", result: null, expiresAt: Date.now() + 900000 };
    run.reference = `operation:${run.id}`;
    mem.runs.set(run.id, run);
    return { data: { ...status(op, null), requestContext: op.context, replayed: false, run: runJson(run) }, error: null };
  },
  makeborne_ai_operation_provider_begin(a) {
    const run = mem.runs.get(a.p_run), op = run && mem.ops.get(run.op);
    if (!run) return err("P0002");
    if (op.cancel) return err("MB499");
    if (a.p_fence !== run.fence || run.status !== "active") return err("PT409");
    if (mem.emergency && a.p_provider === "openai") return err("MB423");
    mem.calls.set(a.p_call, { id: a.p_call, run: run.id, bound: a.p_bound, provider: a.p_provider, model: a.p_model, status: "open", charged: null });
    return { data: { started: true }, error: null };
  },
  makeborne_provider_call_finish(a) {
    const call = mem.calls.get(a.p_call);
    call.status = a.p_actual === null ? "uncertain" : "settled";
    call.charged = a.p_actual === null ? call.bound : a.p_actual;
    if (a.p_actual !== null && a.p_actual > call.bound) mem.emergency = true; // close_provider_call trips the provider scope's emergency stop
    return { data: {}, error: null };
  },
  makeborne_ai_operation_heartbeat(a) {
    const run = mem.runs.get(a.p_run), op = run && mem.ops.get(run.op);
    if (!run) return err("P0002");
    return { data: { active: run.status === "active" && !op.cancel, cancelRequested: op.cancel, expiresAt: new Date(run.expiresAt).toISOString(), renewed: false }, error: null };
  },
  makeborne_ai_operation_read(a) {
    const op = a.p_operation ? mem.ops.get(a.p_operation) : null;
    if (a.p_workspace !== W) return err("42501");
    if (!op || op.actor !== a.p_actor) return err("P0002");
    return { data: { ...status(op), requestContext: op.context }, error: null };
  },
  makeborne_ai_operation_progress(a) {
    const op = mem.ops.get(a.p_operation);
    if (!op) return err("P0002");
    return { data: { operation: snap(op), runs: [], calls: { inProgress: 0, uncertain: 0, settled: 0 } }, error: null };
  },
  makeborne_ai_operation_cancel(a) { const op = mem.ops.get(a.p_operation); op.cancel = true; op.revision++; return { data: status(op), error: null }; },
  makeborne_ai_operation_finish(a) {
    const run = mem.runs.get(a.p_run), op = run && mem.ops.get(run.op);
    if (!run) return err("P0002");
    if (a.p_fence !== run.fence) return err("PT409");
    if (run.status === "finished") return { data: { ...status(op, run.result), charged: run.charged, outcome: run.outcome, result: run.result, replayed: true }, error: null };
    let outcome = a.p_outcome, charged = Math.min(Math.ceil(a.p_measured_microusd / op.rate), run.amount), result;
    if (op.cancel) { outcome = "cancelled"; result = { cancelled: true }; }
    else if (a.p_outcome === "failed") { charged = 0; result = {}; } // SQL: a failed run stores no detail in its result
    else if (a.p_outcome === "result") result = { ...a.p_detail, data: a.p_candidate.data, basedOnVersion: op.version, persisted: true, finished: true };
    else result = { ...a.p_detail };
    mem.wallet += run.amount - charged;
    Object.assign(run, { status: "finished", outcome, charged, result: { ...result, charged, runId: run.id }, measured: a.p_measured_microusd, detail: a.p_detail });
    op.charged += charged;
    return { data: { ...status(op, run.result), charged, outcome, result: run.result, replayed: false }, error: null };
  },
};
function rpc(name, args) {
  rpcLog.push({ name, args });
  const handler = rpcHandlers[name];
  if (!handler) throw Error(`Unexpected RPC ${name}`);
  return handler(args);
}
const blob = bytes => new Blob([bytes]);
const storage = { from: () => ({
  async download(objectPath) { const bytes = mem.objects.get(objectPath); return bytes ? { data: blob(bytes), error: null } : { data: null, error: new Error("not found") }; },
  async upload(objectPath, bytes) { if (mem.objects.has(objectPath)) return { error: { message: "The resource already exists" } }; mem.objects.set(objectPath, Buffer.from(bytes)); return { error: null }; },
}) };

/** The caller's RLS-bound client: it sees only rows of the workspaces it is a member of. */
function memberClient(workspaces = [W]) {
  const visible = row => !("workspace_id" in row) || workspaces.includes(row.workspace_id);
  function query(table) {
    const filters = []; let limit = Infinity;
    const rows = () => mem.tables[table].filter(row => visible(row) && filters.every(filter => filter(row)));
    const builder = {
      select() { return builder; }, eq(key, value) { filters.push(row => row[key] === value); return builder; }, in(key, values) { filters.push(row => values.includes(row[key])); return builder; },
      limit(n) { limit = n; return builder; },
      async maybeSingle() { return { data: rows()[0] ?? null, error: null }; },
      then(resolve, reject) { return Promise.resolve({ data: rows().slice(0, limit), error: null }).then(resolve, reject); },
      async insert(row) { if (!visible(row)) return { error: { code: "42501" } }; if (mem.tables[table].some(item => item.id === row.id)) return { error: { code: "23505" } }; mem.tables[table].push({ ...row }); return { error: null }; },
    };
    return builder;
  }
  return { from: query, storage, async rpc(name, args) {
    if (name !== "makeborne_save_artifact_version") throw Error(`Unexpected client RPC ${name}`);
    rpcLog.push({ name, args });
    const replay = mem.saves.get(args.p_request_key);
    if (replay) return { data: { ...replay, replayed: true }, error: null };
    const artifact = mem.tables.artifacts.find(row => row.id === args.p_artifact_id && workspaces.includes(row.workspace_id));
    if (!artifact) return { data: null, error: { code: "P0002" } };
    if (artifact.current_version !== args.p_expected_version) return { data: null, error: { code: "PT409" } };
    const listed = new Set(args.p_asset_ids);
    for (const section of args.p_content.sections) for (const block of section.blocks) if (block.assetId && !listed.has(block.assetId)) return { data: null, error: { code: "23514" } };
    for (const asset of args.p_content.websiteSource?.assets ?? []) if (!listed.has(asset.id)) return { data: null, error: { code: "23514" } };
    for (const id of args.p_style.referenceAssetIds) if (!listed.has(id)) return { data: null, error: { code: "23514" } };
    const version = addVersion(args.p_content, args.p_style, args.p_asset_ids, args.p_change_summary);
    const saved = { artifact: { ...artifactRow() }, version };
    mem.saves.set(args.p_request_key, saved);
    return { data: { ...saved, replayed: false }, error: null };
  } };
}
function addVersion(content, style, assetIds, summary = "fixture") {
  const artifact = artifactRow(), number = artifact.current_version + 1;
  const previous = mem.tables.artifact_versions.find(row => row.version_number === artifact.current_version);
  const row = { id: randomUUID(), workspace_id: W, artifact_id: ARTIFACT, version_number: number, parent_version_id: previous?.id ?? null, content: structuredClone(content), style_snapshot: structuredClone(style),
    asset_manifest: [...assetIds], created_at: new Date().toISOString(), created_by: ACTOR, change_summary: summary };
  mem.tables.artifact_versions.push(row);
  artifact.current_version = number; artifact.updated_at = row.created_at;
  return row;
}

const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  if (name.startsWith("@/")) return load.call(this, path.join(__dirname, "../../..", name.slice(2)), parent, main);
  if (/(^|\/)billing\/database$/.test(name)) return { billingDatabase: () => ({ storage, rpc: (n, a) => { const result = Promise.resolve().then(() => rpc(n, a)); result.abortSignal = () => result; return result; } }) };
  if (/(^|\/)credits\/server$/.test(name)) return { HOLD_LIFETIME_MS: 900000 };
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);

const prices = require("../../ai/prices.ts"), editPrices = require("../../ai/image-edit-prices.ts"), health = require("../../ai/image-health.ts");
const contract = require("./contract.ts"), routing = require("./routing.ts"), pixels = require("./pixels.ts"), references = require("./references.ts");
const run = require("./run.ts"), accept = require("./accept.ts"), deterministic = require("./deterministic.ts"), server = require("./server.ts");
const { aiCostUsdPerCredit } = require("../../builder/pricing.ts");
const { resolveWebsiteSourceAssets } = require("../../projects/source-assets.ts");
const { githubSourceSnapshot } = require("../../github/website-sync.ts");
const { publicationArtworkResolver } = require("../../projects/publication-assets.ts");
const { loadDocumentImages } = require("../../documents/export-server.ts");
const responsive = require("../../../../infra/project-runtime/responsive-images.cjs");
const task = require("../../agency/task.ts");
const RATE = Math.round(aiCostUsdPerCredit() * 1_000_000);
const root = path.resolve(__dirname, "../../../..");

// ---- Fixtures: generated here, never read from outside the repository ----
async function picture(width, height, seed = 1, channels = 3) {
  const raw = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * channels;
    raw[index] = (x * seed) % 256; raw[index + 1] = (y * 3 + seed * 40) % 256; raw[index + 2] = ((x + y) * seed) % 256;
    if (channels === 4) raw[index + 3] = 255;
  }
  return sharp(raw, { raw: { width, height, channels } }).png().toBuffer();
}
async function maskPng(width, height, { alpha = true, clearBox = [0.25, 0.25, 0.5, 0.5], format = "png" } = {}) {
  const channels = alpha ? 4 : 3, raw = Buffer.alloc(width * height * channels, 255);
  if (alpha && clearBox) for (let y = Math.floor(clearBox[1] * height); y < Math.floor((clearBox[1] + clearBox[3]) * height); y++)
    for (let x = Math.floor(clearBox[0] * width); x < Math.floor((clearBox[0] + clearBox[2]) * width); x++) raw[(y * width + x) * 4 + 3] = 0;
  const image = sharp(raw, { raw: { width, height, channels } });
  return (format === "jpeg" ? image.jpeg() : image.png()).toBuffer();
}
function registerAsset(bytes, { workspace = W, project = P, contentType = "image/png", provenance = { kind: "user_upload" } } = {}) {
  const id = randomUUID(), objectPath = `${workspace}/${project}/artwork/${id}.${contentType.slice(6)}`;
  mem.objects.set(objectPath, Buffer.from(bytes));
  mem.tables.assets.push({ id, workspace_id: workspace, project_id: project, object_path: objectPath, content_type: contentType, sha256: sha(bytes), provenance });
  return { id, sha256: sha(bytes), objectPath };
}
const STYLE = { id: "automatic", name: "Automatic", version: 1, typography: { headingFont: "Inter", bodyFont: "Inter" }, colors: { accent: "#333333" }, description: "", referenceAssetIds: [] };
function outlineArtifact(assetId) {
  mem.tables.artifacts.push({ id: ARTIFACT, workspace_id: W, project_id: P, kind: "presentation", title: "Deck", current_version: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  const sectionId = randomUUID(), first = randomUUID(), second = randomUUID();
  addVersion({ schemaVersion: 1, kind: "presentation", title: "Deck", sections: [{ id: sectionId, title: "One", blocks: [
    { id: first, type: "image", text: "Hero", assetId, locked: false, sourceIds: [] }, { id: second, type: "image", text: "Again", assetId, locked: false, sourceIds: [] }] }] }, STYLE, [assetId]);
  return { sectionId, first, second };
}

// Measured cells for the harness only (the shipped table is empty).
const TABLE = Object.freeze({
  "gpt-image-2.5-sunburst": { medium: { "1024x1024": { inputImageTokens: 1200, maskTextTokens: 200, outputTokens: 450, evidence: "offline fixture" }, "1536x1024": { inputImageTokens: 1600, maskTextTokens: 200, outputTokens: 360, evidence: "offline fixture" } } },
  "gpt-image-2.5-flare": { medium: { "1024x1024": { inputImageTokens: 1200, outputTokens: 450, evidence: "offline fixture" } } },
  "gpt-image-2": { medium: { "1024x1024": { inputImageTokens: 1200, outputTokens: 1785, evidence: "offline fixture" } } },
});
const ALLOWED = ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare"];
const SETTINGS = Object.freeze([Object.freeze({ profile: "standard", model: "claude-sonnet-5-5", effort: "medium", intensity: "medium", maxOutputTokens: 4000, maxTurns: 6, qualifiedKinds: Object.freeze(["image_edit"]), evidence: "offline fixture" })]);

let plan, imageBehaviour, editedPng;
function fakeModel() {
  return async request => {
    modelCalls++;
    const ticket = await request.spend.begin("anthropic", "claude-sonnet-5-5", 20000);
    await request.spend.finish(ticket, { actualMicrousd: 6000 });
    return { content: [{ type: "tool_use", id: `toolu_${randomUUID().slice(0, 8)}`, name: "submit_result", input: plan }], stopReason: "tool_use" };
  };
}
const imageClient = { images: { async edit(body, options) {
  imageCalls.push({ body, options });
  return imageBehaviour(body, options);
} } };
const usage = (output = 400, image = 1100, text = 300) => ({ input_tokens: image + text, output_tokens: output, total_tokens: image + text + output, input_tokens_details: { image_tokens: image, text_tokens: text } });
const okResponse = (bytes = editedPng, extra = {}) => async () => ({ data: [{ b64_json: bytes.toString("base64") }], output_format: "png", usage: usage(), ...extra });
function deps(extra = {}) {
  const client = memberClient();
  return { client, deps: { env: { MAKEBORNE_IMAGE_EDITING: "on", MAKEBORNE_AGENCY_TASKS: "on", MAKEBORNE_AGENCY_TASK_KINDS: "image_edit" }, assets: server.projectEditAssets(client, { workspaceId: W, projectId: P }), model: fakeModel(), imageClient, toUpload: async upload => upload,
    rateMicrousd: RATE, platformDeadline: Date.now() + 280000, settings: SETTINGS, table: TABLE, allowedModels: ALLOWED, pollMs: 20, heartbeatMs: 1000,
    readInput: () => async index => JSON.stringify({ input: index, note: "Image content is not included in this step." }), ...extra } };
}
function body(asset, extra = {}) {
  return { artifactId: ARTIFACT, actionKey: randomUUID(), stepKey: randomUUID(), asset: { id: asset.id, sha256: asset.sha256 }, operation: "background_replace",
    instruction: "Replace the grey wall behind the product with a sunlit garden.", settings: { size: "1024x1024", quality: "medium", background: "opaque" },
    ceilingCredits: 40, expectedRevision: artifactRow().current_version, ...extra };
}
const assetsCount = () => mem.tables.assets.length;
const opRpcs = () => rpcLog.filter(entry => entry.name.startsWith("makeborne_ai_operation") || entry.name === "makeborne_agency_task_scope").length;
async function rejects(promise, code) { await assert.rejects(promise, error => { assert.equal(error.code, code, `expected ${code}, got ${error.code}: ${error.message}`); return true; }); }
const NAMES = /gpt|openai|claude|anthropic|sunburst|flare|sonnet|opus/i;

let passed = 0;
async function check(name, fn) {
  fresh(); health.clearImageOverrun();
  plan = { instruction: "Replace the grey wall behind the product with a sunlit garden with soft morning light; keep the product, its label and the table unchanged.", preserve: ["the product label"], deterministic: "none", fidelityCritical: false, summary: "Swap the wall for a sunlit garden." };
  imageBehaviour = okResponse();
  await fn(); passed++; console.log(`PASS ${name}`);
}

(async () => {
  editedPng = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: { r: 30, g: 160, b: 70 } } }).png().toBuffer();

  await check("price evidence: only the cells measured live (2026-10-24 qualification) are bounded; every other model x quality x size is refused; no assumptions from generation prices", async () => {
    const measured = { "gpt-image-2.5-sunburst": ["1024x1024", "1536x1024"], "gpt-image-2.5-flare": ["1024x1024", "1536x1024"], "gpt-image-2": ["1024x1024"] };
    assert.deepEqual(Object.fromEntries(Object.entries(editPrices.MEASURED_EDIT_TOKENS).map(([model, cells]) => [model, Object.keys(cells.medium ?? {}).sort()])), measured, "medium cells only, from the recorded run");
    assert.ok(Object.values(editPrices.MEASURED_EDIT_TOKENS).every(cells => Object.keys(cells).every(quality => quality === "medium")));
    assert.ok(Object.values(editPrices.MEASURED_EDIT_TOKENS).flatMap(cells => Object.values(cells.medium)).every(cell => /agency-qualification-20261024/.test(cell.evidence) && /sign-off/.test(cell.evidence)), "evidence names the run and the pending D8 sign-off");
    for (const model of ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-2", "gpt-image-1", "gpt-image-1.5", "dall-e-2"])
      for (const quality of ["low", "medium", "high"]) for (const size of ["1024x1024", "1536x1024", "1024x1536"]) {
        const shape = { model, quality, size, images: 1, mask: false, background: "opaque", prompt: "x" };
        if (quality === "medium" && measured[model]?.includes(size)) assert.ok(editPrices.imageEditCallBoundMicrousd(shape).boundMicrousd > 0, `${model} ${size} is bounded`);
        else assert.throws(() => editPrices.imageEditCallBoundMicrousd(shape), prices.UnsupportedConfigurationError, `${model} ${quality} ${size}`);
        assert.throws(() => editPrices.imageEditCallBoundMicrousd(shape, {}), prices.UnsupportedConfigurationError, "an empty table refuses everything");
      }
    // Masks only where masked calls were measured (Sunburst); transparency never on gpt-image-2.
    assert.throws(() => editPrices.imageEditCallBoundMicrousd({ model: "gpt-image-2.5-flare", quality: "medium", size: "1024x1024", images: 1, mask: true, background: "opaque", prompt: "x" }), /mask/);
    assert.throws(() => editPrices.imageEditCallBoundMicrousd({ model: "gpt-image-2", quality: "medium", size: "1024x1024", images: 1, mask: false, background: "transparent", prompt: "x" }), /transparent/);
    // gpt-image-1 is retired today even with a cell; the generic image-input refusal on generation is unchanged.
    assert.throws(() => editPrices.assertSupportedImageEditRequest({ model: "gpt-image-1", quality: "medium", size: "1024x1024", images: 1, mask: false, background: "opaque" }, { "gpt-image-1": TABLE["gpt-image-2.5-sunburst"] }, Date.parse("2026-10-23T12:00:00Z")), /retired/);
    assert.throws(() => prices.assertSupportedImageRequest({ model: "gpt-image-2", quality: "medium", size: "1024x1024", hasImageInput: true }), /image input/);
    assert.ok(editPrices.IMAGE_EDIT_EVIDENCE.every(item => item.verifiedAt === "2026-10-23"), "evidence dated at implementation time");
    assert.equal(editPrices.IMAGE_EDIT_EVIDENCE.find(item => item.model === "gpt-image-2.5-sunburst").inputImageTokens, "unpublished");
    assert.equal(routing.allowedEditModels({ OPENAI_API_KEY: "test-key-not-a-secret" }).length, 0, "no operator allowlist: no edit model");
    assert.equal(routing.routeImageEdit({ operation: "variant", settings: { size: "1024x1024", quality: "medium", background: "opaque" }, images: 1, mask: false }, ALLOWED, {}).ok, false, "allowlisted but unmeasured: refused");
    assert.equal(routing.routeImageEdit({ operation: "variant", settings: { size: "1024x1536", quality: "medium", background: "opaque" }, images: 1, mask: false }, ALLOWED).ok, false, "a shipped but unmeasured size: refused");
  });

  await check("price bound: text + every input image + mask + output at standard rates, headroom 1.5, x1.1; unsupported request shapes refused", async () => {
    const bound = editPrices.imageEditCallBoundMicrousd({ model: "gpt-image-2.5-sunburst", quality: "medium", size: "1024x1024", images: 2, mask: true, background: "opaque", prompt: "a".repeat(100) }, TABLE);
    const text = 100 + 64 + Math.ceil(200 * 1.5), perImage = Math.ceil(1200 * 1.5), output = Math.ceil(450 * 1.5);
    assert.equal(bound.boundMicrousd, Math.ceil((text * 5 + 3 * perImage * 8 + output * 30) * 1.1 + 1e-6));
    assert.equal(bound.inputImages, 3, "source, reference and the mask");
    const base = { model: "gpt-image-2.5-sunburst", quality: "medium", size: "1024x1024", images: 1, mask: false, background: "opaque" };
    for (const bad of [{ quality: "xhigh" }, { quality: "auto" }, { size: "auto" }, { size: "1536x864" }, { n: 2 }, { stream: true }, { partialImages: 2 }, { inputFidelity: "high" }, { images: 5 }, { images: 0 }, { background: "auto" }])
      assert.throws(() => editPrices.assertSupportedImageEditRequest({ ...base, ...bad }, TABLE), prices.UnsupportedConfigurationError, JSON.stringify(bad));
    assert.throws(() => editPrices.assertSupportedImageEditRequest({ ...base, model: "gpt-image-2", background: "transparent" }, TABLE), /transparent/, "gpt-image-2 transparency is preview only");
    assert.throws(() => editPrices.assertSupportedImageEditRequest({ ...base, model: "gpt-image-2.5-flare", mask: true }, TABLE), /mask/, "mask instructions unmeasured on that cell");
    assert.notEqual(editPrices.imageEditPriceCardVersion({}), editPrices.imageEditPriceCardVersion(TABLE), "price card version follows the evidence");
    assert.equal(editPrices.imageEditUsageMicrousd("gpt-image-2.5-sunburst", usage(400, 1100, 300)), 300 * 5 + 1100 * 8 + 400 * 30);
  });

  await check("flag off, unqualified settings and unsupported routes refuse before any operation, hold or call", async () => {
    const original = registerAsset(await picture(1024, 1024)); outlineArtifact(original.id);
    const { deps: d } = deps();
    await rejects(run.runImageEdit(ACTOR, body(original), { ...d, env: {} }), "IMAGE_EDITING_UNAVAILABLE");
    // Image editing alone never starts paid agency work: the agency switch is required too (S3).
    await rejects(run.runImageEdit(ACTOR, body(original), { ...d, env: { MAKEBORNE_IMAGE_EDITING: "on" } }), "IMAGE_EDITING_UNAVAILABLE");
    await rejects(run.estimateImageEdit(body(original), { ...d, env: { MAKEBORNE_IMAGE_EDITING: "on", MAKEBORNE_AGENCY_TASKS: "true", MAKEBORNE_AGENCY_TASK_KINDS: "image_edit" } }), "IMAGE_EDITING_UNAVAILABLE");
    // The agency switch alone is not enough: image_edit must be listed (S4).
    await rejects(run.runImageEdit(ACTOR, body(original), { ...d, env: { MAKEBORNE_IMAGE_EDITING: "on", MAKEBORNE_AGENCY_TASKS: "on" } }), "IMAGE_EDITING_UNAVAILABLE");
    await rejects(run.runImageEdit(ACTOR, body(original), { ...d, env: { MAKEBORNE_IMAGE_EDITING: "on", MAKEBORNE_AGENCY_TASKS: "on", MAKEBORNE_AGENCY_TASK_KINDS: "research, data_report" } }), "IMAGE_EDITING_UNAVAILABLE");
    await rejects(run.runImageEdit(ACTOR, body(original), { ...d, settings: [] }), "AGENCY_SETTINGS_UNQUALIFIED");
    assert.ok(task.AGENCY_SETTINGS.some(setting => setting.qualifiedKinds.includes("image_edit")), "shipped registry: image_edit proposed after the 2026-10-24 qualification (flags remain off)");
    await rejects(run.runImageEdit(ACTOR, body(original), { ...d, table: {} }), "EDIT_UNSUPPORTED");
    await rejects(run.runImageEdit(ACTOR, body(original), { ...d, allowedModels: [] }), "EDIT_UNSUPPORTED");
    assert.equal(contract.imageEditingEnabled({}), false); assert.equal(contract.imageEditingEnabled({ MAKEBORNE_IMAGE_EDITING: "true" }), false);
    assert.equal(opRpcs() + imageCalls.length + modelCalls, 0);
  });

  await check("unauthorized assets: another project or another workspace is indistinguishable from missing; nothing is reserved", async () => {
    const original = registerAsset(await picture(1024, 1024)); outlineArtifact(original.id);
    const elsewhere = registerAsset(await picture(1024, 1024, 2), { project: OTHER_P }), foreign = registerAsset(await picture(1024, 1024, 3), { workspace: OTHER_W, project: randomUUID() });
    const { deps: d } = deps();
    await rejects(run.runImageEdit(ACTOR, body(elsewhere), d), "EDIT_ASSET_UNAVAILABLE");
    await rejects(run.runImageEdit(ACTOR, body(foreign), d), "EDIT_ASSET_UNAVAILABLE");
    await rejects(run.runImageEdit(ACTOR, body(original, { references: [{ id: elsewhere.id, sha256: elsewhere.sha256 }] }), d), "EDIT_ASSET_UNAVAILABLE");
    // Browser-chosen scope fields are refused outright.
    for (const extra of [{ workspaceId: W }, { projectId: P }, { model: "gpt-image-2.5-sunburst" }, { actorId: ACTOR }]) await rejects(run.runImageEdit(ACTOR, body(original, extra), d), "EDIT_REQUEST_INVALID");
    // The SQL scope check is the second line: an asset outside the task scope never gets a hold.
    const scoped = deps({ assets: { read: async () => ({ id: foreign.id, sha256: foreign.sha256, contentType: "image/png", bytes: mem.objects.get(foreign.objectPath), provenance: null }), store: async () => { throw Error("never"); } } });
    await rejects(run.runImageEdit(ACTOR, body(foreign), scoped.deps), "AGENCY_SCOPE_FORBIDDEN");
    assert.equal(imageCalls.length + modelCalls, 0);
    assert.equal(rpcLog.filter(entry => entry.name === "makeborne_ai_operation_begin").length, 0);
  });

  await check("invalid masks: wrong size, no alpha, nothing or everything marked, not PNG, too large", async () => {
    const original = registerAsset(await picture(1024, 1024)); outlineArtifact(original.id);
    const { deps: d } = deps();
    const cases = [[await maskPng(512, 512), "EDIT_MASK_INVALID"], [await maskPng(1024, 1024, { alpha: false }), "EDIT_MASK_INVALID"], [await maskPng(1024, 1024, { clearBox: null }), "EDIT_MASK_INVALID"],
      [await maskPng(1024, 1024, { clearBox: [0, 0, 1, 1] }), "EDIT_MASK_INVALID"], [await maskPng(1024, 1024, { alpha: false, format: "jpeg" }), "EDIT_MASK_INVALID"]];
    for (const [mask, code] of cases) await rejects(run.runImageEdit(ACTOR, body(original, { mask: { pngBase64: mask.toString("base64") } }), d), code);
    await rejects(run.runImageEdit(ACTOR, body(original, { mask: { pngBase64: "A".repeat(contract.EDIT_LIMITS.maskBase64Chars + 4) } }), d), "EDIT_REQUEST_INVALID");
    await rejects(run.runImageEdit(ACTOR, body(original, { operation: "extend", settings: { size: "1536x1024", quality: "medium", background: "opaque" }, mask: { pngBase64: (await maskPng(1024, 1024)).toString("base64") } }), d), "EDIT_REQUEST_INVALID");
    assert.equal(opRpcs() + imageCalls.length + modelCalls, 0);
  });

  await check("huge or changed inputs and unsupported settings are refused before any reservation", async () => {
    const original = registerAsset(await picture(1024, 1024)); outlineArtifact(original.id);
    const { deps: d } = deps();
    const huge = registerAsset(Buffer.alloc(contract.EDIT_LIMITS.sourceBytes + 1, 1));
    await rejects(run.runImageEdit(ACTOR, body(huge), d), "EDIT_INPUT_TOO_LARGE");
    const giant = registerAsset(await sharp({ create: { width: 5000, height: 5000, channels: 3, background: "#808080" } }).png({ compressionLevel: 9 }).toBuffer());
    await rejects(run.runImageEdit(ACTOR, body(giant), d), "EDIT_INPUT_INVALID");
    await rejects(run.runImageEdit(ACTOR, body({ id: original.id, sha256: "0".repeat(64) }), d), "EDIT_INPUT_CHANGED");
    const refs = Array.from({ length: 4 }, () => ({ id: randomUUID(), sha256: "a".repeat(64) }));
    await rejects(run.runImageEdit(ACTOR, body(original, { references: refs }), d), "EDIT_REQUEST_INVALID");
    for (const settings of [{ size: "512x512", quality: "medium", background: "opaque" }, { size: "1024x1024", quality: "xhigh", background: "opaque" }, { size: "1024x1024", quality: "auto", background: "opaque" }])
      await rejects(run.runImageEdit(ACTOR, body(original, { settings }), d), "EDIT_REQUEST_INVALID");
    await rejects(run.runImageEdit(ACTOR, body(original, { settings: { size: "1024x1024", quality: "high", background: "opaque" } }), d), "EDIT_UNSUPPORTED");
    await rejects(run.runImageEdit(ACTOR, body(original, { operation: "cutout" }), d), "EDIT_REQUEST_INVALID");
    await rejects(run.runImageEdit(ACTOR, body(original, { settings: { size: "1536x1024", quality: "medium", background: "opaque" } }), d), "EDIT_ASPECT_MISMATCH");
    await rejects(run.runImageEdit(ACTOR, body(original, { ceilingCredits: 1 }), d), "EDIT_CEILING_TOO_LOW");
    assert.equal(opRpcs() + imageCalls.length + modelCalls, 0);
  });

  await check("happy path: one instruction step, one budgeted edit call, a NEW asset; original bytes and record unchanged; no model names for the customer", async () => {
    const sourceBytes = await picture(1024, 1024);
    const original = registerAsset(sourceBytes); outlineArtifact(original.id);
    const before = { bytes: Buffer.from(mem.objects.get(original.objectPath)), row: structuredClone(mem.tables.assets.find(row => row.id === original.id)) };
    const { deps: d } = deps();
    const estimate = await run.estimateImageEdit(body(original), d);
    assert.ok(estimate.credits >= 1 && /Maximum estimate/.test(estimate.label));
    assert.equal(opRpcs() + imageCalls.length + modelCalls, 0, "an estimate reserves and calls nothing");
    const view = await run.runImageEdit(ACTOR, body(original, { ceilingCredits: estimate.credits }), d);
    assert.equal(view.state, "candidate", view.message);
    assert.equal(modelCalls, 1); assert.equal(imageCalls.length, 1, "exactly one generation");
    const call = imageCalls[0];
    assert.equal(call.options.maxRetries, 0); assert.ok(call.options.timeout <= 180000 && call.options.signal);
    assert.equal(call.body.n, 1); assert.equal(call.body.stream, false); assert.equal(call.body.partial_images, undefined); assert.equal(call.body.input_fidelity, undefined);
    assert.equal(call.body.model, "gpt-image-2.5-sunburst", "precision edits use the precision model");
    assert.equal(call.body.image.length, 1); assert.equal(call.body.mask, undefined);
    const sent = await sharp(call.body.image[0].bytes).metadata();
    assert.deepEqual([sent.format, sent.width, sent.height], ["png", 1024, 1024], "the source is sent normalised to the output size");
    assert.match(call.body.prompt, /sunlit garden/); assert.match(call.body.prompt, /product label/);
    const stored = mem.tables.assets.find(row => row.id === view.candidate.candidate.assetId);
    assert.ok(stored && stored.id !== original.id, "a new asset");
    assert.equal(stored.provenance.kind, "image_edit"); assert.equal(stored.provenance.of, original.id); assert.equal(stored.provenance.ofSha256, original.sha256);
    assert.equal(stored.provenance.model, "gpt-image-2.5-sunburst", "operators keep the exact model");
    assert.match(stored.provenance.priceCard, /^image-edit-[a-f0-9]{16}$/); assert.ok(stored.provenance.usage.output_tokens === 400 && stored.provenance.operationId);
    assert.ok(mem.objects.get(original.objectPath).equals(before.bytes), "original bytes unchanged");
    assert.deepEqual(mem.tables.assets.find(row => row.id === original.id), before.row, "original record unchanged");
    assert.doesNotMatch(JSON.stringify(view), NAMES, "customer view carries no provider or model names");
    assert.equal(artifactRow().current_version, 1, "nothing applied before acceptance");
    const charged = [...mem.ops.values()][0].charged;
    const confirmed = [...mem.calls.values()].reduce((total, item) => total + item.charged, 0);
    assert.ok(view.charged === charged && charged <= estimate.credits && charged >= Math.ceil(10 / RATE), `charged ${charged} within estimate ${estimate.credits}`);
    assert.ok([...mem.calls.values()].every(item => item.status === "settled") && confirmed > 0);
  });

  await check("duplicate submission: same action and step keys replay both recorded steps with no call and no second charge", async () => {
    const original = registerAsset(await picture(1024, 1024)); outlineArtifact(original.id);
    const { deps: d } = deps();
    const request = body(original);
    const first = await run.runImageEdit(ACTOR, request, d);
    const charged = [...mem.ops.values()][0].charged, assets = assetsCount();
    const second = await run.runImageEdit(ACTOR, request, d);
    assert.equal(second.replayed, true); assert.deepEqual(second.candidate, first.candidate);
    assert.equal(modelCalls, 1); assert.equal(imageCalls.length, 1);
    assert.equal([...mem.ops.values()][0].charged, charged); assert.equal(assetsCount(), assets);
    assert.equal(mem.ops.size, 1); assert.equal(mem.runs.size, 2, "one instruction run and one generation run");
  });

  await check("timeout after possible provider execution: recorded as uncertain at its bound, never retried, customer told and not charged for it", async () => {
    const original = registerAsset(await picture(1024, 1024)); outlineArtifact(original.id);
    const { deps: d } = deps();
    imageBehaviour = async (_body, options) => { await new Promise(resolve => setTimeout(resolve, 5)); const error = new Error("Request timed out."); void options; throw error; };
    const assets = assetsCount(), request = body(original);
    const view = await run.runImageEdit(ACTOR, request, d);
    assert.equal(view.state, "uncertain"); assert.match(view.message, /may have started/); assert.match(view.message, /no new attempt/);
    assert.equal(imageCalls.length, 1, "no automatic retry");
    const openai = [...mem.calls.values()].find(item => item.provider === "openai");
    assert.equal(openai.status, "uncertain"); assert.equal(openai.charged, openai.bound, "provider exposure recorded at the bound");
    const generation = [...mem.runs.values()].find(item => item.detail?.editCode);
    assert.equal(generation.outcome, "failed"); assert.equal(generation.charged, 0, "the uncertain edit is not charged to the customer");
    assert.equal(assetsCount(), assets, "nothing stored");
    const again = await run.runImageEdit(ACTOR, request, d);
    assert.equal(again.replayed, true); assert.notEqual(again.state, "candidate"); assert.equal(imageCalls.length, 1, "replay makes no call");
  });

  await check("insufficient budget: wallet empty or hold below the bound refuses before the image call", async () => {
    const original = registerAsset(await picture(1024, 1024)); outlineArtifact(original.id);
    const { deps: d } = deps();
    mem.wallet = 0;
    await rejects(run.runImageEdit(ACTOR, body(original), d), "INSUFFICIENT_CREDITS");
    assert.equal(imageCalls.length + modelCalls, 0);
    // Enough for the instruction step only: the image's bound does not fit the remaining hold.
    fresh(); const second = registerAsset(await picture(1024, 1024)); outlineArtifact(second.id);
    const prepareCredits = Math.ceil(run.PREPARE_STEP.maxTurns * prices.textCallBoundMicrousd("claude-sonnet-5-5", run.PREPARE_STEP.inputTokens, run.PREPARE_STEP.maxOutputTokens) / RATE);
    mem.wallet = prepareCredits; // the instruction step settles 1 credit, leaving less than the edit call's bound
    const view = await run.runImageEdit(ACTOR, body(second), deps().deps);
    assert.equal(view.state, "failed"); assert.match(view.message, /more credits/);
    assert.equal(imageCalls.length, 0, "no provider contact without room for the bound");
    assert.equal([...mem.calls.values()].filter(item => item.provider === "openai").length, 0);
  });

  await check("malformed provider output: nothing stored, usage still recorded, no charge for the edit", async () => {
    const original = registerAsset(await picture(1024, 1024)); outlineArtifact(original.id);
    const jpeg = await sharp(editedPng).jpeg().toBuffer(), small = await sharp(editedPng).resize(512, 512).png().toBuffer();
    const behaviours = [okResponse(jpeg), okResponse(small), async () => ({ data: [{ b64_json: "not base64!!" }], usage: usage() }),
      async () => ({ data: [{ b64_json: editedPng.toString("base64") }, { b64_json: editedPng.toString("base64") }], usage: usage() }), async () => ({ data: [], usage: usage() }), async () => null];
    for (const behaviour of behaviours) {
      imageBehaviour = behaviour;
      const assets = assetsCount();
      const view = await run.runImageEdit(ACTOR, body(original), deps().deps);
      assert.equal(view.state, "failed"); assert.match(view.message, /unusable|could not be made/);
      assert.equal(assetsCount(), assets, "a malformed result is never stored");
    }
    const generations = [...mem.runs.values()].filter(item => item.detail?.editCode);
    assert.ok(generations.every(item => item.charged === 0 && item.outcome === "failed"));
    assert.ok([...mem.calls.values()].filter(item => item.provider === "openai").slice(0, 4).every(item => item.status === "settled"), "usage present: settled at its actual cost");
    assert.equal([...mem.calls.values()].filter(item => item.provider === "openai").at(-1).status, "uncertain", "no usage: recorded at the bound");
  });

  await check("overrun: usage above the bound stops routing to the model and trips the provider emergency stop; no further calls", async () => {
    const original = registerAsset(await picture(1024, 1024)); outlineArtifact(original.id);
    imageBehaviour = async () => ({ data: [{ b64_json: editedPng.toString("base64") }], usage: usage(20000) });
    const errors = []; const log = console.error; console.error = message => errors.push(String(message));
    try { await run.runImageEdit(ACTOR, body(original), deps().deps); } finally { console.error = log; }
    assert.ok(errors.some(line => /image_model_overrun/.test(line)));
    assert.equal(health.imageModelDisabled("gpt-image-2.5-sunburst"), true);
    assert.equal(mem.emergency, true, "dollar excess reaches the incident policy");
    await rejects(run.runImageEdit(ACTOR, body(original), deps().deps), "EDIT_UNSUPPORTED");
    assert.equal(imageCalls.length, 1);
  });

  await check("deterministic is enough: the instruction step says so and no image call is made", async () => {
    const original = registerAsset(await picture(1024, 1024)); outlineArtifact(original.id);
    plan = { ...plan, deterministic: "resize", summary: "Only a smaller size is needed." };
    const view = await run.runImageEdit(ACTOR, body(original, { instruction: "Make this image smaller for the web." }), deps().deps);
    assert.equal(view.state, "deterministic"); assert.equal(imageCalls.length, 0);
  });

  await check("protected regions are composited back exactly and acceptance then requires review", async () => {
    const sourceBytes = await picture(1024, 1024, 5);
    const original = registerAsset(sourceBytes); const { sectionId, first } = outlineArtifact(original.id);
    const region = { x: 0.1, y: 0.1, width: 0.2, height: 0.1 };
    const view = await run.runImageEdit(ACTOR, body(original, { protect: [region] }), deps().deps);
    assert.equal(view.state, "candidate"); assert.equal(view.candidate.reviewRequired, true);
    const stored = mem.tables.assets.find(row => row.id === view.candidate.candidate.assetId);
    const bytes = mem.objects.get(stored.object_path);
    const rect = pixels.regionRects([region], { left: 0, top: 0, width: 1024, height: 1024 })[0];
    const normalised = await sharp(sourceBytes).resize(1024, 1024, { fit: "fill" }).ensureAlpha().png().toBuffer();
    assert.ok((await pixels.regionPixels(bytes, rect)).equals(await pixels.regionPixels(normalised, rect)), "protected pixels are the original's, exactly (lossless storage)");
    const outside = { left: 600, top: 600, width: 50, height: 50 };
    assert.ok(!(await pixels.regionPixels(bytes, outside)).equals(await pixels.regionPixels(normalised, outside)), "the rest is the edit");
    const client = memberClient();
    const input = { artifactId: ARTIFACT, acceptKey: randomUUID(), originalAssetId: original.id, candidateAssetId: stored.id, expectedVersion: 1, references: [{ kind: "block", sectionId, blockId: first }] };
    await rejects(accept.acceptImageEdit(client, { workspaceId: W, actor: ACTOR }, input, { env: { MAKEBORNE_IMAGE_EDITING: "on" } }), "EDIT_REVIEW_REQUIRED");
    const done = await accept.acceptImageEdit(client, { workspaceId: W, actor: ACTOR }, { ...input, reviewed: true }, { env: { MAKEBORNE_IMAGE_EDITING: "on" } });
    assert.equal(done.version.number, 2);
  });

  await check("extend: the source keeps its pixels on a larger canvas and the mask is built from it", async () => {
    const original = registerAsset(await picture(1024, 1024)); outlineArtifact(original.id);
    imageBehaviour = okResponse(await sharp({ create: { width: 1536, height: 1024, channels: 3, background: "#406080" } }).png().toBuffer());
    const view = await run.runImageEdit(ACTOR, body(original, { operation: "extend", settings: { size: "1536x1024", quality: "medium", background: "opaque" }, instruction: "Extend the room to the left and right." }), deps().deps);
    assert.equal(view.state, "candidate");
    const call = imageCalls[0];
    assert.ok(call.body.mask, "an extension mask is sent");
    const alpha = await sharp(call.body.mask.bytes).extractChannel(3).raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([alpha.info.width, alpha.info.height], [1536, 1024]);
    assert.equal(alpha.data[0], 0, "the new border is editable"); assert.equal(alpha.data[512 * 1536 + 768], 255, "the original area is kept");
    assert.match(call.body.prompt, /empty area around/);
  });

  await check("ordinary processing: resize, crop, compress and exact composite make new assets with no operation and no model call", async () => {
    const original = registerAsset(await picture(800, 600)); outlineArtifact(original.id);
    const logo = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 200, g: 20, b: 20, alpha: 1 } } }).png().toBuffer();
    const overlay = registerAsset(logo);
    const env = { MAKEBORNE_IMAGE_EDITING: "on" }, assets = server.projectEditAssets(memberClient(), { workspaceId: W, projectId: P });
    for (const op of [{ type: "resize", width: 400, height: 300, fit: "cover" }, { type: "crop", region: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } }, { type: "compress", quality: 60 },
      { type: "composite", overlay: { id: overlay.id, sha256: overlay.sha256 }, region: { x: 0, y: 0, width: 0.08, height: 0.1066 } }]) {
      const result = await deterministic.runDeterministicEdit({ artifactId: ARTIFACT, asset: { id: original.id, sha256: original.sha256 }, op }, { assets, env });
      const row = mem.tables.assets.find(item => item.id === result.candidate.candidate.assetId);
      assert.equal(row.provenance.kind, "image_edit_deterministic"); assert.equal(result.charged, 0);
      if (op.type === "composite") {
        const pixel = await sharp(mem.objects.get(row.object_path)).extract({ left: 10, top: 10, width: 1, height: 1 }).raw().toBuffer();
        assert.deepEqual([...pixel.subarray(0, 3)], [200, 20, 20], "the logo's pixels are placed exactly");
      }
    }
    assert.equal(opRpcs() + imageCalls.length + modelCalls, 0);
  });

  await check("acceptance switches only the chosen block; stale acceptance and mismatched references change nothing", async () => {
    const original = registerAsset(await picture(1024, 1024)); const { sectionId, first, second } = outlineArtifact(original.id);
    const view = await run.runImageEdit(ACTOR, body(original), deps().deps);
    const client = memberClient(), env = { MAKEBORNE_IMAGE_EDITING: "on" };
    const candidateId = view.candidate.candidate.assetId;
    const input = { artifactId: ARTIFACT, acceptKey: randomUUID(), originalAssetId: original.id, candidateAssetId: candidateId, expectedVersion: 1, references: [{ kind: "block", sectionId, blockId: second }] };
    const uses = await accept.editableUses(client, { workspaceId: W, actor: ACTOR }, ARTIFACT, original.id);
    assert.deepEqual(uses.asset, { id: original.id, sha256: original.sha256 }); assert.equal(uses.uses.filter(use => use.kind === "block").length, 2);
    await rejects(accept.acceptImageEdit(client, { workspaceId: W, actor: ACTOR }, { ...input, references: [{ kind: "block", sectionId, blockId: randomUUID() }] }, { env }), "EDIT_REFERENCE_MISMATCH");
    // Another save lands first: the comparison is stale.
    addVersion(mem.tables.artifact_versions.at(-1).content, STYLE, [original.id], "someone else");
    const versions = mem.tables.artifact_versions.length;
    await rejects(accept.acceptImageEdit(client, { workspaceId: W, actor: ACTOR }, input, { env }), "EDIT_STALE");
    assert.equal(mem.tables.artifact_versions.length, versions, "stale: the expected-version check refuses the save");
    assert.equal(artifactRow().current_version, 2);
    assert.ok(mem.tables.artifact_versions.at(-1).content.sections[0].blocks.every(block => block.assetId === original.id), "nothing switched");
    const done = await accept.acceptImageEdit(client, { workspaceId: W, actor: ACTOR }, { ...input, expectedVersion: 2 }, { env });
    const blocks = done.version.content.sections[0].blocks;
    assert.equal(blocks.find(block => block.id === first).assetId, original.id, "unchosen use keeps the original");
    assert.equal(blocks.find(block => block.id === second).assetId, candidateId, "chosen use shows the edit");
    assert.ok(done.version.assetIds.includes(original.id) && done.version.assetIds.includes(candidateId));
    const replay = await accept.acceptImageEdit(client, { workspaceId: W, actor: ACTOR }, { ...input, expectedVersion: 2 }, { env });
    assert.equal(replay.replayed, true); assert.equal(artifactRow().current_version, 3, "same accept key: one version");
    // A candidate that is not an edit of this original is refused.
    const unrelated = registerAsset(await picture(1024, 1024, 9));
    await rejects(accept.acceptImageEdit(client, { workspaceId: W, actor: ACTOR }, { ...input, acceptKey: randomUUID(), expectedVersion: 3, candidateAssetId: unrelated.id }, { env }), "EDIT_ASSET_UNAVAILABLE");
    await rejects(accept.acceptImageEdit(memberClient([OTHER_W]), { workspaceId: OTHER_W, actor: ACTOR }, { ...input, expectedVersion: 3 }, { env }), "NOT_FOUND");
  });

  await check("website: accept one use; source assets, responsive copies, GitHub export and the publication resolver all serve the accepted bytes, and the original elsewhere", async () => {
    const hero = await picture(1024, 1024, 4);
    const original = registerAsset(hero);
    const packageJson = fs.readFileSync(path.join(root, "infra/project-runtime/toolchain/package.json"), "utf8"), packageLock = fs.readFileSync(path.join(root, "infra/project-runtime/toolchain/package-lock.json"), "utf8");
    const app = 'export default function App(){return <main><img src="/images/hero.png" alt="Hero"/><section><img src="/images/hero.png" alt="Again"/></section></main>}';
    const source = { schemaVersion: 1, toolchainId: "react-vite-v1", entrypoint: "src/main.tsx", routes: [{ path: "/", title: "Home" }],
      files: [{ path: "index.html", content: '<!doctype html><html lang="en"><head><title>Site</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>' },
        { path: "src/main.tsx", content: 'import {createRoot} from "react-dom/client"; import App from "./App"; createRoot(document.getElementById("root")!).render(<App/>);' },
        { path: "src/App.tsx", content: app }, { path: "package.json", content: packageJson }, { path: "package-lock.json", content: packageLock }],
      assets: [{ id: original.id, path: "public/images/hero.png", sha256: original.sha256, bytes: hero.length, mediaType: "image/png" }] };
    mem.tables.artifacts.push({ id: ARTIFACT, workspace_id: W, project_id: P, kind: "website", title: "Site", current_version: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    addVersion({ schemaVersion: 1, kind: "website", title: "Site", sections: [], websiteSource: source }, STYLE, [original.id]);
    const view = await run.runImageEdit(ACTOR, body(original), deps().deps);
    const client = memberClient(), env = { MAKEBORNE_IMAGE_EDITING: "on" }, scope = { workspaceId: W, projectId: P };
    const uses = (await accept.editableUses(client, { workspaceId: W, actor: ACTOR }, ARTIFACT, original.id)).uses;
    assert.equal(uses.filter(use => use.kind === "website_occurrence").length, 2);
    const done = await accept.acceptImageEdit(client, { workspaceId: W, actor: ACTOR }, { artifactId: ARTIFACT, acceptKey: randomUUID(), originalAssetId: original.id,
      candidateAssetId: view.candidate.candidate.assetId, expectedVersion: 1, references: [{ kind: "website_occurrence", path: "public/images/hero.png", file: "src/App.tsx", occurrence: 1 }] }, { env });
    const next = done.version.content.websiteSource, candidate = mem.tables.assets.find(row => row.id === view.candidate.candidate.assetId);
    const newPath = next.assets.find(asset => asset.id === candidate.id).path;
    assert.match(newPath, /^public\/images\/hero-edit-[a-f0-9]{8}\.webp$/);
    const appNext = next.files.find(file => file.path === "src/App.tsx").content;
    assert.equal(appNext, app.replace('<section><img src="/images/hero.png"', `<section><img src="/${newPath.slice(7)}"`), "only the chosen use changed");
    const candidateBytes = mem.objects.get(candidate.object_path);
    // Studio/source resolver (sha re-verified on read).
    const artwork = await resolveWebsiteSourceAssets(client, scope, next);
    assert.ok(Buffer.from(artwork.find(item => item.path === newPath).bytes).equals(candidateBytes));
    assert.ok(Buffer.from(artwork.find(item => item.path === "public/images/hero.png").bytes).equals(hero), "original still served where it is still used");
    // Responsive copies of the edited original are part of the version.
    const manifest = responsive.responsiveManifest(next.assets);
    assert.ok(manifest[`/${newPath.slice(7)}`]?.srcset.includes("640w"), "srcset for the accepted image");
    // GitHub export of the accepted version.
    const snapshot = githubSourceSnapshot(done.version, artwork, ARTIFACT);
    assert.ok(Buffer.from(snapshot.files.find(file => file.path === newPath).bytes).equals(candidateBytes));
    assert.ok(Buffer.from(snapshot.files.find(file => file.path === "src/App.tsx").bytes).toString().includes(`/${newPath.slice(7)}`));
    // Publication manifest resolver (fenced SQL locator faked from the same records).
    const records = next.assets.map(asset => { const row = mem.tables.assets.find(item => item.id === asset.id); return { id: row.id, workspace_id: W, project_id: P, object_path: row.object_path, content_type: row.content_type, sha256: row.sha256 }; });
    const resolver = publicationArtworkResolver({ rpc: async () => ({ versionId: done.version.id, scope: { workspaceId: W, projectId: P, artifactId: ARTIFACT }, assetRecords: records }),
      download: async objectPath => mem.objects.get(objectPath) });
    const published = await resolver({ workspaceId: W, projectId: P, preparationId: randomUUID(), workerId: randomUUID(), fence: randomUUID() }, done.version, new AbortController().signal);
    assert.ok(Buffer.from(published.find(item => item.path === newPath).bytes).equals(candidateBytes));
    // Discard = the earlier version: every resolver still returns only the original.
    const earlier = mem.tables.artifact_versions.find(row => row.version_number === 1);
    const before = await resolveWebsiteSourceAssets(client, scope, earlier.content.websiteSource);
    assert.equal(before.length, 1); assert.ok(Buffer.from(before[0].bytes).equals(hero));
  });

  await check("documents: accept one slide; loadDocumentImages (sha-verified) gives PDF/PPTX the accepted bytes there and the original elsewhere; tampered bytes are left out", async () => {
    const hero = await picture(1024, 1024, 6);
    const original = registerAsset(hero);
    const theme = { palette: { background: "#F8F7F4", surface: "#FFFFFF", ink: "#16181D", muted: "#555555", accent: "#7862A7", accent2: "#3366AA", dark: "#111111" }, fonts: "modern" };
    const doc = { kind: "deck", schemaVersion: 1, title: "Deck", theme, assets: [{ name: "hero", id: original.id, aspect: "square", alt: "Hero", prompt: "" }],
      slides: [{ id: "a", layout: "image", title: "First", image: "hero", notes: "Notes." }, { id: "b", layout: "image", title: "Second", image: "hero", notes: "Notes." }] };
    mem.tables.artifacts.push({ id: ARTIFACT, workspace_id: W, project_id: P, kind: "presentation", title: "Deck", current_version: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    const { projectDocument } = require("../../documents/project.ts");
    addVersion({ schemaVersion: 1, kind: "presentation", title: "Deck", sections: projectDocument(doc), document: doc }, STYLE, [original.id]);
    const view = await run.runImageEdit(ACTOR, body(original), deps().deps);
    const client = memberClient(), env = { MAKEBORNE_IMAGE_EDITING: "on" };
    const done = await accept.acceptImageEdit(client, { workspaceId: W, actor: ACTOR }, { artifactId: ARTIFACT, acceptKey: randomUUID(), originalAssetId: original.id,
      candidateAssetId: view.candidate.candidate.assetId, expectedVersion: 1, references: [{ kind: "document_image", at: "slide:b" }] }, { env });
    const next = done.version.content.document;
    assert.equal(next.slides[0].image, "hero"); assert.notEqual(next.slides[1].image, "hero");
    const buffers = await loadDocumentImages(client, W, P, next);
    const candidate = mem.tables.assets.find(row => row.id === view.candidate.candidate.assetId);
    assert.ok(buffers[next.slides[1].image].equals(mem.objects.get(candidate.object_path)), "PDF/PPTX get the accepted bytes for slide b");
    assert.ok(buffers.hero.equals(hero), "and the original for slide a");
    const earlier = await loadDocumentImages(client, W, P, mem.tables.artifact_versions[0].content.document);
    assert.deepEqual(Object.keys(earlier), ["hero"], "the earlier (discarded) version resolves only the original");
    mem.objects.set(candidate.object_path, Buffer.concat([mem.objects.get(candidate.object_path), Buffer.from([0])]));
    assert.equal((await loadDocumentImages(client, W, P, next))[next.slides[1].image], undefined, "bytes that do not match their record are never rendered");
  });

  await check("book: switching one figure leaves the other figure and the cover on the original", async () => {
    const parts = { style: STYLE, assetIds: ["11111111-1111-4111-8111-111111111111"], content: { schemaVersion: 1, kind: "book", title: "Book", sections: [], document: {
      kind: "book", schemaVersion: 1, title: "Book", cover: { image: "art" }, theme: { palette: { background: "#F8F7F4", surface: "#FFFFFF", ink: "#16181D", muted: "#555555", accent: "#7862A7", accent2: "#3366AA", dark: "#111111" }, fonts: "classic" },
      assets: [{ name: "art", id: "11111111-1111-4111-8111-111111111111", aspect: "landscape", alt: "", prompt: "" }],
      chapters: [{ id: "one", title: "One", text: "Intro.\n\n[[figure:art|First]]\n\nMiddle.\n\n[[figure:art|Second]]" }] } } };
    const uses = references.listAssetUses(parts, "11111111-1111-4111-8111-111111111111");
    assert.deepEqual(uses.filter(use => use.kind === "document_image").map(use => use.at), ["cover", "chapter:one:figure:0", "chapter:one:figure:1"]);
    const next = references.applyAcceptedEdit(parts, { originalId: "11111111-1111-4111-8111-111111111111", candidate: { id: "22222222-2222-4222-8222-222222222222", sha256: "b".repeat(64), bytes: 10, mediaType: "image/webp" },
      references: [{ kind: "document_image", at: "chapter:one:figure:1" }] });
    const text = next.content.document.chapters[0].text;
    assert.match(text, /\[\[figure:art\|First\]\]/); assert.match(text, /\[\[figure:art-ebbbbbb\|Second\]\]/);
    assert.equal(next.content.document.cover.image, "art");
    assert.ok(next.assetIds.includes("22222222-2222-4222-8222-222222222222"));
  });

  await check("original preservation: failed, uncertain and discarded edits leave the original bytes, its record and the project version untouched; 'all uses' switches are explicit", async () => {
    const hero = await picture(1024, 1024, 7);
    const original = registerAsset(hero); outlineArtifact(original.id);
    const row = structuredClone(mem.tables.assets.find(item => item.id === original.id));
    for (const behaviour of [async () => { throw Object.assign(new Error("boom"), { status: 500 }); }, async () => { throw Object.assign(new Error("bad"), { status: 400 }); }, okResponse(Buffer.from("junk"))]) {
      imageBehaviour = behaviour;
      const view = await run.runImageEdit(ACTOR, body(original), deps().deps);
      assert.notEqual(view.state, "candidate");
    }
    imageBehaviour = okResponse();
    const discarded = await run.runImageEdit(ACTOR, body(original), deps().deps);
    assert.equal(discarded.state, "candidate"); // the customer discards: no call is needed and nothing changes
    assert.ok(mem.objects.get(original.objectPath).equals(hero)); assert.deepEqual(mem.tables.assets.find(item => item.id === original.id), row);
    assert.equal(artifactRow().current_version, 1); assert.equal(mem.tables.artifact_versions.length, 1);
    assert.equal(imageCalls.length, 4, "each try was an explicit request; nothing regenerated by itself");
    // "All uses" choices: a website path and a named document image switch every use of exactly that name/path, nothing else.
    const parts = { style: { ...STYLE, referenceAssetIds: [original.id] }, assetIds: [original.id], content: { schemaVersion: 1, kind: "website", title: "Site", sections: [], websiteSource: {
      schemaVersion: 1, toolchainId: "react-vite-v1", entrypoint: "src/main.tsx", routes: [{ path: "/", title: "Home" }],
      files: [{ path: "index.html", content: "<div id=root></div>" }, { path: "src/main.tsx", content: "" }, { path: "package.json", content: "{}" }, { path: "package-lock.json", content: "{}" },
        { path: "src/App.tsx", content: 'a="/images/hero.png" b="/images/hero.png" c="/images/hero.png2" d="/images/other.png"' }],
      assets: [{ id: original.id, path: "public/images/hero.png", sha256: original.sha256, bytes: hero.length, mediaType: "image/png" }] } } };
    const candidate = { id: "33333333-3333-4333-8333-333333333333", sha256: "c".repeat(64), bytes: 9, mediaType: "image/webp" };
    const all = references.applyAcceptedEdit(parts, { originalId: original.id, candidate, references: [{ kind: "website_asset", path: "public/images/hero.png" }, { kind: "style_reference" }] });
    assert.equal(all.switched, 3);
    assert.equal(all.content.websiteSource.files.find(file => file.path === "src/App.tsx").content, 'a="/images/hero-edit-cccccccc.webp" b="/images/hero-edit-cccccccc.webp" c="/images/hero.png2" d="/images/other.png"');
    assert.deepEqual(all.style.referenceAssetIds, [candidate.id]);
    assert.ok(all.content.websiteSource.assets.some(asset => asset.id === original.id), "the original stays in the source (history, other code paths)");
    assert.throws(() => references.applyAcceptedEdit(parts, { originalId: original.id, candidate, references: [{ kind: "style_reference" }, { kind: "style_reference" }] }), error => error.code === "EDIT_REFERENCE_DUPLICATE");
    assert.equal(parts.content.websiteSource.files.at(-1).content.includes("edit"), false, "the input version object is never mutated");
  });

  await check("customer copy and contract: no provider or model names in labels, messages or the UI component", async () => {
    assert.doesNotMatch(JSON.stringify(contract.EDIT_OPERATION_LABELS), NAMES);
    const ui = fs.readFileSync(path.join(root, "src/components/image-edit-panel.tsx"), "utf8");
    assert.doesNotMatch(ui.replace(/\/\*\*[\s\S]*?\*\//g, ""), NAMES);
    const runSource = fs.readFileSync(path.join(__dirname, "run.ts"), "utf8");
    const messages = runSource.slice(runSource.indexOf("const MESSAGES"), runSource.indexOf("} as const;"));
    assert.doesNotMatch(messages, NAMES);
  });

  await check("routes: a generated edit needs the agency switch, and both providers' capacity is checked before the edit (and its hold) starts", async () => {
    const dir = path.join(root, "src/app/api/cloud/workspaces/[workspaceId]/artifacts/[artifactId]/image-edits");
    const shared = fs.readFileSync(path.join(dir, "shared.ts"), "utf8");
    assert.match(shared, /generatedEditsEnabled\(\) \{ return imageEditingEnabled\(\) && agencyKindEnabled\("image_edit"\); \}/);
    assert.match(shared, /requireProviderCapacity\("anthropic"\);\s*await requireProviderCapacity\("openai"\)/);
    for (const [file, call] of [["route.ts", "runImageEdit("], ["estimate/route.ts", "estimateImageEdit("]]) {
      const source = fs.readFileSync(path.join(dir, file), "utf8"), post = source.slice(source.indexOf("export async function POST"));
      const order = ["requireGeneratedEdits()", "editContext(", "await requireEditProviders()", call].map(item => post.indexOf(item));
      assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), `${file}: gate, then context, then capacity, then the edit`);
    }
    assert.match(fs.readFileSync(path.join(dir, "route.ts"), "utf8"), /available: generatedEditsEnabled\(\)/, "the panel is offered only when a generated edit can run");
    // Resize, crop and accept make no provider call: the image-editing switch is enough.
    for (const file of ["deterministic/route.ts", "accept/route.ts"]) assert.doesNotMatch(fs.readFileSync(path.join(dir, file), "utf8"), /requireGeneratedEdits|requireEditProviders/);
  });

  console.log(`${passed}/23 image-edit checks passed.`);
  if (passed !== 23) process.exitCode = 1;
  process.exit(process.exitCode ?? 0);
})().catch(error => { console.error(error); process.exit(1); });
