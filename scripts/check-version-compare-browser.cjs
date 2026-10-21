/* eslint-disable @typescript-eslint/no-require-imports -- Mounted website editor (CloudEditor) History in Chromium (audit M11): readable summary next to the unchanged exact diff, bounded with "N more changes not shown", navigation from a change to its file and line in that version and into Code, saved previews for pages, and personal checkpoints that never write to the server, change a version or imply approval. Routed API, fictional bakery, nothing saved or published.
 * Run: node scripts/check-version-compare-browser.cjs [--baseline=<git rev>]  (SHOTS_DIR=<dir> saves 1440/375/320 screenshots)
 * --baseline bundles every src/ file from that revision instead (files new since then come from the working copy), to show what the earlier code lacks. */
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs"), { execFileSync } = require("node:child_process");
const { build } = require("esbuild"), { browserType, engineLabel } = require("./browser-engine.cjs"), { createServer } = require("node:http");

const baseline = process.argv.find(arg => arg.startsWith("--baseline="))?.slice("--baseline=".length) ?? null;
const shots = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : null;
const ids = { account: "11111111-1111-4111-8111-111111111111", workspace: "22222222-2222-4222-8222-222222222222", project: "33333333-3333-4333-8333-333333333333",
  artifact: "44444444-4444-4444-8444-444444444444", user: "66666666-6666-4666-8666-666666666666" };
const toolchain = file => fs.readFileSync(path.resolve("infra/project-runtime/toolchain", file), "utf8");
const APP_1 = `import "./app.css";
export default function App() {
  return <main className="mx-auto max-w-3xl">
    <header><a href="/">Ovenbird</a></header>
    <h1>Fresh bread every morning</h1>
    <p>Wood-fired loaves from Leith.</p>
    <img src="/hero.webp" alt="Loaves cooling on a rack" />
    <p>Find us on Constitution Street.</p>
  </main>;
}`;
const APP_2 = APP_1.replace("Fresh bread every morning", "Fresh sourdough every morning");
const APP_3 = APP_2.replace('    <img src="/hero.webp" alt="Loaves cooling on a rack" />\n', '    <img src="/hero.webp" />\n').replace("    <p>Find us on Constitution Street.</p>", "    <p>Find us on Constitution Street.</p>\n    <p>Open daily from 8am.</p>");
const MENU = `export const items = [\n${Array.from({ length: 45 }, (_, i) => `  { title: "Loaf number ${i + 1}" },`).join("\n")}\n];`;
const source = (app, css, routes, extra = {}) => ({ schemaVersion: 1, toolchainId: "react-vite-v1", entrypoint: "src/main.tsx", assets: [], routes,
  files: Object.entries({ "index.html": '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Ovenbird</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
    "package-lock.json": toolchain("package-lock.json"), "package.json": toolchain("package.json"), "src/App.tsx": app, "src/app.css": css,
    "src/main.tsx": 'import { createRoot } from "react-dom/client";\nimport App from "./App";\ncreateRoot(document.getElementById("root")!).render(<App />);', ...extra }).sort(([a], [b]) => a < b ? -1 : 1).map(([p, content]) => ({ path: p, content })) });
const home = [{ path: "/", title: "Home" }];
const sources = many => [source(APP_1, "h1{color:#111}", home), source(APP_2, "h1{color:#111}", home), source(APP_3, "h1{color:#7a3b12}", [...home, { path: "/menu", title: "Menu" }], many ? { "src/menu.ts": MENU } : {})];
const summaries = ["First saved website", "Changed the hero heading", "Opening hours, menu page and warmer heading colour"];
const style = { id: "automatic", name: "Automatic", version: 1, typography: { headingFont: "Inter", bodyFont: "Inter" }, colors: { canvas: "#FFFFFF", ink: "#000000", accent: "#3559D8" }, description: "Fixture direction", referenceAssetIds: [] };
const versionOf = (number, many) => ({ id: `88888888-8888-4888-8888-88888888888${number}`, artifactId: ids.artifact, number, parentVersionId: number > 1 ? `88888888-8888-4888-8888-88888888888${number - 1}` : null,
  content: { schemaVersion: 1, kind: "website", title: "Ovenbird Bakehouse", sections: [], websiteSource: sources(many)[number - 1] }, style, assetIds: [], createdAt: `2026-10-2${number}T09:00:00.000Z`, createdBy: ids.user, changeSummary: summaries[number - 1] });
