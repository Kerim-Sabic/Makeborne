#!/usr/bin/env node
// Direct presentation and book runs for an owner-approved scope: the app's own runDocumentBuilder (same prompts, tools,
// models, text gate and checks), driven like the studio (a first build, then one continuation when slides wait), without
// the database or the Next server. Spend: per item one Anthropic reservation at the operation's worst case (effort
// ceiling credits x $0.03) and one OpenAI reservation at its image share, both in the recorded scope; every call inside
// is bounded by RunSpend against what the operation has left. Sequential, no retries of failed stages.
//
//   EVAL_SPEND_APPROVED=yes node scripts/eval/doc-run.mjs --run <runId> --scope <scope> --approval "<owner's words>"
//     --only deck-alba,deck-helio,book-fungi,book-ollie [--effort high] [--env <abs path>/.env.local]
//
// Outputs: outputs/eval/runs/<runId>/<item>/ document.json, images/*.png (every generated image), export.pdf (and
// export.pptx for decks), cost.json, summary.txt. Keys go into this process only and the folder is scanned for them.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const require = createRequire(import.meta.url);
const { loadApp } = require('./lib/app-modules.cjs');
const { values } = parseArgs({ strict: true, options: { run: { type: 'string' }, scope: { type: 'string' }, approval: { type: 'string' }, only: { type: 'string' }, effort: { type: 'string', default: 'high' }, env: { type: 'string' } } });
if (process.env.EVAL_SPEND_APPROVED !== 'yes' || !values.approval?.trim()) throw new Error('Refusing: EVAL_SPEND_APPROVED=yes and --approval are required');
if (!/^[a-z0-9-]+$/.test(values.run ?? '')) throw new Error('--run must be a plain id');
if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(values.scope ?? '')) throw new Error('--scope must name the recorded scope');
if (!['medium', 'high'].includes(values.effort)) throw new Error('--effort must be medium or high');

/** The items: briefs that mirror the owner's reference examples (Z:/makeborne-films/v14/gen), each with its client choices. */
export const ITEMS = {
  'deck-alba': { kind: 'deck', title: 'A second oven', options: { aspect: '16:9', quality: 'high' }, reference: ['a_deck1', 'a_deck2', 'a_deck3', 'a_deck4'],
    brief: 'A 6-slide deck for our bank meeting on Monday at 9:00, asking for a loan for a second oven. Alba Bakehouse is a small artisan sourdough bakery in Porto. We have baked in one wood-fired oven for 6 years. We sell 1,240 loaves a week and sell out by 11 a.m. most days (average sell-out 11:04). Our waiting list grew every month: May 180, Jun 220, Jul 260, Aug 300, Sep 350, Oct 412 people on the waiting list. We need €48,000 for a second oven; it pays back in 19 months. Plan for 2027. Brand: warm cream #F4EDE3 background, deep brown-black #2A1D14 text, terracotta #B5562F accent, an elegant high-contrast serif for headlines. Warm documentary photography of the bakery at dawn.' },
  'deck-helio': { kind: 'deck', title: 'Every roof is a power plant', options: { aspect: '4:3', quality: 'high' }, reference: ['r_solar', 'r_mars'],
    brief: 'A 6-slide seed pitch deck for investors for Helio, a startup that installs rooftop solar on family homes in Portugal. Homes powered by our installs: 2022 2,100; 2023 6,800; 2024 14,500; 2025 26,000; 2026 41,000 homes. An install takes 1 day. Households save 38% on their power bills. We are raising a €2M seed round. Brand: warm white background, near-black text, sunflower-yellow accent, a bold modern sans. Crisp photography of black solar panels on terracotta roofs under a blue sky.' },
  'book-fungi': { kind: 'book', title: 'Mushrooms of the Northern Woods', options: { shape: 'portrait', quality: 'high' }, reference: ['r_fungi'],
    brief: 'A short illustrated field guide titled "Mushrooms of the Northern Woods" with the subtitle "A field guide for curious walkers", by Ana Rowe. Two chapters of about 500 words each: "Before you pick" (the safety rules: never eat a mushroom you cannot identify with certainty, pick only what you need, carry a basket) and "Chanterelles and their look-alikes" (how to tell a chanterelle from a false chanterelle and a jack-o\'-lantern). Precise botanical watercolour illustration on a deep forest-green ground, elegant cream serif type, small gold rules.\n\n- Images in the book: Cover and chapter openers\n- Image style: Botanical watercolour' },
  'book-ollie': { kind: 'book', title: 'Ollie Was Afraid of the Water', options: { shape: 'square', quality: 'high' }, reference: ['r_whale', 'r_cat'],
    brief: 'A children\'s picture book titled "Ollie Was Afraid of the Water" by Mira Holt. One spread only, with exactly these words: "Ollie was the only whale who was afraid of the water." On the art: a big gentle blue whale peeking nervously over the edge of a small wooden pier, a little girl in a yellow raincoat holding out her hand, soft pastel watercolour sea and gulls. Gouache and soft watercolour on cream paper, friendly serif type.\n\n- Images in the book: Picture book\n- Image style: Gouache and soft watercolour' },
};
const only = (values.only ?? '').split(',').map(id => id.trim()).filter(Boolean);
if (!only.length || only.some(id => !ITEMS[id])) throw new Error(`--only takes item ids from: ${Object.keys(ITEMS).join(', ')}`);

