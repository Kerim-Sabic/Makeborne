#!/usr/bin/env node
// Measure orchestrator: every instrument over one set, per-item metrics.json
// with every QUALITY_BAR key, then diversity.json and summary.{json,md}.
//
//   node scripts/eval/measure.mjs <setDir> [--out outputs/eval/measure/<setId>]
//     [--widths 360,390,820,1440] [--lighthouse-runs 1] [--skip lighthouse,htmlvalidate,typecheck,vitals]
//     [--only <itemId,...>] [--kind website|presentation|book] [--concurrency 2]
//     [--lighthouse-live] [--timeout-scale 1]
//
// <setDir> is a run (outputs/eval/runs/<runId>/ with one folder per item) or a
// competitor capture folder (scripts/eval/competitors/captures/<tool>/ with
// <briefId>/{meta.json,page.har,dom.html}).
//
// Per Makeborne website: materializeWebsite (compile W1, type-check W2,
// snapshot) → serve published/ (what a visitor loads) → one load at 1440 for
// the weight (W12, from the server's request log) → measurePage (W6, W7,
// W9, W10, W13–W17, identity) → html-validate on snapshot/index.html (W11).
// Lighthouse (W3, W4, W5, W8) runs afterwards, one page at a time, with
// nothing else running, so lab scores are not skewed by the other workers.
// Per competitor: the HAR is replayed offline (routeFromHAR, notFound abort)
// at meta.finalUrl; W1/W2 are n/a; Lighthouse only with --lighthouse-live
// against meta.url (network-dependent, flagged). Per deck/book: measureDeck /
// measureBook on document.json and exports/.
//
// Rules: an instrument that cannot run is recorded as 'n/a' with its reason,
// never skipped silently; a website that does not compile fails W1 and its
// dependent instruments are not measurable (a version that does not build
// cannot be published). One item failing never stops the set. No provider
// calls, no network for Makeborne items (non-loopback requests are aborted).
import path from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { MEASURE, BRIEFS_DIR, ensureDir, readJson, writeJson, rel } from './lib/paths.mjs';
import { WEBSITE, DOCUMENTS, WIDTHS, HEIGHTS, QUALITY_BAR_VERSION } from './lib/thresholds.mjs';
import { materializeWebsite, serveWebsite } from './lib/website.mjs';
import { measurePage } from './lib/instruments/web.mjs';
import { runLighthouse } from './lib/instruments/lighthouse.mjs';
import { validateHtml } from './lib/instruments/htmlvalidate.mjs';
import { measureDeck } from './lib/instruments/deck.mjs';
import { measureBook } from './lib/instruments/book.mjs';
import { measureDiversity } from './lib/diversity.mjs';
import { buildSummary, writeSummary, harnessProvenance, chromiumVersion } from './lib/summary.mjs';

const SKIPPABLE = ['lighthouse', 'htmlvalidate', 'typecheck', 'vitals'];
const KINDS = ['website', 'presentation', 'book'];
// Per-instrument wall-clock limits (ms), multiplied by --timeout-scale.
const TIMEOUTS = Object.freeze({ materialize: 180_000, weight: 90_000, page: 900_000, htmlvalidate: 60_000, lighthouseRun: 180_000, deck: 300_000, book: 300_000 });
const KiB = 1024;

const elapsed = since => Math.round(performance.now() - since);
const round = (value, digits = 3) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : value ?? null);
const clip = (text, length = 300) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, length);
const loopback = url => /^(?:data|blob|about):/.test(url) || ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);
const safeId = id => String(id).replace(/[^\w.-]+/g, '-').slice(0, 120);

// ---------------------------------------------------------------------------
// CLI

export function parseCli(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true, strict: true,
    options: {
      out: { type: 'string' }, widths: { type: 'string' }, 'lighthouse-runs': { type: 'string' }, skip: { type: 'string' },
      only: { type: 'string' }, kind: { type: 'string' }, concurrency: { type: 'string' }, 'lighthouse-live': { type: 'boolean' },
      'timeout-scale': { type: 'string' }, help: { type: 'boolean' },
    },
  });
  if (values.help || positionals.length !== 1) return { help: true, asked: Boolean(values.help) };
  const list = value => (value ? value.split(',').map(entry => entry.trim()).filter(Boolean) : []);
  const widths = values.widths ? list(values.widths).map(Number) : [...WIDTHS];
  if (!widths.length || widths.some(width => !Number.isInteger(width) || width < 200 || width > 3000)) throw new Error(`--widths must be integers between 200 and 3000, got "${values.widths}"`);
  const skip = list(values.skip);
  const unknown = skip.filter(name => !SKIPPABLE.includes(name));
  if (unknown.length) throw new Error(`--skip accepts ${SKIPPABLE.join(', ')}; unknown: ${unknown.join(', ')}`);
  if (values.kind && !KINDS.includes(values.kind)) throw new Error(`--kind must be one of ${KINDS.join(', ')}`);
  const positive = (value, name, fallback) => {
    if (value === undefined) return fallback;
    const number = Number(value);
    if (!(number > 0)) throw new Error(`--${name} must be a positive number`);
    return number;
  };
  return {
    setDir: path.resolve(positionals[0]),
    out: values.out ? path.resolve(values.out) : null,
    widths, skip, only: list(values.only), kind: values.kind ?? null,
    lighthouseRuns: Math.round(positive(values['lighthouse-runs'], 'lighthouse-runs', 1)),
    concurrency: Math.round(positive(values.concurrency, 'concurrency', 2)),
    lighthouseLive: Boolean(values['lighthouse-live']),
    timeoutScale: positive(values['timeout-scale'], 'timeout-scale', 1),
  };
}

// ---------------------------------------------------------------------------
// Set discovery

const usageError = message => Object.assign(new Error(message), { usage: true });

const subdirs = dir => readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => path.join(dir, entry.name));
const tryJson = file => { try { return existsSync(file) ? readJson(file) : null; } catch { return null; } };

function frozenBrief(briefId) {
  return briefId ? tryJson(path.join(BRIEFS_DIR, `${briefId}.json`)) : null;
}

/**
 * Describe the set: { type: 'run'|'capture', setId, dir, items: [descriptor], missing: [id] }.
 * A descriptor carries everything measure needs from disk and nothing measured.
 */
export function discoverSet(setDir) {
  if (!existsSync(setDir) || !statSync(setDir).isDirectory()) throw usageError(`Set folder not found: ${setDir}`);
  const dirs = subdirs(setDir);
  const captures = dirs.filter(dir => existsSync(path.join(dir, 'meta.json')));
  if (captures.length && !dirs.some(dir => existsSync(path.join(dir, 'item.json')))) {
    const tool = path.basename(setDir);
    const items = captures.map(dir => {
      const meta = readJson(path.join(dir, 'meta.json'));
      const briefId = meta.briefId ?? path.basename(dir);
      const brief = frozenBrief(briefId);
      return {
        id: briefId, kind: 'website', title: meta.title ?? brief?.title ?? briefId, direction: brief?.direction ?? null, briefId, relatedBriefId: null,
        brief: brief?.brief ?? null, itemDir: dir, competitor: true, meta,
        item: { id: briefId, kind: 'website', title: meta.title ?? brief?.title ?? null, direction: brief?.direction ?? null, briefId, brief: brief?.brief ?? null, origin: { type: 'competitor', tool, url: meta.url, finalUrl: meta.finalUrl, capturedAt: meta.capturedAt, captureStatus: meta.status } },
        status: meta.status === 'failed' ? { ok: false, code: 'CAPTURE_FAILED', message: meta.error ?? 'capture failed' } : { ok: true, message: meta.status === 'suspect' ? `capture marked suspect: ${(meta.notes ?? []).join('; ')}` : null },
      };
    });
    return { type: 'capture', setId: `competitor-${tool}`, tool, dir: setDir, items, missing: [] };
  }
  const run = tryJson(path.join(setDir, 'run.json'));
  const withItem = dirs.filter(dir => existsSync(path.join(dir, 'item.json')));
  if (!withItem.length) throw usageError(`No items in ${rel(setDir)}: expected <itemId>/item.json (run) or <briefId>/meta.json (competitor capture)`);
  const order = (run?.items ?? []).map(entry => entry.id);
  const items = withItem.map(dir => {
    const item = readJson(path.join(dir, 'item.json'));
    return {
      id: item.id ?? path.basename(dir), kind: item.kind, title: item.title ?? null, direction: item.direction ?? null, briefId: item.briefId ?? null,
      relatedBriefId: item.relatedBriefId ?? null, brief: item.brief ?? tryJson(path.join(dir, 'brief.json'))?.brief ?? frozenBrief(item.briefId)?.brief ?? null,
      itemDir: dir, competitor: false, item, status: tryJson(path.join(dir, 'status.json')) ?? { ok: true },
    };
  }).sort((p, q) => {
    const a = order.indexOf(p.id), b = order.indexOf(q.id);
    return (a < 0 ? Infinity : a) - (b < 0 ? Infinity : b) || p.id.localeCompare(q.id);
  });
  const present = new Set(items.map(item => item.id));
  return { type: 'run', setId: run?.runId ?? path.basename(setDir), runId: run?.runId ?? null, dir: setDir, items, missing: order.filter(id => !present.has(id)) };
}

// ---------------------------------------------------------------------------
// Timeouts and browsers

class TimeoutError extends Error {
  constructor(label, ms) { super(`${label} timed out after ${Math.round(ms / 1000)} s`); this.timedOut = true; }
}

// Local socket failures that say nothing about the page (Windows WSAENOBUFS
// shows up as net::ERR_NO_BUFFER_SPACE when ephemeral ports run short).
const TRANSIENT_NET = /net::ERR_(?:NO_BUFFER_SPACE|ADDRESS_IN_USE|CONNECTION_RESET|CONNECTION_REFUSED|SOCKET_NOT_CONNECTED|EMPTY_RESPONSE)\b/;

/** Re-run a timed() step once, after 2 s, when it failed on a transient local socket error; the first error is kept. */
async function retryTransient(run) {
  const first = await run();
  if (first.ok || !TRANSIENT_NET.test(first.error ?? '')) return first;
  await new Promise(resolve => setTimeout(resolve, 2000));
  const second = await run();
  return { ...second, retried: { after: first.error } };
}

/** Run fn with a wall-clock limit; never throws. → { ok, value, error, timedOut, ms } */
async function timed(label, ms, fn, { onTimeout } = {}) {
  const started = performance.now();
  let timer;
  try {
    const value = await Promise.race([fn(), new Promise((_, reject) => { timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms); })]);
    return { ok: true, value, error: null, timedOut: false, ms: elapsed(started) };
  } catch (error) {
    if (error?.timedOut) await onTimeout?.();
    return { ok: false, value: null, error: clip(error?.message ?? error, 1000), timedOut: Boolean(error?.timedOut), ms: elapsed(started) };
  } finally {
    clearTimeout(timer);
  }
}

// materializeWebsite() may run on every worker at once: website.mjs warms the
// app's esbuild-wasm service with one solo build before any concurrent bundler
// call (the cold-start race that made one of two first compiles fail with
// 'The working directory "C:\..." is not an absolute path' is fixed there).

