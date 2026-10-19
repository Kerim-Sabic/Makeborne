#!/usr/bin/env node
// Blind pairwise judge: QUALITY_BAR J1 (vs competitors), J2 (round on round)
// and J4 (judge sanity), plus the human designer sheet for J3.
//
//   node scripts/eval/judge.mjs --a <setA> --b <setB> [--pairs pairs.json] [--sanity] [--round <id>]
//       dry run (default): writes every request (minus image bytes) and a cost estimate; no network
//   node scripts/eval/judge.mjs --a <setA> --b <setB> --sanity --live --approval "<who, when>"
//       paid OpenAI calls, each reserved in lib/budget.mjs (kind "judge") inside the $25 cap
//   node scripts/eval/judge.mjs --sheet --a <setA> --b <setB> [--n 10] [--seed 20261018]
//   node scripts/eval/judge.mjs --score-sheet <answers.json ...> --key <sheet-key.json>
//   node scripts/eval/judge.mjs --selftest
//
// The judge must not share a model family with the builder (Anthropic), so it
// is an OpenAI model. Its id and prices are configuration, never guessed:
// EVAL_JUDGE_MODEL, EVAL_JUDGE_USD_PER_MTOK_IN, EVAL_JUDGE_USD_PER_MTOK_OUT and
// OPENAI_API_KEY; a live run fails closed without any of them.
//
// Pairing: items are paired by briefId, then by relatedBriefId (item.json,
// then metrics.json), or by an explicit --pairs file. When nothing can be
// judged the command lists every item with its ids and exits 2.
//
// Spend: one reservation covers exactly one HTTP attempt (the client never
// retries: maxRetries 0). How a failed call is settled is documented at
// failedCallSettlement() below.
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, appendFileSync, existsSync, rmSync, copyFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EVAL_DIR, OUT, JUDGE as JUDGE_DIR, BRIEFS_DIR, ensureDir, readJson, writeJson, rel, stamp } from './lib/paths.mjs';
import * as ledger from './lib/budget.mjs';
import { CapReached } from './lib/budget.mjs';
import { wilson, bootstrapMean, rng } from './lib/stats.mjs';
import { HEIGHTS, JUDGE as JUDGE_BAR, QUALITY_BAR_VERSION } from './lib/thresholds.mjs';
import { encodeShot, sha256, buildSheet, scoreSheet } from './lib/judge-sheet.mjs';

export const RUBRIC_FILE = path.join(EVAL_DIR, 'judge-rubric.md');
const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const FULL_CROP_CSS = 4000;
const MAX_EDGE = 1536;
const JPEG_QUALITY = 80;
const SAFETY = 1.5;
const SIDES = ['Left', 'Right'];

export const CRITERIA = Object.freeze([
  { id: 'brief_fit', label: 'Fit to the brief and specificity of content' },
  { id: 'visual_craft', label: 'Visual craft: typography, hierarchy, spacing, alignment' },
  { id: 'distinctiveness', label: 'Distinctiveness' },
  { id: 'primary_action', label: 'Clarity of the primary action and usability' },
  { id: 'mobile', label: 'Mobile composition' },
  { id: 'approvability', label: 'Client-approvability' },
]);

// The three views per side (QUALITY_BAR J1: 1440 first screen + full page, 390 full page).
const VIEWS = Object.freeze([
  { id: 'desktop-first', shot: '1440-first.png', cssWidth: 1440, cropCss: HEIGHTS[1440], label: 'desktop, first screen (1440 px wide)' },
  { id: 'desktop-full', shot: '1440-full.png', cssWidth: 1440, cropCss: FULL_CROP_CSS, announceCrop: true, label: 'desktop, full page (1440 px wide)' },
  // Mobile pages are laid out in side-by-side columns when that keeps them legible (see encodeShot).
  { id: 'mobile-full', shot: '390-full.png', cssWidth: 390, cropCss: FULL_CROP_CSS, announceCrop: true, columns: true, label: 'mobile, full page (390 px wide)' },
]);
const CONTROL_SHOT = 'unstyled-1440-first.png';
const FIRST_ONLY = Object.freeze([VIEWS[0]]);

const verdictEnum = { type: 'string', enum: ['Left', 'Right', 'Tie'] };
export const VERDICT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['criteria', 'overall', 'confidence', 'rationale'],
  properties: {
    criteria: {
      type: 'object',
      additionalProperties: false,
      required: CRITERIA.map(criterion => criterion.id),
      properties: Object.fromEntries(CRITERIA.map(criterion => [criterion.id, {
        type: 'object',
        additionalProperties: false,
        required: ['observation', 'preference'],
        properties: {
          observation: { type: 'string', description: `One or two sentences comparing Left and Right on: ${criterion.label}.` },
          preference: verdictEnum,
        },
      }])),
    },
    overall: verdictEnum,
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    rationale: { type: 'string', description: 'At most 80 words naming the differences that decided the overall verdict.' },
  },
});

// Blinding: nothing that names a maker, a URL or a file may reach the judge.
const BLIND_PATTERNS = Object.freeze([
  /\bmakeborne\b/i, /\blovable\b/i, /\bbolt(?:\.new)?\b/i, /\bframer\b/i, /\bbase\s?44\b/i, /\bv0(?:\.dev)?\b/i,
  /\bclaude\b/i, /\banthropic\b/i, /\bopenai\b/i, /\bchatgpt\b/i, /\bgpt-?\d/i, /\breplit\b/i, /\bwebflow\b/i, /\bwix\b/i, /\bsquarespace\b/i,
  /https?:\/\/\S*/i, /\bwww\.\S*/i,
  /\b[\w-]+\.(?:png|jpe?g|webp|avif|gif|svg|html?|json|jsonl|mjs|cjs|js|tsx?|css|har|pdf|pptx)\b/i,
]);

// ---------------------------------------------------------------- rubric

/** Read the rubric; the instructions block is sent verbatim. */
export function loadRubric(file = RUBRIC_FILE) {
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const version = text.match(/^Rubric version:\s*(v\d+),\s*(\d{4}-\d{2}-\d{2})\s*$/m);
  assert(version, 'judge-rubric.md has no "Rubric version: vN, YYYY-MM-DD" line');
  const block = text.match(/<!-- judge-instructions:start -->\n([\s\S]*?)\n<!-- judge-instructions:end -->/);
  assert(block, 'judge-rubric.md has no judge-instructions block');
  const instructions = block[1].trim();
  for (const criterion of CRITERIA) assert(instructions.includes(`(${criterion.id})`), `Rubric does not define criterion ${criterion.id}`);
  assert(instructions.includes(`${FULL_CROP_CSS} px`), `Rubric must state the ${FULL_CROP_CSS} px crop the code applies`);
  assertBlind(instructions, [], 'rubric');
  return { file, version: version[1], date: version[2], instructions, sha256: sha256(instructions) };
}

function assertBlind(text, tokens, where) {
  for (const pattern of BLIND_PATTERNS) {
    const hit = text.match(pattern);
    if (hit) throw new Error(`Blinding violated in ${where}: "${hit[0]}" must not reach the judge`);
  }
  const lower = text.toLowerCase();
  for (const token of tokens) {
    if (lower.includes(token.toLowerCase())) throw new Error(`Blinding violated in ${where}: identifier "${token}" must not reach the judge`);
  }
}

/** Remove maker names, URLs and file names from free text (briefs). */
function scrub(text) {
  let count = 0;
  let clean = text;
  for (const pattern of BLIND_PATTERNS) {
    clean = clean.replace(new RegExp(pattern.source, 'gi'), () => { count++; return '[removed]'; });
  }
  return { text: clean, scrubbed: count };
}

// ---------------------------------------------------------------- briefs, sets, pairs

const BRIEF_BODY_KEYS = ['prompt', 'brief', 'text', 'request', 'description'];
const BRIEF_SKIP_KEYS = new Set(['id', 'briefId', 'kind', 'direction', 'version', 'frozenAt', 'sha256', 'shared', 'priority', 'competitors',
  'tools', 'tool', 'source', 'origin', 'path', 'file', 'effort', 'persona', 'tags', 'notes', 'title', 'name', 'business', ...BRIEF_BODY_KEYS]);
const words = key => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, char => char.toUpperCase());

/** Render a frozen brief (string or object) as plain text for the judge. */
export function briefToText(brief) {
  if (typeof brief === 'string') return brief.trim();
  if (!brief || typeof brief !== 'object') return '';
  const lines = [];
  const name = brief.business ?? brief.name ?? brief.title;
  const body = BRIEF_BODY_KEYS.map(key => brief[key]).find(value => typeof value === 'string' && value.trim());
  if (typeof name === 'string' && name.trim() && !(body ?? '').includes(name.trim())) lines.push(name.trim());
  if (body) lines.push(body.trim());
  for (const [key, value] of Object.entries(brief)) {
    if (BRIEF_SKIP_KEYS.has(key)) continue;
    if (typeof value === 'string' && value.trim()) lines.push(`${words(key)}: ${value.trim()}`);
    else if (typeof value === 'number') lines.push(`${words(key)}: ${value}`);
    else if (Array.isArray(value) && value.length && value.every(entry => typeof entry === 'string')) lines.push(`${words(key)}: ${value.join('; ')}`);
  }
  return lines.join('\n\n');
}

const tryJson = file => { try { return existsSync(file) ? readJson(file) : null; } catch { return null; } };

function briefIndexEntry(briefId) {
  const index = tryJson(path.join(BRIEFS_DIR, 'index.json'));
  const list = Array.isArray(index) ? index : index?.briefs;
  return Array.isArray(list) ? list.find(entry => entry?.id === briefId || entry?.briefId === briefId) ?? null : null;
}

/** Brief text for an item: the measure/run copies first, then the frozen brief set. */
function resolveBrief({ metrics, item, itemDir, briefId }) {
  const candidates = [
    ['metrics.json brief', metrics?.brief],
    ['metrics.json item.brief', metrics?.item?.brief],
    ['item.json brief', item?.brief],
    ['brief.json', tryJson(path.join(itemDir, 'brief.json'))],
  ];
  if (briefId) {
    candidates.push([`briefs/${briefId}.json`, tryJson(path.join(BRIEFS_DIR, `${briefId}.json`))]);
    candidates.push(['briefs/index.json', briefIndexEntry(briefId)]);
  }
  for (const [source, value] of candidates) {
    const text = briefToText(value);
    if (text) return { text, source };
  }
  return null;
}

/** Load a measure set: every sub-directory with metrics.json or shots/. */
export function loadSet(dir, label) {
  const root = path.resolve(dir);
  assert(existsSync(root), `Set not found: ${dir}`);
  const items = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const itemDir = path.join(root, entry.name);
    const metrics = tryJson(path.join(itemDir, 'metrics.json'));
    if (!metrics && !existsSync(path.join(itemDir, 'shots'))) continue;
    const item = tryJson(path.join(itemDir, 'item.json'));
    const itemId = metrics?.itemId ?? metrics?.id ?? item?.id ?? entry.name;
    const briefId = metrics?.briefId ?? metrics?.item?.briefId ?? item?.briefId ?? null;
    // Fixtures predate the frozen briefs: their golden brief was adapted from them (relatedBriefId).
    const relatedBriefId = item?.relatedBriefId ?? metrics?.relatedBriefId ?? metrics?.item?.relatedBriefId ?? null;
    const kind = item?.kind ?? metrics?.kind ?? metrics?.item?.kind ?? null;
    const shots = {};
    for (const name of [...VIEWS.map(view => view.shot), CONTROL_SHOT]) {
      const file = path.join(itemDir, 'shots', name);
      if (existsSync(file)) shots[name] = file;
    }
    items.push({ itemId: String(itemId), dirName: entry.name, dir: itemDir, kind, briefId, relatedBriefId, brief: resolveBrief({ metrics, item, itemDir, briefId }), shots });
  }
  return { dir: root, label: label ?? path.basename(root), items };
}

const safeId = value => String(value).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'pair';
const hasViews = (item, views) => views.every(view => item.shots[view.shot]);

/** Nothing (or nothing judgeable) pairs; the CLI prints the message and exits 2. */
export class PairingError extends Error {
  constructor(message) { super(message); this.name = 'PairingError'; this.code = 'EVAL_JUDGE_NO_PAIRS'; }
}

const PAIRS_HINT = 'To pair items by hand, pass --pairs <file.json> holding [{"a": "<item id in set A>", "b": "<item id in set B>"}] (or {"pairs": [...]}).';

