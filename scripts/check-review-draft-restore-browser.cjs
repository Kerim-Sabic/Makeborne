/* eslint-disable @typescript-eslint/no-require-imports -- Isolated local browser fixture; no provider or account calls. */
// The public review page is server-rendered, so a visitor can type into its fields before React hydrates (the srcdoc
// preview is server-rendered too, so "the work is on screen" does not mean "the page is live"). The unsent-feedback and
// name restores run after hydration. This check serves real server HTML, holds the page's script back while the visitor
// types, then lets it hydrate and asserts that a restore never overwrites a field the visitor typed, never blanks one,
// still fills empty ones, and that Post comment sends exactly what is on screen.
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), assert = require("node:assert/strict");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { encodeReviewDraft, reviewDraftKey, reviewDraftScope } = require("../src/lib/client-review/unsent-feedback.ts");
const { browserType, collectPageErrors, engineLabel } = require("./browser-engine.cjs");
const out = path.resolve("work/review-draft-restore-browser"); fs.mkdirSync(out, { recursive: true });
const token = "d".repeat(43), version = 3, scope = reviewDraftScope(token, version);
const review = { status: "active", kind: "website", title: "Saffron Table", version, pinned: false, mode: "html", html: "<!doctype html><html><body><h1>Supper for the street</h1></body></html>", content: null, style: null, recipientName: "Client", message: "", expiresAt: "2030-01-01T00:00:00Z", decision: null, comments: [] };
// One app module for both sides, so the server markup and the hydrated tree match. The marker's microtask is queued
// after the page's restore microtasks (its effect runs after theirs), so `__restored` means every restore has run.
fs.writeFileSync(path.join(out, "app.tsx"), `import React, { StrictMode, useEffect } from 'react'; import ClientReviewPage from '../../src/components/client-review-page';
function Restored() { useEffect(() => { queueMicrotask(() => { (window as any).__restored = true; }); }, []); return null; }
export default function App() { return <StrictMode><ClientReviewPage token=${JSON.stringify(token)} review={${JSON.stringify(review)} as any} /><Restored /></StrictMode>; }`);
fs.writeFileSync(path.join(out, "server.tsx"), `import React from 'react'; import { renderToString } from 'react-dom/server'; import App from './app'; export const html = () => renderToString(<App />);`);
fs.writeFileSync(path.join(out, "client.tsx"), `import React from 'react'; import { hydrateRoot } from 'react-dom/client'; import App from './app';
(window as any).__recoverable = []; hydrateRoot(document.getElementById('root')!, <App />, { onRecoverableError: error => (window as any).__recoverable.push(String((error as Error)?.message ?? error)) });`);

const typedName = "Typed Reviewer", typedComment = "Typed before the page was live: brighten the opening photo.";
const storedIdentity = { name: "Saved Reviewer", email: "saved@example.com" }, storedComment = "An older unsent comment from last visit.";
const draft = () => encodeReviewDraft({ comment: storedComment, pin: null, decision: null, note: "" }, scope, Date.now() - 60_000);
const scenarios = [
  { name: "first visit, typed before hydration (the e2e funnel case): typed name and comment survive", storage: {}, type: { name: typedName, comment: typedComment }, expect: { name: typedName, comment: typedComment, banner: false, identityFields: true } },
  { name: "returning visitor typed over a saved name and draft: typed text wins, nothing is restored over it", storage: { identity: storedIdentity, draft: true }, type: { name: typedName, comment: typedComment }, expect: { name: typedName, email: storedIdentity.email, comment: typedComment, banner: false, identityFields: true } },
  { name: "returning visitor typed only a name: the empty comment is still restored, the typed name kept", storage: { identity: storedIdentity, draft: true }, type: { name: typedName }, expect: { name: typedName, email: storedIdentity.email, comment: storedComment, banner: true, identityFields: true } },
  { name: "returning visitor typed nothing: saved name and draft are restored as before", storage: { identity: storedIdentity, draft: true }, type: {}, expect: { name: storedIdentity.name, comment: storedComment, banner: true, identityFields: false } },
];