const artifact = current => ({ id: ids.artifact, projectId: ids.project, kind: "website", title: "Ovenbird Bakehouse", currentVersion: current, createdAt: "2026-10-20T09:00:00.000Z", updatedAt: "2026-10-23T09:00:00.000Z" });

const fixture = `import React from "react";import{createRoot}from"react-dom/client";import{CloudEditor}from"./src/components/cloud-studio";import{setCloudAccount}from"./src/components/cloud-api";
const ids=${JSON.stringify(ids)};setCloudAccount(ids.account);
window.mountEditor=()=>createRoot(document.getElementById("root")).render(<CloudEditor accountId={ids.account} workspaceId={ids.workspace} artifact={${JSON.stringify(artifact(0))}} project={{brief:"",effort:"medium",clientId:null}} role="owner" back={()=>{}} notify={()=>{}}/>);`;
const NULL = "export default function Stub(){return null}";
const mocks = {
  "live-builder": NULL, "live-preview": NULL, "build-conversation": NULL, "document-preview": NULL, "website-generation": NULL, "saved-website-preview": NULL, "pending-cloud-writes": NULL,
  "cloud-client-outreach": NULL, "account-export": NULL, "client-review-panel": NULL, "website-github": NULL, "website-source-download": NULL, "website-analytics": NULL,
  "website-portal-settings": NULL, "account-preview": "export default function Preview({content}){return <p className=\"preview-stub\">Saved preview of {content.title}</p>}", "account-artwork-upload": NULL, "workbench-more": "export default function More({children}){return children}", "account-style-editor": NULL, "website-enquiries": NULL,
  "publish-snapshot": "export async function captureProjectSnapshot(){return ''}export async function captureProjectPublication(){throw new Error('not used')}",
  "supabase-client": "export function createClient(){return{auth:{getUser:async()=>({data:{user:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}}",
  // The real code editor, loaded lazily as next/dynamic would.
  "next/dynamic": "import React from 'react';export default function dynamic(loader){const Lazy=React.lazy(()=>loader().then(module=>({default:module.default??module})));return function Dynamic(props){return <React.Suspense fallback={null}><Lazy {...props}/></React.Suspense>}}",
  "next/link": "import React from'react';export default function Link({href,children,prefetch,...rest}){return <a href={typeof href==='string'?href:'#'} {...rest}>{children}</a>}",
  "next/navigation": "export function useRouter(){return{push(){},replace(){},refresh(){},prefetch(){}}}export function usePathname(){return'/'}export function useSearchParams(){return new URLSearchParams()}",
};
const mockFilter = /(?:^|[\\/])(live-builder|live-preview|build-conversation|document-preview|website-generation|saved-website-preview|pending-cloud-writes|cloud-client-outreach|account-export|client-review-panel|website-github|website-source-download|website-analytics|website-portal-settings|account-preview|account-artwork-upload|workbench-more|account-style-editor|website-enquiries|publish-snapshot)$|^@\/lib\/supabase\/client$|^next\/(dynamic|link|navigation)$/;
const srcRoot = path.resolve("src");
function sourceText(file) {
  if (baseline && file.startsWith(srcRoot + path.sep)) {
    try { return execFileSync("git", ["show", `${baseline}:${path.relative(process.cwd(), file).split(path.sep).join("/")}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }); }
    catch { /* Not present at the baseline: use the working copy. */ }
  }
  return fs.readFileSync(file, "utf8");
}
async function bundle() {
  const css = [];
  const output = await build({ stdin: { contents: fixture, loader: "jsx", resolveDir: process.cwd() }, write: false, bundle: true, platform: "browser", jsx: "automatic", define: { "process.env": "{}" }, logLevel: "silent",
    plugins: [{ name: "fixture", setup(b) {
      b.onResolve({ filter: mockFilter }, args => ({ path: args.path === "@/lib/supabase/client" ? "supabase-client" : args.path.startsWith("next/") ? args.path : args.path.replace(/^.*[\\/]/, ""), namespace: "mock" }));
      b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path], loader: "jsx", resolveDir: process.cwd() }));
      b.onResolve({ filter: /^@\// }, args => {
        const base = path.resolve("src", args.path.slice(2));
        return { path: args.path.endsWith(".css") || args.path.endsWith(".json") ? base : fs.existsSync(base + ".tsx") ? base + ".tsx" : fs.existsSync(base + ".ts") ? base + ".ts" : base };
      });
      b.onLoad({ filter: /\.css$/ }, args => { css.push(sourceText(args.path)); return { contents: "", loader: "js" }; });
      b.onLoad({ filter: /[\\/]src[\\/].*\.tsx?$/ }, args => ({ contents: sourceText(args.path), loader: args.path.endsWith(".tsx") ? "tsx" : "ts", resolveDir: path.dirname(args.path) }));
    } }] });
  const globals = sourceText(path.resolve("src/app/globals.css")).replace(/@import[^;]+;/g, "");
  return { js: output.outputFiles[0].contents, html: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${globals}${css.join("\n")}</style><div id="root"></div><script src="/fixture.js"></script>` };
}

async function main() {
  const { js, html } = await bundle();
  const server = createServer((req, res) => { const script = req.url === "/fixture.js"; res.setHeader("Content-Type", script ? "text/javascript" : "text/html"); res.end(script ? js : html); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await browserType.launch({ headless: true });
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const failures = [];
  const tag = baseline ? `baseline-${baseline}` : "current";

  /** One independent scenario: fresh page, routed APIs, the editor mounted at History. */
  async function scenario(name, setup, run, viewport = { width: 1440, height: 1000 }) {
    const context = await browser.newContext({ viewport }), page = await context.newPage(), errors = [], writes = [];
    page.setDefaultTimeout(baseline ? 5000 : 15000);
    page.on("pageerror", error => errors.push(error.message));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
    const state = { saved: 3, many: false, ...setup };
    const base = `/api/cloud/workspaces/${ids.workspace}/artifacts/${ids.artifact}`;
    await page.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      if (method !== "GET") writes.push(`${method} ${url.pathname}`);
      if (url.pathname === base && method === "GET") return route.fulfill({ json: { artifact: artifact(state.saved), versions: Array.from({ length: state.saved }, (_, index) => versionOf(index + 1, state.many)), pagination: { offset: 0, total: state.saved, nextOffset: null } } });
      return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Not in this fixture." } } });
    });
    try {
      await page.goto(origin); await page.waitForFunction(() => window.mountEditor);
      await openHistory(page);
      await run(page, state, writes);
      assert.deepEqual(errors, [], "no page errors");
      assert.deepEqual(writes, [], "comparing, navigating and checkpoints send no writes: no save, restore, approval or publish");
      console.log(`PASS ${name}`);
    } catch (error) {
      const message = String(error.message).split("\n"), waiting = message.find(line => /waiting for/.test(line))?.replace(/\x1b\[\d+m/g, "").trim();
      failures.push(name); console.log(`FAIL ${name}: ${message.slice(0, 6).join(" | ")}${waiting ? ` (${waiting})` : ""}`);
    } finally { await context.close(); }
  }
  async function openHistory(page) {
    await page.evaluate(() => window.mountEditor());
    await page.getByRole("heading", { name: "Ovenbird Bakehouse", level: 1 }).waitFor();
    await page.getByRole("button", { name: "History", exact: true }).click();
    await page.getByRole("heading", { name: "Version history" }).waitFor();
  }
  const compare = page => page.getByRole("region", { name: "Compare versions" });
  async function openCompare(page) { await page.getByRole("button", { name: "Compare versions" }).click(); await compare(page).waitFor(); }
  const unit = (page, label) => compare(page).locator(".vc-unit").filter({ has: page.locator(".vc-unit-label", { hasText: label }) }).first();
  const entries = locator => locator.locator(".vc-entry").evaluateAll(nodes => nodes.map(node => node.querySelector(".vc-words").getAttribute("aria-label")));
  async function capture(page, label, locator) {
    if (!shots) return;
    for (const width of [1440, 375, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 820 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await (locator ? page.locator(locator).first() : page).screenshot({ path: path.join(shots, `${tag}-compare-${label}-${width}.png`) });
      if (!baseline) assert.ok(overflow <= 1, `${label} at ${width}px: no horizontal page scroll (${overflow}px)`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  }

  try {
    await scenario("readable summary sits beside the unchanged exact diff: wording, styling and pages, each in words", {}, async page => {
      await openCompare(page);
      assert.equal(await compare(page).getByRole("button", { name: "Readable summary" }).getAttribute("aria-pressed"), "true");
      assert.match(await compare(page).locator(".vc-summary").innerText(), /^3 changes · \+4 −2 lines · \d+ unchanged$/);
      assert.deepEqual(await entries(unit(page, "src/App.tsx")), ["Removed “Loaves cooling on a rack”", "Added “Open daily from 8am.”"]);
      assert.match(await unit(page, "src/app.css").locator(".vc-only").innerText(), /^Styling changed: 1 line added, 1 removed\.$/);
      assert.deepEqual(await entries(unit(page, "Pages")), ["Added “/menu · Menu”"]);
      await compare(page).locator("#vc-from").selectOption("1");
      await page.waitForFunction(() => document.querySelector(".vc-words ins")?.textContent === "sourdough");
      assert.equal(await unit(page, "src/App.tsx").locator(".vc-words").first().getAttribute("aria-label"), "Changed from “Fresh bread every morning” to “Fresh sourdough every morning”");
      assert.deepEqual([await unit(page, "src/App.tsx").locator(".vc-words del").first().innerText(), await unit(page, "src/App.tsx").locator(".vc-words ins").first().innerText()], ["bread", "sourdough"]);
      await capture(page, "readable", ".vc");
      // The exact diff is still there, line for line.
      await compare(page).getByRole("button", { name: "Exact changes" }).click();
      const diff = compare(page).getByRole("table", { name: "Changes in src/App.tsx" });
      await diff.waitFor();
      const lines = await diff.locator(".vc-line.is-add code, .vc-line.is-remove code").allInnerTexts();
      assert.deepEqual(lines, ["    <h1>Fresh bread every morning</h1>", "    <h1>Fresh sourdough every morning</h1>", "    <img src=\"/hero.webp\" alt=\"Loaves cooling on a rack\" />", "    <img src=\"/hero.webp\" />", "    <p>Open daily from 8am.</p>"]);
      assert.equal(await compare(page).locator(".vc-unit").count(), 0);
      await capture(page, "exact", ".vc");
    });

    await scenario("a change opens where it lives: that line of that file in that version, then in Code for the current version; pages open the saved preview", {}, async page => {
      await openCompare(page);
      const app = unit(page, "src/App.tsx");
      await app.getByRole("button", { name: "Show line 7 of src/App.tsx in Version 2" }).click();
      const view = compare(page).getByRole("region", { name: "src/App.tsx in Version 2, line 7" });
      await view.waitFor();
      assert.match(await view.locator(".vc-view-line.is-target").innerText(), /alt="Loaves cooling on a rack"/);
      assert.match(await view.innerText(), /Saved snapshot\. Code shows the current version\./);
      assert.equal(await view.getByRole("button", { name: /Open in Code/ }).count(), 0, "an older version is not opened in the editor of the current one");
      assert.equal(await view.locator(".vc-view-line").count(), APP_2.split("\n").length, "a short file is shown whole around the change");
      await app.getByRole("button", { name: "Show line 9 of src/App.tsx in Version 3" }).click();
      const current = compare(page).getByRole("region", { name: "src/App.tsx in Version 3, line 9" });
      assert.match(await current.locator(".vc-view-line.is-target").innerText(), /Open daily from 8am\./);
      await capture(page, "file-view", ".vc");
      await unit(page, "Pages").getByRole("button", { name: "Preview Version 3" }).click();
      await page.getByRole("region", { name: "Saved version 3" }).waitFor();
      await current.getByRole("button", { name: "Open in Code at line 9" }).click();
      await page.waitForFunction(() => document.querySelector(".source-editor-line")?.textContent === "Line 9");
      assert.equal(await page.locator(".source-editor-file-heading code").innerText(), "src/App.tsx");
      assert.match(await page.locator(".cm-search-target").innerText(), /Open daily from 8am\./);
      // Opening Code again later starts from the usual file, not the old jump.
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      await page.getByRole("button", { name: "Code", exact: true }).click();
      await page.locator(".source-editor-file-heading code").waitFor();
      assert.equal(await page.locator(".source-editor-file-heading code").innerText(), "src/main.tsx");
    });

    await scenario("bounded: the first 30 changes are listed and the rest are counted, with Show more", { many: true }, async page => {
      await openCompare(page);
      const more = compare(page).locator(".vc-more-row");
      assert.equal(await more.locator("p").innerText(), "19 more changes not shown.");
      assert.equal(await compare(page).locator(".vc-entry").count() + await compare(page).locator(".vc-only").count(), 30);
      await unit(page, "src/menu.ts").getByRole("button", { name: "Show line 20 of src/menu.ts in Version 3" }).click();
      const view = compare(page).getByRole("region", { name: "src/menu.ts in Version 3, line 20" });
      assert.deepEqual(await view.locator(".vc-view-line .vc-num").allInnerTexts(), Array.from({ length: 13 }, (_, i) => String(14 + i)), "six lines either side of the change");
      await view.getByRole("button", { name: "Show whole file (47 lines)" }).click();
      assert.equal(await view.locator(".vc-view-line").count(), 47);
      assert.match(await view.locator(".vc-view-line.is-target").innerText(), /Loaf number 19/);
      await more.getByRole("button", { name: "Show 19 more" }).click();
      await page.waitForFunction(() => !document.querySelector(".vc-more-row"));
      assert.equal(await compare(page).locator(".vc-entry").count() + await compare(page).locator(".vc-only").count(), 49);
    });

    await scenario("checkpoints: keyboard to mark, Escape to cancel, persisted for this account on reload, shown in compare, filtered, renamed and removed; never a write", {}, async (page, state, writes) => {
      const row = () => page.locator(".cloud-version").filter({ hasText: "Version 2" }).first();
      const mark = row().getByRole("button", { name: "Mark version 2 as a checkpoint" });
      await mark.focus(); await page.keyboard.press("Enter");
      const nameField = row().getByRole("textbox", { name: "Checkpoint name" });
      assert.equal(await nameField.evaluate(node => node === document.activeElement), true, "the name field takes focus");
      await page.keyboard.press("Escape");
      assert.equal(await row().getByRole("form").count(), 0);
      assert.equal(await mark.evaluate(node => node === document.activeElement), true, "focus returns to the button");
      await page.keyboard.press("Enter");
      await page.keyboard.type("Client’s favourite — Добро 🍞");
      await page.keyboard.press("Tab"); await page.keyboard.type("Before the menu page was added.");
      await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
      await row().locator(".cloud-checkpoint-badge").waitFor();
      assert.equal(await row().locator(".cloud-checkpoint-badge").innerText(), "Checkpoint: Client’s favourite — Добро 🍞");
      assert.equal(await row().locator(".cloud-checkpoint-note").innerText(), "Before the menu page was added.");
      assert.equal(await row().getByRole("status").innerText(), "Version 2 marked as a checkpoint. The version itself is unchanged.");
      const v3 = page.locator(".cloud-version").filter({ hasText: "Version 3" }).first();
      assert.deepEqual(await v3.locator("strong span").allInnerTexts(), ["Current"], "a checkpoint doesn't move Current or mark anything approved, checked or live");
      assert.deepEqual(await row().locator("strong span").allInnerTexts(), []);
      await capture(page, "checkpoint", ".cloud-workbench-history");
      // Kept in this browser for this account: survives a reload.
      await page.reload(); await page.waitForFunction(() => window.mountEditor); await openHistory(page);
      await row().locator(".cloud-checkpoint-badge").waitFor();
      const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), `makeborne.version-checkpoints.v1.${ids.account}.${ids.workspace}.${ids.artifact}`);
      assert.deepEqual(stored.checkpoints.map(item => [item.versionId, item.versionNumber, item.name]), [[versionOf(2).id, 2, "Client’s favourite — Добро 🍞"]]);
      await openCompare(page);
      assert.deepEqual(await compare(page).locator("#vc-from option").allInnerTexts(), ["Version 3", "Version 2 · Client’s favourite — Добро 🍞", "Version 1"]);
      await compare(page).getByRole("button", { name: "Close comparison" }).click();
      await page.getByRole("button", { name: "Checkpoints only (1)" }).click();
      assert.deepEqual(await page.locator(".cloud-version > strong").allInnerTexts(), ["Version 2"]);
      assert.equal(await page.locator(".cloud-history-filter [role=status]").innerText(), "Showing checkpoints among the 3 loaded versions.");
      await row().getByRole("button", { name: "Rename checkpoint" }).click();
      await row().getByRole("textbox", { name: "Checkpoint name" }).fill("Baseline");
      await row().getByRole("button", { name: "Save name" }).click();
      assert.equal(await row().locator(".cloud-checkpoint-badge").innerText(), "Checkpoint: Baseline");
      assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).checkpoints.length, `makeborne.version-checkpoints.v1.${ids.account}.${ids.workspace}.${ids.artifact}`), 1, "renaming doesn't duplicate");
      await row().getByRole("button", { name: "Remove checkpoint" }).click();
      assert.equal(await row().getByRole("status").innerText(), "Checkpoint removed. The version is still in History.");
      assert.deepEqual(await page.locator(".cloud-version > strong").allInnerTexts(), ["Version 3Current", "Version 2", "Version 1"], "the filter goes away with the last checkpoint; every version remains");
      assert.deepEqual(writes, []);
    });

    await scenario("a checkpoint whose version is no longer in History is said so, never moved to another version", {}, async page => {
      await page.evaluate(([key, value]) => localStorage.setItem(key, value), [`makeborne.version-checkpoints.v1.${ids.account}.${ids.workspace}.${ids.artifact}`, JSON.stringify({ v: 1, checkpoints: [{ versionId: "99999999-9999-4999-8999-999999999999", versionNumber: 2, name: "From an older copy", note: "", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" }] })]);
      await page.reload(); await page.waitForFunction(() => window.mountEditor); await openHistory(page);
      await page.getByRole("button", { name: "Checkpoints only (1)" }).click();
      assert.equal(await page.locator(".cloud-checkpoint-orphans li").innerText(), "“From an older copy” (version 2) isn’t in this project’s history any more. Its label is kept until you remove it. Remove label");
      assert.equal(await page.locator(".cloud-version").count(), 0, "version 2 (a different id) is not shown as this checkpoint");
      await page.getByRole("button", { name: "Remove label" }).click();
      assert.equal(await page.locator(".cloud-checkpoint-orphans").count(), 0);
    });

    for (const width of [375, 320]) await scenario(`phone width ${width}px: readable summary, file view and checkpoint form without horizontal scroll`, {}, async page => {
      await openCompare(page);
      await unit(page, "src/App.tsx").getByRole("button", { name: "Show line 9 of src/App.tsx in Version 3" }).click();
      await compare(page).locator(".vc-view").waitFor();
      await page.locator(".cloud-version").filter({ hasText: "Version 1" }).first().getByRole("button", { name: "Mark version 1 as a checkpoint" }).click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, `no horizontal page scroll (${overflow}px)`);
      if (shots) await page.screenshot({ path: path.join(shots, `${tag}-compare-phone-${width}.png`), fullPage: true });
    }, { width, height: 820 });
  } finally { await browser.close(); server.close(); }
  if (failures.length) { console.log(`\n${failures.length} mounted version comparison checks failed.`); process.exitCode = 1; }
  else console.log(`\nAll mounted version comparison checks passed (${engineLabel}, routed API, nothing saved or published).`);
}
main().catch(error => { console.error(error); process.exit(1); });