/** Every item of both sets with the ids pairing looks at, for a refusal message. */
function describeSets(sets) {
  const width = Math.max(8, ...sets.flatMap(([, set]) => set.items.map(item => item.itemId.length)));
  const lines = [];
  for (const [side, set] of sets) {
    lines.push(`Set ${side}: ${set.label} (${rel(set.dir)}), ${set.items.length} item(s):`);
    if (!set.items.length) lines.push('  (no item folders with metrics.json or shots/)');
    for (const item of set.items) {
      const views = VIEWS.every(view => item.shots[view.shot]) ? 'shots ok' : 'no website shots';
      lines.push(`  ${item.itemId.padEnd(width)}  ${String(item.kind ?? '?').padEnd(12)}  briefId ${item.briefId ?? '-'}  relatedBriefId ${item.relatedBriefId ?? '-'}  ${views}`);
    }
  }
  return lines;
}

function noPairsMessage(setA, setB, skipped, pairsFile) {
  return [
    `No judgeable pairs between ${setA.label} and ${setB.label}.`,
    pairsFile
      ? `Pairs came from ${pairsFile}.`
      : 'Items pair when both sets hold the same briefId, or else the same relatedBriefId (item.json, then metrics.json).',
    ...(skipped.length ? ['Unmatched or not judgeable:', ...skipped.map(item => `  ${item.pair}: ${item.reason}`)] : []),
    ...describeSets([['A', setA], ['B', setB]]),
    'Only websites with 1440-first.png, 1440-full.png and 390-full.png on both sides and a brief text can be judged.',
    PAIRS_HINT,
  ].join('\n');
}

/**
 * Pair two sets, in this order:
 *   1. an explicit mapping file (pairsFile: [{a: itemIdA, b: itemIdB, briefId?}] or {pairs: [...]}) when given;
 *   2. otherwise by briefId, falling back per item to relatedBriefId (an exact briefId wins over a related one).
 * Throws PairingError for an unusable pairs file or an ambiguous set.
 * Returns {pairs:[{pair, briefId, relatedBriefId, pairedBy, brief, briefSource, scrubbed, a, b}], skipped:[{pair, reason}], warnings:[]}.
 */
export function pairSets(setA, setB, { pairsFile } = {}) {
  const warnings = [];
  const skipped = [];
  const find = (set, id) => set.items.find(item => item.itemId === id || item.dirName === id);
  let raw;
  if (pairsFile) {
    let mapping;
    try { mapping = readJson(pairsFile); } catch (error) { throw new PairingError(`Cannot read the pairs file ${pairsFile}: ${error.message}\n${PAIRS_HINT}`); }
    const list = Array.isArray(mapping) ? mapping : mapping?.pairs;
    if (!Array.isArray(list)) throw new PairingError(`The pairs file ${pairsFile} must be an array or {pairs: [...]}.\n${PAIRS_HINT}`);
    raw = list.map(entry => ({ a: find(setA, entry?.a), b: find(setB, entry?.b), key: entry?.briefId ?? null, pairedBy: 'pairs-file', want: entry }));
    const unknown = raw.filter(entry => !entry.a || !entry.b).map(entry => JSON.stringify(entry.want));
    if (unknown.length) throw new PairingError([`The pairs file ${pairsFile} names unknown items: ${unknown.join(', ')}`, ...describeSets([['A', setA], ['B', setB]]), PAIRS_HINT].join('\n'));
  } else {
    const index = set => {
      const map = new Map();
      for (const item of set.items) {
        const key = item.briefId ?? item.relatedBriefId;
        if (!key) { warnings.push(`${set.label}/${item.itemId} has no briefId or relatedBriefId; not paired`); continue; }
        const by = item.briefId ? 'briefId' : 'relatedBriefId';
        const held = map.get(key);
        if (!held) { map.set(key, { item, by }); continue; }
        if (held.by === by) throw new PairingError(`${set.label} has two items for ${by} ${key} (${held.item.itemId}, ${item.itemId}).\n${PAIRS_HINT}`);
        const keep = held.by === 'briefId' ? held : { item, by };
        const drop = keep === held ? item : held.item;
        warnings.push(`${set.label}/${drop.itemId} not paired: ${keep.item.itemId} has briefId ${key}, ${drop.itemId} only relatedBriefId`);
        map.set(key, keep);
      }
      return map;
    };
    const a = index(setA);
    const b = index(setB);
    for (const key of a.keys()) if (!b.has(key)) skipped.push({ pair: safeId(key), reason: `no item in ${setB.label} with briefId or relatedBriefId ${key}` });
    for (const key of b.keys()) if (!a.has(key)) skipped.push({ pair: safeId(key), reason: `no item in ${setA.label} with briefId or relatedBriefId ${key}` });
    raw = [...a.keys()].filter(key => b.has(key)).sort().map(key => {
      const [left, right] = [a.get(key), b.get(key)];
      return { a: left.item, b: right.item, key, pairedBy: left.by === 'briefId' && right.by === 'briefId' ? 'briefId' : 'relatedBriefId' };
    });
  }
  const pairs = [];
  const used = new Set();
  for (const { a, b, key, pairedBy } of raw) {
    const relatedBriefId = pairedBy === 'relatedBriefId' ? key : null;
    const briefId = pairedBy === 'relatedBriefId' ? a.briefId ?? b.briefId ?? null : key ?? a.briefId ?? b.briefId ?? null;
    const name = key ?? briefId ?? `${a.itemId}-vs-${b.itemId}`;
    let pair = safeId(name);
    for (let n = 2; used.has(pair); n++) pair = `${safeId(name)}-${n}`;
    used.add(pair);
    if (a.briefId && b.briefId && a.briefId !== b.briefId) warnings.push(`${pair}: briefIds differ (${a.briefId} vs ${b.briefId})`);
    if (pairedBy === 'relatedBriefId') warnings.push(`${pair}: paired by relatedBriefId (${a.itemId} vs ${b.itemId}); a related brief is adapted, not identical`);
    if (a.kind && b.kind && a.kind !== b.kind) warnings.push(`${pair}: kinds differ (${a.kind} vs ${b.kind})`);
    const brief = a.brief ?? b.brief;
    if (a.brief && b.brief && a.brief.text !== b.brief.text) warnings.push(`${pair}: brief text differs between sets; using set A's`);
    const missing = [a, b].flatMap(item => VIEWS.filter(view => !item.shots[view.shot]).map(view => `${item.itemId}/${view.shot}`));
    if (!brief) { skipped.push({ pair, reason: 'no brief text found (metrics.json, item.json, brief.json or scripts/eval/briefs)' }); continue; }
    if (missing.length) { skipped.push({ pair, reason: `missing shots: ${missing.join(', ')}` }); continue; }
    const clean = scrub(brief.text);
    pairs.push({ pair, briefId, relatedBriefId, pairedBy, brief: clean.text, briefSource: brief.source, scrubbed: clean.scrubbed, a, b });
  }
  return { pairs, skipped, warnings };
}

// ---------------------------------------------------------------- calls and requests

