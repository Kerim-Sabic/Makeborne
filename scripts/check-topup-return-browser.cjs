/* eslint-disable @typescript-eslint/no-require-imports -- Real mounted components, synthetic same-origin API, local browser only. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const ORDER_A = "abcdefab-1234-4234-8234-123456789abc";
const ORDER_B = "abcdefab-1234-4234-8234-123456789def";
const order = (state = "pending", orderId = ORDER_A) => ({ orderId, packId: "boost_100", credits: 100, priceCents: 1200, currency: "usd", state });
const balance = available => ({ balance: available, available, reserved: 0, unlimited: false, nextExpiry: null });
const out = path.resolve("work/topup-return-browser");
const results = [];

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const bundle = await require("esbuild").build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
      import TopupReturn from './src/components/billing-topup-return';
      import CreditBalance, {CREDITS_CHANGED_EVENT} from './src/components/credit-balance';
      const w = window as any;
      w.calls=[];w.abortCount=0;w.activeTopups=0;w.maxActiveTopups=0;w.creditEvents=0;w.unexpected=[];
      w.setReplies=(id:string,replies:any[])=>{w.options.replies[id]=replies};
      window.addEventListener(CREDITS_CHANGED_EVENT,()=>w.creditEvents++);
      w.fetch=(url:any,init:any={})=>{
        const target=new URL(String(url),location.href);
        if(target.origin!==location.origin || (target.pathname!='/api/credits' && !/^\\/api\\/billing\\/topups\\/[a-f0-9-]+$/.test(target.pathname))){w.unexpected.push(String(url));return Promise.reject(Error('Unexpected request'));}
        const topup=target.pathname!='/api/credits';
        const call={url:target.pathname,cache:init.cache,credentials:init.credentials,aborted:false};w.calls.push(call);
        let spec:any;
        if(topup){const id=target.pathname.split('/').pop();const replies=w.options.replies[id];spec=replies?.length>1?replies.shift():replies?.[0];w.activeTopups++;w.maxActiveTopups=Math.max(w.maxActiveTopups,w.activeTopups);}
        else spec=w.options.creditReplies?.length>1?w.options.creditReplies.shift():w.options.creditReplies?.[0]??{body:{balance:w.creditEvents?200:100,available:w.creditEvents?200:100,reserved:0,unlimited:false,nextExpiry:null}};
        if(!spec){w.unexpected.push(target.pathname);spec={status:500,body:{secret:'never rendered'}};}
        return new Promise((resolve,reject)=>{
          let done=false,timer:any;
          const finish=(abort=false)=>{
            if(done)return;done=true;clearTimeout(timer);init.signal?.removeEventListener('abort',onAbort);if(topup)w.activeTopups--;
            if(abort){call.aborted=true;if(topup)w.abortCount++;reject(new DOMException('Aborted','AbortError'));}
            else if(spec.reject)reject(Error('private provider failure'));
            else {const response=new Response(spec.malformed?'not json':JSON.stringify(spec.body),{status:spec.status??200,headers:{'Content-Type':'application/json'}});if(spec.bodyDelay)response.json=()=>new Promise(resolveBody=>setTimeout(()=>resolveBody(spec.body),spec.bodyDelay));resolve(response);}
          };
          const onAbort=()=>finish(true);init.signal?.addEventListener('abort',onAbort,{once:true});
          if(init.signal?.aborted)finish(true);else if(!spec.never){if(spec.delay)timer=setTimeout(()=>finish(),spec.delay);else queueMicrotask(()=>finish());}
        });
      };
      function App(){const [id,setId]=useState(w.options.orderId),[mounted,setMounted]=useState(true);
        w.renderOrder=setId;w.mountBanner=setMounted;
        return <main className="billing-shell"><div className="billing-main"><h1>Plans &amp; credits.</h1>{mounted&&<TopupReturn orderId={id}/>}<section id="credits"><h2>Your credits</h2><CreditBalance variant="hero"/></section></div></main>;
      }
      const root=createRoot(document.getElementById('root')!);w.unmount=()=>root.unmount();root.render(<App/>);
    ` },
    bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "native-link", setup(build) {
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "import React from 'react';export default function Link(props){return React.createElement('a',props)}", resolveDir: path.resolve("node_modules") }));
    } }],
  });
  const css = fs.readFileSync("src/app/billing/billing.css", "utf8") + fs.readFileSync("src/app/billing/billing-topup-return.css", "utf8");
  // Use the app's base reset and its Inter family from an already-installed local font.
  const baseCss = fs.readFileSync("src/app/globals.css", "utf8").split(".button {")[0].replace('@import "tailwindcss";', "");
  const font = fs.readFileSync("node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2");
  const server = http.createServer((req, res) => {
    if (req.url === "/bundle.js") { res.setHeader("content-type", "application/javascript"); res.end(bundle.outputFiles[0].text); }
    else if (req.url === "/fixture-inter.woff2") { res.setHeader("content-type", "font/woff2"); res.end(font); }
    else { res.setHeader("content-type", "text/html"); res.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>@font-face{font-family:'Inter Variable';font-style:normal;font-weight:100 900;src:url('/fixture-inter.woff2') format('woff2')} :root{--font-inter:'Inter Variable'}${baseCss}${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const fresh = async (replies = [{ body: order() }], options = {}) => {
      const p = await browser.newPage({ viewport: options.viewport || { width: 1200, height: 800 }, reducedMotion: "reduce" });
      const errors = [];
      p.on("pageerror", e => errors.push(e.message));
      await p.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      await p.clock.install();
      await p.addInitScript(options => { window.options = options; }, { orderId: options.orderId || ORDER_A, creditReplies: options.creditReplies, replies: { [ORDER_A]: replies, [ORDER_B]: [{ body: order("pending", ORDER_B) }] } });
      await p.goto(`${base}/billing?topup=${encodeURIComponent(options.orderId || ORDER_A)}&paid=true`);
      await p.getByRole("region", { name: "Credit-pack checkout status" }).waitFor();
      await p.evaluate(() => document.fonts.ready);
      assert.equal(await p.evaluate(() => document.fonts.check('14px "Inter Variable"')), true);
      p.fixtureErrors = errors;
      return p;
    };
    const title = (p, text) => p.getByRole("heading", { name: text, exact: true }).waitFor();
    const metrics = p => p.evaluate(() => ({ calls: window.calls, aborts: window.abortCount, active: window.activeTopups, maxActive: window.maxActiveTopups, events: window.creditEvents, unexpected: window.unexpected }));
    const topups = value => value.calls.filter(call => call.url.startsWith("/api/billing/topups/"));
    const close = async (p, name) => {
      const m = await metrics(p);
      assert.deepEqual(p.fixtureErrors, [], "No browser errors");
      assert.deepEqual(m.unexpected, [], "No unexpected API/provider requests");
      assert.equal(m.maxActive <= 1, true, "At most one active status request");
      for (const call of m.calls) { assert.equal(call.cache, "no-store"); assert.equal(call.credentials, "same-origin"); }
      results.push({ name, statusRequests: topups(m).length, creditRefreshEvents: m.events, abortedRequests: m.aborts });
      await p.close();
    };

    {
      const p = await fresh([{ body: order() }, { body: order("delivered") }], { orderId: ORDER_A.toUpperCase(), creditReplies: [100, 200, 100, 200].map(available => ({ body: balance(available) })) });
      await title(p, "Waiting for credit-pack confirmation");
      assert.equal((await metrics(p)).events, 0, "paid=true must never confirm a purchase");
      assert.equal(topups(await metrics(p))[0].url.endsWith(ORDER_A), true);
      await p.screenshot({ path: path.join(out, "pending-desktop.png") });
      await p.clock.runFor(3100); await title(p, "Your credits are ready");
      await p.getByLabel("200 credits available").waitFor();
      let m = await metrics(p); assert.equal(m.events, 1); assert.equal(m.calls.filter(c => c.url === "/api/credits").length, 2);
      await p.clock.runFor(65000); assert.equal(topups(await metrics(p)).length, 2);
      await p.evaluate(id => window.renderOrder(id), ORDER_B); await title(p, "Waiting for credit-pack confirmation");
      await p.evaluate(id => window.renderOrder(id), ORDER_A); await title(p, "Your credits are ready");
      assert.equal((await metrics(p)).events, 1, "Unchanged delivered A survives A -> B -> A without duplicate refresh");
      await p.evaluate(({ id, body }) => { window.setReplies(id, [{ body }]); window.renderOrder("abcdefab-1234-4234-8234-123456789def"); }, { id: ORDER_A, body: order("under_review") });
      await title(p, "Waiting for credit-pack confirmation");
      await p.evaluate(id => window.renderOrder(id), ORDER_A); await title(p, "Your credit pack needs a review");
      assert.equal((await metrics(p)).events, 2, "Observed hold refreshes the spendable balance");
      await p.getByLabel("100 credits available").waitFor();
      await p.getByRole("button", { name: "Check again" }).click(); await title(p, "Your credit pack needs a review");
      assert.equal((await metrics(p)).events, 2, "Unchanged hold never refreshes twice");
      await p.evaluate(({ id, body }) => window.setReplies(id, [{ body }]), { id: ORDER_A, body: order("delivered") });
      await p.getByRole("button", { name: "Check again" }).click(); await title(p, "Your credits are ready");
      assert.equal((await metrics(p)).events, 3, "Hold -> delivery is a new delivery transition");
      await p.getByLabel("200 credits available").waitFor();
      assert.equal((await metrics(p)).calls.filter(c => c.url === "/api/credits").length, 4, "Mounted balance reads initial, delivery, hold, release exactly once each");
      await p.screenshot({ path: path.join(out, "delivered-desktop.png") });
      await close(p, "pending delivery refresh + canonical UUID + dedupe + hold release");
    }
    {
      const p = await fresh(); await p.locator(".billing-topup-return-pending").waitFor();
      for (let attempt = 2; attempt <= 20; attempt++) {
        await p.clock.runFor(3000);
        await p.waitForFunction(count => window.calls.filter(c => c.url.startsWith("/api/billing/topups/")).length === count && window.activeTopups === 0, attempt);
        // Let the real Response.json promise settle before advancing the next timer.
        await p.evaluate(() => new Promise(resolve => queueMicrotask(resolve)));
      }
      await title(p, "Still waiting for confirmation");
      const count = topups(await metrics(p)).length; assert.equal(count, 20);
      await p.clock.runFor(120000); assert.equal(topups(await metrics(p)).length, count);
      await p.evaluate(({ id, body }) => window.setReplies(id, [{ body }]), { id: ORDER_A, body: order("delivered") });
      await p.getByRole("button", { name: "Check again" }).click(); await title(p, "Your credits are ready");
      assert.equal((await metrics(p)).events, 1);
      await close(p, "20-request bound + paused polling + manual retry");
    }
    {
      const p = await fresh([{ body: order(), delay: 5000 }]);
      for (let attempt = 1; attempt <= 7; attempt++) {
        await p.clock.runFor(5000); await p.waitForFunction(() => window.activeTopups === 0);
        await p.locator(".billing-topup-return-pending").waitFor();
        await p.evaluate(() => new Promise(resolve => queueMicrotask(resolve)));
        await p.clock.runFor(3000); await p.waitForFunction(() => window.activeTopups === 1);
      }
      await p.clock.runFor(4100); await title(p, "Still waiting for confirmation");
      let m = await metrics(p); assert.equal(topups(m).length < 20, true); assert.equal(m.active, 0); assert.equal(m.aborts, 1);
      const count = topups(m).length; await p.clock.runFor(30000); m = await metrics(p); assert.equal(topups(m).length, count);
      await close(p, "60-second elapsed bound aborts a slow in-flight request");
    }
    {
      const p = await fresh([{ body: order() }, { body: order("delivered") }], { creditReplies: [{ body: balance(100), bodyDelay: 6000 }, { body: balance(200) }] });
      await p.locator(".billing-topup-return-pending").waitFor();
      await p.clock.runFor(3100); await title(p, "Your credits are ready"); await p.getByLabel("200 credits available").waitFor();
      await p.clock.runFor(3100); await p.getByLabel("200 credits available").waitFor();
      assert.equal(await p.getByLabel("100 credits available").count(), 0, "Aborted older balance body must not overwrite delivery refresh");
      assert.equal((await metrics(p)).events, 1);
      await close(p, "delayed old balance body cannot overwrite newer delivery balance");
    }
    for (const lateBody of [false, true]) {
      const p = await fresh([{ body: order(lateBody ? "delivered" : "pending"), ...(lateBody ? { bodyDelay: 1000 } : {}) }]);
      if (lateBody) await p.waitForFunction(() => window.calls.some(c => c.url.startsWith("/api/billing/topups/")) && window.activeTopups === 0);
      else await p.locator(".billing-topup-return-pending").waitFor();
      // Simulate a suspended event loop: elapsed monotonic time advances before timers get to run.
      await p.evaluate(() => { const now = performance.now.bind(performance); Object.defineProperty(performance, "now", { configurable: true, value: () => now() + 61000 }); });
      await p.clock.runFor(lateBody ? 1100 : 3100); await title(p, "Still waiting for confirmation");
      assert.equal(topups(await metrics(p)).length, 1, "No new request beyond elapsed deadline");
      assert.equal((await metrics(p)).events, 0, "No late delivered body accepted beyond elapsed deadline");
      await close(p, lateBody ? "monotonic deadline rejects late terminal response body" : "monotonic deadline prevents late poll when timers are delayed");
    }
    for (const spec of [{ status: 503, body: { error: "private provider failure" } }, { reject: true }, { malformed: true }, { never: true }]) {
      const p = await fresh([spec]);
      if (spec.never) await p.clock.runFor(8100);
      await title(p, "We couldn’t check your credit pack");
      assert.equal((await p.locator("body").innerText()).includes("private provider failure"), false);
      if (spec.never) assert.equal((await metrics(p)).aborts, 1);
      await p.evaluate(({ id, body }) => window.setReplies(id, [{ body }]), { id: ORDER_A, body: order("delivered") });
      await p.getByRole("button", { name: "Check again" }).click(); await title(p, "Your credits are ready");
      assert.equal((await metrics(p)).events, 1);
      await close(p, `safe error/retry: ${spec.status || (spec.never ? "request timeout" : spec.reject ? "network rejection" : "malformed JSON")}`);
    }
    for (const status of [401, 404]) {
      const p = await fresh([{ status, body: { secret: "private lookup detail" } }]);
      await title(p, status === 401 ? "Sign in to check your credit pack" : "Credit-pack order unavailable");
      const href = await p.getByRole("link", { name: status === 401 ? "Sign in" : "Sign in to your account", exact: true }).getAttribute("href");
      assert.equal(new URL(href, base).searchParams.get("next"), `/billing?topup=${ORDER_A}`);
      assert.equal((await p.locator("body").innerText()).includes("private lookup detail"), false);
      await p.clock.runFor(65000); assert.equal(topups(await metrics(p)).length, 1);
      await p.evaluate(({ id, body }) => window.setReplies(id, [{ body }]), { id: ORDER_A, body: order("delivered") });
      await p.getByRole("button", { name: "Check again" }).click(); await title(p, "Your credits are ready");
      await close(p, `${status} fixed copy, preserved sign-in return, manual retry`);
    }
    for (const bad of [{ ...order("delivered"), orderId: ORDER_B }, { ...order("delivered"), credits: Number.MAX_SAFE_INTEGER + 1 }, { ...order("delivered"), credits: -100 }, { ...order("delivered"), currency: "eur" }, { ...order("delivered"), packId: "other" }, { ...order("delivered"), state: "paid" }, { ...order("delivered"), priceCents: 1.1 }, { ...order("delivered"), private: "raw database data" }]) {
      const p = await fresh([{ body: bad }]); await title(p, "We couldn’t check your credit pack");
      assert.equal((await metrics(p)).events, 0);
      assert.equal(await p.getByRole("heading", { name: "Your credits are ready" }).count(), 0);
      await close(p, `reject invalid/cross-order response: ${JSON.stringify(bad)}`);
    }
    {
      const p = await fresh([{ body: order("delivered") }], { orderId: "invalid?paid=true" });
      await title(p, "Credit-pack order unavailable"); assert.equal(topups(await metrics(p)).length, 0); assert.equal((await metrics(p)).events, 0);
      await close(p, "invalid receipt never requests status or confirms credits");
    }
    {
      const p = await fresh([{ never: true }]);
      await p.waitForFunction(() => window.activeTopups === 1);
      await p.evaluate(id => window.renderOrder(id), ORDER_B); await title(p, "Waiting for credit-pack confirmation");
      assert.equal((await metrics(p)).aborts, 1);
      await p.evaluate(({ id }) => { window.setReplies(id, [{ never: true }]); window.renderOrder(id); }, { id: ORDER_A });
      await p.waitForFunction(() => window.activeTopups === 1);
      await p.evaluate(() => window.mountBanner(false)); await p.waitForFunction(() => window.activeTopups === 0);
      assert.equal((await metrics(p)).aborts, 2);
      const count = topups(await metrics(p)).length; await p.clock.runFor(65000); assert.equal(topups(await metrics(p)).length, count);
      await close(p, "order-change/unmount abort + cleared poll timers");
    }
    for (const state of ["under_review", "refunded"]) {
      const p = await fresh([{ body: order(state) }], { viewport: { width: 375, height: 812 } });
      await title(p, state === "under_review" ? "Your credit pack needs a review" : "This credit pack was refunded");
      await p.clock.runFor(65000); assert.equal(topups(await metrics(p)).length, 1);
      const layout = await p.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, buttons: [...document.querySelectorAll('.billing-topup-return-actions a,.billing-topup-return-actions button')].map(e => { const r=e.getBoundingClientRect();return { left:r.left,right:r.right,height:r.height,transition:getComputedStyle(e).transitionDuration }; }) }));
      assert.equal(layout.scroll <= layout.width, true, "No mobile horizontal overflow");
      for (const button of layout.buttons) { assert.equal(button.left >= 0 && button.right <= layout.width, true); assert.equal(button.height >= 44, true); assert.equal(button.transition, "0s"); }
      await p.keyboard.press("Tab");
      assert.equal(await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), "solid");
      if (state === "refunded") assert.match(await p.getByRole("status").innerText(), /does not confirm which credits remain/);
      await p.screenshot({ path: path.join(out, `${state}-mobile.png`) });
      await close(p, `${state}: terminal status, mobile bounds, focus, reduced motion`);
    }
    fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ passed: results.length, results, localOnly: true, network: "Loopback fixture assets/local Inter font only; all status/balance responses synthetic", limitations: "Isolated component fixture with app billing CSS/base reset/local Inter. This exercises real React components, not the full billing page, provider payments, signed events or the deployed app." }, null, 2));
    console.log(`PASS ${results.length} actual React browser groups: delivery/balance refresh, retry/dedupe, attempt/deadline bounds, request timeout, strict receipt validation, auth/not-found, cleanup, mobile/focus/reduced motion. No provider, paid or cloud calls.`);
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
