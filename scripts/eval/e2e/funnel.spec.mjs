// S1 funnel: sign in → brief → plan → build → preview → review link → publish,
// on the isolated release-auth stack with every provider key blank. Steps that
// cannot run here (AI build, verified publishing) assert the honest AI-off /
// publishing-off state and say so in an annotation. Writes
// outputs/eval/e2e/<stamp>/funnel.json (steps, findings, cleanup outcome).
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { writeJson } from '../lib/paths.mjs';
import {
  ORIGIN, FIXTURE, RUN_STAMP, RUN_DIR, GATE, WRITE_BASELINE, signIn, appApi, readBaseline, writeBaselineEntry, flushBaseline, reviewSchemaGap, rel,
} from './helpers.mjs';
import { routes, record, markDone, cleanPending } from './cleanup.mjs';

test.describe.configure({ mode: 'serial' });

const ws = FIXTURE.workspaceId;
const api = routes(ws);
const reviewerName = `[e2e] Funnel ${RUN_STAMP}`;

// Everything the run learns; written to funnel.json in afterAll.
const run = { stamp: RUN_STAMP, gate: GATE, origin: ORIGIN, startedAt: new Date().toISOString(), steps: [], created: [], review: null, comments: [], blocked: [], paidEndpointCalls: [], findings: [], cleanup: [] };
let context;
let page;

// Review tokens are bearer links: never write one to a report.
const redact = url => {
  const { pathname } = new URL(url);
  return pathname.replace(/\/review\/[^/]+/, '/review/<token>');
};

const isApp = url => {
  const { hostname, port } = new URL(url);
  return port === new URL(ORIGIN).port && ['127.0.0.1', 'localhost'].includes(hostname);
};

function watch(target, label) {
  target.on('response', response => {
    const url = response.url();
    if (!isApp(url) || !url.includes('/api/') || response.status() < 400) return;
    void response.json().catch(() => null).then(body => run.findings.push({ where: label, kind: 'api', method: response.request().method(), status: response.status(), path: redact(url), code: body?.error?.code ?? null, message: body?.error?.message ?? null }));
  });
  target.on('request', request => {
    // No AI generation may start on this stack: any POST to a generation route is recorded and fails the build step.
    if (request.method() === 'POST' && /\/api\/(build|generate|chat)(\/|$)/.test(new URL(request.url()).pathname)) run.paidEndpointCalls.push(redact(request.url()));
  });
  target.on('pageerror', error => run.findings.push({ where: label, kind: 'pageerror', message: error.message.slice(0, 300) }));
}

let schemaGap = null;
/**
 * A sub-step the app could not complete. Tolerated (annotated, soft-failed
 * otherwise) only in the default gate, only when the failure is the stack's
 * known schema gap (confirmed read-only in the database) and only when
 * baseline.json lists the step as known-blocked. E2E_GATE=launch never tolerates it.
 */
async function blocked(step, rpc, response) {
  const body = await response.json().catch(() => null);
  schemaGap ??= await reviewSchemaGap();
  const explained = response.status() === 503 && body?.error?.code === 'REVIEW_FAILED' && schemaGap.missing.includes(rpc);
  const cause = explained
    ? `isolated stack lacks migration ${schemaGap.migration}: public.${rpc} has no p_version parameter, so the call fails`
    : `unexplained ${response.status()} ${body?.error?.code ?? ''}`.trim();
  run.blocked.push({ step, status: response.status(), code: body?.error?.code ?? null, explained, cause });
  test.info().annotations.push({ type: 'blocked', description: `${step}: ${cause}` });
  const known = readBaseline().entries?.funnel?.knownBlocked ?? [];
  const tolerated = GATE === 'baseline' && explained && (WRITE_BASELINE || known.includes(step));
  expect.soft(tolerated, `${step} failed: ${cause}${GATE === 'launch' ? ' (launch gate: every funnel step must work)' : ' and is not a known-blocked step in baseline.json'}`).toBe(true);
}

/** Wait for the studio-projects POST that the click triggers; returns {projectId, artifactId}. */
async function createdBy(click, step) {
  const response = page.waitForResponse(r => r.url().endsWith(`/api/cloud/workspaces/${ws}/studio-projects`) && r.request().method() === 'POST');
  await click();
  const result = await response;
  expect(result.status(), `${step}: studio project create status`).toBe(201);
  const body = await result.json();
  const created = { step, projectId: body.project.id, artifactId: body.artifact.id };
  run.created.push(created);
  // Into the cleanup ledger at once: a killed run is cleaned by the teardown or the next run.
  record({ kind: 'project', ...created });
  return created;
}