function shuffled(list, random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Plan the calls: each pair twice (A left, then B left). With sanity, J4
 * controls are added: ceil(share x pairs) items against themselves (must tie)
 * and as many against their unstyled control screenshot (must lose).
 */
export function planCalls(pairs, { sanity = false, sanityShare = 0.1, sanityN = null, seed = JUDGE_BAR.J1.seed } = {}) {
  const calls = [];
  const order = (base, a, b, views) => [
    { ...base, order: 'ab', left: 'A', a, b, views },
    { ...base, order: 'ba', left: 'B', a, b, views },
  ].map(call => ({ ...call, callId: `${call.group}-${call.order}` }));
  for (const pair of pairs) {
    calls.push(...order({ kind: 'main', group: pair.pair, pair: pair.pair, briefId: pair.briefId, pairedBy: pair.pairedBy ?? null, brief: pair.brief }, pair.a, pair.b, VIEWS));
  }
  const controls = [];
  if (sanity && pairs.length) {
    const count = sanityN ?? Math.max(1, Math.ceil(sanityShare * pairs.length));
    const candidates = shuffled(pairs.flatMap(pair => [{ pair, side: 'A', item: pair.a }, { pair, side: 'B', item: pair.b }]), rng(seed));
    for (const { pair, side, item } of candidates.slice(0, count)) {
      const group = `sanity-self-${pair.pair}-${side}`;
      controls.push({ kind: 'sanity-self', group, pair: pair.pair, side, itemId: item.itemId, expect: 'tie' });
      calls.push(...order({ kind: 'sanity-self', group, pair: pair.pair, briefId: pair.briefId, brief: pair.brief }, item, item, VIEWS));
    }
    const withControl = candidates.filter(({ item }) => item.shots[CONTROL_SHOT] && hasViews(item, FIRST_ONLY));
    for (const { pair, side, item } of withControl.slice(0, count)) {
      const group = `sanity-broken-${pair.pair}-${side}`;
      const control = { ...item, itemId: `${item.itemId}#unstyled`, shots: { [VIEWS[0].shot]: item.shots[CONTROL_SHOT] } };
      controls.push({ kind: 'sanity-broken', group, pair: pair.pair, side, itemId: item.itemId, expect: 'A' });
      calls.push(...order({ kind: 'sanity-broken', group, pair: pair.pair, briefId: pair.briefId, brief: pair.brief }, item, control, FIRST_ONLY));
    }
    if (withControl.length < count) controls.push({ kind: 'sanity-broken', missing: count - withControl.length, note: `only ${withControl.length} item(s) have ${CONTROL_SHOT}` });
  }
  return { calls, controls };
}

const imageCache = new Map();
/** Encoded images by sha256 -> source file (used by the self-test's fake judge). */
export const encodedSources = new Map();

async function encodeView(file, view, mobileColumns = true) {
  const columns = Boolean(view.columns) && mobileColumns;
  const key = `${file}|${view.cssWidth}|${view.cropCss}|${columns}`;
  if (!imageCache.has(key)) {
    imageCache.set(key, encodeShot(file, { cssWidth: view.cssWidth, cropCss: view.cropCss, maxEdge: MAX_EDGE, quality: JPEG_QUALITY, columns }).then(encoded => {
      encodedSources.set(encoded.sha256, file);
      return encoded;
    }));
  }
  return imageCache.get(key);
}

/** Conservative tile estimate (85 + 170 per 512 px tile after the 2048/768 fit) for "high" detail. */
function tileTokens(width, height) {
  let w = width;
  let h = height;
  const fit = Math.min(1, 2048 / Math.max(w, h));
  w *= fit; h *= fit;
  const shortest = Math.min(1, 768 / Math.min(w, h));
  w *= shortest; h *= shortest;
  return 85 + 170 * Math.ceil(w / 512) * Math.ceil(h / 512);
}

function viewLabel(view, encoded) {
  // First screens are cut to the viewport height by definition; only full-page crops are announced.
  const notes = [];
  if (encoded.cropped && view.announceCrop) notes.push(`cropped to the first ${encoded.cropCss} px`);
  if (encoded.columns > 1) notes.push(`split into ${encoded.columns} columns side by side, read left to right`);
  return notes.length ? `${view.label.slice(0, -1)}; ${notes.join('; ')})` : view.label;
}

function introText(call) {
  const shown = call.views.length === 1
    ? 'For each side you see only the desktop first screen at 1440 px wide.'
    : 'For each side you see the desktop first screen at 1440 px wide, the desktop full page at 1440 px wide and the mobile full page at 390 px wide, in that order.';
  return `The brief\n\n${call.brief}\n\nTwo websites were delivered for this brief, labelled Left and Right. ${shown} Full-page screenshots longer than ${FULL_CROP_CSS} px are cropped to their first ${FULL_CROP_CSS} px.`;
}
const CLOSING = 'Judge the two deliverables against the rubric and answer with the JSON object only.';

/**
 * Build one call's request with images replaced by placeholders (what is
 * written to requests/*.json) plus everything needed to send it.
 */
async function composeCall(call, { rubric, cfg }) {
  const sides = { Left: call.left === 'A' ? call.a : call.b, Right: call.left === 'A' ? call.b : call.a };
  const images = [];
  const content = [{ type: 'input_text', text: introText(call) }];
  for (const side of SIDES) {
    for (const view of call.views) {
      const encoded = await encodeView(sides[side].shots[view.shot], view, cfg.mobileColumns);
      const index = images.length;
      images.push({ index, side, view: view.id, sha256: encoded.sha256, bytes: encoded.bytes, width: encoded.width, height: encoded.height, cropped: encoded.cropped, columns: encoded.columns, sentScale: encoded.sentScale, pageCssHeight: encoded.pageCssHeight, item: sides[side].itemId, source: rel(sides[side].shots[view.shot]) });
      content.push({ type: 'input_text', text: `${side} — ${viewLabel(view, encoded)}` });
      content.push({ type: 'input_image', detail: 'high', image_url: `<omitted: image ${index}, jpeg ${encoded.width}x${encoded.height}, ${encoded.bytes} bytes, sha256 ${encoded.sha256}>` });
    }
  }
  content.push({ type: 'input_text', text: CLOSING });
  const body = {
    model: cfg.model ?? '<EVAL_JUDGE_MODEL unset>',
    instructions: rubric.instructions,
    input: [{ role: 'user', content }],
    text: { format: { type: 'json_schema', name: 'pairwise_verdict', schema: VERDICT_SCHEMA, strict: true } },
    max_output_tokens: cfg.maxOutputTokens,
    store: false,
  };
  if (cfg.reasoningEffort) body.reasoning = { effort: cfg.reasoningEffort };
  if (cfg.temperature !== null) body.temperature = cfg.temperature;

  const promptText = [rubric.instructions, ...content.filter(part => part.type === 'input_text').map(part => part.text)].join('\n');
  const identifiers = [call.a.itemId, call.b.itemId, call.briefId, call.pair, ...cfg.setLabels]
    .filter(Boolean).map(String).filter(token => token.length >= 4 && /[\d_.-]/.test(token));
  assertBlind(promptText, identifiers, `request ${call.callId}`);

  const textChars = promptText.length + JSON.stringify(VERDICT_SCHEMA).length;
  const imageTokens = images.reduce((sum, image) => sum + Math.max(cfg.imageTokens, tileTokens(image.width, image.height)), 0);
  const inputTokens = Math.ceil(textChars / 3) + imageTokens + 50;
  return { call, body, images, requestSha256: sha256(JSON.stringify(body)), estimate: { textChars, imageTokens, inputTokens } };
}

async function materialise(composed, cfg) {
  const body = structuredClone(composed.body);
  let index = 0;
  for (const part of body.input[0].content) {
    if (part.type !== 'input_image') continue;
    const image = composed.images[index++];
    const side = composed.call.left === 'A' ? { Left: composed.call.a, Right: composed.call.b } : { Left: composed.call.b, Right: composed.call.a };
    const view = composed.call.views.find(candidate => candidate.id === image.view);
    const encoded = await encodeView(side[image.side].shots[view.shot], view, cfg.mobileColumns);
    assert.equal(encoded.sha256, image.sha256);
    part.image_url = `data:image/jpeg;base64,${encoded.buffer.toString('base64')}`;
  }
  return body;
}

// ---------------------------------------------------------------- configuration, pricing, budget

const positive = value => { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : null; };
const integer = (value, fallback) => { const number = Number.parseInt(value ?? '', 10); return Number.isFinite(number) && number > 0 ? number : fallback; };

/** Judge configuration from the environment. Presence of the API key only, never its value. */
export function judgeConfig(env = process.env) {
  const model = env.EVAL_JUDGE_MODEL?.trim() || null;
  if (model && /claude|anthropic|sonnet|opus|haiku/i.test(model)) throw new Error(`EVAL_JUDGE_MODEL "${model}" looks like an Anthropic model; the judge must be a different family from the builder`);
  const temperature = env.EVAL_JUDGE_TEMPERATURE?.trim() ? Number(env.EVAL_JUDGE_TEMPERATURE) : null;
  return {
    model,
    inPrice: positive(env.EVAL_JUDGE_USD_PER_MTOK_IN),
    outPrice: positive(env.EVAL_JUDGE_USD_PER_MTOK_OUT),
    imageTokens: integer(env.EVAL_JUDGE_IMAGE_TOKENS, 1600),
    maxOutputTokens: integer(env.EVAL_JUDGE_MAX_OUTPUT_TOKENS, 4000),
    expectedOutputTokens: integer(env.EVAL_JUDGE_EXPECTED_OUTPUT_TOKENS, 1500),
    reasoningEffort: env.EVAL_JUDGE_REASONING_EFFORT?.trim() || null,
    temperature: Number.isFinite(temperature) ? temperature : null,
    apiKeyPresent: Boolean(env.OPENAI_API_KEY?.trim()),
    // EVAL_JUDGE_MOBILE_COLUMNS=0 sends the mobile page as one downscaled strip instead.
    mobileColumns: env.EVAL_JUDGE_MOBILE_COLUMNS?.trim() !== '0',
    setLabels: [],
  };
}

function requireLive(cfg, approval) {
  const missing = [];
  if (!cfg.model) missing.push('EVAL_JUDGE_MODEL');
  if (!cfg.inPrice) missing.push('EVAL_JUDGE_USD_PER_MTOK_IN');
  if (!cfg.outPrice) missing.push('EVAL_JUDGE_USD_PER_MTOK_OUT');
  if (!cfg.apiKeyPresent) missing.push('OPENAI_API_KEY');
  if (!approval?.trim()) missing.push('--approval "<who, when>"');
  if (missing.length) throw new Error(`Live judging refused (fail closed): missing ${missing.join(', ')}`);
}

const usdFor = (cfg, inputTokens, outputTokens) => (cfg.inPrice && cfg.outPrice ? (inputTokens * cfg.inPrice + outputTokens * cfg.outPrice) / 1e6 : null);

function callCost(cfg, estimate, calibration = 1) {
  const inputTokens = Math.ceil(estimate.inputTokens * calibration);
  const bound = usdFor(cfg, inputTokens, cfg.maxOutputTokens);
  return {
    inputTokens,
    boundUsd: bound === null ? null : bound * SAFETY,
    expectedUsd: usdFor(cfg, inputTokens, Math.min(cfg.expectedOutputTokens, cfg.maxOutputTokens)),
  };
}

/** In-memory budget with lib/budget.mjs semantics, for tests (never touches the real ledger). */
export function memoryBudget(capUsd) {
  const entries = [];
  const committed = () => entries.reduce((sum, entry) => sum + (entry.status === 'settled' ? entry.actualUsd : entry.boundUsd), 0);
  return {
    async reserve({ kind, ref, boundUsd }) {
      if (committed() + boundUsd > capUsd + 1e-12) throw new CapReached(`Spend cap reached: $${committed().toFixed(4)} committed + $${boundUsd.toFixed(4)} for ${kind} ${ref} would exceed $${capUsd.toFixed(4)}`, { committedUsd: committed(), boundUsd, capUsd });
      entries.push({ id: `m${entries.length}`, kind, ref, boundUsd, status: 'reserved', actualUsd: null });
      return `m${entries.length - 1}`;
    },
    async settle(id, { actualUsd, unknown = false } = {}) {
      const entry = entries.find(item => item.id === id);
      if (unknown || !(actualUsd >= 0)) entry.status = 'unknown';
      else Object.assign(entry, { status: 'settled', actualUsd });
      return entry;
    },
    summary: () => ({ capUsd, committedUsd: committed(), remainingUsd: Math.max(0, capUsd - committed()), calls: entries.length, memory: true }),
    entries: () => entries.map(entry => ({ ...entry })),
  };
}

// No SDK retries: a retry is a second billed attempt under the same reservation,
// and only the last attempt's usage would be settled. A failed call stays failed
// (recorded in verdicts.jsonl); resuming the round re-sends it under a new reservation.
// Explicit base URL: an OPENAI_BASE_URL in the environment must not reroute paid calls.
export const OPENAI_CLIENT_OPTIONS = Object.freeze({ baseURL: OPENAI_BASE_URL, maxRetries: 0, timeout: 180_000 });

async function openAIClient(apiKey = process.env.OPENAI_API_KEY) {
  const { default: OpenAI } = await import('openai');
  return new OpenAI({ apiKey, ...OPENAI_CLIENT_OPTIONS });
}

/**
 * How a failed call's reservation is settled (one reservation = one HTTP attempt):
 * - the request was never handed to the client (its body could not be built): $0;
 * - the server answered 400, 401, 403, 404 or 422: the request was rejected before
 *   the model processed it, so no tokens were billed: $0. "Answered" means an HTTP
 *   response really arrived (a status AND response headers on the error);
 * - anything else after the request was sent (timeout, connection error, abort,
 *   408, 409, 429, 5xx, a status without a response, any other error): usage is
 *   unknown, so the reservation stays counted at its full bound (status "unknown").
 * A response that arrives is settled at its measured usage, or as unknown when it carries none.
 */
export const NOT_BILLED_STATUSES = Object.freeze([400, 401, 403, 404, 422]);

export function failedCallSettlement(error, { sent }) {
  if (!sent) return { actualUsd: 0, reason: 'request not sent' };
  const answered = Number.isInteger(error?.status) && Boolean(error?.headers);
  if (answered && NOT_BILLED_STATUSES.includes(error.status)) return { actualUsd: 0, reason: `HTTP ${error.status}: rejected before processing, not billed` };
  return { unknown: true, reason: answered ? `HTTP ${error.status}: usage unknown` : `${error?.constructor?.name ?? 'error'} without an HTTP response: usage unknown` };
}

// ---------------------------------------------------------------- verdicts

function responseText(response) {
  if (typeof response.output_text === 'string' && response.output_text.trim()) return { text: response.output_text };
  let text = '';
  for (const item of response.output ?? []) {
    if (item.type !== 'message') continue;
    for (const part of item.content ?? []) {
      if (part.type === 'refusal') return { refusal: part.refusal };
      if (part.type === 'output_text') text += part.text;
    }
  }
  return { text };
}

const PREFERENCES = new Set(['Left', 'Right', 'Tie']);
function parseVerdict(text) {
  const verdict = JSON.parse(text);
  assert(PREFERENCES.has(verdict.overall), 'overall must be Left, Right or Tie');
  for (const { id } of CRITERIA) assert(PREFERENCES.has(verdict.criteria?.[id]?.preference), `criterion ${id} has no valid preference`);
  return verdict;
}

const sideOf = (call, preference) => (preference === 'Tie' ? 'tie' : (preference === 'Left') === (call.left === 'A') ? 'A' : 'B');

function usageOf(response) {
  const usage = response.usage ?? {};
  return {
    input_tokens: usage.input_tokens ?? null,
    output_tokens: usage.output_tokens ?? null,
    reasoning_tokens: usage.output_tokens_details?.reasoning_tokens ?? null,
    cached_tokens: usage.input_tokens_details?.cached_tokens ?? null,
  };
}

/** Thrown by executeCall when the round was halted (fatal error or cap) before this call reserved or was sent. */
class RoundHalted extends Error {
  constructor(message) { super(message); this.code = 'EVAL_JUDGE_HALTED'; }
}

/** One paid (or fake) call: reserve, send, settle with measured usage, record. */
async function executeCall(composed, ctx) {
  const { call } = composed;
  const cost = callCost(ctx.cfg, composed.estimate, ctx.calibration.factor);
  // Shared abort flag: checked immediately before reserving and again once the reservation is held.
  if (ctx.halted()) throw new RoundHalted(`${call.callId}: round halted before reserving`);
  const reservation = await ctx.budget.reserve({ kind: 'judge', ref: `${ctx.roundId}/${call.callId}`, boundUsd: cost.boundUsd, note: ctx.cfg.model });
  if (ctx.halted()) {
    // Nothing was sent under this reservation, so it settles at $0 (failedCallSettlement's "not sent" rule).
    await ctx.budget.settle(reservation, { actualUsd: 0, detail: { settlement: 'request not sent: round halted while the reservation was being made' } });
    throw new RoundHalted(`${call.callId}: round halted before sending`);
  }
  const row = {
    round: ctx.roundId, callId: call.callId, kind: call.kind, group: call.group, pair: call.pair, order: call.order, left: call.left,
    aItem: call.a.itemId, bItem: call.b.itemId, requestSha256: composed.requestSha256, model: ctx.cfg.model, mode: ctx.mode,
    status: 'error', overall: null, overallSide: null, criteria: null, confidence: null, rationale: null,
    usage: null, boundUsd: cost.boundUsd, costUsd: null, settlement: null, responseId: null, responseModel: null, error: null, at: new Date().toISOString(),
  };
  let settled = false;
  let sent = false;
  try {
    const body = await materialise(composed, ctx.cfg);
    sent = true;
    const response = await ctx.client.responses.create(body, { maxRetries: 0 });
    row.responseId = response.id ?? null;
    row.responseModel = response.model ?? null;
    row.usage = usageOf(response);
    if (row.usage.input_tokens !== null && row.usage.output_tokens !== null) {
      row.costUsd = usdFor(ctx.cfg, row.usage.input_tokens, row.usage.output_tokens);
      await ctx.budget.settle(reservation, { actualUsd: row.costUsd, detail: { responseId: row.responseId, ...row.usage } });
      row.settlement = 'measured usage';
      // Learn from real usage: later bounds scale with the worst observed input/estimate ratio.
      ctx.calibration.factor = Math.max(ctx.calibration.factor, row.usage.input_tokens / composed.estimate.inputTokens);
    } else {
      await ctx.budget.settle(reservation, { unknown: true, detail: { responseId: row.responseId, reason: 'no usage in response' } });
      row.settlement = 'no usage in response: full bound kept';
    }
    settled = true;
    if (response.status && response.status !== 'completed') {
      row.status = 'incomplete';
      row.error = `response ${response.status}${response.incomplete_details?.reason ? `: ${response.incomplete_details.reason}` : ''}`;
    } else {
      const { text, refusal } = responseText(response);
      if (refusal) { row.status = 'refusal'; row.error = refusal.slice(0, 500); }
      else {
        try {
          const verdict = parseVerdict(text);
          Object.assign(row, {
            status: 'ok', overall: verdict.overall, overallSide: sideOf(call, verdict.overall), confidence: verdict.confidence, rationale: verdict.rationale,
            criteria: Object.fromEntries(CRITERIA.map(({ id }) => [id, { preference: verdict.criteria[id].preference, side: sideOf(call, verdict.criteria[id].preference), observation: verdict.criteria[id].observation }])),
          });
        } catch (error) {
          row.status = 'parse-error';
          row.error = `${error.message}; text starts: ${String(text).slice(0, 200)}`;
        }
      }
    }
  } catch (error) {
    if (error instanceof CapReached) throw error;
    row.error = `${error.status ?? error.code ?? error.name}: ${error.message}`.slice(0, 500);
    if (!settled) {
      const { reason, ...outcome } = failedCallSettlement(error, { sent });
      await ctx.budget.settle(reservation, { ...outcome, detail: { error: row.error, settlement: reason } });
      row.costUsd = outcome.unknown ? null : outcome.actualUsd;
      row.settlement = outcome.unknown ? `${reason}: full bound kept` : `${reason}: $0`;
    }
  }
  appendFileSync(ctx.verdictsFile, JSON.stringify(row) + '\n');
  ctx.rows.set(call.callId, row);
  ctx.log(`  ${call.callId}: ${row.status}${row.overall ? ` (${row.overall} -> ${row.overallSide})` : ''}${row.error ? ` ${row.error}` : ''}`);
  return row;
}

// ---------------------------------------------------------------- statistics

/** 1 = A preferred in both orders, 0 = B in both, 0.5 otherwise; null when an order is missing. */
function pairScore(ab, ba) {
  if (!ab || !ba) return null;
  if (ab === 'A' && ba === 'A') return 1;
  if (ab === 'B' && ba === 'B') return 0;
  return 0.5;
}

function outcomeStats(scores) {
  const wins = scores.filter(score => score === 1).length;
  const losses = scores.filter(score => score === 0).length;
  const ties = scores.length - wins - losses;
  const k = wins + ties / 2;
  return {
    winRate: scores.length ? k / scores.length : null,
    wins, ties, losses, n: scores.length,
    ci: {
      bootstrap: { ...bootstrapMean(scores, { resamples: JUDGE_BAR.J1.resamples, seed: JUDGE_BAR.J1.seed }), resamples: JUDGE_BAR.J1.resamples, seed: JUDGE_BAR.J1.seed },
      wilson: { ...wilson(k, scores.length), k, n: scores.length },
    },
  };
}

/** Compute the round summary from the call plan and the recorded rows. */
export function summarise({ calls, controls, rows, skipped }) {
  const byGroup = new Map();
  for (const call of calls) {
    const entry = byGroup.get(call.group) ?? { call, rows: {} };
    const row = rows.get(call.callId);
    entry.rows[call.order] = row?.status === 'ok' ? row : null;
    byGroup.set(call.group, entry);
  }
  const mainGroups = [...byGroup.values()].filter(group => group.call.kind === 'main');
  const pairResults = mainGroups.map(({ call, rows: orders }) => ({
    pair: call.pair, briefId: call.briefId, pairedBy: call.pairedBy ?? null, aItem: call.a.itemId, bItem: call.b.itemId,
    orders: { ab: orders.ab?.overallSide ?? null, ba: orders.ba?.overallSide ?? null },
    score: pairScore(orders.ab?.overallSide, orders.ba?.overallSide),
    confidence: { ab: orders.ab?.confidence ?? null, ba: orders.ba?.confidence ?? null },
  }));
  const complete = pairResults.filter(result => result.score !== null);
  const overall = outcomeStats(complete.map(result => result.score));

  const perCriterion = Object.fromEntries(CRITERIA.map(({ id, label }) => {
    const scores = mainGroups.map(({ rows: orders }) => pairScore(orders.ab?.criteria?.[id]?.side, orders.ba?.criteria?.[id]?.side)).filter(score => score !== null);
    const stats = outcomeStats(scores);
    return [id, { label, winRate: stats.winRate, wins: stats.wins, ties: stats.ties, losses: stats.losses, n: stats.n, ciBootstrap: stats.ci.bootstrap }];
  }));

  const mainRows = mainGroups.flatMap(({ rows: orders }) => [orders.ab, orders.ba]).filter(Boolean);
  const decisive = mainRows.filter(row => row.overall !== 'Tie');
  const leftShare = decisive.length ? decisive.filter(row => row.overall === 'Left').length / decisive.length : null;
  const [low, high] = JUDGE_BAR.J4.positionBiasBand;
  const positionBias = {
    leftShare,
    tieShare: mainRows.length ? (mainRows.length - decisive.length) / mainRows.length : null,
    decisiveCalls: decisive.length,
    calls: mainRows.length,
    band: [low, high],
    flagged: leftShare !== null && (leftShare < low || leftShare > high),
    // Share of complete pairs where both orders picked the same site.
    orderConsistency: complete.length ? complete.filter(result => result.score !== 0.5).length / complete.length : null,
  };

  let sanity = null;
  const controlGroups = [...byGroup.values()].filter(group => group.call.kind !== 'main');
  if (controls.length) {
    const items = controlGroups.map(({ call, rows: orders }) => {
      const score = pairScore(orders.ab?.overallSide, orders.ba?.overallSide);
      const expect = call.kind === 'sanity-self' ? 'tie' : 'A';
      const agreed = score === null ? null : expect === 'tie' ? score === 0.5 : score === 1;
      return { group: call.group, kind: call.kind, pair: call.pair, item: call.a.itemId, expect, orders: { ab: orders.ab?.overallSide ?? null, ba: orders.ba?.overallSide ?? null }, agreed };
    });
    const done = items.filter(item => item.agreed !== null);
    const agreement = done.length ? done.filter(item => item.agreed).length / done.length : null;
    const byKind = Object.fromEntries(['sanity-self', 'sanity-broken'].map(kind => {
      const list = done.filter(item => item.kind === kind);
      return [kind, { controls: items.filter(item => item.kind === kind).length, complete: list.length, agreed: list.filter(item => item.agreed).length }];
    }));
    sanity = {
      controls: items.length, complete: done.length, agreed: done.filter(item => item.agreed).length, agreement,
      minAgreement: JUDGE_BAR.J4.minAgreement,
      pass: agreement !== null && done.length === items.length && agreement >= JUDGE_BAR.J4.minAgreement,
      byKind, items, shortfalls: controls.filter(control => control.missing),
    };
  }
  const gate = {
    sanityRun: Boolean(sanity),
    sanityPass: sanity?.pass ?? false,
    positionBiasInBand: positionBias.leftShare !== null && !positionBias.flagged,
  };
  gate.valid = gate.sanityRun && gate.sanityPass && gate.positionBiasInBand;
  return {
    pairs: complete.length,
    pairsPlanned: pairResults.length,
    incompletePairs: pairResults.filter(result => result.score === null).map(result => result.pair),
    skippedPairs: skipped,
    winRate: overall.winRate,
    outcomes: { wins: overall.wins, ties: overall.ties, losses: overall.losses },
    ci: overall.ci,
    perCriterion,
    positionBias,
    sanity,
    gate,
    // J1/J2: the claim needs the lower CI bound above 50% AND a valid (J4) round.
    claim: { ciLowerAbove: JUDGE_BAR.J1.ciLowerAbove, ciLowerBootstrap: overall.ci.bootstrap.low, supported: gate.valid && overall.ci.bootstrap.low !== null && overall.ci.bootstrap.low > JUDGE_BAR.J1.ciLowerAbove },
    pairResults,
  };
}

const pct = value => (value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(1)}%`);
const usd = value => (value === null || value === undefined ? 'n/a' : `$${value.toFixed(4)}`);

function summaryMarkdown(summary) {
  const lines = [
    `# Judge round ${summary.roundId}`,
    '',
    `Mode: **${summary.mode}**. Model: ${summary.model ?? 'unset'}. Rubric ${summary.rubricVersion} (sha256 ${summary.rubricSha256.slice(0, 12)}). Quality bar ${summary.qualityBar}.`,
    `Set A: ${summary.sets.a.label} (${summary.sets.a.dir}). Set B: ${summary.sets.b.label} (${summary.sets.b.dir}). Win rate is for set A.`,
    '',
  ];
  if (summary.mode === 'dry') {
    const estimate = summary.estimate;
    lines.push('## Dry run (no calls made)', '',
      `${estimate.calls} calls planned (${estimate.pairs} pairs x 2 orders${estimate.controlCalls ? ` + ${estimate.controlCalls} control calls` : ''}).`,
      `Estimated input per call: ${estimate.inputTokensPerCall.min}–${estimate.inputTokensPerCall.max} tokens (images ${estimate.imageTokensPerCall.max} max). Max output per call: ${estimate.maxOutputTokens}.`,
      estimate.prices ? `At $${estimate.prices.inPerMTok}/MTok in and $${estimate.prices.outPerMTok}/MTok out (${estimate.prices.source}): expected ${usd(estimate.expectedUsdPerPair)} per pair, ${usd(estimate.expectedUsdTotal)} total; worst-case bound ${usd(estimate.boundUsdPerPair)} per pair, ${usd(estimate.boundUsdTotal)} total (x${SAFETY} safety). Fits the remaining budget: ${estimate.fitsBudget}.` : 'Prices not configured: set EVAL_JUDGE_USD_PER_MTOK_IN and EVAL_JUDGE_USD_PER_MTOK_OUT for a USD estimate.',
      '');
  } else {
    lines.push('## Result', '',
      '| Pairs | Win rate (A) | Bootstrap 95% CI | Wilson 95% CI | W / T / L |', '|---|---|---|---|---|',
      `| ${summary.pairs} of ${summary.pairsPlanned} | ${pct(summary.winRate)} | ${pct(summary.ci.bootstrap.low)} – ${pct(summary.ci.bootstrap.high)} | ${pct(summary.ci.wilson.low)} – ${pct(summary.ci.wilson.high)} | ${summary.outcomes.wins} / ${summary.outcomes.ties} / ${summary.outcomes.losses} |`,
      '',
      `Claim (lower bootstrap bound > ${pct(summary.claim.ciLowerAbove)} on a valid round): **${summary.claim.supported ? 'supported' : 'not supported'}**.`,
      `Gate (J4): sanity run ${summary.gate.sanityRun}, sanity pass ${summary.gate.sanityPass}, position bias in band ${summary.gate.positionBiasInBand} -> **${summary.gate.valid ? 'valid' : 'NOT valid'}**.`,
      '',
      '## Per criterion (pair-level, both orders must agree)', '', '| Criterion | Win rate (A) | W / T / L | n |', '|---|---|---|---|',
      ...Object.values(summary.perCriterion).map(row => `| ${row.label} | ${pct(row.winRate)} | ${row.wins} / ${row.ties} / ${row.losses} | ${row.n} |`),
      '',
      `## Position bias`, '',
      `Left preferred in ${pct(summary.positionBias.leftShare)} of ${summary.positionBias.decisiveCalls} decisive calls (band ${pct(summary.positionBias.band[0])}–${pct(summary.positionBias.band[1])})${summary.positionBias.flagged ? ' — **FLAGGED**' : ''}. Ties: ${pct(summary.positionBias.tieShare)}. Order consistency: ${pct(summary.positionBias.orderConsistency)}.`,
      '');
    if (summary.sanity) {
      lines.push('## Sanity (J4)', '', `Agreement ${pct(summary.sanity.agreement)} (${summary.sanity.agreed}/${summary.sanity.complete} complete of ${summary.sanity.controls}); needs ${pct(summary.sanity.minAgreement)} -> **${summary.sanity.pass ? 'pass' : 'FAIL'}**.`, '',
        '| Control | Expect | Picked, A on Left | Picked, B on Left | Agreed |', '|---|---|---|---|---|',
        ...summary.sanity.items.map(item => `| ${item.group} | ${item.expect} | ${item.orders.ab ?? '–'} | ${item.orders.ba ?? '–'} | ${item.agreed ?? 'incomplete'} |`), '');
    } else {
      lines.push('## Sanity (J4)', '', 'Not run (pass --sanity). Without it this round cannot gate J1/J2.', '');
    }
    lines.push('## Pairs', '', '| Pair | Picked, A on Left | Picked, B on Left | Score (A) |', '|---|---|---|---|',
      ...summary.pairResults.map(result => `| ${result.pair} | ${result.orders.ab ?? '–'} | ${result.orders.ba ?? '–'} | ${result.score ?? 'incomplete'} |`), '',
      `Cost: ${usd(summary.costUsd)} measured${summary.mode === 'fake' ? ' (fake client: computed from canned usage, nothing spent)' : ''}. Calls: ${summary.calls.ok} ok, ${summary.calls.failed} failed, ${summary.calls.reused} reused from an earlier run, ${summary.calls.notRun} not run.`);
    if (summary.stopped) lines.push('', `**Stopped early:** ${summary.stopped.reason}: ${summary.stopped.message}`);
  }
  if (summary.skippedPairs.length) lines.push('', '## Skipped pairs', '', ...summary.skippedPairs.map(item => `- ${item.pair}: ${item.reason}`));
  if (summary.warnings.length) lines.push('', '## Warnings', '', ...summary.warnings.map(warning => `- ${warning}`));
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- the round

