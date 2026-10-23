// Blind pairwise judge with a Claude model, for comparisons inside one owner-approved scoped allowance (e.g. model-routing
// qualification). Same rubric (judge-rubric.md, verbatim), the same pairing, position swap (every pair judged A-left and
// B-left), screenshot views and encoder as judge.mjs; only the provider differs, so its verdicts are reported separately and
// never pooled with judge.mjs rounds. --before adds the unchanged website as two extra views ("Before") for edit comparisons,
// with a fixed addendum to the instructions.
//
//   node scripts/eval/claude-judge.mjs --a <measureSetA> --b <measureSetB> --round <name> [--before <measureSet>]   dry run (requests + bound)
//   EVAL_SPEND_APPROVED=yes EVAL_ENV_LOCAL=<abs>/.env.local node scripts/eval/claude-judge.mjs ... --live --scope <scope> --approval "<who/when>"
//
// Spend: before every call the exact request is counted (the free token-counting endpoint) and its worst case
// (input at the highest input rate + max_tokens at the output rate, geo uplift included: prices.ts textCallBoundMicrousd)
// is reserved in the scoped allowance; the SDK never retries (maxRetries 0); a response settles at its billed usage, a
// rejection before processing at zero, anything else at the full bound.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { OUT, ensureDir, writeJson, rel } from './lib/paths.mjs';
import * as budget from './lib/budget.mjs';
import { encodeShot, sha256 } from './lib/judge-sheet.mjs';
import { HEIGHTS } from './lib/thresholds.mjs';
import { CRITERIA, VERDICT_SCHEMA, loadRubric, loadSet, pairSets, planCalls } from './judge.mjs';

const { values } = parseArgs({ strict: true, options: { a: { type: 'string' }, b: { type: 'string' }, before: { type: 'string' }, round: { type: 'string' }, live: { type: 'boolean' }, scope: { type: 'string' }, approval: { type: 'string' }, model: { type: 'string', default: 'claude-opus-5-5' }, concurrency: { type: 'string', default: '3' } } });
if (!values.a || !values.b || !/^[a-z0-9][a-z0-9-]{2,80}$/.test(values.round ?? '')) throw new Error('--a, --b and a plain --round name are required');
const require = createRequire(import.meta.url);
const { loadApp } = require('./lib/app-modules.cjs');
const prices = loadApp('src/lib/ai/prices.ts');
const MODEL = values.model, MAX_TOKENS = 6000;
prices.textPrice(MODEL);

const rubric = loadRubric();
const BEFORE_ADDENDUM = `Edit comparisons

When you are also shown the website labelled Before, both deliverables started from that same website and the brief ends with one change the client asked for. Judge first whether the requested change was made, completely and well, and that nothing else on the page was broken, lost or degraded; then apply the criteria above to the resulting website. Making changes the client did not ask for is a weakness, not a strength.`;
const instructions = values.before ? `${rubric.instructions}\n\n${BEFORE_ADDENDUM}` : rubric.instructions;
const VIEWS = [
  { id: 'desktop-first', shot: '1440-first.png', cssWidth: 1440, cropCss: HEIGHTS[1440], label: 'desktop, first screen (1440 px wide)' },
  { id: 'desktop-full', shot: '1440-full.png', cssWidth: 1440, cropCss: 4000, label: 'desktop, full page (1440 px wide)' },
  { id: 'mobile-full', shot: '390-full.png', cssWidth: 390, cropCss: 4000, columns: true, label: 'mobile, full page (390 px wide)' },
];
const BEFORE_VIEWS = VIEWS.slice(1);
const setA = loadSet(values.a, 'A'), setB = loadSet(values.b, 'B');
const { pairs, skipped, warnings } = pairSets(setA, setB);
const beforeSet = values.before ? loadSet(values.before, 'before') : null;
const { calls } = planCalls(pairs, { sanity: false });
const roundDir = ensureDir(path.join(OUT, 'review', `claude-judge-${values.round}`));
console.log(`${pairs.length} pair(s), ${calls.length} call(s)${skipped.length ? `; skipped ${skipped.map(item => `${item.pair} (${item.reason})`).join(', ')}` : ''}${warnings.length ? `; warnings: ${warnings.join('; ')}` : ''}`);

