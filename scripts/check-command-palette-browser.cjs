/* eslint-disable @typescript-eslint/no-require-imports -- Mounted global command palette (P2) in Chromium: Ctrl+K opens an accessible combobox in the Studio and the advisor page, arrows/Enter go to a place, Escape closes and restores focus, Start opens the composer without sending, the client list keeps its own Ctrl+K, and 320 px fits. Routed APIs with fictional data; no network, no AI.
 * Run: node scripts/check-command-palette-browser.cjs [screenshot-dir] */
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs");
const { build } = require("esbuild"), { browserType, args: engineArgs } = require("./browser-engine.cjs"), { createServer } = require("node:http");

const shots = engineArgs[0] ? path.resolve(engineArgs[0]) : null;
const actor = "11111111-1111-4111-8111-111111111111";
const fixture = `import React from "react"; import { createRoot } from "react-dom/client";
import ExpertChat from "./src/components/expert-chat";
import Studio from "./src/components/studio";
const view = new URLSearchParams(location.search).get("view");
createRoot(document.getElementById("root")).render(view === "advisor" ? <ExpertChat /> : <Studio />);`;
const mocks = {
  "next/link": `import React from "react"; export default function Link({ href, children, prefetch, ...rest }) { return <a href={typeof href === "string" ? href : "#"} {...rest}>{children}</a>; }`,
  "next/image": `import React from "react"; export default function Image({ src, alt, fill, sizes, priority, ...rest }) { return <img src={typeof src === "string" ? src : ""} alt={alt} {...rest} />; }`,
  "next/navigation": `export function useRouter() { return { push(href) { (window.__pushes ||= []).push(href); }, replace() {}, refresh() {}, prefetch() {} }; } export function usePathname() { return location.pathname; } export function useSearchParams() { return new URLSearchParams(location.search); }`,
  "next/dynamic": `import React from "react"; export default function dynamic() { return function Dynamic() { return null; }; }`,
  "supabase-client": `const user = { id: "${actor}" }; export function createClient() { return { auth: { getUser: async () => ({ data: { user }, error: null }), getSession: async () => ({ data: { session: { user } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) } }; }`,
  "use-creation-account": `export function useCreationAccount() { return { ready: true, error: "", accountId: null, workspace: null, clients: [] }; }`,
  "studio-account": `export default function StudioAccount() { return null; }`,
  "getting-started": `export default function GettingStarted() { return null; }`,
  "account-projects": `export default function AccountProjects() { return null; }`,
  // The client list owns Ctrl+K while it is shown (as AccountClients does).
  "account-clients": `import React, { useEffect, useState } from "react"; export default function AccountClients() { const [open, setOpen] = useState(false);
    useEffect(() => { const onKey = event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setOpen(value => !value); } }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, []);
    return <div>{open && <div role="dialog" aria-label="Find a client or action">Client palette</div>}</div>; }`,
  "cloud-api": `export function setCloudAccount() {} export class CloudError extends Error {} export function getPendingCloudWrites() { return []; } export function cloudAccountGuard() { return () => true; } export async function api() { throw new Error("offline"); } export async function readCloudImage() { throw new Error("offline"); } export async function uploadCloudImage() { throw new Error("offline"); }`,
};
const mockFor = request => request.startsWith("next/") ? request
  : /[\\/]supabase[\\/]client$/.test(request) ? "supabase-client"
  : /(?:^|[\\/])(use-creation-account|studio-account|getting-started|account-projects|account-clients|cloud-api)$/.exec(request)?.[1];

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
  const requests = [];
  const server = createServer((req, res) => {
    const file = req.url.split("?")[0];
    if (file === "/fixture.js") { res.setHeader("content-type", "text/javascript"); return res.end(js); }
    if (file.startsWith("/api/")) { requests.push(`${req.method} ${file}`); res.writeHead(404, { "content-type": "application/json" }); return res.end("{}"); }
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
    requests.length = 0;
    try {
      await run(page);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no horizontal page scroll");
      assert.deepEqual(requests.filter(request => !request.startsWith("GET ")), [], "the palette sends nothing");
      assert.deepEqual(errors, []);
      if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `palette-${name}.png`) }); }
      passed++; console.log(`PASS ${name}`);
    } catch (error) { failures.push(name); console.log(`FAIL ${name}: ${error.message.split("\n").slice(0, 6).join(" | ")}`); }
    finally { await page.close(); }
  };
  const dialog = page => page.getByRole("dialog", { name: "Go to or start" });
  const combo = page => page.getByRole("combobox");
  const studio = async page => { await page.goto(`${base}/?view=studio`); await page.locator("#studio-brief").waitFor({ timeout: 15000 }); };
  try {
    await scenario("studio-keyboard-navigation", async page => {
      await studio(page);
      await page.locator("#studio-brief").focus();
      await page.keyboard.press("Control+k");
      await dialog(page).waitFor();
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("role")), "combobox", "focus moves into the combobox");
      assert.equal(await combo(page).getAttribute("aria-expanded"), "true");
      const listbox = await combo(page).getAttribute("aria-controls");
      assert.ok(listbox && await page.locator(`[id="${listbox}"][role="listbox"]`).count() === 1, "the combobox controls its listbox");
      await page.keyboard.type("set");
      assert.equal(await page.getByRole("option").first().innerText().then(text => text.split("\n")[0]), "Settings");
      assert.equal(await combo(page).getAttribute("aria-activedescendant"), await page.getByRole("option").first().getAttribute("id"));
      await page.keyboard.press("Escape");
      await dialog(page).waitFor({ state: "detached" });
      assert.equal(await page.evaluate(() => document.activeElement?.id), "studio-brief", "Escape restores focus");
      await page.keyboard.press("Control+k"); await page.keyboard.type("clients");
      await page.keyboard.press("Enter");
      await dialog(page).waitFor({ state: "detached" });
      await page.locator(".studio-nav button[aria-current='page']", { hasText: "Clients" }).waitFor();
      assert.match(page.url(), /tab=clients/);
    });
    await scenario("start-opens-composer-only", async page => {
      await studio(page);
      await page.getByRole("button", { name: /Go to or start/ }).click();
      await dialog(page).waitFor();
      await page.keyboard.type("new book");
      await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowUp");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.activeElement?.id === "studio-brief");
      assert.equal(await page.locator(".composer-format-tabs button.active").innerText(), "Book");
      assert.equal(await page.locator("#studio-brief").inputValue(), "", "nothing is written or sent");
    });
    await scenario("client-list-keeps-its-shortcut", async page => {
      await page.goto(`${base}/?view=studio&tab=clients`);
      await page.locator(".studio-nav button[aria-current='page']", { hasText: "Clients" }).waitFor({ timeout: 15000 });
      await page.keyboard.press("Control+k");
      await page.getByRole("dialog", { name: "Find a client or action" }).waitFor();
      assert.equal(await dialog(page).count(), 0, "only the client palette opens on the client list");
      await page.getByRole("button", { name: /Go to or start/ }).click();
      await dialog(page).waitFor();
    });
    await scenario("advisor-switch", async page => {
      await page.goto(`${base}/?view=advisor`); await page.getByRole("textbox", { name: /Message Mira/ }).waitFor();
      await page.keyboard.press("Control+k"); await dialog(page).waitFor();
      await page.keyboard.type("copy");
      assert.match(await page.getByRole("option").first().innerText(), /Ask Nova/);
      await page.keyboard.press("Enter");
      await page.getByRole("textbox", { name: /Message Nova/ }).waitFor();
      await page.waitForFunction(() => document.activeElement?.id === "advisor-message");
      assert.equal(requests.filter(request => request.includes("/api/chat")).length, 0, "switching asks nothing");
    });
    await scenario("phone-320", async page => {
      await studio(page);
      await page.keyboard.press("Control+k"); await dialog(page).waitFor();
      const box = await dialog(page).boundingBox();
      assert.ok(box.x >= 15 && box.x + box.width <= 305, `16px gutters (${JSON.stringify(box)})`);
      assert.ok(await combo(page).evaluate(element => parseFloat(getComputedStyle(element).fontSize)) >= 16, "16px input on phones");
      const option = await page.getByRole("option").first().boundingBox();
      assert.ok(option.height >= 44, "options are at least 44px tall");
    }, { width: 320, height: 700 });
  } finally { await browser.close(); server.close(); }
  console.log(`\n${passed}/${passed + failures.length} command palette scenarios passed.`);
  if (failures.length) process.exit(1);
}
main().catch(error => { console.error(error); process.exit(1); });