/** One Chromium per worker; a timed-out instrument closes it so nothing keeps running. */
class BrowserSlot {
  async get() {
    if (!this.browser?.isConnected()) this.browser = await chromium.launch({ headless: true });
    return this.browser;
  }
  async close() {
    const browser = this.browser;
    this.browser = null;
    await browser?.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Check and metric records (the contract summary.mjs reads)

/** Severity of a failure: distance from the threshold over a stated scale, kept in [0.1, 1]. */
const severity = value => Math.max(0.1, Math.min(1, Number.isFinite(value) ? value : 1));

/**
 * One check. `exercised: false` marks a pass that tested nothing (W14 on a
 * page with no <img>): it stays a pass, and its reason is shown. `setLevel`
 * marks a failure that is a product capability gap reported once per set
 * (summary.mjs: K2 "no wrap cover"), kept out of the per-item ranking.
 */
function part({ key = 'site', label, tier, set, value = null, threshold, pass, sev, reason = null, failureClass, exercised, setLevel }) {
  const verdict = pass === true || pass === false ? pass : null;
  return {
    key, label, tier, set, status: verdict === true ? 'pass' : verdict === false ? 'fail' : 'n/a', pass: verdict,
    value, threshold, severity: verdict === false ? round(severity(sev), 3) : 0, reason: reason ? clip(reason, 400) : null,
    ...(failureClass && verdict === false ? { failureClass } : {}),
    ...(exercised === false ? { exercised: false } : {}),
    ...(setLevel && verdict === false ? { setLevel } : {}),
  };
}

function record(id, parts, { value = null, detail, failureClass } = {}) {
  const def = WEBSITE[id] ?? DOCUMENTS[id];
  const status = parts.some(entry => entry.status === 'fail') ? 'fail' : parts.every(entry => entry.status === 'n/a') ? 'n/a' : 'pass';
  const lead = parts.find(entry => entry.status === 'fail') ?? parts.find(entry => entry.status === 'n/a') ?? parts.find(entry => entry.exercised === false);
  return {
    id, label: def.label, tier: def.tier, status, pass: status === 'n/a' ? null : status === 'pass',
    value: value ?? (parts.length === 1 ? parts[0].value : Object.fromEntries(parts.map(entry => [entry.key, entry.value]))),
    reason: lead?.reason ?? null, severity: Math.max(0, ...parts.map(entry => entry.severity)),
    ...(parts.some(entry => entry.exercised === false) ? { exercised: false } : {}),
    ...(failureClass ? { failureClass } : {}), parts, ...(detail ? { detail } : {}),
  };
}

/** The part template of every metric, so an unmeasured metric still lists its checks. */
const PARTS = {
  W1: [{ label: 'Compiles', tier: 'L', set: WEBSITE.W1.set, threshold: 'no bundler error' }],
  W2: [{ label: 'Type-checks', tier: 'F', set: WEBSITE.W2.set, threshold: '0 TypeScript errors' }],
  W3: [{ label: 'Lighthouse accessibility', tier: 'L', set: WEBSITE.W3.set, threshold: `≥ ${WEBSITE.W3.min}` }],
  W4: [{ key: 'launch', label: 'Lighthouse performance (launch)', tier: 'L', set: WEBSITE.W4.set, threshold: `≥ ${WEBSITE.W4.min}` },
    { key: 'claim', label: 'Lighthouse performance (claim)', tier: 'C', set: WEBSITE.W4.set, threshold: `≥ ${WEBSITE.W4.claimMin}` }],
  W5: [{ key: 'seo', label: 'Lighthouse SEO (platform-adjusted)', tier: 'F', set: WEBSITE.W5.set, threshold: `≥ ${WEBSITE.W5.min}` },
    { key: 'bestPractices', label: 'Lighthouse best practices', tier: 'F', set: WEBSITE.W5.set, threshold: `≥ ${WEBSITE.W5.min}` }],
  W6: [{ key: 'critical', label: 'axe critical', tier: 'L', set: WEBSITE.W6.setCritical, threshold: '0 nodes' },
    { key: 'serious', label: 'axe serious', tier: 'C', set: WEBSITE.W6.setSerious, threshold: '0 nodes' }],
  W7: [{ label: 'CLS (390, 1440; ≥ 3 loads per width × motion mode; load + full scroll)', tier: 'L', set: WEBSITE.W7.set, threshold: `< ${WEBSITE.W7.max} on every load` }],
  W8: [{ label: 'LCP (Lighthouse mobile lab)', tier: 'C', set: WEBSITE.W8.set, threshold: `≤ ${WEBSITE.W8.maxMs} ms` }],
  W9: [{ label: 'Horizontal overflow (user-reachable)', tier: 'L', set: WEBSITE.W9.set, threshold: '0 px a visitor can reach, 0 unclipped elements' }],
  W10: [{ label: 'Text contrast', tier: 'L', set: WEBSITE.W10.set, threshold: '0 failing nodes' }],
  W11: [{ label: 'Valid HTML', tier: 'F', set: WEBSITE.W11.set, threshold: '0 errors' }],
  W12: [{ key: 'total', label: 'Weight, first load', tier: 'F', set: WEBSITE.W12.set, threshold: `≤ ${WEBSITE.W12.maxTotalKiB} KiB` },
    { key: 'js', label: 'Weight, JavaScript', tier: 'F', set: WEBSITE.W12.set, threshold: `≤ ${WEBSITE.W12.maxJsKiB} KiB` }],
  W13: [{ label: 'Dead links', tier: 'L', set: WEBSITE.W13.set, threshold: '0' }],
  W14: [{ key: 'brokenAlt', label: 'Images broken / missing alt', tier: 'L', set: WEBSITE.W14.set, threshold: '0 broken, 0 missing alt' },
    { key: 'dims', label: 'Images without dimensions', tier: 'F', set: WEBSITE.W14.setDims, threshold: `≤ ${WEBSITE.W14.maxMissingDims}` }],
  W15: [{ label: 'Template tells', tier: 'C', set: WEBSITE.W15.set, threshold: `≤ ${WEBSITE.W15.maxTells} tell` }],
  W16: [{ label: 'First screen (390×844, 1440×900)', tier: 'C', set: WEBSITE.W16.set, threshold: 'h1, value line and primary action in view' }],
  W17: [{ label: 'Honest content', tier: 'L', set: WEBSITE.W17.set, threshold: '0 invented phone numbers or emails' }],
  P1: [{ label: 'PPTX editable text', tier: 'L', set: 1, threshold: `≥ ${DOCUMENTS.P1.min * 100}% (words and characters)` }],
  P2: [{ label: 'Native charts', tier: 'L', set: 1, threshold: '100%' }],
  P3: [{ label: 'Per-slide overflow', tier: 'L', set: 1, threshold: '0 slides' }],
  // P4 is recomputed from the saved document with today's composer (deck.mjs), not the warnings stored at save time.
  P4: [{ label: DOCUMENTS.P4.label, tier: 'C', set: 1, threshold: '0' }],
  P5: [{ label: 'Layout rotation', tier: 'C', set: 1, threshold: '0 runs of 3' }],
  P6: [{ label: DOCUMENTS.P6.label, tier: 'F', set: 1, threshold: `≥ ${DOCUMENTS.P6.min * 100}% of content slides` }],
  // K1 fails on a validator error (print.ts) or a harness error (book.mjs: cover in the interior, page-filling background without bleed, odd page count).
  K1: [{ label: DOCUMENTS.K1.label, tier: 'L', set: 1, threshold: '0 errors, validator + harness checks (cover not in the interior, no page-filling background without bleed, even page count, ≥ 24 pages)' }],
  K2: [{ label: 'KDP cover geometry', tier: 'L', set: 1, threshold: `wrap cover within ${DOCUMENTS.K2.toleranceIn} in` }],
  K3: [{ label: 'Book overflow', tier: 'L', set: 1, threshold: '0 pages' }],
};

/** Every part of a metric not measured, with the reason. */
function notMeasured(id, reason) {
  return record(id, PARTS[id].map(template => part({ ...template, pass: null, reason })));
}

/** Fill the template of metric `id` with verdicts: parts = { key: {pass, value, sev, reason, failureClass} }. */
function measured(id, verdicts, options) {
  return record(id, PARTS[id].map(template => part({ ...template, ...(verdicts[template.key ?? 'site'] ?? { pass: null, reason: 'not measured' }) })), options);
}

// ---------------------------------------------------------------------------
// Website scoring

const WEBSITE_IDS = Object.keys(WEBSITE);
// axe nodes inside the attribution badge composeSiteDocument() appends to published pages.
const isBadgeTarget = target => /makeborne\.com|data-makeborne-attribution/i.test(target);
const pageError = (page, key) => page?.[key]?.error ?? null;
/** True when every width × mode of a merged per-width result errored (nothing measured). */
const allErrored = byWidth => {
  const entries = Object.values(byWidth ?? {}).flatMap(modes => Object.entries(modes).filter(([mode]) => mode === 'reduce' || mode === 'no-preference').map(([, value]) => value));
  return !entries.length || entries.every(entry => entry?.error);
};
const firstError = byWidth => Object.values(byWidth ?? {}).flatMap(modes => Object.values(modes)).find(entry => entry?.error)?.error ?? null;

function lighthouseMetrics(raw) {
  const lh = raw.lighthouse;
  const blocked = raw.skip.includes('lighthouse') ? 'skipped (--skip lighthouse)'
    : raw.competitor && !raw.lighthouseLive ? 'competitor capture: Lighthouse needs --lighthouse-live (runs against the live URL, network-dependent)'
      : !lh ? (raw.pageBlocked ?? 'Lighthouse phase not reached')
        : lh.error ? `Lighthouse failed: ${lh.error}`
          : !lh.runs ? `Lighthouse produced no valid run: ${lh.runtimeErrors?.[0] ?? lh.errors?.[0] ?? 'unknown error'}` : null;
  if (blocked) return Object.fromEntries(['W3', 'W4', 'W5', 'W8'].map(id => [id, notMeasured(id, blocked)]));
  const m = lh.median;
  const tag = `${lh.runs} run${lh.runs === 1 ? '' : 's'}${lh.failedRuns?.length ? `, ${lh.failedRuns.length} failed run(s) discarded` : ''}${lh.exploratory ? ', exploratory' : ''}${lh.networkDependent ? ', live URL (network-dependent)' : ''}`;
  const has = value => Number.isFinite(value);
  const failingAudits = category => [...new Set(lh.all.flatMap(run => run.failingAudits.filter(audit => audit.startsWith(`${category}:`)).map(audit => audit.split(':')[1])))].slice(0, 6).join(', ');
  return {
    W3: measured('W3', { site: has(m.accessibility) ? { pass: m.accessibility >= WEBSITE.W3.min, value: m.accessibility, sev: (WEBSITE.W3.min - m.accessibility) / 20, reason: `${m.accessibility} (${tag}); failing audits: ${failingAudits('accessibility') || 'none'}` } : { pass: null, reason: 'no accessibility score' } }),
    W4: measured('W4', {
      launch: has(m.performance) ? { pass: m.performance >= WEBSITE.W4.min, value: m.performance, sev: (WEBSITE.W4.min - m.performance) / 30, reason: `${m.performance} (${tag}); LCP ${Math.round(m.lcpMs)} ms, TBT ${Math.round(m.tbtMs)} ms, CLS ${round(m.cls)}` } : { pass: null, reason: 'no performance score' },
      claim: has(m.performance) ? { pass: m.performance >= WEBSITE.W4.claimMin, value: m.performance, sev: (WEBSITE.W4.claimMin - m.performance) / 30, reason: `${m.performance} (${tag})` } : { pass: null, reason: 'no performance score' },
    }),
    W5: measured('W5', {
      seo: has(m.seoPlatformAdjusted) ? { pass: m.seoPlatformAdjusted >= WEBSITE.W5.min, value: m.seoPlatformAdjusted, sev: (WEBSITE.W5.min - m.seoPlatformAdjusted) / 30, reason: `${m.seoPlatformAdjusted} without title/description/canonical (raw ${m.seo}); failing: ${failingAudits('seo') || 'none'}` } : { pass: null, reason: 'no SEO score' },
      bestPractices: has(m.bestPractices) ? { pass: m.bestPractices >= WEBSITE.W5.min, value: m.bestPractices, sev: (WEBSITE.W5.min - m.bestPractices) / 30, reason: `${m.bestPractices}; failing: ${failingAudits('best-practices') || 'none'}` } : { pass: null, reason: 'no best-practices score' },
    }),
    W8: measured('W8', { site: has(m.lcpMs) ? { pass: m.lcpMs <= WEBSITE.W8.maxMs, value: Math.round(m.lcpMs), sev: (m.lcpMs - WEBSITE.W8.maxMs) / WEBSITE.W8.maxMs, reason: `${Math.round(m.lcpMs)} ms (${tag})` } : { pass: null, reason: 'no LCP' } }),
  };
}

function pageMetrics(raw) {
  const page = raw.page;
  if (raw.pageBlocked || !page) {
    const reason = raw.pageBlocked ?? 'page instruments did not run';
    return Object.fromEntries(['W6', 'W7', 'W9', 'W10', 'W13', 'W14', 'W15', 'W16', 'W17'].map(id => [id, notMeasured(id, reason)]));
  }
  const out = {};
  // W6 axe, both motion modes at every width; a node counts once per rule.
  // Nodes inside the platform's "Made with Makeborne" badge (added to every
  // published page by composeSiteDocument) are counted like any other node,
  // because visitors get them, but attributed so the taxonomy can separate a
  // platform defect from a site defect.
  if (allErrored(page.axe?.byWidth)) out.W6 = notMeasured('W6', `axe did not run: ${firstError(page.axe?.byWidth) ?? 'no result'}`);
  else {
    const { critical = 0, serious = 0 } = page.axe.counts;
    const rules = impact => page.axe.violations.filter(v => v.impact === impact).map(v => `${v.id} (${v.nodes} node${v.nodes === 1 ? '' : 's'} at ${v.widths.join('/')}${v.targets.every(isBadgeTarget) ? ', platform badge' : ''})`).join(', ');
    const badgeOnly = impact => page.axe.violations.filter(v => v.impact === impact).every(v => v.targets.length >= v.nodes && v.targets.every(isBadgeTarget));
    const partial = firstError(page.axe.byWidth) ? `; some widths failed: ${firstError(page.axe.byWidth)}` : '';
    out.W6 = measured('W6', {
      critical: { pass: critical <= WEBSITE.W6.critical, value: critical, sev: 0.5 + critical / 10, reason: critical ? `${critical} critical node(s): ${rules('critical')}${partial}` : partial || null, failureClass: critical && badgeOnly('critical') ? 'platform badge (axe)' : undefined },
      serious: { pass: serious <= WEBSITE.W6.serious, value: serious, sev: serious / 10, reason: serious ? `${serious} serious node(s): ${rules('serious')}${partial}` : partial || null, failureClass: serious && badgeOnly('serious') ? 'platform badge (axe)' : undefined },
    }, { value: { critical, serious, moderate: page.axe.counts.moderate ?? 0, minor: page.axe.counts.minor ?? 0 } });
  }
  // W7 CLS from the in-page observer at 390 and 1440 through load and a full
  // scroll, VITALS_LOADS (3) loads per width × motion mode. One load per
  // width/mode caught Osteria Brina's intermittent 0.186 shift only ~80% of the
  // time (it showed in 12 of 22 loads at 1440), so W7 fails when ANY load
  // reaches the threshold: a shift visitors get in a share of loads is real.
  // Median, maximum and the share of loads ≥ the threshold are recorded.
  if (raw.skip.includes('vitals')) out.W7 = notMeasured('W7', 'skipped (--skip vitals)');
  else if (!Number.isFinite(page.vitals?.clsMax)) out.W7 = notMeasured('W7', `no CLS reading (needs widths 390/1440): ${firstError(page.vitals?.byWidth) ?? 'no value'}`);
  else {
    const v = page.vitals;
    const cls = v.clsMax;
    const rows = Object.entries(v.byWidth).flatMap(([width, modes]) => Object.entries(modes).filter(([, value]) => Number.isFinite(value?.cls)).map(([mode, value]) => ({ width, mode, ...value })));
    const worst = rows.sort((p, q) => q.cls - p.cls)[0];
    const hit = rows.filter(row => row.shareAtOrAbove > 0).map(row => `${row.width}/${row.mode} ${Math.round(row.shareAtOrAbove * row.clsLoads.length)} of ${row.clsLoads.length} (max ${row.cls}, median ${row.clsMedian})`);
    const value = { max: cls, median: v.clsMedian, shareAtOrAbove: v.shareAtOrAbove, loads: v.loads, loadsAtOrAbove: v.loadsAtOrAbove };
    out.W7 = measured('W7', { site: { pass: cls < WEBSITE.W7.max, value, sev: (cls - WEBSITE.W7.max) / 0.15, reason: cls >= WEBSITE.W7.max
      ? `${v.loadsAtOrAbove} of ${v.loads} loads ≥ ${WEBSITE.W7.max} (fails: any load counts); max ${cls}, median ${v.clsMedian}; ${hit.join('; ')}`
      : `max ${cls} over ${v.loads} loads (median ${v.clsMedian}) at ${worst?.width} (${worst?.mode})` } });
  }
  // W9 overflow at every width in both modes, pass/fail on the USER-reachable
  // number: when the root clips overflow-x, a script can still scroll it
  // (scriptPx) but a visitor reaches only what touch emulation shows at 360/390.
  if (allErrored(page.overflow?.byWidth)) out.W9 = notMeasured('W9', `overflow check did not run: ${firstError(page.overflow?.byWidth) ?? 'no result'}`);
  else {
    const { offenderCount, offenders } = page.overflow;
    const userPx = page.overflow.userMaxPx ?? page.overflow.maxPx;
    const scriptPx = page.overflow.scriptMaxPx ?? page.overflow.maxPx;
    const widths = Object.entries(page.overflow.byWidth).filter(([, value]) => value.failedModes?.length).map(([width, value]) => `${width} (${value.worstPx} px${value.worstScriptPx !== undefined && value.worstScriptPx !== value.worstPx ? `, script ${value.worstScriptPx}` : ''})`);
    const how = [...new Set(Object.values(page.overflow.byWidth).flatMap(modes => Object.values(modes)).map(entry => entry?.userHow).filter(how => how && how !== 'document scroll'))];
    const failing = userPx > WEBSITE.W9.maxPx || offenderCount > 0;
    out.W9 = measured('W9', { site: { pass: !failing, value: { px: userPx, scriptPx, elements: offenderCount }, sev: Math.max(userPx / 50, offenderCount / 5), reason: failing
      ? `${userPx} px a visitor can reach (script-reachable ${scriptPx} px), ${offenderCount} element(s); widths ${widths.join(', ')}${offenders.length ? `; ${offenders.slice(0, 3).map(o => `${o.selector} (${o.side} ${o.right ?? o.left})`).join('; ')}` : ''}${how.length ? `; ${how[0]}` : ''}`
      : scriptPx ? `0 px user-reachable; ${scriptPx} px script-reachable behind a clipping root (${how[0] ?? 'root clips overflow-x'})` : null } });
  }
  // W10 contrast. Text over images, gradients and other painted layers is
  // settled from screenshots (web.mjs resolveContrastPixels); what stays
  // indeterminate is reported, never counted as a pass. aria-hidden text and
  // text inside role="img" pictures are measured but not counted (WCAG 1.4.3).
  if (allErrored(page.contrast?.byWidth)) out.W10 = notMeasured('W10', `contrast check did not run: ${firstError(page.contrast?.byWidth) ?? 'no result'}`);
  else {
    const { failing, indeterminate, checked, failingNodes } = page.contrast;
    const resolved = page.contrast.pixels?.resolved ?? 0;
    out.W10 = measured('W10', { site: { pass: failing <= WEBSITE.W10.maxFailing, value: { failing, indeterminate, checked, pixelResolved: resolved }, sev: failing / 10, reason: failing
      ? `${failing} failing node(s), worst: ${failingNodes.slice(0, 3).map(n => `"${n.text}" ${n.ratio}:1 < ${n.required} (${n.fg} on ${n.bg}${n.method === 'pixels' ? ', from pixels' : ''})`).join('; ')}`
      : indeterminate ? `${indeterminate} node(s) still indeterminate (${Object.entries(page.contrast.pixels?.unresolved ?? {}).map(([why, n]) => `${why} ${n}`).join(', ') || 'not resolvable from pixels'})` : null } });
  }
  // W13 links.
  if (pageError(page, 'links')) out.W13 = notMeasured('W13', `link check failed: ${page.links.error}`);
  else {
    const l = page.links;
    const parts = [['href="#"', l.hashOnly], ['empty href', l.empty], ['javascript:', l.javascript], ['missing anchors', l.missingAnchors], ['404 routes', l.notFound], ['malformed tel:', l.malformedTel], ['malformed mailto:', l.malformedMailto]]
      .filter(([, list]) => list?.length).map(([name, list]) => `${name}: ${list.slice(0, 3).map(entry => entry.href ?? entry.text).join(', ')}${list.length > 3 ? ` (+${list.length - 3})` : ''}`);
    out.W13 = measured('W13', { site: { pass: l.dead <= WEBSITE.W13.max, value: l.dead, sev: l.dead / 5, reason: l.dead ? `${l.dead} dead link(s); ${parts.join('; ')}${l.unverified?.length ? `; ${l.unverified.length} unverified` : ''}` : (l.unverified?.length ? `${l.unverified.length} link(s) unverified` : null) } });
  }
  // W14 images.
  if (pageError(page, 'images')) out.W14 = notMeasured('W14', `image check failed: ${page.images.error}`);
  else {
    const i = page.images;
    // A page without a single <img> passes W14 without testing anything: say so.
    const idle = i.total === 0 ? `not exercised (0 images; ${i.inlineSvg ?? 0} inline SVG, ${i.cssBackgroundImages ?? 0} CSS background image(s) are not W14 images)` : null;
    out.W14 = measured('W14', {
      brokenAlt: { pass: i.brokenCount <= WEBSITE.W14.maxBroken && i.missingAltCount <= WEBSITE.W14.maxMissingAlt, value: { images: i.total, broken: i.brokenCount, missingAlt: i.missingAltCount }, sev: (i.brokenCount + i.missingAltCount) / 4, reason: i.brokenCount || i.missingAltCount ? `${i.brokenCount} broken, ${i.missingAltCount} without alt: ${[...i.broken, ...i.missingAlt].slice(0, 3).map(img => img.src || img.selector).join(', ')}` : idle, exercised: idle ? false : undefined },
      dims: { pass: i.missingDimsCount <= WEBSITE.W14.maxMissingDims, value: i.missingDimsCount, sev: (i.missingDimsCount - WEBSITE.W14.maxMissingDims) / 5, reason: i.missingDimsCount > WEBSITE.W14.maxMissingDims ? `${i.missingDimsCount} image(s) without width/height or aspect-ratio box` : idle, exercised: idle ? false : undefined },
    }, { value: { images: i.total, broken: i.brokenCount, missingAlt: i.missingAltCount, missingDims: i.missingDimsCount, exercised: !idle } });
  }
  // W15 template tells (either motion mode). web.mjs leaves the platform badge
  // out (PLATFORM_SELECTOR) and decides the cream part on the pixel-checked
  // ground. Every tell counts for the per-site pass, requested by the brief or
  // not (the bar counts tells regardless); requestedByBrief only splits the
  // set numbers into requested and unrequested ("drift").
  if (pageError(page, 'tells')) out.W15 = notMeasured('W15', `tell detector failed: ${page.tells.error}`);
  else {
    const t = page.tells;
    const present = t.present;
    const requested = t.requested ?? present.filter(name => t[name]?.requestedByBrief === true);
    const unrequested = present.filter(name => !requested.includes(name));
    const label = name => (requested.includes(name) ? `${name} [requested by brief: ${(t[name].briefMatches ?? []).join(', ')}]` : name);
    const copy = t.bannedCopy?.present ? ` (copy: ${[...(t.bannedCopy.evidence?.phrases ?? []).map(p => p.phrase), ...(t.bannedCopy.evidence?.labelHeadings ?? [])].join(', ')})` : '';
    const requestOf = name => (t[name] ? { present: t[name].present === true, requestedByBrief: t[name].requestedByBrief ?? null, briefMatches: t[name].briefMatches ?? [] } : null);
    out.W15 = measured('W15', { site: { pass: present.length <= WEBSITE.W15.maxTells, value: present.length, sev: (present.length - WEBSITE.W15.maxTells) / 2, reason: present.length ? `${present.length} tell(s): ${present.map(label).join(', ')}${copy}` : null } },
      { value: {
        count: present.length, present, requested, unrequested, unrequestedCount: unrequested.length,
        creamSerifItalicPill: t.creamSerifItalicPill?.present === true, marqueeAndWordmark: t.marqueeAndWordmark?.present === true,
        byBrief: { creamSerifItalicPill: requestOf('creamSerifItalicPill'), marqueeAndWordmark: requestOf('marqueeAndWordmark') },
        platformPillsExcluded: t.creamSerifItalicPill?.evidence?.platformPillCount ?? 0,
      } });
  }
  // W16 first screen at 390×844 and 1440×900.
  const screens = Object.entries(page.firstScreen?.byWidth ?? {});
  if (!screens.length) out.W16 = notMeasured('W16', 'first screen not measured (needs widths 390 and 1440)');
  else if (screens.some(([, s]) => s.error)) out.W16 = notMeasured('W16', `first-screen check failed: ${screens.find(([, s]) => s.error)[1].error}`);
  else {
    const missing = screens.flatMap(([width, s]) => [['h1', s.h1], ['value line', s.valueLine], ['primary action', s.primaryAction]].filter(([, entry]) => !entry?.visible).map(([name]) => `${width}: ${name}`));
    const noAction = missing.some(entry => entry.endsWith('primary action'));
    out.W16 = measured('W16', { site: { pass: page.firstScreen.ok, value: { missing }, sev: missing.length / (3 * screens.length) * 2, reason: missing.length ? `not in view: ${missing.join('; ')}` : null, failureClass: noAction ? 'missing first-screen action' : 'first screen: h1 or value line below the fold' } });
  }
  // W17 honesty (web.mjs matches a phone number within one line of innerText;
  // tel: targets in E.164 form match the brief's national number). Without
  // brief text there is nothing to tell a real contact detail from an invented
  // one, so the check is n/a (the details found are still recorded).
  if (pageError(page, 'honesty')) out.W17 = notMeasured('W17', `honesty check failed: ${page.honesty.error}`);
  else {
    const h = page.honesty;
    const found = [...h.phones.map(p => `phone ${p.text}${p.occurrences > 1 ? ` (×${p.occurrences})` : ''}`), ...h.emails.map(e => `email ${e.text}${e.reserved ? ' (reserved domain)' : ''}`)];
    const value = { phones: h.phones.length, emails: h.emails.length, bracketed: h.bracketed, briefProvided: h.briefProvided, allowed: h.allowed?.length ?? 0 };
    out.W17 = h.briefProvided
      ? measured('W17', { site: { pass: found.length === 0, value, sev: found.length / 3, reason: found.length ? `unbracketed, not in the brief: ${found.slice(0, 4).join(', ')}` : null } })
      : measured('W17', { site: { pass: null, value, reason: `n/a: no brief text to compare contact details against${found.length ? `; found ${found.slice(0, 4).join(', ')}` : ''}` } });
  }
  return out;
}

/** W1–W17 for one website item from its raw instrument results. */
function scoreWebsite(raw) {
  const metrics = {};
  // W1, W2
  if (raw.competitor) {
    metrics.W1 = notMeasured('W1', 'competitor capture: no project source to compile');
    metrics.W2 = notMeasured('W2', 'competitor capture: no project source to type-check');
  } else if (!raw.sourcePresent) {
    metrics.W1 = measured('W1', { site: { pass: false, value: { ok: false }, sev: 1, reason: `no saved website source: ${raw.generationFailure ?? 'source.json missing'}`, failureClass: 'generation failed' } });
    metrics.W2 = notMeasured('W2', 'no saved website source');
  } else if (!raw.materialize?.ok) {
    const reason = `materialize failed: ${raw.materialize?.error ?? 'unknown'}`;
    metrics.W1 = notMeasured('W1', reason);
    metrics.W2 = notMeasured('W2', reason);
  } else {
    const m = raw.materialize.value;
    metrics.W1 = measured('W1', { site: { pass: m.compile.ok, value: { ok: m.compile.ok, ms: m.compile.ms, jsBytes: m.compile.jsBytes, cssBytes: m.compile.cssBytes, staticProblems: m.compile.staticProblems?.length ?? 0 }, sev: 1, reason: m.compile.ok ? (m.compile.staticProblems?.length ? `compiles; finish() static checks: ${m.compile.staticProblems.slice(0, 2).join('; ')}` : null) : m.compile.error } });
    metrics.W2 = raw.skip.includes('typecheck')
      ? notMeasured('W2', 'skipped (--skip typecheck); note: materializeWebsite runs it anyway, the value is in instruments.materialize')
      : measured('W2', { site: { pass: m.typecheck.ok, value: m.typecheck.count, sev: m.typecheck.count / 10, reason: m.typecheck.count ? m.typecheck.errors.slice(0, 3).map(e => `${e.file}:${e.line} TS${e.code} ${clip(e.message, 100)}`).join('; ') : null } });
  }
  Object.assign(metrics, lighthouseMetrics(raw), pageMetrics(raw));
  // W11 html-validate on the static snapshot (competitors: the rendered DOM).
  if (raw.skip.includes('htmlvalidate')) metrics.W11 = notMeasured('W11', 'skipped (--skip htmlvalidate)');
  else if (!raw.htmlvalidate) metrics.W11 = notMeasured('W11', raw.pageBlocked ?? 'html-validate did not run');
  else if (!raw.htmlvalidate.ok) metrics.W11 = notMeasured('W11', `html-validate failed: ${raw.htmlvalidate.error}`);
  else {
    const v = raw.htmlvalidate.value;
    const rules = Object.entries(v.byRuleErrors ?? {}).sort((p, q) => q[1] - p[1]).slice(0, 4).map(([rule, n]) => `${rule} ×${n}`).join(', ');
    metrics.W11 = measured('W11', { site: { pass: v.errors <= WEBSITE.W11.maxErrors, value: { errors: v.errors, warnings: v.warnings, basis: raw.htmlvalidate.basis }, sev: v.errors / 10, reason: v.errors ? `${v.errors} error(s): ${rules}` : null } });
  }
  // W12 weight of one first load.
  if (!raw.weight) metrics.W12 = notMeasured('W12', raw.pageBlocked ?? 'weight not measured');
  else if (!raw.weight.ok) metrics.W12 = notMeasured('W12', `weight load failed: ${raw.weight.error}`);
  else {
    const w = raw.weight.value.firstLoad;
    const totalKiB = round(w.total.bytes / KiB, 1), jsKiB = round(w.byType.js.bytes / KiB, 1);
    const breakdown = Object.entries(w.byType).filter(([, entry]) => entry.bytes).map(([type, entry]) => `${type} ${round(entry.bytes / KiB, 1)}`).join(', ');
    metrics.W12 = measured('W12', {
      total: { pass: totalKiB <= WEBSITE.W12.maxTotalKiB, value: totalKiB, sev: (totalKiB - WEBSITE.W12.maxTotalKiB) / WEBSITE.W12.maxTotalKiB, reason: `${totalKiB} KiB (${breakdown})` },
      js: { pass: jsKiB <= WEBSITE.W12.maxJsKiB, value: jsKiB, sev: (jsKiB - WEBSITE.W12.maxJsKiB) / WEBSITE.W12.maxJsKiB, reason: `${jsKiB} KiB JavaScript` },
    }, { value: { totalKiB, jsKiB, method: raw.weight.value.method } });
  }
  return Object.fromEntries(WEBSITE_IDS.map(id => [id, metrics[id]]));
}

function websiteKeyNumbers(metrics, raw) {
  const lh = raw.lighthouse?.median && raw.lighthouse.runs ? raw.lighthouse.median : null;
  const page = raw.page;
  return {
    compiles: metrics.W1.pass, typeErrors: metrics.W2.pass === null ? null : metrics.W2.value,
    lighthouse: lh ? { performance: lh.performance, accessibility: lh.accessibility, seo: lh.seoPlatformAdjusted, bestPractices: lh.bestPractices, lcpMs: lh.lcpMs === null ? null : Math.round(lh.lcpMs), runs: raw.lighthouse.runs } : null,
    axe: metrics.W6.pass === null ? null : { critical: metrics.W6.value.critical, serious: metrics.W6.value.serious },
    cls: metrics.W7.pass === null ? null : { max: metrics.W7.value.max, median: metrics.W7.value.median, shareAtOrAbove: metrics.W7.value.shareAtOrAbove, loads: metrics.W7.value.loads },
    overflow: metrics.W9.pass === null ? null : metrics.W9.value,
    contrast: metrics.W10.pass === null ? null : { failing: metrics.W10.value.failing, indeterminate: metrics.W10.value.indeterminate, pixelResolved: metrics.W10.value.pixelResolved ?? 0 },
    images: metrics.W14.pass === null ? null : metrics.W14.value.images,
    honesty: metrics.W17.status,
    htmlErrors: metrics.W11.pass === null ? null : metrics.W11.value.errors,
    weight: metrics.W12.pass === null ? null : { totalKiB: metrics.W12.value.totalKiB, jsKiB: metrics.W12.value.jsKiB },
    deadLinks: metrics.W13.pass === null ? null : metrics.W13.value,
    tells: metrics.W15.pass === null ? null : { count: metrics.W15.value.count, present: metrics.W15.value.present, requested: metrics.W15.value.requested, unrequested: metrics.W15.value.unrequested },
    firstScreen: metrics.W16.pass,
    archetype: page?.identity && !page.identity.error ? page.identity.archetype : null,
    groundClass: page?.identity && !page.identity.error ? page.identity.groundClass : null,
    missingFonts: page?.identity && !page.identity.error ? (page.identity.fonts?.missing ?? []).map(entry => `${entry.role}: ${entry.declared} → ${entry.rendered}`) : null,
  };
}

/**
 * The identity fields D1–D4 read, plus enough evidence to audit them. The
 * ground is decided in web.mjs (measureIdentity/decideIdentity): DOM samples
 * whose colour a background image, gradient or overlay may change are settled
 * against the screenshot of their band, and groundCheck records the dominant
 * painted colour of the first screen and of the page next to the sampled ground.
 */
function identityOf(page, blocked) {
  if (!page) return { error: blocked ?? 'page instruments did not run' };
  const id = page.identity;
  if (!id || id.error) return { error: id?.error ?? 'identity not measured' };
  // fonts.display/text are the RENDERED families (what D3 pairs); declared and missing are kept beside them.
  return {
    ground: id.ground, groundSource: id.groundSource, groundClass: id.groundClass, groundShare: id.groundShare, groundClassDecision: id.groundClassDecision ?? null,
    ink: id.ink, accent: id.accent, accentSource: id.accentSource, accentExcluded: id.accentExcluded ?? [],
    fonts: { display: id.fonts?.display ?? null, text: id.fonts?.text ?? null, declared: id.fonts?.declared ?? null, missing: id.fonts?.missing ?? [], method: id.fonts?.method ?? null },
    archetype: id.archetype, archetypeScores: id.archetypeScores, texturesIgnored: id.archetypeNotes?.texturesIgnored ?? [],
    colours: id.colours,
    groundCheck: { firstScreenGround: id.firstScreenGround, firstScreenMediaShare: id.firstScreenMediaShare ?? null, pageMediaShare: id.pageMediaShare ?? null, ...id.groundCheck },
  };
}

// ---------------------------------------------------------------------------
// Website instruments

const TYPE_GROUPS = [['html', /text\/html/], ['js', /javascript|ecmascript/], ['css', /text\/css/], ['font', /^font\/|woff|truetype|opentype/], ['image', /^image\//]];
const typeGroup = type => TYPE_GROUPS.find(([, pattern]) => pattern.test(type ?? ''))?.[0] ?? 'other';

function byType(requests) {
  const groups = Object.fromEntries([...TYPE_GROUPS.map(([name]) => name), 'other'].map(name => [name, { bytes: 0, requests: 0 }]));
  const failed = [];
  for (const request of requests) {
    if (request.status !== 200) { failed.push({ path: request.path, status: request.status }); continue; }
    const group = groups[typeGroup(request.type)];
    group.bytes += request.bytes;
    group.requests++;
  }
  const total = Object.values(groups).reduce((sum, group) => ({ bytes: sum.bytes + group.bytes, requests: sum.requests + group.requests }), { bytes: 0, requests: 0 });
  return { total, byType: groups, failed };
}

/** File on disk behind a served path of a materialised item (for compressed-size estimates). */
function servedFile(outDir, pathname) {
  if (pathname === '/' || pathname === '/index.html') return path.join(outDir, 'published', 'index.html');
  if (pathname === '/site.js') return path.join(outDir, 'build', 'site.js.bundle');
  const file = path.resolve(outDir, 'build', `.${decodeURIComponent(pathname)}`);
  return file.startsWith(path.join(outDir, 'build') + path.sep) ? file : null;
}

/**
 * W12: bytes of one first load of the published page at 1440×900 from the
 * static server's request log (uncompressed: the local server does not
 * compress; gzip sizes of the same files are reported as an estimate of the
 * wire size). Non-loopback requests are aborted and counted. A full scroll
 * afterwards records lazy content separately (informational).
 */
async function measureWeight(browser, server, url, outDir) {
  const context = await browser.newContext({ viewport: { width: 1440, height: HEIGHTS[1440] }, deviceScaleFactor: 1 });
  const external = [];
  try {
    await context.route('**/*', route => {
      if (loopback(route.request().url())) return route.continue();
      external.push(route.request().url().slice(0, 160));
      return route.abort();
    });
    const page = await context.newPage();
    server.reset();
    await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => true) : true)).catch(() => {});
    const first = server.requests.slice();
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight && y < 60_000; y += innerHeight * 0.8) { scrollTo(0, y); await new Promise(resolve => setTimeout(resolve, 60)); }
    }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    const all = server.requests.slice();
    const gzip = {};
    for (const request of first.filter(entry => entry.status === 200)) {
      const file = servedFile(outDir, request.path);
      if (file && existsSync(file)) gzip[request.path] = gzipSync(readFileSync(file)).length;
    }
    const firstLoad = byType(first);
    return {
      method: 'one load of published/ at 1440×900 (load + network idle + fonts), bytes from the local server log, uncompressed',
      firstLoad, afterScroll: byType(all),
      requests: first.map(({ path: pathname, status, bytes, type }) => ({ path: pathname, status, bytes, type })),
      gzipEstimateBytes: { total: Object.values(gzip).reduce((sum, bytes) => sum + bytes, 0), byPath: gzip },
      externalBlocked: { count: external.length, urls: external.slice(0, 10) },
    };
  } finally {
    await context.close().catch(() => {});
  }
}