/**
 * Run one judge round.
 * @param {object} options
 * @param {string} options.a measure set directory for side A (the win rate is A's)
 * @param {string} options.b measure set directory for side B
 * @param {string} [options.aLabel] [options.bLabel] labels for reports only (never sent)
 * @param {string} [options.pairsFile] explicit pairing
 * @param {'dry'|'live'|'fake'} [options.mode='dry']
 * @param {string} [options.approval] required for live
 * @param {boolean} [options.sanity] add J4 controls; [options.sanityShare=0.1] [options.sanityN]
 * @param {string} [options.roundId] reuse a round directory to resume (ok calls with an identical request are not repeated)
 * @param {string} [options.outRoot=outputs/eval/judge]
 * @param {object} [options.client] injected client with responses.create(body) (mode 'fake')
 * @param {object} [options.budget] injected budget {reserve, settle, summary} (defaults to lib/budget.mjs)
 * @param {object} [options.env=process.env] [options.concurrency=2] [options.allowPartial] [options.log]
 * @returns {Promise<object>} summary (also written to <round>/summary.json)
 */
export async function judgeRound(options) {
  const { a, b, pairsFile, mode = 'dry', approval = null, sanity = false, sanityShare = 0.1, sanityN = null, outRoot = JUDGE_DIR, env = process.env, concurrency = 2, allowPartial = false, log = console.log } = options;
  assert(['dry', 'live', 'fake'].includes(mode), `Unknown mode ${mode}`);
  const cfg = judgeConfig(env);
  if (mode === 'live') requireLive(cfg, approval);
  if (mode === 'fake') { assert(options.client, 'fake mode needs an injected client'); cfg.model ??= 'fake-judge'; }
  const rubric = loadRubric(options.rubricFile);
  const setA = loadSet(a, options.aLabel);
  const setB = loadSet(b, options.bLabel);
  cfg.setLabels = [setA.label, setB.label, path.basename(setA.dir), path.basename(setB.dir)];
  const { pairs, skipped, warnings } = pairSets(setA, setB, { pairsFile });
  if (!pairs.length) throw new PairingError(noPairsMessage(setA, setB, skipped, pairsFile));
  if (mode === 'live' && skipped.length && !allowPartial) throw new Error(`Refusing a partial live round: ${skipped.length} pair(s) skipped (${skipped.map(item => item.pair).join(', ')}). Fix them or pass --allow-partial.`);
  for (const pair of pairs) if (pair.scrubbed) warnings.push(`${pair.pair}: ${pair.scrubbed} name/URL/file reference(s) removed from the brief`);

  const startedAt = new Date().toISOString();
  const roundId = checkRoundId(options.roundId ?? `${mode}-${stamp()}`);
  // A folder that holds live work stays live: a dry or fake round under the same
  // name would rewrite summary.json and hide the paid calls from lib/budget.mjs.
  if (mode !== 'live') {
    const evidence = liveRoundEvidence(path.join(outRoot, roundId));
    if (evidence.length) throw new Error(`Refusing a ${mode} round in ${rel(path.join(outRoot, roundId))}: it holds live (paid) work (${evidence.join(', ')}). Pick another --round name.`);
  }
  // A live round on the real ledger: write the ledger file before this round's folder (a
  // judge/live-* folder) exists, or the folder itself would block the first reservation.
  if (mode === 'live' && !options.budget) await ledger.ensureLedger();
  const roundDir = ensureDir(path.join(outRoot, roundId));
  const requestsDir = ensureDir(path.join(roundDir, 'requests'));
  const { calls, controls } = planCalls(pairs, { sanity, sanityShare, sanityN });
  log(`Judge round ${roundId} (${mode}): ${pairs.length} pairs, ${calls.length} calls${controls.length ? `, ${controls.filter(control => !control.missing).length} sanity controls` : ''}`);

  const composed = [];
  for (const call of calls) {
    const item = await composeCall(call, { rubric, cfg });
    const cost = callCost(cfg, item.estimate);
    writeJson(path.join(requestsDir, `${call.callId}.json`), {
      callId: call.callId, kind: call.kind, pair: call.pair, order: call.order,
      sides: { Left: call.left === 'A' ? 'A' : 'B', Right: call.left === 'A' ? 'B' : 'A' },
      items: { A: call.a.itemId, B: call.b.itemId }, briefSource: pairs.find(pair => pair.pair === call.pair)?.briefSource ?? null,
      rubric: { version: rubric.version, sha256: rubric.sha256 }, requestSha256: item.requestSha256,
      estimate: { ...item.estimate, maxOutputTokens: cfg.maxOutputTokens, boundUsd: cost.boundUsd, expectedUsd: cost.expectedUsd },
      images: item.images,
      body: item.body,
    });
    composed.push(item);
  }

  const base = {
    roundId, mode, model: cfg.model, rubricVersion: `${rubric.version} (${rubric.date})`, rubricSha256: rubric.sha256, qualityBar: QUALITY_BAR_VERSION,
    sets: { a: { label: setA.label, dir: rel(setA.dir) }, b: { label: setB.label, dir: rel(setB.dir) } },
    approval: mode === 'live' ? approval : null, warnings,
    config: { maxOutputTokens: cfg.maxOutputTokens, imageTokens: cfg.imageTokens, reasoningEffort: cfg.reasoningEffort, temperature: cfg.temperature, maxEdge: MAX_EDGE, jpegQuality: JPEG_QUALITY, fullCropCss: FULL_CROP_CSS, mobileColumns: cfg.mobileColumns, safety: SAFETY },
  };

  if (mode === 'dry') {
    const perCall = composed.map(item => ({ kind: item.call.kind, ...callCost(cfg, item.estimate), imageTokens: item.estimate.imageTokens }));
    const sum = (list, field) => (list.some(entry => entry[field] === null) ? null : list.reduce((total, entry) => total + entry[field], 0));
    const main = perCall.filter(entry => entry.kind === 'main');
    // null (no prices) must stay null, not become 0.
    const perPair = total => (total === null || !pairs.length ? null : total / pairs.length);
    const boundTotal = sum(perCall, 'boundUsd');
    let budgetState = null;
    try { budgetState = (options.budget ?? ledger).summary(); } catch (error) { budgetState = { error: error.message }; }
    const summary = {
      ...base, ...summarise({ calls, controls, rows: new Map(), skipped }),
      estimate: {
        calls: calls.length, pairs: pairs.length, controlCalls: calls.length - main.length,
        inputTokensPerCall: { min: Math.min(...perCall.map(entry => entry.inputTokens)), max: Math.max(...perCall.map(entry => entry.inputTokens)) },
        imageTokensPerCall: { max: Math.max(...perCall.map(entry => entry.imageTokens)) },
        maxOutputTokens: cfg.maxOutputTokens, expectedOutputTokens: cfg.expectedOutputTokens,
        prices: cfg.inPrice && cfg.outPrice ? { inPerMTok: cfg.inPrice, outPerMTok: cfg.outPrice, source: options.priceSource ?? 'EVAL_JUDGE_USD_PER_MTOK_IN/OUT' } : null,
        expectedUsdPerPair: perPair(sum(main, 'expectedUsd')),
        boundUsdPerPair: perPair(sum(main, 'boundUsd')),
        expectedUsdTotal: sum(perCall, 'expectedUsd'),
        boundUsdTotal: boundTotal,
        fitsBudget: boundTotal === null || budgetState?.remainingUsd === undefined ? null : boundTotal <= budgetState.remainingUsd,
      },
      budget: budgetState,
      costUsd: 0,
    };
    writeJson(path.join(roundDir, 'summary.json'), summary);
    writeFileSync(path.join(roundDir, 'summary.md'), summaryMarkdown(summary));
    log(`Dry run written to ${rel(roundDir)}`);
    return { ...summary, roundDir };
  }

  // Resume: reuse ok rows of the same mode whose request is byte-identical (same
  // model, rubric, images, brief); a fake verdict never stands in for a live one.
  const verdictsFile = path.join(roundDir, 'verdicts.jsonl');
  const previous = new Map();
  if (existsSync(verdictsFile)) {
    for (const line of readFileSync(verdictsFile, 'utf8').split('\n').filter(Boolean)) {
      const row = JSON.parse(line);
      if (row.status === 'ok' && row.mode === mode) previous.set(`${row.callId}|${row.requestSha256}`, row);
    }
  }
  // Shared abort flag: once set, no worker reserves (or sends) another call.
  let stopped = null;
  let fatal = null;
  const ctx = {
    cfg, mode, roundId, verdictsFile, log,
    client: mode === 'live' ? await openAIClient() : options.client,
    // Only a live round may write to the real ledger; fake rounds get a private one.
    budget: options.budget ?? (mode === 'live' ? ledger : memoryBudget(ledger.HARD_CAP_USD)),
    rows: new Map(), calibration: { factor: 1 },
    halted: () => Boolean(stopped || fatal),
  };
  const queue = [];
  let reused = 0;
  for (const item of composed) {
    const old = previous.get(`${item.call.callId}|${item.requestSha256}`);
    if (old) { ctx.rows.set(item.call.callId, old); reused++; } else queue.push(item);
  }
  if (reused) log(`Reusing ${reused} completed call(s) from ${rel(verdictsFile)}`);

  // Marker written BEFORE the first reservation and never deleted: lib/budget.mjs
  // counts live-started.json as paid-work evidence even if the round is killed
  // before any verdict or summary is written. Fake rounds go through the same
  // code path with fake-started.json (which is not evidence).
  if (queue.length) {
    const marker = path.join(roundDir, `${mode}-started.json`);
    if (!existsSync(marker)) {
      writeJson(marker, { roundId, mode, startedAt, pid: process.pid, model: cfg.model, approval: mode === 'live' ? approval : null, callsToRun: queue.length,
        note: 'Written before the first reservation of this round; never deleted. A dry or fake round refuses to reuse a folder that holds live-started.json.' });
    }
  }

  const worker = async () => {
    while (queue.length && !ctx.halted()) {
      const item = queue.shift();
      try { await executeCall(item, ctx); } catch (error) {
        queue.unshift(item);
        if (error instanceof RoundHalted) break;
        if (error instanceof CapReached) stopped ??= { reason: 'cap', message: error.message, detail: error.detail };
        // Any other error (ledger, settle, disk) is fatal: the flag stops every
        // worker before its next reservation; calls already in flight finish and
        // settle by the usual rule inside executeCall.
        else { fatal ??= error; stopped ??= { reason: 'error', message: String(error?.message ?? error).slice(0, 500), code: error?.code ?? null }; }
      }
    }
  };
  // Workers never reject, so every in-flight call has settled when this resolves.
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

  const rowsNow = [...ctx.rows.values()];
  const summary = {
    ...base,
    ...summarise({ calls, controls, rows: ctx.rows, skipped }),
    costUsd: rowsNow.reduce((total, row) => total + (row.costUsd ?? 0), 0),
    // Calls whose cost could not be measured stay in the ledger at their full bound.
    costUnknownCalls: rowsNow.filter(row => row.costUsd === null).length,
    calls: { planned: calls.length, ok: rowsNow.filter(row => row.status === 'ok').length, failed: rowsNow.filter(row => row.status !== 'ok').length, reused, notRun: calls.length - ctx.rows.size, newThisRun: ctx.rows.size - reused },
    calibration: ctx.calibration.factor,
    stopped,
    startedAt, finishedAt: new Date().toISOString(),
    budget: (() => { try { return ctx.budget.summary(); } catch (error) { return { error: error.message }; } })(),
  };
  writeJson(path.join(roundDir, 'summary.json'), summary);
  writeFileSync(path.join(roundDir, 'summary.md'), summaryMarkdown(summary));
  log(`Round written to ${rel(roundDir)}: win rate ${pct(summary.winRate)} over ${summary.pairs} pairs${stopped ? `; STOPPED (${stopped.reason}: ${stopped.message})` : ''}`);
  // A fatal error is reported in summary.json/md above and then rethrown (exit 1).
  if (fatal) {
    if (fatal instanceof Error) Object.assign(fatal, { roundDir, summary: { ...summary, roundDir } });
    throw fatal;
  }
  return { ...summary, roundDir };
}

