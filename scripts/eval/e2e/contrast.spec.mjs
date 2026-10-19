// S3: the UX audit's contrast script, verbatim (audit-contrast.mjs), on the
// /studio first screen and the Saffron Table editor at 375 and 1440. Asserts
// lowContrastCount through the gate; everything else the audit returns is kept
// in outputs/eval/e2e/<stamp>/contrast.json for the record.
import { test, expect } from '@playwright/test';
import { ORIGIN, WIDTHS, GATE, pageById, signedInState, warm, gate, writeResult, writeSummary, rel, RUN_DIR } from './helpers.mjs';
import { runAudit } from './audit-contrast.mjs';

const TARGETS = ['studio', 'editor'].map(pageById);

test.describe('studio contrast (S3)', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    await warm(browser, TARGETS, await signedInState(browser));
  });

  test.afterAll(() => {
    const summary = writeSummary('contrast', 'contrast.json');
    console.log(`[contrast] ${summary.results.length} results, ${summary.gaps.length} gaps to the bar -> ${rel(RUN_DIR)}/contrast.json`);
  });

  for (const entry of TARGETS) {
    for (const viewport of WIDTHS) {
      const key = `${entry.id}@${viewport.width}`;
      test(`${key}: text contrast (audit script)`, async ({ browser }, testInfo) => {
        const context = await browser.newContext({ baseURL: ORIGIN, viewport, deviceScaleFactor: 1, storageState: await signedInState(browser) });
        try {
          const page = await context.newPage();
          await page.goto(entry.path);
          await entry.ready(page);
          // First screen as a user meets it: settled, not scrolled.
          await page.waitForTimeout(1200);
          const audit = await runAudit(page);
          const checks = gate(testInfo, expect, 'contrast', key, { lowContrastCount: audit.lowContrastCount });
          const result = { key, page: entry.id, path: entry.path, viewport, gate: GATE, metrics: { lowContrastCount: audit.lowContrastCount, overflowX: audit.overflowX, tinyCount: audit.tinyCount, toolbar: audit.toolbar }, checks, audit };
          writeResult('contrast', key, result);
          await testInfo.attach(`${key}.json`, { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
        } finally {
          await context.close();
        }
      });
    }
  }
});