async function image(file, view) {
  const encoded = await encodeShot(file, { cssWidth: view.cssWidth, cropCss: view.cropCss, maxEdge: 1536, quality: 80, columns: Boolean(view.columns) });
  const notes = [encoded.cropped && view.cropCss === 4000 ? 'cropped to the first 4000 px' : null, encoded.columns > 1 ? `split into ${encoded.columns} columns side by side, read left to right` : null].filter(Boolean);
  return { block: { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: encoded.buffer.toString('base64') } }, label: notes.length ? `${view.label.slice(0, -1)}; ${notes.join('; ')})` : view.label, sha256: encoded.sha256 };
}
async function compose(call) {
  const sides = { Left: call.left === 'A' ? call.a : call.b, Right: call.left === 'A' ? call.b : call.a };
  const before = beforeSet?.items.find(item => item.briefId === call.briefId);
  if (beforeSet && !before) throw new Error(`no Before item for ${call.briefId}`);
  const content = [{ type: 'text', text: `The brief\n\n${call.brief}\n\n${before ? 'First you see the website before the change (desktop full page, then mobile full page). Then ' : ''}Two websites were delivered for this brief, labelled Left and Right. For each side you see the desktop first screen at 1440 px wide, the desktop full page at 1440 px wide and the mobile full page at 390 px wide, in that order. Full-page screenshots longer than 4000 px are cropped to their first 4000 px.` }];
  const images = [];
  if (before) for (const view of BEFORE_VIEWS) { const shot = await image(before.shots[view.shot], view); content.push({ type: 'text', text: `Before — ${shot.label}` }, shot.block); images.push({ side: 'Before', view: view.id, sha256: shot.sha256 }); }
  for (const side of ['Left', 'Right']) for (const view of VIEWS) {
    const shot = await image(sides[side].shots[view.shot], view);
    content.push({ type: 'text', text: `${side} — ${shot.label}` }, shot.block); images.push({ side, view: view.id, item: sides[side].itemId, sha256: shot.sha256 });
  }
  content.push({ type: 'text', text: 'Judge the two deliverables against the rubric and answer with the JSON object only.' });
  for (const part of content) if (part.type === 'text' && /\b(?:claude|anthropic|opus|sonnet|haiku|makeborne)\b/i.test(part.text)) throw new Error(`Blinding violated in ${call.callId}`);
  const body = { model: MODEL, max_tokens: MAX_TOKENS, system: instructions, messages: [{ role: 'user', content }], output_config: { effort: 'medium', format: { type: 'json_schema', schema: VERDICT_SCHEMA } } };
  return { body, images, requestSha256: sha256(JSON.stringify({ ...body, messages: [{ role: 'user', content: content.map(part => part.type === 'image' ? { type: 'image', sha256: sha256(part.source.data) } : part) }] })) };
}

