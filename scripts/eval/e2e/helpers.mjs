// Shared pieces of the studio e2e suite: the local origin and fixture routes,
// sign-in, the in-page instruments (axe-core, web-vitals, overflow) and the
// gate that judges a measurement against baseline.json (default) or the
// QUALITY_BAR (E2E_GATE=launch). Results land in outputs/eval/e2e/<stamp>/.
import os from 'node:os';
import path from 'node:path';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { OUT, EVAL_DIR, writeJson, readJson, exists, stamp } from '../lib/paths.mjs';
import { qualityFixture, assertLocalOrigin, isolatedStack } from '../lib/stack.mjs';
import { STUDIO, QUALITY_BAR_VERSION } from '../lib/thresholds.mjs';

export { rel } from '../lib/paths.mjs';

// pg comes from the app's own node_modules (resolved up the tree); used read-only.
const require = createRequire(import.meta.url);

export const ORIGIN = assertLocalOrigin('http://127.0.0.1:3210');
export const E2E_DIR = path.join(EVAL_DIR, 'e2e');
export const BASELINE_FILE = path.join(E2E_DIR, 'baseline.json');
// playwright.config.mjs sets E2E_STAMP before workers start, so every worker
// of one run writes into the same folder.
export const RUN_STAMP = process.env.E2E_STAMP || stamp();
export const RUN_DIR = path.join(OUT, 'e2e', RUN_STAMP);
// Outside the repo on purpose (see writeResult).
export const STAGE_DIR = path.join(os.tmpdir(), 'makeborne-e2e', RUN_STAMP);

export const GATE = (process.env.E2E_GATE || 'baseline').toLowerCase();
if (!['baseline', 'launch'].includes(GATE)) throw new Error(`E2E_GATE must be "baseline" or "launch", not "${GATE}"`);
export const WRITE_BASELINE = process.env.E2E_WRITE_BASELINE === '1';

export const AXE_PATH = path.join(EVAL_DIR, 'node_modules', 'axe-core', 'axe.min.js');
export const WEB_VITALS_PATH = path.join(EVAL_DIR, 'node_modules', 'web-vitals', 'dist', 'web-vitals.iife.js');
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
export const IMPACTS = ['critical', 'serious', 'moderate', 'minor'];

/** Fixture routes. The password stays inside signIn() and is never returned or logged. */
export function fixtureRoutes() {
  const { workspaceId, cases } = qualityFixture();
  const { artifactId, projectId } = cases.restaurant;
  return { workspaceId, artifactId, projectId, editorPath: `/studio?tab=projects&workspace=${workspaceId}&artifact=${artifactId}` };
}

export const FIXTURE = fixtureRoutes();

