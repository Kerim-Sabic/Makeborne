// Blind pairwise judge for decks and books with a Claude model, inside one owner-approved scoped allowance (companion of
// claude-judge.mjs, same spend rules: count, reserve the worst case, no retries, settle at billed usage).
//
//   node scripts/eval/claude-judge-docs.mjs --a <measureSetA> --b <measureSetB> --round <name>            dry run
//   EVAL_SPEND_APPROVED=yes EVAL_ENV_LOCAL=<abs>/.env.local node scripts/eval/claude-judge-docs.mjs ... --live --scope <scope> --approval "<who/when>"
//
// Each side shows every rendered page the measure set kept (all slides of a deck; cover, opener, a body page and the last page
// of a book) and, for books, the full chapter text from the run's document.json, because a book is judged on its writing.
// Pairs by briefId, each judged twice with the sides swapped; a side wins a pair only when both orders agree.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { OUT, REPO, ensureDir, writeJson, rel } from './lib/paths.mjs';
import * as budget from './lib/budget.mjs';
import { encodeShot, sha256 } from './lib/judge-sheet.mjs';

const { values } = parseArgs({ strict: true, options: { a: { type: 'string' }, b: { type: 'string' }, round: { type: 'string' }, live: { type: 'boolean' }, scope: { type: 'string' }, approval: { type: 'string' }, model: { type: 'string', default: 'claude-opus-5-5' } } });
if (!values.a || !values.b || !/^[a-z0-9][a-z0-9-]{2,80}$/.test(values.round ?? '')) throw new Error('--a, --b and a plain --round name are required');
const require = createRequire(import.meta.url);
const prices = require('./lib/app-modules.cjs').loadApp('src/lib/ai/prices.ts');
const MODEL = values.model, MAX_TOKENS = 6000;
prices.textPrice(MODEL);

export const DOC_CRITERIA = Object.freeze([
  { id: 'brief_fit', label: 'Fit to the brief: everything it asked for is present, specific to it, nothing invented' },
  { id: 'content', label: 'Quality and usefulness of the content: substance, accuracy, clarity, no filler' },
  { id: 'structure', label: 'Structure and flow: order, pacing, headings, one idea per slide or section' },
  { id: 'visual_craft', label: 'Visual craft of the pages: typography, hierarchy, spacing, consistency' },
  { id: 'approvability', label: 'Client-approvability: would the client accept it as delivered' },
]);
const INSTRUCTIONS = `You are the editorial and design director of a studio that writes and designs presentations and books for paying clients. Two teams were given the same written brief. You see the brief and, for each deliverable (labelled Left and Right), its rendered pages and, for books, the full text. Decide which deliverable is better, criterion by criterion and overall.

Criteria (for each, prefer Left, Right, or Tie): ${DOC_CRITERIA.map(criterion => `${criterion.label} (${criterion.id})`).join('; ')}.

Rules: judge the deliverable as the client would receive it; weigh fit to the brief, content and approvability most. Do not reward length for its own sake: more pages or words are better only when they add real substance the brief asked for; missing required material is a serious weakness. Penalise invented facts, testimonials or results, placeholders, broken or empty pages and inconsistent styling. Left and Right are arbitrary labels; do not guess who made either side. Use Tie only when you genuinely cannot prefer one.

Answer with the JSON object only: for each criterion an observation of one or two sentences and a preference, then the overall verdict, your confidence (low, medium or high) and a rationale of at most 80 words.`;
const verdictEnum = { type: 'string', enum: ['Left', 'Right', 'Tie'] };
const SCHEMA = { type: 'object', additionalProperties: false, required: ['criteria', 'overall', 'confidence', 'rationale'], properties: {
  criteria: { type: 'object', additionalProperties: false, required: DOC_CRITERIA.map(criterion => criterion.id), properties: Object.fromEntries(DOC_CRITERIA.map(criterion => [criterion.id, { type: 'object', additionalProperties: false, required: ['observation', 'preference'], properties: { observation: { type: 'string' }, preference: verdictEnum } }])) },
  overall: verdictEnum, confidence: { type: 'string', enum: ['low', 'medium', 'high'] }, rationale: { type: 'string' } } };

