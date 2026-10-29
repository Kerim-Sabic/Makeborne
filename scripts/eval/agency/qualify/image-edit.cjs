/* eslint-disable @typescript-eslint/no-require-imports -- Paid qualification: OpenAI image edits through the real edit call, the real operation and the real spend gate. */
'use strict';
/*
 * Image-edit qualification (cap $6.50 OpenAI + $0.50 Anthropic), plan: docs/release-review/image-edit-qualification-20261023.md.
 * Measurement calls: each is ONE budgetedImageEdit (the production call: multipart image[]/mask, n=1, png, no stream,
 * maxRetries 0, 180 s) on its own image_edit operation step (beginAgencyOperation -> createOperationSpend ->
 * makeborne_ai_operation_provider_begin -> open_provider_call), with inputs normalised by the production
 * normaliseForEdit and masks checked by validateMask. The cell bound comes from a TEST-ONLY planning table
 * (generous; MEASURED_EDIT_TOKENS stays empty in code). The first call per model verifies that the endpoint
 * works with this key and returns usage; a refusal, missing usage or an overrun stops that model.
 * End-to-end: runImageEdit (Claude instruction step + one edit + stored candidate) with the table proposed from
 * the measurements, then the same keys again (replay: no call).
 */
const c = require('./common.cjs');
const fs = require('node:fs');
const path = require('node:path');

// Planning bounds for MEASUREMENT only (x1.5 headroom and x1.1 are applied by the production bound function).
const PLANNING_CELL = Object.freeze({ inputImageTokens: 20_000, maskTextTokens: 2_000, outputTokens: 6_000, evidence: 'TEST ONLY: planning bound for the qualification run, not a measurement' });
const MODELS = ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2'];
const SIZES = ['1024x1024', '1536x1024'];
const planningTable = () => Object.freeze(Object.fromEntries(MODELS.map(model => [model, { medium: Object.fromEntries(SIZES.map(size => [size, PLANNING_CELL])) }])));

const PROMPTS = {
  background_replace: 'Replace the background behind the mug with a sunlit wooden bakery counter and soft shelves of bread, slightly out of focus. Keep the mug, its HB label and the table edge exactly as they are.',
  object_remove: 'Remove the mug from the table and fill the area with the same table surface and background so nothing looks retouched.',
  object_replace: 'Replace the mug with a round loaf of sourdough bread on a small linen cloth, in the same position and lighting.',
  extend: 'Extend the scene outwards so the table and the wall continue naturally on every side.',
  relight_restyle: 'Relight the scene as warm early-morning window light from the left, with soft shadows. Keep every object and the HB label unchanged.',
  variant: 'Make a closely related variant of this product photo: same mug and HB label, a slightly different camera angle and arrangement on the same table.',
  cutout: 'Cut out the mug with its HB label; remove the table and background completely.',
  variant_refs: 'Make a variant of this product photo in the colour palette and mood of the reference images, keeping the mug and its HB label exactly the same.',
};

