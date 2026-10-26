/* eslint-disable @typescript-eslint/no-require-imports -- Mounted project editor (real CloudEditor, ProjectHeader and AccountPreview) for the new-user journey, round 2 (26 Oct 2026):
 * a content-only project (saved without an AI build, e.g. while AI is paused) shows its saved content in Preview, the same layout preview a client review link shows,
 * instead of an empty "Your website starts here".
 * Every API is a Playwright route with fictional data; no provider, database or paid call; no network beyond 127.0.0.1.
 * Run: node scripts/check-editor-journey-browser.cjs [screenshot-dir] */
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs");
const { build } = require("esbuild"), { browserType, args: engineArgs } = require("./browser-engine.cjs"), { createServer } = require("node:http");

const shots = engineArgs[0] ? path.resolve(engineArgs[0]) : null;
const ids = { account: "11111111-1111-4111-8111-111111111111", workspace: "22222222-2222-4222-8222-222222222222", project: "33333333-3333-4333-8333-333333333333",
  site: "44444444-4444-4444-8444-444444444444", user: "66666666-6666-4666-8666-666666666666" };
const style = { id: "automatic", name: "Automatic", version: 1, typography: { headingFont: "Inter", bodyFont: "Inter" }, colors: { canvas: "#FFFFFF", ink: "#000000", accent: "#3559D8" }, description: "Fixture direction", referenceAssetIds: [] };
const TITLE = "A website for Saffron Table, a small Lebanese family";
const block = (id, type, text) => ({ id, type, text, assetId: null, locked: false, sourceIds: [] });
// What creation saves for a brief with no supplied content: the title as the only heading (journey audit C4).
const contents = {
  titleOnly: () => ({ schemaVersion: 1, kind: "website", title: TITLE, sections: [{ id: "51111111-1111-4111-8111-111111111111", title: TITLE, blocks: [block("52111111-1111-4111-8111-111111111111", "heading", TITLE)] }] }),
  empty: () => ({ schemaVersion: 1, kind: "website", title: TITLE, sections: [{ id: "51111111-1111-4111-8111-111111111111", title: "Main content", blocks: [] }] }),
};
const vid = n => `88888888-8888-4888-8888-88888888888${n}`;
const versionOf = (number, content, summary = `Fixture version ${number}`) => ({ id: vid(number), artifactId: ids.site, number, parentVersionId: number > 1 ? vid(number - 1) : null,
  content, style, assetIds: [], createdAt: `2026-10-2${number}T09:00:00.000Z`, createdBy: ids.user, changeSummary: summary });
const artifactOf = (current, title = TITLE) => ({ id: ids.site, projectId: ids.project, kind: "website", title, currentVersion: current, createdAt: "2026-10-20T09:00:00.000Z", updatedAt: "2026-10-23T09:00:00.000Z" });

