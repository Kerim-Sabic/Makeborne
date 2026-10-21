/* eslint-disable @typescript-eslint/no-require-imports -- Mounted document preview, build conversation and studio creation modal in Chromium (Lovable reconciliation: font coverage, source vs generated outputs, M09 completion). Files live in the browser's real IndexedDB; APIs are routed; no AI calls, no network beyond 127.0.0.1.
 * Run: node scripts/check-source-output-browser.cjs [--baseline=<git rev>]  (SHOTS_DIR=<dir> saves 1440/375/320 screenshots)
 * --baseline bundles every src/ file from that revision instead (files new since then come from the working copy). studio.tsx's internal CreateModal is exported for the fixture by the bundler only. */
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs"), { execFileSync } = require("node:child_process");
const { build } = require("esbuild"), { browserType, engineLabel } = require("./browser-engine.cjs"), { createServer } = require("node:http");
const fixtures = require("../src/lib/documents/fixtures/design-quality.cjs");

const baseline = process.argv.find(arg => arg.startsWith("--baseline="))?.slice("--baseline=".length) ?? null;
const shots = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : null;
const ids = { account: "11111111-1111-4111-8111-111111111111", workspace: "22222222-2222-4222-8222-222222222222", artifact: "44444444-4444-4444-8444-444444444444", request: "99999999-9999-4999-8999-999999999999" };
const book = fixtures.book("fraunces");
book.chapters[1] = { ...book.chapters[1], title: "Ćevapčići and Добро пожаловать" };

