/* eslint-disable @typescript-eslint/no-require-imports -- Mounted website Code view in Chromium (audit M12): file-name and code search with counts, snippets and line jumps, version identity, duplicate basenames, stale results, keyboard use, bounds on 200 files / 2 MB, and 375/320px. Fictional fixture; nothing is saved or sent.
 * Run: node scripts/check-source-search-browser.cjs [--baseline=<git rev>]  (SHOTS_DIR=<dir> saves screenshots)
 * --baseline bundles every src/ file from that revision instead (files new since then come from the working copy), to show what the earlier code lacks. */
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs"), { execFileSync } = require("node:child_process");
const { build } = require("esbuild"), { browserType, engineLabel } = require("./browser-engine.cjs"), { createServer } = require("node:http");

const baseline = process.argv.find(arg => arg.startsWith("--baseline="))?.slice("--baseline=".length) ?? null;
const shots = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : null;
const toolchain = file => fs.readFileSync(path.resolve("infra/project-runtime/toolchain", file), "utf8");
const files = {
  "package.json": toolchain("package.json"), "package-lock.json": toolchain("package-lock.json"),
  "index.html": '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Stillform</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
  "src/main.tsx": 'import { createRoot } from "react-dom/client";\nimport App from "./App";\ncreateRoot(document.getElementById("root")!).render(<App />);',
  "src/App.tsx": 'import Home from "./routes/index";\nexport default function App() { return <Home />; }',
  "src/routes/index.tsx": "import { Workshops } from './workshops';\nexport default function Home() {\n  return <main><h1>Explore handmade collections</h1><Workshops /></main>;\n}",
  "src/routes/workshops.tsx": "export function Workshops() {\n  return <section>\n    <h2>Workshops</h2>\n    <p>Our workshops run weekly. workshops, WORKSHOPS.</p>\n  </section>;\n}",
  "src/components/index.tsx": "export const Card = () => <div>Card</div>;",
  "src/content.ts": "export const nav = ['Home', 'Workshops'];",
};
const source = { schemaVersion: 1, toolchainId: "react-vite-v1", entrypoint: "src/main.tsx", assets: [], routes: [{ path: "/", title: "Home" }], files: Object.entries(files).sort(([a], [b]) => a < b ? -1 : 1).map(([p, content]) => ({ path: p, content })) };