export async function signIn(page) {
  const { email, password } = qualityFixture();
  await page.goto('/login');
  await page.locator('#account-email').fill(email);
  await page.locator('#account-password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(url => url.pathname === '/studio', { timeout: 120_000 });
}

let stateOnce = null;
/** One sign-in per worker; the storage state stays in memory (no session cookies on disk). */
export function signedInState(browser) {
  stateOnce ??= (async () => {
    const context = await browser.newContext({ baseURL: ORIGIN });
    try {
      const page = await context.newPage();
      await signIn(page);
      return await context.storageState();
    } finally {
      await context.close();
    }
  })();
  return stateOnce;
}

/** JSON request to the app's own API as the signed-in page (same cookies, same origin). */
export async function appApi(page, method, route, data) {
  const headers = { Origin: ORIGIN, Accept: 'application/json' };
  if (method !== 'GET') headers['Idempotency-Key'] = randomUUID();
  const response = await page.request.fetch(new URL(route, ORIGIN).href, { method, headers, data });
  const body = await response.json().catch(() => null);
  return { status: response.status(), ok: response.ok(), body };
}

// The release-auth database predates some migrations. Read-only check of the
// client-review RPCs the review page calls, so a failure there can be told
// apart from an app regression. Returns the RPCs whose live signature lacks
// the parameter the app sends.
const REVIEW_RPCS = Object.freeze({
  makeborne_add_client_review_comment: 'p_version',
  makeborne_decide_client_review: 'p_version',
});
export const REVIEW_MIGRATION = '20261013160000_client_review_view_integrity';

export async function reviewSchemaGap() {
  const { Client } = require('pg');
  const client = new Client({ connectionString: isolatedStack().dbUrl });
  await client.connect();
  try {
    await client.query('begin read only');
    const { rows } = await client.query(
      `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any($1)`,
      [Object.keys(REVIEW_RPCS)],
    );
    const missing = Object.entries(REVIEW_RPCS)
      .filter(([name, parameter]) => !rows.some(row => row.name === name && row.args.includes(parameter)))
      .map(([name]) => name);
    // Publish tab reads this table (migration 20261013180000_trusted_publication_preparations).
    const { rows: [tables] } = await client.query(`select to_regclass('makeborne_private.publication_preparations') is not null as preparations`);
    return { missing, migration: REVIEW_MIGRATION, signatures: rows, publicationPreparationsTable: tables.preparations };
  } finally {
    await client.query('rollback').catch(() => {});
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// Pages under test (S2–S5). `ready` waits for the content a user came for, so
// the measurement starts from the same settled state on every run.
export const PAGES = Object.freeze([
  { id: 'home', path: '/', signedIn: false, ready: page => page.locator('h1').first().waitFor({ timeout: 120_000 }) },
  {
    id: 'studio', path: '/studio', signedIn: true,
    ready: async page => {
      // Returning users (S1 library): one 'Projects' heading, then the list of saved projects.
      await page.getByRole('heading', { level: 1, name: 'Projects', exact: true }).waitFor({ timeout: 120_000 });
      await page.getByRole('list', { name: /^\d+ projects?$/ }).waitFor({ timeout: 60_000 });
    },
  },
  {
    id: 'editor', path: FIXTURE.editorPath, signedIn: true,
    ready: async page => {
      await page.getByRole('navigation', { name: 'Project view' }).waitFor({ timeout: 120_000 });
      // The preview may sit below the fold on a phone; it only has to exist.
      await page.frameLocator('iframe[title="Website preview"]').locator('h1').first().waitFor({ state: 'attached', timeout: 60_000 });
    },
  },
]);
export const WIDTHS = Object.freeze([{ width: 375, height: 812 }, { width: 1440, height: 900 }]);
export const TOOLBAR_VIEWPORT = Object.freeze({ width: 800, height: 900 });
export const pageById = id => PAGES.find(entry => entry.id === id);

/** First request of a route compiles it in `next dev`; warm it so vitals time the page, not the compiler. */
export async function warm(browser, entries, state) {
  const started = Date.now();
  const context = await browser.newContext({ baseURL: ORIGIN, storageState: state });
  try {
    const page = await context.newPage();
    for (const entry of entries) {
      await page.goto(entry.path);
      await entry.ready(page);
    }
  } finally {
    await context.close();
  }
  return Date.now() - started;
}

// ---------------------------------------------------------------------------
// In-page instruments.

/** Register web-vitals before any page script runs; values collect in window.__e2eVitals (top frame only). */
export async function installVitals(context) {
  // Playwright wraps init scripts in a function, so the IIFE's top-level
  // `var webVitals` would stay local: publish it on window explicitly.
  await context.addInitScript({ content: `${readFileSync(WEB_VITALS_PATH, 'utf8')}\n;window.webVitals = webVitals;` });
  await context.addInitScript(() => {
    if (window.top !== window || !window.webVitals) return;
    const store = (window.__e2eVitals = { layoutShiftSum: 0 });
    const keep = metric => { store[metric.name] = { value: metric.value, rating: metric.rating, entries: metric.entries.length }; };
    for (const on of ['onCLS', 'onLCP', 'onFCP', 'onTTFB']) window.webVitals[on](keep, { reportAllChanges: true });
    // Raw sum of unexpected shifts: an upper bound if web-vitals has not reported CLS yet.
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) store.layoutShiftSum += entry.value;
      }).observe({ type: 'layout-shift', buffered: true });
    } catch { /* layout-shift unsupported */ }
  });
}

/** Scroll the page top to bottom with the wheel (so every reveal fires), then back to the top. */
export async function scrollThrough(page) {
  const { width, height } = page.viewportSize();
  await page.mouse.move(width / 2, Math.min(height - 40, height * 0.6));
  for (let step = 0; step < 14; step++) {
    await page.mouse.wheel(0, Math.round(height * 0.8));
    await page.waitForTimeout(100);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

export async function readVitals(page) {
  const vitals = await page.evaluate(() => window.__e2eVitals ?? null);
  if (!vitals) return { cls: null, clsSource: 'unavailable', lcpMs: null, fcpMs: null, ttfbMs: null };
  return {
    cls: vitals.CLS ? round(vitals.CLS.value, 4) : round(vitals.layoutShiftSum, 4),
    clsSource: vitals.CLS ? 'web-vitals' : 'layout-shift sum',
    lcpMs: vitals.LCP ? Math.round(vitals.LCP.value) : null,
    fcpMs: vitals.FCP ? Math.round(vitals.FCP.value) : null,
    ttfbMs: vitals.TTFB ? Math.round(vitals.TTFB.value) : null,
  };
}

export const overflowPx = page => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));

