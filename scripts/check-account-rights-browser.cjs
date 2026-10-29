/* eslint-disable @typescript-eslint/no-require-imports -- Mounted Settings > Your data against a fictional in-memory API (no database, no provider, no network). */
// Usage: node scripts/check-account-rights-browser.cjs [--engine chromium|firefox|webkit]
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), assert = require("node:assert/strict"), { build } = require("esbuild");
const { browserType, engineLabel, collectPageErrors } = require("./browser-engine.cjs");

const ACCOUNT = "11111111-1111-4111-8111-111111111111", EMAIL = "owner@fixture.invalid";
const fixture = `import React from 'react';import{createRoot}from'react-dom/client';import AccountDataRights,{AccountDeletionNotice}from'./src/components/account-data-rights';
function App(){const[opened,setOpened]=React.useState(false);return <div className="studio-shell"><main className="workspace-content"><AccountDeletionNotice accountId="${ACCOUNT}" onOpenSettings={()=>setOpened(true)}/>{opened&&<p id="opened">Settings opened</p>}<div className="settings-panel"><AccountDataRights accountId="${ACCOUNT}"/></div></main></div>}
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);`;
const mocks = {
  "next/link": "import React from 'react';export default function Link({href,children,...p}){return <a href={href} {...p}>{children}</a>}",
  "next/navigation": "export const useRouter=()=>({push:url=>{window.__pushed=url},replace(){},refresh(){}});",
  "supabase-client": "export function createClient(){return{auth:{getSession:async()=>({data:{session:{user:{id:'" + ACCOUNT + "'}}}}),signOut:async()=>{window.__signedOut=true;return{error:null}}}}}",
};

