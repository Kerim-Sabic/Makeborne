/* eslint-disable @typescript-eslint/no-require-imports -- Mounted LivePreview/LiveBuilder in Chromium. The fictional site is bundled by the real in-browser bundler (run in Node);
   every API is a local fixture and every non-localhost request is aborted: no provider, database, cloud or paid call. */
// Usage: node scripts/check-preview-continuity-browser.cjs [--baseline <git-ref>] [--shots <dir>]
// --baseline mounts live-preview.tsx, browser-bundler.ts and live-builder.tsx from <git-ref> instead, to show which audited cases the old code fails.
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs"), Module = require("node:module"), ts = require("typescript");
const { execFileSync, spawnSync } = require("node:child_process");
const { build } = require("esbuild"), { chromium } = require("playwright"), { createServer } = require("node:http");

const root = path.resolve(__dirname, "..");
const argument = name => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : null; };
const baseline = argument("--baseline"), shots = argument("--shots");
const fromBaseline = file => baseline ? execFileSync("git", ["show", `${baseline}:${file}`], { cwd: root, encoding: "utf8" }) : null;
const ids = { actor: "11111111-1111-4111-8111-111111111111", workspace: "22222222-2222-4222-8222-222222222222", artifact: "33333333-3333-4333-8333-333333333333", operation: "44444444-4444-4444-8444-444444444444", run: "55555555-5555-4555-8555-555555555555" };
const ROUTES = [{ path: "/", title: "Home" }, { path: "/collections", title: "Collections" }, { path: "/workshops", title: "Workshops" }];

/** A fictional hash-routed site written the way the builder prompt asks: no router package, "#/page" routes, section anchors with scroll margins. */
const SITE = {
  "index.html": '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stillform — Handmade Ceramics Studio</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
  "src/main.tsx": 'import { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./styles.css";\ncreateRoot(document.getElementById("root")!).render(<App />);\n',
  "src/styles.css": "body{margin:0;font:16px/1.5 system-ui,sans-serif}header{position:sticky;top:0;height:65px;display:flex;gap:12px;align-items:center;padding:0 16px;background:#fff;border-bottom:1px solid #ddd;flex-wrap:wrap}main{padding:16px}.filler{height:1400px;background:linear-gradient(#f4efe9,#e9e1d8)}section[id]{scroll-margin-top:96px}label{display:block;margin:8px 0}\n",
  "src/App.tsx": `import { useEffect, useState, type FormEvent } from "react";
const TITLES: Record<string, string> = { "/": "Stillform — Handmade Ceramics Studio", "/collections": "Collections — Stillform Ceramics", "/workshops": "Workshops — Stillform Ceramics" };
function routeOf(hash: string) { if (!hash || hash === "#" || hash === "#/") return "/"; return hash.startsWith("#/") ? hash.slice(1).split("?")[0] : null; }
function Workshops() {
  const [name, setName] = useState(""), [message, setMessage] = useState(""), [people, setPeople] = useState("1"), [status, setStatus] = useState("Not sent");
  async function submit(event: FormEvent) { event.preventDefault(); try { await fetch("/_mb/enquiries", { method: "POST", body: JSON.stringify({ name, message }), credentials: "omit" }); setStatus("Sent"); } catch { setStatus("Could not send"); } }
  return <><h1>Learn at a long table.</h1><div className="filler" /><form onSubmit={submit} aria-label="Workshop enquiry">
    <label>Name <input name="name" value={name} onChange={event => setName(event.target.value)} /></label>
    <label>Message <textarea name="message" value={message} onChange={event => setMessage(event.target.value)} /></label>
    <label>People <select name="people" value={people} onChange={event => setPeople(event.target.value)}><option>1</option><option>2</option><option>3</option></select></label>
    <button type="submit">Send enquiry</button><p role="status" id="form-status">{status}</p></form></>;
}
export default function App() {
  const [path, setPath] = useState(() => routeOf(location.hash) ?? "/");
  useEffect(() => { const on = () => { const next = routeOf(location.hash); if (next !== null) setPath(next); }; addEventListener("hashchange", on); return () => removeEventListener("hashchange", on); }, []);
  // Like the audited generated site: an unknown route keeps the root title.
  useEffect(() => { document.title = TITLES[path] ?? TITLES["/"]; }, [path]);
  return <><header><strong>Stillform</strong><a href="#/">Home</a><a href="#/collections">Collections</a><a href="#/workshops">Workshops</a><a href="/story">Our story</a><a href="#/journal">Journal</a></header>
    <main>{path === "/" ? <><h1>Handmade ceramics</h1><p>Rev REVISION.</p><div className="filler" /></>
      : path === "/collections" ? <><h1>Collections</h1><div className="filler" /><section id="ash"><h2>Ash</h2><p>Ash-glazed stoneware.</p></section><div className="filler" /></>
      : path === "/workshops" ? <Workshops /> : <><h1>404</h1><p>Page not found</p><a href="#/">Go home</a></>}</main></>;
}
`,
};