const fixture = `import React from "react";import{createRoot}from"react-dom/client";import{CloudEditor}from"./src/components/cloud-studio";import{setCloudAccount}from"./src/components/cloud-api";
const ids=${JSON.stringify(ids)};setCloudAccount(ids.account);let root;
window.mountEditor=({artifact,role="owner"})=>{root??=createRoot(document.getElementById("root"));root.render(<CloudEditor key={artifact.id} accountId={ids.account} workspaceId={ids.workspace} artifact={artifact} project={{brief:"A website for Saffron Table, a small Lebanese family restaurant.",effort:"medium",clientId:null}} role={role} back={()=>{}} notify={()=>{}}/>);};`;
const NULL = "export default function Stub(){return null}";
const mocks = {
  "live-builder": `import React from "react";export default function LiveBuilderStub(props){return <aside className="lb" aria-label="Conversation"><p>{props.disabledReason||"Builder ready"}</p></aside>}`,
  "build-conversation": 'export default function ConversationStub(){return <aside className="build-conversation" aria-label="Conversation"></aside>}',
  "website-publish": NULL, "client-review-panel": NULL, "website-generation": NULL, "saved-website-preview": NULL, "pending-cloud-writes": NULL, "cloud-client-outreach": NULL, "account-export": NULL,
  "website-github": NULL, "version-compare": NULL, "website-analytics": NULL, "website-portal-settings": NULL, "account-artwork-upload": NULL, "account-style-editor": NULL, "website-enquiries": NULL,
  "website-seo": NULL, "website-domains": NULL,
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
  const shell = fs.readFileSync(path.resolve("src/app/build-workspace.css"), "utf8");
  return { js: output.outputFiles[0].contents, html: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${globals}${shell}${css.join("\n")}</style><div class="studio-shell is-project-open"><main class="studio-main"><div class="workspace-content" id="root"></div></main></div><script src="/fixture.js"></script>` };
}

async function main() {
  const { js, html } = await bundle();
  const server = createServer((req, res) => { const script = req.url === "/fixture.js"; res.setHeader("Content-Type", script ? "text/javascript" : "text/html"); res.end(script ? js : html); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await browserType.launch({ headless: true });
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const failures = [], results = [];

  /** One scenario: fresh page, routed APIs, the editor mounted with `role`; `versions` is the saved history (content per version). */
  async function scenario(name, options, run) {
    const { role = "owner", width = 1440, height = 900, content = "titleOnly", build: builder = { available: false, configured: false, state: "off" }, live = 0, save = "ok" } = options;
    const context = await browser.newContext({ viewport: { width, height } }), page = await context.newPage(), errors = [], writes = [], foreign = [];
    page.setDefaultTimeout(10000);
    page.on("pageerror", error => errors.push(error.message));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, route => { foreign.push(route.request().url()); return route.abort(); });
    const state = { versions: [versionOf(1, contents[content]())], title: TITLE, live, save, posts: [] };
    await page.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      if (method !== "GET") writes.push(`${method} ${url.pathname}`);
      const match = url.pathname.match(/^\/api\/cloud\/workspaces\/[^/]+\/artifacts\/([^/]+)(\/.*)?$/);
      if (url.pathname === "/api/build") return route.fulfill({ json: builder });
      if (/\/brand-kits$/.test(url.pathname)) return route.fulfill({ json: { kits: [] } });
      if (match && match[1] === ids.site && !match[2] && method === "GET")
        return route.fulfill({ json: { artifact: artifactOf(state.versions.length, state.title), versions: state.versions, pagination: { offset: 0, total: state.versions.length, nextOffset: null } } });
      if (match && match[2] === "/publication" && method === "GET") return route.fulfill({ json: { site: state.live ? { slug: "saffron-test", live: true, version_number: state.live, revision: 1 } : null, address: state.live ? "https://sites.makeborne.com/saffron-test" : null } });
      if (match && match[2] === "/versions" && method === "POST") {
        const body = request.postDataJSON(); state.posts.push(body);
        if (state.save === "conflict" || body.expectedVersion !== state.versions.length) return route.fulfill({ status: 409, json: { error: { code: "VERSION_CONFLICT", message: "Another version was saved first." } } });
        const number = state.versions.length + 1, version = versionOf(number, body.content, body.changeSummary);
        state.versions.push(version); state.title = body.content.title;
        return route.fulfill({ json: { artifact: artifactOf(number, state.title), version, mutation: { idempotencyKey: request.headers()["idempotency-key"], replayed: false } } });
      }
      return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Not in this fixture." } } });
    });
    try {
      await page.goto(origin); await page.waitForFunction(() => window.mountEditor);
      await page.evaluate(([artifact, role]) => window.mountEditor({ artifact, role }), [artifactOf(1), role]);
      await page.locator("[data-editor-chrome=header] .ph-save:not([data-state=loading])").waitFor();
      await run(page, { state, writes });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no horizontal page scroll");
      assert.deepEqual(errors, [], "no page errors");
      assert.deepEqual(foreign, [], "no request left 127.0.0.1");
      if (shots) await page.screenshot({ path: path.join(shots, `editor-journey-${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}.png`) });
      console.log(`PASS ${name}`); results.push({ name, pass: true });
    } catch (error) {
      const message = String(error.message).split("\n");
      failures.push(name); results.push({ name, pass: false });
      console.log(`FAIL ${name}: ${message.slice(0, 3).join(" | ")}`);
    } finally { await context.close(); }
  }
  const header = page => page.locator("[data-editor-chrome=header]");
  const stage = page => page.locator(".cloud-workbench-content");

  try {
    for (const [label, builder] of [["no builder", undefined], ["builder paused", { available: false, configured: true, state: "paused" }]])
      for (const [width, height] of [[1440, 900], [390, 844]]) await scenario(`content-only website, ${label}, ${width}: Preview shows the saved content like the review page`, { build: builder, width, height }, async page => {
        const preview = stage(page).getByRole("region", { name: "Project layout preview" });
        await preview.waitFor();
        assert.match(await preview.innerText(), /Saffron Table/, "the saved heading is shown");
        assert.equal(await stage(page).getByText(/Your website starts here/).count(), 0, "not the empty start state");
        assert.match(await stage(page).locator(".cloud-workbench-start-note").innerText(), /Nothing has been built yet\. This is a layout preview of your saved content, the same view a client review link shows\./);
        assert.equal(await page.locator("iframe").count(), 0, "a layout preview, no frame or scripts");
      });
    await scenario("a draft with no saved blocks keeps the empty start state", { content: "empty" }, async page => {
      await stage(page).getByText(/Your website starts here/).waitFor();
      assert.equal(await stage(page).getByRole("region", { name: "Project layout preview" }).count(), 0);
    });
    await scenario("with the builder ready, a new project still invites the first build", { build: { available: true, configured: true, state: "ready" } }, async page => {
      await stage(page).getByText(/Describe your website in the chat to start building/).waitFor();
      assert.equal(await stage(page).getByRole("region", { name: "Project layout preview" }).count(), 0);
    });
  } finally { await browser.close(); server.close(); }
  console.log(`\n${results.filter(item => item.pass).length}/${results.length} editor journey scenarios passed.`);
  if (failures.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