const rows = [];
const verdictFile = path.join(roundDir, 'verdicts.jsonl');
let client = null;
if (values.live) {
  if (process.env.EVAL_SPEND_APPROVED !== 'yes' || !values.approval?.trim() || !values.scope) throw new Error('Live judging needs EVAL_SPEND_APPROVED=yes, --approval and --scope');
  const envFile = process.env.EVAL_ENV_LOCAL?.trim();
  if (!envFile || !path.isAbsolute(envFile) || path.basename(envFile) !== '.env.local') throw new Error('EVAL_ENV_LOCAL must be an absolute path to a .env.local file');
  const apiKey = /^ANTHROPIC_API_KEY\s*=\s*(.*)$/m.exec(fs.readFileSync(envFile, 'utf8'))?.[1]?.trim().replace(/^["']|["']$/g, '');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing');
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  client = new Anthropic({ apiKey, maxRetries: 0, timeout: 300_000 });
  writeJson(path.join(roundDir, 'live-started.json'), { round: values.round, model: MODEL, scope: values.scope, approval: values.approval, at: new Date().toISOString(), calls: calls.length });
}
const REJECTED = new Set([400, 401, 403, 404, 413, 429, 529]);
async function judge(call) {
  const { body, images, requestSha256 } = await compose(call);
  const row = { round: values.round, callId: call.callId, pair: call.pair, order: call.order, left: call.left, model: MODEL, requestSha256, images: images.length, mode: values.live ? 'live' : 'dry' };
  if (!client) { const tokens = Math.ceil(JSON.stringify(body).length / 4); return { ...row, estimateUsd: prices.textCallBoundMicrousd(MODEL, Math.min(tokens, 40_000), MAX_TOKENS) / 1e6 }; }
  const { input_tokens: input } = await client.messages.countTokens({ model: MODEL, system: body.system, messages: body.messages });
  const bound = prices.textCallBoundMicrousd(MODEL, Math.ceil(input * 1.02) + 64, MAX_TOKENS);
  const reservation = await budget.reserveScoped({ scope: values.scope, kind: 'routing-judge', ref: `${values.round}/${call.callId}`, boundUsd: bound / 1e6, provider: 'anthropic', unique: true, note: `${values.approval}. Blind pairwise ${MODEL}` });
  let message;
  try { message = await client.messages.create(body); }
  catch (error) {
    const status = typeof error?.status === 'number' ? error.status : null;
    await budget.settle(reservation, status !== null && REJECTED.has(status) ? { actualUsd: 0, detail: { status } } : { unknown: true, detail: { status, error: String(error?.message).slice(0, 200) } });
    return { ...row, boundUsd: bound / 1e6, error: { status, message: String(error?.message).slice(0, 300) } };
  }
  const costUsd = prices.textUsageMicrousd(message.model || MODEL, message.usage) / 1e6;
  await budget.settle(reservation, { actualUsd: costUsd, detail: { usage: message.usage } });
  const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('');
  let verdict = null;
  try { verdict = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { verdict = null; }
  const valid = verdict && ['Left', 'Right', 'Tie'].includes(verdict.overall) && CRITERIA.every(criterion => ['Left', 'Right', 'Tie'].includes(verdict.criteria?.[criterion.id]?.preference));
  const toSet = side => side === 'Tie' ? 'Tie' : (side === 'Left') === (call.left === 'A') ? 'A' : 'B';
  return { ...row, boundUsd: bound / 1e6, costUsd, usage: message.usage, stop: message.stop_reason, valid: Boolean(valid),
    ...(valid ? { overall: verdict.overall, winner: toSet(verdict.overall), confidence: verdict.confidence, criteria: Object.fromEntries(CRITERIA.map(criterion => [criterion.id, toSet(verdict.criteria[criterion.id].preference)])), rationale: String(verdict.rationale ?? '').slice(0, 800) } : { raw: text.slice(0, 1500) }) };
}

const queue = [...calls];
const workers = Array.from({ length: Math.max(1, Math.min(4, Number(values.concurrency) || 1)) }, async () => {
  for (let call = queue.shift(); call; call = queue.shift()) {
    const row = await judge(call);
    rows.push(row);
    fs.appendFileSync(verdictFile, `${JSON.stringify(row)}\n`);
    console.log(`${call.callId}: ${row.winner ?? row.error?.status ?? (row.valid === false ? 'INVALID' : 'dry')}${row.costUsd !== undefined ? ` $${row.costUsd.toFixed(3)}` : row.estimateUsd !== undefined ? ` (bound ~$${row.estimateUsd.toFixed(3)})` : ''}${row.rationale ? ` — ${row.rationale.slice(0, 160)}` : ''}`);
  }
});
await Promise.all(workers);

// Per pair: a side wins only when both presentation orders agree; otherwise the pair counts as a tie (position-inconsistent).
const byPair = Object.fromEntries(pairs.map(pair => {
  const both = rows.filter(row => row.pair === pair.pair && row.valid);
  const winners = both.map(row => row.winner);
  const result = both.length < 2 ? 'incomplete' : winners[0] === winners[1] ? winners[0] : 'Tie';
  const criteria = Object.fromEntries(CRITERIA.map(criterion => { const votes = both.map(row => row.criteria[criterion.id]); return [criterion.id, both.length < 2 ? 'incomplete' : votes[0] === votes[1] ? votes[0] : 'Tie']; }));
  return [pair.pair, { result, orders: winners, criteria }];
}));
const tally = Object.values(byPair).reduce((out, item) => ({ ...out, [item.result]: (out[item.result] ?? 0) + 1 }), {});
const summary = { round: values.round, model: MODEL, mode: values.live ? 'live' : 'dry', rubric: { version: rubric.version, sha256: rubric.sha256, addendum: values.before ? sha256(BEFORE_ADDENDUM) : null },
  sets: { A: rel(setA.dir), B: rel(setB.dir), before: beforeSet ? rel(beforeSet.dir) : null }, pairs: pairs.length, calls: rows.length, tally, byPair,
  spentUsd: rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0), invalid: rows.filter(row => row.valid === false).length, errors: rows.filter(row => row.error).length };
writeJson(path.join(roundDir, 'summary.json'), summary);
console.log(JSON.stringify({ tally, spentUsd: summary.spentUsd, invalid: summary.invalid, errors: summary.errors, round: rel(roundDir) }));
