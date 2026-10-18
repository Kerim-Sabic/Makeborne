// The human designer sheet (QUALITY_BAR J3) and the screenshot encoder that
// the model judge (judge.mjs) shares with it.
//
// The sheet is one self-contained HTML file: screenshots are embedded as JPEG
// data URIs, there are no external requests, and the Left/Right assignment of
// every pair comes from the seeded rng. The key that maps Left/Right back to
// set A/B lives only in sheet-key.json, never in the HTML.
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { ensureDir, writeJson, rel } from './paths.mjs';
import { rng } from './stats.mjs';
import { HEIGHTS, JUDGE as JUDGE_BAR } from './thresholds.mjs';

export const sha256 = data => createHash('sha256').update(data).digest('hex');

/**
 * Encode one screenshot as JPEG for a judge or a human.
 * - `cropCss` keeps the first N CSS px of height (first screens: the viewport
 *   height; full pages: a fixed crop), scaled by the shot's device pixel ratio
 *   (shot width / cssWidth).
 * - The result fits inside `maxWidth` x `maxEdge` and is never enlarged.
 * Re-encoding drops all metadata (PNG text chunks can carry tool names).
 */
export async function encodeShot(file, { cssWidth, cropCss = null, maxEdge = 1536, maxWidth = maxEdge, quality = 80, columns = false } = {}) {
  const meta = await sharp(file, { limitInputPixels: false }).metadata();
  const scale = cssWidth ? meta.width / cssWidth : 1;
  const keep = cropCss ? Math.min(meta.height, Math.round(cropCss * scale)) : meta.height;
  const cropped = keep < meta.height;
  const layout = columns ? columnLayout(meta.width, keep, maxEdge) : { count: 1 };
  let pipeline;
  if (layout.count > 1) {
    pipeline = sharp(await columnSheet(file, meta.width, keep, layout)).resize({ width: maxWidth, height: maxEdge, fit: 'inside', withoutEnlargement: true });
  } else {
    pipeline = sharp(file, { limitInputPixels: false });
    // extract() before resize() crops the source, not the resized image.
    if (cropped) pipeline = pipeline.extract({ left: 0, top: 0, width: meta.width, height: keep });
    pipeline = pipeline.resize({ width: maxWidth, height: maxEdge, fit: 'inside', withoutEnlargement: true });
  }
  const { data, info } = await pipeline
    .flatten({ background: '#ffffff' })
    .jpeg({ quality })
    .toBuffer({ resolveWithObject: true });
  return {
    buffer: data,
    sha256: sha256(data),
    bytes: data.length,
    width: info.width,
    height: info.height,
    cropped,
    cropCss: cropped ? cropCss : null,
    columns: layout.count,
    pageCssHeight: Math.round(meta.height / scale),
    // Effective scale of page pixels in the sent image (1 = native resolution).
    sentScale: Math.round((info.width / (layout.count * meta.width + (layout.count - 1) * COLUMN_GAP)) * 1000) / 1000,
    source: { width: meta.width, height: meta.height, scale: Math.round(scale * 1000) / 1000 },
  };
}

const COLUMN_GAP = 24;
const MAX_COLUMNS = 4;

/**
 * A tall, narrow page downscaled to a 1536 px long edge becomes unreadable
 * (390 x 4000 -> 150 x 1536). Cutting it into side-by-side columns keeps it
 * near native resolution under the same edge limit. Picks the column count
 * (1-4) with the largest resulting scale; ties go to fewer columns.
 */
export function columnLayout(width, height, maxEdge) {
  let best = { count: 1, scale: Math.min(1, maxEdge / Math.max(width, height)) };
  for (let count = 2; count <= MAX_COLUMNS; count++) {
    const segment = Math.ceil(height / count);
    const canvas = { width: count * width + (count - 1) * COLUMN_GAP, height: segment };
    const scale = Math.min(1, maxEdge / Math.max(canvas.width, canvas.height));
    if (scale > best.scale + 1e-6) best = { count, scale, segment, canvas };
  }
  return best;
}

async function columnSheet(file, width, keep, layout) {
  const parts = [];
  for (let index = 0; index < layout.count; index++) {
    const top = index * layout.segment;
    const height = Math.min(layout.segment, keep - top);
    if (height <= 0) break;
    parts.push({ input: await sharp(file, { limitInputPixels: false }).extract({ left: 0, top, width, height }).png().toBuffer(), left: index * (width + COLUMN_GAP), top: 0 });
  }
  // A mid-grey gutter separates the columns so they never read as one wide layout.
  return sharp({ create: { width: layout.canvas.width, height: layout.canvas.height, channels: 3, background: '#7a7a7a' } }).composite(parts).png().toBuffer();
}

