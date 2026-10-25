/* eslint-disable @typescript-eslint/no-require-imports -- Mounted LiveBuilder (real live-builder.css, real hooks and cards) for the optional, free brief improvement (Codex E4):
 * a complete prompt builds directly with no enhance request; a short one offers "Improve my brief first · free" and sends nothing until chosen;
 * a lost reply shows "checking" and is recovered by re-reading the durable action (never re-run); a reload restores it the same way; Stop is durable;
 * Cancel after completion keeps its receipt; "Build with my original instead" implies no refund; the build receipt carries the improvement's charge.
 * Every API is routed with fictional data in the test process; no network beyond 127.0.0.1, no AI, no database.
 * Run: node scripts/check-enhance-flow-browser.cjs [--engine firefox|webkit] */
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs");
const { build } = require("esbuild"), { browserType, engineLabel, collectPageErrors } = require("./browser-engine.cjs"), { createServer } = require("node:http");

const ids = { account: "11111111-1111-4111-8111-111111111111", workspace: "22222222-2222-4222-8222-222222222222", artifact: "33333333-3333-4333-8333-333333333333", operation: "44444444-4444-4444-8444-444444444444" };
const fixture = `import React from "react"; import { createRoot } from "react-dom/client"; import LiveBuilder from "./src/components/live-builder";
const ids = ${JSON.stringify(ids)};
createRoot(document.getElementById("root")).render(<LiveBuilder accountId={ids.account} workspaceId={ids.workspace} artifactId={ids.artifact} version={1} history={[]} baseFiles={{}} baseAssets={[]} defaultEffort="light" autoStart={null} autoStartMode="create" kind="website" onLive={() => {}} onSaved={() => {}} />);`;
const mocks = {
  "use-plan-mode": `import { useMemo } from "react"; export function usePlanMode() { return useMemo(() => ({ active: null, restored: null, operation: null, checking: false, recoveryNotice: "", ready: true, hasPrevious: false, recoverablePlan: null, edit: () => {}, markBuilt: () => {}, refreshOperation: async () => null, recoverPlan: async () => null, run: async () => { throw new Error("No planning in this fixture"); } }), []); }`,
  "plan-card": `export default function PlanCard() { return null; }`,
  "design-capture": `export async function captureDesign() { throw new Error("No visual review in this fixture"); }`,
  "cloud-api": `export async function readCloudImage() { throw new Error("Unexpected image request"); }`,
  "next/link": `import React from "react"; export default function Link({ href, children, prefetch, ...rest }) { return <a href={typeof href === "string" ? href : "#"} {...rest}>{children}</a>; }`,
  "next/image": `import React from "react"; export default function Image({ src, alt, ...rest }) { return <img src={src} alt={alt} />; }`,
  "next/navigation": `export function useRouter() { return { push() {}, replace() {}, refresh() {}, prefetch() {} }; } export function usePathname() { return "/"; } export function useSearchParams() { return new URLSearchParams(); }`,
};
const mockFilter = /(?:^|[\\/])(use-plan-mode|plan-card|design-capture|cloud-api)$|^next\/(link|image|navigation)$/;
const IMPROVED = {
  business: "Ovenbird, a sourdough bakery in Leith.", workingName: null, goal: "Visits and pre-orders.", primaryAction: { label: "Pre-order bread", kind: "buy" }, audience: "Neighbours.",
  sections: [{ name: "Bakes", anchor: "bakes", purpose: "The bread.", include: [] }, { name: "Visit", anchor: "visit", purpose: "Find us.", include: [] }],
  tone: "loud", toneWhy: "Food.", imagery: { plan: "illustration", notes: "Drawn loaves.", textInImage: null }, factsGiven: [], factsMissing: [], constraints: [], answersUsed: [], conflicts: [],
};
const TEXT = "Business: Ovenbird, a sourdough bakery in Leith.\n1. Bakes (#bakes): The bread.\n2. Visit (#visit): Find us.";
const SHORT = "A website for my sourdough bakery in Leith";
const COMPLETE = `${"Ovenbird is a sourdough bakery on Leith Walk run by two bakers who started in a shared kitchen. ".repeat(9)}We want a calm one-page site with our bakes, opening hours, a pre-order form and a map.`;
const now = new Date().toISOString();
const action = (key, status, over = {}) => ({ key, status, mode: "enhance", outcome: status === "running" || status === "releasing" ? (status === "releasing" ? "completed" : null) : status,
  cancelRequested: false, billing: status === "running" || status === "releasing" ? "held" : status === "cancelled" ? "released" : "released", holdCredits: 1,
  chargedCredits: status === "running" || status === "releasing" ? null : 0, createdAt: now, updatedAt: now, resolvedAt: status === "running" || status === "releasing" ? null : now, failure: null,
  result: status === "completed" ? { mode: "enhance", text: TEXT, enhanced: IMPROVED } : null, ...over });
