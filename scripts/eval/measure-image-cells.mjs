#!/usr/bin/env node
// Measure the output tokens of GPT Image 2.5 cells (quality x size) that documents and websites want, so prices.ts
// can bound them (MEASURED_IMAGE_OUTPUT_TOKENS; cells without a measurement stay refused).
//
//   node scripts/eval/measure-image-cells.mjs                      the plan and its cost estimate (no calls, default)
//   EVAL_SPEND_APPROVED=yes node scripts/eval/measure-image-cells.mjs --live --scope <scope> --approval "<owner's words>"
//     [--only 2560x1440,1536x2304] [--env <abs path>/.env.local]
//
// Live: the scope must already be recorded in outputs/eval/budget/ledger.json (budget.mjs --record-scope, with the
// owner's approval); every call reserves its worst case in that scope before it starts (re-reading the ledger under
// its lock) and settles at the cost the response's usage reports (unknown usage keeps the bound). One call per cell,
// sequential, no retries. Results: outputs/eval/image-cells/<scope>/results.jsonl plus each image (webp). The key is
// read into this process only, never printed or written; the run folder is scanned for it afterwards.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const require = createRequire(import.meta.url);
const { loadApp } = require('./lib/app-modules.cjs');
const cells = loadApp('src/lib/ai/image-cells.ts');
const prices = loadApp('src/lib/ai/prices.ts');

const { values } = parseArgs({ strict: true, options: { live: { type: 'boolean' }, scope: { type: 'string' }, approval: { type: 'string' }, only: { type: 'string' }, env: { type: 'string' } } });
const only = (values.only ?? '').split(',').map(item => item.trim()).filter(Boolean);
const plan = cells.MEASUREMENT_PLAN.filter(cell => !only.length || only.includes(cell.size));
for (const cell of plan) {
  const issue = cells.sizeIssue(cell.size);
  if (issue) throw new Error(`Plan cell ${cell.model} ${cell.quality} ${cell.size} is not requestable: ${issue}`);
}
const estimate = cells.measurementEstimate(plan);
// The prompt every measurement call sends: a reference-pattern slide (text and photograph), so the counts reflect real use.
const PROMPT = 'Title slide of a premium presentation for a small artisan bakery called "Alba Bakehouse": warm cream #F4EDE3 background, deep brown-black text #2A1D14, terracotta accent #B5562F, an elegant high-contrast serif for headlines. Left 50%: small wordmark "Alba Bakehouse" at the top; a huge serif headline on two lines "A second" / "oven." with "oven." in terracotta italic; below it a small line "Plan for 2027"; bottom-left tiny page number "01". Right 50%: a full-bleed warm photograph of a glowing wood-fired brick bread oven with a baker sliding out round sourdough loaves on a long wooden peel. A flat, straight-on presentation slide filling the entire image (no laptop, no screen, no room, no perspective). Perfect alignment, generous margins, crisp vector-sharp typography. All text spelled exactly as given, perfectly legible, no extra words, no garbled letters.';
const promptBytes = Buffer.byteLength(PROMPT, 'utf8');

console.log(`Image cell measurement plan: ${estimate.calls} calls (one per cell), sequential.`);
for (const row of estimate.rows) console.log(`  ${row.model.padEnd(24)} ${row.quality.padEnd(5)} ${row.size.padEnd(9)} ${row.reference ? `reference ${row.reference} tokens` : 'unmeasured'}  expected <= $${row.expectedUsd.toFixed(4)}  reserved $${row.boundUsd.toFixed(4)}  (${row.uses})`);
console.log(`Expected at most $${estimate.expectedUsd.toFixed(2)} (reference counts, else ceilings of ${cells.UNMEASURED_CEILING_TOKENS.high} high / ${cells.UNMEASURED_CEILING_TOKENS.xhigh} xhigh tokens); reservations total $${estimate.boundUsd.toFixed(2)} (ceilings x ${prices.MEASURED_HEADROOM}). Prompt ${promptBytes} bytes.`);
if (!values.live) { console.log('Plan only: no calls made. Pass --live with an approved --scope to measure.'); process.exit(0); }

if (process.env.EVAL_SPEND_APPROVED !== 'yes' || !values.approval?.trim()) throw new Error('Refusing: EVAL_SPEND_APPROVED=yes and --approval are required');
if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(values.scope ?? '')) throw new Error('--scope must name the recorded scope');
const budget = await import(pathToFileURL(path.join(HERE, 'lib', 'budget.mjs')).href);
const scoped = budget.scopeSummary(values.scope);
if (!scoped) throw new Error(`Scope ${values.scope} is not recorded in the ledger; record the owner's approval first (budget.mjs --record-scope).`);
const openaiLeft = (scoped.allowance.providerCapsUsd?.openai ?? 0) - scoped.byProvider.openai;
if (openaiLeft + 1e-9 < estimate.boundUsd) throw new Error(`Scope ${values.scope} has $${openaiLeft.toFixed(2)} of OpenAI left; the plan reserves up to $${estimate.boundUsd.toFixed(2)}. Narrow it with --only or record a larger approval.`);