const fixture = `import React from "react";import{createRoot}from"react-dom/client";import DocumentPreview from"./src/components/document-preview";import BuildConversation from"./src/components/build-conversation";import{__CreateModal}from"./src/components/studio";import{setCloudAccount}from"./src/components/cloud-api";import * as storage from"./src/lib/attachments";
const ids=${JSON.stringify(ids)};setCloudAccount(ids.account);const owner="account:"+ids.account;
const root=()=>createRoot(document.getElementById("root"));
const makeFile=spec=>spec.pdf?new File(["%PDF-1.4\\n%fixture\\n"],spec.name,{type:"application/pdf"}):new File([spec.text],spec.name,{type:spec.type||""});
window.seed=(context,specs,who=owner)=>storage.addAttachments(who,context,specs.map(makeFile));
window.projectContext=storage.projectAttachmentKey(ids.account+":"+ids.workspace+":"+ids.artifact);
window.mountPreview=()=>root().render(<main style={{height:"100vh",display:"grid"}}><DocumentPreview document={${JSON.stringify(book)}} scope={{accountId:ids.account,workspaceId:ids.workspace,artifactId:ids.artifact}} savedVersion={2} canExport={true}/></main>);
window.mountConversation=(device=false)=>root().render(<BuildConversation projectKey={device?"device:local-1":ids.account+":"+ids.workspace+":"+ids.artifact} brief="A website for a bakery" kind="website" onOpenEditor={()=>{}}/>);
window.mountModal=()=>root().render(<__CreateModal directStart={false} initialMode="create" initialEffort="medium" requestId={ids.request} initialAttachmentOwner={owner} initialGenerationConsent={null} initialWorkspaceId={null} initialClient="" initialBrief="A website for a bakery" initialTitle="" initialStyle="" kind="website" onKind={()=>{}} clients={[]} styles={[]} close={()=>{}} accountCreated={()=>{}}/>);`;
const mocks = {
  "use-creation-account": `export function useCreationAccount(){return{ready:true,error:"",accountId:${JSON.stringify(ids.account)},workspace:{id:${JSON.stringify(ids.workspace)},name:"Fixture workspace",role:"owner"},clients:[],workspaces:[]}}`,
  "generation-permissions": "export function useGenerationConsent(){return{ready:true,enabled:false,consent:null}}export default function GenerationPermissions(){return null}",
  "studio-account": "export default function StudioAccount(){return null}", "template-gallery": "export default function TemplateGallery(){return null}",
  "supabase-client": "export function createClient(){return{auth:{getUser:async()=>({data:{user:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}}",
  "next/link": "import React from'react';export default function Link({href,children,prefetch,...rest}){return <a href={typeof href==='string'?href:'#'} {...rest}>{children}</a>}",
  "next/image": "import React from'react';export default function Image({src,alt,width,height,priority,...rest}){return <img src={src} alt={alt} width={width} height={height} {...rest}/>}",
  "next/navigation": "export function useRouter(){return{push(){},replace(){},refresh(){},prefetch(){}}}export function usePathname(){return'/studio'}export function useSearchParams(){return new URLSearchParams()}",
  "next/dynamic": "export default function dynamic(){return function Dynamic(){return null}}",
};
const mockFilter = /(?:^|[\\/])(use-creation-account|generation-permissions|studio-account|template-gallery)$|^@\/lib\/supabase\/client$|^next\/(link|image|navigation|dynamic)$/;
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
      b.onLoad({ filter: /[\\/]src[\\/].*\.tsx?$/ }, args => {
        let contents = sourceText(args.path);
        // Fixture-only: mount the creation modal without the whole studio page.
        if (args.path.endsWith(`${path.sep}components${path.sep}studio.tsx`)) contents += "\nexport { CreateModal as __CreateModal };\n";
        return { contents, loader: args.path.endsWith(".tsx") ? "tsx" : "ts", resolveDir: path.dirname(args.path) };
      });
    } }] });
  const globals = sourceText(path.resolve("src/app/globals.css")).replace(/@import[^;]+;/g, "") + sourceText(path.resolve("src/app/live-builder.css"));
  return { js: output.outputFiles[0].contents, html: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${globals}${css.join("\n")}</style><div id="root"></div><script src="/fixture.js"></script>` };
}

async function main() {
  const { js, html } = await bundle();
  const server = createServer((req, res) => { const script = req.url === "/fixture.js"; res.setHeader("Content-Type", script ? "text/javascript" : "text/html"); res.end(script ? js : html); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await browserType.launch({ headless: true });
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const results = [];
  const tag = baseline ? `baseline-${baseline}` : "current";
  async function scenario(name, item, run) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors = [];
    page.setDefaultTimeout(baseline ? 5000 : 15000);
    page.on("pageerror", error => errors.push(error.message));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
    await page.route("**/api/**", route => route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Not in this fixture." } } }));
    await page.route("**/builder-runtime/**", route => route.fulfill({ status: 404, body: "" }));
    try {
      await page.goto(origin); await page.waitForFunction(() => window.mountPreview);
      await run(page);
      assert.deepEqual(errors, [], "no page errors");
      console.log(`PASS [${item}] ${name}`); results.push({ item, pass: true });
    } catch (error) {
      const message = String(error.message).split("\n"), waiting = message.find(line => /waiting for/.test(line))?.replace(/\x1b\[\d+m/g, "").trim();
      console.log(`FAIL [${item}] ${name}: ${message[0]}${waiting ? ` (${waiting})` : ""}`); results.push({ item, pass: false });
    } finally { await context.close(); }
  }
  async function capture(page, label, selector) {
    if (!shots) return;
    for (const width of [1440, 375, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 820 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await page.locator(selector).first().screenshot({ path: path.join(shots, `${tag}-${label}-${width}.png`) });
      if (!baseline) assert.ok(overflow <= 1, `${label} at ${width}px: no horizontal page scroll (${overflow}px)`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  const MIXED = [{ name: "menu.pdf", pdf: true }, { name: "notes.txt", text: "Open since 2009." }, { name: "prices.csv", text: "item,price\nloaf,4.50", type: "text/csv" }];
  const states = page => page.locator(".attachment-chip").evaluateAll(chips => chips.map(chip => `${chip.querySelector(".attachment-details strong")?.textContent}: ${chip.querySelector(".attachment-state strong")?.textContent ?? "(no state)"}`));

  try {
    await scenario("document preview names characters its fonts don't cover and letters typed with separate accents", "7 font coverage (documents)", async page => {
      await page.evaluate(() => window.mountPreview());
      const note = page.getByRole("note", { name: "Font coverage" });
      await note.waitFor();
      const text = await note.innerText();
      assert.match(text, /^Some characters aren’t in this book’s fonts: Д о б р п ж а л в т ь \(chapter 2\)\. The fonts embed Latin and Latin Extended letters only/);
assert.match(text, /Letters typed with separate accent marks: c \+ U\+030C → č, c \+ U\+0301 → ć \(chapter 2\)/);
      await capture(page, "7-document-fonts", ".dp");
    });

    await scenario("the document preview labels PDF/PPTX as generated outputs of the saved version", "8 source vs outputs", async page => {
      await page.evaluate(() => window.mountPreview());
      const group = page.getByRole("group", { name: "Generated outputs from saved version 2" });
      await group.waitFor();
      assert.equal(await group.locator(".dp-outputs-label").innerText(), "Generated · v2");
      assert.match(await group.getByRole("button", { name: /PDF/ }).getAttribute("title"), /^Generated output: download saved version 2 as PDF$/);
    });

    await scenario("the build conversation shows each project file's AI state under a Source files heading, with the PDF limit stated", "9 M09 build conversation", async page => {
      await page.evaluate(async specs => { await window.seed(window.projectContext, specs); window.mountConversation(); }, MIXED);
      await page.locator(".attachment-chip[data-state='unsupported']").waitFor();
      await page.waitForFunction(() => document.querySelectorAll(".attachment-chip").length === 3 && !document.querySelector(".attachment-chip[data-state='checking']"));
      assert.deepEqual(await states(page), ["menu.pdf: Will be read by AI.", "notes.txt: Will be read by AI.", "prices.csv: AI can’t read this type."]);
      assert.match(await page.locator(".attachment-read").innerText(), /^With the next AI build · Will be read: menu\.pdf, notes\.txt$/);
      assert.match(await page.locator(".attachment-heading").innerText(), /^Source files\s+your uploads · AI reads them, never changes them$/);
      assert.match(await page.locator(".attachment-chip[data-state='ready']").first().innerText(), /can’t show whether a page \(such as a scan or a chart\) was only partly understood/);
      await capture(page, "9-build-conversation", ".build-conversation");
    });

    await scenario("a device-only project, which can't build with AI, doesn't claim AI will read its files", "9 M09 build conversation", async page => {
      await page.evaluate(async specs => { await window.seed("project:device:local-1", specs, "device"); window.mountConversation(true); }, MIXED.slice(1, 2));
      await page.locator(".attachment-chip").waitFor();
      assert.equal(await page.locator(".attachment-readiness").count(), 0);
      assert.match(await page.locator(".attachment-note").innerText(), /AI building works in projects saved to your account/);
    });

    await scenario("the studio creation modal shows the same per-file AI states", "9 M09 creation modal", async page => {
      await page.evaluate(async ({ specs, request }) => { await window.seed(`draft:${request}`, specs); window.mountModal(); }, { specs: MIXED, request: ids.request });
      await page.locator(".attachment-chip[data-state='unsupported']").waitFor();
      // Each file is read on its own; wait until none is still being checked (the reads finish later in WebKit).
      await page.waitForFunction(() => document.querySelectorAll(".attachment-chip").length === 3 && !document.querySelector(".attachment-chip[data-state='checking']"));
      assert.deepEqual(await states(page), ["menu.pdf: Will be read by AI.", "notes.txt: Will be read by AI.", "prices.csv: AI can’t read this type."]);
      assert.match(await page.locator(".attachment-read").innerText(), /^When your project builds · Will be read: menu\.pdf, notes\.txt$/);
      await capture(page, "9-creation-modal", ".attachment-section");
    });
  } finally { await browser.close(); server.close(); }
  console.log(`\n${results.filter(result => result.pass).length}/${results.length} mounted source/output checks passed${baseline ? ` against baseline ${baseline}` : ""} (${engineLabel}, real IndexedDB, routed API, no AI).`);
  if (!baseline && results.some(result => !result.pass)) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exit(1); });
