/* eslint-disable @typescript-eslint/no-require-imports -- Mounted LiveBuilder while AI building cannot start (provider spending paused, today's limit reached, temporarily unavailable): the reason is visible without opening "Request details", the composer and Send stay disabled, and nothing is sent or reserved. Real live-builder.css; every API is routed with fictional data; no network beyond 127.0.0.1, no AI calls.
 * Run: node scripts/check-builder-paused-browser.cjs [screenshot-dir] */
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs");
const { build } = require("esbuild"), { browserType, engineLabel, args: engineArgs } = require("./browser-engine.cjs"), { createServer } = require("node:http");

const shotsArg = engineArgs.find(arg => !arg.startsWith("--"));
const shots = shotsArg ? path.resolve(shotsArg) : null;
const ids = { account: "11111111-1111-4111-8111-111111111111", workspace: "22222222-2222-4222-8222-222222222222", artifact: "33333333-3333-4333-8333-333333333333" };
// The studio passes BUILDER_WAITING_COPY[state] as the reason (cloud-studio.tsx); the fixture uses the same source.
const fixture = `import React from "react"; import { createRoot } from "react-dom/client"; import LiveBuilder from "./src/components/live-builder";
import { BUILDER_WAITING_COPY } from "./src/lib/builder/availability";
const ids = ${JSON.stringify(ids)};
const state = new URLSearchParams(location.search).get("state");
createRoot(document.getElementById("root")).render(<LiveBuilder accountId={ids.account} workspaceId={ids.workspace} artifactId={ids.artifact} version={1} history={[]} baseFiles={{}} baseAssets={[]} defaultEffort="medium" autoStart={null} autoStartMode="create" kind="website" disabled disabledReason={BUILDER_WAITING_COPY[state]} onLive={() => {}} onSaved={() => {}} />);
window.__reason = BUILDER_WAITING_COPY[state];`;
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

async function main() {
  const { js, html } = await bundle();
  const server = createServer((req, res) => { const script = req.url === "/fixture.js"; res.setHeader("Content-Type", script ? "text/javascript" : "text/html"); res.end(script ? js : html); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await browserType.launch({ headless: true });
  let passed = 0;
  try {
    for (const state of ["paused", "limit", "unavailable"]) for (const width of [1440, 375]) {
      const context = await browser.newContext({ viewport: { width, height: width > 800 ? 900 : 812 } }), page = await context.newPage(), paid = [], errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
      await page.route("**/api/credits", route => route.fulfill({ json: { available: 300, unlimited: false } }));
      await page.route("**/api/build/operations**", route => route.fulfill({ status: 404, json: { error: { code: "OPERATION_NOT_FOUND", message: "None" } } }));
      await page.route(/\/api\/(build|build\/plan|build\/questions|chat)(\?|$)/, route => {
        if (route.request().method() !== "GET") paid.push(route.request().url());
        return route.fulfill({ status: 503, json: { error: { code: "AI_PAUSED", message: "AI generation is paused right now. Nothing was charged. Please try again later." } } });
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/?state=${state}`);
      const reason = await page.evaluate(() => window.__reason);
      assert.ok(reason && reason.length > 20, `${state}: the studio has a reason for this state`);
      const box = page.getByRole("textbox", { name: "Message the builder" });
      await box.waitFor();
      // The reason must be readable without opening the collapsed "Request details" disclosure or hovering.
      const details = page.locator(".lb-request-details");
      assert.equal(await details.evaluate(node => node.open), false, `${state}: request details start collapsed`);
      const status = page.getByRole("status").filter({ hasText: reason });
      assert.equal(await status.count(), 1, `${state} ${width}px: one status names the reason`);
      assert.ok(await status.isVisible(), `${state} ${width}px: the reason is visible without opening request details`);
      const shown = await status.evaluate(node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height, text: node.innerText }; });
      assert.ok(shown.height > 0 && shown.bottom <= (width > 800 ? 900 : 812) + 1, `${state} ${width}px: the reason is on screen`);
      assert.ok(shown.text.includes(reason), `${state} ${width}px: the full reason is rendered as text, not only a tooltip`);
      assert.ok(!/See request details/.test(shown.text), `${state} ${width}px: no pointer to hidden details instead of the reason`);
      assert.equal(await box.isDisabled(), true, `${state}: the message field is disabled`);
      assert.equal(await page.locator("button.lb-send").isDisabled(), true, `${state}: Send is disabled`);
      await box.dispatchEvent("keydown", { key: "Enter" }).catch(() => undefined);
      await page.waitForTimeout(300);
      assert.deepEqual(paid, [], `${state}: nothing was sent to a paid route`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${state} ${width}px: no horizontal page scroll`);
      assert.deepEqual(errors, [], "no page errors");
      if (shots) await page.screenshot({ path: path.join(shots, `builder-${state}-${width}.png`) });
      passed++; console.log(`PASS ${state} ${width}px: "${reason}" is visible; composer and Send disabled; nothing sent`);
      await context.close();
    }
  } finally { await browser.close(); server.close(); }
  console.log(`${passed} mounted unavailable-builder checks passed (${engineLabel}, routed APIs, no network).`);
}
main().catch(error => { console.error(error); process.exit(1); });
