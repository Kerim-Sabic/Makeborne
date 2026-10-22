// Model-routing qualification: targeted edits on saved websites, the builder model against the routed model, on identical inputs.
//
//   EVAL_SPEND_APPROVED=yes EVAL_ENV_LOCAL=<abs path>/.env.local node scripts/eval/route-qualify.mjs --run <runId> --approval "<who/when>"
//     --scope <scoped allowance> [--cases scripts/eval/routing/edit-cases.json] [--only <caseId,...>] [--arms opus,routed]
//
// Each case is one saved website from an earlier app-route run on the isolated stack (its source.json, read only) and one
// customer edit request. Both arms run the app's own code for one website stage, exactly as POST /api/build does for an
// existing site: the route's context layout, runBuilder (prompt, tools, finish, quality, compile and rendered-contrast gates)
// and routedWebsiteStage (src/lib/builder/website-stage.ts):
//   opus    MAKEBORNE_MODEL_ROUTING off: the builder model, one attempt (today's behaviour).
//   routed  MAKEBORNE_MODEL_ROUTING on with MAKEBORNE_ROUTE_TARGETED_EDIT=<routed model>: the routed attempt (half the budget,
//           60% of the time) and at most one escalation to the builder model, inside the same RunSpend.
// No database or server: a memory gate, one RunSpend per stage at the operation's caps (Medium: 50 credits x $0.03).
// Spend: one scoped ledger reservation per case and arm at that cap, settled at the measured provider cost (unknown at the
// bound when any call's usage is unconfirmed). Nothing is retried. Outputs, in the run.mjs layout so measure.mjs and the
// judge work on them: outputs/eval/runs/<runId>-before|-opus|-routed/<caseId>/. Report these as direct-agent runs.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ strict: true, options: { run: { type: 'string' }, approval: { type: 'string' }, scope: { type: 'string' }, cases: { type: 'string' }, only: { type: 'string' }, arms: { type: 'string', default: 'opus,routed' }, effort: { type: 'string', default: 'medium' } } });
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
if (process.env.EVAL_SPEND_APPROVED !== 'yes' || !values.approval?.trim()) throw new Error('Refusing: EVAL_SPEND_APPROVED=yes and --approval are required');
if (!/^[a-z0-9-]+$/.test(values.run ?? '')) throw new Error('--run must be a plain id');
if (!values.scope) throw new Error('--scope is required (the owner-approved scoped allowance for this qualification)');
const arms = values.arms.split(',').map(arm => arm.trim());
if (!arms.length || arms.some(arm => !['opus', 'shadow', 'routed'].includes(arm))) throw new Error('--arms takes opus, shadow and/or routed');
process.chdir(REPO);

const require = createRequire(`${REPO}/scripts/eval/package.json`);
const { loadApp } = require(`${REPO}/scripts/eval/lib/app-modules.cjs`);
const budget = await import(pathToFileURL(path.join(REPO, 'scripts/eval/lib/budget.mjs')).href);
const { serve } = await import(pathToFileURL(path.join(REPO, 'scripts/eval/lib/serve.mjs')).href);
const { scanForSecrets } = await import(pathToFileURL(path.join(REPO, 'scripts/eval/run.mjs')).href);
// Resolved like measure.mjs and capture-review.mjs do (the eval package's playwright, else the app's).
const { chromium } = await import('playwright');

