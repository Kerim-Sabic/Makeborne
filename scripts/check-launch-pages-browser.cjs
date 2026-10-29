/* eslint-disable @typescript-eslint/no-require-imports -- Browser check against a running local server. */
// Launch landing pages on a phone and a desktop: no page-level sideways scroll, form fields at 16px or
// more on phones (smaller fields make phone browsers zoom on focus), one h1, a branded 404 with a
// main landmark, and indexable public pricing. Usage: node scripts/check-launch-pages-browser.cjs http://localhost:3048
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const base = process.argv[2];
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base ?? "")) throw new Error("Pass a local base URL, for example http://localhost:3048");
const PAGES = ["/", "/billing", "/billing/terms", "/privacy", "/help", "/help/create-a-website-with-ai", "/login", "/login?mode=signup", "/portal/login"];

(async () => {
  const browser = await chromium.launch();
  let passed = 0;
  try {
    for (const width of [390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, isMobile: width < 500, hasTouch: width < 500 });
      const page = await context.newPage();
      for (const route of PAGES) {
        const response = await page.goto(base + route, { waitUntil: "networkidle" });
        assert.equal(response.status(), 200, route);
        const facts = await page.evaluate(() => ({
          sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          h1: document.querySelectorAll("h1").length,
          small: [...document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]),textarea,select")]
            .filter(field => field.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(field).fontSize) < 16)
            .map(field => `${field.id || field.name || field.type} ${getComputedStyle(field).fontSize}`),
        }));
        assert.ok(facts.sideways <= 0, `${route} at ${width}px scrolls sideways by ${facts.sideways}px`);
        assert.equal(facts.h1, 1, `${route} at ${width}px has ${facts.h1} h1 elements`);
        if (width < 500) assert.deepEqual(facts.small, [], `${route} has phone fields under 16px: ${facts.small.join(", ")}`);
        passed++;
      }
      const missing = await page.goto(base + "/this-page-does-not-exist", { waitUntil: "networkidle" });
      assert.equal(missing.status(), 404);
      assert.match(await page.title(), /Page not found · Makeborne/);
      assert.equal(await page.locator("main h1").count(), 1, "the 404 page has a main landmark and one h1");
      assert.ok(await page.getByRole("link", { name: "Go to the home page" }).isVisible());
      passed++;
      await context.close();
    }
    for (const route of ["/billing", "/billing/terms"]) {
      const response = await fetch(base + route, { redirect: "manual" });
      assert.doesNotMatch(response.headers.get("x-robots-tag") ?? "", /noindex/, `${route} must be indexable`);
      passed++;
    }
  } finally { await browser.close(); }
  console.log(`${passed} launch page checks passed.`);
})().catch(error => { console.error(error); process.exit(1); });
