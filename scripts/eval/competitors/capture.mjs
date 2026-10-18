// Captures competitor builds of the 8 shared golden briefs so measure.mjs and
// judge.mjs can treat them exactly like Makeborne output: one page load per
// capture, recorded as a HAR with embedded bodies (replayed offline later),
// the rendered DOM, screenshots at the four eval widths and a meta.json.
//
// Read-only by design: no logins, no cookies or credentials, no clicks, no
// typing, no form submissions. Scrolling is the only interaction.
//
//   node scripts/eval/competitors/capture.mjs --urls scripts/eval/competitors/urls.json [--tool lovable] [--brief <id>] [--overwrite]
//   node scripts/eval/competitors/capture.mjs --urls scripts/eval/competitors/urls.example.json --dry-run
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { BRIEFS_DIR, COMPETITORS, readJson, writeJson, ensureDir, rel, stamp } from '../lib/paths.mjs';
import { WIDTHS, HEIGHTS } from '../lib/thresholds.mjs';

export const TOOLS = Object.freeze(['lovable', 'bolt', 'framer', 'base44']);
export const CAPTURES = path.join(COMPETITORS, 'captures');

// Optional per-run notes Kerim can attach to a URL in urls.json; copied into meta.generation.
const GENERATION_KEYS = Object.freeze(['plan', 'model', 'credits', 'toolVersion', 'generatedAt', 'notes']);
const LOAD_TIMEOUT_MS = 60_000;
const IDLE_AFTER_LOAD_MS = 30_000;
const IDLE_AFTER_SCROLL_MS = 15_000;
const IDLE_AFTER_RESIZE_MS = 10_000;

const USAGE = `Usage:
  node scripts/eval/competitors/capture.mjs --urls <urls.json> [--tool ${TOOLS.join('|')}] [--brief <shared brief id>] [--overwrite]
  node scripts/eval/competitors/capture.mjs --urls <urls.json> --dry-run   (validate only, no network)`;

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const captureDir = (tool, briefId) => path.join(CAPTURES, tool, briefId);

/** The shared briefs from the frozen index, each file checked against its recorded hash. */
export function loadSharedBriefs() {
  const index = readJson(path.join(BRIEFS_DIR, 'index.json'));
  const problems = [];
  const briefs = index.shared.map(id => {
    const file = path.join(BRIEFS_DIR, `${id}.json`);
    if (!existsSync(file)) {
      problems.push(`${id}: brief file missing`);
      return { id, title: null, direction: null, sha256: null };
    }
    const raw = readFileSync(file);
    const hash = sha256(raw);
    if (hash !== index.sha256[id]) problems.push(`${id}: file hash differs from index.json (brief edited after freezing?)`);
    const brief = JSON.parse(raw.toString('utf8'));
    return { id, title: brief.title, direction: brief.direction, sha256: hash };
  });
  return { briefs, problems };
}

// Hosts that can never be a published competitor site, or that are clearly
// still the example placeholders.
const LOCAL_HOST = /(^localhost$)|(\.(localhost|local|internal|lan|home|test|invalid)$)/i;
const PLACEHOLDER_HOST = /(replace-me|your-project|\.example$|^example\.(com|net|org)$)/i;

/** Checks one URL without touching the network. Returns {url, placeholder} or {error}. */
export function checkUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { error: 'URL missing' };
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return { error: `not a valid URL: ${raw}` };
  }
  if (url.protocol !== 'https:') return { error: `refusing ${url.protocol} URL: only https is captured` };
  if (url.username || url.password) return { error: 'refusing a URL with embedded credentials' };
  const host = url.hostname;
  if (host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return { error: `refusing IP-literal host ${host}` };
  if (LOCAL_HOST.test(host) || !host.includes('.')) return { error: `refusing local or private host ${host}` };
  return { url: url.href, placeholder: PLACEHOLDER_HOST.test(host) };
}