/** Why a round folder counts as live (paid) work; [] when it does not. Same evidence as lib/budget.mjs. */
export function liveRoundEvidence(roundDir) {
  const found = [];
  if (existsSync(path.join(roundDir, ledger.JUDGE_LIVE_MARKER))) found.push(ledger.JUDGE_LIVE_MARKER);
  const verdicts = path.join(roundDir, 'verdicts.jsonl');
  if (existsSync(verdicts)) {
    try { if (/"mode"\s*:\s*"live"/.test(readFileSync(verdicts, 'utf8'))) found.push('verdicts.jsonl has live rows'); } catch { found.push('verdicts.jsonl unreadable'); }
  }
  const summaryFile = path.join(roundDir, 'summary.json');
  if (existsSync(summaryFile)) {
    try { if (readJson(summaryFile).mode === 'live') found.push('summary.json mode live'); } catch { found.push('summary.json unreadable'); }
  }
  return found;
}

// ---------------------------------------------------------------- sheet commands

/**
 * A round id is one plain folder name directly under outputs/eval/judge/. lib/budget.mjs
 * looks for live-round evidence only there, so a nested ('2026/r1'), empty or escaping
 * ('../x') name would hide paid work from the ledger-deletion guard.
 */
export function checkRoundId(roundId) {
  const id = String(roundId ?? '');
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(id) || id === '.' || id === '..') {
    throw new Error(`Invalid --round "${id}": use one folder name of letters, digits, dot, dash or underscore (no slashes, not "." or "..").`);
  }
  return id;
}