function loadSet(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => {
    const itemDir = path.join(dir, entry.name), item = JSON.parse(fs.readFileSync(path.join(itemDir, 'item.json'), 'utf8'));
    const shots = fs.existsSync(path.join(itemDir, 'shots')) ? fs.readdirSync(path.join(itemDir, 'shots')).filter(name => name.endsWith('.png')).sort().map(name => path.join(itemDir, 'shots', name)) : [];
    return { id: entry.name, briefId: item.briefId, kind: item.kind, brief: item.brief, shots, item };
  });
}
/** The run's document text for books (the measure set's item.json names its run through the set). */
function bookText(setDir, id) {
  const summary = JSON.parse(fs.readFileSync(path.join(setDir, 'summary.json'), 'utf8'));
  const runDir = path.resolve(REPO, summary.set?.dir ?? '');
  const doc = JSON.parse(fs.readFileSync(path.join(runDir, id, 'document.json'), 'utf8'));
  return doc.kind === 'book' ? doc.chapters.map(chapter => `## ${chapter.title}\n\n${chapter.text}`).join('\n\n').slice(0, 60_000) : null;
}
const A = loadSet(path.resolve(values.a)), B = loadSet(path.resolve(values.b));
const pairs = A.filter(a => B.some(b => b.briefId === a.briefId)).map(a => ({ pair: a.briefId, brief: a.brief, kind: a.kind, a: { ...a, text: bookText(path.resolve(values.a), a.id) }, b: (() => { const b = B.find(item => item.briefId === a.briefId); return { ...b, text: bookText(path.resolve(values.b), b.id) }; })() }));
const calls = pairs.flatMap(pair => ['ab', 'ba'].map(order => ({ ...pair, order, left: order === 'ab' ? 'A' : 'B', callId: `${pair.pair}-${order}` })));
const roundDir = ensureDir(path.join(OUT, 'review', `claude-judge-${values.round}`));
console.log(`${pairs.length} pair(s), ${calls.length} call(s)`);

async function compose(call) {
  const sides = { Left: call.left === 'A' ? call.a : call.b, Right: call.left === 'A' ? call.b : call.a };
  const content = [{ type: 'text', text: `The brief\n\n${call.brief}\n\nTwo ${call.kind === 'book' ? 'books' : 'presentations'} were delivered for this brief, labelled Left and Right. For each side you see its rendered pages in order${call.kind === 'book' ? ' (cover, a chapter opener, a body page and the last page) and then its full text' : ' (every slide)'}.` }];
  for (const side of ['Left', 'Right']) {
    for (const file of sides[side].shots) {
      const encoded = await encodeShot(file, { maxEdge: 1200, quality: 80 });
      content.push({ type: 'text', text: `${side} — ${path.basename(file, '.png').replace(/-/g, ' ')}` }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: encoded.buffer.toString('base64') } });
    }
    if (sides[side].text) content.push({ type: 'text', text: `${side} — full text\n\n${sides[side].text}` });
  }
  content.push({ type: 'text', text: 'Judge the two deliverables and answer with the JSON object only.' });
  return { model: MODEL, max_tokens: MAX_TOKENS, system: INSTRUCTIONS, messages: [{ role: 'user', content }], output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } } };
}

