/* eslint-disable @typescript-eslint/no-require-imports -- Mounted AccountProjects library with the real cloud API client (new-user journey, round 2, 26 Oct 2026):
 * a saved project can be renamed from its card menu (owner/editor only; reviewers get no menu). A rename saves the current version again with only content.title changed,
 * through the authorized version route with expectedVersion; a newer save is caught before writing; names are validated; the card shows the new name.
 * Same semantics as feature/library-redesign's library-rename (shared library-rename.ts and library-card-actions.tsx).
 * Every API is a Playwright route with fictional data; no network beyond 127.0.0.1.
 * Run: node scripts/check-library-rename-browser.cjs [screenshot-dir] */
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs");
const { build } = require("esbuild"), { browserType, args: engineArgs } = require("./browser-engine.cjs"), { createServer } = require("node:http");

const shots = engineArgs[0] ? path.resolve(engineArgs[0]) : null;
const ids = { account: "11111111-1111-4111-8111-111111111111", workspace: "22222222-2222-4222-8222-222222222222", project: "33333333-3333-4333-8333-333333333333",
  site: "44444444-4444-4444-8444-444444444444", user: "66666666-6666-4666-8666-666666666666" };
const TITLE = "A website for Saffron Table, a small Lebanese family";
const style = { id: "automatic", name: "Automatic", version: 1, typography: { headingFont: "Inter", bodyFont: "Inter" }, colors: { canvas: "#FFFFFF", ink: "#000000", accent: "#3559D8" }, description: "Fixture direction", referenceAssetIds: [] };
const content = title => ({ schemaVersion: 1, kind: "website", title, sections: [{ id: "51111111-1111-4111-8111-111111111111", title: TITLE, blocks: [{ id: "52111111-1111-4111-8111-111111111111", type: "heading", text: TITLE, assetId: null, locked: false, sourceIds: [] }] }] });
const vid = n => `88888888-8888-4888-8888-88888888888${n}`;
const versionOf = (number, body, summary = `Fixture version ${number}`) => ({ id: vid(number), artifactId: ids.site, number, parentVersionId: number > 1 ? vid(number - 1) : null, content: body, style, assetIds: [],
  createdAt: `2026-10-2${number}T09:00:00.000Z`, createdBy: ids.user, changeSummary: summary });
const artifactOf = (current, title) => ({ id: ids.site, projectId: ids.project, kind: "website", title, currentVersion: current, createdAt: "2026-10-20T09:00:00.000Z", updatedAt: "2026-10-2" + current + "T09:00:00.000Z" });
const project = { id: ids.project, workspaceId: ids.workspace, clientId: null, title: TITLE, kind: "website", status: "draft", styleId: "automatic", brief: "A website for Saffron Table.", effort: "medium",
  createdAt: "2026-10-20T09:00:00.000Z", updatedAt: "2026-10-20T09:00:00.000Z", audience: "", purpose: "", wording: "preserve" };

const fixture = `import React from "react"; import { createRoot } from "react-dom/client";
import AccountProjects from "./src/components/account-projects";
createRoot(document.getElementById("root")).render(<main className="workspace-content"><AccountProjects search="" filter="all" target={null} navigate={() => {}} onStatus={() => {}} /></main>);`;
const mocks = {
  "supabase-client": `const session = { user: { id: "${ids.account}" } }; export function createClient() { return { auth: { onAuthStateChange(cb) { setTimeout(() => cb("INITIAL_SESSION", session), 0); return { data: { subscription: { unsubscribe() {} } } }; } } }; }`,
  "card-preview-api": `export class CardPreviewError extends Error {} export function readCardPreview() { return new Promise(() => {}); }
export async function readCardCaptureSource() { throw new Error("none"); } export async function saveCardCapture() { throw new Error("none"); } export async function readCardImage() { throw new Error("none"); }
export async function readCardMeta(accountId, workspaceId, ids) { return ids.map(artifactId => ({ artifactId, currentVersion: 1, client: null, publication: { state: "draft", liveVersion: null } })); }`,
  "pending-cloud-writes": `export default function PendingCloudWrites() { return null; }`,
  "cloud-studio": `export function CloudEditor() { return null; }`,
  "next/dynamic": `export default function dynamic() { return function Editor() { return null; }; }`,
  "next/link": `import React from "react"; export default function Link({ href, children, prefetch, ...rest }) { return <a href={typeof href === "string" ? href : "#"} {...rest}>{children}</a>; }`,
};
const mockFor = request => request.startsWith("next/") ? (mocks[request] ? request : null) : /[\\/]supabase[\\/]client$/.test(request) ? "supabase-client"
  : /(?:^|[\\/])(card-preview-api|pending-cloud-writes|cloud-studio)$/.exec(request)?.[1] ?? null;