/** Editor toolbar (audit S1 defect #2): the tab strip must not be wider than its box. */
export function toolbarState(page) {
  return page.evaluate(() => {
    const pick = selector => {
      const element = document.querySelector(selector);
      if (!element) return null;
      return { selector, width: Math.round(element.getBoundingClientRect().width), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, clipped: element.scrollWidth > element.clientWidth };
    };
    return { nav: pick('nav[aria-label="Project view"]'), workbench: pick('.workbench-toolbar') };
  });
}

/**
 * axe-core on the studio's own document. The preview iframe (the generated
 * site, measured by W6 elsewhere) and the Next dev-tools portal are excluded.
 */
export async function runAxe(page) {
  await page.addScriptTag({ path: AXE_PATH });
  const result = await page.evaluate(async tags => {
    const run = await window.axe.run({ exclude: [['nextjs-portal']] }, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'], iframes: false });
    return {
      engine: run.testEngine.version,
      violations: run.violations.map(violation => ({
        id: violation.id, impact: violation.impact, help: violation.help, nodes: violation.nodes.length,
        targets: violation.nodes.slice(0, 6).map(node => node.target.join(' ')),
      })),
    };
  }, AXE_TAGS);
  const rules = Object.fromEntries(IMPACTS.map(impact => [impact, 0]));
  const nodes = Object.fromEntries(IMPACTS.map(impact => [impact, 0]));
  for (const violation of result.violations) {
    rules[violation.impact] = (rules[violation.impact] ?? 0) + 1;
    nodes[violation.impact] = (nodes[violation.impact] ?? 0) + violation.nodes;
  }
  return { ...result, rules, nodes };
}

// ---------------------------------------------------------------------------
// Gate. Each metric has the QUALITY_BAR threshold (bar) and a regression rule
// against the recorded baseline. Default gate: fail only on regression (a value
// that misses the bar AND is worse than the baseline beyond its tolerance).
// E2E_GATE=launch: fail when a launch-tier (L) metric misses the bar.
export const METRICS = Object.freeze({
  axeCritical: { label: 'axe critical rules', ref: 'S2', tier: 'L', meetsBar: v => v <= STUDIO.S2.critical, notWorse: (v, b) => v <= b, bar: `<= ${STUDIO.S2.critical}` },
  axeSerious: { label: 'axe serious rules', ref: 'S2', tier: 'L', meetsBar: v => v <= STUDIO.S2.serious, notWorse: (v, b) => v <= b, bar: `<= ${STUDIO.S2.serious}` },
  lowContrastCount: { label: 'text below AA contrast', ref: 'S3', tier: 'L', meetsBar: v => v <= STUDIO.S3.max, notWorse: (v, b) => v <= b, bar: `<= ${STUDIO.S3.max}` },
  // Lab CLS on a dev server moves by a few thousandths between runs.
  cls: { label: 'CLS', ref: 'S4', tier: 'L', meetsBar: v => v < STUDIO.S4.clsMax, notWorse: (v, b) => v <= b + 0.02, bar: `< ${STUDIO.S4.clsMax}` },
  // LCP on `next dev` is noisy (unbundled modules); regression means 1.5x plus 0.5 s.
  lcpMs: { label: 'LCP (ms, dev server)', ref: 'S4', tier: 'F', meetsBar: v => v <= STUDIO.S4.lcpMaxMs, notWorse: (v, b) => v <= b * 1.5 + 500, bar: `<= ${STUDIO.S4.lcpMaxMs}` },
  overflowPx: { label: 'horizontal overflow (px)', ref: 'S5', tier: 'L', meetsBar: v => v <= STUDIO.S5.overflowPx, notWorse: (v, b) => v <= b, bar: `<= ${STUDIO.S5.overflowPx}` },
  toolbarClipped: { label: 'editor toolbar clipped', ref: 'S5', tier: 'L', meetsBar: v => v === STUDIO.S5.toolbarClipped, notWorse: (v, b) => !v || b === true, bar: `${STUDIO.S5.toolbarClipped}` },
});

export function readBaseline() {
  return exists(BASELINE_FILE) ? readJson(BASELINE_FILE) : { version: 1, entries: {} };
}

/** Stage measured values as the new baseline for `section/key` (E2E_WRITE_BASELINE=1); flushBaseline() merges them. */
export function writeBaselineEntry(section, key, values) {
  writeJson(path.join(STAGE_DIR, 'baseline', `${section}__${safeName(key)}.json`), { section, key, values });
}

/** Merge staged baseline entries into baseline.json (called from afterAll, after the timed pages). */
export function flushBaseline() {
  const dir = path.join(STAGE_DIR, 'baseline');
  const staged = exists(dir) ? readdirSync(dir).filter(name => name.endsWith('.json')) : [];
  if (!staged.length) return 0;
  const baseline = readBaseline();
  baseline.version = 1;
  baseline.qualityBar = QUALITY_BAR_VERSION;
  baseline.updatedAt = new Date().toISOString();
  baseline.source = `outputs/eval/e2e/${RUN_STAMP}`;
  baseline.measuredOn = `next dev on ${ORIGIN} (development build, provider keys blank), Chromium headless, device scale 1`;
  baseline.entries ??= {};
  for (const name of staged) {
    const { section, key, values } = readJson(path.join(dir, name));
    baseline.entries[section] ??= {};
    baseline.entries[section][key] = values;
    rmSync(path.join(dir, name));
  }
  writeJson(BASELINE_FILE, baseline);
  return staged.length;
}

/**
 * Judge `values` ({metric: number|boolean}) for `section/key`. Returns one row per
 * metric; applies soft expectations so every failing metric of a test is reported.
 */
export function gate(testInfo, expect, section, key, values) {
  const base = readBaseline().entries?.[section]?.[key];
  if (WRITE_BASELINE) writeBaselineEntry(section, key, values);
  const rows = [];
  for (const [metric, value] of Object.entries(values)) {
    const spec = METRICS[metric];
    if (!spec || value === null || value === undefined) continue;
    const baseValue = base?.[metric];
    const meetsBar = spec.meetsBar(value);
    const notWorse = baseValue === undefined ? null : spec.notWorse(value, baseValue);
    const row = { metric, ref: spec.ref, tier: spec.tier, value, bar: spec.bar, meetsBar, baseline: baseValue ?? null, notWorse };
    rows.push(row);
    const where = `${section} ${key} ${spec.label} = ${value}`;
    if (!meetsBar) testInfo.annotations.push({ type: 'gap', description: `${where}; QUALITY_BAR ${spec.ref} wants ${spec.bar}${baseValue !== undefined ? ` (baseline ${baseValue})` : ''}` });
    if (GATE === 'launch') {
      if (spec.tier === 'L') expect.soft(meetsBar, `${where}; launch gate ${spec.ref} wants ${spec.bar}`).toBe(true);
    } else if (!WRITE_BASELINE) {
      expect.soft(baseValue, `${section} ${key}: no baseline for ${metric}; run once with E2E_WRITE_BASELINE=1`).not.toBeUndefined();
      if (baseValue !== undefined) expect.soft(meetsBar || notWorse, `${where}; regressed from baseline ${baseValue} (bar ${spec.bar})`).toBe(true);
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Output files. `next dev` watches the repo, and any write under outputs/ makes
// it rebuild (~1.8 s on the next request), which would land in the next test's
// TTFB and LCP. Per-test results are therefore staged in the OS temp folder and
// copied into outputs/eval/e2e/<stamp>/ by afterAll, after the timed pages.
const safeName = key => key.replace(/[^a-z0-9@-]+/gi, '_');

export function writeResult(group, key, value) {
  writeJson(path.join(STAGE_DIR, group, `${safeName(key)}.json`), value);
}

/**
 * Copy every staged result of `group` into the run folder and merge them into one
 * summary file. Re-run by each worker's afterAll, so the last one is complete
 * even when a failure restarted the worker.
 */
export function writeSummary(group, file, extra = {}) {
  const dir = path.join(STAGE_DIR, group);
  const results = exists(dir) ? readdirSync(dir).filter(name => name.endsWith('.json')).sort().map(name => readJson(path.join(dir, name))) : [];
  for (const result of results) writeJson(path.join(RUN_DIR, group, `${safeName(result.key)}.json`), result);
  const gaps = results.flatMap(result => (result.checks ?? []).filter(row => !row.meetsBar).map(row => `${result.key} ${row.metric}=${row.value} (bar ${row.bar})`));
  const regressions = results.flatMap(result => (result.checks ?? []).filter(row => row.notWorse === false && !row.meetsBar).map(row => `${result.key} ${row.metric}=${row.value} (baseline ${row.baseline})`));
  const summary = {
    stamp: RUN_STAMP, gate: GATE, writtenAt: new Date().toISOString(), qualityBarVersion: QUALITY_BAR_VERSION, qualityBar: STUDIO,
    server: `next dev on ${ORIGIN} (development build, provider keys blank)`, ...extra, gaps, regressions, results,
  };
  writeJson(path.join(RUN_DIR, file), summary);
  if (WRITE_BASELINE) summary.baselineEntriesWritten = flushBaseline();
  return summary;
}

export const round = (value, places = 3) => (typeof value === 'number' ? Number(value.toFixed(places)) : value);