/** Build the designer sheet for two sets into outputs/eval/judge/<roundId>/. */
export async function makeSheet({ a, b, aLabel, bLabel, pairsFile, n = 10, seed = JUDGE_BAR.J1.seed, roundId, outRoot = JUDGE_DIR, log = console.log }) {
  const setA = loadSet(a, aLabel);
  const setB = loadSet(b, bLabel);
  const { pairs, skipped } = pairSets(setA, setB, { pairsFile });
  if (!pairs.length) throw new PairingError(noPairsMessage(setA, setB, skipped, pairsFile));
  const outDir = path.join(outRoot, checkRoundId(roundId ?? `sheet-${stamp()}`));
  const result = await buildSheet({ pairs, n, seed, outDir, sets: { a: setA, b: setB } });
  log(`Sheet with ${result.pairs} pairs (${(result.bytes / 1e6).toFixed(1)} MB): ${rel(result.sheetFile)}; key (keep private): ${rel(result.keyFile)}${skipped.length ? `; skipped ${skipped.length}` : ''}`);
  return { ...result, skipped };
}

/** Score designer answer files against a key; writes sheet-score.json/.md next to the key. */
export function scoreSheetFiles({ answerFiles, keyFile, log = console.log }) {
  const key = readJson(keyFile);
  const result = scoreSheet({ answers: answerFiles.map(file => readJson(file)), key });
  const dir = path.dirname(keyFile);
  writeJson(path.join(dir, 'sheet-score.json'), { ...result, answerFiles: answerFiles.map(file => rel(path.resolve(file))) });
  const md = [
    '# Designer sheet score (J3)', '',
    `${result.designers} designer(s), ${result.votes} votes (${result.missing} unanswered). Set A preferred in **${pct(result.shareAllVotes)}** of all votes (${pct(result.shareDecisive)} of decisive votes); ${result.designersPreferringA} of ${result.designers} designers prefer A.`,
    `J3 needs >= ${pct(result.minShare)} of all votes and a majority of designers: **${result.pass ? 'pass' : 'not met'}**.`, '',
    "| Designer | A | B | Can't decide | Unanswered |", '|---|---|---|---|---|',
    ...result.perDesigner.map(row => `| ${row.designer} | ${row.A} | ${row.B} | ${row.undecided} | ${row.missing} |`), '',
  ].join('\n');
  writeFileSync(path.join(dir, 'sheet-score.md'), md);
  log(md);
  return result;
}

// ---------------------------------------------------------------- self-test (no network)

const SELFTEST_CASES = Object.freeze({
  restaurant: 'Build a complete premium restaurant website for Saffron Table, a contemporary neighbourhood restaurant in Bristol. Warm editorial art direction, exceptional typography, seasonal menu with prices, opening hours, location, accessible mobile navigation and a reservation enquiry form with real validation. Do not pretend a reservation has been sent without a backend. No template look and no fake awards.',
  saas: 'Build a complete polished B2B SaaS website for Relay Operations: a shared handoff and issue tracker for small logistics teams. Distinctive, precise industrial design, an interactive product demonstration, clear features, transparent fictional sample pricing, FAQ and an accessible mobile menu. The demo request form must validate and honestly state when it is only a demo. No fake customer logos or unsupported claims.',
  portfolio: 'Build a complete editorial portfolio and enquiry website for Mira Objects, an independent ceramic artist. Warm ivory and charcoal, oversized serif typography, an asymmetric but readable layout, illustrations of ceramic objects with distinct silhouettes, collection filtering, work detail interaction and a commission enquiry form with accessible validation. Outstanding mobile layout.',
});

async function buildSelftestSets(root) {
  const { default: sharp } = await import('sharp');
  const source = path.join(path.dirname(OUT), 'product-qualification');
  for (const [name, brief] of Object.entries(SELFTEST_CASES)) {
    const files = { '1440-first.png': `${name}-1440-hero.png`, '1440-full.png': `${name}-1440.png`, '390-full.png': `${name}-390.png`, '390-first.png': `${name}-390-hero.png` };
    const aDir = ensureDir(path.join(root, 'setA', `st-a-${name}`, 'shots'));
    const bDir = ensureDir(path.join(root, 'setB', `st-b-${name}`, 'shots'));
    for (const [target, from] of Object.entries(files)) {
      copyFileSync(path.join(source, from), path.join(aDir, target));
      // Set B: a visibly different "other maker" (desaturated, hue-shifted, softened).
      await sharp(path.join(source, from), { limitInputPixels: false }).modulate({ saturation: 0.25, hue: 140 }).blur(1.2).png().toFile(path.join(bDir, target));
    }
    // The unstyled control (in real sets measure.mjs renders the page without CSS).
    await sharp(path.join(source, files['1440-first.png'])).greyscale().blur(8).linear(0.25, 190).png().toFile(path.join(aDir, CONTROL_SHOT));
    writeJson(path.join(root, 'setA', `st-a-${name}`, 'metrics.json'), { itemId: `st-a-${name}`, briefId: `st-${name}`, kind: 'website', fixture: 'judge-selftest' });
    writeJson(path.join(root, 'setA', `st-a-${name}`, 'item.json'), { id: `st-a-${name}`, kind: 'website', briefId: `st-${name}`, brief: { prompt: brief } });
    writeJson(path.join(root, 'setB', `st-b-${name}`, 'metrics.json'), { itemId: `st-b-${name}`, briefId: `st-${name}`, kind: 'website', fixture: 'judge-selftest' });
    // Fixture-shaped sets (briefId null): one with item.json relatedBriefId only, one with no id at all.
    for (const [setName, prefix, extra] of [['setRel', 'st-r', { relatedBriefId: `st-${name}` }], ['setNone', 'st-n', {}]]) {
      const dir = ensureDir(path.join(root, setName, `${prefix}-${name}`, 'shots'));
      for (const view of VIEWS) copyFileSync(path.join(bDir, view.shot), path.join(dir, view.shot));
      writeJson(path.join(root, setName, `${prefix}-${name}`, 'item.json'), { id: `${prefix}-${name}`, kind: 'website', briefId: null, ...extra, brief: { prompt: brief } });
    }
  }
}

/**
 * A canned judge that never touches the network. It recognises images by
 * hash, so its answers depend on which item really sits on which side:
 * restaurant and saas prefer set A (in both orders), portfolio always says
 * Left (position bias, so a tie), mobile prefers set B on restaurant,
 * self pairs say Left, controls lose. `broken` makes the first n answers invalid
 * JSON; `noUsage` omits usage so reservations stay counted at their full bound;
 * `errors[n]` (a function) makes call n+1 throw what it returns. Request options
 * (the second argument) are recorded so the test can see maxRetries.
 */
function fakeClient({ broken = 0, noUsage = false, errors = [], delayMs = 0 } = {}) {
  let count = 0;
  const options = [];
  const pause = () => (delayMs ? new Promise(resolve => setTimeout(resolve, delayMs)) : null);
  const identify = dataUri => {
    const file = encodedSources.get(sha256(Buffer.from(dataUri.split(',')[1], 'base64'))) ?? '';
    const parts = file.split(path.sep);
    return { file, set: parts.find(part => part === 'setA' || part === 'setB'), name: Object.keys(SELFTEST_CASES).find(name => file.includes(name)), control: file.endsWith(CONTROL_SHOT) };
  };
  return {
    calls: () => count,
    options: () => options,
    responses: {
      async create(body, requestOptions) {
        count++;
        options.push(requestOptions ?? null);
        await pause();
        if (errors[count - 1]) throw errors[count - 1]();
        const content = body.input[0].content;
        const first = side => content[content.findIndex(part => part.type === 'input_text' && part.text.startsWith(`${side} —`)) + 1].image_url;
        const left = identify(first('Left'));
        const right = identify(first('Right'));
        let overall;
        let mobile = null;
        if (left.control || right.control) overall = left.control ? 'Right' : 'Left';
        else if (left.file === right.file || left.name === 'portfolio') overall = 'Left';
        else {
          overall = left.set === 'setA' ? 'Left' : 'Right';
          if (left.name === 'restaurant') mobile = left.set === 'setB' ? 'Left' : 'Right';
        }
        const verdict = {
          criteria: Object.fromEntries(CRITERIA.map(({ id }) => [id, { observation: 'Canned observation.', preference: id === 'mobile' && mobile ? mobile : overall }])),
          overall, confidence: 'medium', rationale: 'Canned verdict from the self-test fake judge.',
        };
        const textChars = JSON.stringify(content.filter(part => part.type === 'input_text')).length + body.instructions.length;
        const images = content.filter(part => part.type === 'input_image').length;
        return {
          id: `fake_${count}`, model: body.model, status: 'completed',
          output_text: count <= broken ? '{"overall": "Left", "criteria": ' : JSON.stringify(verdict),
          usage: noUsage ? undefined : { input_tokens: Math.round(textChars / 3.5) + images * 1105, input_tokens_details: { cached_tokens: 0 }, output_tokens: 640, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 0 },
        };
      },
    },
  };
}

async function checkSheetInBrowser(sheetFile, downloadDir) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const page = await context.newPage();
    const problems = [];
    const external = [];
    page.on('console', message => { if (message.type() === 'error') problems.push(`console: ${message.text()}`); });
    page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
    page.on('request', request => { if (!/^(file|data|blob):/.test(request.url())) external.push(request.url()); });
    await page.goto(pathToFileURL(sheetFile).href, { waitUntil: 'load' });

    await page.addScriptTag({ path: path.join(EVAL_DIR, 'node_modules', 'axe-core', 'axe.min.js') });
    const axe = await page.evaluate(async () => {
      const result = await globalThis.axe.run(document, { resultTypes: ['violations'] });
      return result.violations.map(violation => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.length }));
    });

    // Keyboard: Tab into the name field, type, then move between radios with arrow keys.
    await page.focus('#designer');
    await page.keyboard.type('Self Test Designer');
    const pairs = await page.locator('article.pair').count();
    await page.focus('input[name="choice-1"][value="left"]');
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowRight');
    const keyboardChoice = await page.locator('input[name="choice-1"]:checked').getAttribute('value');
    for (let number = 2; number <= pairs; number++) await page.getByRole('radio', { name: number % 2 ? 'Left' : 'Right', exact: true }).nth(number - 1).check();
    await page.fill('#comment-1', 'Right feels more specific.');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
    const file = path.join(ensureDir(downloadDir), download.suggestedFilename());
    await download.saveAs(file);
    const exported = readJson(file);
    const status = await page.locator('#export-status').textContent();
    const textCopy = await page.locator('#export-json').inputValue();
    await page.waitForTimeout(300);
    return { problems, external, axe, pairs, keyboardChoice, exported, exportFile: file, status, textCopyMatches: JSON.parse(textCopy).designer === exported.designer };
  } finally {
    await browser.close();
  }
}