// The key goes into this process only (the SDK reads it); never printed or written.
const envFile = process.env.EVAL_ENV_LOCAL?.trim() || path.join(REPO, '.env.local');
if (!path.isAbsolute(envFile) || path.basename(envFile) !== '.env.local') throw new Error('EVAL_ENV_LOCAL must be an absolute path to a .env.local file');
const key = /^ANTHROPIC_API_KEY\s*=\s*(.*)$/m.exec(fs.readFileSync(envFile, 'utf8'))?.[1]?.trim().replace(/^["']|["']$/g, '');
if (!key) throw new Error('ANTHROPIC_API_KEY missing');
// No OpenAI key: images are off in both arms (no OpenAI spend in this qualification).
Object.assign(process.env, { ANTHROPIC_API_KEY: key, MAKEBORNE_AI_COST_USD_PER_CREDIT: '0.03', MAKEBORNE_BUILDER_FALLBACK_MODELS: '', OPENAI_API_KEY: '', MAKEBORNE_IMAGE_MODEL: '', MAKEBORNE_IMAGE_MODELS: '' });
for (const name of ['MAKEBORNE_BUILDER_MODEL', 'MAKEBORNE_MODEL_ROUTING']) delete process.env[name];

const { runBuilder } = loadApp('src/lib/builder/agent.ts');
const { routedWebsiteStage, repairRequest } = loadApp('src/lib/builder/website-stage.ts');
const { buildTaskContract } = loadApp('src/lib/builder/task-contract.ts');
const routing = loadApp('src/lib/ai/model-routing.ts');
const { renderedContrastCheck } = loadApp('src/lib/builder/contrast-gate.ts');
const { ProjectFiles } = loadApp('src/lib/builder/files.ts');
const { RunSpend, memoryGate } = loadApp('src/lib/ai/run-spend.ts');
const { BUILDER_EFFORT } = loadApp('src/lib/builder/pricing.ts');
const { compileVerdict } = loadApp('src/lib/builder/compile.ts');

const ROUTED_MODEL = 'claude-sonnet-5-5';
const RATE = 0.03, STAGE_MS = 280_000;
const policy = BUILDER_EFFORT[values.effort];
if (!policy) throw new Error('--effort must be a builder effort level');
const capMicrousd = Math.round(policy.ceilingCredits * RATE * 1e6);
const casesFile = path.resolve(values.cases ?? path.join(REPO, 'scripts/eval/routing/edit-cases.json'));
const only = (values.only ?? '').split(',').map(id => id.trim()).filter(Boolean);
const cases = JSON.parse(fs.readFileSync(casesFile, 'utf8')).cases.filter(item => !only.length || only.includes(item.id));
if (!cases.length) throw new Error('no case selected');
// opus: routing off (today). shadow: off execution, the on-decision recorded. routed: the policy executes (on), Sonnet allowed for edits.
const ROUTES = { MAKEBORNE_ROUTE_TARGETED_EDIT: ROUTED_MODEL, MAKEBORNE_ROUTE_EDIT: ROUTED_MODEL };
const ENV = { opus: {}, shadow: { MAKEBORNE_MODEL_ROUTING: 'shadow', ...ROUTES }, routed: { MAKEBORNE_MODEL_ROUTING: 'on', ...ROUTES } };
const dirOf = arm => path.join(REPO, 'outputs', 'eval', 'runs', `${values.run}-${arm}`);
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); };

