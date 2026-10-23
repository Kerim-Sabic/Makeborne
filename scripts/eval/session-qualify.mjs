// Cached-snapshot measurement (v4 #1, docs/ai/MODEL_ORCHESTRATOR.md §8): three customer edits in a row on one saved website,
// each on the result of the one before, run back to back as a customer iterating would, in two arms on identical requests:
//   marker    the system prompt's cache marker, and the full current files in every request (the layout before the snapshot).
//   snapshot  the cached site snapshot (src/lib/builder/site-snapshot.ts): the anchor version first with its own cache marker,
//             the files changed since it in the request's own part.
//
//   EVAL_SPEND_APPROVED=yes EVAL_ENV_LOCAL=<abs path>/.env.local node scripts/eval/session-qualify.mjs --run <runId> --approval "<who/when>"
//     --scope <scoped allowance> [--cases scripts/eval/routing/session-cases.json] [--only <sessionId,...>] [--arms marker,snapshot]
//
// Both arms run the app's own code for each edit exactly as POST /api/build does for an existing site with routing off (the
// builder model at the requested effort, one attempt): runBuilder with its finish, quality, compile and rendered-contrast gates,
// inside routedWebsiteStage. Images are off. The saved site is version 7, the start of a snapshot block (the build route would
// have the block's earlier versions; here there are none), and each kept edit saves the next version, as the route does.
// No database or server: a memory gate and one RunSpend per edit at the operation's caps (Medium: 50 credits x $0.03).
// Spend: one scoped ledger reservation per edit at that cap, settled at the measured provider cost (unknown at the bound when a
// call's usage is unconfirmed). Nothing is retried. Recorded per edit: cost, every call's token usage (cache reads and writes),
// finish, build, edit_file failures and, for copy edits, the model-free copy check. The site after the last edit goes to
// outputs/eval/runs/<runId>-<arm>/<sessionId>/ (the run.mjs layout, for measure.mjs and the judge); the saved site to
// <runId>-before/<sessionId>/. The arms alternate which runs first, session by session.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ strict: true, options: { run: { type: 'string' }, approval: { type: 'string' }, scope: { type: 'string' }, cases: { type: 'string' }, only: { type: 'string' }, arms: { type: 'string', default: 'marker,snapshot' }, effort: { type: 'string', default: 'medium' }, dry: { type: 'boolean' } } });
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!values.dry && (process.env.EVAL_SPEND_APPROVED !== 'yes' || !values.approval?.trim())) throw new Error('Refusing: EVAL_SPEND_APPROVED=yes and --approval are required (or --dry)');
if (!/^[a-z0-9-]+$/.test(values.run ?? '')) throw new Error('--run must be a plain id');
if (!values.dry && !values.scope) throw new Error('--scope is required (the owner-approved scoped allowance for this measurement)');
const arms = values.arms.split(',').map(arm => arm.trim());
if (!arms.length || arms.some(arm => !['marker', 'snapshot'].includes(arm))) throw new Error('--arms takes marker and/or snapshot');
process.chdir(REPO);

const require = createRequire(`${REPO}/scripts/eval/package.json`);
const { loadApp } = require(`${REPO}/scripts/eval/lib/app-modules.cjs`);
const budget = await import(pathToFileURL(path.join(REPO, 'scripts/eval/lib/budget.mjs')).href);
const { serve } = await import(pathToFileURL(path.join(REPO, 'scripts/eval/lib/serve.mjs')).href);
const { scanForSecrets } = await import(pathToFileURL(path.join(REPO, 'scripts/eval/run.mjs')).href);
const { chromium } = await import('playwright');

