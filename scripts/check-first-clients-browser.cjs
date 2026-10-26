/* eslint-disable @typescript-eslint/no-require-imports -- Mounted real AccountClients (with the real LeadFinder) in a browser (new-user journey, round 2, 26 Oct 2026):
 * a brand-new account has no client workspace yet. "Find my first 10 leads" from the welcome or checklist must set the workspace up in the same step
 * and open the lead finder, with no unexplained "Set up client workspace" click; the empty state explains it in one line and adds the first client in one click.
 * Every API is a Playwright route with fictional data; no network beyond 127.0.0.1, no AI, no mail.
 * Run: node scripts/check-first-clients-browser.cjs [screenshot-dir] */
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs");
const { build } = require("esbuild"), { browserType, args: engineArgs } = require("./browser-engine.cjs"), { createServer } = require("node:http");

const shots = engineArgs[0] ? path.resolve(engineArgs[0]) : null;
const actor = "11111111-1111-4111-8111-111111111111", workspaceId = "22222222-2222-4222-8222-222222222222";
const fixture = `import React from "react"; import { createRoot } from "react-dom/client";
import AccountClients from "./src/components/account-clients";
import { requestClientsAction } from "./src/components/onboarding/signals";
const action = new URLSearchParams(location.search).get("action");
if (action) requestClientsAction(action);
createRoot(document.getElementById("root")).render(<main className="workspace-content"><AccountClients deviceClients={null} target={null} navigate={() => {}} onCreate={() => {}} onOpenProject={() => {}} /></main>);`;
const NULL = "export default function Stub() { return null; }";
const mocks = {
  "next/link": `import React from "react"; export default function Link({ href, children, prefetch, ...rest }) { return <a href={typeof href === "string" ? href : "#"} {...rest}>{children}</a>; }`,
  "next/navigation": `export function useRouter() { return { push() {}, replace() {}, refresh() {}, prefetch() {} }; } export function usePathname() { return location.pathname; } export function useSearchParams() { return new URLSearchParams(location.search); }`,
  // Loads the real component (the lead finder) instead of rendering nothing.
  "next/dynamic": `import React, { Suspense, lazy } from "react"; export default function dynamic(load) { const Lazy = lazy(() => load().then(module => ({ default: module.default ?? module }))); return function Dynamic(props) { return <Suspense fallback={null}><Lazy {...props} /></Suspense>; }; }`,
  "supabase-client": `const session = { user: { id: "${actor}" } }; export function createClient() { return { auth: { getUser: async () => ({ data: { user: session.user }, error: null }), getSession: async () => ({ data: { session } }), onAuthStateChange: callback => { setTimeout(() => callback("SIGNED_IN", session), 0); return { data: { subscription: { unsubscribe() {} } } }; } } }; }`,
  "cloud-studio": `export function CloudClientDetails() { return null; }`,
  "mail-center": NULL, "client-email": NULL, "bulk-enroll": NULL, "enquiry-leads": NULL, "brand-kits": NULL, "lead-redesign": NULL, "client-portal-panel": NULL, "client-board": NULL,
  "cloud-client-outreach": NULL, "client-review-feed": NULL, "client-follow-up-draft": NULL, "client-project-directory": NULL, "pending-cloud-writes": NULL, "lead-profile": NULL,
};
const stubbed = Object.keys(mocks).filter(name => !name.includes("/") && name !== "supabase-client");
const mockFor = request => request.startsWith("next/") ? request
  : /[\\/]supabase[\\/]client$/.test(request) ? "supabase-client"
  : new RegExp(`(?:^|[\\\\/])(${stubbed.join("|")})$`).exec(request)?.[1];

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
  return { js: output.outputFiles[0].contents, styles: [fs.readFileSync("src/app/globals.css", "utf8"), ...new Set(css)].join("\n").replace(/@import[^;]+;/g, "") };
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
  /** `ai`: what GET /api/assistants and /api/build report (null: the endpoint is missing, as before it existed). */
  const scenario = async (name, options, run) => {
    const { width = 1280, height = 900, ai = null } = options;
    const page = await browser.newPage({ viewport: { width, height } }), errors = [], writes = [], foreign = [];
    page.setDefaultTimeout(10000); page.on("pageerror", error => errors.push(error.message));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/))/, route => { foreign.push(route.request().url()); return route.abort(); });
    const state = { workspaces: [], clients: [] };
    await page.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method(), file = url.pathname;
      if (method !== "GET") writes.push(`${method} ${file}`);
      if (file === "/api/capabilities") return route.fulfill({ json: { cloudWorkspace: { available: true } } });
      if (file === "/api/assistants") return ai ? route.fulfill({ json: ai }) : route.fulfill({ status: 404, json: {} });
      if (file === "/api/build") return route.fulfill({ json: ai?.builder ?? { available: false, configured: false, state: "off" } });
      if (file === "/api/workspaces" && method === "GET") return route.fulfill({ json: { workspaces: state.workspaces } });
      if (file === "/api/workspaces" && method === "POST") {
        const workspace = { id: workspaceId, name: request.postDataJSON().name, role: "owner" };
        state.workspaces = [workspace];
        return route.fulfill({ status: 201, json: { workspace, mutation: { idempotencyKey: request.headers()["idempotency-key"], replayed: false } } });
      }
      if (file === `/api/cloud/workspaces/${workspaceId}`) return route.fulfill({ json: { workspace: state.workspaces[0], clients: [], projects: [], artifacts: [],
        pagination: { clients: { offset: 0, nextOffset: null, total: 0 }, projects: { offset: 0, nextOffset: null, total: 0 }, artifacts: { offset: 0, nextOffset: null, total: 0 } } } });
      if (file === `/api/cloud/workspaces/${workspaceId}/clients` && method === "GET") return route.fulfill({ json: { clients: state.clients, pagination: { total: state.clients.length, nextOffset: null }, counts: { all: state.clients.length, overdue: 0, today: 0, upcoming: 0, unscheduled: 0 } } });
      if (file === `/api/cloud/workspaces/${workspaceId}/leads`) return route.fulfill({ json: url.searchParams.has("tags") ? { tags: [] } : { leads: {} } });
      return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Not in this fixture." } } });
    });
    try {
      await run(page, { writes, state });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no horizontal page scroll");
      assert.deepEqual(errors, [], "no page errors");
      assert.deepEqual(foreign, [], "no request left 127.0.0.1");
      if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `first-clients-${name}.png`) }); }
      passed++; console.log(`PASS ${name}`);
    } catch (error) {
      failures.push(name); console.log(`FAIL ${name}: ${error.message.split("\n").slice(0, 6).join(" | ")}`);
      if (process.env.DEBUG) console.log(`  page: ${(await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 400)} | errors: ${errors.join(" / ")} | writes: ${writes.join(", ")}`);
    }
    finally { await page.close(); }
  };
  const finder = page => page.getByRole("dialog", { name: "Find new leads" });
  try {
    await scenario("leads-path-sets-up-the-workspace-and-opens-the-finder", {}, async (page, { writes }) => {
      await page.goto(`${base}/?action=find-leads`);
      await finder(page).waitFor({ timeout: 15000 });
      assert.deepEqual(writes, ["POST /api/workspaces"], "exactly one workspace is created, by the same request");
      assert.equal(await page.getByRole("button", { name: /Set up client workspace/ }).count(), 0, "no separate setup step");
    });
    await scenario("leads-path-on-a-phone", { width: 390, height: 844 }, async (page, { writes }) => {
      await page.goto(`${base}/?action=find-leads`);
      await finder(page).waitFor({ timeout: 15000 });
      assert.deepEqual(writes, ["POST /api/workspaces"]);
    });
    await scenario("an-account-that-has-a-workspace-is-not-given-another", {}, async (page, { writes, state }) => {
      state.workspaces = [{ id: workspaceId, name: "My workspace", role: "owner" }];
      await page.goto(`${base}/?action=find-leads`);
      await finder(page).waitFor({ timeout: 15000 });
      assert.deepEqual(writes, [], "nothing is created");
    });
    await scenario("empty-account-explains-and-adds-the-first-client-in-one-click", {}, async (page, { writes }) => {
      await page.goto(base);
      const empty = page.locator(".ac-empty");
      await empty.waitFor({ timeout: 15000 });
      assert.deepEqual(writes, [], "visiting Clients alone creates nothing");
      assert.match(await empty.innerText(), /set up when you add the first one/, "one line says what happens");
      await empty.getByRole("button", { name: "Add your first client" }).click();
      await page.getByRole("heading", { name: "Add a client" }).waitFor();
      assert.deepEqual(writes, ["POST /api/workspaces"]);
    });
  } finally { await browser.close(); server.close(); }
  console.log(`\n${passed} passed, ${failures.length} failed.`);
  if (failures.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exit(1); });
