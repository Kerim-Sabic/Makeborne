// Model-routing qualification for books and decks (outline and writing in one document stage): the builder model against
// the routed model, on identical inputs.
//
//   EVAL_SPEND_APPROVED=yes EVAL_ENV_LOCAL=<abs path>/.env.local node scripts/eval/route-qualify-docs.mjs --run <runId> --approval "<who/when>"
//     --scope <scoped allowance> --only d01-keep-the-wheels-turning,b01-useful-client-brief [--arms opus,routed]
//
// Both arms run the app's own code for one first document stage, as POST /api/build does for an empty book or deck: the
// route's context (documentContext), runDocumentBuilder (prompt, tools, finish checks) and routedDocumentStage
// (src/lib/builder/document-stage.ts). opus: routing off (the builder model). routed: MAKEBORNE_ROUTE_DOCUMENT_NEW=<routed model>
// with at most one escalation. No database or server; images off (no OpenAI spend). One scoped ledger reservation per brief and
// arm at the operation cap (Medium: 50 credits x $0.03), settled at the measured provider cost. Exports are rendered offline
// with the app's exporters (lib/fixtures.mjs renderDocumentExports), so measure.mjs reads them like any run.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ strict: true, options: { run: { type: 'string' }, approval: { type: 'string' }, scope: { type: 'string' }, only: { type: 'string' }, arms: { type: 'string', default: 'opus,routed' }, effort: { type: 'string', default: 'medium' } } });
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
if (process.env.EVAL_SPEND_APPROVED !== 'yes' || !values.approval?.trim() || !values.scope) throw new Error('Refusing: EVAL_SPEND_APPROVED=yes, --approval and --scope are required');
if (!/^[a-z0-9-]+$/.test(values.run ?? '')) throw new Error('--run must be a plain id');
const arms = values.arms.split(',').map(arm => arm.trim());
if (!arms.length || arms.some(arm => !['opus', 'routed'].includes(arm))) throw new Error('--arms takes opus and/or routed');
const only = (values.only ?? '').split(',').map(id => id.trim()).filter(Boolean);
if (!only.length || only.length > 4) throw new Error('--only takes 1 to 4 document brief ids');
process.chdir(REPO);

const require = createRequire(`${REPO}/scripts/eval/package.json`);
const { loadApp } = require(`${REPO}/scripts/eval/lib/app-modules.cjs`);
const budget = await import(pathToFileURL(path.join(REPO, 'scripts/eval/lib/budget.mjs')).href);
const { renderDocumentExports } = await import(pathToFileURL(path.join(REPO, 'scripts/eval/lib/fixtures.mjs')).href);
const { scanForSecrets } = await import(pathToFileURL(path.join(REPO, 'scripts/eval/run.mjs')).href);