const envFile = values.env?.trim() || path.join(REPO, '.env.local');
if (!path.isAbsolute(envFile) || path.basename(envFile) !== '.env.local') throw new Error('--env must be an absolute path to a .env.local file');
const envText = fs.readFileSync(envFile, 'utf8');
const read = name => new RegExp(`^${name}\\s*=\\s*(.*)$`, 'm').exec(envText)?.[1]?.trim().replace(/^["']|["']$/g, '');
const anthropicKey = read('ANTHROPIC_API_KEY'), openaiKey = read('OPENAI_API_KEY');
if (!anthropicKey || !openaiKey) throw new Error('The .env.local needs ANTHROPIC_API_KEY and OPENAI_API_KEY');
const MODELS = ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'];
Object.assign(process.env, { ANTHROPIC_API_KEY: anthropicKey, OPENAI_API_KEY: openaiKey, MAKEBORNE_AI_COST_USD_PER_CREDIT: '0.03', MAKEBORNE_BUILDER_FALLBACK_MODELS: '', MAKEBORNE_IMAGE_MODEL: '', MAKEBORNE_IMAGE_MODELS: MODELS.join(','),
  // The eval measures the full pipeline: full-image slides are off by default in the app (lib/builder/features.ts).
  MAKEBORNE_DECK_FULL_IMAGE: 'on' });
delete process.env.MAKEBORNE_BUILDER_MODEL;

const budget = await import(pathToFileURL(path.join(HERE, 'lib', 'budget.mjs')).href);
const { scanForSecrets } = await import(pathToFileURL(path.join(HERE, 'run.mjs')).href);
const { runDocumentBuilder } = loadApp('src/lib/builder/docs-agent.ts');
const { DocumentEditor, emptyDocument } = loadApp('src/lib/documents/editor.ts');
const { bookImagePlanFromBrief, deckModeFromBrief } = loadApp('src/lib/documents/creation-options.ts');
const { newDocumentFormat } = loadApp('src/lib/documents/art-formats.ts');
const { RunSpend, memoryGate } = loadApp('src/lib/ai/run-spend.ts');
const { BUILDER_EFFORT } = loadApp('src/lib/builder/pricing.ts');
const { documentPdf, documentPptx } = loadApp('src/lib/documents/export-server.ts');

const RATE = 0.03, STAGE_MS = 280_000;
const policy = BUILDER_EFFORT[values.effort];
const operationCapMicrousd = Math.round(policy.ceilingCredits * RATE * 1e6);
const runDir = path.join(REPO, 'outputs', 'eval', 'runs', values.run);
fs.mkdirSync(runDir, { recursive: true });
fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ runId: values.run, mode: 'live', kind: 'direct-documents', scope: values.scope, approval: values.approval, effort: values.effort, startedAt: new Date().toISOString(), items: only }, null, 2));

