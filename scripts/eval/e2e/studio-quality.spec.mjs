// S2 (axe), S4 (CLS, LCP) and S5 (overflow, toolbar) on '/', '/studio' and the
// Saffron Table editor at 375 and 1440, plus the editor toolbar at 800.
// Each test writes outputs/eval/e2e/<stamp>/quality/<key>.json; afterAll merges
// them into outputs/eval/e2e/<stamp>/studio-quality.json.
import { test, expect } from '@playwright/test';
import {
  ORIGIN, PAGES, WIDTHS, TOOLBAR_VIEWPORT, GATE, pageById, signedInState, warm, installVitals, scrollThrough,
  readVitals, overflowPx, toolbarState, runAxe, gate, writeResult, writeSummary, rel, RUN_DIR,
} from './helpers.mjs';

let warmMs = null;

test.describe('studio quality (S2, S4, S5)', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const state = await signedInState(browser);
    warmMs = await warm(browser, PAGES, state);
  });

  test.afterAll(() => {
    const summary = writeSummary('quality', 'studio-quality.json', { warmMs });
    console.log(`[studio-quality] ${summary.results.length} results, ${summary.gaps.length} gaps to the bar, ${summary.regressions.length} regressions -> ${rel(RUN_DIR)}/studio-quality.json`);
  });

  for (const entry of PAGES) {
    for (const viewport of WIDTHS) {
      const key = `${entry.id}@${viewport.width}`;
      test(`${key}: axe, vitals, overflow`, async ({ browser }, testInfo) => {
        const context = await browser.newContext({ baseURL: ORIGIN, viewport, deviceScaleFactor: 1, storageState: entry.signedIn ? await signedInState(browser) : undefined });
        try {
          await installVitals(context);
          const page = await context.newPage();
          const started = Date.now();
          await page.goto(entry.path, { waitUntil: 'load' });
          await entry.ready(page);
          const readyMs = Date.now() - started;
          // Let late fonts and data settle, then scroll so every reveal and lazy block has fired.
          await page.waitForTimeout(1500);
          await scrollThrough(page);
          await page.waitForTimeout(800);
          const vitals = await readVitals(page);
          const overflow = await overflowPx(page);
          const axe = await runAxe(page);
          const values = { axeCritical: axe.rules.critical, axeSerious: axe.rules.serious, cls: vitals.cls, lcpMs: vitals.lcpMs, overflowPx: overflow };
          const checks = gate(testInfo, expect, 'quality', key, values);
          const result = { key, page: entry.id, path: entry.path, viewport, signedIn: entry.signedIn, gate: GATE, readyMs, metrics: { ...values, axeNodes: axe.nodes, axeRules: axe.rules, ...vitals }, checks, axe };
          writeResult('quality', key, result);
          await testInfo.attach(`${key}.json`, { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
        } finally {
          await context.close();
        }
      });
    }
  }

  test('editor toolbar @800 is not clipped (audit S1 #2)', async ({ browser }, testInfo) => {
    const entry = pageById('editor');
    const key = `editor-toolbar@${TOOLBAR_VIEWPORT.width}`;
    const context = await browser.newContext({ baseURL: ORIGIN, viewport: TOOLBAR_VIEWPORT, deviceScaleFactor: 1, storageState: await signedInState(browser) });
    try {
      const page = await context.newPage();
      await page.goto(entry.path);
      await entry.ready(page);
      await page.waitForTimeout(800);
      const toolbar = await toolbarState(page);
      expect(toolbar.nav ?? toolbar.workbench, 'editor toolbar not found').not.toBeNull();
      const measured = toolbar.workbench ?? toolbar.nav;
      const clipped = Boolean(toolbar.nav?.clipped || toolbar.workbench?.clipped);
      const values = { toolbarClipped: clipped, overflowPx: await overflowPx(page) };
      const checks = gate(testInfo, expect, 'quality', key, values);
      const result = { key, page: 'editor', path: entry.path, viewport: TOOLBAR_VIEWPORT, gate: GATE, metrics: { ...values, toolbarHiddenPx: measured.scrollWidth - measured.clientWidth }, toolbar, checks };
      writeResult('quality', key, result);
      await testInfo.attach(`${key}.json`, { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
    } finally {
      await context.close();
    }
  });
});
