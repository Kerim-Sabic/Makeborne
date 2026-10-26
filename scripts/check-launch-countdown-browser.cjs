/* eslint-disable @typescript-eslint/no-require-imports -- Mounted checks for the launch countdown against a locally running production build.
 * Covers: the full-page launch screen on `/` (figures roll, labels, no Sign in, no horizontal scroll, no layout shift, contrast,
 * no hydration errors, light theme), the waitlist form (mocked API: success, validation, rate limit; real route: closed without
 * its secret), reduced motion, the mocked-clock reveal into the real, interactive home page, the owner preview bypass, big client
 * clock skew, the slim banner (dismiss by mouse and keyboard, the live switch, the 48-hour hide, honest "opening any moment"
 * copy while sales are closed), the plans-page line, the unsubscribe page, and other routes left untouched.
 * Only 127.0.0.1; no AI, mail or payments.
 * Run: start `next start -H 127.0.0.1 -p 3245` on a build of this branch, then
 *      node scripts/check-launch-countdown-browser.cjs [screenshot-dir] [--engine webkit] [--video]
 * MAKEBORNE_LAUNCH_URL overrides the base URL. */
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs");
const { browserType, engine, engineLabel, args, collectPageErrors } = require("./browser-engine.cjs");
const sharp = require("sharp");

