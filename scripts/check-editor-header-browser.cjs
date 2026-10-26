/* eslint-disable @typescript-eslint/no-require-imports -- Mounted project editor chrome (CloudEditor + the real LivePreview toolbar) in a browser: one project header, one preview toolbar,
 * truthful save states (loading, saved, unsaved, saving, failed, unconfirmed, conflict, recovery, view only), Publish opening the workflow without publishing,
 * menus by keyboard (Enter, ArrowDown, Escape, Tab out, outside click, focus return), responsive sizes at 375/800/1440/2560 with no horizontal overflow,
 * view/route/device transitions, a running build, reviewer permissions, a legacy static website, an outline book and project switching.
 * Every API is a Playwright route with fictional data; the in-browser bundler is replaced by a fixed document; no provider, database or paid call; no network beyond 127.0.0.1.
 * Run: node scripts/check-editor-header-browser.cjs [--engine=chromium|firefox|webkit]   (SHOTS_DIR=<dir> saves screenshots) */
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs");
const { build } = require("esbuild"), { browserType, engineLabel } = require("./browser-engine.cjs"), { createServer } = require("node:http");

const shots = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : null;
const ids = { account: "11111111-1111-4111-8111-111111111111", workspace: "22222222-2222-4222-8222-222222222222", project: "33333333-3333-4333-8333-333333333333",
  site: "44444444-4444-4444-8444-444444444444", legacy: "45444444-4444-4444-8444-444444444444", book: "46444444-4444-4444-8444-444444444444", user: "66666666-6666-4666-8666-666666666666" };
