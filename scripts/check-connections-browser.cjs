/* eslint-disable @typescript-eslint/no-require-imports -- Mounted MailCenter and WebsiteGithub in Chromium: the mailbox card names the sequences that use it, its last send and how to stop automation; disconnect copy says what stops and that the provider grant stays until revoked there (audit: connection clarity). APIs are answered by Playwright routes with fictional data; no OAuth, no send. Local only. Run: node scripts/check-connections-browser.cjs [screenshot-dir] */
const path = require("node:path"), fs = require("node:fs"), assert = require("node:assert/strict"), { build } = require("esbuild"), { browserType, engineLabel, args: engineArgs } = require("./browser-engine.cjs"), { createServer } = require("node:http");

const shots = engineArgs[0] ? path.resolve(engineArgs[0]) : null;
const fixture = `import React from "react"; import { createRoot } from "react-dom/client";
import "./src/app/globals.css"; import "./src/app/account-clients.css"; import "./src/components/website-publish.css";
import MailCenter from "./src/components/mail/mail-center";
import WebsiteGithub from "./src/components/website-github";
import { setCloudAccount } from "./src/components/cloud-api";
setCloudAccount("acct-1");
const which = new URLSearchParams(location.search).get("view");
createRoot(document.getElementById("root")).render(<div style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>{which === "github"
  ? <WebsiteGithub accountId="acct-1" workspaceId="w1" artifactId="a1" version={3} dirty={false} owner={true} source={true} />
  : <MailCenter accountId="acct-1" workspaceId="w1" canEdit={true} connectResult={null} onOpenClient={() => {}} />}</div>);`;
const account = extra => ({ id: "m1", provider: "google", email: "owner@example.test", displayName: "Owner", status: "active", lastError: null, mine: true, dailyLimit: 50, lastSyncedAt: null, todayQuota: 20, sentToday: 2, canSend: true, canTrackReplies: true, canAutomate: true, lastSentAt: null, sequences: [], ...extra });
const overview = (accounts, extra) => ({ availability: { google: true, microsoft: true }, automation: true, googleMode: "full", microsoftMode: "full", accounts, templates: [], sequences: [], replies: [], ...extra });