/** Load browser-bundler.ts (current or baseline) in Node with its own relative imports. */
function loadBundler() {
  const prepared = spawnSync(process.execPath, ["scripts/prepare-builder-runtime.mjs"], { cwd: root, encoding: "utf8" });
  assert.equal(prepared.status, 0, prepared.stderr);
  const load = Module._load;
  Module._load = function(name, parent, main) {
    if (name === "esbuild-wasm" && /browser-bundler/.test(parent?.filename ?? "")) return { ...load.call(this, name, parent, main), initialize: async () => {} };
    return load.call(this, name, parent, main);
  };
  require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
  const runtime = path.join(root, "public", "builder-runtime"), origin = "http://runtime.test";
  globalThis.location = { origin };
  globalThis.fetch = async url => {
    const file = String(url).startsWith(`${origin}/builder-runtime/`) ? path.join(runtime, String(url).slice(`${origin}/builder-runtime/`.length)) : "";
    return file && fs.existsSync(file) ? new Response(fs.readFileSync(file)) : new Response("missing", { status: 404 });
  };
  const file = path.join(root, "src/lib/builder/browser-bundler.ts");
  if (!baseline) return require(file);
  const old = new Module(file, module);
  old.filename = path.join(root, "src/lib/builder/browser-bundler.baseline.ts"); old.paths = Module._nodeModulePaths(path.dirname(file));
  old._compile(ts.transpileModule(fromBaseline("src/lib/builder/browser-bundler.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, old.filename);
  return old.exports;
}

async function fixtureBundle() {
  const swapped = { "live-preview": "src/components/live-preview.tsx", "live-builder": "src/components/live-builder.tsx" };
  const contents = `import React from "react";import{createRoot}from"react-dom/client";import LivePreview from"./src/components/live-preview";import LiveBuilder from"./src/components/live-builder";
const query=new URLSearchParams(location.search);
function Preview(){const[files,setFiles]=React.useState({rev:"1"});React.useEffect(()=>{window.test={setFiles};},[]);
 return <div style={{height:"100vh",display:"flex",flexDirection:"column"}}><textarea aria-label="Message the builder" rows={1}/><LivePreview files={files} assets={[]} scope={{accountId:"${ids.actor}",workspaceId:"${ids.workspace}",artifactId:"${ids.artifact}"}} routes={${JSON.stringify(ROUTES)}} syncUrl responseTimeoutMs={Number(query.get("timeout"))||10000}/></div>;}
function Builder(){return <LiveBuilder accountId="${ids.actor}" workspaceId="${ids.workspace}" artifactId="${ids.artifact}" version={1} history={[]} baseFiles={{}} baseAssets={[]} defaultEffort="light" kind="book" onLive={()=>{}} onSaved={()=>{}}/>;}
createRoot(document.getElementById("root")).render(location.pathname==="/builder"?<Builder/>:<Preview/>);`;
  const output = await build({ stdin: { contents, loader: "jsx", resolveDir: root }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, logLevel: "silent", plugins: [{ name: "fixture", setup(b) {
    b.onResolve({ filter: /browser-bundler$|cloud-api$|design-capture$/ }, args => ({ path: args.path, namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ loader: "js", contents: `
      export async function bundleProject(files){
        if(window.__transportFail>0){window.__transportFail--;return{ok:false,kind:"transport",error:"Runtime file unavailable: /builder-runtime/vendor/react.js"};}
        if(window.__silent)return{ok:true,html:"<!doctype html><html><head></head><body><p>No runtime</p></body></html>"};
        const html=await (await fetch("/site.html",{cache:"no-store"})).text();return{ok:true,html:html.split("REVISION").join(files.rev)};}
      export async function readCloudImage(){throw Error("No assets in this fixture")}
      export async function captureDesign(){throw Error("Unexpected capture")}` }));
    if (baseline) b.onResolve({ filter: /\.\/src\/components\/live-(preview|builder)$/ }, args => ({ path: swapped[args.path.endsWith("preview") ? "live-preview" : "live-builder"], namespace: "baseline" }));
    b.onLoad({ filter: /.*/, namespace: "baseline" }, args => ({ contents: fromBaseline(args.path), loader: "tsx", resolveDir: path.join(root, "src/components") }));
    b.onResolve({ filter: /^@\// }, args => { const base = path.resolve(root, "src", args.path.slice(2)); return { path: fs.existsSync(base) ? base : fs.existsSync(base + ".tsx") ? base + ".tsx" : base + ".ts" }; });
    b.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
  } }] });
  return output.outputFiles[0].contents;
}

async function main() {
  const bundler = loadBundler();
  const site = await bundler.bundleProject(SITE, {}, "preview");
  assert.equal(site.ok, true, site.error);
  const script = await fixtureBundle();
  const css = fs.readFileSync(path.join(root, "src/app/live-builder.css"), "utf8");
  const enquiries = [], foreign = [], apiRequests = [];
  let builderState = null;
  const json = (res, value, status = 200) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(value)); };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/fixture.js") { res.setHeader("content-type", "text/javascript"); res.end(script); return; }
    if (url.pathname === "/site.html") { res.setHeader("content-type", "text/html"); res.end(site.html); return; }
    if (url.pathname.startsWith("/api/")) apiRequests.push(req.method + " " + url.pathname);
    if (url.pathname.startsWith("/_mb/")) { enquiries.push(req.method + " " + url.pathname); json(res, { ok: true }); return; }
    if (url.pathname === "/api/credits") return json(res, { available: 500, unlimited: false });
    if (url.pathname === "/api/build/questions") return json(res, { questions: [] });
    if (url.pathname === "/api/build/plan") return json(res, { stored: null });
    if (url.pathname === "/api/build/operations") { builderState.requests.push(req.method); return builderState.operation ? json(res, { operation: builderState.operation, result: builderState.result, recovery: builderState.recovery }) : json(res, { error: { message: "Not recorded" } }, 404); }
    if (url.pathname.startsWith("/api/")) { foreign.push(req.method + " " + url.pathname); json(res, { error: { message: "Not in fixture" } }, 404); return; }
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Editor · Stillform</title><style>body{margin:0;font:14px sans-serif}*{box-sizing:border-box}.button{border:1px solid #ccc;border-radius:8px;padding:4px 10px;background:#fff}${css}</style><div id="root"></div><script src="/fixture.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const editor = `${base}/studio?tab=projects&workspace=${ids.workspace}&artifact=${ids.artifact}`;
  const browser = await chromium.launch({ headless: true });
  const results = [];
  if (shots) fs.mkdirSync(shots, { recursive: true });

  async function open(width, height = 900, url = editor) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(8000);
    page.on("pageerror", error => errors.push(error.message));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/))/, route => { foreign.push(route.request().url()); return route.abort(); });
    await page.goto(url);
    return { context, page, errors, frame: page.frameLocator('iframe[title="Website preview"]') };
  }
  const section = page => page.locator('section[aria-label="Website preview"]');
  const previewPath = async page => section(page).getAttribute("data-preview-path");
  const titled = (page, title) => page.waitForFunction(value => document.querySelector('section[aria-label="Website preview"]')?.dataset.previewTitle === value, title);
  const paramIs = (page, value) => page.waitForFunction(expected => new URL(location.href).searchParams.get("preview-path") === expected, value);
  const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
  async function check(name, fn) {
    try { await fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
    catch (error) {
      const line = (String(error.stack).match(/check-preview-continuity-browser\.cjs:(\d+)/) ?? [])[1];
      const message = `${String(error.message).split("\n")[0]}${line ? ` (line ${line})` : ""}`;
      results.push({ name, ok: false, error: message }); console.log(`${baseline ? "BASELINE FAIL" : "FAIL"} ${name}: ${message}`);
    }
  }

  try {
    for (const width of [1440, 375]) {
      await check(`${width}px picker → page, in-site link, Back/Forward keep page, title and unsent form draft`, async () => {
        const { context, page, errors, frame } = await open(width);
        try {
          await frame.locator("h1", { hasText: "Handmade ceramics" }).waitFor();
          const picker = page.getByRole("combobox", { name: "Preview page" });
          await picker.focus(); await picker.selectOption("/workshops");
          await frame.locator("h1", { hasText: "Learn at a long table." }).waitFor();
          assert.equal(await picker.evaluate(element => element === document.activeElement), true, "choosing a page keeps focus on the picker");
          await page.waitForFunction(() => new URL(location.href).searchParams.get("preview-path") === "/workshops");
          const query = new URL(page.url()).searchParams;
          assert.equal(query.get("tab"), "projects"); assert.equal(query.get("workspace"), ids.workspace); assert.equal(query.get("artifact"), ids.artifact);
          await titled(page, "Workshops — Stillform Ceramics");
          assert.equal(await page.title(), "Editor · Stillform", "editor title stays separate from the page title");
          await frame.getByLabel("Name").fill("Fictional Navigation Probe");
          await frame.getByLabel("Message").fill("UNSENT NAVIGATION DRAFT — no enquiry submitted.");
          await frame.getByLabel("People").selectOption("3");
          await shot(page, `${width}-workshops-draft`);
          await frame.getByRole("link", { name: "Collections" }).click();
          await frame.locator("h1", { hasText: "Collections" }).waitFor();
          await page.waitForFunction(() => new URL(location.href).searchParams.get("preview-path") === "/collections");
          assert.equal(await picker.inputValue(), "/collections", "picker follows in-site navigation");
          await page.evaluate(() => history.back());
          await frame.locator("h1", { hasText: "Learn at a long table." }).waitFor();
          await page.waitForFunction(() => new URL(location.href).searchParams.get("preview-path") === "/workshops");
          assert.equal(await picker.inputValue(), "/workshops");
          await page.waitForFunction(() => document.querySelector(".lp-notice")?.textContent.includes("unsent form"));
          assert.equal(await frame.getByLabel("Name").inputValue(), "Fictional Navigation Probe", "Back keeps the unsent name");
          assert.equal(await frame.getByLabel("Message").inputValue(), "UNSENT NAVIGATION DRAFT — no enquiry submitted.");
          assert.equal(await frame.getByLabel("People").inputValue(), "3");
          assert.equal(await frame.locator("#form-status").innerText(), "Not sent");
          await page.evaluate(() => history.forward());
          await frame.locator("h1", { hasText: "Collections" }).waitFor();
          await page.waitForFunction(() => new URL(location.href).searchParams.get("preview-path") === "/collections");
          await titled(page, "Collections — Stillform Ceramics");
          assert.equal(enquiries.length, 0); assert.deepEqual(errors, []);
        } finally { await context.close(); }
      });
    }

    await check("direct /collections#ash lands below the sticky header and survives editor reload and rebuild", async () => {
      const { context, page, errors, frame } = await open(1440, 900, `${editor}&preview-path=${encodeURIComponent("/collections#ash")}`);
      try {
        await frame.locator("h1", { hasText: "Collections" }).waitFor();
        const landed = async () => frame.locator("#ash").evaluate(element => element.getBoundingClientRect().top);
        for (let i = 0; i < 40 && Math.abs(await landed() - 96) > 2; i++) await page.waitForTimeout(50);
        assert.ok(Math.abs(await landed() - 96) <= 2, `target top ${await landed()} equals its 96px scroll margin`);
        assert.equal(await previewPath(page), "/collections#ash");
        await paramIs(page, "/collections#ash");
        await page.reload();
        await frame.locator("h1", { hasText: "Collections" }).waitFor();
        for (let i = 0; i < 40 && Math.abs(await landed() - 96) > 2; i++) await page.waitForTimeout(50);
        assert.ok(Math.abs(await landed() - 96) <= 2, "reload restores the fragment target");
        await titled(page, "Collections — Stillform Ceramics");
        await frame.getByRole("link", { name: "Workshops" }).click();
        await frame.locator("h1", { hasText: "Learn at a long table." }).waitFor();
        await page.waitForFunction(() => new URL(location.href).searchParams.get("preview-path") === "/workshops");
        const before = await page.evaluate(() => history.length);
        await page.evaluate(() => window.test.setFiles({ rev: "2" }));
        await page.waitForFunction(() => document.querySelector('iframe[title="Website preview"]')?.srcdoc.includes("Rev 2."));
        await frame.locator("h1", { hasText: "Learn at a long table." }).waitFor();
        assert.equal(await page.evaluate(() => history.length), before, "a rebuilt preview adds no browser history entry");
        assert.equal(await previewPath(page), "/workshops", "a rebuild keeps the page");
        await page.evaluate(() => history.back());
        await frame.locator("h1", { hasText: "Collections" }).waitFor();
        for (let i = 0; i < 40 && Math.abs(await landed() - 96) > 2; i++) await page.waitForTimeout(50);
        assert.ok(Math.abs(await landed() - 96) <= 2, "Back after a rebuild returns to the earlier page and target");
        assert.equal(await previewPath(page), "/collections#ash");
        assert.equal(page.frames().some(item => item.url().startsWith("chrome-error:")), false, "Back never shows a broken frame");
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    for (const width of [1440, 320]) {
      await check(`${width}px missing path shows Page not found with its own title and a keyboard way home`, async () => {
        const { context, page, errors, frame } = await open(width);
        try {
          await frame.locator("h1", { hasText: "Handmade ceramics" }).waitFor();
          await page.getByRole("button", { name: "Go to a page path" }).click();
          const input = page.getByLabel("Page path", { exact: true });
          await input.fill("/research-missing-route"); await input.press("Enter");
          const panel = page.getByRole("region", { name: "Page not found" });
          await panel.waitFor();
          assert.equal(await section(page).getAttribute("data-preview-title"), "Page not found", "never the home page title");
          await paramIs(page, "/research-missing-route");
          assert.equal(await page.locator('iframe[title="Website preview"]').isHidden(), true);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "not-found state fits the width");
          await shot(page, `${width}-missing-page`);
          const home = panel.getByRole("button", { name: "Go to the home page" });
          await home.focus(); await page.keyboard.press("Enter");
          await panel.waitFor({ state: "detached" });
          await frame.locator("h1", { hasText: "Handmade ceramics" }).waitFor();
          await paramIs(page, null);
          await page.evaluate(() => history.back());
          await panel.waitFor();
          await page.evaluate(() => history.forward());
          await panel.waitFor({ state: "detached" });
          await frame.getByRole("link", { name: "Journal" }).click();
          await panel.waitFor();
          assert.equal(await previewPath(page), "/journal", "an unknown in-site route is recognised as missing");
          await panel.getByRole("button", { name: /Collections/ }).click();
          await frame.locator("h1", { hasText: "Collections" }).waitFor();
          await frame.getByRole("link", { name: "Our story" }).click();
          await panel.waitFor();
          assert.equal(await previewPath(page), "/story", "a link to an unsaved path shows the not-found state");
          assert.deepEqual(foreign.filter(item => item.includes("/api/build")), [], "no generation requested");
          assert.deepEqual(errors, []);
        } finally { await context.close(); }
      });
    }

    await check("form submission and site network requests never leave the editor preview", async () => {
      const { context, page, errors, frame } = await open(1440, 900, `${editor}&preview-path=%2Fworkshops`);
      try {
        await frame.getByLabel("Name").fill("Fictional"); await frame.getByRole("button", { name: "Send enquiry" }).click();
        await page.waitForFunction(() => document.querySelector(".lp-notice")?.textContent.includes("Nothing was sent"));
        await frame.locator("#form-status", { hasText: "Could not send" }).waitFor();
        assert.equal(enquiries.length, 0, "no enquiry request reached any server");
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await check("transport failure offers Try again, re-renders the same page and confirms content returned", async () => {
      const { context, page, errors, frame } = await open(1440, 900, `${editor}&preview-path=%2Fcollections`);
      try {
        await frame.locator("h1", { hasText: "Collections" }).waitFor();
        await page.evaluate(() => { window.__transportFail = 1; });
        await page.getByRole("button", { name: "Reload preview" }).click();
        const alert = page.getByRole("alert");
        await alert.filter({ hasText: "Preview connection lost" }).waitFor();
        assert.equal(await page.getByRole("status").filter({ hasText: "Preview connection lost" }).count(), 1, "the state is labelled in the preview bar");
        const chat = page.getByRole("textbox", { name: "Message the builder" });
        await chat.fill("Editor and chat keep working"); assert.equal(await chat.inputValue(), "Editor and chat keep working");
        assert.equal(await page.getByRole("button", { name: "mobile preview" }).isEnabled(), true);
        const apiBefore = apiRequests.length;
        assert.equal(await page.getByText("The site has a build error").count(), 0, "a connection problem is not shown as a build error");
        assert.equal(await page.getByRole("button", { name: "Fix it" }).count(), 0, "no AI repair is offered for a connection problem");
        await shot(page, "1440-transport-retry");
        await page.getByRole("button", { name: "Try again" }).click();
        await page.waitForFunction(() => document.querySelector(".lp-notice")?.textContent.includes("Preview reconnected"));
        await frame.locator("h1", { hasText: "Collections" }).waitFor();
        assert.equal(await previewPath(page), "/collections");
        assert.equal(apiRequests.length, apiBefore, "Try again makes no API, generation or credit request");
        await page.evaluate(() => { window.__silent = true; });
        await page.getByRole("button", { name: "Reload preview" }).click();
        await alert.filter({ hasText: "did not respond" }).waitFor({ timeout: 15000 });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    const snapshot = (overrides) => ({ id: ids.operation, revision: 3, kind: "build", effort: "light", authorizedCredits: 20, chargedCredits: 20, reservedCredits: 0, remainingCredits: 0, maximumAdditionalCredits: 20,
      status: "paused", cancelRequested: false, pendingKind: "continuation", lastVersion: 1, canContinue: true, recoverable: false, expiresAt: "2030-01-01T00:00:00Z", ...overrides });
    const states = {
      running: { operation: snapshot({ status: "running", reservedCredits: 20, chargedCredits: 2, canContinue: false }), phase: "Running", present: ["Stop"], absent: ["Approve allowance & continue", "Preview retained draft"] },
      stopped: { operation: snapshot({ status: "cancelled", cancelRequested: true, canContinue: false, maximumAdditionalCredits: 0, chargedCredits: 3, recoverable: true }), recovery: { runId: ids.run, candidate: { files: {} } }, phase: "Stopped", present: ["Preview retained draft", "Check saved result & charge"], absent: ["Approve allowance & continue", "Stop"] },
      paused: { operation: snapshot({}), phase: "Paused at its allowance", present: ["Approve allowance & continue", "Check saved result & charge"], absent: ["Preview retained draft", "Stop"] },
    };
    for (const [name, state] of Object.entries(states)) {
      await check(`${name} request keeps its own label and stated effect after reload; busy guards stay`, async () => {
        builderState = { operation: state.operation, result: { version: 1, charged: state.operation.chargedCredits, finished: name !== "paused" }, recovery: state.recovery ?? null, requests: [] };
        const context = await browser.newContext({ viewport: { width: 375, height: 900 } });
        await context.addInitScript(([key, value]) => sessionStorage.setItem(key, value), [`makeborne:operation:v1:${ids.actor}:${ids.workspace}:${ids.artifact}:build`, JSON.stringify({ actionKey: ids.run, id: ids.operation })]);
        const page = await context.newPage(), errors = []; page.setDefaultTimeout(8000); page.on("pageerror", error => errors.push(error.message));
        await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/))/, route => { foreign.push(route.request().url()); return route.abort(); });
        try {
          for (const round of ["first", "reload"]) {
            if (round === "first") await page.goto(`${base}/builder`); else await page.reload();
            const region = page.getByRole("region", { name: "Request allowance" });
            await region.getByText(`${state.phase}.`, { exact: true }).waitFor();
            for (const label of state.present) assert.equal(await page.getByRole("button", { name: label, exact: true }).count(), 1, `${label} offered (${round})`);
            for (const label of state.absent) assert.equal(await page.getByRole("button", { name: label, exact: true }).count(), 0, `${label} not offered (${round})`);
            if (name === "running") {
              const stop = page.getByRole("button", { name: "Stop", exact: true });
              const described = await stop.evaluate(element => document.getElementById(element.getAttribute("aria-describedby"))?.textContent ?? "");
              assert.match(described, /Stop ends request 44444444\. Confirmed usage is charged and unused credits are returned\. Version 1 stays as saved/);
              assert.equal(await page.getByRole("textbox", { name: "Message the builder" }).isDisabled(), true, "composer stays disabled while the request runs");
              assert.equal(await page.getByRole("button", { name: "Send" }).count(), 0, "no queued follow-up can be sent");
              await region.getByText(/Follow-ups are not queued/).waitFor();
            }
            if (name === "paused") {
              const approve = page.getByRole("button", { name: "Approve allowance & continue" });
              const described = await approve.evaluate(element => document.getElementById(element.getAttribute("aria-describedby"))?.textContent ?? "");
              assert.match(described, /Continue keeps request 44444444 and its original files, starting from version 1\. It authorizes up to 20 credits more \(new maximum 40 credits\)\. No new message is sent\./);
            }
            if (name === "stopped") { await region.getByText(/You stopped request 44444444\. It can't be continued\. Its retained draft can still be reviewed/).waitFor(); await region.getByText(/makes no AI call and uses no credits\. Saving adds version 2/).waitFor(); }
            const check = page.getByRole("button", { name: "Check saved result & charge" });
            if (await check.count()) assert.match(await check.evaluate(element => document.getElementById(element.getAttribute("aria-describedby"))?.textContent ?? ""), /never starts, repeats or charges anything/);
            await shot(page, `375-builder-${name}-${round}`);
          }
          assert.deepEqual(builderState.requests.filter(method => method !== "GET"), [], "loading and reloading only read the recorded operation");
          assert.deepEqual(errors, []);
        } finally { await context.close(); }
      });
    }
    for (const width of [375, 320]) {
      await check(`${width}px phone conversation sheet: Escape collapses it and returns focus to its toggle; the preview stays usable`, async () => {
        builderState = { operation: states.paused.operation, result: null, recovery: null, requests: [] };
        const context = await browser.newContext({ viewport: { width, height: 760 } });
        const page = await context.newPage(), errors = []; page.setDefaultTimeout(8000); page.on("pageerror", error => errors.push(error.message));
        await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/))/, route => { foreign.push(route.request().url()); return route.abort(); });
        try {
          await page.goto(`${base}/builder`);
          const toggle = page.locator(".workbench-chat-toggle");
          await toggle.focus(); await page.keyboard.press("Enter");
          assert.equal(await toggle.getAttribute("aria-expanded"), "true");
          assert.equal(await page.evaluate(() => document.querySelectorAll("[inert]").length), 0, "an inline sheet makes nothing inert");
          await page.keyboard.press("Escape");
          assert.equal(await toggle.getAttribute("aria-expanded"), "false", "Escape collapses the sheet");
          assert.equal(await toggle.evaluate(element => element === document.activeElement), true, "focus returns to the toggle");
          assert.equal(await toggle.evaluate(element => getComputedStyle(element).outlineStyle !== "none"), true, "returned focus is visible");
          await page.keyboard.press("Enter");
          const composer = page.getByRole("textbox", { name: "Message the builder" });
          await composer.focus(); await composer.fill("draft"); await page.keyboard.press("Escape");
          assert.equal(await toggle.getAttribute("aria-expanded"), "true", "Escape while typing never collapses the sheet");
          assert.equal(await composer.inputValue(), "draft");
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          await shot(page, `${width}-builder-sheet`);
          assert.deepEqual(errors, []);
        } finally { await context.close(); }
      });
    }
    assert.deepEqual(foreign.filter(item => !/\/api\/build\/(questions|plan)/.test(item)), [], "no non-local request was attempted");
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

  const failed = results.filter(result => !result.ok);
  if (baseline) {
    console.log(`Baseline ${baseline}: ${failed.length} of ${results.length} audited cases fail on the old code.`);
    if (!failed.length) process.exitCode = 1;
    return;
  }
  console.log(`${results.length - failed.length}/${results.length} preview continuity and action-semantics scenarios passed; no paid calls.`);
  if (failed.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
