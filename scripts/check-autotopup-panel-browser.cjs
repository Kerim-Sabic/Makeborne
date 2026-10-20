/* eslint-disable @typescript-eslint/no-require-imports -- Mounted BillingAutotopup in Chromium at 375px (audit: top-up panel gaps). /api/billing/autotopup is answered by Playwright routes with fictional state; nothing is charged, no provider or database is contacted. Local only. Run: node scripts/check-autotopup-panel-browser.cjs */
const path = require("node:path"), fs = require("node:fs"), assert = require("node:assert/strict"), { build } = require("esbuild"), { chromium } = require("playwright"), { createServer } = require("node:http");

const fixture = `import React from "react"; import { createRoot } from "react-dom/client";
import BillingAutotopup from "./src/components/billing-autotopup";
createRoot(document.getElementById("root")).render(<main style={{ padding: 16 }}><BillingAutotopup /></main>);`;
const offer = extra => ({ chargingEnabled: false, termsVersion: "v1", credits: 100, priceCents: 1200, maxMonthlyCharges: 6, maxDailyCharges: 2, thresholds: [25, 50, 100], ...extra });
const authorization = extra => ({ id: 7, termsVersion: "v1", credits: 100, priceCents: 1200, thresholdCredits: 50, monthlyLimitCharges: 4, dailyLimitCharges: 2, authorizedAt: "2026-10-20T10:00:00.000Z", ...extra });
const status = (o, a) => ({ offer: o, authorization: a, attempts: [] });

