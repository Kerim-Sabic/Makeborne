// Design-review effort qualification: the screenshot design review on saved websites, the builder model at the requested
// effort against the same model at a lower effort, on identical captures (docs/ai/MODEL_ORCHESTRATOR.md, review cell).
//
//   EVAL_SPEND_APPROVED=yes EVAL_ENV_LOCAL=<abs path>/.env.local node scripts/eval/review-qualify.mjs --run <runId> --approval "<who/when>"
//     --scope <scoped allowance> [--cases scripts/eval/routing/review-cases.json] [--only <caseId,...>] [--arms opus,opus-low]
//
// Each case is one saved website from an earlier app-route run (its source.json, read only). The site is captured once,
// exactly as the studio does before a review (capture-review.mjs: desktop and mobile tiles plus measured diagnostics), and
// both arms run the app's runBuilder with that one review request, its screenshot attachments and the review limits:
//   opus      the builder model at the requested effort (today's review).
//   opus-low  the same model, request, captures and limits at effort low.
// No database or server: a memory gate, one RunSpend per review at the review's credit ceiling. Spend: one scoped ledger
// reservation per case and arm at that ceiling, settled at the measured provider cost (unknown at the bound when any call's
// usage is unconfirmed). Nothing is retried. Outputs in the run.mjs layout (outputs/eval/runs/<runId>-before|-opus|-opus-low/
// <caseId>/), so measure.mjs and claude-judge.mjs --before work on them.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ strict: true, options: { run: { type: 'string' }, approval: { type: 'string' }, scope: { type: 'string' }, cases: { type: 'string' }, only: { type: 'string' }, arms: { type: 'string', default: 'opus,opus-low' }, effort: { type: 'string', default: 'medium' } } });
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
if (process.env.EVAL_SPEND_APPROVED !== 'yes' || !values.approval?.trim()) throw new Error('Refusing: EVAL_SPEND_APPROVED=yes and --approval are required');
if (!/^[a-z0-9-]+$/.test(values.run ?? '')) throw new Error('--run must be a plain id');
if (!values.scope) throw new Error('--scope is required (the owner-approved scoped allowance for this qualification)');
const ARM_EFFORT = { opus: null, 'opus-low': 'low' };
const arms = values.arms.split(',').map(arm => arm.trim());
if (!arms.length || arms.some(arm => !(arm in ARM_EFFORT))) throw new Error('--arms takes opus and/or opus-low');
process.chdir(REPO);

const require = createRequire(`${REPO}/scripts/eval/package.json`);
const { loadApp } = require(`${REPO}/scripts/eval/lib/app-modules.cjs`);
const budget = await import(pathToFileURL(path.join(REPO, 'scripts/eval/lib/budget.mjs')).href);
const { serve } = await import(pathToFileURL(path.join(REPO, 'scripts/eval/lib/serve.mjs')).href);
const { scanForSecrets } = await import(pathToFileURL(path.join(REPO, 'scripts/eval/run.mjs')).href);
const { captureForReview, describeCapture, saveShots } = await import(pathToFileURL(path.join(REPO, 'scripts/eval/lib/capture-review.mjs')).href);
const { chromium } = await import('playwright');

