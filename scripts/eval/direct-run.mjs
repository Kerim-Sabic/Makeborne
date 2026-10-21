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
//     [--images gpt-image-2.5-flare,gpt-image-2.5-sunburst,gpt-image-2]  (image routing on: OPENAI_API_KEY from the same .env.local;
//      a second, OpenAI ledger reservation per brief covers its images under the OpenAI sub-cap; bytes land in <item>/assets/)
//     [--variant original|enhanced|answered]  (design round 3: "enhanced" runs the app's brief enhancer first, one capped Haiku
//      call with its own ledger reservation (kind direct-enhancer) at the 1-credit hold; "answered" first applies the brief's
//      simulatedAnswers to the on-device design questions the app would ask, then enhances. Short prompts: --only s01-dentist,...
//      read from scripts/eval/briefs-short/; "questions" applies the simulated answers without the enhancer)
// Outputs land in this harness's outputs/eval/runs/<runId>/ in the run.mjs layout (source.json etc.), so measure.mjs works
// on them; item.json says origin.stack "none (direct runBuilder)". Report these runs as direct-agent, not app-route, runs.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const { values } = parseArgs({ strict: true, options: { repo: { type: 'string' }, run: { type: 'string' }, approval: { type: 'string' }, effort: { type: 'string', default: 'medium' }, only: { type: 'string' }, seedless: { type: 'boolean' }, images: { type: 'string' }, variant: { type: 'string', default: 'original' } } });
// This harness: the ledger, the run outputs and the secret scan always go through it.
const DQ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO = path.resolve(values.repo ?? DQ);
if (process.env.EVAL_SPEND_APPROVED !== 'yes' || !values.approval?.trim()) throw new Error('Refusing: EVAL_SPEND_APPROVED=yes and --approval are required');
if (!/^[a-z0-9-]+$/.test(values.run ?? '')) throw new Error('--run must be a plain id');
if (!['medium', 'high'].includes(values.effort)) throw new Error('--effort must be medium or high');
if (!['original', 'enhanced', 'answered', 'questions'].includes(values.variant)) throw new Error('--variant must be original, enhanced, answered or questions');
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
const openaiKey = values.images ? /^OPENAI_API_KEY\s*=\s*(.*)$/m.exec(envText)?.[1]?.trim().replace(/^["']|["']$/g, '') : '';
if (values.images && !openaiKey) throw new Error('--images needs OPENAI_API_KEY in the .env.local');
Object.assign(process.env, { ANTHROPIC_API_KEY: key, MAKEBORNE_AI_COST_USD_PER_CREDIT: '0.03', MAKEBORNE_BUILDER_FALLBACK_MODELS: '', OPENAI_API_KEY: openaiKey, MAKEBORNE_IMAGE_MODEL: '', MAKEBORNE_IMAGE_MODELS: values.images ?? '' });
delete process.env.MAKEBORNE_BUILDER_MODEL;

const { runBuilder } = loadApp('src/lib/builder/agent.ts');
const { renderedContrastCheck } = loadApp('src/lib/builder/contrast-gate.ts');
const { ProjectFiles } = loadApp('src/lib/builder/files.ts');
const { RunSpend, memoryGate } = loadApp('src/lib/ai/run-spend.ts');
const { BUILDER_EFFORT } = loadApp('src/lib/builder/pricing.ts');
const { reviewCreditCeiling, REVIEW_MAX_TURNS, autoReviewRounds } = loadApp('src/lib/builder/review-policy.ts');
const { reviewRequest, reviewAttachments, ReviewInputSchema } = loadApp('src/lib/builder/review.ts');
const { compileVerdict } = loadApp('src/lib/builder/compile.ts');
const imagesModule = values.images ? loadApp('src/lib/builder/images.ts') : null;
const prices = loadApp('src/lib/ai/prices.ts');
const enhancing = values.variant !== 'original';
const questionsModule = enhancing ? loadApp('src/lib/builder/brief-questions.ts') : null;
const enhancedModule = enhancing ? loadApp('src/lib/builder/enhanced-brief.ts') : null;
const enhancerModule = enhancing ? loadApp('src/lib/builder/brief-enhancer.ts') : null;
const { createHash } = await import('node:crypto');
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

function context({ brief, files, history, prep }) {
  // Like the build route: the client's own brief first, then their answers and the approved enhanced brief.
  const seed = !files.files.size && seedBlock ? seedBlock({ seed: brief.projectSeed, brief: [brief.brief, prep.message, prep.approved?.text].filter(Boolean).join('\n'), images: Boolean(values.images) && prep.design?.imagery !== 'type', brand: false,
    ...(enhancing ? { design: prep.design, tone: enhancedModule.briefTone(prep.approved?.text) } : {}) }) : '';
  return [`<project title="${brief.title.replace(/"/g, "'")}">`, `Brief: ${brief.brief}`,
    enhancing ? enhancedModule.designAnswersBlock(prep.design) : '', prep.approved ? enhancedModule.enhancedBriefBlock(prep.approved) : '',
    'Visual direction: No preset — choose the best direction for this business.', seed,
    history.length ? `Recent revisions:\n${history.join('\n')}` : '', '</project>',
    files.files.size ? `<current_files>\n${files.snapshot()}\n</current_files>\nExisting images: none` : '<current_files>(empty — build the complete website from scratch)</current_files>',
  ].filter(Boolean).join('\n');
}

const browser = await chromium.launch();
const runtime = await serve(path.join(REPO, 'public'));
// The build route's rendered-contrast finish gate, on the local runtime origin (same probe, same rules).
const contrastCheck = renderedContrastCheck({ origin: runtime.url, launch: () => chromium.launch() });
try {
  for (const id of only) {
    const brief = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'eval', /^s\d/.test(id) ? 'briefs-short' : 'briefs', `${id}.json`), 'utf8'));
    if (brief.format !== 'website') throw new Error(`${id} is not a website brief`);
    brief.projectSeed = randomUUID();
    const itemDir = path.join(runDir, id);
    if (fs.existsSync(path.join(itemDir, 'cost.json'))) { console.log(`${id}: already run, skipped`); continue; }
    fs.mkdirSync(itemDir, { recursive: true });
    const boundUsd = operationCapMicrousd / 1e6;
    const reservation = await budget.reserve({ kind: 'direct-runner', ref: `${values.run}/${id}`, boundUsd, provider: 'anthropic', unique: true, note: `${budget.CAP_APPROVAL}. ${values.approval}. ${values.effort}` });
    // Images: the run's whole image allowance (max images x the dearest allowed medium bound) reserved under the OpenAI sub-cap.
    const imageModels = imagesModule ? imagesModule.imageConfiguration().models : [];
    const imageBoundUsd = imageModels.length ? policy.maxImages * Math.max(...imageModels.map(model => prices.imageCallBoundMicrousd(model, 'medium', '1024x1536', 'x'.repeat(3400)))) / 1e6 : 0;
    const imageReservation = imageBoundUsd ? await budget.reserve({ kind: 'direct-runner-images', ref: `${values.run}/${id}`, boundUsd: imageBoundUsd, provider: 'openai', unique: true, note: `${budget.CAP_APPROVAL}. ${values.approval}. images ${imageModels.join(',')}` }) : null;
    let openaiMicrousd = 0, openaiUncertain = false;
    const imageBytes = new Map();
    const images = [];
    const started = Date.now();
    const stages = [], events = [];
    let spentMicrousd = 0, uncertain = false;
    const files = new ProjectFiles();
    const history = [];
    // Variants: the studio's first-build path. Answered: the design questions the app would ask, answered as the brief's
    // simulatedAnswers say (skips and "you choose" set nothing); enhanced: the brief enhancer (fail open on any failure).
    const prep = { message: brief.brief.trim(), design: {}, asked: [], approved: null, enhancer: null };
    if (values.variant === 'answered' || values.variant === 'questions') {
      const asked = questionsModule.briefQuestions('website', brief.brief);
      const answers = Object.fromEntries(asked.map(question => { const value = brief.simulatedAnswers?.[question.id]; return [question.id, Array.isArray(value) ? { options: value } : typeof value === 'string' ? { option: value } : {}]; }));
      prep.asked = asked.map(question => question.id);
      prep.message = questionsModule.briefWithAnswers(brief.brief, asked, answers);
      prep.design = questionsModule.designAnswers(asked, answers);
    }
    // Like the studio: short briefs are enhanced; detailed ones get a free analysis of the client's verbatim words.
    const helpMode = enhancing && enhancedModule.shouldEnhance(brief.brief) ? 'enhance' : 'analyze';
    if (enhancing && values.variant !== 'questions') {
      const enhancerBoundUsd = enhancedModule.ENHANCER_CREDITS * RATE;
      const enhancerReservation = await budget.reserve({ kind: 'direct-enhancer', ref: `${values.run}/${id}`, boundUsd: enhancerBoundUsd, provider: 'anthropic', unique: true, note: `${budget.CAP_APPROVAL}. ${values.approval}. brief enhancer (${enhancerModule.ENHANCER_MODEL})` });
      const enhanceSpend = new RunSpend({ run: `${values.run}/${id}/enhance`, providerCapMicrousd: Math.round(enhancerBoundUsd * 1e6), customerCapMicrousd: null, gate: memoryGate(), deadline: Date.now() + 50_000 });
      let enhanced = null, enhanceError = null;
      let reply = null;
      try { enhanced = await enhancerModule.enhanceBrief({ brief: prep.message, title: brief.title, design: prep.design, mode: helpMode, spend: enhanceSpend, signal: AbortSignal.timeout(45_000), onReply: (text, stop) => { reply = { text, stop }; } }); }
      catch (error) { enhanceError = String(error.message).slice(0, 200); }
      const enhancerUncertain = enhanceSpend.uncertainMicrousd > 0;
      await budget.settle(enhancerReservation, enhancerUncertain ? { unknown: true, detail: { error: enhanceError } } : { actualUsd: enhanceSpend.providerMicrousd / 1e6, detail: { calls: enhanceSpend.calls.length, usable: Boolean(enhanced) } });
      prep.enhancer = { mode: helpMode, usd: enhanceSpend.providerMicrousd / 1e6, uncertain: enhancerUncertain, calls: enhanceSpend.calls.length, usable: Boolean(enhanced), error: enhanceError, credits: enhanceSpend.customerCredits(RATE) };
      if (enhanced) prep.approved = helpMode === 'enhance' ? { mode: 'enhanced', text: enhancedModule.renderEnhancedBrief(enhanced) } : { mode: 'analysis', text: enhancedModule.renderBriefAnalysis(enhanced) };
      fs.writeFileSync(path.join(itemDir, 'enhanced.json'), JSON.stringify({ variant: values.variant, asked: prep.asked, design: prep.design, message: prep.message, enhanced, text: prep.approved?.text ?? null, enhancer: prep.enhancer, ...(enhanced ? {} : { unusableReply: reply }) }, null, 2));
      console.log(`  ${id} enhance: $${prep.enhancer.usd.toFixed(4)} usable=${prep.enhancer.usable}${enhanceError ? ` ERROR ${enhanceError}` : ''}`);
    }
    const required = enhancing ? { sections: prep.approved ? enhancedModule.requiredSections(prep.approved.text) : [], design: prep.design, brief: [brief.brief, prep.message].join('\n') } : undefined;
    const message = prep.message.length > 8000 ? `${prep.message.slice(0, 7400).replace(/\s+\S*$/, '')}…` : prep.message;
    const storeImage = async (request, bytes) => {
      const prepared = await imagesModule.prepareImageBytes(bytes, { transparent: request.transparent, quality: request.transparent ? undefined : imagesModule.GENERATED_PHOTO_QUALITY });
      const sha256 = createHash('sha256').update(prepared.bytes).digest('hex');
      fs.mkdirSync(path.join(itemDir, 'assets'), { recursive: true });
      fs.writeFileSync(path.join(itemDir, 'assets', `${request.name}.webp`), prepared.bytes);
      const { default: sharpLib } = await import(pathToFileURL(require.resolve('sharp', { paths: [REPO] })).href).catch(() => ({ default: null }));
      const meta = sharpLib ? await sharpLib(prepared.bytes).metadata() : {};
      const digest = createHash('sha256').update(`eval:${brief.projectSeed}:${sha256}`).digest('hex');
      const assetId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
      imageBytes.set(`/images/${request.name}.webp`, prepared.bytes);
      images.push({ name: request.name, kind: request.kind, route: request.route, transparent: prepared.transparent, width: meta.width, height: meta.height, bytes: prepared.bytes.length });
      return { id: assetId, path: `public/images/${request.name}.webp`, sha256, bytes: prepared.bytes.length, mediaType: 'image/webp', url: `/images/${request.name}.webp`, width: meta.width, height: meta.height, transparent: prepared.transparent };
    };
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
        result = await runBuilder({ client: null, scope: { workspaceId: 'eval', projectId: brief.projectSeed }, files, effort: values.effort, spend, request, context: context({ brief, files, history, prep }), required, contrastCheck,
          // Like the route: the concept step on a first build (nothing written yet, no plan).
          concept: name === 'build' && !files.files.size,
          attachments: extra.attachments ?? [], emit: event => { if (event.type === 'tool_error' || event.type === 'status' || event.type === 'file') events.push({ stage: name, type: event.type, path: event.path, tool: event.tool, message: event.message?.slice?.(0, 300) }); },
          signal: controller.signal, deadline: Date.now() + STAGE_MS, limits: extra.limits ?? (prep.design?.imagery === 'type' ? { maxImages: 0 } : undefined), ...(imagesModule ? { storeImage } : {}) });
      } catch (caught) { error = { name: caught.name, code: caught.code ?? null, status: caught.status ?? null, message: String(caught.message).slice(0, 300) }; }
      finally { clearTimeout(timer); }
      spentMicrousd += spend.providerMicrousd;
      for (const call of spend.calls.filter(item => item.provider === 'openai')) { if (call.actualMicrousd === null) { openaiUncertain = true; openaiMicrousd += call.boundMicrousd; } else openaiMicrousd += call.actualMicrousd; }
      if (spend.uncertainMicrousd > 0) uncertain = true;
      let changed = [...files.changed], reverted = null;
      // Like website-run.ts: unfinished work is kept only if it compiles; otherwise the previous saved files stand.
      if (!result?.finished && changed.length) {
        const verdict = await compileVerdict(files.files);
        if (verdict.status === 'failed') { files.files.clear(); for (const [file, content] of saved) files.files.set(file, content); reverted = verdict.problems.join(' ').slice(0, 300); changed = []; }
      }
      for (const file of before) files.changed.add(file);
      if (result?.concept) fs.writeFileSync(path.join(itemDir, 'concept.json'), JSON.stringify(result.concept, null, 2));
      stages.push({ name, capMicrousd: cap, concept: result?.concept ? { chosen: result.concept.chosen.name, runnersUp: result.concept.runnersUp.map(item => item.name) } : undefined, providerMicrousd: spend.providerMicrousd, uncertainMicrousd: spend.uncertainMicrousd, calls: spend.calls.length, finished: result?.finished ?? false, build: result?.build ?? null, stopped: result?.stopped ?? spend.stopped, summary: result?.summary ?? null, changed, reverted, error });
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
        const assetUrls = Object.fromEntries([...imageBytes].map(([url, bytes]) => [url, `data:image/webp;base64,${bytes.toString('base64')}`]));
        const capture = await captureForReview({ browser, origin: runtime.url, files: source, assets: assetUrls });
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
      const actualUsd = (spentMicrousd - openaiMicrousd) / 1e6;
      if (imageReservation) await budget.settle(imageReservation, openaiUncertain ? { unknown: true, detail: { images: images.length } } : { actualUsd: openaiMicrousd / 1e6, detail: { images: images.map(image => ({ name: image.name, ...image.route })) } });
      if (images.length) fs.writeFileSync(path.join(itemDir, 'images.json'), JSON.stringify(images, null, 2));
      await budget.settle(reservation, uncertain ? { unknown: true, detail: { stages: stages.length } } : { actualUsd, detail: { stages: stages.map(item => ({ name: item.name, usd: (item.providerMicrousd ?? 0) / 1e6 })) } });
      let sourceOk = false;
      try { const source = files.toSource(); fs.writeFileSync(path.join(itemDir, 'source.json'), JSON.stringify(source)); sourceOk = true; } catch (error) { outcome = `no source: ${error.message}`; }
      fs.writeFileSync(path.join(itemDir, 'brief.json'), JSON.stringify(brief, null, 2));
      fs.writeFileSync(path.join(itemDir, 'item.json'), JSON.stringify({ id, kind: 'website', title: brief.title, direction: brief.direction, briefId: id, brief: brief.brief, briefSha256: null,
        origin: { type: 'live', stack: 'none (direct runBuilder)', artifactId: null, version: null, path: null }, generation: { effort: values.effort, styleId: 'automatic', mode: 'create (direct)', images: values.images ? `on (${values.images})` : 'off', seed: Boolean(seedBlock), variant: values.variant, questionsAsked: prep.asked, enhancer: prep.enhancer } }, null, 2));
      fs.writeFileSync(path.join(itemDir, 'events.jsonl'), events.map(event => JSON.stringify(event)).join('\n'));
      fs.writeFileSync(path.join(itemDir, 'cost.json'), JSON.stringify({ boundUsd, reservationId: reservation, actualUsd: uncertain ? null : actualUsd, enhancer: prep.enhancer, images: imageReservation ? { boundUsd: imageBoundUsd, reservationId: imageReservation, actualUsd: openaiUncertain ? null : openaiMicrousd / 1e6, count: images.length } : null, stages, ms: Date.now() - started }, null, 2));
      fs.writeFileSync(path.join(itemDir, 'status.json'), JSON.stringify({ ok: sourceOk && outcome === 'ok', outcome }, null, 2));
      runJson.items = runJson.items.filter(item => item.id !== id).concat({ id, kind: 'website', status: sourceOk ? 'generated' : 'failed', costUsd: uncertain ? null : actualUsd });
      save();
      console.log(`${id}: $${actualUsd.toFixed(3)} of $${boundUsd.toFixed(2)} bound, ${stages.length} stage(s), ${outcome}; ledger ${JSON.stringify(budget.summary().byProvider)}`);
    }
  }
} finally {
  await browser.close(); await runtime.close();
  runJson.finishedAt = new Date().toISOString(); save();
  const scan = scanForSecrets(runDir, [{ name: 'ANTHROPIC_API_KEY', value: key }, ...(openaiKey ? [{ name: 'OPENAI_API_KEY', value: openaiKey }] : [])]);
  console.log(`secret scan: ${scan.ok ? 'clean' : `HITS ${scan.hits.map(hit => `${hit.file}: ${hit.secret}`).join('; ')}`} (${scan.files} files)`);
}
