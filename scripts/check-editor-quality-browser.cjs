/* eslint-disable @typescript-eslint/no-require-imports -- Mounted website and book editor (CloudEditor) with the real LivePreview, DocumentPreview, click-to-edit panel and LiveBuilder.
 * Every preview is compiled by the real browser bundler, run in Node by this fixture (inspect builds included). Every API is routed with fictional data and
 * every non-localhost request is aborted: no provider, database, cloud or paid call, and no build request is ever sent.
 * Run: node scripts/check-editor-quality-browser.cjs [--engine=chromium|firefox|webkit] */
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs"), Module = require("node:module"), ts = require("typescript");
const { spawnSync } = require("node:child_process");
const { build } = require("esbuild"), { browserType, engineLabel, collectPageErrors } = require("./browser-engine.cjs"), { createServer } = require("node:http");

const root = path.resolve(__dirname, "..");
const ids = { account: "11111111-1111-4111-8111-111111111111", workspace: "22222222-2222-4222-8222-222222222222", project: "33333333-3333-4333-8333-333333333333",
  site: "44444444-4444-4444-8444-444444444444", book: "55555555-5555-4555-8555-555555555555", user: "66666666-6666-4666-8666-666666666666" };

// TypeScript sources (bundler, schemas) load in Node with their own relative imports.
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  if (name.startsWith("@/")) return load.call(this, path.join(root, "src", `${name.slice(2)}.ts`), parent, main);
  if (name === "esbuild-wasm" && /browser-bundler/.test(parent?.filename ?? "")) return { ...load.call(this, name, parent, main), initialize: async () => {} };
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);

/** The real in-browser bundler, run in Node against the prepared builder runtime. */
function loadBundler() {
  const prepared = spawnSync(process.execPath, ["scripts/prepare-builder-runtime.mjs"], { cwd: root, encoding: "utf8" });
  assert.equal(prepared.status, 0, prepared.stderr);
  const runtime = path.join(root, "public", "builder-runtime"), origin = "http://runtime.test";
  globalThis.location = { origin };
  globalThis.fetch = async url => {
    const file = String(url).startsWith(`${origin}/builder-runtime/`) ? path.join(runtime, String(url).slice(`${origin}/builder-runtime/`.length)) : "";
    return file && fs.existsSync(file) ? new Response(fs.readFileSync(file)) : new Response("missing", { status: 404 });
  };
  return require(path.join(root, "src/lib/builder/browser-bundler.ts"));
}

/* ---------- Fictional website: a hash-routed ceramics studio, three saved versions ---------- */
const toolchain = file => fs.readFileSync(path.join(root, "infra/project-runtime/toolchain", file), "utf8");
const app = headline => `import { useEffect, useState } from "react";
const routeOf = (hash: string) => !hash || hash === "#" || hash === "#/" ? "/" : hash.startsWith("#/") ? hash.slice(1).split("?")[0] : "/";
export default function App() {
  const [path, setPath] = useState(() => routeOf(location.hash));
  useEffect(() => { const on = () => setPath(routeOf(location.hash)); addEventListener("hashchange", on); return () => removeEventListener("hashchange", on); }, []);
  return <main>
    <nav><a href="#/">Home</a> <a href="#/workshops">Workshops</a></nav>
    {path === "/workshops" ? <section><h1>Explore our workshops</h1><p>Wheel throwing on Saturday mornings.</p><div style={{ height: 1600 }} /></section>
      : <section><h1>${headline}</h1><p>Small-batch stoneware from Leith.</p><div style={{ height: 1600 }} /></section>}
  </main>;
}
`;
const ROUTES = [{ path: "/", title: "Home" }, { path: "/workshops", title: "Workshops" }];
const websiteSource = appCode => ({ schemaVersion: 1, toolchainId: "react-vite-v1", entrypoint: "src/main.tsx", assets: [], routes: ROUTES,
  files: Object.entries({ "index.html": '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stillform</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
    "package-lock.json": toolchain("package-lock.json"), "package.json": toolchain("package.json"), "src/App.tsx": appCode,
    "src/main.tsx": 'import { createRoot } from "react-dom/client";\nimport App from "./App";\ncreateRoot(document.getElementById("root")!).render(<App />);\n' })
    .sort(([a], [b]) => a < b ? -1 : 1).map(([file, content]) => ({ path: file, content })) });