// The key goes into this process only (the SDK reads it); never printed or written.
const envFile = process.env.EVAL_ENV_LOCAL?.trim() || path.join(REPO, '.env.local');
if (!path.isAbsolute(envFile) || path.basename(envFile) !== '.env.local') throw new Error('EVAL_ENV_LOCAL must be an absolute path to a .env.local file');
const key = /^ANTHROPIC_API_KEY\s*=\s*(.*)$/m.exec(fs.readFileSync(envFile, 'utf8'))?.[1]?.trim().replace(/^["']|["']$/g, '');
if (!key) throw new Error('ANTHROPIC_API_KEY missing');
// No OpenAI key: a review never generates images.
Object.assign(process.env, { ANTHROPIC_API_KEY: key, MAKEBORNE_AI_COST_USD_PER_CREDIT: '0.03', MAKEBORNE_BUILDER_FALLBACK_MODELS: '', OPENAI_API_KEY: '', MAKEBORNE_IMAGE_MODEL: '', MAKEBORNE_IMAGE_MODELS: '' });
for (const name of ['MAKEBORNE_BUILDER_MODEL', 'MAKEBORNE_MODEL_ROUTING']) delete process.env[name];

const { runBuilder } = loadApp('src/lib/builder/agent.ts');
const { renderedContrastCheck } = loadApp('src/lib/builder/contrast-gate.ts');
const { ProjectFiles } = loadApp('src/lib/builder/files.ts');
const { filesSince, snapshotText } = loadApp('src/lib/builder/site-snapshot.ts');
const { RunSpend, memoryGate } = loadApp('src/lib/ai/run-spend.ts');
const { BUILDER_EFFORT } = loadApp('src/lib/builder/pricing.ts');
const { compileVerdict } = loadApp('src/lib/builder/compile.ts');
const { reviewRequest, reviewAttachments, ReviewInputSchema } = loadApp('src/lib/builder/review.ts');
const { reviewCreditCeiling, REVIEW_MAX_TURNS } = loadApp('src/lib/builder/review-policy.ts');

const RATE = 0.03, STAGE_MS = 280_000;
const policy = BUILDER_EFFORT[values.effort];
if (!policy) throw new Error('--effort must be a builder effort level');
const capMicrousd = Math.round(reviewCreditCeiling(policy.ceilingCredits) * RATE * 1e6);
const casesFile = path.resolve(values.cases ?? path.join(REPO, 'scripts/eval/routing/review-cases.json'));
const only = (values.only ?? '').split(',').map(id => id.trim()).filter(Boolean);
const cases = JSON.parse(fs.readFileSync(casesFile, 'utf8')).cases.filter(item => !only.length || only.includes(item.id));
if (!cases.length) throw new Error('no case selected');
const dirOf = arm => path.join(REPO, 'outputs', 'eval', 'runs', `${values.run}-${arm}`);
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); };

/** The build route's context for an existing website (src/app/api/build/route.ts), from what the saved run recorded: the saved
 * site is the cached snapshot (src/lib/builder/site-snapshot.ts) and the context names what changed since it in the working copy. */
function context({ item, files, history, anchor }) {
  return [`<project title="${item.title.replace(/"/g, "'")}">`, `Brief: ${item.brief}`,
    'Visual direction: No preset — choose the best direction for this business.',
    history.length ? `Recent revisions:\n${history.join('\n')}` : '', '</project>', filesSince(anchor, files),
  ].filter(Boolean).join('\n');
}
function changeStats(before, after) {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].sort().flatMap(file => {
    const a = before.get(file), b = after.get(file);
    if (a === b) return [];
    const left = new Set((a ?? '').split('\n')), right = new Set((b ?? '').split('\n'));
    return [{ file, status: a === undefined ? 'added' : b === undefined ? 'deleted' : 'modified', removedLines: [...left].filter(line => !right.has(line)).length, addedLines: [...right].filter(line => !left.has(line)).length }];
  });
}