async function fixtures(sharp) {
  const scene = (width, height) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9cbb5"/><stop offset="1" stop-color="#bfa98a"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#wall)"/><rect y="${height * 0.62}" width="100%" height="${height * 0.38}" fill="#8a5a3b"/>
    <rect x="${width / 2 - 120}" y="${height * 0.36}" width="240" height="260" rx="22" fill="#f4f1ea"/><ellipse cx="${width / 2}" cy="${height * 0.36}" rx="120" ry="26" fill="#e7e2d7"/>
    <path d="M ${width / 2 + 120} ${height * 0.42} q 90 20 0 120" stroke="#f4f1ea" stroke-width="26" fill="none"/>
    <text x="${width / 2}" y="${height * 0.36 + 150}" font-family="Georgia" font-size="64" text-anchor="middle" fill="#b4441c">HB</text></svg>`);
  const square = await sharp(scene(1024, 1024)).png().toBuffer();
  const landscape = await sharp(scene(1536, 1024)).png().toBuffer();
  // Opaque everywhere (keep) except a transparent rectangle over the mug (may change).
  const mask = async (width, height) => {
    const raw = Buffer.alloc(width * height * 4);
    const left = Math.round(width / 2 - 150), top = Math.round(height * 0.36 - 60);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw[(y * width + x) * 4 + 3] = x >= left && x < left + 340 && y >= top && y < top + 360 ? 0 : 255;
    return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
  };
  const refs = [];
  for (const [index, colors] of [['#2f4858', '#86bbd8'], ['#f6ae2d', '#f26419'], ['#33658a', '#55dde0']].entries()) {
    refs.push(await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="${colors[0]}"/><circle cx="${180 + index * 60}" cy="256" r="150" fill="${colors[1]}"/></svg>`)).png().toBuffer());
  }
  return { square, landscape, squareMask: await mask(1024, 1024), landscapeMask: await mask(1536, 1024), refs };
}

function cells() {
  const list = [];
  const ops = ['variant', 'background_replace', 'object_remove', 'object_replace', 'extend', 'relight_restyle', 'cutout', 'variant_refs'];
  for (const size of SIZES) for (const op of ops) list.push({ model: 'gpt-image-2.5-sunburst', size, op });
  for (const size of SIZES) for (const op of ['variant', 'relight_restyle', 'variant_ref1']) list.push({ model: 'gpt-image-2.5-flare', size, op });
  for (const op of ['variant', 'relight_restyle']) list.push({ model: 'gpt-image-2', size: '1024x1024', op });
  // Verification first: the first call per model is its plain 1024 variant.
  const first = MODELS.map(model => list.find(cell => cell.model === model && cell.size === '1024x1024' && cell.op === 'variant'));
  return [...first, ...list.filter(cell => !first.includes(cell))];
}

