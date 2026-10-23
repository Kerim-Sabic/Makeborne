/* eslint-disable @typescript-eslint/no-require-imports -- Mounted website editor (CloudEditor) and domains panel in Chromium (Lovable reconciliation, publishing and output): saved/checked/live facts in the header and History, the per-page publish report with audience line and Copy link, SEO on the prepared output, unconfirmed claims, rendered-state contrast, the font-coverage warning, and last successful vs last attempted domain check. Every API is answered by Playwright routes with a fictional site; nothing is published, no provider or AI call is made, no network beyond 127.0.0.1.
 * Run: node scripts/check-publish-output-browser.cjs [--baseline=<git rev>]  (SHOTS_DIR=<dir> saves 1440/375/320 screenshots)
 * --baseline bundles every src/ file from that revision instead (files new since then come from the working copy), to show what the earlier code lacks. */
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs"), { execFileSync } = require("node:child_process");
const { build } = require("esbuild"), { browserType, engineLabel } = require("./browser-engine.cjs"), { createServer } = require("node:http");

const baseline = process.argv.find(arg => arg.startsWith("--baseline="))?.slice("--baseline=".length) ?? null;
const shots = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : null;
const ids = { account: "11111111-1111-4111-8111-111111111111", workspace: "22222222-2222-4222-8222-222222222222", project: "33333333-3333-4333-8333-333333333333",
  artifact: "44444444-4444-4444-8444-444444444444", prep: "55555555-5555-4555-8555-555555555555", user: "66666666-6666-4666-8666-666666666666", domain: "77777777-7777-4777-8777-777777777777" };