const HEADLINES = ["Handmade ceramics", "Handmade ceramics for daily use", "Stoneware made slowly"];
/** A version whose App.tsx doesn't compile: an unclosed JSX element. */
const BROKEN = app(HEADLINES[2]).replace("<p>Small-batch stoneware from Leith.</p>", "<p>Small-batch stoneware from Leith.");

/* ---------- Fictional book: two saved versions of a live-built document ---------- */
const { emptyDocument } = require(path.join(root, "src/lib/documents/editor.ts"));
const { BookSchema } = require(path.join(root, "src/lib/documents/schema.ts"));
const book = chapter => BookSchema.parse({ ...emptyDocument("book", "Field Notes on Clay"), chapters: [{ id: "c1", title: chapter, text: `${chapter} begins at the wheel.` }] });
const BOOK_CHAPTERS = ["The first firing", "The second firing"];

const style = { id: "automatic", name: "Automatic", version: 1, typography: { headingFont: "Inter", bodyFont: "Inter" }, colors: { canvas: "#FFFFFF", ink: "#000000", accent: "#3559D8" }, description: "Fixture direction", referenceAssetIds: [] };
const versionId = (artifact, number) => `${artifact.slice(0, 8)}-8888-4888-8888-${String(number).padStart(12, "0")}`;
const version = (artifact, number, content, summary) => ({ id: versionId(artifact, number), artifactId: artifact, number, parentVersionId: number > 1 ? versionId(artifact, number - 1) : null,
  content, style, assetIds: [], createdAt: `2026-10-${String(10 + number).padStart(2, "0")}T09:00:00.000Z`, createdBy: ids.user, changeSummary: summary });
const siteVersions = (current = 3, lastCode = null) => Array.from({ length: current }, (_, index) => version(ids.site, index + 1,
  { schemaVersion: 1, kind: "website", title: "Stillform", sections: [], websiteSource: websiteSource(index === current - 1 && lastCode ? lastCode : app(HEADLINES[Math.min(index, 2)])) }, `Saved version ${index + 1}`));
const bookVersions = () => BOOK_CHAPTERS.map((chapter, index) => version(ids.book, index + 1, { schemaVersion: 1, kind: "book", title: "Field Notes on Clay", sections: [], document: book(chapter) }, `Wrote ${chapter}`));
/** A save response the scenario releases when it is ready. */
const deferred = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
const artifactOf = (id, kind, current) => ({ id, projectId: ids.project, kind, title: kind === "book" ? "Field Notes on Clay" : "Stillform", currentVersion: current, createdAt: "2026-10-10T09:00:00.000Z", updatedAt: "2026-10-20T09:00:00.000Z" });