async function main() {
  const ctx = c.configure({ flags: { MAKEBORNE_IMAGE_EDITING: 'on' } });
  const sharp = require(path.join(c.REPO, 'node_modules', 'sharp'));
  const { default: OpenAI, toFile } = require(path.join(c.REPO, 'node_modules', 'openai'));
  const { resolveAgencyTask, taskContext, taskDigest } = c.app('src/lib/agency/task.ts');
  const { resolveAgencyScope, beginAgencyOperation, createOperationSpend, finishOperation } = c.app('src/lib/builder/operation-server.ts');
  const { budgetedImageEdit } = c.app('src/lib/ai/image-edit-call.ts');
  const { imageEditCallBoundMicrousd } = c.app('src/lib/ai/image-edit-prices.ts');
  const { normaliseForEdit, validateMask, verifyImageBytes, transparentShare } = c.app('src/lib/images/edit/pixels.ts');
  const { aiCostUsdPerCredit } = c.app('src/lib/builder/pricing.ts');
  const rate = Math.round(aiCostUsdPerCredit() * 1e6);
  const settings = c.testSetting('image_edit', { maxTurns: 8, maxOutputTokens: 8000 });
  const dry = process.argv.includes('--dry');
  const only = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  const out = c.resultsDir('image');
  const fx = await fixtures(sharp);
  for (const [name, bytes] of Object.entries({ 'source-square.png': fx.square, 'source-landscape.png': fx.landscape, 'mask-square.png': fx.squareMask })) fs.writeFileSync(path.join(out, name), bytes);
  const table = planningTable();
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 180_000 });
  const toUpload = upload => toFile(upload.bytes, upload.name, { type: upload.type });
  const fixture = dry ? null : await c.createArtifact(ctx.workspaceId, { title: 'image edit qualification', kind: 'website', projectKind: 'website', content: { qualification: 'image_edit' }, actor: ctx.actor });
  const stopped = new Map();
  if (process.argv.includes('--e2e')) return endToEnd({ ctx, fx, fixture, rate, settings, openai, toUpload });

  for (const cell of cells()) {
    const key = `${cell.model} ${cell.size} ${cell.op}`;
    if (only.length && !only.some(item => key.includes(item))) continue;
    if (stopped.has(cell.model)) { console.log(`${key}: skipped (model stopped: ${stopped.get(cell.model)})`); continue; }
    const operation = cell.op.startsWith('variant_ref') ? 'variant' : cell.op;
    const landscape = cell.size === '1536x1024' && operation !== 'extend';
    const sourceBytes = landscape ? fx.landscape : fx.square;
    const references = cell.op === 'variant_refs' ? fx.refs : cell.op === 'variant_ref1' ? fx.refs.slice(0, 1) : [];
    const masked = operation === 'object_remove' || operation === 'object_replace';
    const background = operation === 'cutout' ? 'transparent' : 'opaque';
    const source = await verifyImageBytes(sourceBytes, c.sha(sourceBytes));
    const verifiedRefs = await Promise.all(references.map(bytes => verifyImageBytes(bytes, c.sha(bytes), { bytes: 8 * 1024 * 1024 })));
    const mask = masked ? (await validateMask((landscape ? fx.landscapeMask : fx.squareMask).toString('base64'), source)).bytes : undefined;
    const normalised = await normaliseForEdit({ source, operation, size: cell.size, mask, references: verifiedRefs });
    const lines = [PROMPTS[cell.op === 'variant_ref1' ? 'variant_refs' : cell.op]];
    if (masked || normalised.autoMask) lines.push(normalised.autoMask ? 'Fill only the empty area around the existing picture so it continues naturally; keep the existing picture unchanged.' : 'Change only the area marked by the mask; leave everything else unchanged.');
    if (operation === 'cutout') lines.push('Remove the background completely so only the subject remains on a fully transparent background.');
    const prompt = lines.join('\n');
    const images = [{ name: 'image.png', bytes: normalised.image, type: 'image/png' }, ...normalised.references.map((bytes, index) => ({ name: `reference-${index + 1}.png`, bytes, type: 'image/png' }))];
    const editMask = normalised.mask ? { name: 'mask.png', bytes: normalised.mask, type: 'image/png' } : undefined;
    const bound = imageEditCallBoundMicrousd({ model: cell.model, quality: 'medium', size: cell.size, images: images.length, mask: Boolean(editMask), background, prompt }, table);
    if (dry) { console.log(`${key}: ${images.length} image(s)${editMask ? ' + mask' : ''}; bound $${(bound.boundMicrousd / 1e6).toFixed(4)}; prompt ${Buffer.byteLength(prompt)} bytes`); continue; }

    const sourceAsset = await c.addAsset(ctx.workspaceId, fixture.projectId, { bytes: sourceBytes, contentType: 'image/png', name: `${cell.op}-${cell.size}.png` });
    const refAssets = [];
    for (const [index, bytes] of references.entries()) refAssets.push(await c.addAsset(ctx.workspaceId, fixture.projectId, { bytes, contentType: 'image/png', name: `ref-${index}-${c.randomUUID()}.png` }));
    const task = await resolveAgencyTask(ctx.actor, { artifactId: fixture.artifactId, actionKey: c.randomUUID(), stepKey: c.randomUUID(), kind: 'image_edit', objective: `qualification ${key}`,
      inputs: [{ kind: 'asset', id: sourceAsset.assetId, sha256: sourceAsset.sha256 }, ...refAssets.map(item => ({ kind: 'asset', id: item.assetId, sha256: item.sha256 }))],
      permittedTools: ['read_input'], settings: 'standard', ceilingCredits: 60, expectedRevision: 1 }, { scope: resolveAgencyScope, settings, rateMicrousd: rate });
    let outcome = null, finish = null, latencyMs = null;
    const step = await c.paidStep(ctx, { test: 'image', provider: 'openai', boundUsd: bound.boundMicrousd / 1e6, ref: key, note: `image edit measurement: ${key}` }, async () => {
      const { run } = await beginAgencyOperation({ actor: task.actorId, workspaceId: task.workspaceId, artifactId: task.artifactId, kind: task.kind, effort: task.settings.effort, expectedVersion: 1,
        ceiling: task.ceilings.customerCredits, providerCapMicrousd: bound.boundMicrousd, stageCap: Math.ceil(bound.boundMicrousd / rate), context: taskContext(task), digest: taskDigest(task), actionKey: task.actionKey, stepKey: task.stepKey });
      const spend = createOperationSpend(run, Date.now() + 240_000);
      const started = Date.now();
      outcome = await budgetedImageEdit({ client: openai, toUpload, spend, signal: new AbortController().signal, model: cell.model, prompt, size: cell.size, quality: 'medium', background, images, mask: editMask, table });
      latencyMs = Date.now() - started;
      finish = await finishOperation(run, spend.confirmedMicrousd, outcome.ok ? 'result' : 'failed', { qualification: key, costMicrousd: outcome.detail.costMicrousd, ...(outcome.ok ? { finished: true } : { code: `EDIT_${outcome.reason.toUpperCase()}` }) },
        outcome.ok ? { data: { kind: 'qualification', cell: key, width: outcome.width, height: outcome.height } } : undefined);
      return outcome;
    });
    const usage = outcome?.detail?.usage ?? null;
    const imagesSent = images.length + (editMask ? 1 : 0);
    const alpha = outcome?.ok ? await transparentShare(outcome.bytes) : null;
    if (outcome?.ok) fs.writeFileSync(path.join(out, `${cell.model}-${cell.size}-${cell.op}.png`), outcome.bytes);
    const row = { cell: key, model: cell.model, size: cell.size, op: cell.op, quality: 'medium', background, inputImages: images.length, mask: Boolean(editMask), imagesSent, promptBytes: Buffer.byteLength(prompt),
      ok: outcome?.ok ?? false, reason: outcome && !outcome.ok ? outcome.reason : null, status: outcome && !outcome.ok ? outcome.status : null, error: step.error ? String(step.error.message ?? step.error).slice(0, 300) : null,
      usage, usageReturned: Boolean(usage), imageTokens: usage?.input_tokens_details?.image_tokens ?? null, textTokens: usage?.input_tokens_details?.text_tokens ?? null, outputTokens: usage?.output_tokens ?? null,
      imageTokensPerInput: usage?.input_tokens_details ? Math.ceil(usage.input_tokens_details.image_tokens / imagesSent) : null,
      costMicrousd: outcome?.detail?.costMicrousd ?? null, boundMicrousd: bound.boundMicrousd, overrun: outcome?.detail?.overrun ?? null,
      output: outcome?.ok ? { width: outcome.width, height: outcome.height, bytes: outcome.bytes.length, hasAlpha: outcome.hasAlpha, transparentShare: alpha } : null,
      latencyMs, operationOutcome: finish?.outcome ?? null, gate: step.gate, ledger: step.ledger };
    c.appendJsonl('image', row);
    console.log(`${key}: ${row.ok ? 'ok' : `FAILED ${row.reason ?? ''} ${row.status ?? ''}`} usage ${row.usageReturned ? `in img ${row.imageTokens} txt ${row.textTokens} out ${row.outputTokens}` : 'MISSING'}; cost $${((row.costMicrousd ?? 0) / 1e6).toFixed(4)} of bound $${(bound.boundMicrousd / 1e6).toFixed(4)}; ${row.output ? `${row.output.width}x${row.output.height} ${row.output.bytes} B alpha ${row.output.hasAlpha} transparent ${(alpha * 100).toFixed(1)}%` : ''}; ${latencyMs} ms; gate $${c.usd(step.gate.totalMicrousd).toFixed(4)}${row.error ? `; error ${row.error}` : ''}`);
    if (!row.ok && row.reason !== 'malformed') stopped.set(cell.model, `${row.reason ?? 'error'} ${row.status ?? ''}`.trim());
    else if (!row.usageReturned) stopped.set(cell.model, 'usage missing');
    else if (row.overrun) stopped.set(cell.model, 'overrun');
  }
  if (!dry) console.log('image spend so far', await c.testSpend('image'));
}

