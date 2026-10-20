/* eslint-disable @typescript-eslint/no-require-imports -- Mounted advisor → brief → build handoff in Chromium (audit M14): ExpertChat drafts a read-only brief (routed /api/chat/brief), the brief is edited, Use this brief shows target/format/mode/effort/maximum and Cancel sends nothing, Open in composer stores one handoff, the project's LiveBuilder (or the new-project Studio composer) is prefilled without sending, one Send makes one /api/build request carrying the shown maximum and the brief's provenance, and a stale target is refused. Keyboard and 375/320 px. Local HTTP/SSE fixture with fictional data; no provider, database, cloud or paid call.
 * Run: node scripts/check-advisor-handoff-browser.cjs [screenshot-dir] */
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs");
const { build } = require("esbuild"), { chromium } = require("playwright"), { createServer } = require("node:http");

const shots = process.argv[2] ? path.resolve(process.argv[2]) : null;
const ids = { actor: "11111111-1111-4111-8111-111111111111", workspace: "22222222-2222-4222-8222-222222222222", artifact: "33333333-3333-4333-8333-333333333333", book: "77777777-7777-4777-8777-777777777777",
  other: "88888888-8888-4888-8888-888888888888", project: "99999999-9999-4999-8999-999999999999", operation: "44444444-4444-4444-8444-444444444444", run: "55555555-5555-4555-8555-555555555555" };
const fixture = `import React, { useState } from "react"; import { createRoot } from "react-dom/client";
import ExpertChat from "./src/components/expert-chat";
import LiveBuilder from "./src/components/live-builder";
import Studio from "./src/components/studio";
import { useProjectAdvisorHandoff } from "./src/components/advisor-handoff";
const params = new URLSearchParams(location.search), view = params.get("view");
window.__notices = [];
function BuilderHost() {
  // Mirrors CloudEditor: the handoff fills the composer; provenance is recorded with the next new request.
  const artifactId = params.get("artifact") || "${ids.artifact}";
  const [prefill, setPrefill] = useState(null);
  const [version, setVersion] = useState(1);
  const advisor = useProjectAdvisorHandoff({ accountId: "${ids.actor}", workspaceId: "${ids.workspace}", artifactId, kind: "website", canBuild: true, apply: setPrefill, notify: message => { window.__notices.push(message); } });
  return <LiveBuilder key={artifactId} accountId="${ids.actor}" workspaceId="${ids.workspace}" artifactId={artifactId} version={version} history={[]} baseFiles={{ "src/App.tsx": "export default function App() { return <h1>Hello</h1>; }" }} baseAssets={[]}
    defaultEffort="medium" kind="website" prefill={prefill} provenance={advisor.provenance} onProvenance={advisor.update} brandKit={null}
    onLive={() => {}} onSaved={async () => { const value = await fetch("/fixture/version").then(response => response.json()); setVersion(value.version); }} />;
}
createRoot(document.getElementById("root")).render(view === "builder" ? <div style={{ maxWidth: 560 }}><BuilderHost /></div> : view === "studio" ? <Studio /> : <ExpertChat />);`;
const mocks = {
  "next/link": `import React from "react"; export default function Link({ href, children, prefetch, ...rest }) { return <a href={typeof href === "string" ? href : "#"} {...rest}>{children}</a>; }`,
  "next/image": `import React from "react"; export default function Image({ src, alt, fill, sizes, priority, ...rest }) { return <img src={typeof src === "string" ? src : ""} alt={alt} {...rest} />; }`,
  "next/navigation": `export function useRouter() { return { push(href) { (window.__pushes ||= []).push(href); }, replace() {}, refresh() {}, prefetch() {} }; } export function usePathname() { return location.pathname; } export function useSearchParams() { return new URLSearchParams(location.search); }`,
  "next/dynamic": `import React from "react"; export default function dynamic() { return function Dynamic() { return null; }; }`,
  "supabase-client": `const user = { id: "${ids.actor}", email: "owner@example.test" }; export function createClient() { return { auth: { getUser: async () => ({ data: { user }, error: null }), getSession: async () => ({ data: { session: { user } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) } }; }`,
  "use-creation-account": `export function useCreationAccount() { return { ready: true, error: "", accountId: "${ids.actor}", workspace: { id: "${ids.workspace}", name: "Fictional Studio", role: "owner" }, clients: [] }; }`,
  "studio-account": `export default function StudioAccount() { return null; }`,
  "getting-started": `export default function GettingStarted() { return null; }`,
  "account-projects": `export default function AccountProjects() { return null; }`,
  "design-capture": `export async function captureDesign() { throw new Error("Unexpected capture"); }`,
  "cloud-api": `export function setCloudAccount() {} export class CloudError extends Error {} export function getPendingCloudWrites() { return []; } export function cloudAccountGuard() { return () => true; }
    export async function api(url, body, method = "POST") { const response = await fetch(url, body ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined); if (!response.ok) throw new Error("Request failed"); return response.json(); }
    export async function readCloudImage() { throw new Error("Unexpected image"); } export async function uploadCloudImage() { throw new Error("Unexpected upload"); }`,
};
const mockFor = request => request.startsWith("next/") ? request
  : /[\\/]supabase[\\/]client$/.test(request) ? "supabase-client"
  : /(?:^|[\\/])(use-creation-account|studio-account|getting-started|account-projects|design-capture|cloud-api)$/.exec(request)?.[1];

