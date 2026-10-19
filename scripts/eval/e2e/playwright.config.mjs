// Studio e2e suite (QUALITY_BAR S1–S5) on the isolated release-auth stack.
// Run from the repo root:
//   node scripts/eval/node_modules/@playwright/test/cli.js test -c scripts/eval/e2e/playwright.config.mjs
// Gate: E2E_GATE=baseline (default, fail on regression vs baseline.json) or
// E2E_GATE=launch (fail when a launch-tier metric misses the QUALITY_BAR).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { REPO, OUT, stamp } from '../lib/paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Workers re-load this file; they inherit the runner's env, so one run = one stamp.
process.env.E2E_STAMP ||= stamp();
const RUN_DIR = path.join(OUT, 'e2e', process.env.E2E_STAMP);
const ORIGIN = 'http://127.0.0.1:3210';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  // One worker: the dev server compiles on demand and the vitals need a quiet machine.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: true,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  outputDir: path.join(RUN_DIR, 'test-results'),
  // list + json only: the HTML reporter can copy trace-viewer .js files, and
  // nothing with a .js extension may land under outputs/ (ESLint lints it).
  reporter: [['list'], ['json', { outputFile: path.join(RUN_DIR, 'report.json') }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: ORIGIN,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    navigationTimeout: 120_000,
    actionTimeout: 30_000,
    // No traces: a trace records the sign-in form, fixture password included.
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  // Identity check before any test (a reused server must be the suite's own,
  // see identity.mjs), the created-objects ledger and the cleanup of killed runs.
  globalSetup: path.join(HERE, 'global-setup.mjs'),
  // Cleans up what this run left behind (crashed worker, failure, Ctrl+C) while the server still runs.
  globalTeardown: path.join(HERE, 'global-teardown.mjs'),
  webServer: {
    command: 'node scripts/eval/e2e/server.mjs',
    cwd: REPO,
    url: `${ORIGIN}/login`,
    // Reusing lets an operator keep `node scripts/eval/e2e/server.mjs` running between
    // runs. Any server found on 3210 must still pass global-setup.mjs's identity check
    // (isolated Supabase inlined, no cloud project URL, builder off) or the run is refused.
    reuseExistingServer: true,
    timeout: 300_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