const BASE = process.env.MAKEBORNE_LAUNCH_URL || "http://127.0.0.1:3246";
const shots = args.find(arg => !arg.startsWith("--")) ? path.resolve(args.find(arg => !arg.startsWith("--"))) : null;
const video = process.argv.includes("--video") && engine === "chromium";
if (shots) fs.mkdirSync(shots, { recursive: true });
const PHONE = { width: 390, height: 844 }, DESKTOP = { width: 1440, height: 900 };
const HYDRATION = /hydrat|did not match|server rendered|Minified React error #(418|423|425)/i;
let count = 0;
const pass = name => { count++; console.log(`PASS [${engineLabel}] ${name}`); };
const shot = async (page, name, options = {}) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}-${engine}.png`), ...options }); };
const iso = ms => new Date(ms).toISOString();
/** The figures currently shown in a unit (the incoming span of each slot; an outgoing one may still be rolling away). */
const figures = (page, unit) => page.locator(`[data-unit="${unit}"] .mbl-digit>span:first-child`).allInnerTexts().then(parts => parts.join(""));

async function open(browser, { viewport = DESKTOP, reducedMotion = "no-preference", colorScheme = "light", clock = null, record = null, timezoneId = "Europe/Sarajevo" } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion, colorScheme, timezoneId, ...(record ? { recordVideo: { dir: record, size: viewport } } : {}) });
  await context.route(url => !/^https?:\/\/127\.0\.0\.1(:\d+)?\//.test(url.toString()), route => route.abort());
  if (clock !== null) await context.clock.install({ time: clock });
  const page = await context.newPage();
  const errors = collectPageErrors(page, []), consoleProblems = [];
  page.on("console", message => { if (["error", "warning"].includes(message.type())) consoleProblems.push(message.text()); });
  return { context, page, errors, consoleProblems, hydration: () => [...errors, ...consoleProblems].filter(text => HYDRATION.test(text)) };
}
const noHorizontalScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 0.5);
const layoutShift = page => page.evaluate(() => new Promise(resolve => {
  let total = 0;
  new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) total += entry.value; }).observe({ type: "layout-shift", buffered: true });
  setTimeout(() => resolve(total), 2200);
}));

/** WCAG contrast of each element's text against the brightest (light text) or darkest (dark text) background behind it. */
async function contrast(page, selectors) {
  const results = [];
  for (const selector of selectors) {
    const handle = await page.$(selector);
    if (!handle) throw new Error(`missing ${selector}`);
    const color = await handle.evaluate(node => getComputedStyle(node).color);
    await handle.evaluate(node => { node.dataset.contrastProbe = "1"; });
    await page.addStyleTag({ content: "[data-contrast-probe],[data-contrast-probe] *{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important}[data-contrast-probe] [aria-hidden=true]{visibility:hidden!important}" });
    const box = await handle.boundingBox();
    const png = await page.screenshot({ clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.max(1, box.width), height: Math.max(1, box.height) }, animations: "disabled" });
    await handle.evaluate(node => { delete node.dataset.contrastProbe; });
    await page.evaluate(() => { for (const style of document.querySelectorAll("style")) if (style.textContent.includes("data-contrast-probe")) style.remove(); });
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const lum = (r, g, b) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const [r, g, b] = color.match(/[\d.]+/g).map(Number);
    const text = lum(r, g, b);
    // The 2nd and 98th percentiles: a 1px border or an anti-aliased corner is not the background the text sits on.
    const values = [];
    for (let i = 0; i < data.length; i += info.channels) values.push(lum(data[i], data[i + 1], data[i + 2]));
    values.sort((a, b) => a - b);
    const lo = values[Math.floor(values.length * 0.02)], hi = values[Math.min(values.length - 1, Math.floor(values.length * 0.98))];
    const bg = text > (lo + hi) / 2 ? hi : lo;
    const ratio = (Math.max(text, bg) + 0.05) / (Math.min(text, bg) + 0.05);
    results.push({ selector, ratio: Math.round(ratio * 100) / 100 });
  }
  return results;
}

(async () => {
  const browser = await browserType.launch();
  try {
    const status = await (await fetch(`${BASE}/api/launch-status`)).json();
    assert.equal(status.enabled, true, "start the server with the countdown on");
    assert(Date.now() < Date.parse(status.launchAt), "these checks run before the configured launch moment");
    assert.equal(status.salesOpen, false, "a local build without billing configuration keeps plans closed");

    // 1. Launch screen at phone and desktop width, light and dark preference (one deliberate night look).
    for (const [label, viewport] of [["desktop", DESKTOP], ["phone", PHONE]]) for (const colorScheme of ["light", "dark"]) {
      // Dark-preference runs browse from New York, so the local conversion line shows; light runs from Sarajevo, so it stays empty.
      const { context, page, hydration, errors } = await open(browser, { viewport, colorScheme, timezoneId: colorScheme === "dark" ? "America/New_York" : "Europe/Sarajevo" });
      const response = await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      assert.equal(response.status(), 200);
      const html = await response.text();
      assert.match(html, /<h1 class="mbl-date[^"]*"[^>]*>.*Makeborne launches .*Wednesday 28 October.*19:00 CET<\/time><\/h1>/s, "the date is in the server HTML for crawlers");
      assert.match(html, /<title>Makeborne — Websites, books &amp; presentations<\/title>/);
      assert.match(html, /property="og:title"/);
      assert.doesNotMatch(html, /noindex/);
      assert.equal(await page.locator(".mk-home, #creation-brief").count(), 0, "the home page is not rendered under the countdown");
      assert.equal(await page.locator("#mb-launch-banner").count(), 0, "no slim banner over the full-page screen");
      assert.equal(await page.getByRole("link", { name: /sign in|log in/i }).count(), 0, "no Sign in on the launch screen");
      assert.doesNotMatch(html, />\s*Sign in\s*</);
      const timer = page.locator(".mbl-clock[role=timer]");
      assert.match(await timer.getAttribute("aria-label"), /^\d+ (day|hour|minute)s?(, \d+ (hour|minute)s?)* left$/);
      const secondsNow = await figures(page, "seconds");
      await page.waitForTimeout(1300);
      assert.notEqual(await figures(page, "seconds"), secondsNow, "the seconds roll");
      assert(await page.locator(".mbl-digit-in").count() >= 1, "a rolling figure is animating");
      assert(await noHorizontalScroll(page), "no horizontal scroll");
      const local = (await page.locator(".mbl-local").innerText()).trim();
      if (colorScheme === "dark") assert.match(local, /^(14:00|2:00\s?PM) in your time$/, "New York sees its own time");
      else assert.equal(local, "", "no conversion where the local time reads the same");
      const shift = await layoutShift(page);
      assert(shift < 0.01, `cumulative layout shift ${shift}`);
      assert.match(await page.locator(".mbl-follow").getAttribute("href"), /^https:\/\/www\.instagram\.com\/makeborne$/);
      const live = await page.locator(".mbl-sr[aria-live=polite]").innerText();
      assert.match(live, /until launch\.$/);
      if (colorScheme === "light") {
        const checked = await contrast(page, [".mbl-eyebrow", ".mbl-meta", '[data-unit="days"] .mbl-figures', ".mbl-unit-label", ".mbl-date-lead", ".mbl-date time", ".mbl-tagline", ".mbl-waitlist button", ".mbl-consent", ".mbl-follow", ".mbl-foot>span"]);
        for (const item of checked) assert(item.ratio >= 4.5, `${item.selector} contrast ${item.ratio}`);
        console.log(`     ${label} contrast: ${checked.map(item => `${item.selector} ${item.ratio}`).join(", ")}`);
      }
      await shot(page, `launch-screen-${label}-${colorScheme}`);
      assert.deepEqual(hydration(), [], "no hydration warnings");
      assert.deepEqual(errors, []);
      await context.close();
    }
    pass("launch screen: date in HTML, digits tick, labelled timer, no horizontal scroll or layout shift, contrast, no hydration warnings (390 and 1440, light and dark)");

    // 1b. Light theme and the waitlist: mocked API (success, validation, rate limit), then the real route (closed without its secret).
    {
      const { context, page, hydration } = await open(browser, { viewport: PHONE });
      await page.goto(`${BASE}/?theme=light&utm_source=instagram&ref=story`, { waitUntil: "networkidle" });
      assert.equal(await page.locator(".mbl").getAttribute("data-theme"), "light");
      await page.waitForTimeout(1200);
      await shot(page, "launch-screen-phone-light-theme");
      const sent = [];
      await page.route("**/api/waitlist", async route => {
        sent.push(route.request().postDataJSON());
        await route.fulfill(sent.length === 2
          ? { status: 429, contentType: "application/json", body: JSON.stringify({ error: { code: "WAITLIST_RATE_LIMITED", message: "x" } }) }
          : { status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      });
      const field = page.getByLabel("Email address"), join = page.getByRole("button", { name: /Join the waitlist/ });
      await field.fill("not-an-email");
      await join.click();
      assert.equal(await page.locator(".mbl-waitlist-message").innerText(), "Enter a valid email address.");
      assert.equal(sent.length, 0, "invalid addresses never leave the page");
      await field.fill("Ana.Reed@Example.com");
      await field.press("Enter");
      await page.locator(".mbl-waitlist-done").waitFor();
      assert.equal(await page.locator(".mbl-waitlist-done").innerText(), "You're on the list. We'll email you at launch with your invite.");
      assert.deepEqual(sent[0], { email: "Ana.Reed@Example.com", company: "", source: "utm_source=instagram;ref=story", consent: "waitlist-2026-10-27" });
      await page.waitForTimeout(800);
      await shot(page, "waitlist-joined-phone");
      await page.reload({ waitUntil: "networkidle" });
      await page.getByLabel("Email address").fill("someone@example.com");
      await page.getByRole("button", { name: /Join the waitlist/ }).click();
      await page.waitForFunction(() => /Too many attempts/.test(document.querySelector(".mbl-waitlist-message")?.textContent ?? ""));
      assert.equal(await page.locator(".mbl-hp input").getAttribute("tabindex"), "-1");
      assert.equal(await page.locator(".mbl-hp").getAttribute("aria-hidden"), "true");
      assert.match(await page.locator(".mbl-consent").innerText(), /^We.ll only use your email to send your launch invite and launch news\. Unsubscribe any time\. See our Privacy Policy\.$/);
      assert.equal(await page.locator(".mbl-consent a").getAttribute("href"), "/privacy");
      await page.unroute("**/api/waitlist");
      await page.reload({ waitUntil: "networkidle" });
      await page.getByLabel("Email address").fill("someone@example.com");
      await page.getByRole("button", { name: /Join the waitlist/ }).click();
      await page.waitForFunction(() => /isn.t available right now/.test(document.querySelector(".mbl-waitlist-message")?.textContent ?? ""));
      assert(await noHorizontalScroll(page));
      assert.deepEqual(hydration(), []);
      await context.close();
    }
    {
      const { context, page } = await open(browser);
      await page.goto(`${BASE}/?theme=light`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      const checked = await contrast(page, [".mbl-eyebrow", '[data-unit="days"] .mbl-figures', ".mbl-unit-label", ".mbl-date time", ".mbl-tagline", ".mbl-waitlist button", ".mbl-consent", ".mbl-follow"]);
      for (const item of checked) assert(item.ratio >= 4.5, `light ${item.selector} contrast ${item.ratio}`);
      console.log(`     light contrast: ${checked.map(item => `${item.selector} ${item.ratio}`).join(", ")}`);
      await shot(page, "launch-screen-desktop-light-theme");
      await context.close();
    }
    pass("waitlist: client validation, success copy, honest rate-limit and closed answers, honeypot hidden, consent line; light theme contrast");

    // 2. Reduced motion: no rolling, no seconds, minute updates only.
    {
      const { context, page, hydration } = await open(browser, { reducedMotion: "reduce" });
      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      await page.waitForTimeout(2500);
      assert.equal(await page.locator(".mbl").getAttribute("data-animate"), "off");
      assert.equal(await page.locator(".mbl-digit-in, .mbl-digit-out").count(), 0, "no rolling");
      assert.equal(await page.locator('[data-unit="seconds"]').count(), 0, "seconds hidden; the text updates once a minute");
      const animated = await page.evaluate(() => [".mbl-in", ".mbl-dot"].map(selector => getComputedStyle(document.querySelector(selector)).animationName));
      assert.deepEqual(animated, ["none", "none"], "no intro or breathing");
      await shot(page, "launch-screen-reduced-motion");
      assert.deepEqual(hydration(), []);
      await context.close();
    }
    pass("reduced motion: no intro, rolling or breathing; minute-only updates");

    // 3. The reveal with a mocked clock crossing zero, then the real home page is visible and interactive.
    for (const reducedMotion of ["no-preference", "reduce"]) {
      const start = Date.now(), launch = Math.ceil((start + 30 * 60_000) / 1000) * 1000; // half an hour away on the server
      const record = video && reducedMotion === "no-preference" && shots ? path.join(shots, "video-tmp") : null;
      const { context, page, hydration } = await open(browser, { reducedMotion, clock: start, record });
      await page.goto(`${BASE}/?countdown=at:${iso(launch)}`, { waitUntil: "networkidle" });
      assert.equal(await page.locator(".mbl").getAttribute("data-stage"), "count");
      assert.equal(await page.locator(".mk-home").count(), 0);
      // Jump to five seconds before zero (the laptop-lid case): the countdown recomputes from the absolute instant.
      await page.clock.fastForward(launch - start - 5_000 - (Date.now() - start));
      await page.waitForTimeout(400);
      assert.match(await page.locator(".mbl-clock").getAttribute("aria-label"), /^Less than a minute left$/);
      if (reducedMotion === "no-preference") await shot(page, "reveal-0-five-seconds");
      await page.waitForSelector('.mbl[data-stage="zero"], .mbl[data-stage="live"]', { timeout: 12_000 });
      await page.waitForSelector('.mbl[data-stage="live"]', { timeout: 4_000 });
      await page.waitForTimeout(reducedMotion === "reduce" ? 300 : 1300);
      assert.equal(await page.locator(".mbl-eyebrow").innerText(), "NOW OPEN");
      assert.equal(await page.locator(".mbl-sr[aria-live=polite]").innerText(), "Makeborne is live.");
      if (reducedMotion === "no-preference") await shot(page, "reveal-1-we-are-live");
      await page.waitForSelector('.mbl[data-stage="opening"]', { timeout: 8_000 });
      if (reducedMotion === "no-preference") { await page.waitForTimeout(1000); await shot(page, "reveal-2-opening"); }
      await page.waitForSelector(".mbl", { state: "detached", timeout: 6_000 });
      await page.waitForSelector(".mk-home h1#creation-heading", { state: "visible" });
      await page.locator("#creation-brief").fill("A website for my bakery");
      assert.equal(await page.locator("#creation-brief").inputValue(), "A website for my bakery", "the home composer works after the reveal");
      await page.locator(".mk-format-switch button", { hasText: "Book" }).click();
      assert.equal(await page.locator(".mk-format-switch button", { hasText: "Book" }).getAttribute("aria-pressed"), "true");
      assert.equal(await page.evaluate(() => document.documentElement.style.overflow), "", "page scrolling restored");
      // The slim banner now says "We're live", and, with plans still closed on this server, never claims checkout is open.
      const banner = page.locator("#mb-launch-banner");
      await banner.waitFor({ state: "visible" });
      assert.match(await banner.innerText(), /We're live\s*·\s*Plans opening any moment/);
      assert.equal(await banner.locator("a", { hasText: "See plans" }).count(), 0);
      if (reducedMotion === "no-preference") await shot(page, "reveal-3-home-live");
      assert(await noHorizontalScroll(page));
      assert.deepEqual(hydration(), []);
      await context.close();
      if (record) {
        const file = fs.readdirSync(record).find(name => name.endsWith(".webm"));
        if (file) fs.renameSync(path.join(record, file), path.join(shots, "reveal.webm"));
        fs.rmSync(record, { recursive: true, force: true });
      }
    }
    pass("mocked clock crosses zero: the figures roll to \"We're live.\", the screen splits and lifts (a cross-fade for reduced motion) onto an interactive home page; banner says opening any moment");

    // 4. Owner preview bypass, remembered in a cookie, and undone.
    {
      const { context, page, hydration } = await open(browser);
      await page.goto(`${BASE}/?preview=site`, { waitUntil: "networkidle" });
      assert.equal(await page.locator(".mbl").count(), 0);
      await page.locator(".mk-home h1#creation-heading").waitFor();
      const banner = page.locator("#mb-launch-banner");
      await banner.waitFor({ state: "visible" });
      assert.match(await banner.innerText(), /Wed 28 Oct, 19:00 CET\s*·\s*\d+d \d+h \d+m/);
      assert.equal((await context.cookies()).find(cookie => cookie.name === "makeborne_launch_preview")?.value, "site");
      await shot(page, "preview-home-with-banner");
      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      assert.equal(await page.locator(".mbl").count(), 0, "the cookie keeps the preview");
      await page.goto(`${BASE}/?preview=off`, { waitUntil: "networkidle" });
      assert.equal(await page.locator(".mbl").count(), 1, "preview=off shows the launch screen again");
      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      assert.equal(await page.locator(".mbl").count(), 1);
      assert.deepEqual(hydration(), []);
      await context.close();
    }
    pass("?preview=site shows the normal home page (cookie), ?preview=off restores the launch screen");

    // 5. A browser clock three days fast is corrected from the server's time: no early reveal.
    {
      const { context, page, hydration } = await open(browser, { clock: Date.now() + 3 * 86_400_000 });
      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1200);
      assert.equal(await page.locator(".mbl").getAttribute("data-stage"), "count", "still counting down");
      const days = Number(await figures(page, "days"));
      const expected = Math.floor((Date.parse(status.launchAt) - Date.now()) / 86_400_000);
      assert.equal(days, expected);
      assert.deepEqual(hydration(), []);
      await context.close();
    }
    pass("big client clock skew is corrected from the server time (no early reveal)");

    // 6. Slim banner on public pages: dismiss by mouse and keyboard, survives reload, phone width.
    {
      const { context, page, hydration } = await open(browser, { viewport: PHONE });
      await page.goto(`${BASE}/help`, { waitUntil: "networkidle" });
      const banner = page.locator("#mb-launch-banner");
      assert.match(await banner.innerText(), /Wed 28 Oct, 19:00 CET\s*·\s*\d+d \d+h \d+m/);
      assert.match(await banner.locator("[role=timer]").getAttribute("aria-label"), / left$/);
      const height = await banner.evaluate(node => node.getBoundingClientRect().height);
      assert.equal(height, 40);
      assert(await noHorizontalScroll(page));
      const checked = await contrast(page, [".mb-launch-text>span:nth-of-type(3)", ".mb-launch-left"]);
      for (const item of checked) assert(item.ratio >= 4.5, `${item.selector} contrast ${item.ratio}`);
      await shot(page, "banner-phone", { clip: { x: 0, y: 0, width: PHONE.width, height: 220 } });
      await banner.getByRole("button", { name: "Dismiss launch announcement" }).click();
      assert.equal(await banner.count(), 0);
      await page.reload({ waitUntil: "networkidle" });
      assert.equal(await page.locator("#mb-launch-banner:visible").count(), 0, "stays dismissed this session, before paint");
      assert.deepEqual(hydration(), [], "the pre-paint hide causes no hydration warning");
      await context.close();
    }
    {
      const { context, page } = await open(browser);
      await page.goto(`${BASE}/privacy`, { waitUntil: "networkidle" });
      await shot(page, "banner-desktop", { clip: { x: 0, y: 0, width: DESKTOP.width, height: 260 } });
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Dismiss launch announcement", "first in the tab order");
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#mb-launch-banner").count(), 0, "Escape dismisses");
      await context.close();
    }
    pass("banner: static date text, labelled timer, 40px with no overflow at 390, contrast, dismiss by click/Escape, stays dismissed after reload");

    // 7. Banner switches to live with a mocked clock, then hides after 48 hours.
    {
      const start = Date.now();
      const { context, page, hydration } = await open(browser, { clock: start });
      await page.goto(`${BASE}/help?countdown=at:${iso(start + 6_000)}`, { waitUntil: "networkidle" });
      assert.match(await page.locator("#mb-launch-banner").innerText(), /\d+s/);
      await page.clock.fastForward(7_000);
      await page.waitForFunction(() => /We're live/.test(document.querySelector("#mb-launch-banner")?.textContent ?? ""), null, { timeout: 5_000 });
      assert.match(await page.locator("#mb-launch-banner").innerText(), /Plans opening any moment/);
      await shot(page, "banner-live", { clip: { x: 0, y: 0, width: DESKTOP.width, height: 200 } });
      await page.goto(`${BASE}/help?countdown=at:${iso(start - 49 * 3_600_000)}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      assert.equal(await page.locator("#mb-launch-banner").count(), 0, "hidden after the 48-hour window");
      assert.deepEqual(hydration(), []);
      await context.close();
    }
    pass("banner: live switch with no reload; honest copy while plans are closed; hidden after 48 hours");

    // 8. Plans page line, and every other route untouched.
    {
      const { context, page, hydration } = await open(browser, { viewport: PHONE });
      await page.goto(`${BASE}/billing`, { waitUntil: "networkidle" });
      const line = page.locator(".mb-plans-line");
      assert.match(await line.innerText(), /Plans open in \d+d \d+h \d+m\s*Wednesday 28 October, 19:00 CET/);
      assert(await noHorizontalScroll(page));
      await line.scrollIntoViewIfNeeded();
      await shot(page, "billing-plans-line");
      assert.deepEqual(hydration(), []);
      await context.close();
    }
    {
      const { context, page, hydration } = await open(browser);
      await page.goto(`${BASE}/waitlist/unsubscribe?id=6f1c1e7a-3b0e-4c1a-9a51-0d6d8d3e2b10&sig=${"0".repeat(64)}`, { waitUntil: "networkidle" });
      assert.equal(await page.locator("h1").innerText(), "Leave the launch waitlist?");
      await page.getByRole("button", { name: "Unsubscribe" }).click();
      await page.waitForURL(/status=invalid/);
      assert.equal(await page.locator("h1").innerText(), "This link didn't work.", "a bad signature changes nothing");
      assert.deepEqual(hydration(), []);
      await context.close();
    }
    for (const route of ["/login", "/login?mode=signup", "/studio", "/chat", "/portal/login", "/auth/verify", "/review/" + "Rv".repeat(21) + "x", "/billing/return", "/waitlist/unsubscribe"]) {
      const { context, page, hydration } = await open(browser);
      const response = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
      assert(response.status() < 500, `${route} ${response.status()}`);
      await page.waitForTimeout(300);
      assert.equal(await page.locator(".mbl").count(), 0, `${route} has no launch screen`);
      const landed = new URL(page.url()).pathname, path = route.split("?")[0];
      // A route that redirects to a public page (for example /billing/return without an order goes to /billing) may carry it there.
      if (landed === path || !/^\/(billing|help|privacy)/.test(landed)) assert.equal(await page.locator("#mb-launch-banner").count(), 0, `${route} has no banner`);
      else console.log(`     NOTE ${route} redirected to ${landed}`);
      assert.deepEqual(hydration(), [], route);
      await context.close();
    }
    pass("plans page shows 'Plans open in …'; login, studio, chat, portal, auth, client review and checkout return are untouched");
  } finally {
    await browser.close();
  }
  console.log(`${count} launch countdown browser groups passed in ${engineLabel}`);
})().catch(error => { console.error(error); process.exit(1); });
