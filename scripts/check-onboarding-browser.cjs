/* eslint-disable @typescript-eslint/no-require-imports -- Mounted Studio + real GettingStarted in a browser (new-user journey audit, 26 Oct 2026): a brand-new paying member has no workspace until the first project or client creates one, and must still get the welcome and the checklist; progress appears once a workspace exists, without a reload. Routed APIs with fictional data; no network, no AI.
 * Run: node scripts/check-onboarding-browser.cjs [screenshot-dir] */
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs");
const { build } = require("esbuild"), { browserType, args: engineArgs } = require("./browser-engine.cjs"), { createServer } = require("node:http");

const shots = engineArgs[0] ? path.resolve(engineArgs[0]) : null;
const actor = "11111111-1111-4111-8111-111111111111", workspaceId = "22222222-2222-4222-8222-222222222222";
const fixture = `import React from "react"; import { createRoot } from "react-dom/client";
import Studio from "./src/components/studio";
createRoot(document.getElementById("root")).render(<Studio />);`;
const mocks = {
  "next/link": `import React from "react"; export default function Link({ href, children, prefetch, ...rest }) { return <a href={typeof href === "string" ? href : "#"} {...rest}>{children}</a>; }`,
  "next/image": `import React from "react"; export default function Image({ src, alt, fill, sizes, priority, ...rest }) { return <img src={typeof src === "string" ? src : ""} alt={alt} {...rest} />; }`,
  "next/navigation": `export function useRouter() { return { push(href) { (window.__pushes ||= []).push(href); }, replace() {}, refresh() {}, prefetch() {} }; } export function usePathname() { return location.pathname; } export function useSearchParams() { return new URLSearchParams(location.search); }`,
  "next/dynamic": `import React from "react"; export default function dynamic() { return function Dynamic() { return null; }; }`,
  "supabase-client": `const user = { id: "${actor}" }; export function createClient() { return { auth: { getUser: async () => ({ data: { user }, error: null }), getSession: async () => ({ data: { session: { user } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) } }; }`,
  // ?ws=owner: an account that already has its workspace; otherwise a brand-new member with none yet.
  "use-creation-account": `const owned = new URLSearchParams(location.search).get("ws") === "owner";
    export function useCreationAccount() { return { ready: true, error: "", accountId: "${actor}", workspace: owned ? { id: "${workspaceId}", name: "My workspace", role: "owner" } : null, clients: [] }; }`,
  "studio-account": `export default function StudioAccount() { return null; }`,
  "account-projects": `export default function AccountProjects() { return null; }`,
  "account-clients": `export default function AccountClients() { return null; }`,
  "cloud-api": `export function setCloudAccount() {} export class CloudError extends Error {} export function getPendingCloudWrites() { return []; } export function cloudAccountGuard() { return () => true; } export async function api() { throw new Error("offline"); } export async function readCloudImage() { throw new Error("offline"); } export async function uploadCloudImage() { throw new Error("offline"); }`,
};
const mockFor = request => request.startsWith("next/") ? request
  : /[\\/]supabase[\\/]client$/.test(request) ? "supabase-client"
  : /(?:^|[\\/])(use-creation-account|studio-account|account-projects|account-clients|cloud-api)$/.exec(request)?.[1];

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
  // The welcome uses mail/modal, whose .mc-modal overlay rules live in account-clients.css. AccountClients is mocked here, but the real
  // studio imports it statically, so its stylesheet is always on the page; without it the welcome would render as an unstyled block.
  return { js: output.outputFiles[0].contents, styles: [fs.readFileSync("src/app/globals.css", "utf8"), fs.readFileSync("src/app/account-clients.css", "utf8"), ...new Set(css)].join("\n").replace(/@import[^;]+;/g, "") };
}