const envFile = process.env.EVAL_ENV_LOCAL?.trim() || path.join(REPO, '.env.local');
if (!path.isAbsolute(envFile) || path.basename(envFile) !== '.env.local') throw new Error('EVAL_ENV_LOCAL must be an absolute path to a .env.local file');
const key = /^ANTHROPIC_API_KEY\s*=\s*(.*)$/m.exec(fs.readFileSync(envFile, 'utf8'))?.[1]?.trim().replace(/^["']|["']$/g, '');
if (!key) throw new Error('ANTHROPIC_API_KEY missing');
Object.assign(process.env, { ANTHROPIC_API_KEY: key, MAKEBORNE_AI_COST_USD_PER_CREDIT: '0.03', MAKEBORNE_BUILDER_FALLBACK_MODELS: '', OPENAI_API_KEY: '', MAKEBORNE_IMAGE_MODEL: '', MAKEBORNE_IMAGE_MODELS: '' });
for (const name of ['MAKEBORNE_BUILDER_MODEL', 'MAKEBORNE_MODEL_ROUTING']) delete process.env[name];

const { runDocumentBuilder } = loadApp('src/lib/builder/docs-agent.ts');
const { routedDocumentStage } = loadApp('src/lib/builder/document-stage.ts');
const { documentContext } = loadApp('src/lib/builder/docs-run.ts');
const { DocumentEditor, emptyDocument } = loadApp('src/lib/documents/editor.ts');
const routing = loadApp('src/lib/ai/model-routing.ts');
const { RunSpend, memoryGate } = loadApp('src/lib/ai/run-spend.ts');
const { BUILDER_EFFORT } = loadApp('src/lib/builder/pricing.ts');

const ROUTED_MODEL = 'claude-sonnet-5-5', RATE = 0.03, STAGE_MS = 280_000;
const capMicrousd = Math.round(BUILDER_EFFORT[values.effort].ceilingCredits * RATE * 1e6);
const ENV = { opus: {}, routed: { MAKEBORNE_MODEL_ROUTING: 'on', MAKEBORNE_ROUTE_DOCUMENT_NEW: ROUTED_MODEL } };
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); };
const summary = [];
for (const id of only) {
  const brief = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'eval', 'briefs', `${id}.json`), 'utf8'));
  if (!['presentation', 'book'].includes(brief.format)) throw new Error(`${id} is not a document brief`);
  const kind = brief.format === 'book' ? 'book' : 'presentation';
  for (const arm of arms) {
    const itemDir = path.join(REPO, 'outputs', 'eval', 'runs', `${values.run}-${arm}`, id);
    if (fs.existsSync(path.join(itemDir, 'cost.json'))) { console.log(`${id} ${arm}: already run, skipped`); continue; }
    const editor = new DocumentEditor(emptyDocument(kind === 'book' ? 'book' : 'deck', brief.title, 'automatic'));
    const artifact = { id: 'eval', project_id: id, kind, title: brief.title, current_version: 0 };
    const current = { number: 0, assetIds: [], content: { title: brief.title, sections: [] }, style: {} };
    const context = documentContext({ artifact, project: { brief: brief.brief, styleId: 'automatic' }, current, versions: [], brand: null }, editor, true);
    const route = routing.routeStage({ stage: 'document', emptyDocument: true, effort: values.effort }, ENV[arm]);
    const reservation = await budget.reserveScoped({ scope: values.scope, kind: 'routing-document', ref: `${values.run}/${id}/${arm}`, boundUsd: capMicrousd / 1e6, provider: 'anthropic', unique: true, note: `${values.approval}. ${arm} ${values.effort} first ${kind}` });
    const spend = new RunSpend({ run: `${values.run}/${id}/${arm}`, providerCapMicrousd: capMicrousd, customerCapMicrousd: capMicrousd, gate: memoryGate(), deadline: Date.now() + STAGE_MS });
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), STAGE_MS), started = Date.now();
    const events = [];
    const emit = event => { if (['tool_error', 'status', 'item', 'route'].includes(event.type)) events.push({ type: event.type, label: event.label, tool: event.tool, message: event.message?.slice?.(0, 300), model: event.model, escalated: event.escalated, reason: event.reason }); };
    let result = null, record = null, error = null;
    try {
      const attempt = (model, deadline) => runDocumentBuilder({ client: null, scope: { workspaceId: 'eval', projectId: id }, editor, effort: values.effort, spend, request: brief.brief, context, attachments: [], emit, signal: controller.signal, deadline, model });
      ({ result, record } = await routedDocumentStage({ route, editor, spend, deadline: Date.now() + STAGE_MS, signal: controller.signal, emit, attempt }));
    } catch (caught) { error = { name: caught.name, code: caught.code ?? null, status: caught.status ?? null, message: String(caught.message).slice(0, 300) }; record = caught.route ?? record; }
    finally { clearTimeout(timer); }
    const ms = Date.now() - started, uncertain = spend.uncertainMicrousd > 0;
    await budget.settle(reservation, uncertain ? { unknown: true, detail: { calls: spend.calls.length } } : { actualUsd: spend.providerMicrousd / 1e6, detail: { calls: spend.calls.length, models: [...new Set(spend.calls.map(call => call.model))] } });
    writeJson(path.join(itemDir, 'item.json'), { id, kind, title: brief.title, direction: brief.direction, briefId: id, brief: brief.brief, origin: { type: 'live', stack: 'none (direct runDocumentBuilder)', artifactId: null, version: null, path: null },
      generation: { arm, effort: values.effort, mode: 'create (direct)', images: 'off', route: { class: route.class, model: route.model, escalation: route.escalation, reason: route.reason } } });
    writeJson(path.join(itemDir, 'brief.json'), brief);
    let exports = null;
    if (editor.changed) { writeJson(path.join(itemDir, 'document.json'), editor.doc); exports = await renderDocumentExports(editor.doc, itemDir).catch(failure => ({ error: String(failure.message).slice(0, 300) })); }
    const cost = { boundUsd: capMicrousd / 1e6, reservationId: reservation, actualUsd: uncertain ? null : spend.providerMicrousd / 1e6, chargedCredits: spend.customerCredits(RATE), absorbedUsd: spend.absorbedMicrousd / 1e6,
      calls: spend.calls.map(call => ({ model: call.model, boundMicrousd: call.boundMicrousd, actualMicrousd: call.actualMicrousd })), route: routing.routeDetail(record), finished: Boolean(result?.finished), stopped: result?.stopped ?? spend.stopped, error, ms, exports,
      items: editor.doc.kind === 'deck' ? editor.doc.slides.length : editor.doc.chapters.length };
    writeJson(path.join(itemDir, 'cost.json'), cost);
    fs.writeFileSync(path.join(itemDir, 'events.jsonl'), events.map(event => JSON.stringify(event)).join('\n'));
    writeJson(path.join(itemDir, 'status.json'), { ok: Boolean(result?.finished) && !error, outcome: error ? `error ${error.code ?? error.name}` : result?.finished ? 'ok' : 'unfinished', summary: result?.summary ?? null });
    summary.push({ id, arm, models: record?.models ?? [route.model], escalation: record?.escalation ?? null, finished: Boolean(result?.finished), usd: cost.actualUsd, credits: cost.chargedCredits, ms, items: cost.items });
    console.log(`${id} ${arm}: ${(record?.models ?? [route.model]).join(' > ')} finished=${Boolean(result?.finished)} items=${cost.items} $${(spend.providerMicrousd / 1e6).toFixed(3)} charged ${cost.chargedCredits} cr ${Math.round(ms / 1000)} s${record?.escalation ? ` ESCALATED (${record.escalation})` : ''}${error ? ` ERROR ${error.code ?? error.name}` : ''}`);
  }
}
for (const arm of arms) {
  const dir = path.join(REPO, 'outputs', 'eval', 'runs', `${values.run}-${arm}`);
  if (!fs.existsSync(dir)) continue;
  writeJson(path.join(dir, 'run.json'), { runId: `${values.run}-${arm}`, mode: 'live', kind: 'routing-document', effort: values.effort, approval: values.approval, scope: values.scope, finishedAt: new Date().toISOString(),
    items: fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => ({ id: entry.name })) });
  const scan = scanForSecrets(dir, [{ name: 'ANTHROPIC_API_KEY', value: key }]);
  console.log(`secret scan ${path.basename(dir)}: ${scan.ok ? 'clean' : `HITS ${scan.hits.map(hit => `${hit.file}: ${hit.secret}`).join('; ')}`} (${scan.files} files)`);
}
console.log(JSON.stringify(summary));