/** The table proposed from the measurement rows: largest observed count per (model, medium, size); masks only where masked calls were observed. */
function proposedTable() {
  const rows = fs.readFileSync(path.join(c.resultsDir('image'), 'results.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(row => row.cell && row.ok && row.usageReturned && !row.overrun);
  const table = {};
  for (const row of rows) {
    const cell = ((table[row.model] ??= { medium: {} }).medium[row.size] ??= { inputImageTokens: 0, outputTokens: 0, evidence: `agency-qualification-20261024: ${0} calls` });
    // Per input image: the source is the largest image of the request (references are fitted inside the canvas).
    const sourceTokens = row.op === 'variant_refs' || row.op === 'variant_ref1' ? null : row.imageTokens;
    if (sourceTokens !== null) cell.inputImageTokens = Math.max(cell.inputImageTokens, sourceTokens);
    cell.outputTokens = Math.max(cell.outputTokens, row.outputTokens);
    if (row.mask) cell.maskTextTokens = Math.max(cell.maskTextTokens ?? 0, row.textTokens);
    cell.calls = (cell.calls ?? 0) + 1;
    cell.evidence = `agency-qualification-20261024: ${cell.calls} live call(s) at medium ${row.size}, usage returned on every call`;
  }
  for (const model of Object.values(table)) for (const cell of Object.values(model.medium)) delete cell.calls;
  return table;
}

async function endToEnd({ ctx, fx, fixture, rate, settings, openai, toUpload }) {
  const { runImageEdit, estimateImageEdit } = c.app('src/lib/images/edit/run.ts');
  const { projectEditAssets } = c.app('src/lib/images/edit/server.ts');
  const { anthropicModelPort } = c.app('src/lib/agency/model-port.ts');
  const { billingDatabase } = c.app('src/lib/billing/database.ts');
  const table = proposedTable();
  c.writeJson('image', 'proposed-table.json', table);
  console.log(`proposed table: ${JSON.stringify(table)}`);
  const scope = { workspaceId: ctx.workspaceId, projectId: fixture.projectId };
  // The source is uploaded to the project's private bucket and registered, exactly where the edit path reads it.
  const sourceAsset = await c.addAsset(ctx.workspaceId, fixture.projectId, { bytes: fx.square, contentType: 'image/png', name: 'e2e-source.png' });
  const [assetRow] = await c.sql('select object_path from public.assets where id = $1', [sourceAsset.assetId]);
  const upload = await billingDatabase().storage.from('project-assets').upload(assetRow.object_path, fx.square, { contentType: 'image/png', upsert: false });
  if (upload.error) throw new Error(`storage upload failed: ${upload.error.message}`);
  const env = { ...process.env, MAKEBORNE_IMAGE_EDITING: 'on', MAKEBORNE_IMAGE_EDIT_MODELS: 'gpt-image-2.5-sunburst,gpt-image-2.5-flare' };
  const runs = [
    { name: 'e2e-background', operation: 'background_replace', instruction: 'Put the mug on a sunlit bakery counter instead of the plain wall; keep the mug and its HB label exactly as they are.', preserve: ['the HB label on the mug'] },
    { name: 'e2e-cutout', operation: 'cutout', instruction: 'Cut out the mug so it can sit on any page background.', background: 'transparent' },
    { name: 'e2e-relight', operation: 'relight_restyle', instruction: 'Make the light warmer, like early morning sun from a window on the left.' },
  ];
  for (const spec of runs) {
    const log = [], images = [];
    const imageClient = { images: { edit: async (body, options) => { const started = Date.now(); const response = await openai.images.edit(body, options); images.push({ model: body.model, usage: response.usage, ms: Date.now() - started }); return response; } } };
    const deps = { env, assets: projectEditAssets(billingDatabase(), scope), model: anthropicModelPort(c.anthropicClient(log, 120_000), settings[0]), imageClient, toUpload,
      rateMicrousd: rate, platformDeadline: Date.now() + 280_000, settings, table };
    const body = { artifactId: fixture.artifactId, actionKey: c.randomUUID(), stepKey: c.randomUUID(), asset: { id: sourceAsset.assetId, sha256: sourceAsset.sha256 }, operation: spec.operation,
      instruction: spec.instruction, settings: { size: '1024x1024', quality: 'medium', background: spec.background ?? 'opaque' }, preserve: spec.preserve ?? [], references: [], protect: [], ceilingCredits: 20, expectedRevision: 1 };
    const estimate = await estimateImageEdit(body, deps);
    const started = Date.now();
    const step = await c.paidStep(ctx, { test: 'image', bounds: { anthropic: estimate.prepareMicrousd / 1e6, openai: estimate.imageMicrousd / 1e6 }, ref: spec.name, note: `image edit end-to-end: ${spec.name}` }, () => runImageEdit(ctx.actor, body, deps));
    const view = step.value;
    const replay = await c.paidStep(ctx, { test: 'image', bounds: { anthropic: estimate.prepareMicrousd / 1e6, openai: estimate.imageMicrousd / 1e6 }, ref: `${spec.name}#replay`, note: `image edit end-to-end replay: ${spec.name}` }, () => runImageEdit(ctx.actor, body, deps));
    let stored = null;
    if (view?.candidate) {
      const [row] = await c.sql('select id, content_type, sha256, provenance from public.assets where id = $1', [view.candidate.candidate.assetId]);
      stored = row ? { contentType: row.content_type, sha256: row.sha256, model: row.provenance?.model, priceCard: row.provenance?.priceCard, costMicrousd: row.provenance?.costMicrousd, boundMicrousd: row.provenance?.boundMicrousd, reviewRequired: row.provenance?.reviewRequired } : null;
    }
    const result = { e2e: spec.name, operation: spec.operation, estimate, state: view?.state ?? null, code: view?.code ?? null, message: view?.message ?? null, error: step.error ? `${step.error.code ?? ''} ${step.error.message}` : null,
      candidate: view?.candidate ?? null, stored, instructionCalls: log, imageCalls: images, latencyMs: Date.now() - started, gate: step.gate, byProvider: step.byProvider, ledger: step.ledger,
      replay: { state: replay.value?.state ?? null, replayed: replay.value?.replayed ?? null, gateCalls: replay.gate.calls, error: replay.error ? String(replay.error.message) : null, ledger: replay.ledger } };
    c.appendJsonl('image', result);
    console.log(`${spec.name}: ${result.state}${result.code ? ` ${result.code}` : ''}${result.error ? ` error ${result.error}` : ''}; model ${stored?.model ?? '-'}; instruction ${log.map(item => `${item.usage?.input_tokens}/${item.usage?.output_tokens}`).join(',')}; image ${images.map(item => `${item.model} ${item.usage?.input_tokens}/${item.usage?.output_tokens} ${item.ms}ms`).join(',')}; gate anthropic $${c.usd(step.byProvider.anthropic?.totalMicrousd ?? 0).toFixed(4)} openai $${c.usd(step.byProvider.openai?.totalMicrousd ?? 0).toFixed(4)}; replay ${result.replay.state} calls ${result.replay.gateCalls}`);
  }
  console.log('image spend so far', await c.testSpend('image'));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => c.closeDb());
