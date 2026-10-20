/* eslint-disable @typescript-eslint/no-require-imports -- Mounted ClientCommandPalette in Chromium with a controllable mock API (audit F03). Local only; no network. Run: node scripts/check-palette-search-browser.cjs */
const path = require("node:path"), assert = require("node:assert/strict"), { build } = require("esbuild"), { chromium } = require("playwright"), { createServer } = require("node:http");

const fixture = `import React, { useState } from "react"; import { createRoot } from "react-dom/client";
import ClientCommandPalette from "./src/components/client-command-palette";
function App() {
  const [open, setOpen] = useState(false); const [ws, setWs] = useState("ws-1");
  window.setWorkspace = setWs;
  return <div><button id="opener" onClick={() => setOpen(true)}>Open palette</button>
    {open && <ClientCommandPalette workspaceId={ws} today="2026-10-20" actions={[{ id: "add", label: "Add a client", icon: "add" }]}
      onOpenClient={id => { window.opened.push(id); }} onAction={id => { window.actions.push(id); }} onClose={() => setOpen(false)} />}</div>;
}
window.opened = []; window.actions = []; window.requests = [];
createRoot(document.getElementById("root")).render(<App />);`;
// Every search returns a promise the test settles explicitly.
const mockApi = `export function api(url) { return new Promise((resolve, reject) => { window.requests.push({ url, resolve, reject }); }); }`;

const settle = (page, match, outcome) => page.evaluate(([match, outcome]) => {
  const request = [...window.requests].reverse().find(item => decodeURIComponent(item.url).includes(match));
  if (!request) throw new Error(`no request for ${match}: ${window.requests.map(item => item.url).join(" | ")}`);
  if (outcome === "reject") request.reject(new Error("Simulated outage")); else request.resolve({ clients: outcome });
}, [match, outcome]);

async function main() {
  const output = await build({ stdin: { contents: fixture, loader: "jsx", resolveDir: process.cwd() }, write: false, bundle: true, platform: "browser", jsx: "automatic", define: { "process.env": "{}" },
    plugins: [{ name: "fixture", setup(b) {
      b.onResolve({ filter: /cloud-api$/ }, args => ({ path: args.path, namespace: "mock" }));
      b.onLoad({ filter: /cloud-api$/, namespace: "mock" }, () => ({ contents: mockApi, loader: "js" }));
      b.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
      b.onResolve({ filter: /^@\// }, args => ({ path: path.resolve("src", args.path.slice(2) + ".ts") }));
    } }] });
  const server = createServer((req, res) => { res.setHeader("Content-Type", req.url === "/fixture.js" ? "text/javascript" : "text/html"); res.end(req.url === "/fixture.js" ? output.outputFiles[0].contents : '<!doctype html><div id="root"></div><script src="/fixture.js"></script>'); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  let passed = 0; const pass = name => { passed++; console.log(`PASS ${name}`); };
  try {
    const page = await browser.newPage();
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.click("#opener");
    const input = page.getByRole("combobox");
    await page.waitForFunction(() => window.requests.length === 1);
    await settle(page, "search=&", [{ id: "fictional-maple", name: "Maple Studio" }]);
    await page.getByText("Maple Studio").waitFor();

    // The audit's reproduction: a new query pending, then Enter.
    await input.fill("ZZ-NO-MATCH");
    await page.waitForFunction(() => window.requests.some(item => item.url.includes("ZZ-NO-MATCH")));
    assert.equal(await page.getByText("Maple Studio").count(), 0, "old rows are gone while the new search is pending");
    await page.getByText("Searching clients…").waitFor();
    await input.press("Enter");
    assert.deepEqual(await page.evaluate(() => window.opened), [], "Enter during a pending search opens nothing");
    pass("a pending query never opens the previous query's client");
    await settle(page, "ZZ-NO-MATCH", []);
    await page.getByText("No clients or actions match “ZZ-NO-MATCH”.").waitFor();
    assert.equal(await input.getAttribute("aria-activedescendant"), null, "empty list: no active descendant");
    await input.press("Enter");
    assert.deepEqual(await page.evaluate(() => window.opened), []);
    pass("a successful empty result says no matches and Enter does nothing");

    // A rejected search is an error with Retry, not "no matches"; the query is kept.
    await input.fill("OUTAGE-PROBE");
    await page.waitForFunction(() => window.requests.some(item => item.url.includes("OUTAGE-PROBE")));
    await settle(page, "OUTAGE-PROBE", "reject");
    await page.getByRole("alert").getByText("Clients couldn't be searched just now. Your search is kept.").waitFor();
    assert.equal(await page.getByText(/No clients or actions match/).count(), 0, "failure is not shown as an empty result");
    assert.equal(await input.inputValue(), "OUTAGE-PROBE");
    const before = await page.evaluate(() => window.requests.length);
    await page.getByRole("button", { name: "Retry" }).click();
    await page.waitForFunction(count => window.requests.length === count + 1, before);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("role")), "combobox", "focus returns to the search after Retry");
    await settle(page, "OUTAGE-PROBE", [{ id: "fictional-outage", name: "Outage Bakery" }]);
    await page.getByText("Outage Bakery").waitFor();
    pass("a failed search shows an error with Retry, keeps the query, and Retry searches again");

    // Keyboard choice opens the right client for the visible query.
    await input.press("ArrowDown");
    await input.press("Enter");
    assert.deepEqual(await page.evaluate(() => window.opened), ["fictional-outage"]);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "opener", "focus is restored to the opener on close");
    pass("ArrowDown + Enter opens the client shown for the current query; focus returns to the opener");

    // A late answer for an old query, after closing and reopening, cannot leak in.
    await page.click("#opener");
    await page.waitForFunction(() => window.requests.filter(item => item.url.includes("search=&")).length >= 2);
    await settle(page, "OUTAGE-PROBE", [{ id: "late", name: "Late Arrival" }]);
    await page.waitForTimeout(100);
    assert.equal(await page.getByText("Late Arrival").count(), 0, "responses for a closed palette are ignored");
    // Workspace change while open: the old workspace's rows disappear until the new search answers.
    await settle(page, "search=&", [{ id: "fictional-maple", name: "Maple Studio" }]);
    await page.getByText("Maple Studio").waitFor();
    await page.evaluate(() => window.setWorkspace("ws-2"));
    await page.waitForFunction(() => window.requests.some(item => item.url.includes("/workspaces/ws-2/")));
    assert.equal(await page.getByText("Maple Studio").count(), 0, "another workspace never shows the old rows");
    await settle(page, "/workspaces/ws-2/", [{ id: "other", name: "Other Workspace Client" }]);
    await page.getByText("Other Workspace Client").waitFor();
    pass("late answers after closing are ignored; a workspace change hides the old workspace's clients");

    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    pass("Escape closes the palette");
  } finally { await browser.close(); server.close(); }
  console.log(`${passed} mounted palette checks passed (Chromium, mocked API, no network).`);
}
main().catch(error => { console.error(error); process.exit(1); });
