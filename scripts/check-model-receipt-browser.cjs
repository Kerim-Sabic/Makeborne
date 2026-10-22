/* eslint-disable @typescript-eslint/no-require-imports -- Mounted LiveBuilder (real live-builder.css, hooks and receipt) for model routing:
 * the receipt names the task class of each step from the server's route events (never a model or provider); an escalated step reads as the routed
 * attempt "retried once", charged for the retry only; files only the failed attempt touched are not listed as
 * changes, and the files the server put back reach the live preview. Every API is routed with fictional data in the test process;
 * no network beyond 127.0.0.1, no AI, no database.
 * Run: node scripts/check-model-receipt-browser.cjs [--engine firefox|webkit] */
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs");
const { build } = require("esbuild"), { browserType, engineLabel, collectPageErrors } = require("./browser-engine.cjs"), { createServer } = require("node:http");

const ids = { account: "11111111-1111-4111-8111-111111111111", workspace: "22222222-2222-4222-8222-222222222222", artifact: "33333333-3333-4333-8333-333333333333", operation: "44444444-4444-4444-8444-444444444444" };
const fixture = `import React, { useState } from "react"; import { createRoot } from "react-dom/client"; import LiveBuilder from "./src/components/live-builder";
const ids = ${JSON.stringify(ids)};
function App() { const [files, setFiles] = useState({}); return <><LiveBuilder accountId={ids.account} workspaceId={ids.workspace} artifactId={ids.artifact} version={1} history={[]} baseFiles={{}} baseAssets={[]} defaultEffort="light" autoStart={null} autoStartMode="create" kind="website" onLive={live => setFiles(live.files)} onSaved={() => {}} /><pre data-testid="live-files">{Object.keys(files).sort().join(",")}</pre></>; }
createRoot(document.getElementById("root")).render(<App />);`;
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
const COMPLETE = `${"Ovenbird is a sourdough bakery on Leith Walk run by two bakers who started in a shared kitchen. ".repeat(9)}We want a calm one-page site with our bakes, opening hours, a pre-order form and a map.`;
const route = role => ({ type: "route", stage: "build", class: "new-site", label: "new website", role, escalated: role === "escalation" });

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

async function openBuilder(browser, origin, events) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } }), page = await context.newPage(), errors = [];
  collectPageErrors(page, errors);
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, routed => routed.abort());
  const operation = { id: ids.operation, revision: 1, kind: "build", effort: "light", authorizedCredits: 20, chargedCredits: 0, reservedCredits: 0, remainingCredits: 20, maximumAdditionalCredits: 20, status: "active", pendingKind: null, lastVersion: 1, canContinue: false, recoverable: false, expiresAt: "2030-01-01T00:00:00Z" };
  await page.route("**/api/credits", routed => routed.fulfill({ json: { available: 500, unlimited: false } }));
  await page.route("**/api/build/questions", routed => routed.fulfill({ json: { questions: [] } }));
  await page.route("**/api/build/operations**", routed => routed.fulfill({ json: { operation, result: null, recovery: null } }));
  await page.route("**/api/build/enhance**", routed => routed.fulfill({ status: 500, json: { error: { code: "UNEXPECTED", message: "unexpected" } } }));
  await page.route("**/api/build", routed => {
    const done = { ...operation, lastVersion: 2, chargedCredits: 6, remainingCredits: 14 };
    const body = [{ type: "operation", operation: done }, ...events, { type: "done", version: 2, summary: "Saved fixture", changed: true, finished: true, build: "passed", charged: 6, operation: done }];
    return routed.fulfill({ headers: { "Content-Type": "text/event-stream" }, body: body.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") });
  });
  await page.goto(origin);
  return { context, page, errors };
}
async function send(page, text) {
  await page.getByRole("textbox", { name: "Message the builder" }).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
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
    { // One step on the builder model (routing off): the receipt names the model and the task class.
      const { context, page, errors } = await openBuilder(browser, origin, [route("initial"), { type: "file", path: "src/App.tsx", op: "write", content: "export default function App(){return <main/>}" }]);
      await send(page, COMPLETE);
      await page.locator(".lb-receipt").waitFor();
      const text = await receiptText(page);
      assert.match(text, /Task\s*New website/); assert.doesNotMatch(text, /retried|claude|opus|sonnet/i);
      assert.deepEqual(errors, []);
      pass("one step: the receipt shows 'Task: New website' and no model or provider name");
      await context.close();
    }
    { // A routed attempt that failed and was retried: one line, charged for the retry only; its stray file is neither a change nor in the preview.
      const { context, page, errors } = await openBuilder(browser, origin, [
        route("initial"),
        { type: "file", path: "src/Extra.tsx", op: "write", content: "export const Extra = 1;" }, { type: "file", path: "src/App.tsx", op: "write", content: "broken" },
        { type: "status", message: "Retrying this step…" },
        { type: "delete", path: "src/Extra.tsx" }, { type: "delete", path: "src/App.tsx" },
        route("escalation"),
        { type: "file", path: "src/App.tsx", op: "write", content: "export default function App(){return <main/>}" },
      ]);
      await send(page, COMPLETE);
      await page.locator(".lb-receipt").waitFor();
      const text = await receiptText(page);
      assert.match(text, /Task\s*New website, retried once \(charged for the retry only\)/); assert.doesNotMatch(await page.locator("body").innerText(), /claude|opus|sonnet|anthropic/i, "no model or provider name anywhere in the UI");
      assert.match(text, /Charged\s*6 credits/);
      assert.match(text, /Files changed\s*1 file/, "only the retry's change is listed");
      assert.equal(await page.getByTestId("live-files").innerText(), "src/App.tsx", "the preview dropped the failed attempt's file");
      assert.deepEqual(errors, []);
      pass("an escalated step reads 'New website, retried once (charged for the retry only)'; the failed attempt's files are gone from the receipt and the preview; no model names");
      await context.close();
    }
  } finally { await browser.close(); server.close(); }
  console.log(`${passed} mounted model-receipt checks passed (${engineLabel}, routed APIs, no network).`);
}
main().catch(error => { console.error(error); process.exit(1); });