const fixture = `import React from "react";import{createRoot}from"react-dom/client";import{CloudEditor}from"./src/components/cloud-studio";import{setCloudAccount}from"./src/components/cloud-api";
const ids=${JSON.stringify(ids)};setCloudAccount(ids.account);window.__notices=[];
window.mountEditor=artifact=>createRoot(document.getElementById("root")).render(<CloudEditor accountId={ids.account} workspaceId={ids.workspace} artifact={artifact} project={{brief:"",effort:"light",clientId:null}} role="owner" back={()=>{}} notify={message=>window.__notices.push(message)}/>);`;
const NULL = "export default function Stub(){return null}";
const mocks = {
  "build-conversation": NULL, "website-generation": NULL, "saved-website-preview": NULL, "pending-cloud-writes": NULL, "cloud-client-outreach": NULL, "account-export": NULL,
  "client-review-panel": NULL, "website-github": NULL, "website-source-download": NULL, "website-analytics": NULL, "website-portal-settings": NULL, "account-artwork-upload": NULL,
  "workbench-more": "export default function More({children}){return children}", "account-style-editor": NULL, "website-enquiries": NULL, "website-publish": NULL, "website-seo": NULL, "website-domains": NULL,
  "publish-snapshot": "export async function captureProjectSnapshot(){return ''}export async function captureProjectPublication(){throw new Error('not used')}",
  "design-capture": "export async function captureDesign(){throw new Error('No visual review in this fixture')}",
  // The real bundler runs in Node behind this fixture route; the page receives exactly its result.
  "browser-bundler": "export async function bundleProject(files,images,mode,options={}){const response=await fetch('/fixture/bundle',{method:'POST',body:JSON.stringify({files,inspect:options.inspect===true})});return response.json()}",
  "supabase-client": "export function createClient(){return{auth:{getUser:async()=>({data:{user:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}}",
  // The real code editor and click-to-edit panel, loaded lazily as next/dynamic would.
  "next/dynamic": "import React from 'react';export default function dynamic(loader){const Lazy=React.lazy(()=>loader().then(module=>({default:module.default??module})));return function Dynamic(props){return <React.Suspense fallback={null}><Lazy {...props}/></React.Suspense>}}",
  "next/link": "import React from'react';export default function Link({href,children,prefetch,...rest}){return <a href={typeof href==='string'?href:'#'} {...rest}>{children}</a>}",
  "next/navigation": "export function useRouter(){return{push(){},replace(){},refresh(){},prefetch(){}}}export function usePathname(){return'/'}export function useSearchParams(){return new URLSearchParams()}",
};
const mockFilter = new RegExp(`(?:^|[\\\\/])(${Object.keys(mocks).filter(name => !name.includes("/") && name !== "supabase-client").join("|")})$|^@\\/lib\\/supabase\\/client$|^next\\/(dynamic|link|navigation)$`);

