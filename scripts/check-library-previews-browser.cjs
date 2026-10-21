/* eslint-disable @typescript-eslint/no-require-imports -- Mounted AccountProjects library in Chromium with controllable mock auth, cloud API and card-preview API (audit M06). Local only; every non-127.0.0.1 request is aborted.
 * Run: node scripts/check-library-previews-browser.cjs            (current component)
 *      node scripts/check-library-previews-browser.cjs --baseline 6b78269   (pre-change component; expected to fail) */
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), { execFileSync } = require("node:child_process");
const { build } = require("esbuild"), { browserType, engineLabel } = require("./browser-engine.cjs"), { createServer } = require("node:http"), ts = require("typescript"), Module = require("node:module");

const root = path.join(__dirname, "..");
const baseline = process.argv.includes("--baseline") ? process.argv[process.argv.indexOf("--baseline") + 1] : null;
const timeout = baseline ? 2500 : 10000;

// Real document fixtures through the app's own schemas (no network, no generation).
const load = Module._load;
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const { emptyDocument } = require(path.join(root, "src/lib/documents/editor.ts"));
const { DeckSchema, BookSchema } = require(path.join(root, "src/lib/documents/schema.ts"));
const deck = DeckSchema.parse({ ...emptyDocument("deck", "Harbour Pitch"), slides: [
  { id: "s1", layout: "cover", title: "HARBOUR OPENING SLIDE", notes: "Open." },
  { id: "s2", layout: "statement", title: "SECOND SLIDE ONLY", notes: "Next." }] });
const book = BookSchema.parse({ ...emptyDocument("book", "MOSS COVER TITLE"), subtitle: "Field notes", chapters: [] });
const fixtures = { deck, book };

const ids = {
  A: "aaaaaaaa-0000-4000-8000-000000000001", B: "bbbbbbbb-0000-4000-8000-000000000002",
  W1: "11111111-0000-4000-8000-000000000001", W2: "22222222-0000-4000-8000-000000000002", WB: "33333333-0000-4000-8000-000000000003",
};
const fixture = `import React, { useState } from "react"; import { createRoot } from "react-dom/client";
import AccountProjects from "./src/components/account-projects";
function App() {
  const [target, setTarget] = useState(null); const [filter, setFilter] = useState("all"); const [search, setSearch] = useState(""); const [slot, setSlot] = useState(null);
  window.setFilter = setFilter; window.setTarget = setTarget;
  return <main style={{ width: window.mainWidth ?? "auto" }}><button id="before">Before</button><input id="search" aria-label="Search projects" value={search} onChange={event => setSearch(event.target.value)} />
    {window.withSlot && <div id="toolbar" ref={setSlot} />}
    <AccountProjects search={search} filter={filter} onClearSearch={() => { setSearch(""); document.getElementById("search").focus(); }} target={target} navigate={route => { window.navigations.push(route); setTarget(route && route.artifactId ? null : route); }} onStatus={() => {}} {...(window.withSlot ? { controlsSlot: slot } : {})} /><button id="after">After</button></main>;
}
window.navigations = []; window.apiCalls = []; window.metaCalls = []; window.previewRequests = []; window.captureCalls = [];
createRoot(document.getElementById("root")).render(<App />);`;

const mocks = {
  // Supabase auth: the test decides who is signed in and can switch account.
  "supabase-client": `export function createClient() { return { auth: { onAuthStateChange(cb) { window.authCallback = cb; setTimeout(() => cb("INITIAL_SESSION", window.session), 0); return { data: { subscription: { unsubscribe() {} } } }; } } }; }`,
  "cloud-api": `export function setCloudAccount(id) { window.cloudAccount = id; }
export class CloudError extends Error { constructor(status, message) { super(message); this.status = status; } }
window.CloudError = CloudError;
export async function api(path, body, method = "POST") { const verb = body ? method : "GET"; window.apiCalls.push({ account: window.cloudAccount, path, verb, body: body ? JSON.parse(JSON.stringify(body)) : undefined }); await new Promise(r => setTimeout(r, 5));
  if (verb !== "GET") { const answer = await window.resolveWrite(window.cloudAccount, path, body); if (answer instanceof Error) throw answer; return JSON.parse(JSON.stringify(answer)); }
  const data = window.resolveApi(window.cloudAccount, path); if (!data) throw new CloudError(404, "This workspace is unavailable."); return JSON.parse(JSON.stringify(data)); }
export function cloudAccountGuard() { return () => {}; }
export async function readCloudImage() { throw new Error("no images in this fixture"); }`,
  "pending-cloud-writes": `export default function PendingCloudWrites() { return null; }`,
  // Card previews: every request is visible to the test and settled explicitly (or automatically).
  "card-preview-api": `export class CardPreviewError extends Error { constructor(status, message) { super(message); this.status = status; } }
export function readCardPreview(request, signal) { return new Promise((resolve, reject) => {
  const entry = { request, resolve, reject, signal, settled: false, aborted: false }; window.previewRequests.push(entry);
  window.maxOutstanding = Math.max(window.maxOutstanding ?? 0, window.previewRequests.filter(item => !item.settled && !item.aborted).length);
  // Like fetch, an aborted read rejects, unless the test simulates an answer racing the abort.
  signal.addEventListener("abort", () => { entry.aborted = true; if (!window.ignoreAbort && !entry.settled) { entry.settled = true; reject(new DOMException("Aborted", "AbortError")); } });
  if (window.autoPreview) { const answer = window.autoPreview(request); if (answer) { entry.settled = true; setTimeout(() => answer instanceof Error ? reject(answer) : resolve(answer), 0); } }
}); }
export async function readCardCaptureSource(request) { window.captureCalls.push({ kind: "source", request }); return window.captureSource(request); }
export async function saveCardCapture(request, capture, result) { window.captureCalls.push({ kind: "save", request, capture, result }); return window.captureSaved(request, capture, result); }
export async function readCardImage() { throw new Error("no images"); }
export async function readCardMeta(accountId, workspaceId, ids) { window.metaCalls.push({ accountId, workspaceId, ids }); const answer = await (window.cardMeta ? window.cardMeta(accountId, workspaceId, ids) : []); if (answer instanceof Error) throw answer; return answer; }`,
  "publish-snapshot": `export async function captureProjectSnapshot(source) { window.captureCalls.push({ kind: "compile", files: source.files.length }); return '<!doctype html><html><head><style>h1{font:60px serif}</style></head><body><h1>CAPTURED HOME PAGE</h1><script>parent.compromised=1</script></body></html>'; }`,
  "cloud-studio": `export function CloudEditor() { return null; }`,
  "next-dynamic": `export default function dynamic() { return function Editor() { return null; }; }`,
  "next-link": `import React from "react"; export default function Link({ href, children, ...rest }) { return React.createElement("a", { href, ...rest }, children); }`,
};
const mockFor = request => /supabase\/client$/.test(request) ? "supabase-client" : /(^|\/)cloud-api$/.test(request) ? "cloud-api" : /pending-cloud-writes$/.test(request) ? "pending-cloud-writes"
  : /card-preview-api$/.test(request) ? "card-preview-api" : /publish-snapshot$/.test(request) ? "publish-snapshot" : /(^|\/)cloud-studio$/.test(request) ? "cloud-studio" : request === "next/dynamic" ? "next-dynamic" : request === "next/link" ? "next-link" : null;
function resolveSrc(request) {
  for (const candidate of [request, `${request}.ts`, `${request}.tsx`, path.join(request, "index.ts")]) if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  throw new Error(`unresolved ${request}`);
}