/** A urls.json value is a URL string or {url, plan, model, credits, toolVersion, generatedAt, notes}. */
function readEntry(value, where, warnings) {
  if (typeof value === 'string') return { raw: value, generation: {} };
  if (!isPlainObject(value)) return { raw: null, generation: {} };
  const generation = {};
  for (const [key, field] of Object.entries(value)) {
    if (key === 'url') continue;
    if (!GENERATION_KEYS.includes(key)) warnings.push(`${where}: unknown field "${key}" ignored (allowed: url, ${GENERATION_KEYS.join(', ')})`);
    else if (['string', 'number'].includes(typeof field)) generation[key] = field;
    else warnings.push(`${where}: field "${key}" must be a string or number; ignored`);
  }
  return { raw: value.url, generation };
}

/**
 * Validates a parsed urls.json against the shared brief ids, without network.
 * Returns {entries: [{tool, briefId, url, generation, placeholder}], errors, warnings, missing: ['tool/briefId']}.
 */
export function validateUrls(urls, sharedIds) {
  const entries = [], errors = [], warnings = [];
  if (!isPlainObject(urls)) return { entries, errors: ['the urls file must be a JSON object keyed by tool'], warnings, missing: [] };
  for (const [tool, byBrief] of Object.entries(urls)) {
    if (!TOOLS.includes(tool)) {
      errors.push(`unknown tool "${tool}" (expected one of ${TOOLS.join(', ')})`);
      continue;
    }
    if (!isPlainObject(byBrief)) {
      errors.push(`${tool}: must be an object mapping shared brief ids to URLs`);
      continue;
    }
    for (const [briefId, value] of Object.entries(byBrief)) {
      const where = `${tool}/${briefId}`;
      if (!sharedIds.includes(briefId)) {
        errors.push(`${where}: not one of the ${sharedIds.length} shared brief ids`);
        continue;
      }
      const { raw, generation } = readEntry(value, where, warnings);
      const checked = checkUrl(raw);
      if (checked.error) {
        errors.push(`${where}: ${checked.error}`);
        continue;
      }
      if (checked.placeholder) warnings.push(`${where}: placeholder URL (${checked.url}); replace it with the published URL before capturing`);
      entries.push({ tool, briefId, url: checked.url, generation, placeholder: checked.placeholder });
    }
  }
  // The same real URL under two briefs or tools is almost always a paste slip.
  const seen = new Map();
  for (const entry of entries.filter(e => !e.placeholder)) {
    const first = seen.get(entry.url);
    if (first) warnings.push(`${entry.tool}/${entry.briefId}: same URL as ${first}`);
    else seen.set(entry.url, `${entry.tool}/${entry.briefId}`);
  }
  const missing = TOOLS.flatMap(tool => sharedIds
    .filter(id => !entries.some(e => e.tool === tool && e.briefId === id))
    .map(id => `${tool}/${id}`));
  return { entries, errors, warnings, missing };
}

/** Waits for network idle; a page that never settles is noted, not failed. */
async function networkIdle(page, timeout) {
  try {
    await page.waitForLoadState('networkidle', { timeout });
    return true;
  } catch {
    return false;
  }
}

async function fontsReady(page) {
  await page.evaluate(() => document.fonts?.ready.then(() => true)).catch(() => false);
}

/**
 * Scrolls top -> bottom -> top in viewport steps so lazy content and scroll
 * reveals fire. Uses programmatic scrolling (no input events). Falls back to
 * the largest inner scroll container for apps that do not scroll the document.
 */