const browser = await chromium.launch();
const runtime = await serve(path.join(REPO, 'public'));
const contrastCheck = renderedContrastCheck({ origin: runtime.url, launch: () => chromium.launch() });
const summary = [];
try {
  for (const testCase of cases) {
    const siteDir = path.resolve(REPO, testCase.site);
    const item = JSON.parse(fs.readFileSync(path.join(siteDir, 'item.json'), 'utf8'));
    const source = JSON.parse(fs.readFileSync(path.join(siteDir, 'source.json'), 'utf8'));
    const terminal = fs.existsSync(path.join(siteDir, 'terminal.json')) ? JSON.parse(fs.readFileSync(path.join(siteDir, 'terminal.json'), 'utf8')) : {};
    const history = Object.values(terminal).filter(entry => entry?.type === 'done' && entry.changed !== false && entry.summary).map(entry => `v${entry.version}: ${String(entry.summary).slice(0, 900)}`).slice(-6);
    const baseItem = { id: testCase.id, kind: 'website', title: item.title, direction: item.direction, briefId: testCase.id, relatedBriefId: item.briefId,
      brief: `${item.brief}\n\nThe website above was built and saved. It then had a design review of its rendered pages (screenshots), which may fix visual problems without redesigning it.`, editKind: 'design review' };
    // One capture per site, shared by every arm: the studio's own review input (no cost).
    const beforeDir = path.join(dirOf('before'), testCase.id);
    const capture = await captureForReview({ browser, origin: runtime.url, files: source, assets: {} });
    if (capture.coverageIssue) { console.log(`${testCase.id}: capture not reviewable (${capture.coverageIssue}), skipped`); continue; }
    if (!fs.existsSync(path.join(beforeDir, 'source.json'))) {
      writeJson(path.join(beforeDir, 'item.json'), { ...baseItem, origin: { type: 'live', path: path.relative(REPO, siteDir) }, generation: { arm: 'before', note: 'the saved website the review started from' } });
      fs.copyFileSync(path.join(siteDir, 'source.json'), path.join(beforeDir, 'source.json'));
      writeJson(path.join(beforeDir, 'status.json'), { ok: true, outcome: 'saved website (unchanged)' });
      writeJson(path.join(beforeDir, 'review-1-capture.json'), describeCapture(capture));
      await saveShots(capture, path.join(beforeDir, 'review-1-shots'));
    }
    const input = ReviewInputSchema.parse({ round: 1, ...capture });
    for (const arm of arms) {
      const itemDir = path.join(dirOf(arm), testCase.id);
      if (fs.existsSync(path.join(itemDir, 'cost.json'))) { console.log(`${testCase.id} ${arm}: already run, skipped`); continue; }
      const files = new ProjectFiles(source);
      const before = new Map(files.files), checkpoint = files.checkpoint();
      const anchor = { number: item.origin?.version ?? 1, files: before };
      const effort = ARM_EFFORT[arm] ?? policy.intensity;
      const reservation = await budget.reserveScoped({ scope: values.scope, kind: 'routing-review', ref: `${values.run}/${testCase.id}/${arm}`, boundUsd: capMicrousd / 1e6, provider: 'anthropic', unique: true, note: `${values.approval}. ${arm} design review at effort ${effort}` });
      const spend = new RunSpend({ run: `${values.run}/${testCase.id}/${arm}`, providerCapMicrousd: capMicrousd, customerCapMicrousd: capMicrousd, gate: memoryGate(), deadline: Date.now() + STAGE_MS });
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), STAGE_MS);
      const events = [], started = Date.now();
      const emit = event => { if (['tool_error', 'status', 'file', 'delete'].includes(event.type)) events.push({ type: event.type, path: event.path, tool: event.tool, message: event.message?.slice?.(0, 300) }); };
      let result = null, error = null, outcome = 'ok';
      try {
        result = await runBuilder({ client: null, scope: { workspaceId: 'eval', projectId: testCase.id }, files, effort: values.effort, spend, request: reviewRequest(input), context: context({ item, files, history, anchor }), snapshot: snapshotText(anchor),
          attachments: reviewAttachments(input), emit, signal: controller.signal, deadline: Date.now() + STAGE_MS, limits: { maxTurns: Math.min(REVIEW_MAX_TURNS, policy.maxTurns), maxImages: 0 },
          contrastCheck, compile: compileVerdict, ...(ARM_EFFORT[arm] ? { intensity: ARM_EFFORT[arm] } : {}) });
      } catch (caught) { error = { name: caught.name, code: caught.code ?? null, status: caught.status ?? null, message: String(caught.message).slice(0, 300) }; }
      finally { clearTimeout(timer); }
      // Like website-run.ts: unfinished work is kept only if it compiles; otherwise the saved website stands.
      let build = result?.build ?? null;
      if (!result?.finished && files.changed.size) {
        const verdict = await compileVerdict(files.files);
        if (verdict.status === 'failed') { files.restore(checkpoint); outcome = 'unfinished work did not compile: saved website kept'; }
        else { build = verdict.status; outcome = 'unfinished: progress saved'; }
      }
      if (error) outcome = `error ${error.code ?? error.name}`;
      const ms = Date.now() - started, uncertain = spend.uncertainMicrousd > 0;
      await budget.settle(reservation, uncertain ? { unknown: true, detail: { calls: spend.calls.length } } : { actualUsd: spend.providerMicrousd / 1e6, detail: { calls: spend.calls.length, models: [...new Set(spend.calls.map(call => call.model))], effort } });
      let saved; try { saved = files.toSource(); } catch (invalid) { files.restore(checkpoint); saved = files.toSource(); outcome = `invalid source (${String(invalid.message).slice(0, 120)}): saved website kept`; }
      const changes = changeStats(before, files.files);
      writeJson(path.join(itemDir, 'item.json'), { ...baseItem, origin: { type: 'live', stack: 'none (direct runBuilder; review of a saved isolated-stack website)', path: path.relative(REPO, siteDir) }, generation: { arm, effort, mode: 'design review (direct)', images: 'off' } });
      fs.writeFileSync(path.join(itemDir, 'source.json'), JSON.stringify(saved));
      const cost = { boundUsd: capMicrousd / 1e6, reservationId: reservation, actualUsd: uncertain ? null : spend.providerMicrousd / 1e6, chargedCredits: spend.customerCredits(RATE), effort,
        calls: spend.calls.map(call => ({ model: call.model, boundMicrousd: call.boundMicrousd, actualMicrousd: call.actualMicrousd })), finished: Boolean(result?.finished), build, stopped: result?.stopped ?? spend.stopped, error, ms, changes, summary: result?.summary ?? null };
      writeJson(path.join(itemDir, 'cost.json'), cost);
      fs.writeFileSync(path.join(itemDir, 'events.jsonl'), events.map(event => JSON.stringify(event)).join('\n'));
      writeJson(path.join(itemDir, 'status.json'), { ok: Boolean(result?.finished) && !error, outcome, summary: result?.summary ?? null });
      summary.push({ case: testCase.id, arm, effort, finished: Boolean(result?.finished), build, usd: cost.actualUsd, credits: cost.chargedCredits, ms, files: changes.length, summary: (result?.summary ?? '').slice(0, 160) });
      console.log(`${testCase.id} ${arm} (${effort}): finished=${Boolean(result?.finished)} build=${build} $${(spend.providerMicrousd / 1e6).toFixed(3)} charged ${cost.chargedCredits} cr ${Math.round(ms / 1000)} s ${changes.length} file(s)${error ? ` ERROR ${error.code ?? error.name}` : ''}; scope ${JSON.stringify(budget.scopeSummary(values.scope).committedUsd)}`);
    }
  }
} finally {
  await browser.close(); await runtime.close();
  for (const arm of ['before', ...arms]) {
    const dir = dirOf(arm);
    if (!fs.existsSync(dir)) continue;
    const runFile = path.join(dir, 'run.json');
    const prior = fs.existsSync(runFile) ? JSON.parse(fs.readFileSync(runFile, 'utf8')) : { runId: `${values.run}-${arm}`, mode: arm === 'before' ? 'copy' : 'live', kind: 'routing-review', startedAt: new Date().toISOString(), effort: values.effort, approval: values.approval, scope: values.scope, items: [] };
    prior.items = fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort().map(id => ({ id, kind: 'website' }));
    prior.finishedAt = new Date().toISOString();
    writeJson(runFile, prior);
    const scan = scanForSecrets(dir, [{ name: 'ANTHROPIC_API_KEY', value: key }]);
    console.log(`secret scan ${path.basename(dir)}: ${scan.ok ? 'clean' : `HITS ${scan.hits.map(hit => `${hit.file}: ${hit.secret}`).join('; ')}`} (${scan.files} files)`);
  }
  console.log(JSON.stringify(summary));
}