/** W12 for a competitor: one offline replay of the HAR at 1440, response bodies by content type. */
async function replayWeight(browser, url, har) {
  const context = await browser.newContext({ viewport: { width: 1440, height: HEIGHTS[1440] }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  try {
    await context.routeFromHAR(har, { notFound: 'abort' });
    const page = await context.newPage();
    const pending = [];
    const requests = [];
    page.on('requestfinished', request => pending.push((async () => {
      const response = await request.response();
      if (!response) return;
      const body = await response.body().catch(() => null);
      requests.push({ path: request.url().slice(0, 200), status: response.status() === 200 ? 200 : response.status(), bytes: body?.length ?? 0, type: response.headers()['content-type'] ?? '' });
    })()));
    await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await Promise.all(pending);
    const first = byType(requests.filter(entry => entry.status >= 200 && entry.status < 300).map(entry => ({ ...entry, status: 200 })));
    return { method: 'one offline replay of page.har at 1440×900 (load + network idle), decoded response bodies', firstLoad: first, requests: requests.slice(0, 200), networkDependent: false };
  } finally {
    await context.close().catch(() => {});
  }
}

/** Route-aware status for internal links: the host serves only published routes, files by path. */
function routeStatus(source, server) {
  const normal = value => (value.length > 1 ? value.replace(/\/+$/, '') : value) || '/';
  const routes = new Set((source?.routes ?? [{ path: '/' }]).map(route => normal(route.path)));
  return async pathname => {
    if (path.posix.extname(pathname)) return (await fetch(new URL(pathname, server.url))).status;
    return routes.has(normal(decodeURI(pathname))) ? 200 : 404;
  };
}

async function validateFile(file, outFile, basis) {
  const result = await validateHtml(readFileSync(file, 'utf8'), { outFile });
  const byRuleErrors = {};
  for (const message of result.messages) if (message.severity === 'error') byRuleErrors[message.ruleId] = (byRuleErrors[message.ruleId] ?? 0) + 1;
  return { errors: result.errors, warnings: result.warnings, byRule: result.byRule, byRuleErrors, basis };
}

/** Phase 1 for a Makeborne website: everything except Lighthouse. */
async function measureOwnWebsite(desc, ctx, slot, outDir) {
  const raw = { competitor: false, skip: ctx.options.skip, lighthouseLive: false, brief: desc.brief, sourcePresent: existsSync(path.join(desc.itemDir, 'source.json')) };
  const errors = [];
  const note = (instrument, result) => { if (result && !result.ok) errors.push({ instrument, message: result.error, timedOut: result.timedOut }); };
  if (!raw.sourcePresent) {
    raw.generationFailure = desc.status?.ok === false ? `${desc.status.code ?? 'failed'} at ${desc.status.stage ?? '?'}: ${desc.status.message ?? ''}` : 'source.json missing';
    raw.pageBlocked = 'not measurable: no saved website source (generation failed)';
    return { raw, errors };
  }
  const T = ctx.timeouts;
  raw.materialize = await timed('materialize', T.materialize, async () => materializeWebsite({ itemDir: desc.itemDir, outDir, browser: await slot.get(), item: desc.item }), { onTimeout: () => slot.close() });
  note('materialize', raw.materialize);
  const m = raw.materialize.value;
  if (!raw.materialize.ok) { raw.pageBlocked = `not measurable: materialize failed (${raw.materialize.error})`; return { raw, errors }; }
  if (!m.compile.ok) { raw.pageBlocked = 'not measurable: the project does not compile, so it cannot be published'; return { raw, errors }; }
  if (!m.paths.published) {
    raw.pageBlocked = `not measurable: static snapshot failed, so the site cannot be published (${m.snapshot.error})`;
    errors.push({ instrument: 'snapshot', message: m.snapshot.error });
    return { raw, errors };
  }
  if (m.snapshot.runtimeErrors?.length) errors.push({ instrument: 'snapshot', message: `runtime errors during capture (not fatal): ${m.snapshot.runtimeErrors.slice(0, 2).join(' | ')}` });

  const source = readJson(path.join(desc.itemDir, 'source.json'));
  const server = await serveWebsite(outDir, { variant: 'published' });
  try {
    const url = `${server.url}/`;
    raw.weight = await retryTransient(() => timed('weight', T.weight, async () => measureWeight(await slot.get(), server, url, outDir), { onTimeout: () => slot.close() }));
    note('weight', raw.weight);
    if (raw.weight.retried) errors.push({ instrument: 'weight', message: `retried once after a transient socket error (${clip(raw.weight.retried.after, 160)}): ${raw.weight.ok ? 'measured' : 'failed again'}` });
    // Offline: the published page may only reach its own origin, as the host CSP intends for assets.
    const blockedExternal = [];
    raw.page = (await timed('measurePage', T.page, async () => measurePage({
      browser: await slot.get(), url, widths: ctx.options.widths, brief: desc.brief, shotsDir: path.join(outDir, 'shots'), axeDir: outDir,
      requestStatus: routeStatus(source, server),
      onContext: context => context.route('**/*', route => {
        if (loopback(route.request().url())) return route.continue();
        if (blockedExternal.length < 20) blockedExternal.push(route.request().url().slice(0, 160));
        return route.abort();
      }),
    }), { onTimeout: () => slot.close() }));
    note('measurePage', raw.page);
    if (raw.page.ok) {
      raw.page = { ...raw.page.value, blockedExternal };
      for (const key of ['links', 'images', 'tells', 'honesty', 'identity']) if (raw.page[key]?.error) errors.push({ instrument: `measurePage.${key}`, message: raw.page[key].error });
      for (const key of ['axe', 'contrast', 'overflow']) { const error = firstError(raw.page[key]?.byWidth); if (error) errors.push({ instrument: `measurePage.${key}`, message: error }); }
    } else {
      raw.pageBlocked = `measurePage failed: ${raw.page.error}`;
      raw.page = null;
    }
  } finally {
    await server.close();
  }
  if (!ctx.options.skip.includes('htmlvalidate')) {
    raw.htmlvalidate = await timed('htmlvalidate', T.htmlvalidate, () => validateFile(path.join(outDir, 'snapshot', 'index.html'), path.join(outDir, 'htmlvalidate.json'), 'snapshot/index.html (static snapshot)'));
    note('htmlvalidate', raw.htmlvalidate);
    if (raw.htmlvalidate.ok) raw.htmlvalidate = { ok: true, value: raw.htmlvalidate.value, basis: raw.htmlvalidate.value.basis };
  }
  return { raw, errors };
}

/** Phase 1 for a competitor capture: HAR replay, no source. */
async function measureCompetitor(desc, ctx, slot, outDir) {
  const raw = { competitor: true, skip: ctx.options.skip, lighthouseLive: ctx.options.lighthouseLive, brief: desc.brief, sourcePresent: false };
  const errors = [];
  const note = (instrument, result) => { if (result && !result.ok) errors.push({ instrument, message: result.error, timedOut: result.timedOut }); };
  const har = path.join(desc.itemDir, 'page.har');
  const url = desc.meta.finalUrl ?? desc.meta.url;
  if (desc.status?.ok === false || !existsSync(har) || !url) {
    raw.pageBlocked = `not measurable: ${desc.status?.ok === false ? `capture failed (${desc.status.message})` : !existsSync(har) ? 'page.har missing' : 'no URL in meta.json'}`;
    return { raw, errors };
  }
  const T = ctx.timeouts;
  raw.weight = await timed('weight', T.weight, async () => replayWeight(await slot.get(), url, har), { onTimeout: () => slot.close() });
  note('weight', raw.weight);
  raw.page = await timed('measurePage', T.page, async () => measurePage({
    browser: await slot.get(), url, widths: ctx.options.widths, brief: desc.brief, shotsDir: path.join(outDir, 'shots'), axeDir: outDir,
    contextOptions: { serviceWorkers: 'block' },
    onContext: context => context.routeFromHAR(har, { notFound: 'abort' }),
  }), { onTimeout: () => slot.close() });
  note('measurePage', raw.page);
  if (raw.page.ok) raw.page = raw.page.value;
  else { raw.pageBlocked = `measurePage failed: ${raw.page.error}`; raw.page = null; }
  const dom = path.join(desc.itemDir, 'dom.html');
  if (!ctx.options.skip.includes('htmlvalidate')) {
    raw.htmlvalidate = existsSync(dom)
      ? await timed('htmlvalidate', T.htmlvalidate, () => validateFile(dom, path.join(outDir, 'htmlvalidate.json'), 'dom.html (rendered DOM after scripts, not a static snapshot)'))
      : { ok: false, error: 'dom.html missing' };
    note('htmlvalidate', raw.htmlvalidate);
    if (raw.htmlvalidate.ok) raw.htmlvalidate = { ok: true, value: raw.htmlvalidate.value, basis: raw.htmlvalidate.value.basis };
  }
  return { raw, errors };
}

/** Phase 2: Lighthouse on one website, alone. Mutates raw.lighthouse; returns errors. */
async function lighthouseFor(entry, ctx) {
  const { desc, raw, outDir } = entry;
  if (ctx.options.skip.includes('lighthouse') || raw.pageBlocked && !raw.page) return [];
  if (raw.competitor && !ctx.options.lighthouseLive) return [];
  const runs = ctx.options.lighthouseRuns;
  const budget = ctx.timeouts.lighthouseRun * runs;
  let server = null;
  try {
    let url;
    if (raw.competitor) url = desc.meta.url;
    else { server = await serveWebsite(outDir, { variant: 'published' }); url = `${server.url}/`; }
    const result = await timed('lighthouse', budget, () => runLighthouse(url, { runs, outFile: path.join(outDir, 'lighthouse.json') }));
    if (!result.ok) {
      raw.lighthouse = { error: result.error, runs: 0 };
      return [{ instrument: 'lighthouse', message: result.error, timedOut: result.timedOut }];
    }
    // runLighthouse() drops failed runs (thrown, or ending in a runtimeError) from
    // its median, retries once, and lists them in failedRuns.
    const value = result.value;
    raw.lighthouse = { ...value, networkDependent: raw.competitor, url: raw.competitor ? url : 'published/ on the local server' };
    return value.failedRuns.map(run => ({ instrument: 'lighthouse', message: run.runtimeError ? `attempt ${run.attempt}: runtime error ${run.runtimeError}, run discarded${run.message ? ` (${clip(run.message, 200)})` : ''}` : `attempt ${run.attempt}: ${clip(run.message, 400)}` }));
  } catch (error) {
    raw.lighthouse = { error: clip(error.message), runs: 0 };
    return [{ instrument: 'lighthouse', message: clip(error.message) }];
  } finally {
    await server?.close();
  }
}

// ---------------------------------------------------------------------------
// Decks and books

function documentImages(itemDir) {
  const images = {};
  for (const folder of [path.join(itemDir, 'assets'), path.join(itemDir, 'assets', 'images')]) {
    if (!existsSync(folder)) continue;
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(png|jpe?g|webp)$/i.test(entry.name)) continue;
      const bytes = readFileSync(path.join(folder, entry.name));
      images[entry.name] = bytes;
      images[entry.name.replace(/\.[^.]+$/, '')] = bytes;
    }
  }
  return Object.keys(images).length ? images : undefined;
}

