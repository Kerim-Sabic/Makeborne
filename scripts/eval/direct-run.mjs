// Direct builder runs (a fallback to run.mjs --live when the isolated stack cannot serve the app routes;
// first used 20 October 2026 with the owner's go while four stack migrations were pending):
// the app's own runBuilder (same system prompt, tools, model, finish/compile checks and review rubric),
// driven like the studio's Create mode (build -> <= 2 continuations -> 1 design review with the studio's
// capture code), WITHOUT the database or the Next server. Spend: one eval-ledger reservation per brief
// at the operation's worst case (effort ceiling credits x $0.03), and every call inside it bounded by
// RunSpend (memory gate) against what the operation has left. No retries of failed stages.
//
//   EVAL_SPEND_APPROVED=yes [EVAL_ENV_LOCAL=<abs path>/.env.local] node scripts/eval/direct-run.mjs --run <runId> --approval "<who/when>"
//     --effort medium|high --only w01,w02 [--repo <another checkout whose app code to run, e.g. an extracted base commit>]
// Outputs land in this harness's outputs/eval/runs/<runId>/ in the run.mjs layout (source.json etc.), so measure.mjs works
// on them; item.json says origin.stack "none (direct runBuilder)". Report these runs as direct-agent, not app-route, runs.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const { values } = parseArgs({ strict: true, options: { repo: { type: 'string' }, run: { type: 'string' }, approval: { type: 'string' }, effort: { type: 'string', default: 'medium' }, only: { type: 'string' }, seedless: { type: 'boolean' } } });
// This harness: the ledger, the run outputs and the secret scan always go through it.
const DQ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO = path.resolve(values.repo ?? DQ);
if (process.env.EVAL_SPEND_APPROVED !== 'yes' || !values.approval?.trim()) throw new Error('Refusing: EVAL_SPEND_APPROVED=yes and --approval are required');
if (!/^[a-z0-9-]+$/.test(values.run ?? '')) throw new Error('--run must be a plain id');
if (!['medium', 'high'].includes(values.effort)) throw new Error('--effort must be medium or high');
const only = (values.only ?? '').split(',').map(id => id.trim()).filter(Boolean);
if (!only.length || only.length > 8) throw new Error('--only takes 1 to 8 brief ids');
process.chdir(REPO);

const require = createRequire(`${REPO}/scripts/eval/package.json`);
const { loadApp } = require(`${REPO}/scripts/eval/lib/app-modules.cjs`);
const imp = file => import(pathToFileURL(path.join(REPO, file)).href);
// The one ledger (and the run outputs) always go through the design-quality harness.
const budget = await import(pathToFileURL(path.join(DQ, 'scripts/eval/lib/budget.mjs')).href);
const { serve } = await imp('scripts/eval/lib/serve.mjs');
const { captureForReview, describeCapture, saveShots } = await imp('scripts/eval/lib/capture-review.mjs');
const { scanForSecrets } = await import(pathToFileURL(path.join(DQ, 'scripts/eval/run.mjs')).href);
const { chromium } = await import(pathToFileURL(`${REPO}/scripts/eval/node_modules/playwright/index.mjs`).href);