async function scrollThrough(page) {
  return page.evaluate(async () => {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const doc = document.scrollingElement ?? document.documentElement;
    let scroller = doc, kind = 'document';
    if (doc.scrollHeight <= window.innerHeight + 1) {
      const inner = [...document.querySelectorAll('body *')]
        .filter(el => /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1)
        .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      if (inner) [scroller, kind] = [inner, 'element'];
    }
    const view = () => (kind === 'document' ? window.innerHeight : scroller.clientHeight);
    const to = top => (kind === 'document' ? window : scroller).scrollTo({ top, behavior: 'instant' });
    const step = Math.max(200, Math.floor(view() * 0.8));
    let top = 0, steps = 0;
    // scrollHeight is re-read every step: lazy sections grow the page.
    while (steps < 200 && top + view() < scroller.scrollHeight) {
      top += step;
      to(top);
      steps += 1;
      await pause(120);
    }
    await pause(400);
    const scrollHeight = scroller.scrollHeight;
    to(0);
    await pause(300);
    return { scroller: kind, steps, scrollHeight, reachedBottom: top + view() >= scrollHeight };
  });
}

/** Facts about the page that tell whether this is really the generated site. */
async function readSignals(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText ?? '';
    const badge = /(?:edit|made|built|created|powered)\s+(?:with|in|on|by)\s+(?:lovable|bolt(?:\.new)?|framer|base44)/gi;
    const toolHosts = /(^|\.)(lovable\.dev|bolt\.new|framer\.com|base44\.com)$/i;
    const toolLinks = [...document.querySelectorAll('a[href]')]
      .map(a => { try { return new URL(a.href); } catch { return null; } })
      .filter(url => url && toolHosts.test(url.hostname))
      .map(url => url.origin + url.pathname);
    return {
      passwordField: Boolean(document.querySelector('input[type="password"]')),
      challenge: /just a moment|verify you are human|captcha|access denied|attention required/i.test(`${document.title} ${text.slice(0, 2000)}`),
      toolBadges: [...new Set(text.match(badge) ?? [])],
      toolLinks: [...new Set(toolLinks)].slice(0, 10),
      textLength: text.trim().length,
      forms: document.forms.length,
    };
  });
}

function suspicion(meta) {
  const reasons = [];
  if (meta.httpStatus && meta.httpStatus >= 400) reasons.push(`HTTP ${meta.httpStatus}`);
  if (meta.finalUrl && !meta.finalUrl.startsWith('https:')) reasons.push('redirected away from https');
  if (meta.signals?.passwordField) reasons.push('password field present: probably a login wall, not the generated site');
  if (meta.signals?.challenge) reasons.push('bot challenge or access-denied page detected (not bypassed)');
  if ((meta.signals?.textLength ?? 0) < 40) reasons.push('almost no visible text');
  return reasons;
}

/**
 * Captures one tool/brief URL into outDir with a single page load.
 * Returns the meta object that is also written to outDir/meta.json.
 */