for (const id of only) {
  const item = ITEMS[id], itemDir = path.join(runDir, id), imageDir = path.join(itemDir, 'images');
  if (fs.existsSync(path.join(itemDir, 'cost.json'))) { console.log(`${id}: already run, skipped`); continue; }
  fs.mkdirSync(imageDir, { recursive: true });
  // Worst cases: Claude the whole operation; images their share over the build and its continuation (a full-image deck
  // may use 70% of each stage's allowance, so up to the whole operation; a book a third of each, so two thirds).
  const openaiBound = Math.round(operationCapMicrousd * (item.kind === 'deck' ? 1 : 2 / 3)) / 1e6;
  const note = `${values.approval.trim()} | ${id} ${values.effort}`;
  // The document is set up before anything is reserved.
  const kind = item.kind === 'deck' ? 'deck' : 'book', text = item.brief;
  const format = newDocumentFormat(item.kind === 'deck' ? 'presentation' : 'book', text, item.options, MODELS[0]);
  const editor = new DocumentEditor(emptyDocument(kind, item.title, undefined, kind === 'book'
    ? { imagePlan: bookImagePlanFromBrief(text), shape: format.shape, quality: format.quality, bookArt: true }
    : { slideMode: deckModeFromBrief(text).mode, aspect: format.aspect, quality: format.quality, pageNumbers: true }));
  const anthropicReservation = await budget.reserveScoped({ scope: values.scope, kind: 'doc-runner', ref: `${values.run}/${id}`, boundUsd: operationCapMicrousd / 1e6, provider: 'anthropic', unique: true, note });
  const openaiReservation = await budget.reserveScoped({ scope: values.scope, kind: 'doc-runner-images', ref: `${values.run}/${id}`, boundUsd: openaiBound, provider: 'openai', unique: true, note });
  const stored = new Map();
  const storeImage = async (request, bytes) => {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    fs.writeFileSync(path.join(imageDir, `${request.name}.png`), bytes);
    stored.set(request.name, bytes);
    return { id: randomUUID(), path: `public/images/${request.name}.webp`, sha256, bytes: bytes.length, mediaType: 'image/png', url: `/images/${request.name}.png` };
  };
  const stages = [];
  let spent = 0, openaiSpent = 0, uncertain = false;
  const context = [`<project kind="${kind === 'deck' ? 'presentation' : 'book'}" title="${item.title}">`, `Brief: ${text}`, '</project>',
    `<current_document>(empty — create the complete ${kind === 'deck' ? 'presentation' : 'book'} from scratch; the default theme below is only a placeholder)\n${JSON.stringify({ theme: editor.doc.theme })}</current_document>`].join('\n');
  for (const name of ['build', 'continuation']) {
    const cap = operationCapMicrousd - spent;
    if (cap <= 50_000) break;
    if (name === 'continuation' && (stages.at(-1)?.finished || stages.at(-1)?.error)) break;
    const spend = new RunSpend({ run: `${values.run}/${id}/${name}`, providerCapMicrousd: cap, customerCapMicrousd: null, gate: memoryGate(), deadline: Date.now() + STAGE_MS });
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), STAGE_MS);
    let result = null, error = null;
    try {
      result = await runDocumentBuilder({ client: null, scope: { workspaceId: 'eval', projectId: id }, editor, effort: values.effort, spend,
        request: name === 'build' ? text : `Continue the previous request: render the slides or pages that are still waiting, check them, then finish. The previous request was:\n${text}`,
        context: name === 'build' ? context : `${context.replace(/<current_document>[\s\S]*<\/current_document>/, '')}\n<current_document>\n${editor.snapshot()}\n</current_document>`,
        attachments: [], emit: () => {}, signal: controller.signal, deadline: Date.now() + STAGE_MS, storeImage, imageModels: MODELS });
    } catch (caught) { error = { name: caught.name, code: caught.code ?? null, message: String(caught.message).slice(0, 300) }; }
    finally { clearTimeout(timer); }
    spent += spend.providerMicrousd;
    for (const call of spend.calls.filter(entry => entry.provider === 'openai')) openaiSpent += call.actualMicrousd ?? call.boundMicrousd;
    if (spend.uncertainMicrousd > 0) uncertain = true;
    stages.push({ name, capMicrousd: cap, providerMicrousd: spend.providerMicrousd, calls: spend.calls.length, finished: result?.finished ?? false, summary: result?.summary ?? null, checks: result?.checks ?? [], error });
    console.log(`  ${id} ${name}: $${(spend.providerMicrousd / 1e6).toFixed(3)} (${spend.calls.length} calls) finished=${result?.finished ?? false}${error ? ` ERROR ${error.code ?? error.name}: ${error.message}` : ''}`);
  }
  await budget.settle(openaiReservation, uncertain ? { unknown: true } : { actualUsd: openaiSpent / 1e6 });
  await budget.settle(anthropicReservation, uncertain ? { unknown: true } : { actualUsd: (spent - openaiSpent) / 1e6 });
  fs.writeFileSync(path.join(itemDir, 'document.json'), JSON.stringify(editor.doc, null, 2));
  const buffers = Object.fromEntries(editor.doc.assets.flatMap(asset => stored.has(asset.name) ? [[asset.name, stored.get(asset.name)]] : []));
  try { fs.writeFileSync(path.join(itemDir, 'export.pdf'), await documentPdf(editor.doc, buffers)); } catch (error) { console.log(`  ${id}: PDF failed: ${error.message}`); }
  if (kind === 'deck') { try { fs.writeFileSync(path.join(itemDir, 'export.pptx'), await documentPptx(editor.doc, buffers)); } catch (error) { console.log(`  ${id}: PPTX failed: ${error.message}`); } }
  fs.writeFileSync(path.join(itemDir, 'cost.json'), JSON.stringify({ anthropicReservation, openaiReservation, boundUsd: { anthropic: operationCapMicrousd / 1e6, openai: openaiBound }, actualUsd: uncertain ? null : { anthropic: (spent - openaiSpent) / 1e6, openai: openaiSpent / 1e6 }, format, stages }, null, 2));
  fs.writeFileSync(path.join(itemDir, 'summary.txt'), stages.map(stage => `${stage.name}: ${stage.summary ?? stage.error?.message ?? ''}`).join('\n\n'));
  const scan = scanForSecrets(itemDir, [{ name: 'ANTHROPIC_API_KEY', value: anthropicKey }, { name: 'OPENAI_API_KEY', value: openaiKey }]);
  console.log(`${id}: $${(spent / 1e6).toFixed(3)} (images $${(openaiSpent / 1e6).toFixed(3)}); secret scan ${scan.ok ? 'clean' : 'FOUND A KEY'}`);
}
console.log(JSON.stringify(budget.scopeSummary(values.scope), null, 2));
