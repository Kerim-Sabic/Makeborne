/* eslint-disable @typescript-eslint/no-require-imports -- Mounted MailCenter in Chromium: after a mailbox connects, the message names only the capabilities the overview confirms (audit capability states). The mail API is answered by Playwright routes with fictional data; no OAuth, no send. Local only. Run: node scripts/check-mail-connected-browser.cjs */
const path = require("node:path"), assert = require("node:assert/strict"), { build } = require("esbuild"), { chromium } = require("playwright"), { createServer } = require("node:http");

// The workspace can be switched in place (same component instance) to test late answers from the previous context.
const fixture = `import React, { useState } from "react"; import { createRoot } from "react-dom/client";
import MailCenter from "./src/components/mail/mail-center";
function App() { const [workspace, setWorkspace] = useState("w1"); window.switchTo = setWorkspace;
  return <MailCenter accountId="acct-1" workspaceId={workspace} canEdit={true} connectResult={{ result: "connected", detail: "owner@example.test" }} onOpenClient={() => {}} />; }
createRoot(document.getElementById("root")).render(<App />);`;
const account = extra => ({ id: "m1", provider: "google", email: "owner@example.test", displayName: "Owner", status: "active", lastError: null, mine: true, dailyLimit: 50, lastSyncedAt: null, todayQuota: 20, sentToday: 0, canSend: true, canTrackReplies: true, canAutomate: true, ...extra });
const overview = (accounts, extra) => ({ availability: { google: true, microsoft: true }, automation: true, googleMode: "full", accounts, templates: [], sequences: [], replies: [], ...extra });

async function main() {
  const output = await build({ stdin: { contents: fixture, loader: "jsx", resolveDir: process.cwd() }, write: false, bundle: true, platform: "browser", jsx: "automatic", define: { "process.env": "{}" },
    plugins: [{ name: "fixture", setup(b) {
      b.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
      b.onResolve({ filter: /^@\// }, args => ({ path: path.resolve("src", args.path.slice(2) + ".ts") }));
    } }] });
  const server = createServer((req, res) => { res.setHeader("Content-Type", req.url === "/fixture.js" ? "text/javascript" : "text/html"); res.end(req.url === "/fixture.js" ? output.outputFiles[0].contents : '<!doctype html><div id="root"></div><script src="/fixture.js"></script>'); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  let passed = 0; const pass = name => { passed++; console.log(`PASS ${name}`); };
  try {
    const page = await browser.newPage();
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
    let reply = () => ({ status: 200, body: overview([account()]) });
    await page.route("**/api/cloud/workspaces/w1/mail", route => { const { status, body } = reply(); return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }); });
    const status = () => page.locator(".mc-message").innerText();
    const mount = async (next) => { reply = next; await page.goto(url); await page.getByRole("heading", { name: "Email" }).or(page.getByRole("alert")).first().waitFor(); };

    await mount(() => ({ status: 200, body: overview([account({ canTrackReplies: false, canAutomate: false })], { googleMode: "send_only" }) }));
    let text = await status();
    assert.equal(text, "Connected owner@example.test. You can send reviewed emails; read replies in Gmail and update client stages yourself.");
    assert.doesNotMatch(text, /automat/i);
    pass("send-only Gmail: the connected message promises sending only, beside the send-only notice");

    await mount(() => ({ status: 200, body: overview([account()], { automation: false }) }));
    assert.match(await status(), /Until automatic sending is enabled, due follow-ups go out when you press Check now\./);
    pass("reply tracking with the schedule off does not claim background sending");
    await mount(() => ({ status: 200, body: overview([account({ provider: "microsoft" })]) }));
    assert.equal(await status(), "Connected owner@example.test. You can send reviewed emails, track replies and run follow-up sequences.");
    pass("full mailbox with the schedule on describes sending, replies and sequences");

    // Overview fails: the connection stays acknowledged with a Retry; a successful retry then describes it.
    let calls = 0;
    await mount(() => (++calls === 1 ? { status: 503, body: { error: { message: "Email is temporarily unavailable. Try again." } } } : { status: 200, body: overview([account({ canTrackReplies: false, canAutomate: false })]) }));
    const alert = page.getByRole("alert");
    assert.match(await alert.innerText(), /Connected owner@example\.test\. We couldn't confirm what it can do yet\./);
    await page.getByRole("button", { name: "Try again" }).click();
    await page.getByRole("heading", { name: "Email" }).waitFor();
    assert.match(await status(), /^Connected owner@example\.test\. You can send reviewed emails; read replies in Gmail/, "the stale load error is cleared after a successful retry");
    pass("failed check keeps the acknowledgement and Retry; a successful retry replaces the stale error");

    // Context switch while the first workspace's overview is pending: its late answer must not unlock the new one.
    let release; const held = new Promise(resolve => { release = resolve; });
    await page.route("**/api/cloud/workspaces/w2/mail", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(overview([account({ canTrackReplies: false, canAutomate: false })], { googleMode: "send_only" })) }));
    reply = () => ({ status: 200, body: overview([account()], { automation: false }) });
    await page.unroute("**/api/cloud/workspaces/w1/mail");
    await page.route("**/api/cloud/workspaces/w1/mail", async route => { await held; return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(overview([account()], { automation: false })) }); });
    await page.goto(url);
    await page.locator('[aria-label="Loading email"]').waitFor({ state: "attached" });
    await page.evaluate(() => window.switchTo("w2"));
    await page.getByRole("heading", { name: "Email" }).waitFor();
    release(); await page.waitForTimeout(400);
    assert.equal(await page.getByRole("button", { name: "Check now" }).count(), 0, "w1's reply-tracking capability does not appear in w2");
    assert.match(await status(), /read replies in Gmail/);
    assert.match(await page.locator(".mc").innerText(), /Gmail sends only/);
    pass("a late overview from the previous workspace is ignored; the new workspace's capabilities stay");
  } finally { await browser.close(); server.close(); }
  console.log(`${passed} mounted mail connection checks passed (Chromium, routed API, no network).`);
}
main().catch(error => { console.error(error); process.exit(1); });
