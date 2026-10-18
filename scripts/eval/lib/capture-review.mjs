// The studio's visual self-review capture, run outside the studio.
//
// live-builder.tsx captures the review screenshots in the BROWSER with
// captureDesign() (src/lib/builder/design-capture.ts): it bundles the project
// with esbuild-wasm, renders desktop and mobile in sandboxed frames, and the
// page rasterises itself. To send the review round exactly as the studio does,
// we bundle that same module for the browser with the repo's esbuild and run it
// in a Playwright page whose origin serves /builder-runtime/ (the Next dev
// server in live mode; public/ through lib/serve.mjs for the offline self-test).
// No provider is contacted here.
import path from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as esbuild from 'esbuild';
import { REPO, ensureDir, readJson, rel } from './paths.mjs';
import { serve } from './serve.mjs';
import { assertLocalOrigin } from './stack.mjs';

const require = createRequire(import.meta.url);
const SRC = path.join(REPO, 'src');
const HOST_PATH = '/__eval-capture-host';
const HOST_HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>capture host</title></head><body></body></html>';

/** Resolve "@/x" like the app's tsconfig paths (src/x with TS extensions). */
function resolveSource(request) {
  const base = path.join(SRC, request.slice(2));
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
  return candidates.find(candidate => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

const appResolver = {
  name: 'makeborne-app-paths',
  setup(build) {
    build.onResolve({ filter: /^@\// }, args => {
      const file = resolveSource(args.path);
      return file ? { path: file } : { errors: [{ text: `Cannot resolve ${args.path} under src/` }] };
    });
    // design-capture never imports server code, but stub it so a future
    // transitive import fails loudly in the review instead of at bundle time.
    build.onResolve({ filter: /^server-only$/ }, () => ({ path: 'server-only', namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export {};', loader: 'js' }));
  },
};

/** data:/blob:/about: and loopback hosts only (same rule as lib/website.mjs). */
export function isLocalRequest(url) {
  if (/^(?:data|blob|about):/i.test(url)) return true;
  try { return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname); } catch { return false; }
}

let bundled = null;
/**
 * Bundle design-capture.ts (plus reviewCoverageIssue) into one IIFE that sets
 * window.__makeborneReview = { captureDesign, reviewCoverageIssue }.
 * Cached per process; returns { code, bytes, ms, esbuildVersion }.
 */
export function captureBundle() {
  bundled ??= (async () => {
    const started = Date.now();
    const result = await esbuild.build({
      stdin: {
        contents: [
          'import { captureDesign } from "@/lib/builder/design-capture";',
          'import { reviewCoverageIssue } from "@/lib/builder/review-policy";',
          'window.__makeborneReview = { captureDesign, reviewCoverageIssue };',
        ].join('\n'),
        resolveDir: REPO, sourcefile: 'eval-capture-entry.ts', loader: 'ts',
      },
      bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2022',
      define: { 'process.env.NODE_ENV': '"production"' },
      plugins: [appResolver], logLevel: 'silent', legalComments: 'none', charset: 'utf8',
    });
    const code = result.outputFiles[0].text;
    return { code, bytes: Buffer.byteLength(code), ms: Date.now() - started, esbuildVersion: esbuild.version };
  })().catch(error => { bundled = null; throw error; });
  return bundled;
}

/** websiteSource ({files:[{path,content}]}) or a plain {path: content} record -> record. */
export function filesRecord(source) {
  if (!source) throw new Error('No website source to capture');
  if (Array.isArray(source.files)) return Object.fromEntries(source.files.map(file => [file.path, file.content]));
  return { ...source };
}

/**
 * Data URLs keyed by in-code path (/images/x.webp), exactly like
 * live-builder.tsx assetDataUrls(). `list` items: {path: 'public/images/x.webp', bytes: Buffer, mediaType}.
 */
export function assetDataUrls(list = []) {
  return Object.fromEntries(list.map(asset => [`/${asset.path.replace(/^public\//, '')}`,
    `data:${asset.mediaType ?? 'image/webp'};base64,${Buffer.from(asset.bytes).toString('base64')}`]));
}

/**
 * Capture the review input for one website version, as the studio would.
 * Returns exactly the ReviewInput shape minus `round` ({screenshots, viewports,
 * errors}), so `review: { round, ...capture }` is a valid request body. Capture
 * problems on our side are attached as NON-enumerable `failures` and
 * `coverageIssue` (reviewCoverageIssue's verdict) so they never leak into the
 * request; a non-null coverageIssue means the studio would not send a review.
 */
export async function captureForReview({ browser, origin, files, assets = {}, timeoutMs = 180_000 }) {
  const base = assertLocalOrigin(origin);
  const { code } = await captureBundle();
  // No serviceWorkers: 'block' here: Playwright implements it with an init
  // script that throws inside the sandboxed capture frames.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const blockedRequests = [];
  try {
    // Requests leaving the machine are aborted and reported (as lib/website.mjs
    // does): generated sites may reference remote fonts/images/scripts, and the
    // harness never talks to anything but loopback. The studio's own capture
    // would let the browser try them, so a non-empty list means the review
    // tiles can differ from the studio's for that site.
    await context.route('**/*', route => {
      const url = route.request().url();
      if (isLocalRequest(url)) return route.continue();
      if (blockedRequests.length < 200) blockedRequests.push(url.slice(0, 200));
      return route.abort('blockedbyclient');
    });
    // Registered last, so it runs first: the host document only needs the
    // right origin; /builder-runtime/* goes to the real (local) server.
    await context.route(`${base}${HOST_PATH}`, route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HOST_HTML }));
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error?.message ?? error).slice(0, 300)));
    await page.goto(`${base}${HOST_PATH}`, { waitUntil: 'load' });
    await page.addScriptTag({ content: code });
    const capture = await page.evaluate(async ({ files: input, assets: images }) => {
      const review = window.__makeborneReview;
      const result = await review.captureDesign(input, images);
      return { ...result, coverageIssue: review.reviewCoverageIssue(result) };
    }, { files: filesRecord(files), assets });
    const output = { screenshots: capture.screenshots, viewports: capture.viewports, errors: capture.errors };
    Object.defineProperties(output, {
      failures: { value: capture.failures, enumerable: false },
      coverageIssue: { value: capture.coverageIssue, enumerable: false },
      // Uncaught errors Playwright saw in any frame (diagnostic only: the
      // studio reports site errors through the capture relay, i.e. `errors`).
      pageErrors: { value: pageErrors, enumerable: false },
      // Non-local requests that were aborted (never sent).
      blockedRequests: { value: [...new Set(blockedRequests)], enumerable: false },
    });
    return output;
  } finally {
    await context.close().catch(() => undefined);
  }
}