/** The build route's context for an existing website (src/app/api/build/route.ts), from what the saved run recorded. */
function context({ item, files, history }) {
  return [`<project title="${item.title.replace(/"/g, "'")}">`, `Brief: ${item.brief}`,
    'Visual direction: No preset — choose the best direction for this business.',
    history.length ? `Recent revisions:\n${history.join('\n')}` : '', '</project>',
    `<current_files>\n${files.snapshot()}\n</current_files>\nExisting images: ${[...files.assets.values()].map(asset => `/${asset.path.slice(7)}`).join(', ') || 'none'}`,
  ].filter(Boolean).join('\n');
}
/** Unified-ish per-file change list (counts only) for the record. */
function changeStats(before, after) {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].sort().flatMap(file => {
    const a = before.get(file), b = after.get(file);
    if (a === b) return [];
    const left = new Set((a ?? '').split('\n')), right = new Set((b ?? '').split('\n'));
    return [{ file, status: a === undefined ? 'added' : b === undefined ? 'deleted' : 'modified', removedLines: [...left].filter(line => !right.has(line)).length, addedLines: [...right].filter(line => !left.has(line)).length }];
  });
}
const copyAssets = (from, to) => { if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true }); };

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
      brief: `${item.brief}\n\nThe website above was built and saved. The client then asked for this change: ${testCase.request}`, editRequest: testCase.request, editKind: testCase.kind };
    // The saved website itself, unchanged: the judge's and measure's baseline (no cost).
    const beforeDir = path.join(dirOf('before'), testCase.id);
    if (!fs.existsSync(path.join(beforeDir, 'source.json'))) {
      writeJson(path.join(beforeDir, 'item.json'), { ...baseItem, origin: { type: 'live', stack: item.origin?.stack ?? null, artifactId: item.origin?.artifactId ?? null, version: item.origin?.version ?? null, path: path.relative(REPO, siteDir) }, generation: { arm: 'before', note: 'the saved website the edit started from' } });
      fs.copyFileSync(path.join(siteDir, 'source.json'), path.join(beforeDir, 'source.json'));
      copyAssets(path.join(siteDir, 'assets'), path.join(beforeDir, 'assets'));
      writeJson(path.join(beforeDir, 'status.json'), { ok: true, outcome: 'saved website (unchanged)' });
    }
    for (const arm of arms) {
      const itemDir = path.join(dirOf(arm), testCase.id);
      if (fs.existsSync(path.join(itemDir, 'cost.json'))) { console.log(`${testCase.id} ${arm}: already run, skipped`); continue; }
      const files = new ProjectFiles(source);
      const before = new Map(files.files), checkpoint = files.checkpoint();
      // The build route's decision on the same inputs, with the task contract (scope and checks) it builds.
      const picked = /([\w./-]+\.(?:tsx|ts|css|html|json|svg|md)) \(line (\d+)\)/.exec(testCase.request);
      const contract = buildTaskContract({ artifact: 'website', objective: 'edit', message: testCase.request, revision: { expectedVersion: item.origin?.version ?? 1 },
        target: picked ? { file: picked[1], line: Number(picked[2]), label: '' } : null, limits: { capCredits: policy.ceilingCredits, repairs: 1, escalations: 1 } });
      const route = routing.routeStage({ stage: 'build', artifact: 'website', request: testCase.request, files: files.files.size, projectBytes: [...files.files.values()].reduce((sum, content) => sum + content.length, 0),
        effort: values.effort, attachments: 0, verification: { compile: true, contrast: true }, contract, operation: { id: null, runId: null, revision: item.origin?.version ?? null } }, ENV[arm]);
      const reservation = await budget.reserveScoped({ scope: values.scope, kind: 'routing-edit', ref: `${values.run}/${testCase.id}/${arm}`, boundUsd: capMicrousd / 1e6, provider: 'anthropic', unique: true, note: `${values.approval}. ${arm} ${values.effort} targeted edit` });
      const spend = new RunSpend({ run: `${values.run}/${testCase.id}/${arm}`, providerCapMicrousd: capMicrousd, customerCapMicrousd: capMicrousd, gate: memoryGate(), deadline: Date.now() + STAGE_MS });
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), STAGE_MS);
      const events = [], started = Date.now();
      const emit = event => { if (['tool_error', 'status', 'file', 'delete', 'route'].includes(event.type)) events.push({ type: event.type, path: event.path, tool: event.tool, message: event.message?.slice?.(0, 300), class: event.class, role: event.role }); };
      let result = null, record = null, error = null, outcome = 'ok';
      try {
        // As website-run.ts: a repair starts a new conversation from the current files with the evidence to fix.
        const attempt = plan => runBuilder({ client: null, scope: { workspaceId: 'eval', projectId: testCase.id }, files, effort: values.effort, spend,
          request: plan.role === 'repair' ? repairRequest(testCase.request, plan.repairNotes) : testCase.request,
          context: context({ item, files, history }), attachments: [], emit, signal: controller.signal, deadline: plan.deadline, contrastCheck, compile: compileVerdict, model: plan.model, firstStep: route.firstStep });
        ({ result, record } = await routedWebsiteStage({ route, stage: 'build', files, spend, deadline: Date.now() + STAGE_MS, signal: controller.signal, emit, compile: compileVerdict, attempt }));
      } catch (caught) { error = { name: caught.name, code: caught.code ?? null, status: caught.status ?? null, message: String(caught.message).slice(0, 300) }; record = caught.route ?? record; }
      finally { clearTimeout(timer); }
      // Like website-run.ts: unfinished work is kept only if it compiles; otherwise the saved website stands.
      let build = result?.build ?? null, kept = Boolean(result?.finished);
      if (!result?.finished && files.changed.size) {
        const verdict = await compileVerdict(files.files);
        if (verdict.status === 'failed') { files.restore(checkpoint); outcome = 'unfinished work did not compile: saved website kept'; }
        else { kept = true; build = verdict.status; outcome = 'unfinished: progress saved'; }
      }
      if (error) outcome = `error ${error.code ?? error.name}`;
      const ms = Date.now() - started;
      const uncertain = spend.uncertainMicrousd > 0;
      await budget.settle(reservation, uncertain ? { unknown: true, detail: { calls: spend.calls.length } } : { actualUsd: spend.providerMicrousd / 1e6, detail: { calls: spend.calls.length, models: [...new Set(spend.calls.map(call => call.model))] } });
      let saved; try { saved = files.toSource(); } catch (invalid) { files.restore(checkpoint); saved = files.toSource(); outcome = `invalid source (${String(invalid.message).slice(0, 120)}): saved website kept`; kept = false; }
      const changes = changeStats(before, files.files);
      writeJson(path.join(itemDir, 'item.json'), { ...baseItem, origin: { type: 'live', stack: 'none (direct runBuilder; edit of a saved isolated-stack website)', artifactId: item.origin?.artifactId ?? null, version: item.origin?.version ?? null, path: path.relative(REPO, siteDir) },
        generation: { arm, effort: values.effort, mode: 'edit (direct)', images: 'off', route: { policy: route.policyVersion, mode: route.mode, class: route.class, model: route.model, escalation: route.escalation, codes: route.reasonCodes, limits: route.limits, shadow: route.shadow, contract: contract.version, checks: route.requiredChecks } } });
      fs.writeFileSync(path.join(itemDir, 'source.json'), JSON.stringify(saved));
      copyAssets(path.join(siteDir, 'assets'), path.join(itemDir, 'assets'));
      const cost = { boundUsd: capMicrousd / 1e6, reservationId: reservation, actualUsd: uncertain ? null : spend.providerMicrousd / 1e6, chargedCredits: spend.customerCredits(RATE), absorbedUsd: spend.absorbedMicrousd / 1e6,
        calls: spend.calls.map(call => ({ model: call.model, boundMicrousd: call.boundMicrousd, actualMicrousd: call.actualMicrousd })), route: routing.routeDetail(record), finished: Boolean(result?.finished), build, kept, stopped: result?.stopped ?? spend.stopped, error, ms, changes };
      writeJson(path.join(itemDir, 'cost.json'), cost);
      fs.writeFileSync(path.join(itemDir, 'events.jsonl'), events.map(event => JSON.stringify(event)).join('\n'));
      writeJson(path.join(itemDir, 'status.json'), { ok: Boolean(result?.finished) && !error, outcome, summary: result?.summary ?? null });
      summary.push({ case: testCase.id, arm, models: record?.models ?? [route.model], escalation: record?.escalation ?? null, finished: Boolean(result?.finished), build, usd: cost.actualUsd, credits: cost.chargedCredits, ms, files: changes.length });
      console.log(`${testCase.id} ${arm}: ${(record?.models ?? [route.model]).join(' > ')} finished=${Boolean(result?.finished)} build=${build} $${(spend.providerMicrousd / 1e6).toFixed(3)} charged ${cost.chargedCredits} cr ${Math.round(ms / 1000)} s ${changes.length} file(s)${record?.escalation ? ` ESCALATED (${record.escalation})` : ''}${error ? ` ERROR ${error.code ?? error.name}` : ''}; scope ${JSON.stringify(budget.scopeSummary(values.scope).committedUsd)}`);
    }
  }
} finally {
  await browser.close(); await runtime.close();
  for (const arm of ['before', ...arms]) {
    const dir = dirOf(arm);
    if (!fs.existsSync(dir)) continue;
    const runFile = path.join(dir, 'run.json');
    const prior = fs.existsSync(runFile) ? JSON.parse(fs.readFileSync(runFile, 'utf8')) : { runId: `${values.run}-${arm}`, mode: arm === 'before' ? 'copy' : 'live', kind: 'routing-edit', startedAt: new Date().toISOString(), effort: values.effort, approval: values.approval, scope: values.scope, items: [] };
    prior.items = fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort().map(id => ({ id, kind: 'website' }));
    prior.finishedAt = new Date().toISOString();
    writeJson(runFile, prior);
    const scan = scanForSecrets(dir, [{ name: 'ANTHROPIC_API_KEY', value: key }]);
    console.log(`secret scan ${path.basename(dir)}: ${scan.ok ? 'clean' : `HITS ${scan.hits.map(hit => `${hit.file}: ${hit.secret}`).join('; ')}`} (${scan.files} files)`);
  }
  console.log(JSON.stringify(summary));
}