let key = '';
if (!values.dry) {
  // The key goes into this process only (the SDK reads it); never printed or written.
  const envFile = process.env.EVAL_ENV_LOCAL?.trim() || path.join(REPO, '.env.local');
  if (!path.isAbsolute(envFile) || path.basename(envFile) !== '.env.local') throw new Error('EVAL_ENV_LOCAL must be an absolute path to a .env.local file');
  key = /^ANTHROPIC_API_KEY\s*=\s*(.*)$/m.exec(fs.readFileSync(envFile, 'utf8'))?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';
  if (!key) throw new Error('ANTHROPIC_API_KEY missing');
}
// No OpenAI key: images are off in both arms (no OpenAI spend in this measurement).
Object.assign(process.env, { ANTHROPIC_API_KEY: key || 'offline-dry-run', MAKEBORNE_AI_COST_USD_PER_CREDIT: '0.03', MAKEBORNE_BUILDER_FALLBACK_MODELS: '', OPENAI_API_KEY: '', MAKEBORNE_IMAGE_MODEL: '', MAKEBORNE_IMAGE_MODELS: '' });
for (const name of ['MAKEBORNE_BUILDER_MODEL', 'MAKEBORNE_MODEL_ROUTING']) delete process.env[name];

const { runBuilder } = loadApp('src/lib/builder/agent.ts');
const { routedWebsiteStage } = loadApp('src/lib/builder/website-stage.ts');
const { buildTaskContract } = loadApp('src/lib/builder/task-contract.ts');
const routing = loadApp('src/lib/ai/model-routing.ts');
const { copyEditFindings } = loadApp('src/lib/ai/copy-edit.ts');
const { renderedContrastCheck } = loadApp('src/lib/builder/contrast-gate.ts');
const { ProjectFiles } = loadApp('src/lib/builder/files.ts');
const { filesSince, snapshotAnchor, snapshotText } = loadApp('src/lib/builder/site-snapshot.ts');
const { RunSpend, memoryGate } = loadApp('src/lib/ai/run-spend.ts');
const { BUILDER_EFFORT } = loadApp('src/lib/builder/pricing.ts');
const { compileVerdict } = loadApp('src/lib/builder/compile.ts');

const RATE = 0.03, STAGE_MS = 280_000, BASE_VERSION = 7;
const policy = BUILDER_EFFORT[values.effort];
if (!policy) throw new Error('--effort must be a builder effort level');
const capMicrousd = Math.round(policy.ceilingCredits * RATE * 1e6);
const casesFile = path.resolve(values.cases ?? path.join(REPO, 'scripts/eval/routing/session-cases.json'));
const only = (values.only ?? '').split(',').map(id => id.trim()).filter(Boolean);
const sessions = JSON.parse(fs.readFileSync(casesFile, 'utf8')).sessions.filter(item => !only.length || only.includes(item.id));
if (!sessions.length) throw new Error('no session selected');
const dirOf = arm => path.join(REPO, 'outputs', 'eval', 'runs', `${values.run}-${arm}`);
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); };
const copyAssets = (from, to) => { if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true }); };
const images = files => `Existing images: ${[...files.assets.values()].map(asset => `/${asset.path.slice(7)}`).join(', ') || 'none'}`;

/** The build route's context for an existing website (src/app/api/build/route.ts): the project, then the files, in the arm's layout. */
function context({ item, files, history, anchor }) {
  return [`<project title="${item.title.replace(/"/g, "'")}">`, `Brief: ${item.brief}`,
    'Visual direction: No preset — choose the best direction for this business.',
    history.length ? `Recent revisions:\n${history.join('\n')}` : '', '</project>',
    anchor ? filesSince(anchor, files) : `<current_files>\n${files.snapshot()}\n</current_files>\n${images(files)}`,
  ].filter(Boolean).join('\n');
}
const fileCount = (before, after) => [...new Set([...before.keys(), ...after.keys()])].filter(file => before.get(file) !== after.get(file)).length;