let client = null;
if (values.live) {
  if (process.env.EVAL_SPEND_APPROVED !== 'yes' || !values.approval?.trim() || !values.scope) throw new Error('Live judging needs EVAL_SPEND_APPROVED=yes, --approval and --scope');
  const envFile = process.env.EVAL_ENV_LOCAL?.trim();
  if (!envFile || !path.isAbsolute(envFile) || path.basename(envFile) !== '.env.local') throw new Error('EVAL_ENV_LOCAL must be an absolute path to a .env.local file');
  const apiKey = /^ANTHROPIC_API_KEY\s*=\s*(.*)$/m.exec(fs.readFileSync(envFile, 'utf8'))?.[1]?.trim().replace(/^["']|["']$/g, '');
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  client = new Anthropic({ apiKey, maxRetries: 0, timeout: 300_000 });
  writeJson(path.join(roundDir, 'live-started.json'), { round: values.round, model: MODEL, scope: values.scope, approval: values.approval, at: new Date().toISOString(), calls: calls.length });
}
const REJECTED = new Set([400, 401, 403, 404, 413, 429, 529]);
const rows = [];
for (const call of calls) {
  const body = await compose(call);
  const row = { round: values.round, callId: call.callId, pair: call.pair, order: call.order, left: call.left, model: MODEL, requestSha256: sha256(JSON.stringify(body.system) + call.callId), mode: values.live ? 'live' : 'dry' };
  if (!client) { rows.push(row); console.log(`${call.callId}: dry`); continue; }
  const { input_tokens: input } = await client.messages.countTokens({ model: MODEL, system: body.system, messages: body.messages });
  const bound = prices.textCallBoundMicrousd(MODEL, Math.ceil(input * 1.02) + 64, MAX_TOKENS);
  const reservation = await budget.reserveScoped({ scope: values.scope, kind: 'routing-judge', ref: `${values.round}/${call.callId}`, boundUsd: bound / 1e6, provider: 'anthropic', unique: true, note: `${values.approval}. Blind pairwise documents ${MODEL}` });
  let message;
  try { message = await client.messages.create(body); }
  catch (error) {
    const status = typeof error?.status === 'number' ? error.status : null;
    await budget.settle(reservation, status !== null && REJECTED.has(status) ? { actualUsd: 0, detail: { status } } : { unknown: true, detail: { status } });
    rows.push({ ...row, error: { status, message: String(error?.message).slice(0, 300) } }); console.log(`${call.callId}: ERROR ${status}`); continue;
  }
  const costUsd = prices.textUsageMicrousd(message.model || MODEL, message.usage) / 1e6;
  await budget.settle(reservation, { actualUsd: costUsd, detail: { usage: message.usage } });
  const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('');
  let verdict = null; try { verdict = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { verdict = null; }
  const valid = verdict && ['Left', 'Right', 'Tie'].includes(verdict.overall);
  const toSet = side => side === 'Tie' ? 'Tie' : (side === 'Left') === (call.left === 'A') ? 'A' : 'B';
  const out = { ...row, inputTokens: input, boundUsd: bound / 1e6, costUsd, valid: Boolean(valid), ...(valid ? { winner: toSet(verdict.overall), confidence: verdict.confidence, criteria: Object.fromEntries(DOC_CRITERIA.map(criterion => [criterion.id, toSet(verdict.criteria?.[criterion.id]?.preference ?? 'Tie')])), rationale: String(verdict.rationale ?? '').slice(0, 800) } : { raw: text.slice(0, 1500) }) };
  rows.push(out); fs.appendFileSync(path.join(roundDir, 'verdicts.jsonl'), `${JSON.stringify(out)}\n`);
  console.log(`${call.callId}: ${out.winner ?? 'INVALID'} $${costUsd.toFixed(3)} — ${out.rationale?.slice(0, 200) ?? ''}`);
}
const byPair = Object.fromEntries(pairs.map(pair => { const both = rows.filter(row => row.pair === pair.pair && row.valid); const winners = both.map(row => row.winner); return [pair.pair, { result: both.length < 2 ? 'incomplete' : winners[0] === winners[1] ? winners[0] : 'Tie', orders: winners }]; }));
const summary = { round: values.round, model: MODEL, mode: values.live ? 'live' : 'dry', sets: { A: rel(path.resolve(values.a)), B: rel(path.resolve(values.b)) }, instructionsSha256: sha256(INSTRUCTIONS), byPair, spentUsd: rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0) };
writeJson(path.join(roundDir, 'summary.json'), summary);
console.log(JSON.stringify({ byPair, spentUsd: summary.spentUsd }));
