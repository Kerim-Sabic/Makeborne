// W3/W4/W5/W8 Lighthouse lab scores on a locally served page.
// Chrome is Playwright's Chromium (one pinned binary for every instrument),
// launched through the chrome-launcher that Lighthouse itself bundles. Each run
// gets its own profile directory that we remove ourselves, because on Windows
// Chrome can keep files locked for a moment after taskkill (EPERM/EBUSY).
import path from 'node:path';
import os from 'node:os';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';
import { EVAL_DIR, writeJson } from '../paths.mjs';
import { median } from '../stats.mjs';

const CATEGORIES = ['performance', 'accessibility', 'seo', 'best-practices'];
// Audits the platform writes on publish (title, description, canonical), so
// W5 reads SEO with them excluded (QUALITY_BAR §2, W5).
export const PLATFORM_SEO_AUDITS = Object.freeze(['document-title', 'meta-description', 'canonical']);
const METRIC_AUDITS = ['largest-contentful-paint', 'cumulative-layout-shift', 'total-blocking-time', 'first-contentful-paint', 'speed-index', 'interactive', 'total-byte-weight', 'resource-summary'];
// Heavy, image-only audits that never go into the trimmed report.
const DROP_AUDITS = new Set(['screenshot-thumbnails', 'final-screenshot', 'full-page-screenshot', 'main-thread-tasks', 'network-requests', 'script-treemap-data']);

async function loadLauncher() {
  // Prefer the chrome-launcher nested under lighthouse (the version it was built against).
  const nested = path.join(EVAL_DIR, 'node_modules', 'lighthouse', 'node_modules', 'chrome-launcher', 'dist', 'index.js');
  return existsSync(nested) ? import(pathToFileURL(nested).href) : import('chrome-launcher');
}

function removeQuietly(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    return null;
  } catch (error) {
    // Windows keeps Chrome's profile locked briefly; a leftover temp dir is not a failed measurement.
    return `${error.code ?? 'error'}: could not remove ${dir}`;
  }
}

const score = category => (category?.score == null ? null : Math.round(category.score * 100));

/**
 * Category score recomputed from auditRefs weights without `exclude`, the way
 * Lighthouse scores a category: weighted mean over scored audits; audits that
 * are not applicable, manual or informative carry no weight.
 */
export function categoryScoreWithout(lhr, categoryId, exclude = []) {
  const category = lhr.categories?.[categoryId];
  if (!category) return null;
  let weighted = 0;
  let weights = 0;
  for (const ref of category.auditRefs) {
    if (exclude.includes(ref.id) || !ref.weight) continue;
    const audit = lhr.audits[ref.id];
    if (!audit || ['notApplicable', 'manual', 'informative'].includes(audit.scoreDisplayMode)) continue;
    weighted += ref.weight * (audit.score ?? 0);
    weights += ref.weight;
  }
  return weights ? Math.round((weighted / weights) * 100) : null;
}

function bytesOf(lhr) {
  const items = lhr.audits['resource-summary']?.details?.items ?? [];
  const of = type => items.find(item => item.resourceType === type)?.transferSize ?? null;
  return {
    totalBytes: lhr.audits['total-byte-weight']?.numericValue ?? of('total'),
    jsBytes: of('script'),
  };
}

function summarise(lhr) {
  const seoAll = categoryScoreWithout(lhr, 'seo');
  return {
    performance: score(lhr.categories.performance),
    accessibility: score(lhr.categories.accessibility),
    seo: score(lhr.categories.seo),
    bestPractices: score(lhr.categories['best-practices']),
    seoPlatformAdjusted: categoryScoreWithout(lhr, 'seo', PLATFORM_SEO_AUDITS),
    // Sanity: our recomputation without exclusions must equal Lighthouse's own score.
    seoRecomputedMatches: seoAll === score(lhr.categories.seo),
    lcpMs: lhr.audits['largest-contentful-paint']?.numericValue ?? null,
    cls: lhr.audits['cumulative-layout-shift']?.numericValue ?? null,
    tbtMs: lhr.audits['total-blocking-time']?.numericValue ?? null,
    ...bytesOf(lhr),
    failingAudits: Object.values(lhr.categories).flatMap(category => category.auditRefs
      .filter(ref => ref.weight > 0 && lhr.audits[ref.id]?.score !== null && lhr.audits[ref.id]?.score < 0.9)
      .map(ref => `${category.id}:${ref.id}`)),
    runtimeError: lhr.runtimeError?.code ?? null,
    warnings: lhr.runWarnings ?? [],
  };
}