// The key goes into this process only (the SDK reads it); never printed or written.
const envFile = process.env.EVAL_ENV_LOCAL?.trim() || path.join(DQ, '.env.local');
if (!path.isAbsolute(envFile) || path.basename(envFile) !== '.env.local') throw new Error('EVAL_ENV_LOCAL must be an absolute path to a .env.local file');
const envText = fs.readFileSync(envFile, 'utf8');
const key = /^ANTHROPIC_API_KEY\s*=\s*(.*)$/m.exec(envText)?.[1]?.trim().replace(/^["']|["']$/g, '');
if (!key) throw new Error('ANTHROPIC_API_KEY missing');
Object.assign(process.env, { ANTHROPIC_API_KEY: key, MAKEBORNE_AI_COST_USD_PER_CREDIT: '0.03', MAKEBORNE_BUILDER_FALLBACK_MODELS: '', OPENAI_API_KEY: '', MAKEBORNE_IMAGE_MODEL: '' });
delete process.env.MAKEBORNE_BUILDER_MODEL;

const { runBuilder } = loadApp('src/lib/builder/agent.ts');
const { ProjectFiles } = loadApp('src/lib/builder/files.ts');
const { RunSpend, memoryGate } = loadApp('src/lib/ai/run-spend.ts');
const { BUILDER_EFFORT } = loadApp('src/lib/builder/pricing.ts');
const { reviewCreditCeiling, REVIEW_MAX_TURNS, autoReviewRounds } = loadApp('src/lib/builder/review-policy.ts');
const { reviewRequest, reviewAttachments, ReviewInputSchema } = loadApp('src/lib/builder/review.ts');
const { compileVerdict } = loadApp('src/lib/builder/compile.ts');
let seedBlock = null;
try { seedBlock = values.seedless ? null : loadApp('src/lib/builder/design-seed.ts').designSeedBlock; } catch { seedBlock = null; }

const RATE = 0.03, STAGE_MS = 280_000;
const CONTINUE_PREFIX = 'Continue the previous request and complete everything that is still missing, then check the project and call finish. The previous request was:\n';
const policy = BUILDER_EFFORT[values.effort];
const operationCapMicrousd = Math.round(policy.ceilingCredits * RATE * 1e6);
const runDir = path.join(DQ, 'outputs', 'eval', 'runs', values.run);
fs.mkdirSync(runDir, { recursive: true });
const runJsonFile = path.join(runDir, 'run.json');
const runJson = fs.existsSync(runJsonFile) ? JSON.parse(fs.readFileSync(runJsonFile, 'utf8'))
  : { runId: values.run, mode: 'live', kind: 'direct-builder', startedAt: new Date().toISOString(), effort: values.effort, approval: values.approval, repo: path.basename(REPO), items: [] };
const save = () => fs.writeFileSync(runJsonFile, JSON.stringify(runJson, null, 2));
save();

function context({ brief, files, history }) {
  const seed = !files.files.size && seedBlock ? seedBlock({ seed: brief.projectSeed, brief: brief.brief, images: false, brand: false }) : '';
  return [`<project title="${brief.title.replace(/"/g, "'")}">`, `Brief: ${brief.brief}`, 'Visual direction: No preset — choose the best direction for this business.', seed,
    history.length ? `Recent revisions:\n${history.join('\n')}` : '', '</project>',
    files.files.size ? `<current_files>\n${files.snapshot()}\n</current_files>\nExisting images: none` : '<current_files>(empty — build the complete website from scratch)</current_files>',
  ].filter(Boolean).join('\n');
}

const browser = await chromium.launch();
const runtime = await serve(path.join(REPO, 'public'));
try {
  for (const id of only) {
    const brief = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'eval', 'briefs', `${id}.json`), 'utf8'));
    if (brief.format !== 'website') throw new Error(`${id} is not a website brief`);
    brief.projectSeed = randomUUID();
    const itemDir = path.join(runDir, id);
    if (fs.existsSync(path.join(itemDir, 'cost.json'))) { console.log(`${id}: already run, skipped`); continue; }
    fs.mkdirSync(itemDir, { recursive: true });
    const boundUsd = operationCapMicrousd / 1e6;
    const reservation = await budget.reserve({ kind: 'direct-runner', ref: `${values.run}/${id}`, boundUsd, provider: 'anthropic', unique: true, note: `${budget.CAP_APPROVAL}. ${values.approval}. ${values.effort}` });
    const started = Date.now();
    const stages = [], events = [];
    let spentMicrousd = 0, uncertain = false;
    const files = new ProjectFiles();
    const history = [];
    const message = brief.brief.trim().length > 8000 ? `${brief.brief.trim().slice(0, 7400).replace(/\s+\S*$/, '')}…` : brief.brief.trim();
    const stage = async (name, request, extra = {}) => {
      const remaining = operationCapMicrousd - spentMicrousd;
      const cap = Math.min(remaining, extra.capMicrousd ?? remaining);
      if (cap <= 20_000) return null;
      const spend = new RunSpend({ run: `${values.run}/${id}/${name}`, providerCapMicrousd: cap, customerCapMicrousd: null, gate: memoryGate(), deadline: Date.now() + STAGE_MS });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), STAGE_MS);
      const before = new Set(files.changed); files.changed.clear();
      const saved = new Map(files.files);
      let result = null, error = null;
      try {
        result = await runBuilder({ client: null, scope: { workspaceId: 'eval', projectId: brief.projectSeed }, files, effort: values.effort, spend, request, context: context({ brief, files, history }),
          attachments: extra.attachments ?? [], emit: event => { if (event.type === 'tool_error' || event.type === 'status' || event.type === 'file') events.push({ stage: name, type: event.type, path: event.path, tool: event.tool, message: event.message?.slice?.(0, 300) }); },
          signal: controller.signal, deadline: Date.now() + STAGE_MS, limits: extra.limits });
      } catch (caught) { error = { name: caught.name, code: caught.code ?? null, status: caught.status ?? null, message: String(caught.message).slice(0, 300) }; }
      finally { clearTimeout(timer); }
      spentMicrousd += spend.providerMicrousd;
      if (spend.uncertainMicrousd > 0) uncertain = true;
      let changed = [...files.changed], reverted = null;
      // Like website-run.ts: unfinished work is kept only if it compiles; otherwise the previous saved files stand.
      if (!result?.finished && changed.length) {
        const verdict = await compileVerdict(files.files);
        if (verdict.status === 'failed') { files.files.clear(); for (const [file, content] of saved) files.files.set(file, content); reverted = verdict.problems.join(' ').slice(0, 300); changed = []; }
      }
      for (const file of before) files.changed.add(file);
      stages.push({ name, capMicrousd: cap, providerMicrousd: spend.providerMicrousd, uncertainMicrousd: spend.uncertainMicrousd, calls: spend.calls.length, finished: result?.finished ?? false, build: result?.build ?? null, stopped: result?.stopped ?? spend.stopped, summary: result?.summary ?? null, changed, reverted, error });
      if (result?.summary) history.push(`v${history.length + 1}: ${(name === 'review' ? 'Design review' : message.slice(0, 600))} → ${result.summary}`.slice(0, 300));
      console.log(`  ${id} ${name}: $${(spend.providerMicrousd / 1e6).toFixed(3)} (${spend.calls.length} calls) finished=${result?.finished ?? false}${error ? ` ERROR ${error.code ?? error.name}` : ''}`);
      return { result, error, changed };
    };
    let outcome = 'ok';
    try {
      let built = await stage('build', message);
      let touched = built?.changed.length ?? 0;
      for (let attempt = 1; attempt <= 2 && built && !built.result?.finished && !built.error && files.files.size; attempt++) {
        built = await stage(`continuation-${attempt}`, `${CONTINUE_PREFIX}${message.slice(0, 6000)}`);
        touched += built?.changed.length ?? 0;
      }
      if (files.files.size && autoReviewRounds(values.effort, { firstBuild: true, filesTouched: touched }) > 0) {
        const source = files.toSource();
        const capture = await captureForReview({ browser, origin: runtime.url, files: source });
        fs.writeFileSync(path.join(itemDir, 'review-1-capture.json'), JSON.stringify(describeCapture(capture), null, 2));
        await saveShots(capture, path.join(itemDir, 'review-1-shots'));
        if (capture.coverageIssue) stages.push({ name: 'review', skipped: capture.coverageIssue });
        else {
          const input = ReviewInputSchema.parse({ round: 1, ...capture });
          await stage('review', reviewRequest(input), { attachments: reviewAttachments(input), capMicrousd: Math.round(reviewCreditCeiling(policy.ceilingCredits) * RATE * 1e6), limits: { maxTurns: Math.min(REVIEW_MAX_TURNS, policy.maxTurns), maxImages: 0 } });
        }
      }
    } catch (error) { outcome = `error: ${String(error.message).slice(0, 200)}`; }
    finally {
      const actualUsd = spentMicrousd / 1e6;
      await budget.settle(reservation, uncertain ? { unknown: true, detail: { stages: stages.length } } : { actualUsd, detail: { stages: stages.map(item => ({ name: item.name, usd: (item.providerMicrousd ?? 0) / 1e6 })) } });
      let sourceOk = false;
      try { const source = files.toSource(); fs.writeFileSync(path.join(itemDir, 'source.json'), JSON.stringify(source)); sourceOk = true; } catch (error) { outcome = `no source: ${error.message}`; }
      fs.writeFileSync(path.join(itemDir, 'brief.json'), JSON.stringify(brief, null, 2));
      fs.writeFileSync(path.join(itemDir, 'item.json'), JSON.stringify({ id, kind: 'website', title: brief.title, direction: brief.direction, briefId: id, brief: brief.brief, briefSha256: null,
        origin: { type: 'live', stack: 'none (direct runBuilder)', artifactId: null, version: null, path: null }, generation: { effort: values.effort, styleId: 'automatic', mode: 'create (direct)', images: 'off', seed: Boolean(seedBlock) } }, null, 2));
      fs.writeFileSync(path.join(itemDir, 'events.jsonl'), events.map(event => JSON.stringify(event)).join('\n'));
      fs.writeFileSync(path.join(itemDir, 'cost.json'), JSON.stringify({ boundUsd, reservationId: reservation, actualUsd: uncertain ? null : actualUsd, stages, ms: Date.now() - started }, null, 2));
      fs.writeFileSync(path.join(itemDir, 'status.json'), JSON.stringify({ ok: sourceOk && outcome === 'ok', outcome }, null, 2));
      runJson.items = runJson.items.filter(item => item.id !== id).concat({ id, kind: 'website', status: sourceOk ? 'generated' : 'failed', costUsd: uncertain ? null : actualUsd });
      save();
      console.log(`${id}: $${actualUsd.toFixed(3)} of $${boundUsd.toFixed(2)} bound, ${stages.length} stage(s), ${outcome}; ledger ${JSON.stringify(budget.summary().byProvider)}`);
    }
  }
} finally {
  await browser.close(); await runtime.close();
  runJson.finishedAt = new Date().toISOString(); save();
  const scan = scanForSecrets(runDir, [{ name: 'ANTHROPIC_API_KEY', value: key }]);
  console.log(`secret scan: ${scan.ok ? 'clean' : `HITS ${scan.hits.map(hit => `${hit.file}: ${hit.secret}`).join('; ')}`} (${scan.files} files)`);
}