const style = { id: "automatic", name: "Automatic", version: 1, typography: { headingFont: "Inter", bodyFont: "Inter" }, colors: { canvas: "#FFFFFF", ink: "#000000", accent: "#3559D8" }, description: "Fixture direction", referenceAssetIds: [] };
const toolchain = file => fs.readFileSync(path.resolve("infra/project-runtime/toolchain", file), "utf8");
const source = { schemaVersion: 1, toolchainId: "react-vite-v1", entrypoint: "src/main.tsx", assets: [], routes: [{ path: "/", title: "Home" }, { path: "/menu", title: "Menu" }, { path: "/visit", title: "Visit us" }],
  files: [{ path: "package.json", content: toolchain("package.json") }, { path: "package-lock.json", content: toolchain("package-lock.json") }, { path: "index.html", content: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Ovenbird</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>' },
    { path: "src/main.tsx", content: 'import { createRoot } from "react-dom/client";\ncreateRoot(document.getElementById("root")!).render(<h1>Ovenbird</h1>);' }] };
const LONG = "Ovenbird Bakehouse & Coffee Roasters — Leith Shore Street weekend market edition";
const contentOf = { site: () => ({ schemaVersion: 1, kind: "website", title: "Ovenbird Bakehouse", sections: [], websiteSource: source }),
  legacy: () => ({ schemaVersion: 1, kind: "website", title: "Old Harbour Café", sections: [], website: { html: `<main><h1>Old Harbour Café</h1>${"<p>Fresh coffee by the harbour every morning.</p>".repeat(3)}</main>`, css: `body{margin:0;font:16px/1.5 system-ui}main{padding:24px}h1{font-size:40px}${" ".repeat(60)}`, description: "A static design.", designNotes: "Fixture." } }),
  book: () => ({ schemaVersion: 1, kind: "book", title: "Field Notes for Small Studios", sections: [{ id: "51111111-1111-4111-8111-111111111111", title: "Chapter one", blocks: [{ id: "52111111-1111-4111-8111-111111111111", type: "paragraph", text: "The first draft starts here.", assetId: null, locked: false, sourceIds: [] }] }] }) };
const titles = { site: "Ovenbird Bakehouse", legacy: "Old Harbour Café", book: "Field Notes for Small Studios" };
const kinds = { site: "website", legacy: "website", book: "book" };
const vid = (key, n) => `8${key === "site" ? "8" : key === "legacy" ? "7" : "6"}888888-8888-4888-8888-88888888888${n}`;
const versionOf = (key, number, content = contentOf[key]()) => ({ id: vid(key, number), artifactId: ids[key], number, parentVersionId: number > 1 ? vid(key, number - 1) : null,
  content, style, assetIds: [], createdAt: `2026-10-2${number}T09:00:00.000Z`, createdBy: ids.user, changeSummary: `Fixture version ${number}` });
const artifactOf = (key, current, title = titles[key]) => ({ id: ids[key], projectId: ids.project, kind: kinds[key], title, currentVersion: current, createdAt: "2026-10-20T09:00:00.000Z", updatedAt: "2026-10-23T09:00:00.000Z" });

const fixture = `import React from "react";import{createRoot}from"react-dom/client";import{CloudEditor}from"./src/components/cloud-studio";import{setCloudAccount}from"./src/components/cloud-api";
const ids=${JSON.stringify(ids)};setCloudAccount(ids.account);let root;window.__back=0;window.__notices=[];
window.mountEditor=({artifact,role="owner"})=>{root??=createRoot(document.getElementById("root"));root.render(<CloudEditor key={artifact.id} accountId={ids.account} workspaceId={ids.workspace} artifact={artifact} project={{brief:"",effort:"medium",clientId:null}} role={role} back={()=>{window.__back++}} notify={text=>window.__notices.push(text)}/>);};`;
const NULL = "export default function Stub(){return null}";
const mocks = {
  "live-builder": `import React from "react";export default function LiveBuilderStub(props){React.useEffect(()=>{window.__onLive=props.onLive;},[props.onLive]);return <aside className="lb" aria-label="Conversation"><p>{props.disabledReason||"Builder ready"}</p><textarea aria-label="Message" defaultValue=""/></aside>}`,
  "build-conversation": 'export default function ConversationStub(){return <aside className="build-conversation" aria-label="Conversation"><textarea aria-label="Message"/></aside>}',
  "browser-bundler": `export async function bundleProject(){return{ok:true,html:'<!doctype html><html><head></head><body><h1>Ovenbird</h1><p>Fixture page</p><script>parent.postMessage({source:"makeborne-preview",type:"ready"},"*");parent.postMessage({source:"makeborne-preview",type:"rendered",text:12},"*");addEventListener("message",function(e){if(e.data&&e.data.type==="navigate")parent.postMessage({source:"makeborne-preview",type:"location",hash:e.data.hash,kind:e.data.mode==="push"?"push":"replace",title:"Ovenbird",y:0},"*")});</script></body></html>'}}`,
  "website-publish": 'export default function PublishStub(props){return <section aria-label="Publish website"><h2>Publish website</h2><p>Saved version {props.version}</p></section>}',
  "client-review-panel": 'export default function ReviewStub(){return <section aria-label="Client review"><h2>Client review</h2></section>}',
  "account-preview": 'export default function Preview({content}){return <p className="preview-stub">Saved preview of {content.title}</p>}',
  "website-generation": NULL, "saved-website-preview": NULL, "pending-cloud-writes": NULL, "cloud-client-outreach": NULL, "account-export": NULL, "website-github": NULL, "version-compare": NULL,
  "website-analytics": NULL, "website-portal-settings": NULL, "account-artwork-upload": NULL, "account-style-editor": NULL, "website-enquiries": NULL, "website-seo": NULL, "website-domains": NULL,
  "publish-snapshot": "export async function captureProjectSnapshot(){return ''}export async function captureProjectPublication(){throw new Error('not used')}",
  "supabase-client": "export function createClient(){return{auth:{getUser:async()=>({data:{user:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}}",
  "next/dynamic": "export default function dynamic(){return function Dynamic(){return null}}",
  "next/link": "import React from'react';export default function Link({href,children,prefetch,...rest}){return <a href={typeof href==='string'?href:'#'} {...rest}>{children}</a>}",
  "next/navigation": "export function useRouter(){return{push(){},replace(){},refresh(){},prefetch(){}}}export function usePathname(){return'/'}export function useSearchParams(){return new URLSearchParams()}",
};
const stubbed = Object.keys(mocks).filter(name => !name.includes("/") && name !== "supabase-client");
const mockFilter = new RegExp(`(?:^|[\\\\/])(${stubbed.join("|")})$|^@\\/lib\\/supabase\\/client$|^next\\/(dynamic|link|navigation)$`);

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
      b.onLoad({ filter: /\.css$/ }, args => { css.push(fs.readFileSync(args.path, "utf8")); return { contents: "", loader: "js" }; });
    } }] });
  const globals = fs.readFileSync(path.resolve("src/app/globals.css"), "utf8").replace(/@import[^;]+;/g, "");
  // The studio shell the editor opens in (build-workspace.css is loaded by the studio page, not the editor).
  const shell = fs.readFileSync(path.resolve("src/app/build-workspace.css"), "utf8");
  return { js: output.outputFiles[0].contents, html: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${globals}${shell}${css.join("\n")}</style><div class="studio-shell is-project-open"><main class="studio-main"><div class="workspace-content" id="root"></div></main></div><script src="/fixture.js"></script>` };
}

const SIZES = [[375, 812], [800, 900], [1440, 900], [2560, 1440]];

async function main() {
  const { js, html } = await bundle();
  const server = createServer((req, res) => { const script = req.url === "/fixture.js"; res.setHeader("Content-Type", script ? "text/javascript" : "text/html"); res.end(script ? js : html); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await browserType.launch({ headless: true });
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const failures = [], results = [], metrics = [];

  /** One scenario: fresh page, routed APIs, the editor mounted for `key` with `role`. */
  async function scenario(name, options, run) {
    const { key = "site", role = "owner", width = 1440, height = 900, ...setup } = options;
    const context = await browser.newContext({ viewport: { width, height } }), page = await context.newPage(), errors = [], writes = [], foreign = [];
    page.setDefaultTimeout(10000);
    page.on("pageerror", error => errors.push(error.message));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, route => { foreign.push(route.request().url()); return route.abort(); });
    const state = { saved: { site: 3, legacy: 2, book: 2 }, live: 2, save: "ok", saveDelay: 0, loadDelay: 0, build: { available: false }, ...setup };
    await page.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      if (method !== "GET") writes.push(`${method} ${url.pathname}`);
      const match = url.pathname.match(/^\/api\/cloud\/workspaces\/[^/]+\/artifacts\/([^/]+)(\/.*)?$/);
      const artifactKey = match && Object.keys(ids).find(item => ids[item] === match[1]);
      if (url.pathname === "/api/build") return route.fulfill({ json: state.build });
      if (/\/brand-kits$/.test(url.pathname)) return route.fulfill({ json: { kits: [] } });
      if (artifactKey && !match[2] && method === "GET") {
        if (state.loadDelay) await new Promise(resolve => setTimeout(resolve, state.loadDelay));
        const n = state.saved[artifactKey];
        return route.fulfill({ json: { artifact: artifactOf(artifactKey, n), versions: Array.from({ length: n }, (_, index) => versionOf(artifactKey, index + 1)), pagination: { offset: 0, total: n, nextOffset: null } } });
      }
      if (artifactKey && match[2] === "/publication" && method === "GET") return route.fulfill({ json: { site: state.live ? { slug: "ovenbird-test", live: true, version_number: state.live, revision: 4 } : null, address: state.live ? "https://sites.makeborne.com/ovenbird-test" : null } });
      if (artifactKey && match[2] === "/versions" && method === "POST") {
        if (state.saveDelay) await new Promise(resolve => setTimeout(resolve, state.saveDelay));
        const outcome = Array.isArray(state.save) ? state.save.shift() ?? "ok" : state.save;
        if (outcome === "failed") return route.fulfill({ status: 422, json: { error: { code: "INVALID_CONTENT", message: "This content could not be saved." } } });
        if (outcome === "uncertain") return route.fulfill({ status: 500, json: { error: { code: "STORAGE_UNCONFIRMED", message: "Cloud storage could not confirm this save." } } });
        if (outcome === "conflict") return route.fulfill({ status: 409, json: { error: { code: "VERSION_CONFLICT", message: "Another version was saved first." } } });
        const body = request.postDataJSON(), number = ++state.saved[artifactKey];
        return route.fulfill({ json: { artifact: artifactOf(artifactKey, number), version: versionOf(artifactKey, number, body.content), mutation: { idempotencyKey: request.headers()["idempotency-key"], replayed: false } } });
      }
      if (artifactKey && match[2] === "/source" && method === "GET") return route.fulfill({ status: 503, json: { error: { code: "SOURCE_UNAVAILABLE", message: "Source download is unavailable in this fixture." } } });
      return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Not in this fixture." } } });
    });
    try {
      await page.goto(origin); await page.waitForFunction(() => window.mountEditor);
      if (setup.recovery) await page.evaluate(([k, draft]) => localStorage.setItem(k, JSON.stringify(draft)), [`makeborne.cloud-draft.${ids.account}.${ids.workspace}.${ids[key]}`, { schemaVersion: 1, basedOnVersion: 2, content: contentOf[key](), style, assetIds: [], note: "Device draft" }]);
      await page.evaluate(([artifact, role]) => window.mountEditor({ artifact, role }), [artifactOf(key, 0), role]);
      await run(page, { state, writes, key, context });
      assert.deepEqual(errors, [], "no page errors");
      assert.deepEqual(foreign, [], "no request left 127.0.0.1");
      console.log(`PASS ${name}`); results.push({ name, pass: true });
    } catch (error) {
      const message = String(error.message).split("\n"), waiting = message.find(line => /waiting for/.test(line))?.replace(/\x1b\[\d+m/g, "").trim();
      failures.push(name); results.push({ name, pass: false, error: message[0] });
      console.log(`FAIL ${name}: ${message[0]}${waiting ? ` (${waiting})` : ""}`);
    } finally { await context.close(); }
  }

  const header = page => page.locator("[data-editor-chrome=header]");
  const toolbar = page => page.locator("[data-editor-chrome=toolbar]");
  const ready = async (page, title = "Ovenbird Bakehouse") => { await page.getByRole("heading", { level: 1, name: title }).waitFor(); await header(page).locator(".ph-save:not([data-state=loading])").waitFor(); };
  const saveState = page => header(page).locator(".ph-save").getAttribute("data-state");
  const frame = async page => { await page.locator('iframe[title="Website preview"]').waitFor(); };
  /** Geometry of the chrome, the canvas and everything that could overflow or clip. */
  const measure = page => page.evaluate(() => {
    const box = selector => { const el = document.querySelector(selector); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), width: Math.round(r.width) }; };
    const chrome = [...document.querySelectorAll("[data-editor-chrome] :is(button, select, a[href])")].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const clipped = chrome.filter(el => el.scrollWidth > el.clientWidth + 1 && !el.matches("select") && getComputedStyle(el).overflow !== "visible").map(el => el.textContent.trim());
    const outside = chrome.filter(el => { const r = el.getBoundingClientRect(); return r.right > innerWidth + 0.5 || r.left < -0.5; }).map(el => el.getAttribute("aria-label") || el.textContent.trim());
    return { header: box("[data-editor-chrome=header]"), toolbar: box("[data-editor-chrome=toolbar]"), canvas: box(".lp-stage") ?? box(".cloud-workbench-content"),
      overflowX: document.documentElement.scrollWidth - innerWidth, clipped, outside, controls: chrome.length };
  });
  async function capture(page, label) {
    if (!shots) return;
    await page.screenshot({ path: path.join(shots, `${label}.png`) });
  }

  try {
    await scenario("loading: the title and chrome are in place while the project opens; nothing claims Saved", { loadDelay: 1500 }, async page => {
      await page.getByRole("heading", { level: 1, name: "Ovenbird Bakehouse" }).waitFor();
      assert.equal(await saveState(page), "loading");
      assert.match(await header(page).locator(".ph-save").innerText(), /Opening/);
      assert.equal(await header(page).getByRole("button", { name: /^Save now|Retry save$/ }).count(), 0, "no save button before content exists");
      await capture(page, "state-loading-1440");
      await ready(page);
      assert.equal(await saveState(page), "saved");
    });

    for (const [width, height] of SIZES) await scenario(`saved website at ${width}x${height}: one header row and one toolbar row, title visible, no overflow or clipping`, { width, height }, async page => {
      await ready(page); await frame(page);
      await page.waitForTimeout(150);
      const m = await measure(page);
      metrics.push({ case: "website saved", width, height, ...m });
      assert.equal(m.overflowX, 0, "no horizontal page scroll");
      assert.deepEqual(m.clipped, [], "no clipped labels");
      assert.deepEqual(m.outside, [], "no control outside the viewport");
      assert.equal(m.header.height, 52, "header is 52px");
      assert.equal(m.toolbar.height, width < 761 ? 48 : 44, "toolbar is 44px (48px on phones)");
      assert.ok(m.toolbar.top === m.header.bottom, "toolbar sits directly under the header");
      assert.ok(m.canvas.top - m.toolbar.bottom <= 1, "canvas begins right under the toolbar");
      if (width === 375) assert.ok(m.canvas.top <= 112, `phone top chrome ≤ 112px (${m.canvas.top})`);
      const title = header(page).getByRole("heading", { level: 1 });
      assert.ok((await title.boundingBox()).width >= 60, "the title keeps readable room");
      assert.equal(await header(page).getByRole("button", { name: "Publish" }).isVisible(), true, "owner sees Publish");
      assert.equal(await page.getByRole("combobox", { name: "Preview page" }).isVisible(), true, "the page selector stays in the toolbar");
      // Passive facts are not chips in the header.
      assert.equal(await header(page).locator(".version-facts").isVisible(), false, "saved/checked/live facts live in the project details");
      await capture(page, `saved-website-${width}x${height}`);
    });

    await scenario("large-screen scaling on (MAKEBORNE_UI_SCALE, data-ui-scale) at 2560x1440: the chrome scales by --ui-zoom and the editor still fits the screen", { width: 2560, height: 1440 }, async page => {
      await page.evaluate(() => document.documentElement.setAttribute("data-ui-scale", "on"));
      await ready(page); await frame(page);
      await page.waitForTimeout(150);
      const zoom = await page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue("--ui-zoom")));
      assert.equal(zoom, 1.6, "2560x1440 scales by 1.6");
      const m = await measure(page);
      assert.equal(m.overflowX, 0, "no horizontal page scroll"); assert.deepEqual(m.outside, [], "no control outside the viewport");
      assert.ok(Math.abs(m.header.height - 52 * zoom) <= 2, `header scales (${m.header.height})`);
      const fit = await page.evaluate(() => ({ bottom: document.querySelector(".workbench-layout").getBoundingClientRect().bottom, inner: innerHeight, scroll: document.documentElement.scrollHeight - innerHeight }));
      assert.ok(fit.bottom <= fit.inner + 1, `the editor ends inside the screen (${Math.round(fit.bottom)} of ${fit.inner})`);
      assert.ok(fit.scroll <= 1, `no vertical page scroll (${fit.scroll})`);
      await capture(page, "saved-website-2560x1440-scaled");
    });

    await scenario("project details: facts and the live address in one popover; Escape, outside click and Tab out close it; focus returns", { live: 2 }, async page => {
      await ready(page);
      const button = header(page).getByRole("button", { name: "Ovenbird Bakehouse" });
      assert.equal(await button.getAttribute("aria-expanded"), "false");
      await button.focus(); await page.keyboard.press("Enter");
      const details = page.getByRole("group", { name: "Project details" });
      await details.waitFor();
      await details.getByText("Live version 2", { exact: true }).waitFor();
      // editor-quality adds what the Preview tab shows as the fourth fact (version-facts.tsx).
      assert.deepEqual(await details.getByRole("list", { name: "Saved, checked, live and preview versions" }).locator("li").allInnerTexts(), ["Saved version 3", "Not checked yet", "Live version 2", "Preview: version 3"]);
      assert.match(await details.locator(".version-facts-notice").innerText(), /version 3 is saved, version 2 is live/);
      const link = details.getByRole("link", { name: /sites\.makeborne\.com\/ovenbird-test/ });
      assert.equal(await link.getAttribute("href"), "https://sites.makeborne.com/ovenbird-test");
      assert.equal(await link.getAttribute("rel"), "noopener noreferrer");
      await capture(page, "details-open-1440");
      await page.keyboard.press("Escape");
      await details.waitFor({ state: "hidden" });
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Ovenbird Bakehouse", "Escape returns focus to the title");
      await button.click(); await details.waitFor();
      await page.mouse.click(900, 600);
      await details.waitFor({ state: "hidden" });
      // A click inside the preview frame (its events never reach the editor document) closes it too.
      await frame(page);
      await button.click(); await details.waitFor();
      const canvas = await page.locator('iframe[title="Website preview"]').boundingBox();
      await page.mouse.click(canvas.x + canvas.width - 40, canvas.y + canvas.height - 40);
      await details.waitFor({ state: "hidden" });
      if (engineLabel === "WebKit") console.log("SKIP Tab out of the details popover is a chromium/firefox-only measurement (WebKit's default Tab order skips links and buttons)");
      else {
        await button.click(); await details.waitFor();
        await link.focus(); await page.keyboard.press("Tab");
        await details.waitFor({ state: "hidden" });
      }
    });

    await scenario("not published: details say Not live and show no address", { live: 0 }, async page => {
      await ready(page);
      await header(page).getByRole("button", { name: "Ovenbird Bakehouse" }).click();
      const details = page.getByRole("group", { name: "Project details" });
      await details.getByText("Not live", { exact: true }).waitFor();
      assert.equal(await details.getByRole("link").count(), 0);
    });

    await scenario("Project actions: Enter, ArrowDown, Home/End, Escape; History opens and is named in the toolbar; focus returns to the menu button", {}, async page => {
      await ready(page);
      const more = header(page).getByRole("button", { name: "Project actions" });
      await more.focus(); await page.keyboard.press("ArrowDown");
      const menu = page.getByRole("group", { name: "Project actions" });
      await menu.waitFor();
      await page.waitForFunction(() => document.activeElement?.textContent === "Version history");
      await page.keyboard.press("End");
      assert.match(await page.evaluate(() => document.activeElement?.textContent), /Download source/);
      await page.keyboard.press("Home");
      await page.keyboard.press("ArrowDown");
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Client review");
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "hidden" });
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Project actions");
      await page.keyboard.press("Enter"); await menu.waitFor();
      await menu.getByRole("button", { name: "Version history" }).click();
      await page.getByRole("region", { name: "Project version history" }).waitFor();
      await menu.waitFor({ state: "hidden" });
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Project actions", "choosing an action returns focus to the menu button");
      assert.equal(await toolbar(page).locator(".editor-view-current").innerText(), "Version history");
      assert.equal(await toolbar(page).getByRole("button", { name: "Preview" }).getAttribute("aria-pressed"), "false");
      await toolbar(page).getByRole("button", { name: "Preview" }).click();
      await frame(page);
      assert.equal(await toolbar(page).locator(".editor-view-current").count(), 0);
      // The same action is never in two rows: History and Client review are only in the header menu.
      assert.equal(await toolbar(page).getByRole("button", { name: /History|Client review/ }).count(), 0);
    });

    await scenario("source download stays open in its menu and reports its own error", {}, async page => {
      await ready(page);
      await header(page).getByRole("button", { name: "Project actions" }).click();
      const menu = page.getByRole("group", { name: "Project actions" });
      await menu.getByRole("button", { name: "Download source" }).click();
      await menu.getByText("Source download is unavailable in this fixture.").waitFor();
      assert.equal(await menu.isVisible(), true, "the menu stays open to show the result");
    });

    await scenario("Publish opens the publishing workflow and publishes nothing", {}, async (page, { writes }) => {
      await ready(page);
      const publish = header(page).getByRole("button", { name: "Publish" });
      assert.match(await publish.getAttribute("title"), /Nothing goes live until you confirm/);
      await publish.click();
      await page.getByRole("heading", { name: "Publish website" }).waitFor();
      assert.equal(await publish.getAttribute("aria-pressed"), "true");
      assert.equal(await toolbar(page).locator(".editor-view-current").innerText(), "Publish");
      assert.deepEqual(writes, [], "opening Publish sends no request");
    });

    await scenario("toolbar: route and device changes keep the preview in place; Code and back keeps the page", {}, async page => {
      await ready(page); await frame(page);
      const before = await measure(page);
      await page.getByRole("combobox", { name: "Preview page" }).selectOption("/menu");
      await page.waitForFunction(() => document.querySelector(".lp")?.getAttribute("data-preview-path") === "/menu");
      await toolbar(page).getByRole("button", { name: "mobile preview" }).click();
      assert.equal(await toolbar(page).getByRole("button", { name: "mobile preview" }).getAttribute("aria-pressed"), "true");
      const after = await measure(page);
      assert.equal(after.canvas.top, before.canvas.top, "the canvas did not move");
      assert.equal(after.toolbar.height, before.toolbar.height);
      await toolbar(page).getByRole("button", { name: "Code" }).click();
      assert.equal(await toolbar(page).getByRole("combobox", { name: "Preview page" }).count(), 0, "preview controls leave with the preview");
      assert.equal((await measure(page)).toolbar.height, 44, "the toolbar keeps its height in Code");
      await toolbar(page).getByRole("button", { name: "Preview" }).click(); await frame(page);
      assert.equal(await page.getByRole("combobox", { name: "Preview page" }).inputValue(), "/menu", "the page survives a view change");
    });

    await scenario("phone: preview options in one menu (size, path, reload, full screen); choosing a size closes it and returns focus", { width: 375, height: 812 }, async page => {
      await ready(page); await frame(page);
      assert.equal(await toolbar(page).getByRole("button", { name: "desktop preview" }).isVisible(), false, "sizes are not inline on a phone");
      const options = toolbar(page).getByRole("button", { name: "Preview options" });
      for (const target of await page.locator("[data-editor-chrome] button:visible").all()) {
        const box = await target.boundingBox();
        assert.ok(box.height >= 36 && box.width >= 36, `touch target ${await target.getAttribute("aria-label") ?? await target.innerText()} is ${Math.round(box.width)}x${Math.round(box.height)}`);
      }
      await options.click();
      const menu = page.getByRole("group", { name: "Preview options" });
      await menu.getByRole("button", { name: "Go to a page path" }).waitFor();
      assert.equal(await menu.getByText("Phone width").isVisible(), true, "menu items carry visible labels");
      const m = await measure(page);
      assert.equal(m.overflowX, 0, "the open menu causes no horizontal scroll");
      const panel = await menu.boundingBox();
      assert.ok(panel.x >= 0 && panel.x + panel.width <= 375, "the menu fits the screen");
      await capture(page, "phone-preview-options-375");
      await menu.getByRole("button", { name: "mobile preview" }).click();
      await menu.waitFor({ state: "hidden" });
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Preview options");
      await options.click();
      assert.equal(await menu.getByRole("button", { name: "mobile preview" }).getAttribute("aria-pressed"), "true");
      // Widening with the menu open puts the same controls inline; nothing is lost.
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(100);
      assert.equal(await toolbar(page).getByRole("button", { name: "mobile preview" }).isVisible(), true);
      assert.equal(await toolbar(page).getByRole("button", { name: "mobile preview" }).getAttribute("aria-pressed"), "true");
    });

    await scenario("unsaved → saving → saved on an outline book: Save now only while it means something; Saved only after the account confirms", { key: "book", saveDelay: 700 }, async (page, { writes }) => {
      await ready(page, "Field Notes for Small Studios");
      assert.equal(await header(page).getByRole("button", { name: "Publish" }).count(), 0, "books have no Publish");
      assert.equal(await toolbar(page).getByRole("button", { name: "Content" }).count(), 1, "documents edit in Content");
      await toolbar(page).getByRole("button", { name: "Content" }).click();
      const block = page.locator(".account-content-block textarea").first();
      await block.fill("The first draft starts here, and keeps going.");
      assert.equal(await saveState(page), "unsaved");
      const saveNow = header(page).getByRole("button", { name: "Save now" });
      assert.equal(await saveNow.isVisible(), true);
      const before = await measure(page);
      await capture(page, "state-unsaved-1440");
      await page.waitForFunction(() => document.querySelector(".ph-save")?.getAttribute("data-state") === "saving");
      assert.equal(await header(page).getByRole("button", { name: "Save now" }).count(), 0, "no Save button while saving");
      await page.waitForFunction(() => document.querySelector(".ph-save")?.getAttribute("data-state") === "saved");
      assert.equal(writes.filter(item => item.endsWith("/versions")).length, 1, "one save request");
      const after = await measure(page);
      assert.equal(after.header.height, before.header.height); assert.equal(after.canvas.top, before.canvas.top, "status changes don't move the canvas");
      // Unsent text survives a view change.
      await toolbar(page).getByRole("button", { name: "Preview" }).click();
      await page.getByText("Saved preview of Field Notes for Small Studios").waitFor();
      await toolbar(page).getByRole("button", { name: "Content" }).click();
      assert.equal(await page.locator(".account-content-block textarea").first().inputValue(), "The first draft starts here, and keeps going.");
    });

    await scenario("failed save: Save failed stays visible with a primary Retry save; retry saves", { key: "book", save: ["failed", "ok"] }, async page => {
      await ready(page, "Field Notes for Small Studios");
      await toolbar(page).getByRole("button", { name: "Content" }).click();
      await page.locator(".account-content-block textarea").first().fill("Changed text");
      await header(page).getByRole("button", { name: "Save now" }).click();
      await page.waitForFunction(() => document.querySelector(".ph-save")?.getAttribute("data-state") === "failed");
      const retry = header(page).getByRole("button", { name: "Retry save" });
      assert.match(await retry.getAttribute("class"), /is-primary/);
      assert.match(await header(page).locator(".ph-save").innerText(), /Save failed/);
      await capture(page, "state-failed-1440");
      await page.setViewportSize({ width: 375, height: 812 });
      assert.equal(await retry.isVisible(), true, "Retry save stays reachable on a phone");
      assert.equal((await measure(page)).overflowX, 0);
      await capture(page, "state-failed-375");
      await retry.click();
      await page.waitForFunction(() => document.querySelector(".ph-save")?.getAttribute("data-state") === "saved");
    });

    await scenario("unconfirmed save: header says so; the notice below keeps Retry the same save and Download draft", { key: "book", save: "uncertain" }, async page => {
      await ready(page, "Field Notes for Small Studios");
      await toolbar(page).getByRole("button", { name: "Content" }).click();
      await page.locator(".account-content-block textarea").first().fill("Changed text");
      await header(page).getByRole("button", { name: "Save now" }).click();
      await page.waitForFunction(() => document.querySelector(".ph-save")?.getAttribute("data-state") === "unconfirmed");
      const alert = page.getByRole("alert").filter({ hasText: "The last save is not confirmed." });
      await alert.waitFor();
      await alert.getByRole("button", { name: "Retry the same save" }).waitFor();
      await alert.getByRole("button", { name: "Download draft" }).waitFor();
      assert.match(await header(page).locator(".ph-save").innerText(), /Save not confirmed/);
      await capture(page, "state-unconfirmed-1440");
    });

    await scenario("conflict: Save paused in the header, the review notice below, no Save button that would overwrite", { key: "book", save: "conflict" }, async page => {
      await ready(page, "Field Notes for Small Studios");
      await toolbar(page).getByRole("button", { name: "Content" }).click();
      await page.locator(".account-content-block textarea").first().fill("Changed text");
      await header(page).getByRole("button", { name: "Save now" }).click();
      await page.waitForFunction(() => document.querySelector(".ph-save")?.getAttribute("data-state") === "conflict");
      await page.getByRole("alert").filter({ hasText: "Your draft needs a review." }).waitFor();
      assert.equal(await header(page).getByRole("button", { name: /Save now|Retry save/ }).count(), 0);
      await capture(page, "state-conflict-1440");
    });

    await scenario("recovery draft: Draft on this device in the header and Restore/Discard below", { key: "book", recovery: true }, async page => {
      await ready(page, "Field Notes for Small Studios");
      assert.equal(await saveState(page), "recovery");
      await page.getByRole("button", { name: "Restore recovery draft" }).waitFor();
      await page.getByRole("button", { name: "Discard recovery draft" }).waitFor();
    });

    await scenario("running build: one compact label in the toolbar, the header unchanged; Edit waits for the build", { build: { available: true, configured: true, state: "ready" } }, async page => {
      await ready(page); await frame(page);
      const before = await measure(page);
      await page.waitForFunction(() => typeof window.__onLive === "function");
      await page.evaluate(files => window.__onLive({ files, assets: [], building: true }), Object.fromEntries(source.files.map(file => [file.path, file.content])));
      await toolbar(page).getByText("Building live…").waitFor();
      assert.equal(await toolbar(page).getByRole("button", { name: "Edit" }).count(), 0, "click-to-edit is not offered over builder output");
      const during = await measure(page);
      assert.equal(during.header.height, before.header.height); assert.equal(during.toolbar.height, before.toolbar.height); assert.equal(during.canvas.top, before.canvas.top);
      await capture(page, "state-building-1440");
      await page.evaluate(() => window.__onLive(null));
      await page.waitForFunction(() => !document.querySelector("[data-editor-chrome=toolbar]")?.textContent.includes("Building live"));
    });

    await scenario("generation unavailable: the conversation says why; the header and toolbar are the same", { build: { available: false, configured: true, state: "paused" } }, async page => {
      await ready(page); await frame(page);
      await page.getByText("AI building is paused right now.", { exact: false }).waitFor();
      const m = await measure(page);
      assert.equal(m.header.height, 52); assert.equal(m.toolbar.height, 44);
    });

    await scenario("reviewer: View only, no Save, no Publish, no Download source; History and Client review stay available", { role: "reviewer" }, async page => {
      await ready(page);
      assert.equal(await saveState(page), "view-only");
      assert.equal(await header(page).getByRole("button", { name: /Save now|Retry save|Publish/ }).count(), 0);
      await header(page).getByRole("button", { name: "Project actions" }).click();
      const menu = page.getByRole("group", { name: "Project actions" });
      assert.deepEqual(await menu.getByRole("button").allInnerTexts(), ["Version history", "Client review"]);
      assert.equal(await toolbar(page).getByRole("button", { name: "Edit" }).count(), 0, "no click-to-edit for reviewers");
      await capture(page, "reviewer-1440");
    });

    await scenario("editor (not owner): no Publish in the header", { role: "editor" }, async page => {
      await ready(page);
      assert.equal(await header(page).getByRole("button", { name: "Publish" }).count(), 0);
      assert.equal(await saveState(page), "saved");
    });

    await scenario("legacy static website: Code view, no header Publish (its publishing stays in Code), source download in the menu", { key: "legacy" }, async page => {
      await ready(page, "Old Harbour Café");
      assert.equal(await toolbar(page).getByRole("button", { name: "Code" }).count(), 1);
      assert.equal(await header(page).getByRole("button", { name: "Publish" }).count(), 0);
      await header(page).getByRole("button", { name: "Old Harbour Café" }).click();
      await page.getByRole("group", { name: "Project details" }).getByText("Website · static design", { exact: false }).waitFor();
    });

    await scenario("long title: truncated with an ellipsis in one row at 375 and 1440; the full title is in the details", { width: 375, height: 812, title: LONG }, async page => {
      await page.evaluate(([artifact]) => window.mountEditor({ artifact }), [artifactOf("site", 0, LONG)]);
      await ready(page, LONG);
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const m = await measure(page);
        assert.equal(m.header.height, 52); assert.equal(m.overflowX, 0); assert.deepEqual(m.outside, []);
      }
      await header(page).getByRole("button", { name: LONG }).click();
      assert.equal(await page.getByRole("group", { name: "Project details" }).locator(".ph-details-title").innerText(), LONG);
    });

    await scenario("project switching: the header, menus and facts belong to the newly opened project", {}, async page => {
      await ready(page);
      await header(page).getByRole("button", { name: "Project actions" }).click();
      await page.evaluate(([artifact]) => window.mountEditor({ artifact }), [artifactOf("book", 0)]);
      await ready(page, "Field Notes for Small Studios");
      assert.equal(await page.getByRole("group", { name: "Project actions" }).isVisible(), false, "a menu from the previous project is not left open");
      assert.equal(await header(page).getByRole("button", { name: "Publish" }).count(), 0);
      await header(page).getByRole("button", { name: "Field Notes for Small Studios" }).click();
      const details = page.getByRole("group", { name: "Project details" });
      assert.match(await details.innerText(), /Book outline · saved version 2/);
      assert.equal(await details.locator(".version-facts").count(), 0, "no website facts on a book");
    });

    await scenario("Back to projects asks before leaving unsaved edits", { key: "book", saveDelay: 5000 }, async page => {
      await ready(page, "Field Notes for Small Studios");
      await toolbar(page).getByRole("button", { name: "Content" }).click();
      await page.locator(".account-content-block textarea").first().fill("Unsaved words");
      let asked = 0;
      page.once("dialog", dialog => { asked++; return dialog.dismiss(); });
      await header(page).getByRole("button", { name: "Back to projects" }).click();
      assert.equal(asked, 1); assert.equal(await page.evaluate(() => window.__back), 0, "dismissing keeps the draft open");
    });
  } finally { await browser.close(); server.close(); }
  if (shots) fs.writeFileSync(path.join(shots, "metrics.json"), JSON.stringify(metrics, null, 2));
  console.log(`\n${results.filter(item => item.pass).length}/${results.length} editor header scenarios passed in ${engineLabel ?? "chromium"}.`);
  for (const row of metrics) console.log(`  ${row.case} ${row.width}x${row.height}: header ${row.header.height}px, toolbar ${row.toolbar.height}px, canvas y=${row.canvas.top}, ${row.controls} visible controls`);
  if (failures.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