// Page-side helpers: listing data per account and preview answers.
const helpers = `
window.ids = ${JSON.stringify(ids)}; window.fixtures = ${JSON.stringify(fixtures)};
const now = "2026-10-20T10:00:00.000Z";
window.artifact = (id, kind, title, version) => ({ id, projectId: "99999999-0000-4000-8000-" + id.slice(-12), kind, title, currentVersion: version, createdAt: now, updatedAt: now });
window.listings = {};
window.resolveApi = (account, path) => {
  const mine = window.listings[account]; if (!mine) return null;
  if (path === "/api/workspaces") return { workspaces: mine.workspaces };
  const match = /^\\/api\\/cloud\\/workspaces\\/([^/?]+)/.exec(path); if (!match) return null;
  const ws = mine.workspaces.find(item => item.id === match[1]); if (!ws) return null;
  const query = new URLSearchParams(path.split("?")[1] ?? "");
  const detail = /\\/artifacts\\/([0-9a-f-]{36})$/.exec(path.split("?")[0]);
  if (detail) { const item = (mine.artifacts[ws.id] ?? []).find(entry => entry.id === detail[1]); if (!item) return null; const current = window.detailOverride?.(item) ?? item;
    return { artifact: current, versions: current.currentVersion ? [window.version(current)] : [], pagination: { offset: 0, total: 1, nextOffset: null } }; }
  if (/\\/artifacts\\?/.test(path)) { const q = (query.get("q") ?? "").toLowerCase(); const found = (mine.artifacts[ws.id] ?? []).filter(item => item.title.toLowerCase().includes(q)); return { artifacts: found, pagination: { total: found.length, nextCursor: null } }; }
  let artifacts = [...(mine.artifacts[ws.id] ?? [])];
  const client = query.get("artifactsClient"), sort = query.get("artifactsSort");
  if (client) artifacts = artifacts.filter(item => client === "none" ? !item.clientId : item.clientId === client);
  if (sort === "title") artifacts.sort((a, b) => a.title.localeCompare(b.title));
  return { workspace: ws, clients: (mine.clients ?? {})[ws.id] ?? [], projects: (mine.projects ?? {})[ws.id] ?? [], artifacts, pagination: { clients: { offset: 0, total: 0, nextOffset: null }, projects: { offset: 0, total: 0, nextOffset: null }, artifacts: { offset: 0, total: artifacts.length, nextOffset: null } } };
};
window.version = item => ({ id: "cccccccc-1111-4000-8000-" + String(item.currentVersion).padStart(12, "0"), artifactId: item.id, number: item.currentVersion, parentVersionId: null,
  content: { schemaVersion: 1, kind: item.kind, title: item.title, sections: [{ id: "s1", title: item.title, blocks: [] }], ...(item.documentTitle ? { document: { kind: item.kind === "book" ? "book" : "deck", title: item.documentTitle } } : {}) },
  style: { id: "automatic" }, assetIds: ["dddddddd-0000-4000-8000-000000000001"], createdAt: now, createdBy: "aaaaaaaa-0000-4000-8000-000000000001", changeSummary: "" });
window.writes = [];
window.resolveWrite = (account, path, body) => {
  window.writes.push({ account, path, body });
  const match = /^\\/api\\/cloud\\/workspaces\\/([^/]+)\\/artifacts\\/([^/]+)\\/versions$/.exec(path); if (!match) return new window.CloudError(400, "Unsupported");
  if (window.writeFailure) return window.writeFailure;
  const list = window.listings[account]?.artifacts[match[1]] ?? []; const at = list.findIndex(item => item.id === match[2]);
  if (at < 0) return new window.CloudError(404, "This artifact is unavailable.");
  if (list[at].currentVersion !== body.expectedVersion) return new window.CloudError(409, "The artifact changed or is unavailable. Reload before saving.");
  list[at] = { ...list[at], title: body.content.title, currentVersion: body.expectedVersion + 1, updatedAt: "2026-10-21T15:00:00.000Z" };
  return { artifact: list[at] };
};
window.answer = (request, source, extra = {}) => ({ workspaceId: request.workspaceId, artifactId: request.artifactId, kind: extra.kind ?? "presentation", versionNumber: request.versionNumber,
  versionId: "cccccccc-0000-4000-8000-" + String(request.versionNumber).padStart(12, "0"), fingerprint: String(request.versionNumber % 10).repeat(64), source, ...extra });
window.siteHtml = text => '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \\'none\\'; style-src \\'unsafe-inline\\'"></head><body style="margin:0"><header style="font:700 64px sans-serif;padding:40px">' + text + '</header></body></html>';
window.pendingFor = (artifactId, versionNumber) => window.previewRequests.filter(entry => entry.request.artifactId === artifactId && (versionNumber === undefined || entry.request.versionNumber === versionNumber) && !entry.settled && !entry.aborted);
window.settle = (artifactId, versionNumber, value) => { const entry = window.previewRequests.find(item => item.request.artifactId === artifactId && item.request.versionNumber === versionNumber && !item.settled); if (!entry) throw new Error("no request for " + artifactId + " v" + versionNumber); entry.settled = true; value instanceof Error ? entry.reject(value) : entry.resolve(value); };
window.fail = status => Object.assign(new Error("fail " + status), { status });
`;