async function openComposer(brief, mode) {
  await page.goto('/studio');
  await page.getByRole('heading', { name: 'What will you make next?' }).waitFor();
  const composer = page.getByRole('region', { name: 'Start with a brief' });
  await composer.getByRole('button', { name: 'Website', exact: true }).click();
  await composer.locator('textarea#studio-brief').fill(brief);
  await composer.getByRole('group', { name: 'Creation mode' }).getByRole('button', { name: mode === 'plan' ? 'Plan' : 'Create', exact: true }).click();
  return composer;
}

test.describe('S1 funnel (isolated stack, AI off)', () => {
  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ baseURL: ORIGIN });
    page = await context.newPage();
    watch(page, 'owner');
  });

  test.afterEach(() => {
    const testInfo = test.info();
    run.steps.push({ step: testInfo.title, status: testInfo.status, ms: testInfo.duration, annotations: testInfo.annotations.map(a => `${a.type}: ${a.description}`), error: testInfo.error?.message?.split('\n')[0] ?? null });
  });

  test.afterAll(async () => {
    test.setTimeout(180_000);
    if (page) await cleanup().catch(error => run.cleanup.push({ action: 'cleanup', ok: false, error: String(error?.message ?? error) }));
    // Anything still pending is retried by global-teardown.mjs (and by the next run's global setup).
    run.finishedAt = new Date().toISOString();
    // Re-baseline: the known-blocked list becomes exactly what this run found explained (only once the review step ran).
    if (WRITE_BASELINE && run.review?.linkId) {
      writeBaselineEntry('funnel', 'knownBlocked', run.blocked.filter(entry => entry.explained).map(entry => entry.step));
      run.baselineEntriesWritten = flushBaseline();
    }
    const file = path.join(RUN_DIR, 'funnel.json');
    writeJson(file, run);
    console.log(`[funnel] ${run.steps.filter(s => s.status === 'passed').length}/${run.steps.length} steps passed, ${run.findings.length} findings, cleanup ${run.cleanup.filter(c => c.ok).length}/${run.cleanup.length} ok -> ${rel(file)}`);
    await context?.close();
  });

  test('sign in', async () => {
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'What will you make next?' })).toBeVisible();
  });

  test('brief: a website brief becomes a saved project', async () => {
    const brief = `E2E funnel ${RUN_STAMP}: a small bakery website for a neighbourhood sourdough shop, with opening hours, the daily bake and a pre-order note.`;
    const composer = await openComposer(brief, 'create');
    const { artifactId } = await createdBy(() => composer.getByRole('button', { name: 'Create this project' }).click(), 'brief');
    await expect(page).toHaveURL(new RegExp(`[?&]artifact=${artifactId}`));
    await expect(page.getByRole('status').filter({ hasText: 'Project saved to your account' })).toContainText('AI generation has not run');
    await expect(page.getByRole('complementary', { name: 'Project conversation' })).toContainText(`E2E funnel ${RUN_STAMP}`);
  });

  test('plan: the local starting plan is edited and confirmed', async () => {
    const composer = await openComposer(`E2E funnel ${RUN_STAMP} plan: a small bakery website, planned before it is created.`, 'plan');
    await composer.getByRole('button', { name: 'Plan this project' }).click();
    await expect(page.getByRole('heading', { name: 'Your starting plan' })).toBeVisible();
    const sections = page.getByRole('textbox', { name: 'Sections to include' });
    await expect(sections).not.toBeEmpty();
    await sections.fill(['Opening: the daily bake and the pre-order promise', 'Breads: sourdough, rye and seasonal loaves', 'Visit: opening hours, address and map'].join('\n'));
    const { artifactId } = await createdBy(() => page.getByRole('button', { name: 'Confirm plan & create' }).click(), 'plan');
    await expect(page).toHaveURL(new RegExp(`[?&]artifact=${artifactId}`));
    await expect(page.getByRole('navigation', { name: 'Project view' })).toBeVisible();
  });

  test('build: AI is off on this stack, instructions are kept for later', async () => {
    test.info().annotations.push({ type: 'build', description: 'AI off on this stack; live build needs MAKEBORNE_LIVE_BUILDER_ENABLED not "false" plus ANTHROPIC_API_KEY (paid provider), so no generation ran' });
    const build = await appApi(page, 'GET', '/api/build');
    const { estimates, ...availability } = build.body ?? {};
    expect(availability, 'GET /api/build').toEqual({ available: false, configured: false, state: 'off' });
    expect(typeof estimates, 'GET /api/build estimates (credit ranges only)').toBe('object');
    const conversation = page.getByRole('complementary', { name: 'Project conversation' });
    const message = conversation.getByRole('textbox', { name: 'Message about your project' });
    await message.fill('Make the opening warmer and lead with the morning bake.');
    await conversation.getByRole('button', { name: 'Save instruction for later' }).click();
    await expect(conversation.getByText('Saved in this tab · not applied')).toBeVisible();
    await expect(conversation).toContainText('Make the opening warmer and lead with the morning bake.');
    expect(run.paidEndpointCalls, 'no generation request may start').toEqual([]);
  });

  test('preview: the saved fixture website renders in the editor', async () => {
    await page.goto(FIXTURE.editorPath);
    const tabs = page.getByRole('navigation', { name: 'Project view' });
    await expect(tabs.getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-pressed', 'true');
    const heading = page.frameLocator('iframe[title="Website preview"]').locator('h1').first();
    await expect(heading).toBeVisible({ timeout: 60_000 });
    expect((await heading.textContent()).trim().length).toBeGreaterThan(0);
  });

  test('review link: shared, opened signed out, commented, changes requested, turned off', async ({ browser }) => {
    const before = await appApi(page, 'GET', api.workspace);
    run.review = { fixtureStageBefore: before.body?.projects?.find(p => p.id === FIXTURE.projectId)?.deliveryStage ?? null };
    // Sharing moves the fixture to "in review"; the ledger remembers how to put it back.
    record({ kind: 'fixture-stage', projectId: FIXTURE.projectId, before: run.review.fixtureStageBefore });

    // Client review opens from the project header's actions menu.
    await page.getByRole('button', { name: 'Project actions' }).click();
    await page.getByRole('group', { name: 'Project actions' }).getByRole('button', { name: 'Client review' }).click();
    const panel = page.getByRole('region', { name: 'Client review' });
    await panel.getByRole('radio', { name: /Latest version/ }).check();
    await panel.getByRole('textbox', { name: 'Client name' }).fill(reviewerName);
    await panel.getByLabel('Link expires').selectOption({ label: 'In 3 days' });
    const createResponse = page.waitForResponse(r => /\/artifacts\/[^/]+\/reviews$/.test(r.url()) && r.request().method() === 'POST');
    // Recorded before the request: cleanup finds the link by this recipient name even if the run dies mid-request.
    const linkEntry = record({ kind: 'review-link', artifactId: FIXTURE.artifactId, recipientName: reviewerName });
    await panel.getByRole('button', { name: 'Create review link' }).click();
    const created = await createResponse;
    expect(created.status(), 'review link create status').toBe(201);
    run.review.linkId = (await created.json()).link.id;
    record({ kind: 'review-link-id', recipientName: reviewerName, linkId: run.review.linkId });
    const linkBox = page.locator('.crp-created[role=status]').getByRole('textbox', { name: 'Review link' });
    const link = await linkBox.inputValue();
    // Compare the redacted form so a failure message never prints the token.
    // `next dev` reports its own origin as localhost, so the link may use either loopback name.
    const shown = new URL(link);
    run.review.linkHost = shown.host;
    expect(`${shown.origin}${redact(link)}`, 'review link shape').toMatch(/^http:\/\/(127\.0\.0\.1|localhost):3210\/review\/<token>$/);
    expect(/^\/review\/[A-Za-z0-9_-]{20,}$/.test(shown.pathname), 'review token shape').toBe(true);
    if (shown.hostname !== new URL(ORIGIN).hostname) run.findings.push({ where: 'owner', kind: 'note', message: `review link uses ${shown.origin}, not NEXT_PUBLIC_SITE_URL ${ORIGIN} (link built from the request origin, which next dev normalises to localhost)` });

    // A client has no account: a fresh, signed-out context.
    const guest = await browser.newContext({ baseURL: ORIGIN });
    try {
      const review = await guest.newPage();
      watch(review, 'client');
      await review.goto(link);
      await expect(review.getByRole('heading', { level: 1 })).toHaveText('Saffron Table');
      await expect(review.frameLocator('iframe[title$="website preview"]').locator('h1').first()).toBeAttached({ timeout: 60_000 });

      const commentText = `E2E ${RUN_STAMP}: the opening photo could be brighter.`;
      const composer = review.locator('form.cr-composer');
      await composer.getByLabel('Your name').fill('E2E Reviewer');
      await review.locator('#cr-comment').fill(commentText);
      const commentResponse = review.waitForResponse(r => r.url().endsWith('/comments') && r.request().method() === 'POST');
      await composer.getByRole('button', { name: 'Post comment' }).click();
      const comment = await commentResponse;
      if (comment.ok()) {
        run.comments.push((await comment.json()).comment.id);
        record({ kind: 'comment', commentId: run.comments.at(-1) });
        await expect(review.getByRole('region', { name: 'Comments' })).toContainText(commentText);
      } else await blocked('review-comment', 'makeborne_add_client_review_comment', comment);

      run.review.approveEnabled = await review.getByRole('button', { name: 'Approve', exact: true }).isEnabled();
      await review.getByRole('button', { name: 'Request changes' }).click();
      const decisionPanel = review.getByRole('region', { name: 'Request changes' });
      // The panel asks for a name again when no comment has been saved yet.
      const panelName = decisionPanel.getByLabel('Your name');
      if (await panelName.count()) await panelName.fill('E2E Reviewer');
      await decisionPanel.getByRole('textbox').last().fill('Please brighten the opening photo before sign-off.');
      const decisionResponse = review.waitForResponse(r => r.url().endsWith('/decision') && r.request().method() === 'POST');
      await decisionPanel.getByRole('button', { name: 'Send change request' }).click();
      const decision = await decisionResponse;
      if (decision.ok()) {
        run.comments.push((await decision.json()).comment.id);
        record({ kind: 'comment', commentId: run.comments.at(-1) });
        await expect(review.getByText(/Changes requested by E2E Reviewer/)).toBeVisible();
      } else await blocked('review-decision', 'makeborne_decide_client_review', decision);

      // Owner turns the link off from the panel; the client's page then refuses.
      page.once('dialog', dialog => void dialog.accept());
      await panel.getByRole('button', { name: 'Refresh client review' }).click();
      await panel.getByRole('button', { name: `Turn off link for ${reviewerName}` }).click();
      await expect(panel.getByText('Review link turned off.')).toBeVisible();
      run.review.revoked = 'ui';
      markDone(linkEntry.ref, 'turned off in the panel');
      await review.reload();
      await expect(review.getByRole('button', { name: 'Post comment' })).toHaveCount(0);
      run.review.afterRevoke = (await review.locator('body').innerText()).trim().slice(0, 160);
    } finally {
      await guest.close();
    }
  });

  test('publish: verified publishing is off on this stack', async () => {
    test.info().annotations.push({ type: 'publish', description: 'trusted publishing is off on this stack (MAKEBORNE_TRUSTED_PUBLICATION_ENABLED blank); there is no local publish path, so nothing was published' });
    // Publish is the project header's primary action; it opens the publishing workflow only.
    const header = page.locator('[data-editor-chrome="header"]');
    const preparation = page.waitForResponse(r => r.url().endsWith('/publication/preparation') && r.request().method() === 'GET', { timeout: 30_000 }).catch(() => null);
    await header.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Verified publishing is being prepared')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Prepare saved website' })).toBeDisabled();
    // The status read fails on this stack; say why instead of hiding it.
    const status = await preparation;
    if (status && !status.ok()) {
      schemaGap ??= await reviewSchemaGap();
      const cause = schemaGap.publicationPreparationsTable ? 'unexplained' : 'isolated stack lacks migration 20261013180000_trusted_publication_preparations (makeborne_private.publication_preparations missing)';
      run.findings.push({ where: 'owner', kind: 'explained', path: redact(status.url()), status: status.status(), cause });
      test.info().annotations.push({ type: 'finding', description: `GET publication/preparation -> ${status.status()}: ${cause}; the panel shows "Cloud storage could not confirm this request"` });
    }
  });
});

// ---------------------------------------------------------------------------
// Cleanup through the app's own API (cleanup.mjs): every item still pending in
// this run's ledger. The app has no project delete, so test projects are
// renamed "[e2e] …" and archived; the review link is turned off (if the panel
// did not already), the client comments resolved and the fixture's delivery
// stage restored.
async function cleanup() {
  const result = await cleanPending({ call: (method, route, data) => appApi(page, method, route, data), notes: run.cleanup });
  if (run.review?.linkId && run.review.revoked !== 'ui' && run.cleanup.some(entry => entry.action === 'turn off review link (API)' && entry.ok)) run.review.revoked = 'api';
  run.cleanupPending = result.failed;
}