export async function captureOne(browser, { tool, briefId, url, generation = {}, briefSha256 = null }, { outDir }) {
  const started = Date.now();
  const notes = [];
  const shotsDir = ensureDir(path.join(outDir, 'shots'));
  const meta = {
    tool, briefId, url, finalUrl: null, capturedAt: new Date().toISOString(), title: null, userAgent: null, notes,
    status: 'failed', httpStatus: null, error: null, briefSha256, generation,
    browser: { name: 'chromium', version: browser.version() },
    capture: {
      loadViewport: { width: 1440, height: HEIGHTS[1440] }, deviceScaleFactor: 1, widths: [...WIDTHS],
      harContent: 'embed', serviceWorkers: 'blocked', networkIdle: { afterLoad: null, afterScroll: null }, scroll: null,
    },
    signals: null,
    files: { har: 'page.har', dom: null, shots: [] },
    durationMs: null,
  };
  const context = await browser.newContext({
    viewport: { width: 1440, height: HEIGHTS[1440] },
    deviceScaleFactor: 1,
    locale: 'en-US',
    acceptDownloads: false,
    // Blocked so every response goes over the network and lands in the HAR.
    serviceWorkers: 'block',
    recordHar: { path: path.join(outDir, 'page.har'), content: 'embed' },
  });
  try {
    const page = await context.newPage();
    // Nothing may open, confirm or prompt on our behalf.
    context.on('page', extra => {
      if (extra === page) return;
      notes.push('closed a popup window the page opened');
      extra.close().catch(() => {});
    });
    page.on('dialog', dialog => {
      notes.push(`dismissed a ${dialog.type()} dialog`);
      dialog.dismiss().catch(() => {});
    });

    const response = await page.goto(url, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS });
    meta.httpStatus = response?.status() ?? null;
    meta.capture.networkIdle.afterLoad = await networkIdle(page, IDLE_AFTER_LOAD_MS);
    if (!meta.capture.networkIdle.afterLoad) notes.push(`network not idle within ${IDLE_AFTER_LOAD_MS / 1000} s of load`);
    meta.capture.scroll = await scrollThrough(page);
    if (meta.capture.scroll.scroller === 'element') notes.push('page scrolls an inner container, not the document: full-page shots may show only the first screen');
    meta.capture.networkIdle.afterScroll = await networkIdle(page, IDLE_AFTER_SCROLL_MS);
    await fontsReady(page);

    writeFileSync(path.join(outDir, 'dom.html'), await page.content());
    meta.files.dom = 'dom.html';
    meta.finalUrl = page.url();
    meta.title = await page.title();
    meta.userAgent = await page.evaluate(() => navigator.userAgent);
    meta.signals = await readSignals(page);

    // Same load, widest first: resize instead of reloading the page.
    for (const width of [...WIDTHS].sort((a, b) => b - a)) {
      await page.setViewportSize({ width, height: HEIGHTS[width] });
      await page.waitForTimeout(500);
      await scrollThrough(page);
      await networkIdle(page, IDLE_AFTER_RESIZE_MS);
      await fontsReady(page);
      for (const [kind, fullPage] of [['first', false], ['full', true]]) {
        const file = `${width}-${kind}.png`;
        try {
          await page.screenshot({ path: path.join(shotsDir, file), fullPage, timeout: 60_000 });
          meta.files.shots.push(`shots/${file}`);
        } catch (error) {
          notes.push(`screenshot ${file} failed: ${error.message.split('\n')[0]}`);
        }
      }
    }
    const reasons = suspicion(meta);
    notes.push(...reasons);
    meta.status = reasons.length ? 'suspect' : 'ok';
  } catch (error) {
    meta.error = error.message.split('\n')[0];
    meta.status = 'failed';
  } finally {
    // Closing the context is what writes page.har.
    await context.close().catch(error => notes.push(`HAR may be incomplete: ${error.message.split('\n')[0]}`));
    meta.durationMs = Date.now() - started;
    writeJson(path.join(outDir, 'meta.json'), meta);
  }
  return meta;
}

function printMatrix(sharedIds, entries) {
  const cell = (tool, id) => {
    const entry = entries.find(e => e.tool === tool && e.briefId === id);
    if (!entry) return '-';
    if (entry.placeholder) return 'placeholder';
    return existsSync(path.join(captureDir(tool, id), 'meta.json')) ? 'captured' : 'url';
  };
  const width = Math.max(...sharedIds.map(id => id.length)) + 2;
  console.log('brief'.padEnd(width) + TOOLS.map(t => t.padEnd(13)).join(''));
  for (const id of sharedIds) console.log(id.padEnd(width) + TOOLS.map(t => cell(t, id).padEnd(13)).join(''));
}

