// Real-browser journeys on the STAGING QA alias for the frozen candidate (headless Chromium).
// The deployment-protection bypass header is added only to requests for the staging origin (never put
// in a URL, never sent to other hosts). Signs in through the real login form as the existing QA agency
// fixture, opens saved website/book/deck projects at desktop and phone sizes, records builder state,
// Publish tab state and layout shift, creates a client review link, comments on it anonymously in a
// separate cookie-less context, sees the comment as the agency, then turns the link off.
// No generation, publish, purchase or email. Output: work/rc-stack/staging/browser/ (screenshots, JSON).
// Run from the LF snapshot directory.
import fs from "node:fs";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const ORIGIN = "https://makeborne-release-staging-qa2026101-kerimsabic-6594s-projects.vercel.app", WID = "521a8417-644b-4bfa-938b-de9317834dbb";
const OUT = "../staging/browser"; fs.mkdirSync(OUT, { recursive: true });
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const fixture = read("work/release-auth-stack/cloud-hosting-fixture.json"); assert.equal(fixture.wid, WID);
const bypass = read("C:/Users/kerim/Documents/Codex/2026-10-03/referenced-chatgpt-conversation-this-is-an/work/makeborne-app/work/publication-cloud-e2e-20261014/staging-protection.json").secret;
const ARTIFACTS = { website: "acc2df0c-c36c-453d-b54a-a5c811ed79ca", book: "426feb56-ef44-4b8a-8b0d-75f011d2e86b", deck: "b49012e3-f4c6-4540-9b5f-a246daa5a6cb" };
const report = { at: new Date().toISOString(), origin: ORIGIN, candidate: "a6e70c6f577aa5bf7654e72cd8d85b9977bd247e", productionTouched: false, steps: [] };
const browser = await chromium.launch({ headless: true });
async function context(viewport) {
  const ctx = await browser.newContext({ viewport, ...(viewport.width < 500 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  await ctx.route("**/*", route => route.request().url().startsWith(ORIGIN) ? route.continue({ headers: { ...route.request().headers(), "x-vercel-protection-bypass": bypass } }) : route.continue());
  return ctx;
}
function watch(page, label) {
  const issues = [];
  page.on("console", m => { if (m.type() === "error") issues.push({ type: "console", text: m.text().slice(0, 200) }); });
  page.on("pageerror", e => issues.push({ type: "pageerror", text: String(e).slice(0, 200) }));
  page.on("response", r => { if (r.status() >= 500 && r.url().startsWith(ORIGIN)) issues.push({ type: "http", status: r.status(), url: r.url().replace(ORIGIN, "").slice(0, 120) }); });
  return () => ({ label, issues });
}
const cls = page => page.evaluate(() => new Promise(resolve => { let total = 0; new PerformanceObserver(list => { for (const e of list.getEntries()) if (!e.hadRecentInput) total += e.value; }).observe({ type: "layout-shift", buffered: true }); setTimeout(() => resolve(Math.round(total * 1e4) / 1e4), 1200); }));

try {
  const desk = await context({ width: 1440, height: 900 });
  const page = await desk.newPage(); const issues = watch(page, "desktop");
  await page.goto(`${ORIGIN}/login`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("you@example.com").fill(fixture.email);
  await page.getByPlaceholder("Enter your password").fill(fixture.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(url => !url.pathname.startsWith("/login"), { timeout: 60000 });
  report.steps.push({ step: "sign in through the login form", ok: true, landed: new URL(page.url()).pathname });
  for (const [kind, id] of Object.entries(ARTIFACTS)) {
    await page.goto(`${ORIGIN}/studio?tab=projects&workspace=${WID}&artifact=${id}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => /Version \d+ · /.test(document.body.innerText), null, { timeout: 60000 });
    await page.waitForTimeout(4000);
    const text = await page.evaluate(() => document.body.innerText);
    const step = { step: `open saved ${kind}`, header: text.match(/Version \d+ · [^\n]+/)?.[0], builderCopy: text.match(/AI building is [^\n]+/)?.[0] ?? null,
      notice: text.match(/This [^\n]*saved as[^\n]*/)?.[0] ?? null, tabs: await page.locator("button").evaluateAll(bs => bs.map(b => b.textContent.trim()).filter(x => /^(Preview|Code|Edit|History|Publish|Client review)$/.test(x))),
      exports: await page.locator("button").evaluateAll(bs => bs.map(b => b.textContent.trim()).filter(x => /^(PDF|PPTX|EPUB|Download source)$/.test(x))), cls: await cls(page),
      sendDisabled: await page.getByRole("button", { name: "Send" }).first().isDisabled().catch(() => null) };
    await page.screenshot({ path: `${OUT}/desktop-${kind}.png` });
    if (kind === "website") {
      await page.getByRole("button", { name: "Publish", exact: true }).click();
      await page.waitForTimeout(5000);
      step.publish = (await page.locator(".lb-publish, .website-publish").first().innerText().catch(() => "")).split("\n").filter(Boolean).slice(0, 12);
      await page.screenshot({ path: `${OUT}/desktop-website-publish.png` });
    }
    report.steps.push(step);
  }
  // Client review: create a link as the agency.
  await page.goto(`${ORIGIN}/studio?tab=projects&workspace=${WID}&artifact=${ARTIFACTS.website}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => /Version \d+ · /.test(document.body.innerText), null, { timeout: 60000 });
  await page.getByRole("button", { name: "Client review", exact: true }).click();
  await page.getByPlaceholder("Who is reviewing?").fill("RC staging check");
  await page.getByRole("button", { name: "Create review link" }).click();
  const reviewUrl = await page.waitForFunction(() => [...document.querySelectorAll("a,input,code,span")].map(e => e.href || e.value || e.textContent || "").find(x => /\/review\/[A-Za-z0-9_-]{20,}/.test(x)) ?? null, null, { timeout: 90000 }).then(h => h.jsonValue());
  const token = reviewUrl.match(/\/review\/([A-Za-z0-9_-]{20,})/)[1];
  report.steps.push({ step: "create client review link", ok: true });
  // Anonymous client in a separate, cookie-less context.
  const anon = await context({ width: 390, height: 844 });
  const client = await anon.newPage(); const clientIssues = watch(client, "anonymous client");
  await client.goto(`${ORIGIN}/review/${token}`, { waitUntil: "domcontentloaded" });
  await client.waitForTimeout(5000);
  const reviewText = await client.evaluate(() => document.body.innerText);
  const comment = await client.evaluate(async ([token]) => { const r = await fetch(`/api/review/${token}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: Number((document.body.innerText.match(/Version (\d+)/) || [])[1] || 3), name: "RC staging client", email: "", body: "Staging RC check: please confirm opening hours.", anchor: { kind: "general" } }) }); return { status: r.status, body: (await r.text()).slice(0, 160) }; }, [token]);
  await client.screenshot({ path: `${OUT}/phone-review-page.png` });
  report.steps.push({ step: "anonymous client opens review and comments", reviewRenders: reviewText.length > 200, comment, issues: clientIssues().issues });
  // Agency sees it, then turns the link off (cleanup).
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => /Version \d+ · /.test(document.body.innerText), null, { timeout: 60000 });
  await page.getByRole("button", { name: "Client review", exact: true }).click();
  await page.waitForTimeout(5000);
  const panel = await page.locator("[class*=client-review]").first().innerText();
  const seen = panel.includes("Staging RC check: please confirm opening hours.");
  const off = await page.evaluate(async ([wid, aid]) => { const list = await fetch(`/api/cloud/workspaces/${wid}/artifacts/${aid}/reviews`, { cache: "no-store" }).then(r => r.json()); const link = (list.links ?? list.reviews ?? []).find(l => l.clientName === "RC staging check" && l.active !== false && !l.revokedAt); if (!link) return { found: false }; const r = await fetch(`/api/cloud/workspaces/${wid}/artifacts/${aid}/reviews/${link.id}`, { method: "DELETE" }); return { found: true, status: r.status }; }, [WID, ARTIFACTS.website]);
  const after = await anon.request.get(`${ORIGIN}/review/${token}`, { headers: { "x-vercel-protection-bypass": bypass } });
  report.steps.push({ step: "agency sees the comment; link turned off", seen, off, reviewAfterRevoke: after.status() });
  // Phone layout of the editor.
  const phone = await context({ width: 375, height: 812 });
  const p2 = await phone.newPage(); const phoneIssues = watch(p2, "phone");
  await p2.goto(`${ORIGIN}/login`, { waitUntil: "domcontentloaded" });
  await p2.getByPlaceholder("you@example.com").fill(fixture.email);
  await p2.getByPlaceholder("Enter your password").fill(fixture.password);
  await p2.getByRole("button", { name: "Sign in" }).click();
  await p2.waitForURL(url => !url.pathname.startsWith("/login"), { timeout: 60000 });
  await p2.goto(`${ORIGIN}/studio?tab=projects&workspace=${WID}&artifact=${ARTIFACTS.book}`, { waitUntil: "domcontentloaded" });
  await p2.waitForFunction(() => /Version \d+ · /.test(document.body.innerText), null, { timeout: 60000 });
  await p2.waitForTimeout(4000);
  report.steps.push({ step: "phone editor (book)", cls: await cls(p2), overflowX: await p2.evaluate(() => document.documentElement.scrollWidth - innerWidth), issues: phoneIssues().issues });
  await p2.screenshot({ path: `${OUT}/phone-book.png` });
  report.desktopIssues = issues().issues;
} catch (error) {
  report.error = String(error?.message ?? error).slice(0, 500);
  process.exitCode = 1;
} finally {
  await browser.close();
  fs.writeFileSync(`${OUT}/staging-browser.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