const completedBody = key => ({ action: action(key, "completed"), replayed: false, mode: "enhance", enhanced: IMPROVED, text: TEXT, charged: 0 });

async function bundle() {
  const css = [];
  const output = await build({ stdin: { contents: fixture, loader: "jsx", resolveDir: process.cwd() }, write: false, bundle: true, platform: "browser", jsx: "automatic", define: { "process.env": "{}" }, logLevel: "silent",
    plugins: [{ name: "fixture", setup(b) {
      b.onResolve({ filter: mockFilter }, args => ({ path: args.path.startsWith("next/") ? args.path : args.path.replace(/^.*[\\/]/, ""), namespace: "mock" }));
      b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path], loader: "jsx", resolveDir: process.cwd() }));
      b.onResolve({ filter: /^@\// }, args => {
        const base = path.resolve("src", args.path.slice(2));
        return { path: args.path.endsWith(".css") ? base : fs.existsSync(`${base}.tsx`) ? `${base}.tsx` : `${base}.ts` };
      });
      b.onLoad({ filter: /\.css$/ }, args => { css.push(fs.readFileSync(args.path, "utf8")); return { contents: "", loader: "js" }; });
    } }] });
  const styles = fs.readFileSync("src/app/globals.css", "utf8").replace(/@import[^;]+;/g, "") + fs.readFileSync("src/app/live-builder.css", "utf8") + css.join("\n");
  return { js: output.outputFiles[0].contents, html: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><div id="root" style="height:100dvh;display:flex;flex-direction:column"></div><script src="/fixture.js"></script>` };
}

/** One page with every API routed; `enhance(request)` answers /api/build/enhance (POST/GET/DELETE/PATCH). */
async function openBuilder(browser, origin, enhance) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } }), page = await context.newPage(), errors = [], log = { enhance: [], builds: [] };
  collectPageErrors(page, errors);
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
  const operation = { id: ids.operation, revision: 1, kind: "build", effort: "light", authorizedCredits: 20, chargedCredits: 0, reservedCredits: 0, remainingCredits: 20, maximumAdditionalCredits: 20, status: "active", pendingKind: null, lastVersion: 1, canContinue: false, recoverable: false, expiresAt: "2030-01-01T00:00:00Z" };
  await page.route("**/api/credits", route => route.fulfill({ json: { available: 500, unlimited: false } }));
  await page.route("**/api/build/questions", route => route.fulfill({ json: { questions: [] } }));
  await page.route("**/api/build/operations**", route => route.fulfill({ json: { operation, result: null, recovery: null } }));
  await page.route("**/api/build", route => {
    log.builds.push(route.request().postDataJSON());
    const done = { ...operation, lastVersion: 2, chargedCredits: 1, remainingCredits: 19 };
    const events = [{ type: "operation", operation: done }, { type: "done", version: 2, summary: "Saved fixture", changed: false, finished: true, charged: 1, operation: done }];
    return route.fulfill({ headers: { "Content-Type": "text/event-stream" }, body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") });
  });
  await page.route("**/api/build/enhance**", async route => {
    const request = route.request(), method = request.method();
    const key = method === "POST" ? request.headers()["idempotency-key"] : method === "GET" ? new URL(request.url()).searchParams.get("key") : request.postDataJSON()?.key;
    log.enhance.push({ method, key });
    try { await enhance({ route, method, key, log }); } catch { /* the page went away (reload) while this reply was pending */ }
  });
  await page.goto(origin);
  return { context, page, errors, log };
}
async function send(page, text) {
  const box = page.getByRole("textbox", { name: "Message the builder" });
  await box.fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}
/** A short first brief: the on-device design questions appear; Skip all reaches the brief choice. */
async function reachChoice(page) {
  await page.getByRole("button", { name: "Skip all" }).click();
  await page.getByRole("button", { name: "Improve my brief first · free" }).waitFor();
}
const receiptText = page => page.locator(".lb-receipt").last().innerText();

async function main() {
  const { js, html } = await bundle();
  const server = createServer((req, res) => { const script = req.url === "/fixture.js"; res.setHeader("Content-Type", script ? "text/javascript" : "text/html"); res.end(script ? js : html); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await browserType.launch({ headless: true });
  let passed = 0; const pass = name => { passed++; console.log(`PASS ${name}`); };
  try {
    { // A complete prompt builds directly: no reading, no improvement call, no card.
      const { context, page, errors, log } = await openBuilder(browser, origin, async ({ route }) => route.fulfill({ status: 500, json: { error: { code: "UNEXPECTED", message: "unexpected" } } }));
      await send(page, COMPLETE);
      await page.locator(".lb-receipt").waitFor();
      assert.equal(log.enhance.length, 0, "no /api/build/enhance request for a complete prompt");
      assert.equal(log.builds.length, 1); assert.equal(log.builds[0].brief, undefined, "the build carries the client's own words only");
      assert.equal(await page.locator(".eb").count(), 0, "no brief card");
      assert.match(await receiptText(page), /Brief\s*Your own words/); assert.doesNotMatch(await receiptText(page), /improving/i);
      assert.deepEqual(errors, []);
      pass("a complete prompt builds directly: no enhance request, no brief card, receipt says 'Your own words'");
      await context.close();
    }
    { // Explicit opt-in; the reply is lost; checking; recovered by re-reading (no second POST); the build receipt carries the charge.
      let completedKey = null;
      const { context, page, errors, log } = await openBuilder(browser, origin, async ({ route, method, key }) => {
        if (method === "POST") { completedKey = key; return route.abort("failed"); }
        if (method === "GET") { await new Promise(resolve => setTimeout(resolve, 700)); return route.fulfill({ json: key === completedKey ? completedBody(key) : { error: { code: "ENHANCE_NOT_FOUND" } }, status: key === completedKey ? 200 : 404 }); }
        return route.fulfill({ status: 500, json: { error: { code: "UNEXPECTED", message: "unexpected" } } });
      });
      await send(page, SHORT);
      await reachChoice(page);
      assert.equal(log.enhance.length, 0, "nothing is sent before the client chooses");
      assert.match(await page.locator(".eb").innerText(), /Improving your brief is free and starts nothing paid/);
      await page.getByRole("button", { name: "Improve my brief first · free" }).click();
      await page.getByText(/The reply was lost\. Checking what happened/).waitFor();
      assert.doesNotMatch(await page.locator(".eb").innerText(), /Nothing was charged/, "unknown is never reported as free");
      await page.getByRole("heading", { name: "Improved brief" }).waitFor();
      assert.match(await page.locator(".eb").innerText(), /Improving your brief charged 0 credits\./);
      assert.equal(log.enhance.filter(item => item.method === "POST").length, 1, "never re-run");
      assert.ok(log.enhance.some(item => item.method === "GET" && item.key === completedKey), "recovered by re-reading the same key");
      await page.getByRole("button", { name: "Start building", exact: true }).click();
      await page.locator(".lb-receipt").waitFor();
      assert.deepEqual(log.builds[0].brief, { mode: "enhanced", text: TEXT });
      assert.match(await receiptText(page), /Improved brief · improving your brief first: 0 credits charged/);
      assert.deepEqual(errors, []);
      pass("explicit opt-in; a lost reply shows 'checking' (never 'nothing was charged'), is recovered by key without a second POST, and the build receipt carries its 0-credit charge");
      await context.close();
    }
    { // Reload while the improvement runs: the card comes back from the durable action; Cancel then keeps its receipt.
      let firstKey = null, finished = false;
      const { context, page, errors, log } = await openBuilder(browser, origin, async ({ route, method, key }) => {
        if (method === "POST") { firstKey = key; await new Promise(resolve => setTimeout(resolve, 5000)); return route.fulfill({ status: 202, json: { action: action(key, "running"), replayed: false, error: { code: "ENHANCE_RUNNING", message: "running" } } }); }
        if (method === "GET") return route.fulfill({ json: finished ? completedBody(key) : { action: action(key, "running"), replayed: true, error: { code: "ENHANCE_RUNNING", message: "running" } }, status: finished ? 200 : 202 });
        return route.fulfill({ status: 500, json: { error: { code: "UNEXPECTED", message: "unexpected" } } });
      });
      await send(page, SHORT);
      await reachChoice(page);
      await page.getByRole("button", { name: "Improve my brief first · free" }).click();
      await page.getByText("Improving your brief… (free)").waitFor();
      finished = true;
      await page.reload();
      await page.getByRole("heading", { name: "Improved brief" }).waitFor({ timeout: 15_000 });
      assert.equal(log.enhance.filter(item => item.method === "POST").length, 1, "the reload never sent it again");
      assert.ok(log.enhance.some(item => item.method === "GET" && item.key === firstKey), "read back by its key");
      await page.getByRole("button", { name: "Cancel" }).click();
      await page.getByText(/Improved brief kept for reference · improving it charged 0 credits\. No build was started\./).waitFor();
      const text = await page.locator("body").innerText();
      assert.match(text, /No build was started/); assert.doesNotMatch(text, /Nothing was started/, "never 'Nothing was started' after a completed improvement");
      assert.equal(log.builds.length, 0); assert.ok(!log.enhance.some(item => item.method === "DELETE"), "a completed improvement needs no Stop");
      assert.equal(await page.getByRole("textbox", { name: "Message the builder" }).inputValue(), SHORT, "the brief is back in the composer");
      assert.deepEqual(errors, []);
      pass("reload during the improvement restores it from the durable action (no second POST); Cancel after completion keeps its receipt and never says 'Nothing was started'");
      await context.close();
    }
    { // Build with the original after a completed improvement: no refund implied; the receipt still shows the improvement's charge.
      const { context, page, errors, log } = await openBuilder(browser, origin, async ({ route, method, key }) =>
        method === "POST" ? route.fulfill({ json: completedBody(key) }) : route.fulfill({ status: 500, json: { error: { code: "UNEXPECTED", message: "unexpected" } } }));
      await send(page, SHORT);
      await reachChoice(page);
      await page.getByRole("button", { name: "Improve my brief first · free" }).click();
      await page.getByRole("heading", { name: "Improved brief" }).waitFor();
      await page.getByRole("button", { name: /^Build with my original instead · up to \d+ credits$/ }).click();
      await page.locator(".lb-receipt").waitFor();
      assert.equal(log.builds[0].brief, undefined, "the original words only");
      assert.match(await receiptText(page), /Your own words · improving your brief first: 0 credits charged/);
      assert.doesNotMatch(await page.locator("body").innerText(), /refund/i);
      assert.deepEqual(errors, []);
      pass("'Build with my original instead' builds the client's words, implies no refund, and the receipt keeps the improvement's 0-credit charge");
      await context.close();
    }
    { // Stop during the improvement is durable and its outcome comes from the server.
      let stopped = false;
      const { context, page, errors, log } = await openBuilder(browser, origin, async ({ route, method, key }) => {
        if (method === "POST") { await new Promise(resolve => setTimeout(resolve, 3000)); return route.fulfill({ status: 409, json: { action: action(key, "cancelled", { outcome: "cancelled" }), replayed: false, error: { code: "ENHANCE_CANCELLED", message: "stopped" } } }); }
        if (method === "DELETE") { stopped = true; return route.fulfill({ status: 409, json: { action: action(key, "cancelled", { outcome: "cancelled" }), replayed: true, error: { code: "ENHANCE_CANCELLED", message: "stopped" } } }); }
        return route.fulfill({ json: stopped ? { action: action(key, "cancelled", { outcome: "cancelled" }) } : { action: action(key, "running") }, status: stopped ? 409 : 202 });
      });
      await send(page, SHORT);
      await reachChoice(page);
      await page.getByRole("button", { name: "Improve my brief first · free" }).click();
      await page.getByText("Improving your brief… (free)").waitFor();
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      await page.getByText(/Stopped before your brief was improved\. Nothing was charged\./).waitFor();
      assert.equal(log.enhance.filter(item => item.method === "DELETE").length, 1, "one durable Stop");
      assert.equal(log.builds.length, 0);
      assert.deepEqual(errors, []);
      pass("Stop during the improvement sends one durable Stop and reports the server's verified zero charge");
      await context.close();
    }
  } finally { await browser.close(); server.close(); }
  console.log(`${passed} mounted brief-improvement flow checks passed (${engineLabel}, routed APIs, no network).`);
}
main().catch(error => { console.error(error); process.exit(1); });