export async function main(argv = process.argv.slice(2)) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        urls: { type: 'string' }, tool: { type: 'string' }, brief: { type: 'string' },
        'dry-run': { type: 'boolean', default: false }, overwrite: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h', default: false },
      },
    }));
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    return 2;
  }
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (!values.urls) {
    console.error(`--urls is required\n${USAGE}`);
    return 2;
  }
  const urlsFile = path.resolve(values.urls);
  if (!existsSync(urlsFile)) {
    console.error(`No such file: ${values.urls} (copy scripts/eval/competitors/urls.example.json to urls.json and fill it in)`);
    return 2;
  }

  const { briefs, problems } = loadSharedBriefs();
  const sharedIds = briefs.map(b => b.id);
  const errors = [...problems];
  if (values.tool && !TOOLS.includes(values.tool)) errors.push(`--tool must be one of ${TOOLS.join(', ')}`);
  if (values.brief && !sharedIds.includes(values.brief)) errors.push(`--brief must be one of the shared ids: ${sharedIds.join(', ')}`);

  let urls;
  try {
    urls = readJson(urlsFile);
  } catch (error) {
    console.error(`${rel(urlsFile)} is not valid JSON: ${error.message}`);
    return 1;
  }
  const report = validateUrls(urls, sharedIds);
  errors.push(...report.errors);
  const hashOf = Object.fromEntries(briefs.map(b => [b.id, b.sha256]));
  const selected = report.entries
    .filter(e => (!values.tool || e.tool === values.tool) && (!values.brief || e.briefId === values.brief))
    .map(e => ({ ...e, briefSha256: hashOf[e.briefId], outDir: captureDir(e.tool, e.briefId) }))
    .map(e => ({ ...e, existing: existsSync(path.join(e.outDir, 'meta.json')) }));

  if (values['dry-run']) {
    printMatrix(sharedIds, report.entries);
    for (const message of errors) console.log(`ERROR   ${message}`);
    for (const message of report.warnings) console.log(`warning ${message}`);
    const ready = selected.filter(e => !e.placeholder);
    console.log(JSON.stringify({
      mode: 'dry-run', urlsFile: rel(urlsFile), sharedBriefs: sharedIds.length, briefHashesOk: problems.length === 0,
      entries: report.entries.length, placeholders: report.entries.filter(e => e.placeholder).length, missing: report.missing.length,
      selected: selected.length, wouldCapture: ready.filter(e => !e.existing || values.overwrite).length, wouldSkip: ready.filter(e => e.existing && !values.overwrite).length,
      errors: errors.length, warnings: report.warnings.length,
    }));
    return errors.length ? 1 : 0;
  }

  // Placeholders are pairs not filled in yet (urls.json can be filled one tool
  // at a time): they are never loaded, only reported.
  const results = selected.filter(e => e.placeholder).map(e => {
    console.log(`skip    ${e.tool}/${e.briefId}: placeholder URL, not captured`);
    return { tool: e.tool, briefId: e.briefId, status: 'placeholder', dir: null };
  });
  const toCapture = selected.filter(e => !e.placeholder);
  if (!toCapture.length) errors.push('no real URL to capture for this selection');
  if (errors.length) {
    for (const message of errors) console.error(`ERROR ${message}`);
    return 1;
  }

  // Imported here so --dry-run works without browsers installed.
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    for (const entry of toCapture) {
      const where = `${entry.tool}/${entry.briefId}`;
      if (entry.existing && !values.overwrite) {
        console.log(`skip    ${where}: already captured (use --overwrite to capture again)`);
        results.push({ tool: entry.tool, briefId: entry.briefId, status: 'skipped', dir: rel(entry.outDir) });
        continue;
      }
      // Keep the earlier capture: move it aside instead of deleting it.
      if (entry.existing) renameSync(entry.outDir, `${entry.outDir}.previous-${stamp()}`);
      ensureDir(entry.outDir);
      console.log(`capture ${where} ${entry.url}`);
      const meta = await captureOne(browser, entry, { outDir: entry.outDir });
      console.log(`        ${meta.status}${meta.error ? `: ${meta.error}` : ''} (${meta.files.shots.length} shots, ${Math.round(meta.durationMs / 1000)} s)`);
      results.push({ tool: entry.tool, briefId: entry.briefId, status: meta.status, dir: rel(entry.outDir), error: meta.error, notes: meta.notes });
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ mode: 'capture', results }, null, 2));
  return results.some(r => r.status === 'failed') ? 1 : 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invokedDirectly) process.exitCode = await main();