const fixture = `import React, { useState } from "react"; import { createRoot } from "react-dom/client";
import WebsiteSourceEditor from "./src/components/website-source-editor";
const base = ${JSON.stringify(source)};
function App() {
  const [source, setSource] = useState(base), [subject, setSubject] = useState({ artifactId: "44444444-4444-4444-8444-444444444444", version: 4, dirty: false }), [readOnly, setReadOnly] = useState(false);
  Object.assign(window, { base, setSource, setSubject, setReadOnly, edits: window.edits ?? 0 });
  return <main style={{ maxWidth: 1180, margin: "0 auto", padding: 12 }}><WebsiteSourceEditor source={source} readOnly={readOnly} subject={subject} onChange={next => { window.edits++; setSource(next); }} /></main>;
}
createRoot(document.getElementById("root")).render(<App />);`;

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

  async function scenario(name, run, viewport = { width: 1440, height: 1000 }) {
    const context = await browser.newContext({ viewport }), page = await context.newPage(), errors = [], requests = [];
    page.setDefaultTimeout(baseline ? 4000 : 10000);
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (!request.url().startsWith(origin)) requests.push(request.url()); });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
    try {
      await page.goto(origin);
      await page.locator(".cm-content").waitFor();
      await run(page);
      assert.deepEqual(errors, [], "no page errors");
      assert.deepEqual(requests, [], "searching sends nothing anywhere");
      assert.equal(await page.evaluate(() => window.edits), 0, "searching and jumping never edit the code");
      console.log(`PASS ${name}`);
    } catch (error) {
      const message = String(error.message).split("\n"), waiting = message.find(line => /waiting for/.test(line))?.replace(/\x1b\[\d+m/g, "").trim();
      failures.push(name); console.log(`FAIL ${name}: ${message.slice(0, 8).join(" | ")}${waiting ? ` (${waiting})` : ""}`);
    } finally { await context.close(); }
  }
  const search = page => page.getByRole("searchbox", { name: "Search files and code" });
  const results = page => page.locator(".sse-results");
  const summary = (page, text) => page.waitForFunction(expected => document.querySelector(".sse-summary")?.textContent === expected, text).catch(async () => assert.equal(await page.locator(".sse-summary").innerText(), text));
  const settle = page => page.waitForFunction(() => !document.querySelector(".sse-results") || document.querySelector(".sse-summary")?.textContent !== "Searching…");
  async function find(page, text) { await search(page).fill(text); await page.waitForTimeout(260); await settle(page); }
  const shot = async (page, label, locator) => { if (shots) await (locator ? page.locator(locator).first() : page).screenshot({ path: path.join(shots, `${tag}-search-${label}.png`) }); };
  const target = page => page.evaluate(() => ({ heading: document.querySelector(".source-editor-file-heading code")?.textContent, line: document.querySelector(".source-editor-line")?.textContent ?? null, target: document.querySelector(".cm-search-target")?.textContent ?? null, selected: (() => { const sel = document.querySelector(".cm-selectionBackground"); return !!sel; })(), active: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent }));

  try {
    await scenario("file-name and code scopes are separate, with per-file counts, snippets and the searched version named", async page => {
      await find(page, "workshops");
      const box = results(page);
      assert.equal(await box.locator(".sse-summary").innerText(), "1 file name · 9 matches in 3 files");
      assert.equal(await page.locator(".sse-scope").innerText(), "Searching saved version 4. Plain text, not patterns.");
      const names = box.getByRole("region", { name: "File name matches" });
      assert.deepEqual((await names.locator("button").allInnerTexts()).map(text => text.replace(/\s+/g, " ").trim()), ["workshops.tsx src/routes"]);
      const code = box.getByRole("region", { name: "Code matches" });
      const fileButtons = await code.locator(".sse-file > button").evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label")));
      assert.deepEqual(fileButtons, ["src/routes/workshops.tsx, 5 matches", "src/routes/index.tsx, 3 matches", "src/content.ts, 1 match"], "the file that matched by name is also listed for its content");
      const hit = await code.locator(".sse-hit").first().getAttribute("aria-label");
      assert.equal(hit, "src/routes/workshops.tsx line 1: export function Workshops() {");
      assert.equal(await code.locator(".sse-hit mark").first().innerText(), "Workshops");
      assert.equal(await code.locator(".sse-hit").nth(2).locator("em").innerText(), "×3", "repeated matches on one line are counted on that line");
      await page.getByRole("button", { name: "File names", exact: true }).click(); await summary(page, "1 file name");
      await page.getByRole("button", { name: "In code", exact: true }).click(); await summary(page, "9 matches in 3 files");
      await page.getByRole("checkbox", { name: "Match case" }).check(); await summary(page, "3 matches in 2 files");
      await page.getByRole("checkbox", { name: "Match case" }).uncheck();
      await find(page, "react");
      assert.match(await box.locator(".sse-file > button").last().getAttribute("aria-label"), /^package(-lock)?\.json/, "managed files are listed after your own files");
      await page.getByRole("checkbox", { name: "Skip managed files" }).check(); await page.waitForFunction(() => /^Not searched/.test(document.querySelector(".sse-results .sse-note:last-child")?.textContent ?? ""));
      assert.match(await box.locator(".sse-note").last().innerText(), /^Not searched: managed files \(package-lock\.json, package\.json\)\.$/);
      await shot(page, "scopes", ".source-editor");
    });

    await scenario("a code hit opens that exact file at the line and highlights the match; focus stays in the results", async page => {
      await find(page, "Explore handmade collections");
      const hit = page.locator(".sse-hit").first();
      assert.equal(await hit.getAttribute("aria-label"), "src/routes/index.tsx line 3: return <main><h1>Explore handmade collections</h1><Workshops /></main>;");
      await hit.click();
      await page.waitForFunction(() => document.querySelector(".source-editor-line")?.textContent === "Line 3");
      const state = await target(page);
      assert.equal(state.heading, "src/routes/index.tsx");
      assert.match(state.target, /Explore handmade collections/);
      assert.equal(state.selected, true, "the matching text is selected");
      assert.match(state.active, /^src\/routes\/index\.tsx line 3:/,"focus stays on the result for the next one");
      assert.match(await page.locator(".sse-notice").innerText(), /^Opened src\/routes\/index\.tsx at line 3\.$/);
      await shot(page, "line-jump", ".source-editor");
    });

    await scenario("duplicate basenames are shown with their folders and open the right file", async page => {
      await page.getByRole("button", { name: "File names", exact: true }).click();
      await find(page, "index.tsx");
      const names = page.getByRole("region", { name: "File name matches" }).locator("button");
      assert.deepEqual((await names.allInnerTexts()).map(text => text.replace(/\s+/g, " ").trim()), ["index.tsx src/components", "index.tsx src/routes"]);
      await names.nth(1).click();
      assert.equal((await target(page)).heading, "src/routes/index.tsx");
      await names.nth(0).click();
      assert.equal((await target(page)).heading, "src/components/index.tsx");
    });

    await scenario("keyboard: arrows move through results, Enter opens, Escape returns to the box and then clears it without leaving Code", async page => {
      await search(page).focus();
      await page.keyboard.type("workshops"); await page.waitForTimeout(260); await settle(page);
      await page.keyboard.press("ArrowDown");
      assert.equal(await page.evaluate(() => document.activeElement.closest(".sse-results") !== null), true);
      await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown");
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "src/routes/workshops.tsx line 3: <h2>Workshops</h2>");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelector(".source-editor-line")?.textContent === "Line 3");
      assert.equal((await target(page)).heading, "src/routes/workshops.tsx");
      await page.keyboard.press("End");
      assert.match(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), /^src\/content\.ts line 1/);
      await page.keyboard.press("Home"); await page.keyboard.press("ArrowUp");
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Search files and code", "up from the first result returns to the box");
      await page.keyboard.press("ArrowDown"); await page.keyboard.press("Escape");
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Search files and code");
      await page.keyboard.press("Escape");
      assert.equal(await search(page).inputValue(), "");
      await page.locator(".source-editor-file-list").waitFor();
      assert.equal(await page.locator(".cm-content").count(), 1, "Code stays open");
    });

    await scenario("results go stale when the code changes: an out-of-date line is refused, Search again refreshes, same code under a new label stays current", async page => {
      await find(page, "Explore handmade collections");
      await page.evaluate(() => window.setSubject(subject => ({ ...subject, dirty: true })));
      assert.equal(await page.locator(".sse-scope").innerText(), "Searching version 4 with unsaved changes. Plain text, not patterns.");
      assert.equal(await page.locator(".sse-stale").count(), 0, "identical code is still current");
      await page.evaluate(() => window.setSource(source => ({ ...source, files: source.files.map(file => file.path === "src/routes/index.tsx" ? { ...file, content: `// moved down\n${file.content}` } : file) })));
      await page.locator(".sse-stale").waitFor();
      assert.match(await page.locator(".sse-stale").innerText(), /The code changed after this search, so these results may point to the wrong line\./);
      assert.equal(await page.locator(".sse-results[data-stale]").count(), 1);
      await page.locator(".sse-hit").first().click();
      assert.equal(await page.getByRole("alert").innerText(), "That match is no longer on line 3 of src/routes/index.tsx. Search again to update the results.");
      await shot(page, "stale", ".source-editor-files");
      await page.getByRole("button", { name: "Search again" }).click();
      await page.waitForFunction(() => !document.querySelector(".sse-stale"));
      assert.match(await page.locator(".sse-hit").first().getAttribute("aria-label"), /^src\/routes\/index\.tsx line 4:/);
      await find(page, "Card");
      await page.evaluate(() => window.setSource(source => ({ ...source, files: source.files.filter(file => file.path !== "src/components/index.tsx") })));
      await page.locator(".sse-stale").waitFor();
      await page.locator(".sse-hit").first().click();
      assert.equal(await page.getByRole("alert").innerText(), "src/components/index.tsx is no longer in this code. Search again to update the results.", "a deleted file is not replaced by another index.tsx");
      assert.equal((await target(page)).heading, "src/main.tsx");
    });

    await scenario("no match and too-short queries explain themselves; read-only code is searchable", async page => {
      await page.evaluate(() => window.setReadOnly(true));
      await find(page, "Explore the collections");
      assert.equal(await page.locator(".sse-empty").innerText(), "No file names or code match “Explore the collections” in this version.");
      await find(page, "x");
      assert.equal(await page.locator(".sse-note").first().innerText(), "Type at least 2 characters to search inside files.");
      await find(page, "Explore handmade");
      await page.locator(".sse-hit").first().click();
      await page.waitForFunction(() => document.querySelector(".source-editor-line")?.textContent === "Line 3");
    });

    await scenario("bounded: 200 files / 2 MB search stays responsive, caps hits and says counting stopped", async page => {
      await page.evaluate(() => {
        const files = [...window.base.files.filter(file => /^(package|index\.html|src\/main)/.test(file.path))];
        for (let index = 0; files.length < 200; index++) files.push({ path: `src/pages/page-${String(index).padStart(3, "0")}.tsx`, content: Array.from({ length: 125 }, (_, line) => `  <p className="text-sm">Line ${line} of page ${index}: a common word appears here.</p>`).join("\n") });
        window.setSource({ ...window.base, files });
      });
      await page.waitForTimeout(100);
      const timing = await page.evaluate(() => new Promise(resolve => {
        const input = document.querySelector('input[aria-label="Search files and code"]');
        let longest = 0; const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) longest = Math.max(longest, entry.duration); });
        try { observer.observe({ type: "longtask", buffered: false }); } catch { /* optional */ }
        const started = performance.now();
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(input, "common"); input.dispatchEvent(new Event("input", { bubbles: true }));
        const wait = () => { const summary = document.querySelector(".sse-summary")?.textContent ?? ""; if (/matches/.test(summary)) { observer.disconnect(); resolve({ ms: performance.now() - started, longest, summary, hits: document.querySelectorAll(".sse-hit").length, files: document.querySelectorAll(".sse-file").length, bytes: 0 }); } else requestAnimationFrame(wait); };
        wait();
      }));
      assert.match(timing.summary, /^0 file names · 20,000\+ matches in \d+\+ files$/);
      assert.ok(timing.ms < 2500, `results within 2.5 s of typing (${timing.ms.toFixed(0)} ms, includes the ${200} ms pause)`);
      assert.ok(timing.longest < 1000, `no long freeze (${timing.longest.toFixed(0)} ms longest task)`);
      assert.ok(timing.hits <= 300 + timing.files, `hits capped (${timing.hits})`);
      assert.match(await page.locator(".sse-note").filter({ hasText: "Counting stopped" }).innerText(), /Counting stopped at 20,000 matches, so there are more than shown\. Some matching lines are not listed; narrow the search to see them\./);
      console.log(`     (2 MB search: results in ${timing.ms.toFixed(0)} ms incl. debounce, longest task ${timing.longest.toFixed(0)} ms, ${timing.hits} hits in ${timing.files} files listed)`);
    });

    for (const width of [375, 320]) await scenario(`phone width ${width}px: search, results and line jump without horizontal scroll`, async page => {
      await find(page, "workshops");
      await page.locator(".sse-hit").nth(2).click();
      await page.waitForFunction(() => document.querySelector(".source-editor-line")?.textContent === "Line 4");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, `no horizontal page scroll (${overflow}px)`);
      const box = await page.locator(".sse-results").boundingBox();
      assert.ok(box && box.width <= width, "results fit the screen");
      await shot(page, `phone-${width}`);
    }, { width, height: 820 });
  } finally { await browser.close(); server.close(); }
  if (failures.length) { console.log(`\n${failures.length} mounted source search checks failed.`); process.exitCode = 1; }
  else console.log(`\nAll mounted source search checks passed (${engineLabel}, fictional code, nothing saved or sent).`);
}
main().catch(error => { console.error(error); process.exit(1); });
