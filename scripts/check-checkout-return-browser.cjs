/* eslint-disable @typescript-eslint/no-require-imports -- Mounted plan-checkout return page, fictional status API, local browser only. */
// The real /billing/return client (src/app/billing/return/return-client.tsx) against a routed
// /api/billing/checkout-status. Covers what a buyer sees when the first Whop webhook is missing
// or late (recovery runs at most once a minute per checkout), a temporary server error, a
// checkout that is never confirmed, and a link that belongs to another account.
// Virtual time (Playwright clock); no provider, database or network access.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { browserType, engineLabel } = require("./browser-engine.cjs");

const REQUEST = "3f1c2b4a-1d2e-4f30-8a9b-0c1d2e3f4a5b";
const pending = { body: { status: "pending" } };
const active = { body: { status: "active", next: "/studio?draft=8b2c1d4e-5f60-4a71-9b82-c3d4e5f6a7b8" } };
const unavailable = { status: 503, body: { error: { code: "CHECKOUT_RECOVERY_UNVERIFIED", message: "Payment confirmation needs another check. Your purchase has not been charged again." } } };
const notFound = { status: 404, body: { error: { code: "CHECKOUT_NOT_FOUND", message: "This checkout is not linked to your signed-in account." } } };

(async () => {
  const bundle = await require("esbuild").build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import CheckoutReturn from './src/app/billing/return/return-client';
      createRoot(document.getElementById('root')!).render(<CheckoutReturn requestId={${JSON.stringify(REQUEST)}}/>);
    ` },
    bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
    plugins: [{ name: "return-fixture", setup(build) {
      build.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ resolveDir: process.cwd(), loader: "jsx", contents: args.path === "next/navigation"
        ? "const router={push(u){window.navigated.push(u)},replace(u){window.navigated.push(u)},refresh(){}};export const useRouter=()=>router;" // stable, like Next's router
        : "import React from 'react';export default function Link(p){return <a {...p}/>}" }));
      build.onResolve({ filter: /^@\// }, args => { const file = path.resolve("src", args.path.slice(2)); return { path: [".ts", ".tsx"].map(ext => file + ext).find(fs.existsSync) ?? file }; });
    } }],
  });
  const css = fs.readFileSync("src/app/billing/return/return.css", "utf8");
  const server = http.createServer((req, res) => {
    if (req.url === "/bundle.js") { res.setHeader("content-type", "application/javascript"); res.end(bundle.outputFiles[0].text); return; }
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;font-family:system-ui,sans-serif}${css}</style></head><body><div id="root"></div><script>window.navigated=[]</script><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser, passed = 0;
  try {
    browser = await browserType.launch({ headless: true });
    /** A page whose status API answers from `replies` in order (the last reply repeats). */
    const open = async (replies, viewport = { width: 1200, height: 800 }) => {
      const p = await browser.newPage({ viewport, reducedMotion: "reduce" });
      const errors = [], calls = [];
      p.on("pageerror", e => errors.push(e.message));
      await p.clock.install();
      await p.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin !== base) return route.abort();
        if (url.pathname !== "/api/billing/checkout-status") return route.continue();
        assert.equal(url.searchParams.get("request"), REQUEST);
        calls.push(url.pathname);
        const reply = replies.length > 1 ? replies.shift() : replies[0];
        return route.fulfill({ status: reply.status ?? 200, contentType: "application/json", body: JSON.stringify(reply.body) });
      });
      // The tab that started checkout saved a brief to return to.
      await p.addInitScript(() => { try { sessionStorage.setItem("makeborne-creation-checkout-v1", JSON.stringify({ next: "/studio?draft=8b2c1d4e-5f60-4a71-9b82-c3d4e5f6a7b8" })); } catch { /* optional */ } });
      await p.goto(`${base}/billing/return?request=${REQUEST}`);
      await p.locator("h1").waitFor();
      p.calls = calls; p.errors = errors;
      return p;
    };
    // Advance virtual time in small steps so each routed status response (real time) lands
    // before the next timer is due, as it would in a real browser.
    const settle = async (p, ms) => { for (let left = ms; left > 0; left -= 500) { await p.clock.runFor(Math.min(500, left)); await p.waitForTimeout(30); } };
    const text = p => p.locator("section").innerText();
    const done = async (p, name) => { assert.deepEqual(p.errors, [], `${name}: no page errors`); await p.close(); passed++; console.log(`PASS ${name}`); };

    {
      // Missing first webhook: recovery finds the payment on its second attempt (cooldown 60 s),
      // i.e. after the old 30-second polling window. The page must still be polling then.
      const p = await open([...Array(16).fill(pending), active]);
      await settle(p, 31_000);
      assert.equal(p.calls.length, 12, "12 quick checks in the first 30 s");
      assert.match(await text(p), /Still confirming with Whop\. This can take a minute or two\. Your draft is safe\./);
      assert.equal(await p.getByRole("button", { name: /Check again/ }).count(), 0, "No retry button while still checking");
      await settle(p, 45_000);
      await p.getByRole("heading", { name: "You’re ready to create." }).waitFor();
      assert.deepEqual(await p.evaluate(() => window.navigated), ["/studio?draft=8b2c1d4e-5f60-4a71-9b82-c3d4e5f6a7b8"]);
      assert.equal(await p.evaluate(() => sessionStorage.getItem("makeborne-creation-checkout-v1")), null, "Checkout key cleared once access is verified");
      const before = p.calls.length; await settle(p, 60_000); assert.equal(p.calls.length, before, "Polling stops once active");
      await done(p, "late recovery (after 60 s) still opens the saved draft");
    }
    {
      // A temporary recovery failure (503) is retried; it no longer ends the page in an error.
      const p = await open([unavailable, unavailable, active]);
      await settle(p, 6_000);
      await p.getByRole("heading", { name: "You’re ready to create." }).waitFor();
      assert.equal(p.calls.length, 3);
      await done(p, "temporary 503 is retried, then access opens");
    }
    {
      // Never confirmed (webhook and recovery both silent, or a payment that needs a manual check).
      const p = await open([pending], { width: 375, height: 760 });
      await settle(p, 31_000 + 9 * 10_000);
      await p.getByRole("heading", { name: "Let’s confirm your access." }).waitFor();
      assert.equal(p.calls.length, 21, "About two minutes of checks, then stop");
      const body = await text(p);
      assert.match(body, /Whop hasn’t confirmed this payment to us yet\. Your draft is safe\./);
      assert.match(body, /If you paid, don’t pay again/);
      assert.match(body, /email admin@makeborne\.com/);
      assert.doesNotMatch(body, /purchase again|Check again shortly/);
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "No horizontal overflow at 375 px");
      const before = p.calls.length; await settle(p, 60_000); assert.equal(p.calls.length, before, "No polling after the window");
      await p.getByRole("button", { name: /Check again/ }).click();
      await p.getByRole("heading", { name: "Confirming your membership." }).waitFor();
      await settle(p, 100); assert.equal(p.calls.length, before + 1, "Check again restarts polling");
      await done(p, "unconfirmed checkout ends honestly with a support route (375 px)");
    }
    {
      // The link belongs to another signed-in account: stop at once; retrying cannot help.
      const p = await open([notFound]);
      await settle(p, 200);
      await p.getByRole("heading", { name: "Let’s confirm your access." }).waitFor();
      assert.match(await text(p), /This checkout is not linked to your signed-in account\./);
      assert.equal(await p.getByRole("button", { name: /Check again/ }).count(), 0);
      await settle(p, 30_000); assert.equal(p.calls.length, 1, "A 4xx answer is not polled");
      await done(p, "another account's checkout stops immediately");
    }
    console.log(`${passed} checkout return checks pass in ${engineLabel}; fictional status API, no provider or database`);
  } finally {
    await browser?.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
