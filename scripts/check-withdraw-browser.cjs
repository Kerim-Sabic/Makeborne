/* eslint-disable @typescript-eslint/no-require-imports -- Mounted withdrawal form and billing confirmations at 390 and 1440 px; mocked HTTP only, nothing is stored or sent. */
const assert = require("node:assert/strict"), fs = require("node:fs"), http = require("node:http"), path = require("node:path");
const { browserType, args } = require("./browser-engine.cjs");
const shots = args[0] ? path.resolve(args[0]) : null;
const build = entry => require("esbuild").build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' }, resolveExtensions: [".tsx", ".ts", ".js"], loader: { ".module.css": "local-css" },
  plugins: [{ name: "alias", setup(b) { b.onResolve({ filter: /^@\// }, a => { const file = path.resolve("src", a.path.slice(2)); return { path: fs.existsSync(file + ".ts") ? file + ".ts" : fs.existsSync(file + ".tsx") ? file + ".tsx" : file }; }); } }] });
const payments = [
  { paymentId: "pay_Fixture1", label: "Studio plan, monthly · US$49.00 · 29 Oct 2026", service: "Makeborne Studio plan, billed monthly (US$49.00, ordered on 29 October 2026, Whop payment reference pay_Fixture1)" },
  { paymentId: "pay_Pack1", label: "Credit pack, 300 credits · US$32.00 · 30 Oct 2026", service: "Makeborne credit pack, 300 credits (US$32.00, ordered on 30 October 2026, Whop payment reference pay_Pack1)" }];
const records = { confirmations: [{ id: "c1", kind: "plan", paymentId: "pay_Fixture1", product: "Studio plan", interval: "monthly", credits: 750, amountCents: 4900, currency: "usd", paidAt: "2026-10-29T20:04:00Z",
  subject: "Your Makeborne purchase confirmation: Studio plan, monthly", body: "Hello,\n\nThank you for your purchase. This email confirms your contract with Makeborne.\n- Whop payment reference: pay_Fixture1_with_a_very_long_reference_that_must_wrap_inside_the_box", mail: "sent", sentAt: "2026-10-29T20:05:00Z" }],
  withdrawals: [{ reference: "WD-0A1B2C3D", receivedAt: "2026-10-31T10:00:00Z", paymentId: "pay_Fixture1", paymentReference: null, acknowledgement: "queued", mail: "sent" }], payments: [] };
(async () => {
  const signedIn = await build(`import React from 'react';import {createRoot} from 'react-dom/client';import F from '@/components/legal/withdraw-form';createRoot(document.getElementById('root')).render(<F signedIn accountEmail="ana@example.test" mailOn payments={${JSON.stringify(payments)}}/>);`);
  const signedOut = await build(`import React from 'react';import {createRoot} from 'react-dom/client';import F from '@/components/legal/withdraw-form';createRoot(document.getElementById('root')).render(<F signedIn={false} accountEmail={null} mailOn={false} payments={[]}/>);`);
  const billing = await build(`import React from 'react';import {createRoot} from 'react-dom/client';import B from '@/components/billing-confirmations';createRoot(document.getElementById('root')).render(<B records={${JSON.stringify(records)}}/>);`);
  const bundles = { "/in": signedIn, "/out": signedOut, "/confirmations": billing };
  const requests = [];
  const queued = { status: 201, body: { reference: "WD-0A1B2C3D", receivedAt: "2026-10-31T10:00:00Z", acknowledgement: "queued", statement: "", email: "ana@example.test", paymentId: "pay_Fixture1" } };
  let reply = queued;
  const server = http.createServer((req, res) => {
    const [route, kind] = req.url.split(".");
    if (req.url === "/app-billing.css") { res.setHeader("content-type", "text/css"); res.end(fs.readFileSync("src/app/billing/billing.css", "utf8")); return; }
    if (bundles[route] && (kind === "js" || kind === "css")) { const out = bundles[route].outputFiles.find(f => f.path.endsWith("." + kind)); res.setHeader("content-type", kind === "js" ? "text/javascript" : "text/css"); res.end(out ? out.text : ""); return; }
    if (req.url === "/api/legal/withdraw") { let body = ""; req.on("data", c => body += c); req.on("end", () => { const parsed = JSON.parse(body); requests.push(parsed);
      res.statusCode = reply.status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(reply.status < 300 ? { ...reply.body, statement: `I hereby give notice that I withdraw from my contract for the supply of the following service: ${parsed.paymentId ? payments.find(p => p.paymentId === parsed.paymentId).service : "Makeborne purchase"}.` } : reply.body)); }); return; }
    if (req.url === "/app-billing.css") { res.setHeader("content-type", "text/css"); res.end(fs.readFileSync("src/app/billing/billing.css", "utf8")); return; }
    res.setHeader("content-type", "text/html");
    res.end(`<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app-billing.css"><link rel="stylesheet" href="${req.url}.css"><main style="max-width:780px;margin:0 auto;padding:0 16px"><div id="root"></div></main><script src="${req.url}.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "no sideways scroll");
  let browser;
  try {
    browser = await browserType.launch({ headless: true });
    for (const width of [390, 1440]) {
      const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
      const errors = []; page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error" && !/status of 429/.test(m.text())) errors.push(m.text()); }); // the 429 is the simulated rate limit
      // Signed in: two steps, the notice shows exactly what is sent, then the stored reference and time.
      requests.length = 0; reply = queued;
      await page.goto(`${base}/in`);
      await page.getByRole("button", { name: "Withdraw from contract here" }).click();
      assert.equal(await page.getByLabel("Purchase").inputValue(), "pay_Fixture1");
      assert.match(await page.locator("form").innerText(), /Your notice reads\s*I hereby give notice that I withdraw from my contract for the supply of the following service: Makeborne Studio plan, billed monthly/i);
      await page.getByLabel("Purchase").selectOption("pay_Pack1");
      assert.match(await page.locator("form").innerText(), /Makeborne credit pack, 300 credits/);
      assert.equal(await page.getByLabel(/Whop payment reference/).count(), 0, "a chosen purchase needs no typed reference");
      await page.getByLabel("Purchase").selectOption("");
      await page.getByLabel(/Whop payment reference/).fill("pay_Typed9");
      assert.match(await page.locator("form").innerText(), /Makeborne purchase with the payment reference pay_Typed9/);
      await page.getByLabel("Purchase").selectOption("pay_Fixture1");
      await noOverflow(page);
      if (shots) await page.screenshot({ path: path.join(shots, `withdraw-form-${width}.png`), fullPage: true });
      await page.getByRole("button", { name: "Confirm withdrawal" }).click();
      await page.getByRole("heading", { name: "We received your withdrawal notice." }).waitFor();
      assert.deepEqual(requests[0], { paymentId: "pay_Fixture1", confirm: true });
      const done = await page.getByRole("status").innerText();
      assert.match(done, /WD-0A1B2C3D/); assert.match(done, /31 October 2026/); assert.match(done, /is on its way to ana@example\.test/);
      await noOverflow(page);
      if (shots) await page.screenshot({ path: path.join(shots, `withdraw-done-${width}.png`), fullPage: true });
      // Signed out: the address is required; failures keep the form and say how to send it anyway.
      requests.length = 0;
      await page.goto(`${base}/out`);
      await page.getByRole("button", { name: "Withdraw from contract here" }).click();
      assert.equal(await page.getByRole("button", { name: "Confirm withdrawal" }).isDisabled(), true);
      await page.getByLabel("Email address of your Makeborne account").fill("Buyer@Example.test");
      assert.match(await page.locator("form").innerText(), /Makeborne purchase on the account buyer@example\.test/);
      reply = { status: 429, body: { error: { code: "WITHDRAWAL_RATE_LIMITED", message: "We already have several notices from this address today. Email admin@makeborne.com and we will help." } } };
      await page.getByRole("button", { name: "Confirm withdrawal" }).click();
      await page.getByRole("alert").waitFor();
      assert.match(await page.getByRole("alert").innerText(), /Email admin@makeborne\.com/);
      assert.deepEqual(requests[0], { email: "Buyer@Example.test", confirm: true });
      reply = { status: 201, body: { reference: "WD-11112222", receivedAt: "2026-10-31T11:00:00Z", acknowledgement: "manual", statement: "", email: "buyer@example.test", paymentId: null } };
      await page.getByRole("button", { name: "Confirm withdrawal" }).click();
      await page.getByRole("heading", { name: "We received your withdrawal notice." }).waitFor();
      assert.match(await page.getByRole("status").innerText(), /We reply from admin@makeborne\.com within 2 working days/);
      await noOverflow(page);
      // Billing: the stored confirmation text is retrievable and long references wrap.
      await page.goto(`${base}/confirmations`);
      await page.getByRole("heading", { name: "Purchase confirmations." }).waitFor();
      await page.locator("summary").first().click();
      assert.match(await page.locator(".billing-confirmation-text").innerText(), /This email confirms your contract with Makeborne/);
      assert.match(await page.locator("#confirmations").innerText(), /WD-0A1B2C3D/);
      assert.equal(await page.getByRole("link", { name: "withdrawal page" }).getAttribute("href"), "/withdraw");
      await noOverflow(page);
      if (shots) await page.screenshot({ path: path.join(shots, `billing-confirmations-${width}.png`), fullPage: true });
      assert.deepEqual(errors, [], `no page or console errors: ${errors.join(" | ")}`);
    }
    console.log("PASS withdrawal form and billing confirmations at 390 and 1440 px: two-step notice, exact statement, stored reference and time, honest failures, retrievable confirmation text, no overflow");
  } finally { await browser?.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