async function bundle() {
  const css = [];
  const output = await build({ stdin: { contents: fixture, loader: "jsx", resolveDir: root }, write: false, bundle: true, platform: "browser", jsx: "automatic", define: { "process.env": "{}" }, logLevel: "silent",
    plugins: [{ name: "fixture", setup(b) {
      b.onResolve({ filter: mockFilter }, args => ({ path: args.path === "@/lib/supabase/client" ? "supabase-client" : args.path.startsWith("next/") ? args.path : args.path.replace(/^.*[\\/]/, ""), namespace: "mock" }));
      b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path], loader: "jsx", resolveDir: root }));
      b.onResolve({ filter: /^@\// }, args => {
        const base = path.resolve(root, "src", args.path.slice(2));
        return { path: args.path.endsWith(".css") || args.path.endsWith(".json") ? base : fs.existsSync(base + ".tsx") ? base + ".tsx" : fs.existsSync(base + ".ts") ? base + ".ts" : base };
      });
      b.onLoad({ filter: /\.css$/ }, args => { css.push(fs.readFileSync(args.path, "utf8")); return { contents: "", loader: "js" }; });
    } }] });
  const globals = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8").replace(/@import[^;]+;/g, "");
  return { js: output.outputFiles[0].contents, html: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Editor · Stillform</title><style>${globals}${[...new Set(css)].join("\n")}</style><div id="root"></div><script src="/fixture.js"></script>` };
}

async function main() {
  const bundler = loadBundler();
  const { js, html } = await bundle();
  const compiled = new Map();
  const server = createServer(async (req, res) => {
    if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(js); }
    if (req.url === "/fixture/bundle" && req.method === "POST") {
      let text = ""; for await (const chunk of req) text += chunk;
      if (!compiled.has(text)) { const { files, inspect } = JSON.parse(text); compiled.set(text, await bundler.bundleProject(files, {}, "preview", { inspect })); }
      res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify(compiled.get(text)));
    }
    res.setHeader("Content-Type", "text/html"); res.end(html);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await browserType.launch({ headless: true });
  const failures = [];

  /** One independent scenario: a fresh page, routed APIs and the editor mounted for one artifact. */
  async function scenario(name, setup, run) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors = [];
    page.setDefaultTimeout(20000);
    collectPageErrors(page, errors);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
    const kind = setup.kind ?? "website", id = kind === "book" ? ids.book : ids.site;
    const state = { versions: kind === "book" ? bookVersions() : siteVersions(setup.current, setup.lastCode), saves: [], builds: [], unexpected: [], hold: null };
    const base = `/api/cloud/workspaces/${ids.workspace}/artifacts/${id}`;
    const current = () => Math.max(...state.versions.map(item => item.number));
    await page.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      if (url.pathname === base && method === "GET") return route.fulfill({ json: { artifact: artifactOf(id, kind, current()), versions: state.versions, pagination: { offset: 0, total: state.versions.length, nextOffset: null } } });
      if (url.pathname === `${base}/versions` && method === "POST") {
        const body = request.postDataJSON();
        state.saves.push(body);
        if (state.hold) await state.hold.promise;
        if (body.expectedVersion !== current()) return route.fulfill({ status: 409, json: { error: { code: "VERSION_CONFLICT", message: "Another version was saved first." } } });
        const saved = version(id, current() + 1, body.content, body.changeSummary);
        state.versions.push(saved);
        return route.fulfill({ json: { artifact: artifactOf(id, kind, saved.number), version: saved, mutation: { idempotencyKey: request.headers()["idempotency-key"], replayed: false } } });
      }
      if (url.pathname === "/api/build" && method === "GET") return route.fulfill({ json: { available: true, configured: true, state: "ready" } });
      if (url.pathname === "/api/build") { state.builds.push(method); return route.fulfill({ status: 500, json: { error: { message: "No build in this fixture" } } }); }
      if (url.pathname === "/api/credits") return route.fulfill({ json: { available: 500, unlimited: false } });
      if (url.pathname === "/api/build/plan" && method === "GET") return route.fulfill({ json: { stored: null } });
      if (method !== "GET") state.unexpected.push(`${method} ${url.pathname}`);
      return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Not in this fixture." } } });
    });
    try {
      await page.goto(origin); await page.waitForFunction(() => window.mountEditor);
      await page.evaluate(artifact => window.mountEditor(artifact), artifactOf(id, kind, current()));
      await page.getByRole("heading", { name: kind === "book" ? "Field Notes on Clay" : "Stillform", level: 1 }).waitFor();
      await run(page, state);
      assert.deepEqual(errors, [], "no page errors");
      assert.deepEqual(state.builds, [], "no build request was sent");
      assert.deepEqual(state.unexpected, [], "no other writes");
      console.log(`PASS ${name}`);
    } catch (error) {
      const message = String(error.message).split("\n"), line = (String(error.stack).match(/check-editor-quality-browser\.cjs:(\d+)/) ?? [])[1];
      failures.push(name); console.log(`FAIL ${name}: ${message.slice(0, 4).join(" | ")}${line ? ` (line ${line})` : ""}`);
    } finally { state.hold?.release(); await context.close(); }
  }
  const tab = (page, name) => page.getByRole("navigation", { name: "Project view" }).getByRole("button", { name, exact: true }).click();
  const mainFrame = page => page.frameLocator('iframe[title="Website preview"]');
  const previewFactIs = (page, text) => page.waitForFunction(expected => document.querySelector('.version-facts li[data-fact="preview"]')?.textContent === expected, text);
  const panel = page => page.getByRole("complementary", { name: "Edit selected element" });
  /** Edit mode on, then the home page heading picked with the mouse. */
  async function pickHeading(page) {
    await mainFrame(page).locator("h1", { hasText: HEADLINES[2] }).waitFor();
    await page.getByRole("region", { name: "Website preview" }).getByRole("button", { name: "Edit", exact: true }).click();
    await panel(page).waitFor();
    await mainFrame(page).locator("h1[data-mb-loc]").click();
    await panel(page).getByRole("textbox", { name: "Element text" }).waitFor();
  }
  async function editHeading(page, text) {
    await panel(page).getByRole("textbox", { name: "Element text" }).fill(text);
    await panel(page).getByRole("button", { name: "Apply text" }).click();
  }
  const statusIs = (page, text) => page.waitForFunction(expected => document.querySelector(".ve-status")?.textContent === expected, text);
  const versionRow = (page, number) => page.locator(".cloud-version").filter({ has: page.locator("strong", { hasText: new RegExp(`^Version ${number}(?!\\d)`) }) });

  try {
    await scenario("History previews an earlier website version from its own saved files, read-only and without touching the editor's preview", {}, async (page, state) => {
      await mainFrame(page).locator("h1", { hasText: HEADLINES[2] }).waitFor();
      const memoryKey = `makeborne:preview-page:v1:${ids.account}:${ids.workspace}:${ids.site}`;
      await page.waitForFunction(key => sessionStorage.getItem(key) !== null, memoryKey);
      const remembered = await page.evaluate(key => sessionStorage.getItem(key), memoryKey), address = page.url();
      await tab(page, "History");
      await versionRow(page, 1).getByRole("button", { name: "Preview version 1" }).click();
      const review = page.getByRole("region", { name: "Saved version 1" });
      const snapshot = review.getByRole("region", { name: "Preview of saved version 1" });
      await snapshot.waitFor();
      const frame = review.frameLocator('iframe[title="Preview of saved version 1"]');
      await frame.locator("h1", { hasText: HEADLINES[0] }).waitFor();
      assert.equal(await snapshot.getByRole("status").first().innerText(), "Saved version 1 · read only");
      assert.equal(await snapshot.getByRole("button", { name: /^(Edit|Done)$/ }).count(), 0, "no click-to-edit on a saved version");
      assert.equal(await review.getByText("Source saved. Preview build required.").count(), 0, "the placeholder is gone");
      // Its own pages, without moving the editor URL or the preview's remembered page.
      await snapshot.getByRole("combobox", { name: "Preview page" }).selectOption("/workshops");
      await frame.locator("h1", { hasText: "Explore our workshops" }).waitFor();
      await frame.locator("body").evaluate(() => scrollTo(0, 900));
      await page.waitForTimeout(400);
      assert.equal(page.url(), address, "the editor URL is unchanged");
      assert.equal(await page.evaluate(key => sessionStorage.getItem(key), memoryKey), remembered, "the editor preview's remembered page and scroll are unchanged");
      // Restore is unchanged: one explicit button with its effect described.
      const restore = review.getByRole("button", { name: "Restore as new version" });
      assert.match(await page.locator(`#${await restore.getAttribute("aria-describedby")}`).innerText(), /Restore saves a copy of version 1 as new version 4/);
      assert.deepEqual(state.saves, [], "inspecting saves nothing");
      // Back on Preview, the editor still shows the current version on its own page.
      await tab(page, "Preview");
      await mainFrame(page).locator("h1", { hasText: HEADLINES[2] }).waitFor();
      assert.equal(await page.locator('iframe[title="Preview of saved version 1"]').count(), 0, "the snapshot is unmounted outside History");
      assert.equal(await page.locator('section[aria-label="Website preview"]').getAttribute("data-preview-path"), "/");
    });

    await scenario("History previews an earlier book as its typeset document, not the outline", { kind: "book" }, async page => {
      await page.getByRole("region", { name: "Book preview" }).waitFor();
      await tab(page, "History");
      await versionRow(page, 1).getByRole("button", { name: "Preview version 1" }).click();
      const review = page.getByRole("region", { name: "Saved version 1" });
      await review.getByRole("region", { name: "Book preview" }).waitFor();
      const frame = review.frameLocator('iframe[title="Book preview"]');
      await frame.getByText(`${BOOK_CHAPTERS[0]} begins at the wheel.`).waitFor();
      assert.equal(await frame.getByText(`${BOOK_CHAPTERS[1]} begins at the wheel.`).count(), 0, "version 1's own text, not the current version's");
      assert.match(await review.getByRole("group", { name: "Generated outputs from saved version 1" }).innerText(), /v1/);
      assert.equal(await review.getByRole("button", { name: "Restore as new version" }).count(), 1);
    });

    await scenario("a saved version that doesn't build is named, offers its previous version, and Fix it only drafts a request", { lastCode: BROKEN }, async (page, state) => {
      const banner = page.getByRole("alert").filter({ hasText: "has a build error" });
      await banner.waitFor();
      assert.equal(await banner.locator("strong").innerText(), "Version 3 has a build error");
      await previewFactIs(page, "Preview: build error");
      const restore = banner.getByRole("button", { name: "Restore version 2" }), fix = banner.getByRole("button", { name: "Fix it" });
      assert.match(await page.locator(`#${await restore.getAttribute("aria-describedby")}`).innerText(), /^Restore saves a copy of version 2 as new version 4\. It uses no AI and no credits/);
      assert.match(await page.locator(`#${await fix.getAttribute("aria-describedby")}`).innerText(), /Nothing is sent until you choose Send/);
      // Fix it: the request waits in the composer with its maximum; nothing is sent.
      await fix.click();
      const composer = page.getByRole("textbox", { name: "Message the builder" });
      await page.waitForFunction(() => document.querySelector('textarea[aria-label="Message the builder"]')?.value.startsWith("Fix the build error in version 3: "));
      assert.match(await composer.inputValue(), /^Fix the build error in version 3: .*src\/App\.tsx/);
      assert.equal(await composer.evaluate(field => field === document.activeElement), true, "the composer takes focus for review");
      assert.equal(await page.getByRole("button", { name: "Send", exact: true }).isEnabled(), true, "Send is the person's choice");
      assert.match(await page.locator(".lb-limit").innerText(), /^Up to \d+ credits for this request/);
      await page.waitForTimeout(500);
      assert.deepEqual(state.builds, [], "Fix it sent nothing");
      assert.deepEqual(state.saves, []);
      // Restore: History's restore, saved as a new version, after one explicit click.
      await restore.click();
      await page.waitForFunction(() => window.__notices.some(note => note.startsWith("Version 2 restored into your editor.")));
      await mainFrame(page).locator("h1", { hasText: HEADLINES[1] }).waitFor();
      await page.waitForFunction(() => document.querySelector(".editor-heading p")?.textContent.startsWith("Version 4"));
      assert.equal(state.saves.length, 1);
      assert.equal(state.saves[0].expectedVersion, 3);
      assert.deepEqual(state.saves[0].content.websiteSource, state.versions[1].content.websiteSource, "version 2's source, saved as version 4");
      assert.equal(await page.getByRole("alert").filter({ hasText: "build error" }).count(), 0, "the restored version builds");
      await previewFactIs(page, "Preview: version 4");
    });

    await scenario("a build error in unsaved edits says so instead of naming the saved version", { lastCode: BROKEN }, async (page, state) => {
      // An edit in Code that keeps the error, while its save is held open.
      state.hold = deferred();
      await page.getByRole("alert").filter({ hasText: "Version 3 has a build error" }).waitFor();
      await tab(page, "Code");
      await page.getByRole("button", { name: "src/App.tsx", exact: true }).click();
      await page.locator(".cm-content").click();
      await page.keyboard.press("End"); await page.keyboard.type(" ");
      await tab(page, "Preview");
      const banner = page.getByRole("alert").filter({ hasText: "build error" });
      await page.waitForFunction(() => [...document.querySelectorAll('[role="alert"] strong')].some(node => node.textContent === "Your unsaved edits have a build error"));
      assert.equal(await banner.getByRole("button", { name: "Restore version 2" }).isDisabled(), true, "restoring waits for the save");
      assert.match(await banner.innerText(), /Finish saving or resolve your current draft before restoring\./);
      state.hold.release();
      await page.waitForFunction(() => [...document.querySelectorAll('[role="alert"] strong')].some(node => node.textContent === "Version 4 has a build error"));
      await previewFactIs(page, "Preview: build error");
    });
    await scenario("the header says what Preview shows, from every tab: the saved version, then unsaved edits, then the new version", {}, async (page, state) => {
      await mainFrame(page).locator("h1", { hasText: HEADLINES[2] }).waitFor();
      await previewFactIs(page, "Preview: version 3");
      assert.deepEqual(await page.getByRole("list", { name: "Saved, checked, live and preview versions" }).locator("li").evaluateAll(items => items.map(item => item.dataset.fact)), ["saved", "checked", "live", "preview"]);
      state.hold = deferred();
      await tab(page, "Code");
      assert.equal(await page.locator(".source-editor-guidance").innerText(), "Edits save as new versions after you pause. Preview rebuilds from this code in your browser, unsaved edits included; nothing is published until you publish. Use History to restore a saved version.");
      await page.locator(".cm-content").click();
      await page.keyboard.press("End"); await page.keyboard.type(" ");
      await previewFactIs(page, "Preview: unsaved edits");
      await tab(page, "History");
      await previewFactIs(page, "Preview: unsaved edits");
      state.hold.release();
      await previewFactIs(page, "Preview: version 4");
      assert.equal(state.saves.length, 1);
    });
    await scenario("click-to-edit says where the edit saved, and its Undo and selection survive switching tabs", {}, async (page, state) => {
      await pickHeading(page);
      await editHeading(page, "Stoneware, made slowly");
      await statusIs(page, "Saving your edit… · Undo");
      await statusIs(page, "Saved as version 4 · Undo");
      assert.equal(state.saves.length, 1);
      assert.match(state.saves[0].content.websiteSource.files.find(file => file.path === "src/App.tsx").content, /<h1>Stoneware, made slowly<\/h1>/);
      // Another tab unmounts the preview; coming back restores edit mode, the selection and Undo.
      await tab(page, "History");
      await page.getByRole("heading", { name: "Version history" }).waitFor();
      assert.equal(await page.locator('iframe[title="Website preview"]').count(), 0, "the preview frame is not kept running in another tab");
      await tab(page, "Preview");
      await panel(page).waitFor();
      await statusIs(page, "Saved as version 4 · Undo");
      await page.waitForFunction(() => document.querySelector('textarea[aria-label="Element text"]')?.value === "Stoneware, made slowly");
      assert.equal(await panel(page).getByRole("button", { name: "Undo last edit" }).count(), 1);
      await panel(page).locator(".ve-status").getByRole("button", { name: "Undo" }).click();
      await statusIs(page, "Saved as version 5");
      await mainFrame(page).locator("h1", { hasText: HEADLINES[2] }).waitFor();
      assert.equal(state.saves.length, 2);
      assert.match(state.saves[1].content.websiteSource.files.find(file => file.path === "src/App.tsx").content, new RegExp(`<h1>${HEADLINES[2]}</h1>`), "Undo saved the earlier text as a new version");
      assert.equal(state.saves[1].changeSummary, "Undid a visual edit");
      assert.equal(await panel(page).getByRole("button", { name: "Undo last edit" }).count(), 0, "nothing left to undo");
    });

    await scenario("while an edit is saving the builder keeps taking text; only Send waits, with the reason", {}, async (page, state) => {
      state.hold = deferred();
      await pickHeading(page);
      await editHeading(page, "Stoneware, made slowly");
      await statusIs(page, "Saving your edit… · Undo");
      await page.waitForFunction(() => document.querySelector(".lb-notice")?.textContent === "Saving your edit…");
      const composer = page.getByRole("textbox", { name: "Message the builder" }), send = page.getByRole("button", { name: "Send", exact: true });
      assert.equal(await composer.isEnabled(), true, "typing is not blocked by the autosave");
      await composer.click(); await page.keyboard.type("Make the navigation sticky.");
      assert.equal(await composer.inputValue(), "Make the navigation sticky.");
      assert.equal(await send.isDisabled(), true, "Send waits for the save");
      await page.keyboard.press("Enter");
      assert.equal(await composer.inputValue(), "Make the navigation sticky.", "Enter doesn't send or clear the text while saving");
      state.hold.release();
      await statusIs(page, "Saved as version 4 · Undo");
      await page.waitForFunction(() => !document.querySelector('button[aria-label="Send"]')?.disabled);
      assert.equal(await page.locator(".lb-notice").count(), 0, "the reason goes once saved");
      assert.equal(await composer.inputValue(), "Make the navigation sticky.");
      assert.deepEqual(state.builds, []);
    });
  } finally { await browser.close(); server.close(); }
  if (failures.length) { console.log(`\n${failures.length} mounted editor quality checks failed.`); process.exitCode = 1; }
  else console.log(`\nAll mounted editor quality checks passed (${engineLabel}, routed API, nothing built or published).`);
}
main().catch(error => { console.error(error); process.exit(1); });