async function main() {
  const accountProjects = path.join(root, "src/components/account-projects.tsx");
  const baselineSource = baseline ? execFileSync("git", ["show", `${baseline}:src/components/account-projects.tsx`], { cwd: root, encoding: "utf8" }) : null;
  const output = await build({ stdin: { contents: fixture, loader: "jsx", resolveDir: root }, write: false, bundle: true, platform: "browser", jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' }, logLevel: "silent",
    plugins: [{ name: "fixture", setup(b) {
      b.onResolve({ filter: /.*/ }, args => { const mock = mockFor(args.path); return mock ? { path: mock, namespace: "mock" } : undefined; });
      b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path], loader: "jsx", resolveDir: root }));
      b.onResolve({ filter: /^@\// }, args => ({ path: resolveSrc(path.join(root, "src", args.path.slice(2))) }));
      b.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
      if (baselineSource) b.onLoad({ filter: /account-projects\.tsx$/ }, args => args.path === accountProjects ? ({ contents: baselineSource, loader: "tsx", resolveDir: path.dirname(accountProjects) }) : undefined);
    } }] });
  const css = `body{margin:0;padding:24px;font:14px/1.5 Arial,sans-serif}main{max-width:100%}
${fs.readFileSync(path.join(root, "src/app/library-preview.css"), "utf8")}`;
  const server = createServer((req, res) => {
    if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(output.outputFiles[0].contents); }
    if (req.url === "/api/capabilities") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ cloudWorkspace: { available: true } })); }
    if (req.url !== "/") { res.statusCode = 404; return res.end(); }
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><html><head><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await browserType.launch({ headless: true });
  const results = [];
  async function scenario(name, setup, run, options = {}) {
    const context = await browser.newContext({ viewport: options.viewport ?? { width: 1100, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const blocked = [];
    await page.route(/^https?:\/\//, route => { const url = new URL(route.request().url()); if (url.hostname === "127.0.0.1") return route.continue(); blocked.push(url.origin); return route.abort(); });
    page.on("pageerror", error => console.log(`  pageerror in ${name}: ${error.message}`));
    try {
      await page.addInitScript(helpers);
      await page.addInitScript(setup);
      await page.goto(origin);
      await run(page);
      assert.deepEqual(blocked, [], "no request leaves 127.0.0.1");
      results.push([name, true]); console.log(`PASS ${name}`);
    } catch (error) {
      results.push([name, false]); console.log(`${baseline ? "BASELINE FAIL" : "FAIL"} ${name}: ${String(error.message).split("\n")[0]}`);
    } finally { await context.close(); }
  }
  const frameText = async (page, artifactId) => {
    const handle = await page.locator(`[data-card="${artifactId}"] iframe`).elementHandle({ timeout });
    const frame = await handle.contentFrame();
    await frame.waitForLoadState();
    return frame.evaluate(() => document.body.innerText);
  };
  const description = (page, artifactId) => page.evaluate(id => { const button = document.querySelector(`[data-card="${id}"] .account-project-open`); const target = button && document.getElementById(button.getAttribute("aria-describedby") ?? ""); return target ? target.textContent : null; }, artifactId);
  const tagCards = page => page.evaluate(() => { for (const card of document.querySelectorAll(".account-project-card")) { const title = card.querySelector("strong")?.textContent ?? ""; const match = Object.entries(window.cardTitles ?? {}).find(([, value]) => value === title); if (match) card.setAttribute("data-card", match[0]); } });
  const waitCards = async (page, count) => { await page.waitForFunction(n => document.querySelectorAll(".account-project-card").length === n, count, { timeout }); await tagCards(page); };
  const DECK = "d0000000-0000-4000-8000-000000000001", BOOK = "d0000000-0000-4000-8000-000000000002", SITE = "d0000000-0000-4000-8000-000000000003", NEW = "d0000000-0000-4000-8000-000000000004", SRC = "d0000000-0000-4000-8000-000000000005";
  const standard = ({ ids: i, DECK, BOOK, SITE, NEW, SRC }) => {
    window.session = { user: { id: i.A } };
    window.cardTitles = { [DECK]: "Harbour Pitch", [BOOK]: "Moss Book", [SITE]: "Clinic Site", [NEW]: "Fresh Draft", [SRC]: "Source Site" };
    window.listings[i.A] = { workspaces: [{ id: i.W1, name: "Studio", role: "owner" }, { id: i.W2, name: "Second", role: "owner" }], artifacts: {
      [i.W1]: [window.artifact(DECK, "presentation", "Harbour Pitch", 3), window.artifact(BOOK, "book", "Moss Book", 2), window.artifact(SITE, "website", "Clinic Site", 5), window.artifact(NEW, "website", "Fresh Draft", 0)],
      [i.W2]: [window.artifact(SRC, "website", "Source Site", 1)] } };
    window.listings[i.B] = { workspaces: [{ id: i.WB, name: "B Studio", role: "owner" }], artifacts: { [i.WB]: [window.artifact(SRC, "website", "Source Site", 1)] } };
  };
  const setupStandard = `(${standard.toString()})({ ids: window.ids, DECK: "${DECK}", BOOK: "${BOOK}", SITE: "${SITE}", NEW: "${NEW}", SRC: "${SRC}" });`;
  const autoAnswers = `window.autoPreview = request => request.artifactId === "${DECK}" ? window.answer(request, { format: "deck", deck: window.fixtures.deck })
    : request.artifactId === "${BOOK}" ? window.answer(request, { format: "book", book: window.fixtures.book, chapterCount: 0 }, { kind: "book" })
    : window.answer(request, { format: "website-snapshot", html: window.siteHtml("CLINIC HOME " + request.workspaceId.slice(0, 2) + " V" + request.versionNumber) }, { kind: "website" });`;
  const both = (...scripts) => scripts.join(";\n");
  try {
    await scenario("real deck, book and website content renders for the saved version, described by that version", both(setupStandard, autoAnswers), async page => {
      await waitCards(page, 4);
      assert.match(await frameText(page, DECK), /HARBOUR OPENING SLIDE/);
      assert.doesNotMatch(await frameText(page, DECK), /SECOND SLIDE ONLY/, "only the opening slide is painted");
      assert.match(await frameText(page, BOOK), /MOSS COVER TITLE/);
      assert.match(await frameText(page, SITE), /CLINIC HOME 11 V5/);
      assert.equal(await description(page, DECK), "Preview shows Version 3, first slide.");
      assert.equal(await description(page, BOOK), "Preview shows Version 2, cover.");
      assert.equal(await description(page, SITE), "Preview shows Version 5, top of the home page.");
      const frame = await page.locator(`[data-card="${DECK}"] iframe`).evaluate(node => ({ sandbox: node.getAttribute("sandbox"), tabIndex: node.tabIndex, hidden: node.closest("[aria-hidden=true]") !== null }));
      assert.deepEqual(frame, { sandbox: "allow-same-origin", tabIndex: -1, hidden: true });
      assert.equal(await page.locator(`[data-card="${SITE}"] iframe`).getAttribute("sandbox"), "", "website HTML is fully sandboxed (no scripts, opaque origin)");
      // No saved version: honest label, no request, no frame.
      assert.equal(await page.locator(`[data-card="${NEW}"] iframe`).count(), 0);
      assert.match(await page.locator(`[data-card="${NEW}"] .library-card-fallback`).innerText(), /No saved version yet/);
      assert.equal(await page.evaluate(id => window.previewRequests.filter(entry => entry.request.artifactId === id).length, NEW), 0);
    });

    await scenario("a late answer for an older version never replaces the newer version's preview", setupStandard, async page => {
      await waitCards(page, 4);
      await page.waitForFunction(([d, b]) => window.pendingFor(d, 3).length === 1 && window.pendingFor(b, 2).length === 1, [DECK, BOOK], { timeout });
      // Version 3's answer is still in flight (and will race its cancellation) when version 4 is saved and the list refreshes.
      await page.evaluate(([i, id]) => { window.ignoreAbort = true; window.listings[i.A].artifacts[i.W1][0] = window.artifact(id, "presentation", "Harbour Pitch", 4); }, [ids, DECK]);
      await page.getByRole("button", { name: "Refresh" }).click();
      await page.waitForFunction(() => document.body.innerText.includes("Version 4"), null, { timeout });
      await tagCards(page);
      await page.evaluate(id => window.settle(id, 2, window.answer(window.pendingFor(id, 2)[0].request, { format: "book", book: window.fixtures.book, chapterCount: 0 }, { kind: "book" })), BOOK);
      // The freed slot goes to the queued website card. Its server answer names another version than the card asked for: refused outright.
      await page.waitForFunction(id => window.pendingFor(id, 5).length === 1, SITE, { timeout });
      await page.evaluate(id => { const entry = window.pendingFor(id, 5)[0]; entry.settled = true; entry.resolve(window.answer({ ...entry.request, versionNumber: 4 }, { format: "website-snapshot", html: window.siteHtml("WRONG VERSION") }, { kind: "website" })); }, SITE);
      await page.waitForFunction(id => /couldn’t load/.test(document.querySelector(`[data-card="${id}"] .library-card-fallback`)?.textContent ?? ""), SITE, { timeout });
      assert.equal(await page.locator(`[data-card="${SITE}"] iframe`).count(), 0, "version 4 is never shown on the version-5 card");
      await page.waitForFunction(id => window.pendingFor(id, 4).length === 1, DECK, { timeout });
      const deckWith = title => ({ format: "deck", deck: { ...deck, slides: [{ ...deck.slides[0], title }, deck.slides[1]] } });
      await page.evaluate(([id, source]) => window.settle(id, 4, window.answer(window.pendingFor(id, 4)[0].request, source)), [DECK, deckWith("VERSION FOUR SLIDE")]);
      await page.waitForFunction(id => document.querySelector(`[data-card="${id}"] iframe`), DECK, { timeout });
      assert.match(await frameText(page, DECK), /VERSION FOUR SLIDE/);
      // Version 3 answers late, after version 4 is shown.
      await page.evaluate(([id, source]) => window.settle(id, 3, window.answer(window.previewRequests.find(entry => entry.request.artifactId === id && entry.request.versionNumber === 3).request, source)), [DECK, deckWith("STALE VERSION THREE")]);
      await page.waitForTimeout(300);
      assert.match(await frameText(page, DECK), /VERSION FOUR SLIDE/);
      assert.equal(await description(page, DECK), "Preview shows Version 4, first slide.");
      assert.doesNotMatch(await page.locator(`[data-card="${DECK}"] iframe`).getAttribute("srcdoc"), /STALE VERSION THREE/);
    });
    await scenario("failures, unsupported and too-large previews fall back to the format icon with an honest label", setupStandard, async page => {
      await waitCards(page, 4);
      await page.waitForFunction(([a, b]) => window.pendingFor(a, 3).length === 1 && window.pendingFor(b, 2).length === 1, [DECK, BOOK], { timeout });
      await page.evaluate(([a, b]) => { window.settle(a, 3, window.fail(500)); window.settle(b, 2, window.fail(404)); }, [DECK, BOOK]);
      await page.waitForFunction(id => window.pendingFor(id, 5).length === 1, SITE, { timeout });
      await page.evaluate(id => window.settle(id, 5, window.answer(window.pendingFor(id, 5)[0].request, { format: "unavailable", reason: "too-large" }, { kind: "website" })), SITE);
      await page.waitForFunction(() => document.querySelectorAll(".library-card-thumb.fallback").length === 4, null, { timeout });
      assert.match(await page.locator(`[data-card="${DECK}"] .library-card-thumb`).innerText(), /Preview couldn’t load/);
      assert.match(await page.locator(`[data-card="${BOOK}"] .library-card-thumb`).innerText(), /Preview unavailable/);
      assert.match(await page.locator(`[data-card="${SITE}"] .library-card-thumb`).innerText(), /Too large to preview/);
      assert.equal(await page.locator(".library-card-thumb iframe").count(), 0, "never a blank or broken frame");
      assert.equal(await page.locator(`[data-card="${DECK}"] .library-card-thumb svg`).count(), 1, "the format icon stays");
      assert.equal(await description(page, BOOK), "No preview: this project is unavailable to your account.");
      // A failed or revoked preview is not cached: showing the card again asks again.
      await page.evaluate(() => window.setFilter("website")); await page.waitForTimeout(50); await page.evaluate(() => window.setFilter("all"));
      await page.waitForFunction(([a, b]) => window.pendingFor(a, 3).length === 1 && window.pendingFor(b, 2).length === 1, [DECK, BOOK], { timeout });
    });

    await scenario("an account switch or sign-out removes every preview; switching back asks the server again", both(setupStandard, autoAnswers), async page => {
      await waitCards(page, 4);
      assert.match(await frameText(page, SITE), /CLINIC HOME/);
      const before = await page.evaluate(() => window.previewRequests.length);
      await page.evaluate(i => window.authCallback("SIGNED_IN", { user: { id: i.B } }), ids);
      await page.waitForFunction(() => !document.body.innerText.includes("Clinic Site") && document.querySelectorAll(".account-project-card").length === 1, null, { timeout });
      assert.equal(await page.locator("iframe").count() <= 1, true);
      await tagCards(page);
      assert.match(await frameText(page, SRC), /CLINIC HOME 33 V1/, "account B sees only its own workspace's preview");
      await page.evaluate(() => window.authCallback("SIGNED_OUT", null));
      await page.waitForFunction(() => document.querySelectorAll(".account-project-card, iframe").length === 0, null, { timeout });
      await page.evaluate(i => window.authCallback("SIGNED_IN", { user: { id: i.A } }), ids);
      await waitCards(page, 4);
      await page.waitForFunction(id => document.querySelector(`[data-card="${id}"] iframe`), SITE, { timeout });
      const again = await page.evaluate(([n, id]) => window.previewRequests.slice(n).filter(entry => entry.request.artifactId === id && entry.request.accountId === window.ids.A).length, [before, SITE]);
      assert.ok(again >= 1, "account A's previews were re-authorized, not served from a cache");
    });

    await scenario("a workspace switch shows only the selected workspace's previews", both(setupStandard, autoAnswers), async page => {
      await waitCards(page, 4);
      assert.match(await frameText(page, SITE), /CLINIC HOME 11 V5/);
      await page.getByLabel("Workspace").selectOption(ids.W2);
      await page.waitForFunction(() => document.querySelectorAll(".account-project-card").length === 1 && document.body.innerText.includes("Source Site"), null, { timeout });
      await tagCards(page);
      assert.match(await frameText(page, SRC), /CLINIC HOME 22 V1/);
      assert.equal(await page.locator(`text=Clinic Site`).count(), 0);
      const before = await page.evaluate(() => window.previewRequests.length);
      await page.getByLabel("Workspace").selectOption(ids.W1);
      await waitCards(page, 4);
      await page.waitForFunction(id => document.querySelector(`[data-card="${id}"] iframe`), SITE, { timeout });
      assert.ok(await page.evaluate(([n, id]) => window.previewRequests.slice(n).some(entry => entry.request.artifactId === id), [before, SITE]), "returning to a workspace re-reads its previews");
    });

    await scenario("a deleted project's card and preview are gone after Refresh and are not requested again", both(setupStandard, autoAnswers), async page => {
      await waitCards(page, 4);
      assert.match(await frameText(page, SITE), /CLINIC HOME/);
      await page.evaluate(([i, id]) => { window.listings[i.A].artifacts[i.W1] = window.listings[i.A].artifacts[i.W1].filter(item => item.id !== id); }, [ids, SITE]);
      const before = await page.evaluate(() => window.previewRequests.length);
      await page.getByRole("button", { name: "Refresh" }).click();
      await waitCards(page, 3);
      await page.waitForTimeout(200);
      assert.equal(await page.locator("text=Clinic Site").count(), 0);
      assert.equal(await page.evaluate(() => [...document.querySelectorAll("iframe")].some(frame => (frame.getAttribute("srcdoc") ?? "").includes("CLINIC HOME"))), false, "no frame keeps the deleted project's content");
      assert.equal(await page.evaluate(([n, id]) => window.previewRequests.slice(n).filter(entry => entry.request.artifactId === id).length, [before, SITE]), 0);
    });

    await scenario("revoked access: Refresh removes the list and every preview, and says so", both(setupStandard, autoAnswers), async page => {
      await waitCards(page, 4);
      await page.waitForFunction(id => document.querySelector(`[data-card="${id}"] iframe`), SITE, { timeout });
      await page.evaluate(i => { window.listings[i.A].workspaces = window.listings[i.A].workspaces.filter(item => item.id !== i.W1); }, ids);
      await page.getByRole("button", { name: "Refresh" }).click();
      await page.getByText("This workspace is unavailable. Your saved projects haven’t loaded, so this list may be incomplete.").waitFor({ timeout });
      assert.equal(await page.locator(".account-project-card, iframe").count(), 0, "no card or preview of the revoked workspace stays visible");
    });

    await scenario("previews load lazily near the viewport with at most two reads at once", () => {
      window.session = { user: { id: window.ids.A } };
      const many = Array.from({ length: 12 }, (_, n) => window.artifact(`e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`, "website", `Site ${n}`, 1));
      window.listings[window.ids.A] = { workspaces: [{ id: window.ids.W1, name: "Studio", role: "owner" }], artifacts: { [window.ids.W1]: many } };
    }, async page => {
      await page.waitForFunction(() => document.querySelectorAll(".account-project-card").length === 12, null, { timeout });
      await page.waitForFunction(() => window.previewRequests.length === 2, null, { timeout });
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => window.previewRequests.length), 2, "a third read waits for a free slot");
      const settleAll = () => page.evaluate(() => { for (const entry of window.previewRequests) if (!entry.settled && !entry.aborted) { entry.settled = true; entry.resolve(window.answer(entry.request, { format: "website-snapshot", html: window.siteHtml("LAZY " + entry.request.artifactId.slice(-2)) }, { kind: "website" })); } });
      for (let round = 0; round < 8; round++) { await settleAll(); await page.waitForTimeout(60); }
      const nearFold = await page.evaluate(() => new Set(window.previewRequests.map(entry => entry.request.artifactId)).size);
      assert.ok(nearFold < 12, `only cards near the viewport were read (${nearFold} of 12)`);
      for (let round = 0; round < 16; round++) { await page.evaluate(() => window.scrollBy(0, 200)); await settleAll(); await page.waitForTimeout(80); }
      assert.equal(await page.evaluate(() => new Set(window.previewRequests.map(entry => entry.request.artifactId)).size), 12, "scrolling reads the rest");
      assert.ok(await page.evaluate(() => window.maxOutstanding) <= 2, "never more than two reads in flight");
    }, { viewport: { width: 800, height: 380 } });

    await scenario("an editor's card captures a website source once, through the sanitizing server; a reviewer's never does", () => {
      window.session = { user: { id: window.ids.A } };
      window.cardTitles = { "f0000000-0000-4000-8000-000000000001": "Editor Site" };
      window.listings[window.ids.A] = { workspaces: [{ id: window.ids.W1, name: "Studio", role: "editor" }, { id: window.ids.W2, name: "Client", role: "reviewer" }], artifacts: {
        [window.ids.W1]: [window.artifact("f0000000-0000-4000-8000-000000000001", "website", "Editor Site", 6)], [window.ids.W2]: [window.artifact("f0000000-0000-4000-8000-000000000001", "website", "Editor Site", 6)] } };
      window.autoPreview = request => window.answer(request, { format: "unavailable", reason: "not-captured", capture: true }, { kind: "website" });
      window.captureSource = request => ({ ...window.answer(request, null, { kind: "website" }), title: "Editor Site", source: { files: [{ path: "src/App.tsx", content: "export default () => null" }], assets: [], routes: [] } });
      // The server sanitizes: scripts never come back.
      window.captureSaved = (request, capture) => window.answer(request, { format: "website-snapshot", html: window.siteHtml("CAPTURED HOME PAGE") }, { kind: "website", versionId: capture.versionId, fingerprint: capture.fingerprint });
    }, async page => {
      await waitCards(page, 1);
      const card = "f0000000-0000-4000-8000-000000000001";
      assert.match(await frameText(page, card), /CAPTURED HOME PAGE/);
      const calls = await page.evaluate(() => window.captureCalls.map(call => call.kind));
      assert.deepEqual(calls, ["source", "compile", "save"]);
      assert.equal(await page.evaluate(() => window.captureCalls[2].result.outcome), "ready");
      assert.equal(await page.evaluate(() => window.compromised), undefined);
      await page.getByLabel("Workspace").selectOption(ids.W2);
      await page.waitForFunction(() => document.querySelector(".library-card-thumb.fallback"), null, { timeout });
      assert.match(await page.locator(".library-card-thumb").innerText(), /No preview yet/);
      assert.equal(await page.evaluate(() => window.captureCalls.length), 3, "reviewers never compile or store a capture");
    });

    await scenario("a title search with no matches offers Clear search, which restores the list and focus", both(setupStandard, autoAnswers), async page => {
      await waitCards(page, 4);
      await page.fill("#search", "ZZ-NOTHING");
      await page.getByRole("button", { name: "Clear search" }).waitFor({ timeout });
      assert.equal(await page.locator(".account-project-card").count(), 0);
      await page.getByRole("button", { name: "Clear search" }).click();
      await waitCards(page, 4);
      assert.equal(await page.inputValue("#search"), "");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "search", "focus returns to the search field");
    });

    await scenario("cards show Draft, Live or Live · newer changes not published, and their client, from the authorized read", both(setupStandard, autoAnswers, `window.cardMeta = (account, ws, ids) => ids.flatMap(id => id === "${DECK}" ? [{ artifactId: id, currentVersion: 3, client: null, publication: { state: "live", liveVersion: 3 } }]
      : id === "${SITE}" ? [{ artifactId: id, currentVersion: 5, client: { id: "c0000000-0000-4000-8000-000000000001", name: "Acme Clinic" }, publication: { state: "live-behind", liveVersion: 4 } }]
      : id === "${BOOK}" ? [{ artifactId: id, currentVersion: 2, client: { id: "c0000000-0000-4000-8000-000000000002", name: "Moss Press" }, publication: { state: "draft", liveVersion: null } }]
      : id === "${NEW}" ? [{ artifactId: id, currentVersion: 1, client: null, publication: { state: "live", liveVersion: 1 } }] : []);`), async page => {
      await waitCards(page, 4);
      await page.waitForFunction(() => document.querySelectorAll(".account-project-facts").length === 3, null, { timeout });
      const facts = async id => (await page.locator(`[data-card="${id}"] .account-project-facts`).textContent()).replace(/\s+/g, " ").trim();
      const client = async id => { const node = page.locator(`[data-card="${id}"] .account-project-client`); return await node.count() ? (await node.textContent()).replace(/\s+/g, " ").trim() : null; };
      assert.equal(await facts(DECK), "Live"); assert.equal(await client(DECK), null);
      assert.equal(await facts(SITE), "Live · unpublished changes"); assert.equal(await client(SITE), "Client: Acme Clinic ·");
      assert.equal(await facts(BOOK), "Draft"); assert.equal(await client(BOOK), "Client: Moss Press ·");
      assert.equal(await page.locator(`[data-card="${SITE}"] .account-project-state`).getAttribute("title"), "Version 4 is live. Version 5 is saved but not published.", "the exact versions are one hover away");
      assert.equal(await page.locator(`[data-card="${NEW}"] .account-project-facts`).count(), 0, "facts for another version than the card names are not shown");
      assert.match(await page.locator(`[data-card="${SITE}"] .account-project-open`).innerText(), /Live · unpublished changes[\s\S]*|Acme Clinic/, "part of the card's accessible name");
      assert.match(await page.locator(`[data-card="${SITE}"] .account-project-open`).innerText(), /Acme Clinic/);
      await page.getByRole("button", { name: "List", exact: true }).click();
      assert.equal(await facts(SITE), "Live · newer changes not published", "the list view shows the full label");
      assert.equal(await page.locator(".account-project-menu").count(), 4, "one action menu per card");
      assert.deepEqual(await page.evaluate(() => window.metaCalls.map(call => [call.accountId, call.workspaceId])), [[ids.A, ids.W1]], "one read for the shown cards, scoped to account + workspace");
    });

    await scenario("late card facts for a previous account are dropped; a failed read says so and retries", () => {
      window.session = { user: { id: window.ids.A } };
      const shared = "d0000000-0000-4000-8000-0000000000aa";
      window.cardTitles = { [shared]: "Shared Site" };
      window.listings[window.ids.A] = { workspaces: [{ id: window.ids.W1, name: "Studio", role: "owner" }], artifacts: { [window.ids.W1]: [window.artifact(shared, "website", "Shared Site", 2)] } };
      window.listings[window.ids.B] = { workspaces: [{ id: window.ids.WB, name: "B Studio", role: "owner" }], artifacts: { [window.ids.WB]: [window.artifact(shared, "website", "Shared Site", 2)] } };
      window.autoPreview = request => window.answer(request, { format: "unavailable", reason: "unsupported" }, { kind: "website" });
      window.metaRelease = [];
      window.cardMeta = (account, ws, ids) => account === window.ids.A ? new Promise(resolve => window.metaRelease.push(() => resolve(ids.map(id => ({ artifactId: id, currentVersion: 2, client: { id: "c0000000-0000-4000-8000-000000000009", name: "A-ONLY CLIENT" }, publication: { state: "live", liveVersion: 2 } }))))) : window.fail(500);
    }, async page => {
      await page.waitForFunction(() => window.metaRelease.length === 1, null, { timeout });
      await page.evaluate(i => window.authCallback("SIGNED_IN", { user: { id: i.B } }), ids);
      await page.waitForFunction(() => window.metaCalls.some(call => call.accountId === window.ids.B), null, { timeout });
      await page.evaluate(() => window.metaRelease[0]());
      await page.getByText("Publication status and client names couldn’t load, so cards don’t show them.").waitFor({ timeout });
      assert.equal(await page.getByText("A-ONLY CLIENT").count(), 0, "account A's facts never appear for account B");
      await page.evaluate(() => { window.cardMeta = (account, ws, ids) => ids.map(id => ({ artifactId: id, currentVersion: 2, client: null, publication: { state: "draft", liveVersion: null } })); });
      await page.getByRole("button", { name: "Retry" }).click();
      await page.waitForFunction(() => document.querySelector(".account-project-facts")?.textContent === "Draft", null, { timeout });
    });

    await scenario("sort and client filter reload the whole workspace from the server", both(setupStandard, autoAnswers, `
      window.listings[window.ids.A].clients = { [window.ids.W1]: [{ id: "c0000000-0000-4000-8000-000000000001", name: "Acme Clinic", company: "", email: "", website: "", notes: "", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" }] };
      window.listings[window.ids.A].artifacts[window.ids.W1][2].clientId = "c0000000-0000-4000-8000-000000000001";`), async page => {
      await waitCards(page, 4);
      await page.getByLabel("Sort").selectOption("title");
      await page.waitForFunction(() => window.apiCalls.some(call => call.path.includes("artifactsSort=title")), null, { timeout });
      await page.waitForFunction(() => [...document.querySelectorAll(".account-project-card strong")].map(node => node.textContent).join("|") === "Clinic Site|Fresh Draft|Harbour Pitch|Moss Book", null, { timeout });
      await page.getByLabel("Client").selectOption("c0000000-0000-4000-8000-000000000001");
      await page.waitForFunction(() => window.apiCalls.some(call => call.path.includes("artifactsClient=c0000000-0000-4000-8000-000000000001") && call.path.includes("artifactsSort=title")), null, { timeout });
      await waitCards(page, 1);
      assert.equal(await page.locator(".account-project-card strong").innerText(), "Clinic Site");
      await page.getByLabel("Client").selectOption("none");
      await waitCards(page, 3);
      await page.fill("#search", "moss");
      await page.getByText("Search covers every client and lists matches newest first.").waitFor({ timeout });
      assert.equal(await page.getByLabel("Sort").isDisabled(), true, "search covers every client; sort and client are paused while searching");
    });

    await scenario("the list layout is remembered per device and account, never across accounts", both(setupStandard, autoAnswers), async page => {
      await waitCards(page, 4);
      await page.getByRole("button", { name: "List", exact: true }).click();
      assert.equal(await page.locator(".account-project-grid.list").count(), 1);
      assert.equal(await page.evaluate(i => localStorage.getItem("makeborne.library-view.v1." + i.A), ids), "list");
      await page.evaluate(i => window.authCallback("SIGNED_IN", { user: { id: i.B } }), ids);
      await page.waitForFunction(() => document.querySelectorAll(".account-project-card").length === 1, null, { timeout });
      assert.equal(await page.locator(".account-project-grid.list").count(), 0, "account B starts in its own (default) layout");
      assert.equal(await page.getByRole("button", { name: "Grid", exact: true }).getAttribute("aria-pressed"), "true");
      await page.evaluate(i => window.authCallback("SIGNED_IN", { user: { id: i.A } }), ids);
      await waitCards(page, 4);
      assert.equal(await page.locator(".account-project-grid.list").count(), 1, "account A's choice is restored on this device");
    });

    await scenario("one tab stop per card (the frame is never focusable); layout does not shift when a preview arrives", both(setupStandard, autoAnswers), async page => {
      await waitCards(page, 4);
      const box = async () => page.locator(`[data-card="${SITE}"]`).boundingBox();
      const first = await box();
      await page.waitForFunction(id => document.querySelector(`[data-card="${id}"] iframe`), SITE, { timeout });
      assert.deepEqual(await box(), first, "the card keeps its size when the preview paints");
      await page.focus("#before");
      const stops = [];
      for (let n = 0; n < 26; n++) { await page.keyboard.press("Tab"); stops.push(await page.evaluate(() => { const e = document.activeElement; return e.id || e.className || e.tagName; })); if (stops.at(-1) === "after") break; }
      const cardStops = stops.filter(stop => /^account-project-(open|menu)$/.test(stop));
      assert.equal(cardStops.join(","), Array(4).fill("account-project-open,account-project-menu").join(","), `each card: open, then its menu: ${stops.join(" > ")}`);
      assert.ok(!stops.some(stop => /IFRAME|library-card/.test(stop)), "the preview frame is never focused");
      assert.equal(stops.at(-1), "after");
      for (const width of [1440, 800, 375, 320]) {
        await page.setViewportSize({ width, height: 800 });
        await page.waitForTimeout(80);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 0, `no horizontal overflow at ${width}px (${overflow})`);
      }
    });
    // ---- S1 library redesign: geometry, actions, rename, live link, Retry ----
    const titles = ["A", "Harbour Dental — spring campaign for the York practice, with a deliberately long name that needs more than two lines on any card", "Moss", "Clinic Site", "Harbour Dental — spring campaign", "Harbour Dental — spring campaign v2", "Leeds", "Untitled presentation", "Short"];
    const GEO = titles.map((_, n) => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
    const geometrySetup = `window.session = { user: { id: window.ids.A } };
      const kinds = ["website", "book", "presentation"];
      window.listings[window.ids.A] = { workspaces: [{ id: window.ids.W1, name: "Studio", role: "owner" }], artifacts: { [window.ids.W1]: ${JSON.stringify(titles)}.map((title, n) => window.artifact(${JSON.stringify(GEO)}[n], kinds[n % 3], title, n % 4 === 3 ? 0 : 2)) } };
      window.autoPreview = request => { const n = ${JSON.stringify(GEO)}.indexOf(request.artifactId); return n % 3 === 1 ? window.answer(request, { format: "book", book: window.fixtures.book, chapterCount: 0 }, { kind: "book" })
        : n % 3 === 2 ? window.answer(request, { format: "deck", deck: window.fixtures.deck }) : window.answer(request, { format: "website-snapshot", html: window.siteHtml("HOME " + n) }, { kind: "website" }); };`;
    const measure = page => page.evaluate(() => {
      const cards = [...document.querySelectorAll(".account-project-card")], box = el => el.getBoundingClientRect();
      const tops = new Map(); cards.forEach(card => { const y = Math.round(box(card).top); tops.set(y, (tops.get(y) ?? 0) + 1); });
      const titlesOf = cards.map(card => { const t = card.querySelector(".account-project-title"); return { lines: Math.round(box(t).height / parseFloat(getComputedStyle(t).lineHeight)), full: t.getAttribute("title"), text: t.textContent }; });
      return { columns: [...tops.values()][0], gridWidth: Math.round(box(document.querySelector(".account-project-grid")).width),
        previews: [...new Set(cards.map(card => Math.round(box(card.querySelector(".library-card-thumb")).height * 10) / 10))],
        previewRatios: [...new Set(cards.map(card => { const b = box(card.querySelector(".library-card-thumb")); return Math.round(b.width / b.height * 100) / 100; }))],
        heights: [...new Set(cards.map(card => Math.round(box(card).height)))], titleLines: Math.max(...titlesOf.map(t => t.lines)), fullNames: titlesOf.every(t => t.full === t.text),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    await scenario("grid geometry: one preview shape, one card height, two-line titles, columns from the list's own width", geometrySetup, async page => {
      await page.waitForFunction(n => document.querySelectorAll(".account-project-card").length === n, GEO.length, { timeout });
      for (const [width, expected] of [[1440, 5], [1024, 4], [800, 3], [375, 1], [320, 1]]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(150);
        const m = await measure(page);
        // auto-fill of 232px minimum tracks with 20px gaps inside the list's own width (viewport minus the 24px page padding here).
        assert.equal(m.columns, Math.max(1, Math.min(expected, Math.floor((m.gridWidth + 20) / 252))), `${width}px: columns follow the list width (${m.gridWidth}px → ${m.columns})`);
        assert.equal(m.previews.length, 1, `${width}px: every preview has the same height (${m.previews})`);
        assert.deepEqual(m.previewRatios, [1.6], `${width}px: every preview is 16:10`);
        assert.equal(m.heights.length, 1, `${width}px: every card has the same height (${m.heights})`);
        assert.ok(m.titleLines <= 2, `${width}px: titles are clamped to two lines (${m.titleLines})`);
        assert.ok(m.fullNames, "the full name stays available on every title");
        assert.ok(m.overflow <= 0, `${width}px: no horizontal overflow (${m.overflow})`);
      }
      // Wider list, more columns: the same viewport with a narrower list (e.g. beside a sidebar) gets fewer.
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.evaluate(() => { document.querySelector("main").style.width = "700px"; });
      await page.waitForTimeout(150);
      assert.equal((await measure(page)).columns, 2, "a 700px list shows two columns at a 1440px viewport");
      // Book covers are contained (portrait, centred), decks sit at 16:9, websites fill the width.
      await page.evaluate(() => { document.querySelector("main").style.width = ""; });
      await page.waitForFunction(() => document.querySelectorAll(".library-card-thumb iframe").length >= 6, null, { timeout });
      const frames = await page.evaluate(() => [...document.querySelectorAll(".library-card-thumb iframe")].map(frame => { const f = frame.getBoundingClientRect(), t = frame.parentElement.getBoundingClientRect();
        return { canvas: frame.className.replace("library-card-frame ", ""), ratio: Math.round(f.width / f.height * 100) / 100, fitsWidth: Math.abs(f.width - t.width) < 1.5, inside: f.top >= t.top - .5 && f.bottom <= t.bottom + .5, centred: Math.abs((f.left + f.right) / 2 - (t.left + t.right) / 2) < 1.5 }; }));
      for (const frame of frames.filter(item => item.canvas === "book")) { assert.equal(frame.ratio, 0.67); assert.ok(frame.inside && frame.centred && !frame.fitsWidth, "the cover is contained, not stretched"); }
      for (const frame of frames.filter(item => item.canvas === "deck")) { assert.equal(frame.ratio, 1.78); assert.ok(frame.fitsWidth && frame.inside, "the opening slide at 16:9"); }
      for (const frame of frames.filter(item => item.canvas === "website")) assert.ok(frame.fitsWidth, "a website's home page fills the width (top crop)");
      assert.ok(frames.some(item => item.canvas === "book") && frames.some(item => item.canvas === "deck") && frames.some(item => item.canvas === "website"));
    });

    await scenario("list view: dense rows with a small preview and readable metadata, not shrunken cards", geometrySetup, async page => {
      await page.waitForFunction(n => document.querySelectorAll(".account-project-card").length === n, GEO.length, { timeout });
      await page.getByRole("button", { name: "List", exact: true }).click();
      for (const width of [1440, 800, 375, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(150);
        const rows = await page.evaluate(() => [...document.querySelectorAll(".account-project-card")].map(card => { const b = card.getBoundingClientRect(), t = card.querySelector(".library-card-thumb").getBoundingClientRect(), title = card.querySelector(".account-project-title");
          return { h: Math.round(b.height), thumb: [Math.round(t.width), Math.round(t.height)], titleLines: Math.round(title.getBoundingClientRect().height / parseFloat(getComputedStyle(title).lineHeight)), x: Math.round(b.left) }; }));
        assert.ok(rows.every(row => row.thumb[0] === 64 && row.thumb[1] === 40), `${width}px: small fixed preview`);
        assert.ok(rows.every(row => row.titleLines === 1), `${width}px: one-line titles`);
        assert.equal(new Set(rows.map(row => row.x)).size, 1, `${width}px: one column of rows`);
        assert.ok(Math.max(...rows.map(row => row.h)) <= (width >= 700 ? 60 : 80), `${width}px: dense rows (${Math.max(...rows.map(row => row.h))}px)`);
        assert.equal(new Set(rows.map(row => row.h)).size, 1, `${width}px: rows share one height`);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${width}px: no horizontal overflow`);
      }
    });

    await scenario("action menu: arrow keys, Home/End, Escape returns focus, Tab closes; only real actions", both(setupStandard, autoAnswers), async page => {
      await waitCards(page, 4);
      const trigger = page.locator(`[data-card="${DECK}"] .account-project-menu`);
      assert.equal(await trigger.getAttribute("aria-haspopup"), "menu"); assert.equal(await trigger.getAttribute("aria-expanded"), "false");
      assert.equal(await trigger.getAttribute("aria-label"), "Actions for Harbour Pitch");
      await trigger.focus(); await page.keyboard.press("Enter");
      await page.getByRole("menu", { name: "Actions for Harbour Pitch" }).waitFor({ timeout });
      assert.equal(await trigger.getAttribute("aria-expanded"), "true");
      const focused = () => page.evaluate(() => document.activeElement?.textContent);
      assert.equal(await focused(), "Open", "focus moves to the first item");
      assert.deepEqual(await page.getByRole("menuitem").allTextContents(), ["Open", "Rename…"], "a draft has no live link; nothing else is offered");
      await page.keyboard.press("ArrowDown"); assert.equal(await focused(), "Rename…");
      await page.keyboard.press("ArrowDown"); assert.equal(await focused(), "Open", "wraps");
      await page.keyboard.press("End"); assert.equal(await focused(), "Rename…");
      await page.keyboard.press("Home"); assert.equal(await focused(), "Open");
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("menu").count(), 0);
      assert.equal(await page.evaluate(() => document.activeElement?.className), "account-project-menu", "focus returns to the trigger");
      await page.keyboard.press("ArrowUp"); assert.equal(await focused(), "Rename…", "ArrowUp opens on the last item");
      await page.keyboard.press("Tab"); assert.equal(await page.getByRole("menu").count(), 0, "Tab closes the menu");
      await trigger.click(); await page.mouse.click(5, 5); assert.equal(await page.getByRole("menu").count(), 0, "a click outside closes it");
      await trigger.click(); await page.getByRole("menuitem", { name: "Open" }).click();
      assert.deepEqual(await page.evaluate(() => window.navigations.at(-1)), { workspaceId: ids.W1, artifactId: DECK }, "Open opens the same project as the card");
      // No saved version yet: nothing to rename.
      await page.evaluate(() => window.setTarget(null));
    });

    await scenario("rename saves the current version with only its title changed, through the version guard, and returns focus", both(setupStandard, autoAnswers), async page => {
      await waitCards(page, 4);
      await page.locator(`[data-card="${NEW}"] .account-project-menu`).click();
      assert.deepEqual(await page.getByRole("menuitem").allTextContents(), ["Open"], "a project with no saved version cannot be renamed here");
      await page.keyboard.press("Escape");
      await page.locator(`[data-card="${SITE}"] .account-project-menu`).click();
      await page.getByRole("menuitem", { name: "Rename…" }).click();
      const dialog = page.getByRole("dialog", { name: "Rename project" });
      await dialog.waitFor({ timeout });
      await dialog.getByText(/Saves Version 6 with the new name\./).waitFor({ timeout });
      assert.match(await dialog.innerText(), /default title in browser tabs and search results/);
      const input = dialog.getByLabel("Project name");
      assert.equal(await input.inputValue(), "Clinic Site");
      assert.equal(await dialog.locator(".library-rename-suggestions").count(), 0, "a deliberate name gets no suggestions");
      await dialog.getByRole("button", { name: "Rename" }).click();
      await dialog.getByText("This is already the project’s name.").waitFor({ timeout });
      assert.equal(await page.evaluate(() => window.writes.length), 0, "nothing is saved for an unchanged name");
      await input.fill("Clinic Site — York");
      await dialog.getByRole("button", { name: "Rename" }).click();
      await page.getByText("Renamed to “Clinic Site — York”. Saved as Version 6.").waitFor({ timeout });
      const write = await page.evaluate(() => window.writes[0]);
      assert.equal(write.path, `/api/cloud/workspaces/${ids.W1}/artifacts/${SITE}/versions`);
      assert.equal(write.body.expectedVersion, 5);
      assert.equal(write.body.content.title, "Clinic Site — York");
      assert.deepEqual(write.body.content.sections, [{ id: "s1", title: "Clinic Site", blocks: [] }], "the content itself is unchanged");
      assert.deepEqual(write.body.assetIds, ["dddddddd-0000-4000-8000-000000000001"], "the asset manifest is kept");
      assert.equal(write.body.changeSummary, "Renamed to “Clinic Site — York”");
      assert.equal(await page.evaluate(() => window.apiCalls.some(call => /\/projects\//.test(call.path))), false, "the project record is not touched");
      assert.equal(await page.getByRole("dialog").count(), 0);
      assert.equal(await page.locator(`.account-project-card:has-text("Clinic Site — York") .account-project-title`).getAttribute("title"), "Clinic Site — York");
      assert.match(await page.locator(`.account-project-card:has-text("Clinic Site — York")`).innerText(), /Version 6 · saved/);
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Actions for Clinic Site — York", "focus returns to the card's menu");
      // The renamed card names Version 6, so its preview is read again for that version.
      await page.waitForFunction(id => window.previewRequests.some(entry => entry.request.artifactId === id && entry.request.versionNumber === 6), SITE, { timeout });
    });

    await scenario("rename conflicts and failures keep the name and say so; a stale card is caught before writing", both(setupStandard, autoAnswers), async page => {
      await waitCards(page, 4);
      // Someone saved Version 4 of the deck after the list loaded: the save is refused by the version guard.
      await page.locator(`[data-card="${DECK}"] .account-project-menu`).click();
      await page.getByRole("menuitem", { name: "Rename…" }).click();
      const dialog = page.getByRole("dialog", { name: "Rename project" });
      await dialog.getByText(/Saves Version 4/).waitFor({ timeout });
      await page.evaluate(([i]) => { window.listings[i.A].artifacts[i.W1][0].currentVersion = 4; }, [ids]);
      await dialog.getByLabel("Project name").fill("Harbour Pitch — final");
      await dialog.getByRole("button", { name: "Rename" }).click();
      await dialog.getByText("This project was saved again since the library loaded, so it wasn’t renamed. Refresh the library and try again.").waitFor({ timeout });
      assert.equal(await page.locator(`[data-card="${DECK}"] .account-project-title`).textContent(), "Harbour Pitch", "the card keeps its name");
      await dialog.getByRole("button", { name: "Refresh library" }).click();
      await page.waitForFunction(() => document.body.innerText.includes("Version 4 · saved"), null, { timeout });
      assert.equal(await page.getByRole("dialog").count(), 0);
      // Stale before writing: the detail read already shows a newer version.
      await tagCards(page);
      await page.evaluate(() => { window.detailOverride = item => ({ ...item, currentVersion: item.currentVersion + 1 }); });
      await page.locator(`[data-card="${BOOK}"] .account-project-menu`).click();
      await page.getByRole("menuitem", { name: "Rename…" }).click();
      await page.getByRole("dialog").getByText("This project was saved again since the library loaded (now Version 3). Refresh the library before renaming it.").waitFor({ timeout });
      assert.equal(await page.getByRole("dialog").getByRole("button", { name: "Rename" }).isDisabled(), true);
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("dialog").count(), 0, "Escape closes the dialog");
      await page.waitForTimeout(100);
      const after = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.outerHTML.slice(0, 120));
      assert.equal(after, "Actions for Moss Book", "and focus returns to the trigger");
      // A failed save (server error) is an error, never a rename.
      await page.evaluate(() => { window.detailOverride = null; window.writeFailure = new window.CloudError(500, "Cloud storage is unavailable."); });
      await page.locator(`[data-card="${BOOK}"] .account-project-menu`).click();
      await page.getByRole("menuitem", { name: "Rename…" }).click();
      await page.getByRole("dialog").getByLabel("Project name").fill("Moss Book II");
      await page.getByRole("dialog").getByRole("button", { name: "Rename" }).click();
      await page.getByRole("dialog").getByText("Cloud storage is unavailable. The project keeps its current name.").waitFor({ timeout });
      assert.equal(await page.locator(`[data-card="${BOOK}"] .account-project-title`).textContent(), "Moss Book");
      assert.equal(await page.getByText(/^Renamed to/).count(), 0);
    });

    await scenario("Untitled projects get suggestions from their saved brief and content, applied only on Rename; reviewers cannot rename", () => {
      window.session = { user: { id: window.ids.A } };
      const id = "a1000000-0000-4000-8000-000000000001", project = "99999999-0000-4000-8000-000000000001";
      window.cardTitles = { [id]: "Untitled presentation" };
      const item = { ...window.artifact(id, "presentation", "Untitled presentation", 2), projectId: project, documentTitle: "York Smiles: Spring Campaign" };
      window.listings[window.ids.A] = { workspaces: [{ id: window.ids.W1, name: "Studio", role: "owner" }, { id: window.ids.W2, name: "Client", role: "reviewer" }],
        artifacts: { [window.ids.W1]: [item], [window.ids.W2]: [{ ...item }] },
        projects: { [window.ids.W1]: [{ id: project, clientId: null, title: "Untitled presentation", kind: "presentation", status: "draft", styleId: "automatic", effort: "medium", deliveryStage: "active", brief: "Please make a presentation for Harbour Dental York about their spring whitening offer. Call 01904 555123.", createdAt: "2026-10-20T10:00:00.000Z", updatedAt: "2026-10-20T10:00:00.000Z", audience: "", purpose: "", wording: "preserve" }] } };
      window.autoPreview = request => window.answer(request, { format: "deck", deck: window.fixtures.deck });
    }, async page => {
      await waitCards(page, 1);
      assert.equal(await page.locator(".account-project-card.untitled").count(), 1, "a placeholder title is marked as one");
      await page.locator(".account-project-menu").click();
      await page.getByRole("menuitem", { name: "Name this project…" }).click();
      const dialog = page.getByRole("dialog", { name: "Name this project" });
      await dialog.getByRole("group", { name: "Suggested from this project’s saved brief and content" }).waitFor({ timeout });
      const suggestions = await dialog.locator(".library-rename-suggestions > button").allTextContents();
      assert.equal(suggestions.length, 2, "the deck title and the brief-derived name (the record title is a placeholder)");
      assert.equal(suggestions[0], "York Smiles: Spring Campaign", "the title inside the current version comes first");
      assert.match(suggestions[1], /^Presentation for Harbour Dental York/);
      assert.ok(!suggestions.some(text => /01904|555123/.test(text)), "contact details never become a name");
      assert.match(await dialog.innerText(), /slides keep the title written on them/);
      await dialog.getByRole("button", { name: "York Smiles: Spring Campaign" }).click();
      assert.equal(await dialog.getByLabel("Project name").inputValue(), "York Smiles: Spring Campaign");
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => window.writes.length), 0, "choosing a suggestion never saves");
      assert.equal(await page.locator(".account-project-title").textContent(), "Untitled presentation", "never renamed silently");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      assert.equal(await page.evaluate(() => window.writes.length), 0, "Cancel saves nothing");
      await page.locator(".account-project-menu").click();
      await page.getByRole("menuitem", { name: "Name this project…" }).click();
      await page.getByRole("dialog").getByRole("button", { name: suggestions[1], exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Rename" }).click();
      await page.getByText(`Renamed to “${suggestions[1]}”. Saved as Version 3.`).waitFor({ timeout });
      assert.equal(await page.locator(".account-project-card.untitled").count(), 0);
      // A reviewer's card has no Rename.
      await page.getByLabel("Workspace").selectOption(ids.W2);
      await page.waitForFunction(() => document.querySelector(".account-project-title")?.textContent === "Untitled presentation", null, { timeout });
      await page.locator(".account-project-menu").click();
      assert.deepEqual(await page.getByRole("menuitem").allTextContents(), ["Open"], "reviewers can open, not rename");
    });

    await scenario("Copy live link appears only for a live row with its authorized address; a failed copy shows the address", both(setupStandard, autoAnswers, `
      window.cardMeta = (account, ws, ids) => ids.flatMap(id => id === "${DECK}" ? [{ artifactId: id, currentVersion: 3, client: null, publication: { state: "live", liveVersion: 3, address: "https://sites.makeborne.com/harbour" } }]
        : id === "${SITE}" ? [{ artifactId: id, currentVersion: 5, client: null, publication: { state: "live-behind", liveVersion: 4, address: "https://sites.makeborne.com/clinic" } }]
        : id === "${BOOK}" ? [{ artifactId: id, currentVersion: 2, client: null, publication: { state: "draft", liveVersion: null, address: null } }] : []);
      window.copied = [];
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: text => window.clipboardFails ? Promise.reject(new Error("denied")) : (window.copied.push(text), Promise.resolve()) } });`), async page => {
      await waitCards(page, 4);
      await page.waitForFunction(() => document.querySelectorAll(".account-project-facts").length === 3, null, { timeout });
      const items = async id => { await page.locator(`[data-card="${id}"] .account-project-menu`).click(); const names = await page.getByRole("menuitem").allTextContents(); await page.keyboard.press("Escape"); return names; };
      assert.deepEqual(await items(BOOK), ["Open", "Rename…"], "a draft never offers a live link");
      assert.deepEqual(await items(SITE), ["Open", "Rename…", "Copy live link", "Open live site"], "Live with newer changes still has its live address");
      await page.locator(`[data-card="${DECK}"] .account-project-menu`).click();
      assert.equal(await page.getByRole("menuitem", { name: "Open live site" }).getAttribute("href"), "https://sites.makeborne.com/harbour");
      assert.equal(await page.getByRole("menuitem", { name: "Open live site" }).getAttribute("rel"), "noopener noreferrer");
      await page.getByRole("menuitem", { name: "Copy live link" }).click();
      await page.getByText("Live link copied: https://sites.makeborne.com/harbour").waitFor({ timeout });
      assert.deepEqual(await page.evaluate(() => window.copied), ["https://sites.makeborne.com/harbour"]);
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Actions for Harbour Pitch");
      await page.evaluate(() => { window.clipboardFails = true; });
      await page.locator(`[data-card="${SITE}"] .account-project-menu`).click();
      await page.getByRole("menuitem", { name: "Copy live link" }).click();
      await page.getByRole("alert").filter({ hasText: "The live link couldn’t be copied in this browser." }).waitFor({ timeout });
      assert.equal(await page.getByRole("link", { name: "https://sites.makeborne.com/clinic" }).count(), 1, "the address is shown to copy by hand");
      await page.getByRole("button", { name: "Dismiss message" }).click();
      assert.equal(await page.getByText("couldn’t be copied").count(), 0);
    });

    await scenario("a failed preview offers Retry, which reads it again and shows it", setupStandard, async page => {
      await waitCards(page, 4);
      await page.waitForFunction(([d, b]) => window.pendingFor(d, 3).length === 1 && window.pendingFor(b, 2).length === 1, [DECK, BOOK], { timeout });
      await page.evaluate(([d, b]) => { window.settle(d, 3, window.fail(500)); window.settle(b, 2, window.fail(404)); }, [DECK, BOOK]);
      const retry = page.getByRole("button", { name: "Retry preview of Harbour Pitch" });
      await retry.waitFor({ timeout });
      assert.equal(await page.getByRole("button", { name: /^Retry preview of/ }).count(), 1, "only a failed read offers Retry (revoked access does not)");
      await retry.click();
      await page.waitForFunction(id => window.pendingFor(id, 3).length === 1, DECK, { timeout });
      await page.evaluate(id => window.settle(id, 3, window.answer(window.pendingFor(id, 3)[0].request, { format: "deck", deck: window.fixtures.deck })), DECK);
      assert.match(await frameText(page, DECK), /HARBOUR OPENING SLIDE/);
      assert.equal(await page.getByRole("button", { name: /^Retry preview of/ }).count(), 0);
    });

    await scenario("in the page toolbar slot, the controls work the same and keep one list position", `window.withSlot = true; ${setupStandard}; ${autoAnswers}`, async page => {
      await waitCards(page, 4);
      assert.equal(await page.locator("#toolbar .account-projects-controls").count(), 1, "controls join the page toolbar");
      assert.equal(await page.locator(".account-projects > .account-projects-controls").count(), 0, "never twice");
      await page.locator("#toolbar").getByLabel("Sort").selectOption("title");
      await page.waitForFunction(() => [...document.querySelectorAll(".account-project-card .account-project-title")].map(node => node.textContent).join("|") === "Clinic Site|Fresh Draft|Harbour Pitch|Moss Book", null, { timeout });
      await page.locator("#toolbar").getByRole("button", { name: "List", exact: true }).click();
      assert.equal(await page.locator(".account-project-grid.list").count(), 1);
      await page.locator("#toolbar").getByRole("button", { name: "Refresh" }).click();
      await waitCards(page, 4);
    });
    await scenario("rendered frames are bounded to cards near the viewport; scrolling back remounts from memory without another read", () => {
      window.session = { user: { id: window.ids.A } };
      const many = Array.from({ length: 60 }, (_, n) => window.artifact(`e1000000-0000-4000-8000-${String(n).padStart(12, "0")}`, "website", `Site ${n}`, 1));
      window.listings[window.ids.A] = { workspaces: [{ id: window.ids.W1, name: "Studio", role: "owner" }], artifacts: { [window.ids.W1]: many } };
      window.autoPreview = request => window.answer(request, { format: "website-snapshot", html: window.siteHtml("BOUNDED " + request.artifactId.slice(-2)) }, { kind: "website" });
    }, async page => {
      await page.waitForFunction(() => document.querySelectorAll(".account-project-card").length === 60, null, { timeout });
      for (let round = 0; round < 40; round++) { await page.evaluate(() => window.scrollBy(0, 400)); await page.waitForTimeout(60); }
      await page.waitForFunction(() => window.scrollY + innerHeight >= document.documentElement.scrollHeight - 2, null, { timeout });
      await page.waitForTimeout(300);
      const atBottom = await page.evaluate(() => ({ frames: document.querySelectorAll(".library-card-thumb iframe").length, firstHasFrame: !!document.querySelector(".account-project-card .library-card-thumb iframe") && document.querySelector(".account-project-card").querySelector("iframe") !== null, reads: window.previewRequests.length }));
      assert.ok(atBottom.reads >= 50, `the previews were read while scrolling (${atBottom.reads})`);
      assert.ok(atBottom.frames < 40, `only cards near the viewport keep a frame (${atBottom.frames} of 60)`);
      assert.equal(atBottom.firstHasFrame, false, "the first card's frame was released far above the viewport");
      const heights = await page.evaluate(() => [...new Set([...document.querySelectorAll(".account-project-card")].map(card => Math.round(card.getBoundingClientRect().height)))]);
      assert.equal(heights.length, 1, "released frames keep the card's size");
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForFunction(() => document.querySelector(".account-project-card iframe"), null, { timeout });
      assert.equal(await page.evaluate(() => window.previewRequests.length), atBottom.reads, "scrolling back reuses the in-memory preview: no new read");
    }, { viewport: { width: 900, height: 500 } });
  } finally { await browser.close(); server.close(); }
  const failed = results.filter(([, ok]) => !ok);
  if (baseline) { console.log(`Baseline ${baseline}: ${failed.length} of ${results.length} scenarios fail (expected: the pre-change library has no artifact previews).`); process.exit(failed.length ? 0 : 1); }
  console.log(`${results.length - failed.length}/${results.length} mounted library preview scenarios passed (${engineLabel}, mocked API, no network).`);
  if (failed.length) process.exit(1);
}
main().catch(error => { console.error(error); process.exit(1); });