async function bundle() {
  const css = [];
  const output = await build({ stdin: { contents: fixture, loader: "jsx", resolveDir: process.cwd() }, write: false, bundle: true, platform: "browser", jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
    logLevel: "silent", plugins: [{ name: "fixture", setup(b) {
      b.onResolve({ filter: /.*/ }, args => { const mock = mockFor(args.path); return mock ? { path: mock, namespace: "mock" } : undefined; });
      b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path], loader: "jsx", resolveDir: process.cwd() }));
      b.onResolve({ filter: /^@\// }, args => {
        const base = path.resolve("src", args.path.slice(2));
        const found = [base, `${base}.tsx`, `${base}.ts`].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
        const mock = mockFor(found ?? args.path);
        return mock ? { path: mock, namespace: "mock" } : { path: found };
      });
      b.onLoad({ filter: /\.css$/ }, args => { css.push(fs.readFileSync(args.path, "utf8")); return { contents: "", loader: "js" }; });
    } }] });
  return { js: output.outputFiles[0].contents, styles: [fs.readFileSync("src/app/globals.css", "utf8"), fs.readFileSync("src/app/build-workspace.css", "utf8"), ...new Set(css)].join("\n").replace(/@import[^;]+;/g, "") };
}

async function main() {
  const { js, styles } = await bundle();
  const server = createServer((req, res) => {
    if (req.url === "/fixture.js") { res.setHeader("content-type", "text/javascript"); return res.end(js); }
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}*{box-sizing:border-box}${styles}</style><div id="root"></div><script src="/fixture.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await browserType.launch({ headless: true });
  let passed = 0; const failures = [];
  const scenario = async (name, options, run) => {
    const { width = 1280, height = 900, role = "owner", savedElsewhere = false } = options;
    const page = await browser.newPage({ viewport: { width, height } }), errors = [], writes = [], foreign = [];
    page.setDefaultTimeout(10000); page.on("pageerror", error => errors.push(error.message));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/))/, route => { foreign.push(route.request().url()); return route.abort(); });
    const state = { versions: [versionOf(1, content(TITLE))], title: TITLE, posts: [] };
    const listed = () => artifactOf(state.versions.length, state.title);
    await page.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method(), file = url.pathname;
      if (method !== "GET") writes.push(`${method} ${file}`);
      if (file === "/api/capabilities") return route.fulfill({ json: { cloudWorkspace: { available: true } } });
      if (file === "/api/workspaces") return route.fulfill({ json: { workspaces: [{ id: ids.workspace, name: "My workspace", role }] } });
      if (file === `/api/cloud/workspaces/${ids.workspace}`) return route.fulfill({ json: { workspace: { id: ids.workspace, name: "My workspace", role }, clients: [], projects: [project], artifacts: [listed()],
        pagination: { clients: { offset: 0, total: 0, nextOffset: null }, projects: { offset: 0, total: 1, nextOffset: null }, artifacts: { offset: 0, total: 1, nextOffset: null } } } });
      if (file === `/api/cloud/workspaces/${ids.workspace}/artifacts/${ids.site}` && method === "GET") {
        // "Saved elsewhere": another tab saved version 2 after the library loaded.
        const versions = savedElsewhere ? [...state.versions, versionOf(2, content(TITLE), "Edited in another tab")] : state.versions;
        return route.fulfill({ json: { artifact: artifactOf(versions.length, state.title), versions, pagination: { offset: 0, total: versions.length, nextOffset: null } } });
      }
      if (file === `/api/cloud/workspaces/${ids.workspace}/artifacts/${ids.site}/versions` && method === "POST") {
        const body = request.postDataJSON(); state.posts.push(body);
        if (body.expectedVersion !== state.versions.length) return route.fulfill({ status: 409, json: { error: { code: "VERSION_CONFLICT", message: "Another version was saved first." } } });
        const number = state.versions.length + 1, version = versionOf(number, body.content, body.changeSummary);
        state.versions.push(version); state.title = body.content.title;
        return route.fulfill({ json: { artifact: listed(), version, mutation: { idempotencyKey: request.headers()["idempotency-key"], replayed: false } } });
      }
      return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Not in this fixture." } } });
    });
    try {
      await page.goto(base);
      await page.locator(".account-project-card").first().waitFor({ timeout: 15000 });
      await run(page, { writes, state });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no horizontal page scroll");
      assert.deepEqual(errors, [], "no page errors");
      assert.deepEqual(foreign, [], "no request left 127.0.0.1");
      if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `library-rename-${name}.png`) }); }
      passed++; console.log(`PASS ${name}`);
    } catch (error) { failures.push(name); console.log(`FAIL ${name}: ${error.message.split("\n").slice(0, 4).join(" | ")}`); }
    finally { await page.close(); }
  };
  const menuButton = page => page.getByRole("button", { name: `Actions for ${TITLE}` });
  const dialog = page => page.getByRole("dialog", { name: "Rename project" });
  try {
    for (const [label, size] of [["1280", {}], ["390", { width: 390, height: 844 }]]) await scenario(`owner-renames-from-the-card-menu-${label}`, size, async (page, { writes, state }) => {
      await menuButton(page).click();
      await page.getByRole("menuitem", { name: "Rename…" }).click();
      await dialog(page).waitFor();
      await dialog(page).getByText(/Saves Version 2 with the new name\. Nothing else in the project changes\./).waitFor();
      assert.match(await dialog(page).innerText(), /A rename alone doesn’t count as an unpublished change\./);
      const field = dialog(page).getByRole("textbox", { name: "Project name" });
      await field.fill("   ");
      await dialog(page).getByRole("button", { name: "Rename" }).click();
      await dialog(page).getByText("Enter a name.").waitFor();
      await field.fill(TITLE);
      await dialog(page).getByRole("button", { name: "Rename" }).click();
      await dialog(page).getByText("This is already the project’s name.").waitFor();
      assert.deepEqual(writes, [], "an invalid or unchanged name writes nothing");
      await field.fill("  Saffron   Table — website ");
      await dialog(page).getByRole("button", { name: "Rename" }).click();
      await dialog(page).waitFor({ state: "detached" });
      await page.getByText("Renamed to “Saffron Table — website”. Saved as Version 2.").waitFor();
      assert.deepEqual(writes, [`POST /api/cloud/workspaces/${ids.workspace}/artifacts/${ids.site}/versions`], "one version save, nothing else (no project PATCH)");
      const [body] = state.posts;
      assert.equal(body.expectedVersion, 1, "guarded by the version the library showed");
      assert.equal(body.content.title, "Saffron Table — website", "whitespace is tidied");
      assert.deepEqual({ ...body.content, title: TITLE }, content(TITLE), "only the title changed");
      assert.equal(body.changeSummary, "Renamed to “Saffron Table — website”");
      await page.locator(".account-project-card strong", { hasText: "Saffron Table — website" }).waitFor();
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Actions for Saffron Table — website", "focus returns to the card's menu button");
    });
    await scenario("a-newer-save-is-caught-before-writing", { savedElsewhere: true }, async (page, { writes }) => {
      await menuButton(page).click();
      await page.getByRole("menuitem", { name: "Rename…" }).click();
      await dialog(page).getByText(/saved again since the library loaded \(now Version 2\)/).waitFor();
      assert.equal(await dialog(page).getByRole("button", { name: "Rename" }).isDisabled(), true);
      assert.deepEqual(writes, []);
      await page.keyboard.press("Escape");
      await dialog(page).waitFor({ state: "detached" });
    });
    await scenario("keyboard-menu-and-escape-return-focus", {}, async (page, { writes }) => {
      await menuButton(page).focus();
      await page.keyboard.press("ArrowDown");
      // feature/library-redesign's card menu: Open first, then Rename (then live-link actions when the site is live).
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Open");
      await page.keyboard.press("ArrowDown");
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Rename…");
      await page.keyboard.press("Enter");
      await dialog(page).waitFor();
      await page.keyboard.press("Escape");
      await dialog(page).waitFor({ state: "detached" });
      await page.waitForFunction(name => document.activeElement?.getAttribute("aria-label") === name, `Actions for ${TITLE}`);
      assert.deepEqual(writes, []);
    });
    await scenario("reviewers-get-no-rename", { role: "reviewer" }, async page => {
      // Every library-redesign card has a menu (Open); a reviewer's has no Rename in it.
      await menuButton(page).click();
      assert.deepEqual(await page.getByRole("menuitem").allTextContents(), ["Open"], "a reviewer's card menu offers Open only");
      assert.equal(await page.getByText(/Rename/).count(), 0);
    });
  } finally { await browser.close(); server.close(); }
  console.log(`\n${passed} passed, ${failures.length} failed.`);
  if (failures.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exit(1); });