/** Summary of a capture without image data (for reports and requests.json). */
export function describeCapture(capture) {
  return {
    screenshots: capture.screenshots.map(({ viewport, index, of, mediaType, width, height, data }) => ({ viewport, index, of, mediaType, width, height, base64Chars: data.length })),
    viewports: capture.viewports,
    errors: capture.errors,
    failures: capture.failures ?? [],
    coverageIssue: capture.coverageIssue ?? null,
    pageErrors: capture.pageErrors ?? [],
    blockedRequests: capture.blockedRequests ?? [],
  };
}

/** Write the tiles as JPEG files (binary evidence, lint-safe). */
export async function saveShots(capture, dir) {
  ensureDir(dir);
  const files = [];
  for (const shot of capture.screenshots) {
    const file = path.join(dir, `${shot.viewport}-${String(shot.index + 1).padStart(2, '0')}-of-${shot.of}.jpg`);
    await writeFile(file, Buffer.from(shot.data, 'base64'));
    files.push(rel(file));
  }
  return files;
}

/**
 * Offline self-test on the Saffron Table fixture (outputs/product-qualification/
 * restaurant.json [0]): bundles, serves public/ locally, captures, and checks
 * the result against the app's own reviewCoverageIssue and ReviewInputSchema.
 * Returns a report; never throws for a failed check (ok: false instead).
 */