export async function selftest({ log = console.log } = {}) {
  const root = path.join(OUT, 'selftest', 'judge');
  rmSync(root, { recursive: true, force: true });
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok), detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`); };
  const quiet = () => {};
  await buildSelftestSets(root);
  const setA = path.join(root, 'setA');
  const setB = path.join(root, 'setB');
  const rounds = path.join(root, 'rounds');
  // Prices: the configured ones when present, otherwise illustrative numbers clearly labelled as such.
  const configured = judgeConfig();
  const env = { ...process.env };
  let priceSource = 'EVAL_JUDGE_USD_PER_MTOK_IN/OUT';
  if (!configured.inPrice || !configured.outPrice) {
    Object.assign(env, { EVAL_JUDGE_USD_PER_MTOK_IN: '2.5', EVAL_JUDGE_USD_PER_MTOK_OUT: '10' });
    priceSource = 'ASSUMED for the self-test (not configured)';
  }
  delete env.OPENAI_API_KEY; // nothing in the self-test may be able to reach the network

  // 1. Dry run: requests on disk, no image bytes, blinded, with a cost estimate.
  const dry = await judgeRound({ a: setA, b: setB, mode: 'dry', sanity: true, sanityN: 3, roundId: 'dry', outRoot: rounds, env, priceSource, log: quiet });
  const requestFiles = readdirSync(path.join(dry.roundDir, 'requests'));
  check('dry run writes one request per call', requestFiles.length === dry.estimate.calls && dry.estimate.calls === 18, `${requestFiles.length} files, ${dry.estimate.calls} calls (6 main + 6 self + 6 broken)`);
  const allRequests = requestFiles.map(file => readFileSync(path.join(dry.roundDir, 'requests', file), 'utf8')).join('\n');
  check('request files hold no image bytes', !/base64,/.test(allRequests) && !/data:image/.test(allRequests));
  const sample = readJson(path.join(dry.roundDir, 'requests', 'st-restaurant-ab.json'));
  const sentText = [sample.body.instructions, ...sample.body.input[0].content.filter(part => part.type === 'input_text').map(part => part.text)].join('\n');
  check('prompt is blind (no ids, set names, file names, makers)', !/st-a-|st-b-|setA|setB|\.png|makeborne/i.test(sentText) && sample.body.input[0].content.filter(part => part.type === 'input_text' && /^(Left|Right) —/.test(part.text)).length === 6);
  check('rubric instructions sent verbatim', sample.body.instructions === loadRubric().instructions && sample.rubric.version === 'v1');
  check('full pages cropped to 4000 css px and long edge <= 1536', sample.images.every(image => Math.max(image.width, image.height) <= MAX_EDGE) && sample.images.filter(image => image.view !== 'desktop-first').every(image => image.cropped), sample.images.map(image => `${image.view} ${image.width}x${image.height}`).join(', '));
  const mobile = sample.images.find(image => image.view === 'mobile-full');
  check('long mobile pages are sent as columns at near-native scale', mobile.columns >= 2 && mobile.sentScale >= 0.9 && sample.body.input[0].content.some(part => part.type === 'input_text' && /mobile, full page .*columns side by side/.test(part.text)), `${mobile.columns} columns, ${mobile.width}x${mobile.height}, scale ${mobile.sentScale}`);
  check('dry run estimates cost per pair', dry.estimate.expectedUsdPerPair > 0 && dry.estimate.boundUsdPerPair > dry.estimate.expectedUsdPerPair, { inputTokensPerCall: dry.estimate.inputTokensPerCall, expectedUsdPerPair: dry.estimate.expectedUsdPerPair, boundUsdPerPair: dry.estimate.boundUsdPerPair, prices: dry.estimate.prices });

  // 2. Live mode fails closed without configuration (and never builds a client).
  let refusal = null;
  try { await judgeRound({ a: setA, b: setB, mode: 'live', outRoot: rounds, roundId: 'live-refused', env: {}, log: quiet }); } catch (error) { refusal = error.message; }
  check('live run without model/prices/key/approval is refused', /fail closed/.test(refusal ?? '') && /EVAL_JUDGE_MODEL/.test(refusal ?? ''), refusal);

  // 3. Fake client: parsing, position swapping, statistics, sanity.
  const client = fakeClient();
  const budget = memoryBudget(25);
  const fake = await judgeRound({ a: setA, b: setB, mode: 'fake', client, budget, sanity: true, sanityN: 3, roundId: 'fake', outRoot: rounds, env, concurrency: 3, log: quiet });
  check('fake round: 18 calls, all parsed', fake.calls.ok === 18 && client.calls() === 18, fake.calls);
  check('win only when both orders agree; win rate (2 + 0.5)/3', Math.abs(fake.winRate - 2.5 / 3) < 1e-9 && fake.outcomes.wins === 2 && fake.outcomes.ties === 1, { winRate: fake.winRate, outcomes: fake.outcomes });
  check('bootstrap CI over pairs and Wilson cross-check', fake.ci.bootstrap.low === 0.5 && fake.ci.bootstrap.high === 1 && fake.ci.wilson.low > 0 && fake.ci.wilson.high <= 1, fake.ci);
  check('per-criterion preferences (mobile differs)', Math.abs(fake.perCriterion.mobile.winRate - 0.5) < 1e-9 && fake.perCriterion.brief_fit.winRate === fake.winRate, { mobile: fake.perCriterion.mobile.winRate, brief_fit: fake.perCriterion.brief_fit.winRate });
  check('position bias measured and flagged outside 0.4–0.6', Math.abs(fake.positionBias.leftShare - 4 / 6) < 1e-9 && fake.positionBias.flagged, fake.positionBias);
  check('sanity: self pairs tie, unstyled controls lose, agreement 100%', fake.sanity.agreement === 1 && fake.sanity.pass && fake.sanity.byKind['sanity-self'].agreed === 3 && fake.sanity.byKind['sanity-broken'].agreed === 3, { agreement: fake.sanity.agreement, byKind: fake.sanity.byKind });
  check('gate invalid while position bias is flagged; claim not supported', !fake.gate.valid && !fake.claim.supported, fake.gate);
  check('budget reserved and settled per call', budget.summary().calls === 18 && Math.abs(budget.summary().committedUsd - fake.costUsd) < 1e-9, { committed: budget.summary().committedUsd, cost: fake.costUsd });
  const verdictLines = readFileSync(path.join(fake.roundDir, 'verdicts.jsonl'), 'utf8').trim().split('\n');
  check('verdicts.jsonl has one row per call', verdictLines.length === 18);

  // 4. Resume: the same round again repeats nothing.
  const again = await judgeRound({ a: setA, b: setB, mode: 'fake', client, budget, sanity: true, sanityN: 3, roundId: 'fake', outRoot: rounds, env, log: quiet });
  check('resume reuses identical completed calls', client.calls() === 18 && again.calls.reused === 18 && again.winRate === fake.winRate, again.calls);

  // 5. Cap and broken answers: a tiny cap stops the round and reports it.
  const bound = callCost(judgeConfig(env), { inputTokens: dry.estimate.inputTokensPerCall.max }).boundUsd;
  // Without usage every call stays counted at its full bound, so exactly two fit under 2.5 bounds.
  const cappedBudget = memoryBudget(bound * 2.5);
  const capped = await judgeRound({ a: setA, b: setB, mode: 'fake', client: fakeClient({ broken: 1, noUsage: true }), budget: cappedBudget, roundId: 'fake-cap', outRoot: rounds, env, concurrency: 1, log: quiet });
  check('CapReached stops the round and is reported', capped.stopped?.reason === 'cap' && capped.calls.notRun === 4, { stopped: capped.stopped?.reason, calls: capped.calls });
  check('invalid JSON is recorded as parse-error, pair incomplete', capped.calls.failed === 1 && capped.pairs === 0 && capped.incompletePairs.length === 3);
  check('calls without usage keep their full bound counted', capped.costUnknownCalls === 2 &&cappedBudget.summary().committedUsd > 1.9 * bound, { committedUsd: cappedBudget.summary().committedUsd, bound });

  // 5b. Failed calls: no SDK retries, and only a proven pre-processing rejection settles at $0.
  const { default: OpenAI, APIError, APIConnectionError, APIConnectionTimeoutError } = await import('openai');
  const offline = await openAIClient('selftest-offline-not-a-key'); // constructing a client sends nothing
  check('real client never retries (one reservation = one attempt)', offline instanceof OpenAI && offline.maxRetries === 0 && OPENAI_CLIENT_OPTIONS.maxRetries === 0 && offline.baseURL === OPENAI_BASE_URL, { maxRetries: offline.maxRetries, timeout: offline.timeout });
  const http = (status, message) => () => APIError.generate(status, { error: { message, type: 'selftest' } }, undefined, new Headers({ 'x-request-id': `req_selftest_${status}` }));
  const failures = [
    ['400 bad request', http(400, 'Invalid image'), 0],
    ['401 auth', http(401, 'Incorrect API key'), 0],
    ['429 rate limit', http(429, 'Rate limit reached'), null],
    ['500 server error', http(500, 'Server error'), null],
    ['timeout', () => new APIConnectionTimeoutError(), null],
    ['connection reset', () => new APIConnectionError({ message: 'socket hang up' }), null],
  ];
  const failingClient = fakeClient({ errors: failures.map(([, make]) => make) });
  const failBudget = memoryBudget(25);
  const errored = await judgeRound({ a: setA, b: setB, mode: 'fake', client: failingClient, budget: failBudget, roundId: 'fake-errors', outRoot: rounds, env, concurrency: 1, log: quiet });
  const failRows = readFileSync(path.join(errored.roundDir, 'verdicts.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const outcomes = failRows.map((row, index) => ({ case: failures[index][0], costUsd: row.costUsd, settlement: row.settlement, ledger: failBudget.entries()[index].status }));
  check('every request asks for maxRetries 0', failingClient.options().length === 6 && failingClient.options().every(option => option?.maxRetries === 0));
  check('400/401 answered before processing settle at $0; 429, 5xx, timeout, network keep the full bound',
    failRows.length === 6 && failRows.every((row, index) => row.status === 'error' && row.costUsd === failures[index][2])
      && failBudget.entries().every((entry, index) => entry.status === (failures[index][2] === 0 ? 'settled' : 'unknown')),
    outcomes);
  const unknownBounds = failRows.filter(row => row.costUsd === null).reduce((sum, row) => sum + row.boundUsd, 0);
  check('ledger commits exactly the unknown calls at their bounds', errored.costUnknownCalls === 4 && Math.abs(failBudget.summary().committedUsd - unknownBounds) < 1e-9, { committedUsd: failBudget.summary().committedUsd, unknownBounds });
  const notSent = failedCallSettlement(new Error('image encode failed'), { sent: false });
  const statusOnly = failedCallSettlement(Object.assign(new Error('400 without a response'), { status: 400 }), { sent: true });
  const conflict = failedCallSettlement(http(409, 'Conflict')(), { sent: true });
  check('rule edges: unsent $0; a status without response headers or a 409 is unknown', notSent.actualUsd === 0 && statusOnly.unknown && conflict.unknown, { notSent: notSent.reason, statusOnly: statusOnly.reason, conflict: conflict.reason });

  // 5d. A fatal (non-cap) error in one worker stops every worker before its next
  // reservation; calls already in flight finish and settle; the round is reported.
  // Worker 2's reservation fails 150 ms in, while workers 1 and 3 have calls in flight (400 ms each).
  const fatalInner = memoryBudget(25);
  let reserveAttempts = 0;
  const fatalBudget = {
    ...fatalInner,
    async reserve(args) {
      reserveAttempts++;
      if (reserveAttempts === 2) {
        await new Promise(resolve => setTimeout(resolve, 150));
        throw Object.assign(new Error('Budget ledger is invalid (selftest)'), { code: 'EVAL_LEDGER_INVALID' });
      }
      return fatalInner.reserve(args);
    },
  };
  const slowClient = fakeClient({ delayMs: 400 });
  let fatalError = null;
  try { await judgeRound({ a: setA, b: setB, mode: 'fake', client: slowClient, budget: fatalBudget, roundId: 'fake-fatal', outRoot: rounds, env, concurrency: 3, log: quiet }); } catch (error) { fatalError = error; }
  const attemptsAtReturn = reserveAttempts;
  const callsAtReturn = slowClient.calls();
  await new Promise(resolve => setTimeout(resolve, 600)); // a worker still running in the background would reserve and call again here
  const fatalSummary = tryJson(path.join(rounds, 'fake-fatal', 'summary.json'));
  check('fatal error: all workers stop before reserving again (no background calls)', fatalError?.code === 'EVAL_LEDGER_INVALID' && attemptsAtReturn === 3 && reserveAttempts === 3 && callsAtReturn === 2 && slowClient.calls() === 2,
    { error: fatalError?.message, attemptsAtReturn, attemptsLater: reserveAttempts, callsAtReturn, callsLater: slowClient.calls() });
  check('fatal error: in-flight calls settled, round reported as stopped (error)', fatalInner.entries().length === 2 && fatalInner.entries().every(entry => entry.status === 'settled')
    && fatalSummary?.stopped?.reason === 'error' && fatalSummary.calls.ok === 2 && fatalSummary.calls.notRun === 4 && /STOPPED|Stopped early/.test(readFileSync(path.join(rounds, 'fake-fatal', 'summary.md'), 'utf8')),
    { entries: fatalInner.entries().map(entry => entry.status), stopped: fatalSummary?.stopped, calls: fatalSummary?.calls });

  // 5e. The round marker is on disk before the first reservation; a live folder is never reused dry or fake.
  const markerChecks = [];
  const markerInner = memoryBudget(25);
  const markerBudget = { ...markerInner, async reserve(args) { markerChecks.push(existsSync(path.join(rounds, 'fake-marker', 'fake-started.json'))); return markerInner.reserve(args); } };
  await judgeRound({ a: setA, b: setB, mode: 'fake', client: fakeClient(), budget: markerBudget, roundId: 'fake-marker', outRoot: rounds, env, concurrency: 2, log: quiet });
  check('round marker (<mode>-started.json) is written before the first reservation', markerChecks.length === 6 && markerChecks.every(Boolean), markerChecks);
  const liveFolder = path.join(rounds, 'was-live');
  writeJson(path.join(liveFolder, ledger.JUDGE_LIVE_MARKER), { roundId: 'was-live', mode: 'live' });
  writeJson(path.join(liveFolder, 'summary.json'), { mode: 'live', note: 'selftest' });
  let dryReuse = null;
  try { await judgeRound({ a: setA, b: setB, mode: 'dry', roundId: 'was-live', outRoot: rounds, env, log: quiet }); } catch (error) { dryReuse = error.message; }
  let fakeReuse = null;
  try { await judgeRound({ a: setA, b: setB, mode: 'fake', client: fakeClient(), budget: memoryBudget(25), roundId: 'was-live', outRoot: rounds, env, log: quiet }); } catch (error) { fakeReuse = error.message; }
  check(`dry/fake re-run of a folder with ${ledger.JUDGE_LIVE_MARKER} refused, summary.json untouched`, /holds live \(paid\) work/.test(dryReuse ?? '') && /holds live/.test(fakeReuse ?? '')
    && readJson(path.join(liveFolder, 'summary.json')).mode === 'live' && !existsSync(path.join(liveFolder, 'requests')), { dryReuse, fakeReuse });
  const rowsOnly = path.join(rounds, 'live-rows-only');
  ensureDir(rowsOnly);
  writeFileSync(path.join(rowsOnly, 'verdicts.jsonl'), `${JSON.stringify({ callId: 'x-ab', mode: 'live', status: 'error' })}\n`);
  let rowsReuse = null;
  try { await judgeRound({ a: setA, b: setB, mode: 'dry', roundId: 'live-rows-only', outRoot: rounds, env, log: quiet }); } catch (error) { rowsReuse = error.message; }
  check('dry re-run of a killed live round (live rows, no summary) refused', /verdicts\.jsonl has live rows/.test(rowsReuse ?? '') && !existsSync(path.join(rowsOnly, 'summary.json')), rowsReuse);
  // Resume only reuses rows of the same mode.
  const otherMode = path.join(rounds, 'other-mode');
  ensureDir(otherMode);
  writeFileSync(path.join(otherMode, 'verdicts.jsonl'), verdictLines.map(line => JSON.stringify({ ...JSON.parse(line), mode: 'replayed' })).join('\n') + '\n');
  const modeClient = fakeClient();
  const modeRound = await judgeRound({ a: setA, b: setB, mode: 'fake', client: modeClient, budget: memoryBudget(25), sanity: true, sanityN: 3, roundId: 'other-mode', outRoot: rounds, env, concurrency: 3, log: quiet });
  check('resume never reuses a verdict recorded in another mode', modeRound.calls.reused === 0 && modeClient.calls() === 18, modeRound.calls);

  // 5c. Pairing: briefId, then item.json relatedBriefId, then --pairs; nothing pairs -> clear message, exit 2.
  const setRel = path.join(root, 'setRel');
  const setNone = path.join(root, 'setNone');
  const related = pairSets(loadSet(setA), loadSet(setRel));
  check('pairs fall back to item.json relatedBriefId', related.pairs.length === 3 && related.pairs.every(pair => pair.pairedBy === 'relatedBriefId' && pair.relatedBriefId === pair.pair) && related.warnings.some(warning => /paired by relatedBriefId/.test(warning)), related.pairs.map(pair => `${pair.a.itemId}~${pair.b.itemId} by ${pair.pairedBy}`));
  const relatedDry = await judgeRound({ a: setA, b: setRel, mode: 'dry', roundId: 'dry-related', outRoot: rounds, env, log: quiet });
  check('a round over relatedBriefId pairs plans every call', relatedDry.estimate.calls === 6 && relatedDry.pairResults.every(result => result.pairedBy === 'relatedBriefId'), { calls: relatedDry.estimate.calls });
  let noPairs = null;
  try { await judgeRound({ a: setA, b: setNone, mode: 'dry', roundId: 'dry-none', outRoot: rounds, env, log: quiet }); } catch (error) { noPairs = error; }
  check('no pairs: PairingError lists every item with its ids and the --pairs hint', noPairs instanceof PairingError && ['st-a-restaurant', 'st-n-saas', 'st-n-portfolio'].every(id => noPairs.message.includes(id)) && /relatedBriefId -/.test(noPairs.message) && /--pairs/.test(noPairs.message) && !existsSync(path.join(rounds, 'dry-none')), noPairs?.message.split('\n')[0]);
  let noSheet = null;
  try { await makeSheet({ a: setA, b: setNone, roundId: 'sheet-none', outRoot: rounds, log: quiet }); } catch (error) { noSheet = error; }
  check('sheet without pairs refuses the same way', noSheet instanceof PairingError && noSheet.message.includes('st-n-restaurant'));
  const cliEnv = { ...env };
  const cli = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--a', setA, '--b', setNone, '--round', 'dry-none-cli'], { env: cliEnv, encoding: 'utf8', timeout: 120_000 });
  check('CLI prints the message and exits 2 (no stack trace)', cli.status === 2 && /No judgeable pairs/.test(cli.stderr) && cli.stderr.includes('st-n-saas') && !/\n\s+at /.test(cli.stderr), { status: cli.status, firstLine: cli.stderr.split('\n')[0] });
  const pairsFile = path.join(root, 'pairs.json');
  writeJson(pairsFile, [{ a: 'st-a-saas', b: 'st-n-saas' }]);
  const explicit = pairSets(loadSet(setA), loadSet(setNone), { pairsFile });
  check('an explicit --pairs file pairs items without ids', explicit.pairs.length === 1 && explicit.pairs[0].pairedBy === 'pairs-file' && explicit.pairs[0].b.itemId === 'st-n-saas', explicit.pairs.map(pair => pair.pair));
  writeJson(pairsFile, [{ a: 'st-a-saas', b: 'no-such-item' }]);
  let badFile = null;
  try { pairSets(loadSet(setA), loadSet(setNone), { pairsFile }); } catch (error) { badFile = error; }
  check('a pairs file naming an unknown item is refused with the item list', badFile instanceof PairingError && badFile.message.includes('no-such-item') && badFile.message.includes('st-n-restaurant'));

  // 6. Designer sheet: build, open in Chromium, export, score.
  const sheet = await makeSheet({ a: setA, b: setB, n: 10, roundId: 'sheet', outRoot: rounds, log: quiet });
  const html = readFileSync(sheet.sheetFile, 'utf8');
  const key = readJson(sheet.keyFile);
  check('sheet has the pairs and no key, ids or external resources', key.pairs.length === 3 && !/st-a-|st-b-|setA|setB|"left":|judgePair/.test(html) && !/(src|href)="(https?:)?\/\//i.test(html), `${(sheet.bytes / 1e6).toFixed(2)} MB, ${key.pairs.map(pair => pair.left).join('')} on the left`);
  const browser = await checkSheetInBrowser(sheet.sheetFile, path.join(root, 'downloads'));
  check('sheet loads with no console errors or external requests', !browser.problems.length && !browser.external.length, browser.problems.concat(browser.external));
  check('sheet has no axe violations at all', !browser.axe.length, browser.axe);
  check('radios work from the keyboard', browser.keyboardChoice === 'right', browser.keyboardChoice);
  check('export downloads the answers JSON', browser.exported.designer === 'Self Test Designer' && browser.exported.answers.length === 3 && browser.exported.answers.every(answer => answer.choice) && browser.exported.sheetId === key.sheetId && browser.textCopyMatches, browser.status);

  // A second, scripted designer who picks set A wherever the key says it is.
  const second = { designer: 'Second Designer', sheetId: key.sheetId, answers: key.pairs.map(pair => ({ pair: pair.pair, choice: pair.left === 'A' ? 'left' : 'right', comment: '' })) };
  const secondFile = path.join(root, 'downloads', 'answers-second.json');
  writeJson(secondFile, second);
  const score = scoreSheetFiles({ answerFiles: [browser.exportFile, secondFile], keyFile: sheet.keyFile, log: quiet });
  const firstA = browser.exported.answers.filter(answer => key.pairs.find(pair => pair.pair === answer.pair)[answer.choice] === 'A').length;
  check('sheet scoring maps answers back through the key', score.aVotes === firstA + 3 && score.votes === 6 && score.designers === 2, { aVotes: score.aVotes, votes: score.votes, share: score.shareAllVotes, pass: score.pass });
  let mismatch = null;
  try { scoreSheet({ answers: [{ ...second, sheetId: 'other' }], key }); } catch (error) { mismatch = error.message; }
  check('answers from another sheet are refused', /belong to sheet/.test(mismatch ?? ''));

  const failed = checks.filter(item => !item.ok);
  writeJson(path.join(root, 'selftest.json'), { at: new Date().toISOString(), passed: checks.length - failed.length, failed: failed.length, checks, dryEstimate: dry.estimate });
  log(`\nSelf-test: ${checks.length - failed.length}/${checks.length} checks passed. Outputs in ${rel(root)}`);
  return { ok: !failed.length, checks };
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const flags = new Set(['live', 'sanity', 'sheet', 'selftest', 'allow-partial', 'help']);
  const args = { 'score-sheet': [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument ${token}`);
    const [name, inline] = token.slice(2).split(/=(.*)/s);
    if (name === 'score-sheet') {
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) args['score-sheet'].push(argv[++i]);
    } else if (flags.has(name)) args[name] = true;
    else args[name] = inline ?? argv[++i];
  }
  return args;
}

