/* eslint-disable @typescript-eslint/no-require-imports -- Mounted LiveBuilder in Chromium at phone width: a real mouse press and release on Send registers, because the composer no longer changes height when the field loses focus (pressing Send blurs the field). Real live-builder.css; every API is routed with fictional data; no network beyond 127.0.0.1, no AI calls.
 * Run: node scripts/check-composer-send-browser.cjs [--old-css] [screenshot-dir]
 * --old-css re-adds the previous focus-only height rule to show the lost click it caused (expected to report the click as lost). */
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs");
const { build } = require("esbuild"), { browserType, engineLabel, args: engineArgs } = require("./browser-engine.cjs"), { createServer } = require("node:http");

const oldCss = process.argv.includes("--old-css");
const shotsArg = engineArgs.find(arg => !arg.startsWith("--"));
const shots = shotsArg ? path.resolve(shotsArg) : null;
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
  // LiveBuilder's stylesheet is imported by its host (cloud-studio), so the fixture adds it.
  let styles = fs.readFileSync("src/app/globals.css", "utf8").replace(/@import[^;]+;/g, "") + fs.readFileSync("src/app/live-builder.css", "utf8") + css.join("\n");
  if (oldCss) styles = styles.replace(".lb-composer textarea:not(:placeholder-shown) { height:88px; }", () => ".lb-composer textarea:focus { height:88px; }");
  return { js: output.outputFiles[0].contents, html: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><div id="root" style="height:100dvh;display:flex;flex-direction:column"></div><script src="/fixture.js"></script>` };
}

async function main() {
  const { js, html } = await bundle();
  const server = createServer((req, res) => { const script = req.url === "/fixture.js"; res.setHeader("Content-Type", script ? "text/javascript" : "text/html"); res.end(script ? js : html); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await browserType.launch({ headless: true });
  let passed = 0;
  try {
    for (const width of [375, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 812 } }), page = await context.newPage(), builds = [], errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
      let operation = { id: ids.operation, revision: 1, kind: "build", effort: "light", authorizedCredits: 20, chargedCredits: 0, reservedCredits: 0, remainingCredits: 20, maximumAdditionalCredits: 20, status: "active", pendingKind: null, lastVersion: 1, canContinue: false, recoverable: false, expiresAt: "2030-01-01T00:00:00Z" };
      await page.route("**/api/credits", route => route.fulfill({ json: { available: 500, unlimited: false } }));
      await page.route("**/api/build/questions", route => route.fulfill({ json: { questions: [] } }));
      await page.route("**/api/build/operations**", route => route.fulfill({ json: { operation, result: null, recovery: null } }));
      await page.route("**/api/build", route => {
        builds.push(route.request().postDataJSON());
        operation = { ...operation, lastVersion: 2, chargedCredits: 1, remainingCredits: 19 };
        const events = [{ type: "operation", operation }, { type: "done", version: 2, summary: "Saved fixture", changed: false, finished: true, charged: 1, operation }];
        return route.fulfill({ headers: { "Content-Type": "text/event-stream" }, body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") });
      });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const box = page.getByRole("textbox", { name: "Message the builder" }), send = page.getByRole("button", { name: "Send", exact: true });
      await box.click();
      await page.keyboard.type("Make the opening headline warmer.");
      await page.waitForFunction(() => { const button = [...document.querySelectorAll("button")].find(item => item.getAttribute("aria-label") === "Send"); return button && !button.disabled; });
      assert.equal(await box.evaluate(field => document.activeElement === field), true, "the field has focus before Send is pressed");
      const before = await send.boundingBox(), heightBefore = (await box.boundingBox()).height;
      if (shots && !oldCss) await page.screenshot({ path: path.join(shots, `composer-send-${width}.png`) });
      // A real pointer press and release, as a mouse or trackpad does: the press blurs the field.
      await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
      await page.mouse.down();
      const during = await send.boundingBox(), heightDuring = (await box.boundingBox()).height;
      await page.mouse.up();
      await page.waitForTimeout(400);
      const moved = Math.abs(during.y - before.y) > 0.5 || Math.abs(during.x - before.x) > 0.5;
      if (oldCss) {
        console.log(`OLD CSS ${width}px: field ${heightBefore}px -> ${heightDuring}px on press; Send moved ${moved}; builds sent ${builds.length}`);
        await context.close(); continue;
      }
      assert.equal(heightDuring, heightBefore, `${width}px: the field keeps its height when Send is pressed`);
      assert.ok(!moved, `${width}px: Send stays put between press and release`);
      assert.equal(builds.length, 1, `${width}px: the mouse click on Send sent the message`);
      assert.ok(JSON.stringify(builds[0]).includes("Make the opening headline warmer."), "the typed message is what was sent");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}px: no horizontal page scroll`);
      assert.deepEqual(errors, [], "no page errors");
      passed++; console.log(`PASS ${width}px: a mouse press and release on Send registers; the composer does not resize on blur`);
      await context.close();
    }
  } finally { await browser.close(); server.close(); }
  if (!oldCss) console.log(`${passed} mounted composer Send checks passed (${engineLabel}, routed APIs, no network).`);
}
main().catch(error => { console.error(error); process.exit(1); });