export async function selfTest({ outDir } = {}) {
  const started = Date.now();
  const report = { ok: false, fixture: 'outputs/product-qualification/restaurant.json[0]', checks: {} };
  let server, browser;
  try {
    const fixtureFile = path.join(REPO, 'outputs', 'product-qualification', 'restaurant.json');
    if (!existsSync(fixtureFile)) throw new Error(`Self-test fixture missing: ${rel(fixtureFile)}`);
    const row = readJson(fixtureFile)[0];
    const source = row?.content?.websiteSource;
    if (!source?.files?.length) throw new Error('Self-test fixture has no websiteSource');
    report.fixtureVersion = row.version_number;
    report.files = source.files.length;
    report.assets = source.assets?.length ?? 0;

    const bundle = await captureBundle();
    report.bundle = { bytes: bundle.bytes, ms: bundle.ms, esbuildVersion: bundle.esbuildVersion };
    server = await serve(path.join(REPO, 'public'));
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
    const captureStarted = Date.now();
    const capture = await captureForReview({ browser, origin: server.url, files: source });
    report.captureMs = Date.now() - captureStarted;
    report.capture = describeCapture(capture);

    // The app's own policy and request schema, loaded from src/ under Node.
    const { loadApp } = require('./app-modules.cjs');
    const { reviewCoverageIssue } = loadApp('src/lib/builder/review-policy.ts');
    const { ReviewInputSchema } = loadApp('src/lib/builder/review.ts');
    const { MAX_BUILDER_REQUEST_BYTES } = loadApp('src/lib/builder/attachments.ts');
    const coverage = reviewCoverageIssue({ ...capture, failures: capture.failures });
    const parsed = ReviewInputSchema.safeParse({ round: 1, ...capture });
    const requestBytes = Buffer.byteLength(JSON.stringify({ workspaceId: '00000000-0000-4000-8000-000000000000', artifactId: '00000000-0000-4000-8000-000000000000',
      expectedVersion: 1, message: 'Design review', effort: 'medium', mode: 'review',
      operation: { id: '00000000-0000-4000-8000-000000000000', stepKey: '00000000-0000-4000-8000-000000000000', kind: 'review' }, review: { round: 1, ...capture } }));
    report.checks = {
      reviewCoverageIssueNode: coverage,
      reviewCoverageIssueBrowser: capture.coverageIssue,
      reviewInputSchema: parsed.success ? 'valid' : parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join('.')}: ${issue.message}`),
      requestBytes, maxRequestBytes: MAX_BUILDER_REQUEST_BYTES,
      runtimeRequests404: server.requests.filter(request => request.status !== 200).map(request => request.path).slice(0, 10),
      blockedRequests: capture.blockedRequests,
    };
    if (outDir) report.shots = await saveShots(capture, outDir);

    // Non-local requests from the rendered site are aborted and reported, never sent.
    const PROBE = 'https://eval-blocked.invalid/probe';
    const probed = source.files.map(file => (file.path === 'src/main.tsx'
      ? { ...file, content: `${file.content}\nvoid fetch("${PROBE}.json").catch(() => undefined);\nnew Image().src = "${PROBE}.png";\n` } : file));
    const probeCapture = await captureForReview({ browser, origin: server.url, files: { ...source, files: probed } });
    report.checks.remoteProbeBlocked = probeCapture.blockedRequests.filter(url => url.startsWith(PROBE));
    report.checks.remoteProbeLeaks = server.requests.filter(request => request.path.includes('eval-blocked')).length;
    const blockingOk = report.checks.remoteProbeBlocked.length > 0 && report.checks.remoteProbeLeaks === 0;
    if (!blockingOk) report.error = 'Non-local probe requests were not reported as blocked';

    report.ok = coverage === null && capture.coverageIssue === null && parsed.success && requestBytes <= MAX_BUILDER_REQUEST_BYTES && blockingOk;
  } catch (error) {
    report.error = String(error?.stack ?? error).split('\n').slice(0, 4).join(' | ');
  } finally {
    await browser?.close().catch(() => undefined);
    await server?.close();
    report.ms = Date.now() - started;
  }
  return report;
}