// What the sheet shows per side. Full pages are cropped longer than the model
// sees (humans can scroll) but still bounded so ten pairs stay a few MB.
const SHEET_VIEWS = Object.freeze([
  { id: 'desktop-first', shot: '1440-first.png', cssWidth: 1440, cropCss: HEIGHTS[1440], maxWidth: 1200, label: 'Desktop, first screen' },
  { id: 'desktop-full', shot: '1440-full.png', cssWidth: 1440, cropCss: 6000, maxWidth: 480, label: 'Desktop, full page' },
  { id: 'mobile-full', shot: '390-full.png', cssWidth: 390, cropCss: 6000, maxWidth: 360, label: 'Mobile, full page' },
]);
const SHEET_QUALITY = 72;
const CHOICES = Object.freeze([
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'undecided', label: "Can't decide" },
]);
const CRITERIA_REMINDER = Object.freeze([
  'Fit to the brief and how specific the content is',
  'Visual craft: typography, hierarchy, spacing, alignment',
  'Distinctiveness: would it pass for a template or a generic AI site?',
  'Clarity of the main action and usability',
  'Mobile composition',
  'Would the client sign it off as delivered, without changes?',
]);

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function shuffled(list, random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function sideImages(item) {
  const images = [];
  for (const view of SHEET_VIEWS) {
    const encoded = await encodeShot(item.shots[view.shot], { cssWidth: view.cssWidth, cropCss: view.cropCss, maxWidth: view.maxWidth, maxEdge: 20_000, quality: SHEET_QUALITY });
    images.push({ view, encoded, uri: `data:image/jpeg;base64,${encoded.buffer.toString('base64')}` });
  }
  return images;
}

function sideHtml(number, side, images) {
  const [first, ...full] = images;
  // Region labels carry the pair number: landmark names must be unique on the page.
  const name = `Pair ${number}, ${side} site`;
  const frame = ({ view, encoded, uri }) => `
          <figure class="frame-figure">
            <figcaption>${escapeHtml(view.label)}${encoded.cropped ? ` <span class="muted">(first ${encoded.cropCss} px)</span>` : ''}</figcaption>
            <div class="frame" tabindex="0" role="region" aria-label="${escapeHtml(`${name}, ${view.label.toLowerCase()}, scrollable`)}">
              <img src="${uri}" width="${encoded.width}" height="${encoded.height}" alt="${escapeHtml(`${name}, ${view.label.toLowerCase()}`)}" decoding="async">
            </div>
          </figure>`;
  return `
      <section class="side" aria-label="${escapeHtml(name)}">
        <h3>${side}</h3>
        <figure>
          <img class="first" src="${first.uri}" width="${first.encoded.width}" height="${first.encoded.height}" alt="${escapeHtml(`${name}, ${first.view.label.toLowerCase()}`)}" decoding="async">
          <figcaption>${escapeHtml(first.view.label)}</figcaption>
        </figure>
        <div class="frames">${full.map(frame).join('')}
        </div>
      </section>`;
}

function pairHtml(entry, total) {
  const { number, brief, left, right } = entry;
  const radios = CHOICES.map(choice => `
          <label class="choice"><input type="radio" name="choice-${number}" value="${choice.value}"> ${escapeHtml(choice.label)}</label>`).join('');
  return `
    <article class="pair" id="pair-${number}" aria-labelledby="pair-${number}-title">
      <h2 id="pair-${number}-title">Pair ${number} of ${total}</h2>
      <div class="brief">
        <h3>The brief</h3>
        <p>${escapeHtml(brief)}</p>
      </div>
      <div class="sides">${sideHtml(number, 'Left', left)}${sideHtml(number, 'Right', right)}
      </div>
      <div class="answer">
        <fieldset>
          <legend>Which site would you deliver to this client as it is?</legend>${radios}
        </fieldset>
        <label class="comment" for="comment-${number}">Comment (optional)</label>
        <textarea id="comment-${number}" rows="2"></textarea>
      </div>
    </article>`;
}

// Runs in the designer's browser. Plain ES2017, no external resources.
const SHEET_SCRIPT = String.raw`
(function () {
  var sheet = JSON.parse(document.getElementById('sheet-data').textContent);
  var storageKey = 'judge-sheet-' + sheet.sheetId;
  var nameInput = document.getElementById('designer');
  var status = document.getElementById('export-status');
  var progress = document.getElementById('progress');
  var output = document.getElementById('export-json');

  function choiceOf(pair) {
    var checked = document.querySelector('input[name="choice-' + pair + '"]:checked');
    return checked ? checked.value : null;
  }
  function collect() {
    return {
      sheetId: sheet.sheetId,
      designer: nameInput.value.trim(),
      exportedAt: new Date().toISOString(),
      answers: sheet.pairs.map(function (pair) {
        return { pair: pair, choice: choiceOf(pair), comment: document.getElementById('comment-' + pair).value.trim() };
      })
    };
  }
  function updateProgress() {
    var answered = sheet.pairs.filter(function (pair) { return choiceOf(pair) !== null; }).length;
    progress.textContent = 'Answered ' + answered + ' of ' + sheet.pairs.length;
    return answered;
  }
  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(collect())); } catch (error) { /* storage unavailable: answers stay on the page */ }
  }
  function restore() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch (error) { saved = null; }
    if (!saved || saved.sheetId !== sheet.sheetId) return;
    nameInput.value = saved.designer || '';
    (saved.answers || []).forEach(function (answer) {
      if (answer.choice) {
        var input = document.querySelector('input[name="choice-' + answer.pair + '"][value="' + answer.choice + '"]');
        if (input) input.checked = true;
      }
      var comment = document.getElementById('comment-' + answer.pair);
      if (comment) comment.value = answer.comment || '';
    });
  }
  function exportAnswers() {
    var data = collect();
    if (!data.designer) {
      status.textContent = 'Please enter your name first.';
      nameInput.focus();
      return;
    }
    var answered = updateProgress();
    var json = JSON.stringify(data, null, 2);
    output.value = json;
    var slug = data.designer.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'designer';
    var link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    link.download = 'answers-' + slug + '-' + sheet.sheetId + '.json';
    document.body.appendChild(link);
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); link.remove(); }, 1000);
    var missing = sheet.pairs.length - answered;
    var message = 'Answers downloaded as ' + link.download + '.' + (missing ? ' ' + missing + ' pair(s) are still unanswered.' : '');
    status.textContent = message;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json).then(function () {
        status.textContent = message + ' Also copied to the clipboard.';
      }, function () { /* clipboard refused (file page or permissions): the text box below has the same JSON */ });
    }
  }

  restore();
  updateProgress();
  document.addEventListener('change', function () { updateProgress(); save(); });
  document.addEventListener('input', save);
  document.getElementById('export').addEventListener('click', exportAnswers);
})();
`;

const SHEET_CSS = `
:root { color-scheme: light; --ink: #1b1b1b; --muted: #545454; --line: #d4d4d4; --paper: #ffffff; --wash: #f4f4f2; --accent: #0b57d0; --focus: #b3261e; }
* { box-sizing: border-box; }
html { scroll-padding-bottom: 140px; }
body { margin: 0; background: var(--wash); color: var(--ink); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
a { color: var(--accent); }
.skip { position: absolute; left: 1rem; top: -3rem; background: var(--paper); padding: .5rem 1rem; z-index: 2; }
.skip:focus { top: 1rem; }
header, main, footer { max-width: 1400px; margin: 0 auto; padding: 0 16px; }
header { padding-top: 24px; }
h1 { font-size: 1.75rem; margin: 0 0 .5rem; }
h2 { font-size: 1.35rem; margin: 0 0 .75rem; }
h3 { font-size: 1.05rem; margin: 0 0 .5rem; }
.intro { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: 16px 20px; margin-bottom: 24px; }
.intro ul { margin: .25rem 0 .75rem; padding-left: 1.25rem; }
.muted { color: var(--muted); }
.designer label { font-weight: 600; display: block; margin-bottom: .25rem; }
.designer input { font: inherit; padding: .45rem .6rem; border: 1px solid #767676; border-radius: 6px; width: min(100%, 360px); }
.pair { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: 20px; margin-bottom: 28px; }
.brief { background: var(--wash); border-radius: 6px; padding: 12px 16px; margin-bottom: 16px; }
.brief p { margin: 0; white-space: pre-wrap; max-width: 90ch; }
.sides { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.side { min-width: 0; }
figure { margin: 0 0 12px; }
figcaption { font-size: .875rem; color: var(--muted); margin-top: .25rem; }
img { display: block; max-width: 100%; height: auto; }
.first { border: 1px solid var(--line); width: 100%; }
.frames { display: grid; grid-template-columns: 4fr 3fr; gap: 12px; align-items: start; }
.frame-figure figcaption { margin: 0 0 .25rem; }
.frame { max-height: 70vh; overflow-y: auto; border: 1px solid var(--line); background: var(--wash); }
.frame img { width: 100%; }
.answer { margin-top: 12px; border-top: 1px solid var(--line); padding-top: 12px; }
fieldset { border: 0; padding: 0; margin: 0 0 .75rem; display: flex; flex-wrap: wrap; gap: .5rem 1.5rem; align-items: center; }
legend { font-weight: 600; padding: 0; margin-bottom: .5rem; width: 100%; }
.choice { display: inline-flex; gap: .4rem; align-items: center; padding: .35rem .2rem; cursor: pointer; }
.choice input { width: 1.1rem; height: 1.1rem; margin: 0; }
.comment { display: block; font-weight: 600; margin-bottom: .25rem; }
textarea { font: inherit; width: 100%; max-width: 70ch; padding: .45rem .6rem; border: 1px solid #767676; border-radius: 6px; }
footer { position: sticky; bottom: 0; background: var(--paper); border-top: 1px solid var(--line); padding-top: 12px; padding-bottom: 12px; display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: center; max-width: none; }
button { font: inherit; font-weight: 600; background: var(--accent); color: #fff; border: 0; border-radius: 6px; padding: .6rem 1.2rem; cursor: pointer; }
button:hover { background: #0842a0; }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
details { width: 100%; }
details textarea { margin-top: .5rem; font-family: ui-monospace, Consolas, monospace; font-size: .8rem; }
@media (max-width: 900px) { .sides { grid-template-columns: 1fr; } }
`;

function sheetHtml({ sheetId, entries }) {
  const data = JSON.stringify({ sheetId, pairs: entries.map(entry => entry.number) }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Website comparison sheet</title>
<style>${SHEET_CSS}</style>
</head>
<body>
<a class="skip" href="#pair-1">Skip to the first pair</a>
<header>
  <h1>Website comparison sheet</h1>
  <div class="intro">
    <p>Each pair shows two websites made for the same written brief, labelled Left and Right. The labels are random and say nothing about who made them. For each pair, pick the site you would deliver to this client as it is. Weigh the whole deliverable:</p>
    <ul>
${CRITERIA_REMINDER.map(line => `      <li>${escapeHtml(line)}</li>`).join('\n')}
    </ul>
    <p class="muted">Ignore cookie banners and loading states. A longer page is not better by itself. Full-page views scroll inside their frames and show at most the first 6000 px. Your answers are kept in this browser until you export them.</p>
    <div class="designer">
      <label for="designer">Your name</label>
      <input id="designer" type="text" autocomplete="name" required>
    </div>
  </div>
</header>
<main>
${entries.map(entry => pairHtml(entry, entries.length)).join('\n')}
</main>
<footer>
  <button type="button" id="export">Export answers</button>
  <span id="progress" aria-live="polite"></span>
  <span id="export-status" role="status" aria-live="polite"></span>
  <details>
    <summary>Show exported answers as text</summary>
    <label class="comment" for="export-json">Exported answers (copy this if the download did not work)</label>
    <textarea id="export-json" rows="6" readonly></textarea>
  </details>
</footer>
<script type="application/json" id="sheet-data">${data}</script>
<script>${SHEET_SCRIPT}</script>
</body>
</html>
`;
}

/**
 * Build the designer sheet.
 * @param {object} options
 * @param {Array<{pair:string, briefId:string|null, relatedBriefId?:string|null, pairedBy?:string, brief:string, a:{itemId:string, shots:object}, b:{itemId:string, shots:object}}>} options.pairs
 *   paired items as returned by judge.mjs pairSets() (which refuses an empty pairing with a
 *   PairingError before this is called); shots maps file name -> absolute path.
 * @param {number} [options.n=10] at most this many pairs (seeded sample when there are more)
 * @param {number} [options.seed=20261018]
 * @param {string} options.outDir where sheet.html and sheet-key.json are written
 * @param {{a:object, b:object}} [options.sets] labels/dirs of set A and B, recorded in the key only
 * @returns {Promise<{sheetFile:string, keyFile:string, sheetId:string, pairs:number, bytes:number}>}
 */
export async function buildSheet({ pairs, n = 10, seed = JUDGE_BAR.J1.seed, outDir, sets = {} }) {
  if (!pairs.length) throw new Error('No pairs to put on the sheet');
  const random = rng(seed);
  const chosen = shuffled(pairs, random).slice(0, Math.min(n, pairs.length));
  const sheetId = randomBytes(6).toString('hex');
  const entries = [];
  const keyPairs = [];
  for (const [index, pair] of chosen.entries()) {
    const number = index + 1;
    const leftIsA = random() < 0.5;
    const [left, right] = leftIsA ? [pair.a, pair.b] : [pair.b, pair.a];
    entries.push({ number, brief: pair.brief, left: await sideImages(left), right: await sideImages(right) });
    keyPairs.push({ pair: number, judgePair: pair.pair, briefId: pair.briefId, relatedBriefId: pair.relatedBriefId ?? null, pairedBy: pair.pairedBy ?? null, left: leftIsA ? 'A' : 'B', right: leftIsA ? 'B' : 'A', aItem: pair.a.itemId, bItem: pair.b.itemId });
  }
  const html = sheetHtml({ sheetId, entries });
  ensureDir(outDir);
  const sheetFile = path.join(outDir, 'sheet.html');
  const keyFile = path.join(outDir, 'sheet-key.json');
  writeFileSync(sheetFile, html);
  writeJson(keyFile, {
    sheetId,
    createdAt: new Date().toISOString(),
    seed,
    note: 'Never share this file with designers. It maps Left/Right on sheet.html back to set A/B.',
    sets: Object.fromEntries(Object.entries(sets).map(([side, set]) => [side, { label: set.label, dir: set.dir ? rel(set.dir) : null }])),
    pairs: keyPairs,
  });
  return { sheetFile, keyFile, sheetId, pairs: entries.length, bytes: Buffer.byteLength(html) };
}

/**
 * Score exported designer answers against the key (J3).
 * @param {object} options
 * @param {Array<{designer:string, sheetId?:string, answers:Array<{pair:number, choice:'left'|'right'|'undecided'|null, comment?:string}>}>} options.answers
 * @param {object} options.key parsed sheet-key.json
 * @returns {{sheetId, designers, votes, aVotes, bVotes, undecided, missing, shareAllVotes, shareDecisive, designersPreferringA, designerMajority, minShare, pass, perDesigner, perPair, comments}}
 */
export function scoreSheet({ answers, key }) {
  const byNumber = new Map(key.pairs.map(pair => [pair.pair, pair]));
  const perDesigner = [];
  const perPair = new Map(key.pairs.map(pair => [pair.pair, { pair: pair.pair, briefId: pair.briefId, A: 0, B: 0, undecided: 0, missing: 0 }]));
  const comments = [];
  const seen = new Map();
  for (const doc of answers) {
    if (doc.sheetId && doc.sheetId !== key.sheetId) throw new Error(`Answers from ${doc.designer || 'unknown'} belong to sheet ${doc.sheetId}, not ${key.sheetId}`);
    const designer = String(doc.designer ?? '').trim() || `anonymous-${perDesigner.length + 1}`;
    seen.set(designer.toLowerCase(), (seen.get(designer.toLowerCase()) ?? 0) + 1);
    const tally = { designer, A: 0, B: 0, undecided: 0, missing: 0 };
    const given = new Map((doc.answers ?? []).map(answer => [Number(answer.pair), answer]));
    for (const [number, keyPair] of byNumber) {
      const answer = given.get(number);
      const choice = answer?.choice ?? null;
      let vote;
      if (choice === 'left') vote = keyPair.left;
      else if (choice === 'right') vote = keyPair.right;
      else if (choice === 'undecided') vote = 'undecided';
      else if (choice === null) vote = 'missing';
      else throw new Error(`Unknown choice "${choice}" from ${designer} for pair ${number}`);
      tally[vote] += 1;
      perPair.get(number)[vote] += 1;
      if (answer?.comment) comments.push({ designer, pair: number, briefId: keyPair.briefId, vote, comment: answer.comment });
    }
    perDesigner.push({ ...tally, prefersA: tally.A > tally.B });
  }
  const sum = field => perDesigner.reduce((total, row) => total + row[field], 0);
  const aVotes = sum('A');
  const bVotes = sum('B');
  const undecided = sum('undecided');
  const votes = aVotes + bVotes + undecided;
  const designersPreferringA = perDesigner.filter(row => row.prefersA).length;
  const shareAllVotes = votes ? aVotes / votes : null;
  const designerMajority = designersPreferringA > perDesigner.length / 2;
  return {
    sheetId: key.sheetId,
    designers: perDesigner.length,
    duplicateDesigners: [...seen].filter(([, count]) => count > 1).map(([name]) => name),
    votes, aVotes, bVotes, undecided,
    missing: sum('missing'),
    // QUALITY_BAR J3: "preferred in >= 60% of all votes" counts "can't decide" as not preferred.
    shareAllVotes,
    shareDecisive: aVotes + bVotes ? aVotes / (aVotes + bVotes) : null,
    designersPreferringA,
    designerMajority,
    minShare: JUDGE_BAR.J3.minShare,
    pass: shareAllVotes !== null && shareAllVotes >= JUDGE_BAR.J3.minShare && designerMajority,
    perDesigner,
    perPair: [...perPair.values()],
    comments,
  };
}