const draftedBrief = { title: "Harbour Bakery website", format: "website", goal: "Get more weekend pre-orders", audience: "Local families and cafés",
  sections: ["Home: this weekend's bake", "Order ahead", "Visit us"], tone: "Warm and plain", constraints: ["No stock photos of other bakeries"],
  sources: ["2026 price list (PDF)", "Instagram highlights"], openQuestions: ["Pickup only, or delivery too?"], mode: "create" };
const conversation = { mira: [{ role: "user", content: "I run Harbour Bakery and want more weekend pre-orders." }, { role: "assistant", content: "Lead with ordering ahead and show this weekend's bake.", mode: "standard", credits: 1 }] };
const operation = extra => ({ id: ids.operation, revision: 1, kind: "build", effort: "high", authorizedCredits: 90, chargedCredits: 0, reservedCredits: 90, remainingCredits: 0, maximumAdditionalCredits: 0, status: "running", cancelRequested: false, pendingKind: null, lastVersion: 1, canContinue: false, recoverable: false, expiresAt: "2030-01-01T00:00:00Z", ...extra });

async function bundle() {
  const css = [];
  const output = await build({ stdin: { contents: fixture, loader: "jsx", resolveDir: process.cwd() }, write: false, bundle: true, platform: "browser", jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
    logLevel: "silent", plugins: [{ name: "fixture", setup(b) {
      b.onResolve({ filter: /.*/ }, args => { const mock = mockFor(args.path); return mock && mocks[mock] ? { path: mock, namespace: "mock" } : undefined; });
      b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path], loader: "jsx", resolveDir: process.cwd() }));
      b.onResolve({ filter: /^@\// }, args => {
        const base = path.resolve("src", args.path.slice(2));
        const found = [base, `${base}.tsx`, `${base}.ts`].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
        const mock = mockFor(found ?? args.path);
        return mock && mocks[mock] ? { path: mock, namespace: "mock" } : { path: found };
      });
      b.onLoad({ filter: /\.css$/ }, args => { css.push(fs.readFileSync(args.path, "utf8")); return { contents: "", loader: "js" }; });
    } }] });
  const styles = [fs.readFileSync("src/app/globals.css", "utf8"), ...new Set(css), fs.readFileSync("src/app/live-builder.css", "utf8"), fs.readFileSync("src/app/studio-refresh.css", "utf8")].join("\n").replace(/@import[^;]+;/g, "");
  return { js: output.outputFiles[0].contents, styles };
}