async function main() {
  const css = [];
  const output = await build({ stdin: { contents: fixture, loader: "jsx", resolveDir: process.cwd() }, write: false, bundle: true, platform: "browser", jsx: "automatic", define: { "process.env": "{}" },
    plugins: [{ name: "fixture", setup(b) {
      b.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
      b.onResolve({ filter: /^@\// }, args => ({ path: path.resolve("src", args.path.slice(2) + ".ts") }));
    } }] });
  css.push(fs.readFileSync(path.resolve("src/app/billing/billing.css"), "utf8"));
  const server = createServer((req, res) => { const js = req.url === "/fixture.js"; res.setHeader("Content-Type", js ? "text/javascript" : "text/html"); res.end(js ? output.outputFiles[0].contents : `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:sans-serif}${css.join("\n")}</style><div id="root"></div><script src="/fixture.js"></script>`); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  let passed = 0; const pass = name => { passed++; console.log(`PASS ${name}`); };
  const shots = process.env.SHOTS_DIR;
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 900 } });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
    // Each scenario supplies GET and POST behaviour; every request is logged.
    let log = [], onGet = () => null, onPost = () => null;
    await page.route("**/api/billing/autotopup", async route => {
      const request = route.request(); const method = request.method();
      log.push(method === "POST" ? `POST ${JSON.parse(request.postData()).action}` : "GET");
      const answer = method === "POST" ? onPost(JSON.parse(request.postData())) : onGet();
      if (answer === "abort") return route.abort("connectionreset");
      return route.fulfill({ status: answer.status ?? 200, contentType: "application/json", body: answer.raw ?? JSON.stringify(answer.body) });
    });
    const heading = () => page.locator("#autotopup-heading").innerText();
    const mount = async (get, post = () => { throw new Error("unexpected POST"); }) => { log = []; onGet = get; onPost = post; await page.goto(url); await page.locator("#autotopup-heading").waitFor(); await page.locator(".billing-autotopup p").first().waitFor(); };
    const noOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "no horizontal overflow at 375px");

    // 1. Price withdrawn: the existing authorization is shown and can be turned off with the keyboard.
    let state = status(offer({ priceCents: null }), authorization());
    await mount(() => ({ body: state }), body => { assert.equal(body.action, "disable"); state = status(state.offer, null); return { body: state }; });
    assert.equal(await heading(), "Automatic top-ups: authorization saved");
    assert.match(await page.locator(".billing-autotopup").innerText(), /not available right now, so no automatic charge happens/);
    assert.equal(await page.getByRole("button", { name: "Review the new terms" }).count(), 0, "nothing to review without a price");
    await noOverflow();
    if (shots) await page.locator(".billing-autotopup").screenshot({ path: path.join(shots, "autotopup-price-null-375.png") });
    await page.getByRole("button", { name: "Turn off automatic top-ups" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("status").filter({ hasText: "Automatic top-ups are off" }).waitFor();
    assert.deepEqual(log, ["GET", "POST disable"]);
    assert.match(await page.locator(".billing-autotopup").innerText(), /being prepared\. Their price has not been set/);
    pass("price null: authorization shown, Turn off reachable and keyboard-operable; afterwards the pending offer is shown");

    state = { ...status(offer({ termsVersion: "v2" }), authorization()), setupEnabled: false };
    await mount(() => ({ body: state }), body => {
      assert.equal(body.action, "disable");
      state = { ...state, authorization: null };
      return { body: state };
    });
    assert.equal(await page.getByRole("button", { name: "Review the new terms" }).count(), 0);
    assert.equal(await page.getByRole("checkbox").count(), 0);
    await page.getByRole("button", { name: "Turn off automatic top-ups" }).click();
    await page.getByRole("status").filter({ hasText: "Automatic top-ups are off" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Enable automatic top-ups" }).count(), 0);
    assert.match(await page.locator(".billing-autotopup").innerText(), /New automatic top-up authorizations are unavailable/);
    assert.deepEqual(log, ["GET", "POST disable"], "no enable or extra mutation when setup is disabled");
    pass("setup disabled: old authorization remains revocable; no new or replacement consent is offered");

    // 2. Initial load failure: Try again reads only.
    let failures = 1;
    await mount(() => (failures-- > 0 ? { status: 503, body: { error: { message: "Automatic top-up settings could not be loaded." } } } : { body: status(offer(), null) }));
    assert.match(await page.getByRole("alert").innerText(), /could not be loaded/);
    await page.getByRole("button", { name: "Try again" }).click();
    await page.getByRole("button", { name: "Enable automatic top-ups" }).waitFor();
    assert.deepEqual(log, ["GET", "GET"], "retry is a read, never a change");
    assert.equal(await page.getByRole("checkbox").isChecked(), false, "consent starts unchecked");
    pass("initial load failure offers Try again (GET only); consent stays unchecked");

    // 3. Charging enabled vs not: the heading says which.
    await mount(() => ({ body: status(offer({ chargingEnabled: true }), authorization()) }));
    assert.equal(await heading(), "Automatic top-ups are on");
    pass("'are on' only when charging is enabled");

    // 4. Changed terms: review the new offer, confirm explicitly; the old authorization stays revocable meanwhile.
    state = status(offer({ termsVersion: "v2", priceCents: 1500 }), authorization());
    await mount(() => ({ body: state }), body => {
      assert.deepEqual(body, { action: "enable", confirmed: true, termsVersion: "v2", priceCents: 1500, threshold: 25, monthlyLimit: 4 });
      state = status(state.offer, authorization({ id: 8, termsVersion: "v2", priceCents: 1500, thresholdCredits: 25 })); return { body: state };
    });
    await page.getByRole("button", { name: "Review the new terms" }).click();
    assert.ok(await page.getByRole("button", { name: "Turn off automatic top-ups" }).isVisible(), "revoke stays available while reviewing");
    await page.getByLabel("When available credits fall below").selectOption("25");
    assert.equal(await page.getByRole("button", { name: "Confirm the new terms" }).isDisabled(), true, "no implicit re-consent");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Confirm the new terms" }).click();
    await page.getByRole("status").filter({ hasText: "Your authorization was saved." }).waitFor();
    assert.deepEqual(log, ["GET", "POST enable"]);
    assert.doesNotMatch(await page.locator(".billing-autotopup").innerText(), /offer changed/);
    await noOverflow();
    pass("changed terms: reviewable, needs explicit confirmation, replaces the authorization; revoke reachable throughout");

    // 5. Uncertain POST (connection dropped) is reconciled from the server: one POST, then a read.
    state = status(offer(), authorization());
    await mount(() => ({ body: state }), () => { state = status(state.offer, null); return "abort"; });
    await page.getByRole("button", { name: "Turn off automatic top-ups" }).click();
    await page.getByRole("status").filter({ hasText: "Automatic top-ups are off" }).waitFor();
    assert.deepEqual(log, ["GET", "POST disable", "GET"], "no duplicate change; status read once");
    pass("dropped response after a successful turn-off: reconciled to 'off' from the server, no second POST");
    state = status(offer(), authorization());
    await mount(() => ({ body: state }), () => ({ status: 504, raw: "gateway timeout" }));
    await page.getByRole("button", { name: "Turn off automatic top-ups" }).click();
    await page.getByRole("alert").filter({ hasText: "still saved" }).waitFor();
    assert.doesNotMatch(await page.locator(".billing-autotopup").innerText(), /Nothing was changed/);
    pass("timeout where nothing changed: the server's status says the authorization is still saved");

    // 6. Uncertain and the status read also fails: no claim either way; Check current status only reads.
    state = status(offer(), authorization()); let reads = 0;
    await mount(() => (++reads === 2 ? "abort" : { body: state }), () => "abort");
    await page.getByRole("button", { name: "Turn off automatic top-ups" }).click();
    await page.getByRole("alert").filter({ hasText: "couldn't confirm whether your change was saved" }).waitFor();
    await page.getByRole("button", { name: "Check current status" }).click();
    await page.getByRole("status").filter({ hasText: "current automatic top-up settings" }).waitFor();
    assert.deepEqual(log, ["GET", "POST disable", "GET", "GET"], "checking never repeats the change");
    if (shots) await page.locator(".billing-autotopup").screenshot({ path: path.join(shots, "autotopup-reconciled-375.png") });
    pass("unknown outcome and failed read: honest message; Check current status is read-only");

    // 7. A definite refusal is reported as the server's message.
    await mount(() => ({ body: status(offer(), null) }), () => ({ status: 409, body: { error: { message: "The automatic top-up offer changed. Review it and confirm again." } } }));
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Enable automatic top-ups" }).click();
    await page.getByRole("alert").filter({ hasText: "offer changed" }).waitFor();
    assert.deepEqual(log, ["GET", "POST enable"]);
    pass("a refused change shows the server's reason without a status guess");
  } finally { await browser.close(); server.close(); }
  console.log(`${passed} mounted automatic top-up checks passed (Chromium 375px, routed API, nothing charged).`);
}
main().catch(error => { console.error(error); process.exit(1); });