const USAGE = `Usage:
  node scripts/eval/judge.mjs --a <setA> --b <setB> [--pairs pairs.json] [--sanity] [--round <id>]   (dry run)
  node scripts/eval/judge.mjs ... --live --approval "<who, when>" [--concurrency 2] [--allow-partial]
  node scripts/eval/judge.mjs --sheet --a <setA> --b <setB> [--n 10] [--seed 20261018]
  node scripts/eval/judge.mjs --score-sheet <answers.json ...> --key <sheet-key.json>
  node scripts/eval/judge.mjs --selftest
Pairing: briefId, then relatedBriefId, or --pairs [{"a": "<item id in A>", "b": "<item id in B>"}]; exit 2 when nothing pairs.
Live needs EVAL_JUDGE_MODEL, EVAL_JUDGE_USD_PER_MTOK_IN, EVAL_JUDGE_USD_PER_MTOK_OUT, OPENAI_API_KEY.
Optional: EVAL_JUDGE_IMAGE_TOKENS (1600), EVAL_JUDGE_MAX_OUTPUT_TOKENS (4000), EVAL_JUDGE_EXPECTED_OUTPUT_TOKENS (1500),
EVAL_JUDGE_REASONING_EFFORT, EVAL_JUDGE_TEMPERATURE.`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(USAGE); return; }
  if (args.selftest) { const { ok } = await selftest(); process.exitCode = ok ? 0 : 1; return; }
  if (args['score-sheet'].length) {
    assert(args.key, '--score-sheet needs --key <sheet-key.json>');
    scoreSheetFiles({ answerFiles: args['score-sheet'], keyFile: args.key });
    return;
  }
  assert(args.a && args.b, USAGE);
  try {
    if (args.sheet) {
      await makeSheet({ a: args.a, b: args.b, aLabel: args['a-label'], bLabel: args['b-label'], pairsFile: args.pairs, n: integer(args.n, 10), seed: integer(args.seed, JUDGE_BAR.J1.seed), roundId: args.round });
      return;
    }
    const summary = await judgeRound({
      a: args.a, b: args.b, aLabel: args['a-label'], bLabel: args['b-label'], pairsFile: args.pairs,
      mode: args.live ? 'live' : 'dry', approval: args.approval, sanity: args.sanity,
      sanityShare: args['sanity-share'] ? Number(args['sanity-share']) : 0.1, sanityN: args['sanity-n'] ? integer(args['sanity-n'], 1) : null,
      roundId: args.round, concurrency: integer(args.concurrency, 2), allowPartial: args['allow-partial'],
    });
    if (summary.mode === 'dry') console.log(JSON.stringify(summary.estimate, null, 2));
    if (summary.stopped) process.exitCode = 2;
  } catch (error) {
    if (error instanceof CapReached) { console.error(`Stopped: ${error.message}`); process.exitCode = 2; return; }
    if (error instanceof PairingError) { console.error(error.message); process.exitCode = 2; return; }
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack ?? error.message); process.exitCode = 1; });
}