async function main() {
  const { js, styles } = await bundle();
  let state;
  const json = (res, value, status = 200) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(value)); };
  const server = createServer(async (req, res) => { try {
    const { pathname } = new URL(req.url, "http://localhost");
    if (pathname === "/fixture.js") { res.setHeader("content-type", "text/javascript"); return res.end(js); }
    if (!pathname.startsWith("/api/") && !pathname.startsWith("/fixture/")) { res.setHeader("content-type", "text/html"); return res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}*{box-sizing:border-box}${styles}</style><div id="root"></div><script src="/fixture.js"></script>`); }
    const current = state; let text = ""; for await (const chunk of req) text += chunk; const body = text ? JSON.parse(text) : null;
    current.requests.push({ method: req.method, path: pathname, body });
    if (pathname === "/fixture/version") return json(res, { version: current.version });
    if (pathname === "/api/chat/brief") { await new Promise(resolve => setTimeout(resolve, 250)); return json(res, { brief: draftedBrief, charged: 1 }); }
    if (pathname === "/api/workspaces") return json(res, { workspaces: [{ id: ids.workspace, name: "Fictional Studio", role: "owner" }] });
    if (pathname === `/api/cloud/workspaces/${ids.workspace}`) return json(res, { artifacts: [
      { id: ids.artifact, projectId: ids.project, kind: "website", title: "Harbour Bakery", currentVersion: 1, createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-02T10:00:00Z" },
      { id: ids.book, projectId: ids.project, kind: "book", title: "Bakery Recipes", currentVersion: 1, createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-02T10:00:00Z" }] });
    if (pathname === "/api/credits") return json(res, { available: 500, unlimited: false });
    if (pathname === "/api/build/questions") return json(res, { questions: [] });
    if (pathname === "/api/build/plan" && req.method === "GET") return json(res, { stored: null });
    if (pathname === "/api/build/operations") return current.operation ? json(res, { operation: current.operation, result: current.result ?? null, recovery: null }) : json(res, { error: { message: "Not recorded" } }, 404);
    if (pathname === "/api/build" && req.method === "POST") {
      current.builds.push(body);
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" }); res.flushHeaders();
      const emit = event => res.write(`data: ${JSON.stringify(event)}\n\n`);
      current.operation = operation({ lastVersion: body.expectedVersion });
      emit({ type: "operation", operation: current.operation });
      await new Promise(resolve => setTimeout(resolve, 300));
      current.version = body.expectedVersion + 1;
      current.operation = operation({ status: "completed", reservedCredits: 0, chargedCredits: 12, remainingCredits: 78, lastVersion: current.version });
      current.result = { runId: ids.run, version: current.version, summary: "Built the bakery website.", charged: 12, changed: true, finished: true };
      emit({ ...current.result, type: "done", operation: current.operation }); return res.end();
    }
    // Everything else the studio may ask for is answered as empty and recorded.
    if (req.method === "GET") return json(res, {}, 404);
    current.unexpected.push(`${req.method} ${pathname}`);
    return json(res, { error: { message: "Not in this fixture" } }, 404);
  } catch (error) { state?.errors.push(String(error.message)); if (!res.headersSent) json(res, { error: { message: "Fixture failed" } }, 500); else res.destroy(); } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ headless: true });
  const failures = []; let passed = 0;
  const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const scenario = async (name, run, viewport = { width: 1280, height: 1000 }) => {
    state = { version: 1, requests: [], builds: [], unexpected: [], errors: [], operation: null };
    const current = state, context = await browser.newContext({ viewport }), page = await context.newPage(), errors = [];
    page.setDefaultTimeout(8000); page.on("pageerror", error => errors.push(error.message));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/))/, route => route.abort());
    await page.addInitScript(([key, value]) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value); }, [`makeborne.advisor-chats.v2:${ids.actor}`, JSON.stringify(conversation)]);
    try {
      await run(page, current, context);
      assert.ok(await noScroll(page), "no horizontal page scroll");
      assert.deepEqual(errors, []); assert.deepEqual(current.errors, []); assert.deepEqual(current.unexpected, [], "no unexpected writes");
      if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true }); }
      passed++; console.log(`PASS ${name}`);
    } catch (error) { failures.push(name); console.log(`FAIL ${name}: ${error.message.split("\n").slice(0, 8).join(" | ")}`); if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `${name}-failed.png`), fullPage: true }).catch(() => undefined); } }
    finally { await context.close(); }
  };
  const openAdvisor = async page => { await page.goto(`${base}/?view=advisor`); await page.getByText("Lead with ordering ahead").waitFor(); };
  const draft = async page => {
    await page.getByRole("button", { name: "Draft a project brief" }).dblclick();
    await page.getByRole("heading", { name: "Project brief · revision 1" }).waitFor();
  };
  const handoffs = page => page.evaluate(() => sessionStorage.getItem("makeborne.advisor-handoff.v1"));
  const posts = current => current.requests.filter(request => request.method !== "GET");
  try {
    await scenario("brief-drafted-read-only", async (page, current) => {
      await openAdvisor(page);
      await page.getByText("Standard · up to 3 credits. A summary for you to review; nothing is built.").waitFor();
      await draft(page);
      const briefs = current.requests.filter(request => request.path === "/api/chat/brief");
      assert.equal(briefs.length, 1, "a double click drafts one brief");
      assert.deepEqual(briefs[0].body, { expert: "mira", messages: conversation.mira.map(({ role, content }) => ({ role, content })) }, "only the conversation is sent");
      const card = page.getByRole("region", { name: "Project brief · revision 1" });
      const text = await card.innerText();
      assert.match(text, /Drafted · 1 credit/); assert.match(text, /Advice only: nothing has been built, sent or changed/);
      assert.match(text, /Get more weekend pre-orders/); assert.match(text, /2026 price list \(PDF\)/); assert.match(text, /Names only\. Nothing is fetched or attached/);
      assert.equal(await card.locator("input, textarea").count(), 0, "the brief is read-only until Edit");
      assert.deepEqual(posts(current).map(request => request.path), ["/api/chat/brief"], "drafting creates no project and starts no build");
      await page.reload(); await page.getByRole("heading", { name: "Project brief · revision 1" }).waitFor();
      assert.equal(current.requests.filter(request => request.path === "/api/chat/brief").length, 1, "a reload shows the kept brief without drafting again");
    });

    await scenario("brief-edited-new-revision", async (page, current) => {
      await openAdvisor(page); await draft(page);
      await page.getByRole("button", { name: "Edit brief" }).click();
      await page.getByLabel("Goal").fill("Double weekend pre-orders by spring");
      await page.getByRole("button", { name: "Remove source Instagram highlights" }).click();
      await page.getByLabel("Add a source name").fill("Supplier list");
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Save brief" }).click();
      const card = page.getByRole("region", { name: "Project brief · revision 2" });
      await card.waitFor();
      const text = await card.innerText();
      assert.match(text, /Double weekend pre-orders by spring/); assert.match(text, /Supplier list/); assert.doesNotMatch(text, /Instagram highlights/); assert.match(text, /edited/);
      await page.reload(); await page.getByRole("heading", { name: "Project brief · revision 2" }).waitFor();
      assert.deepEqual(posts(current).map(request => request.path), ["/api/chat/brief"], "editing is local and free");
    });

    await scenario("use-brief-cancel-sends-nothing-keyboard", async (page, current) => {
      await openAdvisor(page); await draft(page);
      await page.getByRole("button", { name: "Use this brief" }).focus();
      await page.keyboard.press("Enter");
      const panel = page.getByRole("group", { name: "Use this brief" });
      await panel.waitFor();
      assert.equal(await page.evaluate(() => document.activeElement?.closest("label")?.textContent?.startsWith("Where")), true, "focus moves to the target choice");
      await panel.getByText("Up to 50 credits", { exact: true }).waitFor();
      assert.match(await panel.innerText(), /charged only when you press Send in the new project’s composer\. Opening the composer sends nothing\./);
      await panel.getByLabel("Effort").selectOption("ultra");
      await panel.getByText("Up to 240 credits", { exact: true }).waitFor();
      await panel.getByRole("radio", { name: "Plan first" }).click();
      await panel.getByText("Up to 10 credits", { exact: true }).waitFor();
      await panel.getByRole("button", { name: "Cancel" }).focus(); await page.keyboard.press("Enter");
      await panel.waitFor({ state: "detached" });
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Use this brief", "focus returns to Use this brief");
      assert.equal(await handoffs(page), null, "Cancel stores no handoff");
      assert.deepEqual(await page.evaluate(() => window.__pushes ?? []), [], "Cancel opens nothing");
      assert.deepEqual(posts(current).map(request => request.path), ["/api/chat/brief"], "Cancel creates no project and no job");
    });

    await scenario("existing-project-prefill-one-send-provenance", async (page, current) => {
      await openAdvisor(page); await draft(page);
      await page.getByRole("button", { name: "Edit brief" }).click(); await page.getByLabel("Tone").fill("Warm, plain and proud"); await page.getByRole("button", { name: "Save brief" }).click();
      await page.getByRole("heading", { name: "Project brief · revision 2" }).waitFor();
      await page.getByRole("button", { name: "Use this brief" }).click();
      const panel = page.getByRole("group", { name: "Use this brief" });
      await panel.getByRole("option", { name: "Harbour Bakery · Website" }).waitFor({ state: "attached" });
      await panel.getByLabel("Where").selectOption({ label: "Harbour Bakery · Website" });
      await panel.getByText("Format: Website (this project’s format)").waitFor();
      await panel.getByLabel("Effort").selectOption("high");
      await panel.getByText("Up to 90 credits", { exact: true }).waitFor();
      assert.match(await panel.innerText(), /press Send in the “Harbour Bakery” composer/);
      await panel.getByRole("button", { name: "Open in composer" }).dblclick();
      const pushes = await page.evaluate(() => window.__pushes);
      assert.equal(pushes.length, 1, "a double click opens the composer once");
      const stored = JSON.parse(await handoffs(page));
      assert.equal(pushes[0], `/studio?tab=projects&workspace=${ids.workspace}&artifact=${ids.artifact}&handoff=${stored.id}`);
      assert.deepEqual({ target: stored.target, format: stored.format, mode: stored.mode, effort: stored.effort, maximum: stored.maximum, revision: stored.provenance.briefRevision, advisor: stored.provenance.advisor },
        { target: { type: "project", workspaceId: ids.workspace, artifactId: ids.artifact, title: "Harbour Bakery" }, format: "website", mode: "create", effort: "high", maximum: 90, revision: 2, advisor: "mira" });
      assert.deepEqual(posts(current).map(request => request.path), ["/api/chat/brief"], "opening the composer sends nothing");

      await page.goto(`${base}/?view=builder&handoff=${stored.id}`);
      const composer = page.getByRole("textbox", { name: "Message the builder" });
      await composer.waitFor();
      await page.waitForFunction(() => document.querySelector("textarea[aria-label='Message the builder']")?.value.includes("Harbour Bakery website"));
      const draftText = await composer.inputValue();
      assert.match(draftText, /^Website: Harbour Bakery website/); assert.match(draftText, /Tone: Warm, plain and proud/); assert.match(draftText, /Pages and sections:\n- Home/);
      assert.equal(await page.getByLabel("Effort").inputValue(), "high");
      assert.equal(await page.getByRole("button", { name: "Build", exact: true }).getAttribute("aria-pressed"), "true");
      await page.getByText("Up to 90 credits for this request, including automatic refinements.").waitFor();
      await page.getByText("From Mira’s brief · revision 2 · recorded with your next request. The advice itself changed nothing here.").waitFor();
      assert.equal(await page.evaluate(() => new URLSearchParams(location.search).has("handoff")), false, "the handoff id leaves the address once read");
      assert.equal(await handoffs(page), null, "the handoff is single use");
      await page.waitForTimeout(400);
      assert.equal(current.builds.length, 0, "nothing is sent until Send");
      if (shots) await page.locator(".lb-composer").screenshot({ path: path.join(shots, "builder-prefilled.png") });
      await page.getByRole("button", { name: "Send", exact: true }).dblclick();
      await page.getByText("Saved as version 2, from version 1.").waitFor();
      assert.equal(current.builds.length, 1, "a double click on Send is one request");
      const sent = current.builds[0];
      assert.equal(sent.approvedMaximum, 90); assert.equal(sent.effort, "high"); assert.ok(sent.operation.actionKey, "a new request with its own action identity");
      assert.deepEqual(sent.provenance, stored.provenance, "the request records the brief it came from");
      assert.equal(sent.message, draftText.trim());
      const receipt = page.getByRole("region", { name: "Request receipt" }).last();
      assert.match(await receipt.innerText(), /Brief\s+From Mira’s brief · revision 2/);
      await page.getByText("Started from Mira’s brief · revision 2").waitFor();
      await page.reload(); await composer.waitFor(); await page.getByText("Started from Mira’s brief · revision 2").waitFor();
      await page.waitForTimeout(300);
      assert.equal(await composer.inputValue(), "", "nothing is put back or re-applied after a reload");
      assert.equal(current.builds.length, 1, "a reload never resends");
    });

    await scenario("plan-mode-prefill-shows-plan-maximum", async (page, current) => {
      await openAdvisor(page); await draft(page);
      await page.getByRole("button", { name: "Use this brief" }).click();
      const panel = page.getByRole("group", { name: "Use this brief" });
      await panel.getByRole("option", { name: "Harbour Bakery · Website" }).waitFor({ state: "attached" });
      await panel.getByLabel("Where").selectOption({ label: "Harbour Bakery · Website" });
      await panel.getByRole("radio", { name: "Plan first" }).click();
      await panel.getByText("Up to 10 credits", { exact: true }).waitFor();
      await panel.getByLabel("Where").selectOption({ label: "Bakery Recipes · Book" });
      await panel.getByText("Plan first is available for websites.").waitFor();
      assert.equal(await panel.getByRole("radio", { name: "Plan first" }).isDisabled(), true);
      await panel.getByText("Up to 50 credits", { exact: true }).waitFor();
      await panel.getByLabel("Where").selectOption({ label: "Harbour Bakery · Website" });
      await panel.getByRole("button", { name: "Open in composer" }).click();
      const stored = JSON.parse(await handoffs(page));
      assert.equal(stored.mode, "plan"); assert.equal(stored.maximum, 10);
      await page.goto(`${base}/?view=builder&handoff=${stored.id}`);
      await page.getByText("Up to 10 credits for this plan.").waitFor();
      assert.equal(await page.locator(".lb-mode button[aria-pressed='true']").innerText(), "Plan", "the builder opens in Plan mode");
      await page.waitForTimeout(300);
      assert.deepEqual(posts(current).map(request => request.path), ["/api/chat/brief"], "no plan or build request until Plan is pressed");
    });

    await scenario("stale-target-refused", async (page, current) => {
      await openAdvisor(page); await draft(page);
      await page.getByRole("button", { name: "Use this brief" }).click();
      const panel = page.getByRole("group", { name: "Use this brief" });
      await panel.getByRole("option", { name: "Harbour Bakery · Website" }).waitFor({ state: "attached" });
      await panel.getByLabel("Where").selectOption({ label: "Harbour Bakery · Website" });
      await panel.getByRole("button", { name: "Open in composer" }).click();
      const stored = JSON.parse(await handoffs(page));
      await page.goto(`${base}/?view=builder&artifact=${ids.other}&handoff=${stored.id}`);
      await page.getByRole("textbox", { name: "Message the builder" }).waitFor();
      await page.waitForFunction(() => window.__notices.length > 0);
      assert.match((await page.evaluate(() => window.__notices))[0], /prepared for a different project/);
      assert.equal(await page.getByRole("textbox", { name: "Message the builder" }).inputValue(), "", "another project's composer stays empty");
      assert.equal(await page.locator(".lb-provenance").count(), 0);
      assert.notEqual(await handoffs(page), null, "the brief stays for the project it was made for");
      assert.equal(current.builds.length, 0);
    });

    await scenario("new-project-composer-prefilled", async (page, current) => {
      await openAdvisor(page); await draft(page);
      await page.getByRole("button", { name: "Use this brief" }).click();
      const panel = page.getByRole("group", { name: "Use this brief" });
      await panel.getByLabel("Format").selectOption("presentation");
      await panel.getByLabel("Effort").selectOption("light");
      await panel.getByText("Up to 20 credits", { exact: true }).waitFor();
      await panel.getByRole("button", { name: "Open in composer" }).click();
      const stored = JSON.parse(await handoffs(page));
      assert.deepEqual(await page.evaluate(() => window.__pushes), [`/studio?handoff=${stored.id}`]);
      await page.goto(`${base}/?view=studio&handoff=${stored.id}`);
      const banner = page.locator(".advisor-handoff-banner");
      await banner.waitFor({ timeout: 15000 });
      assert.match(await banner.innerText(), /From Mira’s brief · revision 1[\s\S]*Presentation · Build · Light effort · up to 20 credits when you press Send in the builder\. Nothing has been sent or charged\./);
      assert.match(await page.locator("#studio-brief").inputValue(), /^Presentation: Harbour Bakery website[\s\S]*Slides:\n- Home/);
      assert.equal(await page.locator(".composer-format-tabs button.active").innerText(), "Presentation");
      await page.waitForTimeout(300);
      assert.deepEqual(posts(current).map(request => request.path), ["/api/chat/brief"], "the new-project composer creates nothing until the user presses it");
      if (shots) await page.locator(".studio-composer").screenshot({ path: path.join(shots, "new-project-banner.png") });
      await page.getByRole("button", { name: "Don’t link this brief" }).click();
      await banner.waitFor({ state: "detached" });
      assert.match(await page.locator("#studio-brief").inputValue(), /^Presentation:/, "removing the link keeps the text");
    });

    for (const [width, height] of [[375, 1500], [320, 1600]]) await scenario(`phone-${width}`, async page => {
      await openAdvisor(page); await draft(page);
      await page.getByRole("button", { name: "Use this brief" }).click();
      const panel = page.getByRole("group", { name: "Use this brief" });
      await panel.getByRole("option", { name: "Harbour Bakery · Website" }).waitFor({ state: "attached" });
      assert.ok(await noScroll(page), "brief and handoff fit the phone width");
      for (const control of [panel.getByRole("button", { name: "Open in composer" }), panel.getByRole("button", { name: "Cancel" }), panel.getByLabel("Where")]) {
        const box = await control.boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1 && box.height >= 36, `control inside the screen and at least 36px tall (${JSON.stringify(box)})`);
      }
      if (shots) await page.getByRole("region", { name: /Project brief/ }).screenshot({ path: path.join(shots, `handoff-panel-${width}.png`) });
      const size = await panel.getByLabel("Where").evaluate(element => parseFloat(getComputedStyle(element).fontSize));
      assert.ok(size >= 16, `phone inputs are at least 16px (${size})`);
      await panel.getByRole("button", { name: "Cancel" }).click();
      await page.getByRole("button", { name: "Edit brief" }).click();
      assert.ok(await noScroll(page), "the edit form fits the phone width");
      await page.getByRole("button", { name: "Cancel edits" }).click();
    }, { width, height });
  } finally { await browser.close(); server.close(); }
  console.log(`\n${passed}/${passed + failures.length} advisor handoff scenarios passed.`);
  if (failures.length) process.exit(1);
}
main().catch(error => { console.error(error); process.exit(1); });