const envFile = values.env?.trim() || path.join(REPO, '.env.local');
if (!path.isAbsolute(envFile) || path.basename(envFile) !== '.env.local') throw new Error('--env must be an absolute path to a .env.local file');
const key = /^OPENAI_API_KEY\s*=\s*(.*)$/m.exec(fs.readFileSync(envFile, 'utf8'))?.[1]?.trim().replace(/^["']|["']$/g, '');
if (!key) throw new Error('No OPENAI_API_KEY in the .env.local');

const outDir = path.join(REPO, 'outputs', 'eval', 'image-cells', values.scope);
fs.mkdirSync(outDir, { recursive: true });
const results = path.join(outDir, 'results.jsonl');
let spent = 0;
for (const cell of plan) {
  const id = `${cell.model.replace('gpt-image-2.5-', '')}-${cell.quality}-${cell.size}`;
  const boundTokens = Math.ceil(cells.UNMEASURED_CEILING_TOKENS[cell.quality] * prices.MEASURED_HEADROOM);
  const boundUsd = Math.ceil(((promptBytes + 64) * 5 + boundTokens * 30) * prices.GEO_MULTIPLIER) / 1e6;
  const reservation = await budget.reserve({ kind: 'openai-image-cells', ref: `${values.scope}/${id}`, boundUsd, provider: 'openai', unique: true, scope: values.scope,
    note: `${values.approval.trim()} | measure ${cell.model} ${cell.quality} ${cell.size}` });
  const body = { model: cell.model, prompt: PROMPT, n: 1, size: cell.size, quality: cell.quality, output_format: 'webp', output_compression: 90 };
  fs.writeFileSync(path.join(outDir, `${id}.attempted.json`), JSON.stringify({ id, at: new Date().toISOString(), reservation, body: { ...body, prompt: `${promptBytes} bytes` } }));
  const started = Date.now();
  let usage = null, error = null, status = null;
  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(240_000) });
    status = response.status;
    const json = await response.json().catch(() => null);
    if (!response.ok) error = `${response.status} ${String(json?.error?.code ?? json?.error?.type ?? '').slice(0, 60)}`;
    usage = json?.usage ?? null;
    const encoded = json?.data?.[0]?.b64_json;
    if (encoded) fs.writeFileSync(path.join(outDir, `${id}.webp`), Buffer.from(encoded, 'base64'));
  } catch (caught) { error = String(caught?.name ?? 'error'); }
  const text = usage?.input_tokens_details?.text_tokens ?? usage?.input_tokens ?? 0;
  const costUsd = usage && Number.isSafeInteger(usage.output_tokens) ? (text * 5 + (usage.input_tokens_details?.image_tokens ?? 0) * 8 + usage.output_tokens * 30) / 1e6 : null;
  // A 4xx before processing (bad size or quality) is not billed; anything else without usage keeps the bound.
  const notBilled = status !== null && status >= 400 && status < 500 && !usage;
  await budget.settle(reservation, costUsd !== null ? { actualUsd: costUsd, detail: { outputTokens: usage.output_tokens } } : notBilled ? { actualUsd: 0, detail: { status } } : { unknown: true, detail: { status, error } });
  spent += costUsd ?? (notBilled ? 0 : boundUsd);
  const row = { id, model: cell.model, quality: cell.quality, size: cell.size, uses: cell.uses, outputTokens: usage?.output_tokens ?? null, inputTokens: usage?.input_tokens ?? null, costUsd, boundUsd, ms: Date.now() - started, status, error };
  fs.appendFileSync(results, `${JSON.stringify(row)}\n`);
  console.log(`${id}: ${row.outputTokens ?? '-'} output tokens, $${(costUsd ?? 0).toFixed(4)}${error ? `, ${error}` : ''}`);
}
const { scanForSecrets } = await import(pathToFileURL(path.join(HERE, 'run.mjs')).href);
const scan = scanForSecrets(outDir, [{ name: 'OPENAI_API_KEY', value: key }]);
console.log(`Done: about $${spent.toFixed(4)} committed. Secret scan: ${scan.ok ? 'clean' : 'FOUND THE KEY (do not share the folder)'}. Results: ${path.relative(REPO, results)}`);