const toolchain = file => fs.readFileSync(path.resolve("infra/project-runtime/toolchain", file), "utf8");
const APP = `import "@makeborne/fonts/fraunces.css";
export default function App() {
  return <main>
    <h1>Ovenbird Bakehouse</h1>
    <p>Award-winning sourdough from £4.50. Call +44 131 496 0000.</p>
    <p>Добро пожаловать</p>
  </main>;
}`;
const source = { schemaVersion: 1, toolchainId: "react-vite-v1", entrypoint: "src/main.tsx", assets: [], routes: [{ path: "/", title: "Home" }, { path: "/menu", title: "Menu" }],
  files: [{ path: "package.json", content: toolchain("package.json") }, { path: "package-lock.json", content: toolchain("package-lock.json") },
    { path: "index.html", content: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Ovenbird Bakehouse</title><meta name="description" content="Sourdough in Leith."></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>' },
    { path: "src/main.tsx", content: 'import { createRoot } from "react-dom/client";\nimport App from "./App";\ncreateRoot(document.getElementById("root")!).render(<App />);' },
    { path: "src/App.tsx", content: APP }] };
const style = { id: "automatic", name: "Automatic", version: 1, typography: { headingFont: "Inter", bodyFont: "Inter" }, colors: { canvas: "#FFFFFF", ink: "#000000", accent: "#3559D8" }, description: "Fixture direction", referenceAssetIds: [] };
const versionOf = number => ({ id: `88888888-8888-4888-8888-88888888888${number}`, artifactId: ids.artifact, number, parentVersionId: number > 1 ? `88888888-8888-4888-8888-88888888888${number - 1}` : null,
  content: { schemaVersion: 1, kind: "website", title: "Ovenbird Bakehouse", sections: [], websiteSource: source }, style, assetIds: [], createdAt: `2026-10-2${number}T09:00:00.000Z`, createdBy: ids.user, changeSummary: `Fixture version ${number}` });
const artifact = current => ({ id: ids.artifact, projectId: ids.project, kind: "website", title: "Ovenbird Bakehouse", currentVersion: current, createdAt: "2026-10-20T09:00:00.000Z", updatedAt: "2026-10-23T09:00:00.000Z" });
// Prepared pages as the hosted renderer writes them: a real head, a nav with a low-contrast hover colour.
const PAGE_CSS = "body{margin:0;background:#fff;color:#1d1d24;font:16px/1.5 system-ui}nav{background:#fff;padding:12px}nav a{color:#1d1d24}nav a:hover{color:#c9c9d1}";
const preparedPage = (path, title, description) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${description ? `<meta name="description" content="${description}">` : ""}<link rel="canonical" href="https://sites.makeborne.com/ovenbird-test${path === "/" ? "" : path}"><meta property="og:title" content="${title}"><meta name="twitter:card" content="summary"><style>${PAGE_CSS}</style></head><body><nav><a href="/">Home</a> <a href="/menu">Menu</a></nav><main><h1>${title}</h1><p>Award-winning sourdough from £4.50 — open Mon–Fri 8am–4pm. Our bakers have shaped loaves on Shore Street for years, and every loaf is proved for a full day before baking.</p></main></body></html>`;
const ROUTES = [{ path: "/", html: preparedPage("/", "Ovenbird Bakehouse", "Wood-fired sourdough, pastries and coffee in Leith, baked every morning by a small team.") }, { path: "/menu", html: preparedPage("/menu", "Menu · Ovenbird Bakehouse", "") }];
const prepared = version => ({ id: ids.prep, state: "ready", workspaceId: ids.workspace, artifactId: ids.artifact, version, publicationRevision: 4, slug: "ovenbird-test", interactive: false, expiresAt: "2030-01-01T00:00:00Z", error: null, previewHtml: ROUTES[0].html, previewRoutes: ROUTES });
const liveSite = version => ({ slug: "ovenbird-test", live: true, version_number: version, revision: 4, updated_at: "2026-10-22T09:00:00Z", interactive: false, scripted: false });

const fixture = `import React from "react";import{createRoot}from"react-dom/client";import{CloudEditor}from"./src/components/cloud-studio";import WebsiteDomains from"./src/components/website-domains";import{setCloudAccount}from"./src/components/cloud-api";
const ids=${JSON.stringify(ids)};setCloudAccount(ids.account);
window.mountEditor=current=>createRoot(document.getElementById("root")).render(<CloudEditor accountId={ids.account} workspaceId={ids.workspace} artifact={${JSON.stringify(artifact(3)).replace(/"currentVersion":3/, '"currentVersion":0')}} project={{brief:"",effort:"medium",clientId:null}} role="owner" back={()=>{}} notify={()=>{}}/>);
window.mountDomains=()=>createRoot(document.getElementById("root")).render(<main style={{maxWidth:720,margin:"0 auto",padding:16}}><WebsiteDomains accountId={ids.account} workspaceId={ids.workspace} artifactId={ids.artifact}/></main>);`;
const NULL = "export default function Stub(){return null}";
const mocks = {
  "live-builder": NULL, "live-preview": NULL, "build-conversation": NULL, "document-preview": NULL, "website-generation": NULL, "saved-website-preview": NULL, "pending-cloud-writes": NULL,
  "cloud-client-outreach": NULL, "account-export": NULL, "client-review-panel": NULL, "website-github": NULL, "website-source-download": NULL, "version-compare": NULL, "website-analytics": NULL,
  "website-portal-settings": NULL, "account-preview": NULL, "account-artwork-upload": NULL, "workbench-more": "export default function More({children}){return children}", "account-style-editor": NULL, "website-enquiries": NULL,
  "publish-snapshot": `export async function captureProjectSnapshot(){return ${JSON.stringify(ROUTES[0].html)}}export async function captureProjectPublication(){throw new Error("not used")}`,
  "supabase-client": "export function createClient(){return{auth:{getUser:async()=>({data:{user:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}}",
  "next/dynamic": "export default function dynamic(){return function Dynamic(){return null}}",
  "next/link": "import React from'react';export default function Link({href,children,prefetch,...rest}){return <a href={typeof href==='string'?href:'#'} {...rest}>{children}</a>}",
  "next/navigation": "export function useRouter(){return{push(){},replace(){},refresh(){},prefetch(){}}}export function usePathname(){return'/'}export function useSearchParams(){return new URLSearchParams()}",
};
const mockFilter = /(?:^|[\\/])(live-builder|live-preview|build-conversation|document-preview|website-generation|saved-website-preview|pending-cloud-writes|cloud-client-outreach|account-export|client-review-panel|website-github|website-source-download|version-compare|website-analytics|website-portal-settings|account-preview|account-artwork-upload|workbench-more|account-style-editor|website-enquiries|publish-snapshot)$|^@\/lib\/supabase\/client$|^next\/(dynamic|link|navigation)$/;
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
  const results = [];

  /** One independent scenario: fresh page, routed APIs, the editor (or domains panel) mounted. */
  async function scenario(name, item, setup, run) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors = [], writes = [];
    page.setDefaultTimeout(baseline ? 5000 : 15000);
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => { window.copied = text; } } }); });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
    const state = { saved: 3, site: liveSite(2), prep: prepared(3), domainCheck: "fail", ...setup };
    const base = `/api/cloud/workspaces/${ids.workspace}/artifacts/${ids.artifact}`;
    await page.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      if (method !== "GET") writes.push(`${method} ${url.pathname}`);
      if (url.pathname === base && method === "GET") return route.fulfill({ json: { artifact: artifact(state.saved), versions: Array.from({ length: state.saved }, (_, index) => versionOf(index + 1)), pagination: { offset: 0, total: state.saved, nextOffset: null } } });
      if (url.pathname === `${base}/publication/preparation` && method === "GET") return route.fulfill({ json: { available: true, preparation: state.prep } });
      if (url.pathname === `${base}/publication` && method === "GET") return route.fulfill({ json: { site: state.site, address: state.site ? `https://sites.makeborne.com/${state.site.slug}` : null, hosting: { mode: "legacy", interactive: false }, addressPolicy: { enabled: true, allowedSlugs: null, reservedSlugs: [] }, preparationAvailable: true } });
      if (url.pathname === `${base}/publication` && method === "POST") { state.site = liveSite(state.prep.version); return route.fulfill({ json: { site: state.site } }); }
      if (url.pathname === `${base}/domains` && method === "GET") return route.fulfill({ json: { configured: true, target: "sites.makeborne.site", published: true, live: true, domains: [{ id: ids.domain, hostname: "www.ovenbird.co.uk", status: "pending", phase: "certificate", inProgress: false, label: "Certificate setup stopped", detail: "The certificate check timed out. Check the record, then Check now.", error: null, records: [{ type: "CNAME", name: "www", value: "sites.makeborne.site", purpose: "Points your domain at your website." }], lastCheckedAt: "2026-10-19T09:15:00.000Z", url: "https://www.ovenbird.co.uk" }] } });
      if (url.pathname === `${base}/domains/${ids.domain}` && method === "POST") return route.fulfill({ status: 503, json: { error: { code: "DOMAIN_PROVIDER_ERROR", message: "The status couldn't be checked right now. Try again in a minute." } } });
      return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Not in this fixture." } } });
    });
    try {
      await page.goto(origin); await page.waitForFunction(() => window.mountEditor);
      await run(page, state, writes);
      assert.deepEqual(errors, [], "no page errors");
      console.log(`PASS [${item}] ${name}`); results.push({ item, name, pass: true });
    } catch (error) {
      // The first line plus what it was waiting for, so a baseline failure names the missing UI.
      const message = String(error.message).split("\n"), waiting = message.find(line => /waiting for/.test(line))?.replace(/\x1b\[\d+m/g, "").trim();
      failures.push(name); results.push({ item, name, pass: false, error: message[0] });
      console.log(`FAIL [${item}] ${name}: ${message[0]}${waiting ? ` (${waiting})` : ""}`);
    } finally { await context.close(); }
  }
  const openEditor = async page => { await page.evaluate(() => window.mountEditor()); await page.getByRole("heading", { name: "Ovenbird Bakehouse", level: 1 }).waitFor(); };
  // Saved/checked/live facts are in the project details popover (the title button), History in Project actions.
  const openDetails = async page => { const details = page.getByRole("group", { name: "Project details" }); if (!(await details.isVisible())) await page.getByRole("button", { name: "Ovenbird Bakehouse", exact: true }).click(); await details.waitFor(); return details; };
  const closeDetails = async page => { await page.keyboard.press("Escape"); await page.getByRole("group", { name: "Project details" }).waitFor({ state: "hidden" }); };
  const openHistory = async page => { await page.getByRole("button", { name: "Project actions" }).click(); await page.getByRole("group", { name: "Project actions" }).getByRole("button", { name: "Version history" }).click(); };
  const openPublish = async page => { await page.getByRole("button", { name: "Publish", exact: true }).click(); await page.getByRole("heading", { name: "Publish website" }).waitFor(); };
  const tag = baseline ? `baseline-${baseline}` : "current";
  async function capture(page, label, locator) {
    if (!shots) return;
    for (const width of [1440, 375, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 820 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const target = locator ? page.locator(locator).first() : page;
      await target.screenshot({ path: path.join(shots, `${tag}-${label}-${width}.png`), ...(locator ? {} : { fullPage: false }) });
      if (!baseline) assert.ok(overflow <= 1, `${label} at ${width}px: no horizontal page scroll (${overflow}px)`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  }

  try {
    await scenario("header shows saved, checked and live side by side; History marks Live, Current and Checked", "1 saved/checked/live", {}, async page => {
      await openEditor(page);
      const details = await openDetails(page);
      const facts = details.getByRole("list", { name: "Saved, checked and live versions" });
      await facts.waitFor();
      await details.getByText("Live version 2", { exact: true }).waitFor();
      assert.deepEqual(await facts.locator("li").allInnerTexts(), ["Saved version 3", "Not checked yet", "Live version 2"]);
      assert.equal((await page.locator(".version-facts-notice").innerText()).trim(), "Newer saved changes aren’t live yet: version 3 is saved, version 2 is live. Publish to update the site.");
      await capture(page, "1-header-not-live", "[data-editor-chrome=header]");
      await closeDetails(page);
      await openPublish(page);
      await page.getByRole("button", { name: "Check my site" }).click();
      await page.locator(".ws-checked").waitFor();
      await (await openDetails(page)).getByText("Checked version 3 (prepared pages)", { exact: true }).waitFor();
      await closeDetails(page);
      await openHistory(page);
      const v3 = page.locator(".cloud-version").filter({ hasText: "Version 3" }).first(), v2 = page.locator(".cloud-version").filter({ hasText: "Version 2" }).first();
      await v3.locator(".cloud-version-checked").waitFor();
      assert.deepEqual(await v3.locator("strong span").allInnerTexts(), ["Checked", "Current"]);
      assert.deepEqual(await v2.locator("strong span").allInnerTexts(), ["Live"]);
      await capture(page, "1-history-markers", ".cloud-workbench-history");
    });

    await scenario("publish report per page, audience line next to consent, Copy link after publishing; the header turns live", "2 publish report", {}, async (page, state, writes) => {
      await openEditor(page); await openPublish(page);
      const report = page.getByRole("region", { name: "Publish report" });
      await report.waitFor();
      assert.match(await report.locator(".publish-report-heading").innerText(), /Prepared version 3 · 2 pages/);
      const rows = await report.locator(".publish-report-list > li").allInnerTexts();

      assert.equal(rows.length, 2);
      assert.match(rows[0], /^\/\s+Ready[\s\S]*Ovenbird Bakehouse[\s\S]*https:\/\/sites\.makeborne\.com\/ovenbird-test[\s\S]*May be indexed[\s\S]*None \(links show text only\)/);
      assert.match(rows[1], /^\/menu\s+No description[\s\S]*Menu · Ovenbird Bakehouse/);
      const audience = page.locator(".website-publish-audience");
      assert.match(await audience.innerText(), /^Who can see it: anyone with the address — no sign-in\. Search engines may find and list/);
      await capture(page, "2-publish-report", ".website-publish");
      await page.getByRole("checkbox", { name: /I’ve reviewed this prepared version/ }).check();
      await page.getByRole("button", { name: "Publish reviewed website" }).click();
      await page.getByText("Your reviewed website is live.").waitFor();
      assert.deepEqual(writes, [`POST /api/cloud/workspaces/${ids.workspace}/artifacts/${ids.artifact}/publication`], "one promote request");
      // Wait for the published report and refreshed header before clicking in
      // the panel whose prepared iframe has just been removed. Assert the same
      // final state in every engine, without a timing sleep or weaker checks.
      assert.match(await page.getByRole("region", { name: "Publish report" }).locator(".publish-report-heading").innerText(), /Published version 3 · 2 pages/, "the report stays for the published version");
      const published = await openDetails(page);
      await published.getByText("Live version 3", { exact: true }).waitFor();
      assert.equal(await published.locator(".version-facts-notice").innerText(), "", "nothing newer is waiting once version 3 is live");
      await closeDetails(page);
      await page.getByRole("button", { name: "Copy link" }).click();
      await page.getByText("Website address copied.").waitFor();
      assert.equal(await page.evaluate(() => window.copied), "https://sites.makeborne.com/ovenbird-test");
      await capture(page, "2-published-copy-link", ".website-publish");
    });

    await scenario("Check my site reads every prepared page and says so", "3 SEO on prepared output", {}, async page => {
      await openEditor(page); await openPublish(page);
      await page.getByRole("button", { name: "Check my site" }).click();
      const from = page.locator(".ws-checked-from");
      await from.waitFor();
      assert.equal(await from.innerText(), "Read from the prepared pages: all 2 pages, with the titles, descriptions and links they’ll be published with.");
      const results = await page.getByRole("list", { name: "Search checklist" }).innerText();
      assert.match(results, /The page \/menu has no description in the prepared output/, "the nested page is checked from its prepared head, not only home");
      assert.doesNotMatch(results, /checked for titles only/);
      await capture(page, "3-seo-prepared", ".ws");
    });

    await scenario("SEO falls back to the saved source when no matching preparation exists, and labels it", "3 SEO on prepared output", { prep: null }, async page => {
      await openEditor(page); await openPublish(page);
      await page.getByRole("button", { name: "Check my site" }).click();
      const from = page.locator(".ws-checked-from");
      await from.waitFor();
      assert.match(await from.innerText(), /^Read from the saved source: the home page rendered in this browser, other pages by title only\./);
    });

    await scenario("claims to confirm are listed before publishing", "5 unconfirmed claims", {}, async page => {
      await openEditor(page); await openPublish(page);
      const claims = page.getByRole("region", { name: "Claims to confirm before publishing" });
      await claims.waitFor();
      // The list covers the prepared pages once the preparation status has loaded (it answers later in WebKit).
      await claims.getByText(/and its prepared pages\.$/).waitFor();
      const text = await claims.innerText();
      assert.match(text, /Prices and offers/); assert.match(text, /Awards and press/); assert.match(text, /Contact details and addresses/); assert.match(text, /Opening hours/);
      await claims.getByText("Prices and offers").click();
      await claims.getByText("£4.50", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Publish reviewed website" }).isDisabled(), true, "consent still decides; claims never enable or block");
      await page.getByRole("checkbox", { name: /I’ve reviewed this prepared version/ }).check();
      assert.equal(await page.getByRole("button", { name: "Publish reviewed website" }).isEnabled(), true, "claims never block publishing");
      await capture(page, "5-claims", ".site-claims");
    });

    await scenario("colours are measured in hover, focus and error states of the prepared pages", "6 rendered contrast", {}, async page => {
      await openEditor(page); await openPublish(page);
      await page.getByRole("button", { name: "Measure colours in all states" }).click();
      const result = page.locator(".rendered-contrast-result");
      await result.waitFor();
      const text = await result.innerText();
      assert.match(text, /^Measured \d+ text and field colours on 2 prepared pages of version 3 at 1280 px wide\./);
      assert.match(text, /Hover[\s\S]*a “Menu”: 1\.\d+:1, needs 4\.5:1/);
      assert.match(text, /Not measured: text over images or gradients/);
      assert.equal(await page.locator(".rendered-contrast-summary").innerText(), `${await page.locator(".rendered-contrast-list ul > li").count()} below WCAG AA`);
      assert.equal(await page.locator("iframe[title='Colour measurement']").count(), 0, "measurement frames are removed");
      await capture(page, "6-rendered-contrast", ".rendered-contrast");
    });

    await scenario("the client-ready check warns about characters outside the embedded fonts", "7 font coverage", {}, async page => {
      await openEditor(page); await openPublish(page);
      const ready = page.getByRole("region", { name: "Client-ready check" });
      await ready.getByText("Some characters aren’t in the website’s fonts").waitFor();
      await ready.getByText("Some characters aren’t in the website’s fonts").click();
      await ready.getByText(/src\/App\.tsx:6 \(Д\)/).first().waitFor();
      await capture(page, "7-client-ready-fonts", ".client-ready");
    });

    await scenario("domains show the last successful check apart from a failed later attempt", "4 domains", {}, async page => {
      await page.evaluate(() => window.mountDomains());
      await page.getByText("www.ovenbird.co.uk", { exact: true }).waitFor();
      await page.locator(".wd-checked").waitFor();
      // Locale-neutral: "Oct 19, 11:15 AM" or "19 Oct, 11:15" (an earlier day shows its date).
      const earlier = /^Last successful check (?:\w+ \d+|\d+ \w+), \d{1,2}:\d{2}(?: [AP]M)?$/;
      assert.match(await page.locator(".wd-checked").innerText(), earlier);
      await page.getByRole("button", { name: "Check now" }).click();
      await page.locator(".wd-attempt").waitFor();
      assert.match(await page.locator(".wd-attempt").innerText(), /^Last attempt \d{1,2}:\d{2}(?: [AP]M)? couldn’t reach the domain provider, so the status shown is from the last successful check\.$/);
      assert.match(await page.locator(".wd-checked").innerText(), earlier, "the failed attempt doesn't move the successful time");
      await capture(page, "4-domains", ".wd");
    });
  } finally { await browser.close(); server.close(); }
  const items = [...new Set(results.map(result => result.item))];
  console.log(`\n${results.filter(result => result.pass).length}/${results.length} mounted publishing/output checks passed${baseline ? ` against baseline ${baseline}` : ""} (${engineLabel}, routed API, nothing published).`);
  if (baseline) for (const item of items) console.log(`baseline ${item}: ${results.filter(result => result.item === item && !result.pass).length ? "fails (expected before the change)" : "passes"}`);
  if (failures.length && !baseline) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exit(1); });