async function bundle() {
  const css = [];
  const output = await build({ stdin: { contents: fixture, loader: "jsx", resolveDir: process.cwd() }, write: false, bundle: true, platform: "browser", jsx: "automatic", define: { "process.env": "{}" }, logLevel: "silent",
    plugins: [{ name: "fixture", setup(b) {
      b.onResolve({ filter: /^(next\/(link|navigation)|@\/lib\/supabase\/client)$/ }, args => ({ path: args.path === "@/lib/supabase/client" ? "supabase-client" : args.path, namespace: "mock" }));
      b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path], loader: "jsx", resolveDir: process.cwd() }));
      b.onResolve({ filter: /^@\// }, args => {
        const base = path.resolve("src", args.path.slice(2));
        return { path: args.path.endsWith(".css") ? base : fs.existsSync(base + ".tsx") ? base + ".tsx" : fs.existsSync(base + ".ts") ? base + ".ts" : base };
      });
      b.onLoad({ filter: /\.css$/ }, args => { css.push(fs.readFileSync(args.path, "utf8")); return { contents: "", loader: "js" }; });
    } }] });
  const globals = fs.readFileSync("src/app/globals.css", "utf8").replace(/@import[^;]+;/g, "");
  const refresh = fs.readFileSync("src/app/studio-refresh.css", "utf8").replace(/@import[^;]+;/g, "");
  return { js: output.outputFiles[0].text, html: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${globals}${refresh}${css.join("\n")}</style><div id="root"></div><script src="/fixture.js"></script>` };
}

// ---- In-memory API with the same contract as /api/account/data* ----
const base = () => ({ exportEnabled: true, deletionEnabled: true, graceDays: 7, email: EMAIL, exports: [], nextExportAt: null, deletion: null, blockers: [],
  warnings: { liveSites: 2, customDomains: 1, credits: 120, portalClients: 1, otherWorkspaces: 0, mailboxes: 1, github: true } });
let state = base(), signedIn = true, reauthOnce = false, readsUntilReady = 0, requests = [];
function respond(res, status, body, extra = {}) { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra }); res.end(body === null ? "" : JSON.stringify(body)); }
async function api(req, res, body) {
  const url = new URL(req.url, "http://fixture");
  requests.push({ method: req.method, path: url.pathname, account: req.headers["x-makeborne-account"] ?? null, key: req.headers["idempotency-key"] ?? null, body });
  if (req.headers["x-makeborne-account"] && req.headers["x-makeborne-account"] !== ACCOUNT) return respond(res, 409, { error: { code: "ACCOUNT_CHANGED", message: "changed" } });
  if (!signedIn) return respond(res, 401, { error: { code: "AUTH_REQUIRED", message: "Sign in to manage your data." } });
  if (url.pathname === "/api/account/data" && req.method === "GET") {
    const building = state.exports.find(item => item.state === "queued" || item.state === "building");
    if (building && readsUntilReady-- <= 0) Object.assign(building, { state: "ready", completedAt: "2026-10-26T10:05:00.000Z", expiresAt: "2026-10-29T10:05:00.000Z", parts: [{ part: 1, bytes: 2_400_000 }, { part: 2, bytes: 31_000_000 }] });
    return respond(res, 200, state);
  }
  if (url.pathname === "/api/account/data/export" && req.method === "POST") {
    if (!req.headers["idempotency-key"]) return respond(res, 400, { error: { code: "REQUEST_KEY_REQUIRED", message: "key" } });
    if (state.nextExportAt) return respond(res, 429, { error: { code: "EXPORT_LIMIT", message: "You can prepare one export a day. Your latest export is listed below." } });
    state.exports.unshift({ id: "22222222-2222-4222-8222-222222222222", state: "queued", requestedAt: "2026-10-26T10:00:00.000Z", completedAt: null, expiresAt: null, failureCode: null, parts: [] });
    state.nextExportAt = "2026-10-27T10:00:00.000Z"; readsUntilReady = 1;
    return respond(res, 202, { id: state.exports[0].id, state: "queued" });
  }
  const part = url.pathname.match(/^\/api\/account\/data\/export\/([0-9a-f-]{36})\/parts\/(\d+)$/);
  if (part) {
    const item = state.exports.find(entry => entry.id === part[1] && entry.state === "ready");
    if (!item) return respond(res, 404, { error: { code: "EXPORT_EXPIRED", message: "expired" } });
    return respond(res, 303, null, { Location: `/signed/part-${part[2]}.zip` });
  }
  if (url.pathname === "/api/account/data/deletion" && req.method === "POST") {
    const parsed = JSON.parse(body || "{}");
    if (parsed.confirmation?.trim().toLowerCase() !== EMAIL || parsed.understood !== true) return respond(res, 400, { error: { code: "CONFIRMATION_MISMATCH", message: "Type the email address you sign in with, exactly as shown." } });
    if (reauthOnce) { reauthOnce = false; return respond(res, 401, { error: { code: "REAUTH_REQUIRED", message: "For your security, sign in again." } }); }
    if (state.blockers.length) return respond(res, 409, { error: { code: "DELETION_BLOCKED", message: "blocked" }, blockers: state.blockers });
    state.deletion = { id: "33333333-3333-4333-8333-333333333333", state: "scheduled", requestedAt: "2026-10-26T10:00:00.000Z", scheduledFor: "2026-11-02T10:00:00.000Z", blockedCodes: [], started: false, cancellable: true };
    return respond(res, 200, { id: state.deletion.id, state: "scheduled", scheduledFor: state.deletion.scheduledFor });
  }
  if (url.pathname === "/api/account/data/deletion" && req.method === "DELETE") {
    if (!state.deletion?.cancellable) return respond(res, 409, { error: { code: "DELETION_STARTED", message: "Your deletion has already started and can't be cancelled." } });
    state.deletion = null; return respond(res, 200, { state: "cancelled" });
  }
  respond(res, 404, { error: { code: "NOT_FOUND", message: "none" } });
}

async function main() {
  const { js, html } = await bundle();
  const server = http.createServer((req, res) => {
    let body = ""; req.on("data", chunk => { body += chunk; }); req.on("end", () => {
      if (req.url === "/fixture.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(js); return; }
      if (req.url.startsWith("/signed/")) { res.writeHead(200, { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="makeborne-data-${req.url.slice(8)}"` }); res.end("PK\u0003\u0004fixture"); return; }
      if (req.url.startsWith("/api/")) { void api(req, res, body); return; }
      res.writeHead(200, { "Content-Type": "text/html" }); res.end(html);
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await browserType.launch();
  let passed = 0;
  const pass = name => { passed++; console.log(`PASS ${name}`); };
  const open = async (width = 1280, setup = () => {}) => {
    state = base(); signedIn = true; reauthOnce = false; requests = []; setup();
    const context = await browser.newContext({ viewport: { width, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage(); const errors = collectPageErrors(page, []);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
    await page.goto(origin);
    await page.getByRole("heading", { name: /Your data/ }).waitFor();
    await page.locator("section.data-rights:not([aria-busy])").waitFor();
    return { page, context, errors };
  };
  try {
    { // Off: honest fallback, no actions offered.
      const { page, context, errors } = await open(1280, () => { state.exportEnabled = false; state.deletionEnabled = false; });
      const text = await page.locator(".data-rights").innerText();
      assert.match(text, /email admin@makeborne\.com from the address you sign in with/i);
      assert.equal(await page.getByRole("button", { name: /Prepare my data|Delete my account/ }).count(), 0);
      assert.match(text, /Saved to your account/);
      assert.deepEqual(errors, []); await context.close(); pass("feature off: support-email fallback for both, no actions");
    }
    { // Export: request, poll, ready parts with links made on click, one a day.
      const { page, context, errors } = await open();
      await page.getByRole("button", { name: "Prepare my data" }).click();
      await page.getByText(/We're preparing your data/).waitFor();
      await page.getByRole("link", { name: /Part 1 of 2/ }).waitFor({ timeout: 15000 });
      const post = requests.find(r => r.method === "POST" && r.path === "/api/account/data/export");
      assert.match(post.key, /^[0-9a-f-]{36}$/); assert.equal(post.account, ACCOUNT);
      assert.ok(requests.every(r => r.account === ACCOUNT), "every call names the signed-in account");
      assert.equal(await page.getByRole("link", { name: /Part 2 of 2 \(31\.0 MB\)/ }).getAttribute("href"), "/api/account/data/export/22222222-2222-4222-8222-222222222222/parts/2");
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: /Part 1 of 2/ }).click()]);
      assert.equal(download.suggestedFilename(), "makeborne-data-part-1.zip");
      assert.equal(await page.getByRole("button", { name: /Prepare my data/ }).isDisabled(), true, "second export the same day");
      assert.match(await page.locator(".data-rights").innerText(), /You can prepare another export after/);
      assert.match(await page.locator(".data-export").innerText(), /available until 29 Oct 2026/);
      assert.deepEqual(errors, []); await context.close(); pass("export: request, progress, two ready parts, download on click, one-a-day limit");
    }
    { // Expired and failed exports read plainly.
      const { page, context, errors } = await open(1280, () => { state.exports = [
        { id: "44444444-4444-4444-8444-444444444444", state: "expired", requestedAt: "2026-10-20T10:00:00.000Z", completedAt: "2026-10-20T10:05:00.000Z", expiresAt: "2026-10-23T10:05:00.000Z", failureCode: null, parts: [] },
        { id: "55555555-5555-4555-8555-555555555555", state: "failed", requestedAt: "2026-10-19T10:00:00.000Z", completedAt: null, expiresAt: null, failureCode: "ATTEMPTS_EXHAUSTED", parts: [] }]; });
      const text = await page.locator(".data-exports").innerText();
      assert.match(text, /Expired\. The files were removed\./); assert.match(text, /took too long to prepare/);
      assert.equal(await page.locator(".data-exports a").count(), 0, "no link for expired/failed exports");
      assert.deepEqual(errors, []); await context.close(); pass("export: expired and failed exports offer no download");
    }
    { // Blockers: subscription and shared workspace stop deletion with a way forward.
      const { page, context, errors } = await open(1280, () => { state.blockers = ["ACTIVE_SUBSCRIPTION", "SHARED_WORKSPACE"]; });
      const list = page.getByRole("list", { name: "Before your account can be deleted" });
      await list.waitFor();
      assert.match(await list.innerText(), /subscription is still active[\s\S]*Other people work in your workspace/);
      assert.equal(await list.getByRole("link", { name: "Manage subscription" }).getAttribute("href"), "/billing#receipts");
      assert.match(await list.getByRole("link", { name: "Email support" }).getAttribute("href"), /^mailto:admin@makeborne\.com/);
      assert.equal(await page.getByRole("button", { name: /Delete my account/ }).isDisabled(), true);
      assert.deepEqual(errors, []); await context.close(); pass("deletion blocked by an active subscription and a shared workspace, with links");
    }
    { // Deletion: explain, typed email, explicit consent, fresh sign-in, schedule, cancel.
      const { page, context, errors } = await open(1280, () => { reauthOnce = true; });
      await page.getByText("What’s deleted and what we keep").click();
      const explained = await page.locator(".data-explained").innerText();
      assert.match(explained, /Payment, refund, subscription and credit records/); assert.match(explained, /random reference/);
      const warnings = await page.getByRole("list", { name: "This also affects" }).innerText();
      assert.match(warnings, /2 published websites will go offline/); assert.match(warnings, /120 unused credits will be lost/);
      await page.getByRole("button", { name: "Delete my account…" }).click();
      const email = page.getByLabel(`Type ${EMAIL} to confirm`);
      assert.equal(await email.evaluate(el => el === document.activeElement), true, "focus moves to the confirmation");
      const submit = page.getByRole("button", { name: "Delete my account in 7 days" });
      await email.fill("owner@fixture"); await page.getByLabel(/understand deletion can’t be undone/).check();
      assert.equal(await submit.isDisabled(), true, "wrong email accepted");
      await email.fill(` ${EMAIL.toUpperCase()} `);
      assert.equal(await submit.isDisabled(), false);
      await page.keyboard.press("Tab"); await page.keyboard.press("Space");
      assert.equal(await submit.isDisabled(), true, "consent checkbox is keyboard operable");
      await page.getByLabel(/understand deletion can’t be undone/).check();
      await submit.click();
      await page.getByRole("alert").getByText(/sign in again to confirm it’s you/).waitFor();
      await page.getByRole("button", { name: "Sign in again" }).click();
      await page.waitForFunction(() => window.__pushed === "/login?next=%2Fstudio%3Ftab%3Dsettings" && window.__signedOut === true);
      await submit.click();
      await page.getByText("Your account is scheduled for deletion on 2 November 2026.").waitFor();
      const posts = requests.filter(r => r.method === "POST" && r.path === "/api/account/data/deletion");
      assert.equal(posts.length, 2); assert.equal(posts[0].key, posts[1].key, "retry after sign-in reuses the request key");
      assert.equal(await page.getByRole("heading", { name: "Delete your account" }).evaluate(el => el === document.activeElement), true, "focus moves to the outcome");
      await page.getByRole("status").filter({ hasText: "scheduled for deletion on 2 November 2026" }).first().waitFor();
      await page.reload(); await page.getByRole("button", { name: "Review or cancel" }).click(); await page.locator("#opened").waitFor();
      await page.getByRole("button", { name: "Cancel deletion" }).click();
      await page.getByText("Deletion cancelled. Your account stays as it is.").waitFor();
      assert.equal(await page.getByRole("button", { name: "Delete my account…" }).isVisible(), true);
      assert.equal(await page.locator(".data-deletion-notice").count(), 1, "notice reflects first load only until refresh");
      assert.deepEqual(errors, []); await context.close(); pass("deletion: explanation, typed email, consent, fresh sign-in, seven-day schedule, notice, cancel");
    }
    { // Started: no cancel offered; blocked after start needs support.
      const { page, context, errors } = await open(1280, () => { state.deletion = { id: "66666666-6666-4666-8666-666666666666", state: "processing", requestedAt: "2026-10-18T10:00:00.000Z", scheduledFor: "2026-10-25T10:00:00.000Z", blockedCodes: [], started: true, cancellable: false }; });
      assert.match(await page.locator(".data-deletion").innerText(), /being deleted[\s\S]*can’t be cancelled now/);
      assert.equal(await page.getByRole("button", { name: "Cancel deletion" }).count(), 0);
      assert.equal(await page.locator(".data-deletion-notice button").count(), 0);
      await context.close();
      const blocked = await open(1280, () => { state.deletion = { id: "77777777-7777-4777-8777-777777777777", state: "blocked", requestedAt: "2026-10-18T10:00:00.000Z", scheduledFor: "2026-10-25T10:00:00.000Z", blockedCodes: ["MANUAL_REVIEW"], started: true, cancellable: false }; });
      assert.match(await blocked.page.locator(".data-deletion").innerText(), /needs our team to finish/);
      assert.equal(await blocked.page.getByRole("button", { name: "Cancel deletion" }).count(), 0);
      assert.deepEqual([...errors, ...blocked.errors], []); await blocked.context.close(); pass("started or manually-reviewed deletion cannot be cancelled");
    }
    { // Signed out.
      const { page, context, errors } = await open(1280, () => { signedIn = false; });
      assert.match(await page.locator(".data-rights").innerText(), /Sign in to download a copy of your account data/);
      assert.equal(await page.getByRole("link", { name: "Sign in" }).getAttribute("href"), "/login?next=%2Fstudio%3Ftab%3Dsettings");
      assert.deepEqual(errors, []); await context.close(); pass("signed out: sign-in link, no account data requested");
    }
    { // Phone widths: nothing overflows with the confirmation open and a two-part export.
      for (const width of [375, 320]) {
        const { page, context, errors } = await open(width, () => { state.exports = [{ id: "22222222-2222-4222-8222-222222222222", state: "ready", requestedAt: "2026-10-26T10:00:00.000Z", completedAt: "2026-10-26T10:05:00.000Z", expiresAt: "2026-10-29T10:05:00.000Z", failureCode: null, parts: [{ part: 1, bytes: 2_400_000 }, { part: 2, bytes: 31_000_000 }] }]; });
        await page.getByRole("button", { name: "Delete my account…" }).click();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 0, `horizontal overflow ${overflow}px at ${width}`);
        const small = await page.locator(".data-rights button, .data-rights a.button").evaluateAll(nodes => nodes.filter(n => n.getBoundingClientRect().height < 32).length);
        assert.equal(small, 0, "touch targets");
        assert.deepEqual(errors, []); await context.close();
      }
      pass("phone widths 375 and 320: no horizontal overflow, touch-size controls");
    }
    console.log(`PASS account data rights browser ${passed}/8 (${engineLabel})`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