const errorText = (errors, ...steps) => errors.filter(error => !steps.length || steps.some(step => error.step.startsWith(step))).map(error => `${error.step}: ${error.message}`).join('; ') || null;

function scoreDeck(result, generationFailure) {
  if (generationFailure) {
    return {
      P1: measured('P1', { site: { pass: false, sev: 1, reason: `no saved deck: ${generationFailure}`, failureClass: 'generation failed' } }),
      ...Object.fromEntries(['P2', 'P3', 'P4', 'P5', 'P6'].map(id => [id, notMeasured(id, 'no saved deck (generation failed)')])),
    };
  }
  if (!result.ok) return Object.fromEntries(['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map(id => [id, notMeasured(id, `measureDeck failed: ${result.error}`)]));
  const r = result.value, p = r.pass, x = r.pptx;
  const na = (step, fallback) => errorText(r.errors, ...step) ?? fallback;
  return {
    P1: p.P1 === null ? notMeasured('P1', na(['read pptx', 'pptx', 'parse'], 'no PPTX')) : measured('P1', { site: { pass: p.P1, value: { wordRate: x.editableTextRate, charRate: x.charRate, matchedChars: x.matchedChars, sourceChars: x.sourceChars }, sev: (DOCUMENTS.P1.min - Math.min(x.editableTextRate, x.charRate)) / 0.3, reason: p.P1 ? null : `words ${x.editableTextRate}, characters ${x.charRate}; missing on slides ${Object.keys(x.missingBySlide ?? {}).slice(0, 6).join(', ')}` } }),
    P2: p.P2 === null ? notMeasured('P2', na(['read pptx', 'pptx'], 'no PPTX')) : measured('P2', { site: { pass: p.P2, value: { documentCharts: x.documentCharts, nativeCharts: x.nativeCharts, rate: x.nativeChartRate }, sev: 1 - (x.nativeChartRate ?? 0), reason: p.P2 ? (x.documentCharts ? null : 'no charts in the document') : `${x.nativeCharts}/${x.documentCharts} charts native` } }),
    P3: p.P3 === null ? notMeasured('P3', na(['render', 'launch'], 'deck not rendered')) : measured('P3', { site: { pass: p.P3, value: r.overflow.count, sev: r.overflow.count / 3, reason: r.overflow.count ? r.overflow.slides.slice(0, 3).map(slide => `slide ${slide.index}: ${slide.boxes[0].reason} "${clip(slide.boxes[0].text, 40)}"`).join('; ') : null } }),
    P4: p.P4 === null ? notMeasured('P4', na(['fit'], 'fit warnings not computed')) : measured('P4', { site: { pass: p.P4, value: r.fitWarnings.count, sev: r.fitWarnings.count / 5, reason: r.fitWarnings.count ? r.fitWarnings.items.slice(0, 3).join(' ') : null } }),
    P5: measured('P5', { site: { pass: p.P5, value: r.rotation.violations.length, sev: r.rotation.violations.length / 2, reason: r.rotation.violations.length ? r.rotation.violations.map(v => `slides ${v.from}–${v.to} all ${v.composition}`).join('; ') : null } }),
    // P6 counts notes in the PPTX: without one it is not measurable (the document's own notes are in instruments.deck.notes).
    P6: p.P6 === null ? notMeasured('P6', !x ? `n/a: no PPTX (${na(['read pptx', 'pptx'], 'no export')}); P6 counts notes as exported` : 'no content slides') : measured('P6', { site: { pass: p.P6, value: r.notes.rate, sev: (DOCUMENTS.P6.min - r.notes.rate) / 0.5, reason: p.P6 ? null : `${r.notes.withNotes}/${r.notes.contentSlides} content slides have notes` } }),
  };
}

const KDP_MIN_PAGES = 24;

/** "pdf_inspection_failure (transparencyFlattened)": the code, plus the observation a pdf_inspection_failure names. */
function validatorCode(finding) {
  const field = finding.code === 'pdf_inspection_failure' ? /^(?:interior|cover):\s*(\w+)/.exec(finding.message ?? '')?.[1] : null;
  return field ? `${finding.code} (${field})` : finding.code ?? clip(finding.message, 60);
}

/**
 * K1 from book.mjs's kdp result. book.mjs fails K1 on a validator error
 * (print.ts validatePaperbackMetadata) OR a harness error (book.mjs
 * harnessFindings: cover_in_interior, full_bleed_background, odd_page_count);
 * the value, reason and severity list both by code, so they show everything
 * the pass decision used. Under 24 pages the validator rejects the profile and
 * stops (its unknowns and warnings are n/a): that is reported as its cause,
 * "below 24-page KDP minimum", still failing but not as an interior defect;
 * the validator re-run at 24 pages (findingsAtMinimumPageCount, labelled,
 * never gated) shows what else it would say. Severity: one unit per cause (the
 * page minimum, each validator error, each harness error) on a scale of 3.
 */
function bookK1(kdp) {
  const findings = kdp.findings ?? [];
  const whatIf = kdp.findingsAtMinimumPageCount ?? null;
  const rejectedForLength = finding => finding.code === 'invalid_profile_or_observation' && /^profile\.pageCount\b/.test(finding.message ?? '');
  const belowMinimum = Boolean(whatIf) && findings.some(rejectedForLength);
  const validatorCodes = findings.filter(f => f.severity === 'error' && !(belowMinimum && rejectedForLength(f))).map(validatorCode);
  const harnessCodes = (kdp.harnessFindings ?? []).filter(f => f.severity === 'error').map(f => (f.code === 'odd_page_count' ? `odd_page_count (${kdp.pages})` : f.code));
  const minimum = belowMinimum ? `below ${KDP_MIN_PAGES}-page KDP minimum (${kdp.pages} pages)` : null;
  const interiorCauses = [...validatorCodes.map(code => `validator ${code}`), ...harnessCodes.map(code => `harness ${code}`)];
  const causes = [...(minimum ? [minimum] : []), ...interiorCauses];
  const of = (list, severity) => (list ?? []).filter(f => f.severity === severity);
  const atMinimum = whatIf ? {
    pages: KDP_MIN_PAGES, note: 'validator re-run with pageCount 24 only to list its other rules; not gated', status: whatIf.status,
    errors: of(whatIf.findings, 'error').length, unknowns: of(whatIf.findings, 'unknown').length, warnings: of(whatIf.findings, 'warning').length,
    errorCodes: [...new Set(of(whatIf.findings, 'error').map(validatorCode))], unknownCodes: [...new Set(of(whatIf.findings, 'unknown').map(f => f.code))],
  } : null;
  const value = {
    status: kdp.status, pages: kdp.pages, ...(minimum ? { belowMinimum: minimum, minimumPages: KDP_MIN_PAGES } : {}),
    validatorErrors: validatorCodes.length, validatorErrorCodes: validatorCodes, harnessErrors: harnessCodes.length, harnessErrorCodes: harnessCodes,
    unknowns: whatIf ? 'n/a' : of(findings, 'unknown').length, warnings: whatIf ? 'n/a' : of(findings, 'warning').length,
    ...(atMinimum ? { atMinimumPageCount: atMinimum } : {}),
  };
  const list = codes => codes.join(', ') || 'none';
  const reason = minimum
    ? `${minimum}: the validator rejects the profile, so its unknowns are n/a; harness errors: ${list(harnessCodes)}. Validator at ${KDP_MIN_PAGES} pages (not gated): ${atMinimum.errors} error(s) ${list(atMinimum.errorCodes)}, ${atMinimum.unknowns} unknown(s)`
    : `validator ${kdp.status}, errors: ${list(validatorCodes)}; harness errors: ${list(harnessCodes)}`;
  return { value, reason, causes, interiorCauses, belowMinimum };
}

function scoreBook(result, generationFailure) {
  if (generationFailure) {
    return {
      K1: measured('K1', { site: { pass: false, sev: 1, reason: `no saved book: ${generationFailure}`, failureClass: 'generation failed' } }),
      K2: notMeasured('K2', 'no saved book (generation failed)'), K3: notMeasured('K3', 'no saved book (generation failed)'),
    };
  }
  if (!result.ok) return Object.fromEntries(['K1', 'K2', 'K3'].map(id => [id, notMeasured(id, `measureBook failed: ${result.error}`)]));
  const r = result.value, p = r.pass;
  const k1 = bookK1(r.kdp);
  return {
    K1: p.K1 === null ? notMeasured('K1', errorText(r.errors) ?? 'validator not run') : measured('K1', { site: { pass: p.K1, value: k1.value, sev: k1.causes.length / 3, reason: p.K1 ? null : k1.reason, ...(k1.belowMinimum && !k1.interiorCauses.length ? { failureClass: 'KDP page count (below the 24-page minimum)' } : {}) } }),
    // No wrap cover is generated anywhere: a product capability gap, the same for
    // every book. It still fails K2 per book; summary.mjs reports it once per set.
    K2: measured('K2', { site: { pass: p.K2, value: { wrapPresent: r.cover.wrapPresent, expected: r.cover.expected ? { widthIn: r.cover.expected.coverWidthIn, heightIn: r.cover.expected.coverHeightIn, spineIn: r.cover.expected.spineWidthIn } : null }, sev: 1, reason: p.K2 ? null : r.cover.reason ?? `wrap cover off by ${JSON.stringify(r.cover.deltaIn)} in`, ...(r.cover.wrapPresent ? {} : { failureClass: 'product gap: no KDP wrap cover', setLevel: 'product capability gap: no wrap cover (front, spine, back) is generated for any book' }) } }),
    K3: p.K3 === null ? notMeasured('K3', errorText(r.errors, 'book overflow', 'launch') ?? 'not measured') : measured('K3', { site: { pass: p.K3, value: r.overflow.count, sev: r.overflow.count / 10, reason: r.overflow.count ? `${r.overflow.count} element(s) on ${r.overflow.pagesAffected} page(s): ${r.overflow.pages.slice(0, 3).map(item => `p${item.page ?? '?'} ${item.kind} ${item.reason}`).join('; ')}` : null } }),
  };
}

async function measureDocument(desc, ctx, slot, outDir) {
  const kind = desc.kind;
  const document = tryJson(path.join(desc.itemDir, 'document.json'));
  const exportsDir = path.join(desc.itemDir, 'exports');
  const errors = [];
  if (!document) {
    const failure = desc.status?.ok === false ? `${desc.status.code ?? 'failed'}: ${desc.status.message ?? ''}` : 'document.json missing';
    return { metrics: kind === 'book' ? scoreBook(null, failure) : scoreDeck(null, failure), result: null, errors, generationFailure: failure };
  }
  const file = name => (existsSync(path.join(exportsDir, name)) ? path.join(exportsDir, name) : undefined);
  const images = documentImages(desc.itemDir);
  const run = kind === 'book'
    ? async () => measureBook({ document, pdfPath: file('document.pdf'), coverPdfPath: file('cover.pdf'), browser: await slot.get(), shotsDir: path.join(outDir, 'shots'), images })
    : async () => measureDeck({ document, pptxPath: file('document.pptx'), pdfPath: file('document.pdf'), browser: await slot.get(), shotsDir: path.join(outDir, 'shots'), images });
  const result = await timed(kind === 'book' ? 'measureBook' : 'measureDeck', kind === 'book' ? ctx.timeouts.book : ctx.timeouts.deck, run, { onTimeout: () => slot.close() });
  if (!result.ok) errors.push({ instrument: kind === 'book' ? 'measureBook' : 'measureDeck', message: result.error, timedOut: result.timedOut });
  else for (const error of result.value.errors ?? []) errors.push({ instrument: `${kind === 'book' ? 'measureBook' : 'measureDeck'}.${error.step}`, message: error.message });
  if (!images && document.assets?.length) errors.push({ instrument: 'images', message: `${document.assets.length} document image(s) not available on disk; placeholders rendered` });
  return { metrics: kind === 'book' ? scoreBook(result) : scoreDeck(result), result, errors };
}

function documentKeyNumbers(kind, result) {
  const r = result?.ok ? result.value : null;
  if (!r) return {};
  if (kind === 'book') {
    const k1 = bookK1(r.kdp).value;
    return {
      pages: r.kdp.pages, kdpStatus: r.kdp.status, belowMinimum: k1.belowMinimum ?? null,
      validatorErrors: k1.validatorErrors, validatorErrorCodes: k1.validatorErrorCodes, harnessErrors: k1.harnessErrors, harnessErrorCodes: k1.harnessErrorCodes,
      unknowns: k1.unknowns, rejected: Boolean(k1.belowMinimum),
      atMinimumPageCount: k1.atMinimumPageCount ? { errors: k1.atMinimumPageCount.errors, unknowns: k1.atMinimumPageCount.unknowns, warnings: k1.atMinimumPageCount.warnings } : null,
      wrapCover: r.cover.wrapPresent, overflow: r.overflow.count,
    };
  }
  return { slides: r.slides, pptx: Boolean(r.pptx), wordRate: r.pptx?.editableTextRate ?? null, charRate: r.pptx?.charRate ?? null, nativeChartRate: r.pptx?.nativeChartRate ?? null, overflowSlides: r.overflow?.count ?? null, fitWarnings: r.fitWarnings?.count ?? null, rotationViolations: r.rotation.violations.length, notesRate: r.notes.rate };
}

/**
 * Machine-dependent findings of a deck or book (deck.mjs / book.mjs flags)
 * with the fonts involved: what the fonts installed on THIS machine changed
 * in the render or the export. They fail no metric; summary.md lists them
 * under "Environment findings" so a reader can tell a product defect from
 * the measuring machine.
 */
function documentEnvironment(kind, result) {
  const r = result?.ok ? result.value : null;
  if (!r) return [];
  const out = [];
  const fonts = list => [...new Set((list ?? []).filter(Boolean))];
  if (kind === 'book') {
    const f = r.kdp?.pdfFonts;
    if (f?.machineDependent) out.push({ flag: 'machine-dependent export', scope: 'book PDF', fonts: fonts([...(f.systemFonts ?? []), ...(f.otherFonts ?? [])]), note: f.note ?? null });
  } else {
    const render = r.overflow?.fonts;
    if (render?.machineDependentRender) out.push({ flag: 'machine-dependent render', scope: 'deck render (P3)', fonts: fonts(render.systemFonts), note: render.note ?? null });
    const pdf = r.pdf?.fontFaces;
    if (pdf?.machineDependent) out.push({ flag: 'machine-dependent export', scope: 'deck PDF', fonts: fonts([...(pdf.systemFonts ?? []), ...(pdf.otherFonts ?? [])]), note: pdf.note ?? null });
    const pptx = r.pptx?.fonts;
    if (pptx?.finding) out.push({ flag: 'pptx fonts not embedded (autofit may shrink text)', scope: 'deck PPTX', fonts: fonts(pptx.faces), note: pptx.finding });
  }
  // Any flag the instrument raised that the cases above do not describe is still listed.
  for (const flag of r.flags ?? []) if (!out.some(entry => entry.flag === flag)) out.push({ flag, scope: kind, fonts: [], note: null });
  return out;
}

// ---------------------------------------------------------------------------
// Items

function baseRecord(desc, ctx) {
  return {
    schemaVersion: 1, itemId: desc.id, id: desc.id, kind: desc.kind, title: desc.title, direction: desc.direction,
    briefId: desc.briefId, relatedBriefId: desc.relatedBriefId, brief: desc.brief,
    set: { setId: ctx.set.setId, type: ctx.set.type, dir: rel(ctx.set.dir) }, origin: desc.item?.origin ?? null, item: desc.item,
    qualityBar: QUALITY_BAR_VERSION, measuredAt: new Date().toISOString(),
    // Which code produced this record: git commit, dirty tree, sha256 of the harness sources.
    provenance: ctx.provenance ?? null,
  };
}

function websiteRecord(desc, ctx, entry) {
  const { raw } = entry;
  const identity = identityOf(raw.page, raw.pageBlocked);
  const metrics = scoreWebsite(raw);
  const status = raw.competitor ? (desc.status?.ok === false ? 'capture-failed' : 'measured') : !raw.sourcePresent ? 'not-generated' : 'measured';
  const page = raw.page;
  const materialize = raw.materialize?.ok ? { ...raw.materialize.value, paths: Object.fromEntries(Object.entries(raw.materialize.value.paths).map(([key, value]) => [key, value && rel(value)])) } : raw.materialize ?? null;
  return {
    ...baseRecord(desc, ctx), status,
    statusReason: raw.pageBlocked ?? (desc.status?.message || null),
    durationMs: entry.ms,
    metrics, identity, keyNumbers: websiteKeyNumbers(metrics, raw),
    instruments: {
      materialize, weight: raw.weight ? (raw.weight.ok ? raw.weight.value : { error: raw.weight.error }) : null,
      page: page ?? null, htmlvalidate: raw.htmlvalidate ? (raw.htmlvalidate.ok ? { errors: raw.htmlvalidate.value.errors, warnings: raw.htmlvalidate.value.warnings, byRule: raw.htmlvalidate.value.byRule, basis: raw.htmlvalidate.basis } : { error: raw.htmlvalidate.error }) : null,
      lighthouse: raw.lighthouse ? (raw.lighthouse.error ? raw.lighthouse : { runs: raw.lighthouse.runs, requestedRuns: raw.lighthouse.requestedRuns, attempts: raw.lighthouse.attempts, failedRuns: raw.lighthouse.failedRuns, exploratory: raw.lighthouse.exploratory, formFactor: raw.lighthouse.formFactor, median: raw.lighthouse.median, networkDependent: raw.lighthouse.networkDependent, url: raw.lighthouse.url, errors: raw.lighthouse.errors, file: 'lighthouse.json' }) : null,
    },
    instrumentErrors: entry.errors,
    files: { shots: (page?.shots ?? []).map(shot => shot.file ?? null).filter(Boolean), lighthouse: raw.lighthouse?.runs ? 'lighthouse.json' : null, htmlvalidate: raw.htmlvalidate?.ok ? 'htmlvalidate.json' : null, axe: page ? ctx.options.widths.map(width => `axe-${width}.json`) : [] },
  };
}

async function measureItem(desc, ctx, slot) {
  const started = performance.now();
  const outDir = ensureDir(path.join(ctx.outDir, safeId(desc.id)));
  writeJson(path.join(outDir, 'item.json'), desc.item ?? { id: desc.id, kind: desc.kind });
  try {
    if (desc.kind === 'website') {
      const { raw, errors } = desc.competitor ? await measureCompetitor(desc, ctx, slot, outDir) : await measureOwnWebsite(desc, ctx, slot, outDir);
      const entry = { desc, raw, errors, outDir, ms: elapsed(started) };
      writeJson(path.join(outDir, 'metrics.json'), websiteRecord(desc, ctx, entry));
      return entry;
    }
    if (desc.kind === 'presentation' || desc.kind === 'book') {
      const { metrics, result, errors, generationFailure } = await measureDocument(desc, ctx, slot, outDir);
      const record = {
        ...baseRecord(desc, ctx), status: generationFailure ? 'not-generated' : 'measured', statusReason: generationFailure ?? (result?.ok ? null : result?.error ?? null), durationMs: elapsed(started),
        metrics, keyNumbers: documentKeyNumbers(desc.kind, result), environment: documentEnvironment(desc.kind, result),
        instruments: { [desc.kind === 'book' ? 'book' : 'deck']: result?.ok ? result.value : result ? { error: result.error } : null },
        instrumentErrors: errors,
        files: { shots: (result?.value?.shots ?? []).map(shot => (typeof shot === 'string' ? shot : shot?.file ?? null)).filter(Boolean).map(file => (path.isAbsolute(file) ? rel(file) : file)) },
      };
      writeJson(path.join(outDir, 'metrics.json'), record);
      return { desc, record, outDir, ms: record.durationMs };
    }
    throw new Error(`unknown item kind "${desc.kind}"`);
  } catch (error) {
    // Measure itself broke on this item: record it and carry on with the set.
    const ids = desc.kind === 'website' ? WEBSITE_IDS : desc.kind === 'book' ? ['K1', 'K2', 'K3'] : desc.kind === 'presentation' ? ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] : [];
    const reason = `measure crashed on this item: ${clip(error?.message ?? error)}`;
    const record = {
      ...baseRecord(desc, ctx), status: 'error', statusReason: reason, durationMs: elapsed(started),
      metrics: Object.fromEntries(ids.map(id => [id, notMeasured(id, reason)])), identity: { error: reason }, keyNumbers: {},
      instruments: {}, instrumentErrors: [{ instrument: 'measure', message: clip(error?.stack ?? error, 1000) }],
    };
    writeJson(path.join(outDir, 'metrics.json'), record);
    return { desc, record, outDir, ms: record.durationMs, crashed: true };
  }
}

async function pool(list, concurrency, worker) {
  let next = 0;
  const results = new Array(list.length);
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, async (_, workerIndex) => {
    while (next < list.length) {
      const index = next++;
      results[index] = await worker(list[index], index, workerIndex);
    }
  }));
  return results;
}