const browser = values.dry ? null : await chromium.launch();
const runtime = values.dry ? null : await serve(path.join(REPO, 'public'));
const contrastCheck = values.dry ? undefined : renderedContrastCheck({ origin: runtime.url, launch: () => chromium.launch() });
const summary = [];
try {
  for (const [index, session] of sessions.entries()) {
    const siteDir = path.resolve(REPO, session.site);
    const item = JSON.parse(fs.readFileSync(path.join(siteDir, 'item.json'), 'utf8'));
    const saved = JSON.parse(fs.readFileSync(path.join(siteDir, 'source.json'), 'utf8'));
    const terminal = fs.existsSync(path.join(siteDir, 'terminal.json')) ? JSON.parse(fs.readFileSync(path.join(siteDir, 'terminal.json'), 'utf8')) : {};
    // The saved run's revisions, renumbered so the saved site is the base version.
    const earlier = Object.values(terminal).filter(entry => entry?.type === 'done' && entry.changed !== false && entry.summary).map(entry => String(entry.summary).slice(0, 900)).slice(-6);
    const baseHistory = earlier.map((text, i) => `v${BASE_VERSION - earlier.length + 1 + i}: ${text}`);
    const requests = session.edits.map((edit, i) => `(${i + 1}) ${edit.request}`).join(' ');
    const baseItem = { id: session.id, kind: 'website', title: item.title, direction: item.direction, briefId: session.id, relatedBriefId: item.briefId,
      brief: `${item.brief}\n\nThe website above was built and saved. The client then asked for these changes, one after another: ${requests}`, editRequest: requests, editKind: 'three-edit session' };
    const beforeDir = path.join(dirOf('before'), session.id);
    if (!values.dry && !fs.existsSync(path.join(beforeDir, 'source.json'))) {
      writeJson(path.join(beforeDir, 'item.json'), { ...baseItem, origin: { type: 'live', stack: item.origin?.stack ?? null, artifactId: item.origin?.artifactId ?? null, version: item.origin?.version ?? null, path: path.relative(REPO, siteDir) }, generation: { arm: 'before', note: 'the saved website the session started from' } });
      fs.copyFileSync(path.join(siteDir, 'source.json'), path.join(beforeDir, 'source.json'));
      copyAssets(path.join(siteDir, 'assets'), path.join(beforeDir, 'assets'));
      writeJson(path.join(beforeDir, 'status.json'), { ok: true, outcome: 'saved website (unchanged)' });
    }
    for (const arm of index % 2 ? [...arms].reverse() : arms) {
      const itemDir = path.join(dirOf(arm), session.id);
      if (fs.existsSync(path.join(itemDir, 'cost.json'))) { console.log(`${session.id} ${arm}: already run, skipped`); continue; }
      let source = saved;
      const versions = [{ number: BASE_VERSION, files: new Map(new ProjectFiles(saved).files) }];
      const history = [...baseHistory], records = [];
      for (const [position, edit] of session.edits.entries()) {
        const files = new ProjectFiles(source);
        const before = new Map(files.files), checkpoint = files.checkpoint();
        const current = versions.at(-1);
        const anchor = arm === 'snapshot' ? snapshotAnchor(versions, current.number) : null;
        const contract = buildTaskContract({ artifact: 'website', objective: 'edit', message: edit.request, revision: { expectedVersion: current.number },
          target: null, limits: { capCredits: policy.ceilingCredits, repairs: 1, escalations: 1 } });
        const route = routing.routeStage({ stage: 'build', artifact: 'website', request: edit.request, files: files.files.size, projectBytes: [...files.files.values()].reduce((sum, content) => sum + content.length, 0),
          effort: values.effort, attachments: 0, verification: { compile: true, contrast: true }, contract, operation: { id: null, runId: null, revision: current.number } }, {});
        const requestText = context({ item, files, history, anchor });
        if (values.dry) {
          const snapshot = anchor ? snapshotText(anchor) : '';
          console.log(`${session.id} ${arm} e${position + 1} ${edit.id}: v${current.number}, route ${route.mode}/${route.class}, snapshot ${anchor ? `v${anchor.number} (${snapshot.length} chars)` : 'none'}, own part ${requestText.length} chars`);
          // A dry run cannot edit: pretend the edit changed one line of the largest file, so the next edit sees a new version.
          const [largest] = [...files.files.entries()].sort((a, b) => b[1].length - a[1].length);
          files.write(largest[0], `${largest[1]}\n/* dry edit ${position + 1} */`);
          source = files.toSource(); versions.push({ number: current.number + 1, files: new Map(files.files) });
          continue;
        }
        const ref = `${values.run}/${session.id}/${arm}/e${position + 1}`;
        const reservation = await budget.reserveScoped({ scope: values.scope, kind: 'snapshot-session-edit', ref, boundUsd: capMicrousd / 1e6, provider: 'anthropic', unique: true, note: `${values.approval}. ${arm} ${values.effort} session edit ${position + 1}` });
        const spend = new RunSpend({ run: ref, providerCapMicrousd: capMicrousd, customerCapMicrousd: capMicrousd, gate: memoryGate(), deadline: Date.now() + STAGE_MS });
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), STAGE_MS);
        const events = [], started = Date.now();
        const emit = event => { if (['tool_error', 'status', 'file', 'delete', 'route'].includes(event.type)) events.push({ type: event.type, path: event.path, tool: event.tool, message: event.message?.slice?.(0, 300) }); };
        let result = null, error = null, outcome = 'ok';
        try {
          const attempt = plan => runBuilder({ client: null, scope: { workspaceId: 'eval', projectId: session.id }, files, effort: values.effort, spend, request: edit.request,
            context: context({ item, files, history, anchor }), ...(anchor ? { snapshot: snapshotText(anchor) } : {}), attachments: [], emit, signal: controller.signal, deadline: plan.deadline,
            contrastCheck, compile: compileVerdict, model: plan.model, firstStep: route.firstStep });
          ({ result } = await routedWebsiteStage({ route, stage: 'build', files, spend, deadline: Date.now() + STAGE_MS, signal: controller.signal, emit, compile: compileVerdict, request: edit.request, attempt }));
        } catch (caught) { error = { name: caught.name, code: caught.code ?? null, status: caught.status ?? null, message: String(caught.message).slice(0, 300) }; }
        finally { clearTimeout(timer); }
        // Like website-run.ts: unfinished work is kept only if it compiles; otherwise the saved version stands.
        let build = result?.build ?? null, kept = Boolean(result?.finished);
        if (!result?.finished && files.changed.size) {
          const verdict = await compileVerdict(files.files);
          if (verdict.status === 'failed') { files.restore(checkpoint); outcome = 'unfinished work did not compile: saved version kept'; }
          else { kept = true; build = verdict.status; outcome = 'unfinished: progress saved'; }
        }
        if (error) outcome = `error ${error.code ?? error.name}`;
        const uncertain = spend.uncertainMicrousd > 0;
        await budget.settle(reservation, uncertain ? { unknown: true, detail: { calls: spend.calls.length } } : { actualUsd: spend.providerMicrousd / 1e6, detail: { calls: spend.calls.length, arm, position: position + 1 } });
        let next; try { next = files.toSource(); } catch (invalid) { files.restore(checkpoint); next = files.toSource(); outcome = `invalid source (${String(invalid.message).slice(0, 120)}): saved version kept`; kept = false; }
        const changed = fileCount(before, files.files);
        if (kept && changed) {
          source = next; versions.push({ number: current.number + 1, files: new Map(files.files) });
          history.push(`v${current.number + 1}: ${edit.request.slice(0, 600)} → ${String(result?.summary ?? 'Saved the progress made so far.').slice(0, 900)}`);
          if (history.length > 6) history.shift();
        }
        const copyCheck = route.class === 'copy-edit' ? copyEditFindings({ request: edit.request, before, after: files.files, allowStylesheetFixes: Boolean(result?.problems?.length) }) : null;
        const record = { position: position + 1, edit: edit.id, kind: edit.kind, class: route.class, version: current.number, snapshot: anchor?.number ?? null,
          usd: uncertain ? null : spend.providerMicrousd / 1e6, uncertainUsd: spend.uncertainMicrousd / 1e6, finished: Boolean(result?.finished), build, kept, changedFiles: changed, outcome, error, ms: Date.now() - started,
          editFailures: events.filter(event => event.type === 'tool_error' && event.tool === 'edit_file').length, toolErrors: events.filter(event => event.type === 'tool_error').length,
          usage: spend.usageByModel(), calls: spend.calls.map(call => ({ model: call.model, boundMicrousd: call.boundMicrousd, worstCaseMicrousd: call.worstCaseMicrousd, actualMicrousd: call.actualMicrousd, cacheMiss: call.cacheMiss, usage: call.usage })),
          copyCheck, summary: result?.summary ?? null };
        records.push(record);
        fs.mkdirSync(itemDir, { recursive: true });
        fs.writeFileSync(path.join(itemDir, `source-e${position + 1}.json`), JSON.stringify(source));
        fs.writeFileSync(path.join(itemDir, `events-e${position + 1}.jsonl`), events.map(event => JSON.stringify(event)).join('\n'));
        const first = record.calls[0]?.usage;
        console.log(`${session.id} ${arm} e${position + 1} ${edit.id}: finished=${record.finished} build=${build} $${(spend.providerMicrousd / 1e6).toFixed(3)} ${spend.calls.length} calls, first call cache read ${first?.cacheRead ?? 0} write ${(first?.cacheWrite5m ?? 0) + (first?.cacheWrite1h ?? 0)}, ${changed} file(s), edit failures ${record.editFailures}${copyCheck ? ` copy check ${copyCheck.length ? 'FAIL' : 'pass'}` : ''}${error ? ` ERROR ${error.code ?? error.name}` : ''}; scope $${budget.scopeSummary(values.scope).committedUsd}`);
      }
      if (values.dry) continue;
      writeJson(path.join(itemDir, 'item.json'), { ...baseItem, origin: { type: 'live', stack: 'none (direct runBuilder; edits of a saved isolated-stack website)', artifactId: item.origin?.artifactId ?? null, version: item.origin?.version ?? null, path: path.relative(REPO, siteDir) },
        generation: { arm, effort: values.effort, mode: 'three-edit session (direct)', images: 'off' } });
      fs.writeFileSync(path.join(itemDir, 'source.json'), JSON.stringify(source));
      copyAssets(path.join(siteDir, 'assets'), path.join(itemDir, 'assets'));
      const totalUsd = records.every(record => record.usd !== null) ? records.reduce((sum, record) => sum + record.usd, 0) : null;
      writeJson(path.join(itemDir, 'cost.json'), { arm, capUsd: capMicrousd / 1e6, totalUsd, edits: records });
      writeJson(path.join(itemDir, 'status.json'), { ok: records.every(record => record.finished && !record.error), outcome: records.map(record => record.outcome).join('; '), summary: records.at(-1)?.summary ?? null });
      summary.push({ session: session.id, arm, totalUsd, edits: records.map(record => ({ position: record.position, usd: record.usd, finished: record.finished, cacheRead: record.calls[0]?.usage?.cacheRead ?? 0 })) });
    }
  }
} finally {
  await browser?.close(); await runtime?.close();
  if (!values.dry) for (const arm of ['before', ...arms]) {
    const dir = dirOf(arm);
    if (!fs.existsSync(dir)) continue;
    const runFile = path.join(dir, 'run.json');
    const prior = fs.existsSync(runFile) ? JSON.parse(fs.readFileSync(runFile, 'utf8')) : { runId: `${values.run}-${arm}`, mode: arm === 'before' ? 'copy' : 'live', kind: 'snapshot-session', startedAt: new Date().toISOString(), effort: values.effort, approval: values.approval, scope: values.scope, items: [] };
    prior.items = fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort().map(id => ({ id, kind: 'website' }));
    prior.finishedAt = new Date().toISOString();
    writeJson(runFile, prior);
    const scan = scanForSecrets(dir, [{ name: 'ANTHROPIC_API_KEY', value: key }]);
    console.log(`secret scan ${path.basename(dir)}: ${scan.ok ? 'clean' : `HITS ${scan.hits.map(hit => `${hit.file}: ${hit.secret}`).join('; ')}`} (${scan.files} files)`);
  }
  console.log(JSON.stringify(summary));
}