/** Trimmed LHR: categories and the audits they reference; details kept only where an audit fails. */
function trim(lhr) {
  const keep = new Set(METRIC_AUDITS);
  for (const category of Object.values(lhr.categories)) for (const ref of category.auditRefs) keep.add(ref.id);
  const audits = {};
  for (const id of keep) {
    const audit = lhr.audits[id];
    if (!audit || DROP_AUDITS.has(id)) continue;
    const failing = audit.score !== null && audit.score < 1;
    const { details, ...rest } = audit;
    audits[id] = failing || id === 'resource-summary' ? { ...rest, details } : rest;
  }
  return {
    lighthouseVersion: lhr.lighthouseVersion,
    requestedUrl: lhr.requestedUrl,
    finalDisplayedUrl: lhr.finalDisplayedUrl,
    fetchTime: lhr.fetchTime,
    formFactor: lhr.configSettings?.formFactor,
    throttlingMethod: lhr.configSettings?.throttlingMethod,
    runtimeError: lhr.runtimeError ?? null,
    runWarnings: lhr.runWarnings,
    categories: lhr.categories,
    audits,
  };
}

async function runOnce(url, { formFactor, launcher }) {
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'mb-lighthouse-'));
  const chrome = await launcher.launch({
    chromePath: chromium.executablePath(),
    userDataDir,
    chromeFlags: ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check'],
    logLevel: 'silent',
  });
  let cleanup = null;
  try {
    const flags = { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: CATEGORIES };
    const result = await lighthouse(url, flags, formFactor === 'desktop' ? desktopConfig : undefined);
    if (!result?.lhr) throw new Error('Lighthouse returned no report');
    return { lhr: result.lhr };
  } finally {
    try { await chrome.kill(); } catch (error) { cleanup = `kill: ${error.message}`; }
    cleanup = removeQuietly(userDataDir) ?? cleanup;
    if (cleanup) process.emitWarning(`lighthouse cleanup: ${cleanup}`);
  }
}

/**
 * Run Lighthouse until `runs` valid runs exist and report the median of each
 * number over the valid runs only. One run is an exploratory value; a gate
 * decision needs runs = 3 (QUALITY_BAR §1).
 *
 * A failed run never enters the median: a run that throws, and a run whose
 * report carries a runtimeError (NO_FCP, PAGE_HUNG, ...). The latter still
 * reports numbers (SEO 0, LCP 0, category scores null), which are a failed
 * load, not a measurement. Each failed run is listed in `failedRuns` (and its
 * trimmed report kept in the outFile, marked discarded); up to `retries`
 * extra attempts replace failed runs, so at most runs + retries Lighthouse
 * runs happen. `runs` in the result is the number of valid runs.
 * @param {string} url
 * @param {{runs?: number, formFactor?: 'mobile'|'desktop', outFile?: string, retries?: number}} [options]
 * @returns {Promise<{runs: number, requestedRuns: number, attempts: number, formFactor: string, exploratory: boolean,
 *   median: object, all: object[], errors: string[], failedRuns: object[], runtimeErrors: string[]}>}
 */
export async function runLighthouse(url, { runs = 1, formFactor = 'mobile', outFile, retries = 1 } = {}) {
  const launcher = await loadLauncher();
  const all = [];
  const reports = [];
  const errors = [];
  const failedRuns = [];
  let attempts = 0;
  while (all.length < runs && attempts < runs + retries) {
    attempts++;
    try {
      const { lhr } = await runOnce(url, { formFactor, launcher });
      const summary = summarise(lhr);
      if (summary.runtimeError) {
        failedRuns.push({ attempt: attempts, runtimeError: summary.runtimeError, message: String(lhr.runtimeError?.message ?? '').slice(0, 300) || null });
        reports.push({ discarded: true, ...trim(lhr) });
        continue;
      }
      all.push(summary);
      reports.push(trim(lhr));
    } catch (error) {
      errors.push(error.message);
      failedRuns.push({ attempt: attempts, runtimeError: null, message: String(error.message).slice(0, 300) });
    }
  }
  const keys = ['performance', 'accessibility', 'seo', 'bestPractices', 'seoPlatformAdjusted', 'lcpMs', 'cls', 'tbtMs', 'totalBytes', 'jsBytes'];
  const middle = Object.fromEntries(keys.map(key => [key, median(all.map(run => run[key]))]));
  const result = {
    runs: all.length, requestedRuns: runs, attempts, formFactor, exploratory: all.length < 3, median: middle, all, errors,
    failedRuns, runtimeErrors: failedRuns.map(run => run.runtimeError).filter(Boolean),
  };
  if (outFile) writeJson(outFile, { ...result, reports });
  return result;
}