async function main() {
  const { js, styles } = await bundle();
  // What the account has on the server: no workspace at first; a test can "create" one with one project.
  const state = { workspaces: [], artifacts: 0 }, requests = [];
  const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const server = createServer((req, res) => {
    const file = req.url.split("?")[0];
    if (file === "/fixture.js") { res.setHeader("content-type", "text/javascript"); return res.end(js); }
    if (file.startsWith("/api/")) {
      requests.push(`${req.method} ${file}`);
      if (req.method === "GET" && file === "/api/workspaces") return json(res, 200, { workspaces: state.workspaces });
      if (req.method === "GET" && file === `/api/cloud/workspaces/${workspaceId}/onboarding`)
        return json(res, 200, { progress: { artifacts: state.artifacts, clients: 0, finderLeads: 0, mailboxes: 0, sentEmails: 0, reviewLinks: 0 } });
      return json(res, 404, {});
    }
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}*{box-sizing:border-box}${styles}</style><div id="root"></div><script src="/fixture.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await browserType.launch({ headless: true });
  let passed = 0; const failures = [];
  const scenario = async (name, run, viewport = { width: 1280, height: 900 }) => {
    const page = await browser.newPage({ viewport }), errors = [];
    page.setDefaultTimeout(10000); page.on("pageerror", error => errors.push(error.message));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/))/, route => route.abort());
    state.workspaces = []; state.artifacts = 0; requests.length = 0;
    try {
      await run(page);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no horizontal page scroll");
      assert.deepEqual(requests.filter(request => !request.startsWith("GET ")), [], "onboarding only reads");
      assert.deepEqual(errors, []);
      if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `onboarding-${name}.png`) }); }
      passed++; console.log(`PASS ${name}`);
    } catch (error) { failures.push(name); console.log(`FAIL ${name}: ${error.message.split("\n").slice(0, 6).join(" | ")}`); }
    finally { await page.close(); }
  };
  const welcome = page => page.getByRole("dialog", { name: "Welcome to Makeborne" });
  const pill = page => page.locator(".gs-pill");
  try {
    await scenario("new-member-without-workspace-is-welcomed", async page => {
      await page.goto(`${base}/?view=studio`);
      await welcome(page).waitFor({ timeout: 15000 });
      for (const path of ["Make my first website", "Find my first 10 leads", "Write a book or deck"]) await page.getByRole("button", { name: new RegExp(path) }).waitFor();
      // Pricing lists print-ready books under "What isn't ready yet"; the welcome must not promise them.
      assert.match(fs.readFileSync("src/lib/billing/plans.ts", "utf8"), /Print-ready books: books export for reading on screen/);
      assert.doesNotMatch(await welcome(page).innerText(), /print-ready/i, "no print-ready promise");
      await page.getByRole("button", { name: /look around first/ }).click();
      await welcome(page).waitFor({ state: "detached" });
      assert.match(await pill(page).innerText(), /Getting started\s+0\/6 done/);
      await pill(page).click();
      assert.equal(await page.locator(".gs-panel li").count(), 6, "every first step is listed");
      assert.equal(await page.locator(".gs-panel li.is-done").count(), 0);
      assert.ok(requests.includes("GET /api/workspaces"), "the checklist looks the workspace up");
      assert.ok(!requests.some(request => request.includes("/onboarding")), "no progress read without a workspace");
    });
    await scenario("progress-appears-once-the-first-project-creates-the-workspace", async page => {
      await page.goto(`${base}/?view=studio`);
      await welcome(page).waitFor({ timeout: 15000 });
      await page.getByRole("button", { name: /look around first/ }).click();
      await pill(page).waitFor();
      state.workspaces = [{ id: workspaceId, name: "My workspace", role: "owner" }]; state.artifacts = 1;
      await page.evaluate(() => window.dispatchEvent(new Event("makeborne:onboarding-refresh")));
      await page.waitForFunction(() => /1\/6 done/.test(document.querySelector(".gs-pill")?.textContent ?? ""));
      assert.equal(await welcome(page).count(), 0, "the welcome is not shown again");
    });
    await scenario("existing-workspace-reads-its-progress", async page => {
      state.workspaces = [{ id: workspaceId, name: "My workspace", role: "owner" }];
      await page.goto(`${base}/?view=studio&ws=owner`);
      await welcome(page).waitFor({ timeout: 15000 });
      assert.ok(requests.includes(`GET /api/cloud/workspaces/${workspaceId}/onboarding`));
      assert.ok(!requests.includes("GET /api/workspaces"), "the known workspace is used directly");
    });
    await scenario("welcome-keeps-keyboard-focus-inside", async page => {
      await page.goto(`${base}/?view=studio`);
      await welcome(page).waitFor({ timeout: 15000 });
      const inside = () => page.evaluate(() => Boolean(document.activeElement?.closest("[role=dialog]")));
      const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 40) ?? "");
      for (let index = 0; index < 8; index++) { await page.keyboard.press("Tab"); assert.ok(await inside(), `Tab ${index + 1} stays in the welcome (${await focused()})`); }
      await page.getByRole("button", { name: "Close" }).focus();
      await page.keyboard.press("Shift+Tab");
      assert.ok(await inside(), "Shift+Tab from the first control stays in the welcome");
      assert.match(await focused(), /look around first/, "and wraps to the last control");
      await page.keyboard.press("Escape");
      await welcome(page).waitFor({ state: "detached" });
    });
    await scenario("phone-navigation-drawer-is-not-covered-by-the-checklist", async page => {
      await page.goto(`${base}/?view=studio`);
      await welcome(page).waitFor({ timeout: 15000 });
      await page.getByRole("button", { name: /look around first/ }).click();
      await pill(page).waitFor();
      // On phones the checklist box spans the screen so its panel can; the empty strip beside the closed pill must not take taps
      // meant for the page underneath.
      assert.equal(await page.evaluate(() => { const ring = document.querySelector(".gs-pill").getBoundingClientRect(); const hit = document.elementFromPoint(ring.left - 60, ring.top + ring.height / 2); return hit ? (hit.closest(".gs") ? "checklist" : "page") : "none"; }), "page", "a tap beside the closed pill reaches the page");
      await pill(page).click();
      await page.locator(".gs-panel").waitFor();
      await page.getByRole("button", { name: "Toggle navigation" }).click();
      await page.locator("#studio-navigation").waitFor();
      assert.equal(await page.locator(".gs-panel, .gs-pill").count(), 0, "the checklist steps aside while the drawer is open");
      await page.keyboard.press("Escape");
      await pill(page).waitFor();
    }, { width: 390, height: 844 });
    await scenario("phone-390", async page => {
      await page.goto(`${base}/?view=studio`);
      await welcome(page).waitFor({ timeout: 15000 });
      const box = await welcome(page).boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= 390, `welcome fits (${JSON.stringify(box)})`);
    }, { width: 390, height: 844 });
  } finally { await browser.close(); server.close(); }
  console.log(`\n${passed} passed, ${failures.length} failed.`);
  if (failures.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exit(1); });