async function main() {
  const output = await build({ stdin: { contents: fixture, loader: "jsx", resolveDir: process.cwd() }, write: false, bundle: true, platform: "browser", jsx: "automatic", define: { "process.env": "{}" },
    loader: { ".woff2": "empty", ".woff": "empty", ".png": "empty", ".svg": "empty" }, outdir: "out",
    plugins: [{ name: "fixture", setup(b) {
      b.onResolve({ filter: /^@\// }, args => {
        const base = path.resolve("src", args.path.slice(2));
        return { path: [`${base}.ts`, `${base}.tsx`, base].find(file => fs.existsSync(file) && fs.statSync(file).isFile()) };
      });
      b.onResolve({ filter: /^tailwindcss$/ }, () => ({ path: "tailwind", namespace: "stub-css" }));
      b.onLoad({ filter: /.*/, namespace: "stub-css" }, () => ({ contents: "", loader: "css" }));
      b.onResolve({ filter: /^next\/font/ }, () => ({ path: "font", namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export default () => ({ className: '', variable: '' });", loader: "js" }));
    } }] });
  const js = output.outputFiles.find(file => file.path.endsWith(".js")).contents, css = output.outputFiles.find(file => file.path.endsWith(".css"))?.contents ?? "";
  const server = createServer((req, res) => {
    const file = req.url.split("?")[0];
    res.setHeader("Content-Type", file === "/fixture.js" ? "text/javascript" : file === "/fixture.css" ? "text/css" : "text/html");
    res.end(file === "/fixture.js" ? js : file === "/fixture.css" ? css : '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body style="background:#faf9fc"><div id="root"></div><script src="/fixture.js"></script></body>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await browserType.launch({ headless: true });
  let passed = 0; const pass = name => { passed++; console.log(`PASS ${name}`); };
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
    const dialogs = []; let answer = true;
    page.on("dialog", dialog => { dialogs.push(dialog.message()); return answer ? dialog.accept() : dialog.dismiss(); });
    let reply = overview([]); const deletes = [];
    await page.route("**/api/cloud/workspaces/w1/mail", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reply) }));
    await page.route("**/api/cloud/workspaces/w1/mail/accounts", route => { deletes.push(route.request().postDataJSON()); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "m1", status: "disconnected" }) }); });
    const mount = async next => { reply = next; await page.goto(url); await page.getByRole("heading", { name: "Email" }).waitFor(); };
    const card = () => page.locator(".mc-list > li").first();

    const busy = account({ lastSentAt: "2026-10-19T09:30:00Z", sequences: [{ sequenceId: "s1", name: "Spring outreach", active: 3, paused: 1 }, { sequenceId: "s2", name: "Archived sequence", active: 0, paused: 2 }] });
    await mount(overview([busy]));
    const text = await card().innerText();
    assert.match(text, /Last sent /);
    assert.match(text, /Used by Spring outreach \(3 running, 1 paused\) · Archived sequence \(2 paused\)/);
    assert.match(text, /To stop its automatic emails, pause or stop those clients under Sequences → Clients, or disconnect this mailbox/);
    const fine = await page.locator(".mc-fine").last();
    assert.match(await fine.innerText(), /The permission itself stays with the provider until you remove Makeborne/);
    assert.deepEqual(await fine.locator("a").evaluateAll(links => links.map(link => link.href)), ["https://myaccount.google.com/connections", "https://account.live.com/consent/Manage", "https://myapps.microsoft.com/"]);
    pass("mailbox card: sequences using it, last send, how to stop automation, provider permission links");
    if (shots) for (const [width, height] of [[1440, 1000], [375, 900], [320, 900]]) {
      await page.setViewportSize({ width, height });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no horizontal scroll at ${width}px`);
      await page.locator(".mc-card").first().screenshot({ path: path.join(shots, `mailbox-card-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });

    answer = false;
    await page.getByRole("button", { name: "Disconnect" }).click();
    assert.equal(dialogs.at(-1), "Disconnect owner@example.test? Makeborne deletes its stored access to this mailbox and pauses 3 running sequence clients. Nothing queued is sent, and sent history is kept. Google keeps listing Makeborne until you remove it in your Google account.");
    assert.equal(deletes.length, 0, "dismissing changes nothing");
    answer = true;
    reply = overview([account({ ...busy, status: "disconnected", sequences: [] })]);
    await page.getByRole("button", { name: "Disconnect" }).click();
    await page.locator(".mc-message").waitFor();
    assert.deepEqual(deletes, [{ id: "m1" }]);
    assert.equal(await page.locator(".mc-message").innerText(), "Mailbox disconnected. Nothing queued will be sent and sent history is kept. Google still lists Makeborne until you remove it there (links below).");
    pass("disconnect confirmation names what pauses and what stays; the result says the provider still lists Makeborne");

    await mount(overview([account({ provider: "microsoft", email: "me@outlook.test", canTrackReplies: false, canAutomate: false })], { microsoftMode: "send_only" }));
    const quiet = await card().innerText();
    assert.match(quiet, /Nothing sent from it yet/); assert.match(quiet, /No sequence uses it\. It sends only the emails you send from a client\./);
    assert.doesNotMatch(quiet, /To stop its automatic emails/);
    assert.match(await page.locator(".mc").innerText(), /Outlook sends only: Makeborne asks Microsoft for permission to send, not to read your mailbox\./);
    pass("unused send-only Outlook mailbox: no automation claims; send-only notice explains the permission");

    // GitHub: disconnect is confirmed first and says the GitHub app stays authorized until revoked in GitHub.
    const githubDeletes = [];
    await page.route("**/api/github/connection", route => {
      if (route.request().method() === "DELETE") { githubDeletes.push(1); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ disconnected: true }) }); }
      const connected = githubDeletes.length === 0;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(connected ? { configured: true, connected: true, login: "octo-owner", installUrl: "https://github.com/apps/makeborne/installations/new", repositories: [{ id: 7, name: "octo-owner/site", private: true }] } : { configured: true, connected: false, installUrl: "https://github.com/apps/makeborne/installations/new" }) });
    });
    await page.route("**/api/cloud/workspaces/w1/artifacts/a1/github", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ link: null }) }));
    await page.goto(`${url}/?view=github`);
    await page.getByRole("button", { name: "Disconnect GitHub" }).waitFor();
    // Reviewed export, not background sync: the action is a push the owner starts, and the panel says nothing updates on its own.
    const panel = await page.locator(".website-publish").innerText();
    assert.ok(await page.getByRole("button", { name: "Push version 3 to GitHub" }).count(), "the action is a manual push of one saved version");
    assert.match(panel, /It only happens when you push a version here: saving doesn’t update GitHub\./);
    assert.match(panel, /changes made in GitHub aren’t imported/);
    assert.doesNotMatch(panel, /\bsync/i, "no wording implies continuous synchronization");
    pass("GitHub panel: a manual one-way push; says saving doesn't update GitHub and nothing is imported; never says sync");
    answer = false;
    await page.getByRole("button", { name: "Disconnect GitHub" }).click();
    assert.match(dialogs.at(-1), /^Disconnect GitHub from your Makeborne account\? Makeborne deletes its stored GitHub access, so none of your projects can push until you connect again\./);
    assert.match(dialogs.at(-1), /the Makeborne GitHub app stays authorized there until you revoke it in your GitHub settings\.$/);
    assert.equal(githubDeletes.length, 0, "cancelled disconnect sends nothing");
    answer = true;
    await page.getByRole("button", { name: "Disconnect GitHub" }).click();
    await page.getByRole("button", { name: "Connect GitHub" }).waitFor();
    assert.equal(githubDeletes.length, 1);
    assert.match(await page.locator(".website-publish-message").innerText(), /The Makeborne GitHub app stays authorized in GitHub until you revoke it there\./);
    assert.equal(await page.getByRole("link", { name: "Revoke the app in GitHub settings" }).getAttribute("href"), "https://github.com/settings/apps/authorizations");
    assert.equal(await page.getByRole("link", { name: "Remove its repository access" }).getAttribute("href"), "https://github.com/settings/installations");
    pass("GitHub disconnect: confirmed first, then says the grant stays at GitHub and links to GitHub's settings");
    if (shots) for (const [width, height] of [[1440, 900], [375, 900], [320, 900]]) {
      await page.setViewportSize({ width, height });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no horizontal scroll at ${width}px`);
      await page.locator(".website-publish").screenshot({ path: path.join(shots, `github-disconnected-${width}.png`) });
    }
  } finally { await browser.close(); server.close(); }
  console.log(`${passed} mounted connection checks passed (${engineLabel}, routed API, no network).`);
}
main().catch(error => { console.error(error); process.exit(1); });