(async () => {
  const build = (entry, platform) => require("esbuild").build({ entryPoints: [path.join(out, entry)], bundle: true, outfile: path.join(out, entry.replace(".tsx", ".js")), platform, format: platform === "node" ? "cjs" : "iife", jsx: "automatic", loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "silent" });
  await Promise.all([build("server.tsx", "node"), build("client.tsx", "browser")]);
  const markup = require(path.join(out, "server.js")).html();
  const css = fs.readFileSync("src/app/client-review.css", "utf8");
  // The script is async so the server HTML is parsed and usable while the check holds the script back.
  const server = http.createServer((req, res) => {
    if (req.url === "/client.js") { res.setHeader("content-type", "application/javascript; charset=utf-8"); res.end(fs.readFileSync(path.join(out, "client.js"))); return; }
    res.setHeader("content-type", "text/html; charset=utf-8"); res.end(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="root">${markup}</div><script async src="/client.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await browserType.launch({ headless: true });
    for (const [index, scenario] of scenarios.entries()) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const entries = {};
      if (scenario.storage.identity) entries["makeborne.review-identity.v1"] = JSON.stringify(scenario.storage.identity);
      if (scenario.storage.draft) entries[reviewDraftKey(scope)] = draft();
      await context.addInitScript(values => { for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value); }, entries);
      const page = await context.newPage();
      const errors = collectPageErrors(page, []);
      let release; const gate = new Promise(resolve => { release = resolve; });
      await page.route("**/client.js", async route => { await gate; await route.continue(); });
      const posts = [];
      await page.route("**/api/review/**", async route => {
        const request = route.request();
        if (request.method() === "POST" && request.url().endsWith("/comments")) {
          const body = JSON.parse(request.postData() ?? "{}"); posts.push(body);
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ comment: { id: "33333333-3333-4333-8333-333333333333", kind: "comment", authorName: body.name, body: body.body, anchor: body.anchor, version, createdAt: "2026-10-22T00:03:00Z", resolved: false } }) });
        }
        return route.fulfill({ status: 204, body: "" }); // View beacon (client-review-beacon.tsx): not part of this check.
      });
      await page.goto(base, { waitUntil: "commit" });
      const composer = page.locator("form.cr-composer");
      const nameField = composer.getByLabel("Your name"), emailField = composer.getByLabel(/^Email/), commentField = page.locator("#cr-comment");
      await nameField.waitFor();
      assert.equal(await page.evaluate(() => "__restored" in window), false, "the page must not be live while the visitor types");
      if (scenario.type.name) await nameField.fill(scenario.type.name);
      if (scenario.type.comment) await commentField.fill(scenario.type.comment);
      release();
      await page.waitForFunction(() => window.__restored === true);
      // Let every render the restores scheduled commit before reading the fields.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 50)))));
      await page.screenshot({ path: path.join(out, `scenario-${index + 1}.png`), fullPage: true });
      assert.deepEqual(await page.evaluate(() => window.__recoverable), [], "hydration must not fall back to a client render");
      const expect = scenario.expect;
      if (expect.identityFields) {
        assert.equal(await nameField.count(), 1, `${scenario.name}: the name fields stay open, not collapsed to a saved name`);
        assert.equal(await nameField.inputValue(), expect.name, `${scenario.name}: name field`);
        if (expect.email !== undefined) assert.equal(await emailField.inputValue(), expect.email, `${scenario.name}: email field`);
      } else {
        assert.equal(await nameField.count(), 0, `${scenario.name}: a saved name collapses the identity fields`);
        await composer.getByText(`Commenting as ${expect.name}`).waitFor();
      }
      assert.equal(await commentField.inputValue(), expect.comment, `${scenario.name}: comment field`);
      assert.equal(await page.getByText(/Your unsent feedback from .* is back\./).count(), expect.banner ? 1 : 0, `${scenario.name}: restored-feedback notice`);
      // What is on screen is what is sent: the button is live and the POST carries the visible name and comment.
      const post = composer.getByRole("button", { name: "Post comment" });
      assert.ok(await post.isEnabled(), `${scenario.name}: Post comment is enabled for the comment on screen`);
      const sent = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith("/comments"), { timeout: 10_000 });
      await post.click();
      await sent;
      assert.equal(posts.length, 1);
      assert.equal(posts[0].name, expect.name, `${scenario.name}: posted name`);
      assert.equal(posts[0].body, expect.comment, `${scenario.name}: posted comment`);
      await page.getByRole("region", { name: "Comments" }).getByText(expect.comment).waitFor();
      assert.deepEqual(errors, []);
      console.log(`PASS browser ${engineLabel} ${scenario.name}`);
      await context.close();
    }
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