function progressLine(entry) {
  const record = entry.record ?? readJson(path.join(entry.outDir, 'metrics.json'));
  const fails = Object.entries(record.metrics ?? {}).filter(([, metric]) => metric.status === 'fail').map(([id]) => id);
  const na = Object.entries(record.metrics ?? {}).filter(([, metric]) => metric.status === 'n/a').map(([id]) => id);
  return `${record.itemId} [${record.kind}] ${record.status} in ${(entry.ms / 1000).toFixed(1)} s; fails ${fails.join(' ') || 'none'}${na.length ? `; n/a ${na.join(' ')}` : ''}${record.instrumentErrors?.length ? `; ${record.instrumentErrors.length} instrument error(s)` : ''}`;
}

// ---------------------------------------------------------------------------
// Main

/**
 * Measure a set. Returns { outDir, summary, diversity, records }.
 * @param {ReturnType<typeof parseCli>} options
 */
export async function measureSet(options) {
  const startedAt = new Date();
  const started = performance.now();
  const set = discoverSet(options.setDir);
  const outDir = ensureDir(options.out ?? path.join(MEASURE, set.setId));
  const timeouts = Object.fromEntries(Object.entries(TIMEOUTS).map(([key, value]) => [key, Math.round(value * options.timeoutScale)]));
  const provenance = harnessProvenance();
  provenance.tools.chromium = await chromiumVersion(chromium);
  const ctx = { options, set, outDir, timeouts, provenance };
  let items = set.items;
  if (options.kind) items = items.filter(item => item.kind === options.kind);
  if (options.only.length) {
    const unknown = options.only.filter(id => !set.items.some(item => item.id === id));
    if (unknown.length) throw usageError(`--only: no such item(s) in ${rel(set.dir)}: ${unknown.join(', ')}`);
    items = items.filter(item => options.only.includes(item.id));
  }
  if (!items.length) throw usageError('Nothing to measure after --kind/--only filters');
  console.log(`measure ${set.setId}: ${items.length} item(s) from ${rel(set.dir)} -> ${rel(outDir)} (concurrency ${options.concurrency}, widths ${options.widths.join(',')}, lighthouse runs ${options.lighthouseRuns}${options.skip.length ? `, skip ${options.skip.join(',')}` : ''})`);
  console.log(`  harness ${provenance.harness.sha256.slice(0, 12)} (${provenance.harness.files} files, ${provenance.harness.gitState ?? 'git state unknown'}) at ${provenance.commit?.slice(0, 10) ?? 'no commit'}${provenance.dirty ? ' (dirty tree)' : ''}`);
  const tools = provenance.tools;
  console.log(`  node ${tools.node}, ${tools.os.type} ${tools.os.release}, Chromium ${tools.chromium.version ?? '?'}, Lighthouse ${tools.lighthouse}, axe-core ${tools.axeCore}, html-validate ${tools.htmlValidate}`);

  // Phase 1: everything but Lighthouse, `concurrency` items at a time, one browser per worker.
  const slots = Array.from({ length: options.concurrency }, () => new BrowserSlot());
  let entries;
  try {
    entries = await pool(items, options.concurrency, async (desc, index, workerIndex) => {
      const entry = await measureItem(desc, ctx, slots[workerIndex]);
      console.log(`  [${index + 1}/${items.length}] ${progressLine(entry)}`);
      return entry;
    });
  } finally {
    await Promise.all(slots.map(slot => slot.close()));
  }

  // Phase 2: Lighthouse, one website at a time with nothing else running.
  const websites = entries.filter(entry => entry.raw && !entry.crashed);
  const lighthouseNeeded = !options.skip.includes('lighthouse') && websites.some(entry => !entry.raw.competitor || options.lighthouseLive);
  if (lighthouseNeeded) {
    console.log(`Lighthouse: ${websites.length} site(s), ${options.lighthouseRuns} run(s) each, serial`);
    for (const entry of websites) {
      const lhStarted = performance.now();
      const errors = await lighthouseFor(entry, ctx);
      entry.errors.push(...errors);
      entry.ms += elapsed(lhStarted);
      writeJson(path.join(entry.outDir, 'metrics.json'), websiteRecord(entry.desc, ctx, entry));
      const lh = entry.raw.lighthouse;
      const m = lh?.median;
      if (lh) console.log(`  ${entry.desc.id}: ${lh.error ? `error ${lh.error}` : !lh.runs ? `no valid run (${lh.runtimeErrors?.join(', ') || lh.errors?.[0]})` : `perf ${m.performance}, a11y ${m.accessibility}, SEO* ${m.seoPlatformAdjusted}, BP ${m.bestPractices}, LCP ${Math.round(m.lcpMs)} ms`} (${(elapsed(lhStarted) / 1000).toFixed(1)} s)`);
    }
  } else if (websites.length) {
    // Rewrite so the "phase not reached" reason becomes the real one (skipped / competitor).
    for (const entry of websites) writeJson(path.join(entry.outDir, 'metrics.json'), websiteRecord(entry.desc, ctx, entry));
  }

  const records = entries.map(entry => readJson(path.join(entry.outDir, 'metrics.json')));
  const siteRecords = records.filter(record => record.kind === 'website');
  const diversity = siteRecords.length ? measureDiversity(siteRecords) : null;
  if (diversity) writeJson(path.join(outDir, 'diversity.json'), diversity);
  const finishedAt = new Date();
  const summary = buildSummary({
    setId: set.setId, set: { type: set.type, dir: rel(set.dir), runId: set.runId ?? null, tool: set.tool ?? null }, items: records, diversity,
    run: {
      startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), wallMs: elapsed(started), missing: set.missing, provenance,
      options: { widths: options.widths, lighthouseRuns: options.lighthouseRuns, skip: options.skip, only: options.only, kind: options.kind, concurrency: options.concurrency, lighthouseLive: options.lighthouseLive, timeoutScale: options.timeoutScale, timeouts },
    },
  });
  const files = writeSummary(outDir, summary);
  console.log(`done in ${(elapsed(started) / 60000).toFixed(1)} min: ${rel(files.md)}`);
  return { outDir, summary, diversity, records };
}

const USAGE = `usage: node scripts/eval/measure.mjs <setDir> [--out <dir>] [--widths 360,390,820,1440] [--lighthouse-runs 1]
       [--skip lighthouse,htmlvalidate,typecheck,vitals] [--only <id,...>] [--kind website|presentation|book]
       [--concurrency 2] [--lighthouse-live] [--timeout-scale 1]`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // A stray rejection inside one instrument must not take the whole set down.
  process.on('unhandledRejection', error => console.warn(`unhandled rejection (ignored): ${clip(error?.message ?? error)}`));
  let options;
  try { options = parseCli(); } catch (error) { console.error(error.message); console.error(USAGE); process.exit(2); }
  if (options.help) { console.log(USAGE); process.exit(options.asked ? 0 : 2); }
  measureSet(options).catch(error => { console.error(error?.usage ? error.message : error?.stack ?? error); process.exitCode = error?.usage ? 2 : 1; });
}

