/* eslint-disable @typescript-eslint/no-require-imports -- Mounted publish + SEO panels in Chromium (audit M07): consent and check results belong to the version that was reviewed. The publication API is answered by Playwright routes (fictional site, nothing published); the snapshot renderer is replaced by fixed HTML. Local only. Run: node scripts/check-checked-version-browser.cjs */
const path = require("node:path"), assert = require("node:assert/strict"), { build } = require("esbuild"), { chromium } = require("playwright"), { createServer } = require("node:http");

const source = { schemaVersion: 1, toolchainId: "react-vite-v1", entrypoint: "src/main.tsx", files: [{ path: "src/main.tsx", content: "export default function App() { return <h1>Fixture</h1>; }" }], assets: [], routes: [{ path: "/", title: "Home" }] };
const fixture = `import React, { useState } from "react"; import { createRoot } from "react-dom/client";
import WebsitePublish from "./src/components/website-publish";
import WebsiteSeo from "./src/components/website-seo";
const base = ${JSON.stringify(source)};
function App() {
  const [version, setVersion] = useState(3), [dirty, setDirty] = useState(false), [content, setContent] = useState(base.files[0].content);
  window.setVersion = setVersion; window.setDirty = setDirty; window.edit = text => setContent(text);
  const source = { ...base, files: [{ path: base.files[0].path, content }] };
  return <main>
    <WebsitePublish accountId="acct-1" workspaceId="w1" artifactId="00000000-0000-4000-8000-000000000001" title="Fixture site" version={version} dirty={dirty} disabled={false} owner={true} source={source} />
    <WebsiteSeo source={source} siteTitle="Fixture site" seo={{ description: "A fictional fixture site for checks." }} disabled={false} version={version} dirty={dirty} scope={{ accountId: "acct-1", workspaceId: "w1", artifactId: "a1" }} onChange={() => {}} />
  </main>;
}
createRoot(document.getElementById("root")).render(<App />);`;

async function main() {
  const output = await build({ stdin: { contents: fixture, loader: "jsx", resolveDir: process.cwd() }, write: false, bundle: true, platform: "browser", jsx: "automatic", define: { "process.env": "{}" },
    plugins: [{ name: "fixture", setup(b) {
      b.onResolve({ filter: /publish-snapshot$|website-enquiries$|\/cloud-api$|^\.\/cloud-api$/ }, args => ({ path: args.path, namespace: "mock" }));
      b.onLoad({ filter: /publish-snapshot$/, namespace: "mock" }, () => ({ contents: "export async function captureProjectSnapshot() { return '<!doctype html><html><head><title>Fixture</title><meta name=\"description\" content=\"A fictional fixture site for checks.\"></head><body><h1>Fixture</h1></body></html>'; }", loader: "js" }));
      b.onLoad({ filter: /website-enquiries$/, namespace: "mock" }, () => ({ contents: "export default function WebsiteEnquiries() { return null; }", loader: "js" }));
      b.onLoad({ filter: /cloud-api$/, namespace: "mock" }, () => ({ contents: "export function cloudAccountGuard() { return () => {}; }", loader: "js" }));
      b.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
      b.onResolve({ filter: /^@\// }, args => ({ path: path.resolve("src", args.path.slice(2) + (args.path.endsWith(".css") ? "" : ".ts")) }));
    } }] });
  const server = createServer((req, res) => { res.setHeader("Content-Type", req.url === "/fixture.js" ? "text/javascript" : "text/html"); res.end(req.url === "/fixture.js" ? output.outputFiles[0].contents : '<!doctype html><div id="root"></div><script src="/fixture.js"></script>'); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  let passed = 0; const pass = name => { passed++; console.log(`PASS ${name}`); };
  try {
    const page = await browser.newPage();
    page.on("pageerror", error => console.error("pageerror", error.message));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
    const posts = [];
    await page.route("**/publication", route => {
      if (route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ site: null }) });
      posts.push(JSON.parse(route.request().postData()));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ site: { slug: "fixture-site-00000000", live: true, interactive: false, scripted: false, version_number: posts.at(-1).version, revision: 1 } }) });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0))));
    const consent = page.getByRole("checkbox", { name: /I’ve reviewed version/ });
    const publishButton = page.getByRole("button", { name: /Publish/ }).first();
    await consent.waitFor();

    // 1(a): consent for version 3 does not carry over to an autosaved version 4.
    assert.match(await consent.locator("xpath=..").innerText(), /reviewed version 3/);
    await consent.check();
    assert.equal(await publishButton.isEnabled(), true);
    await page.evaluate(() => window.setVersion(4)); await settle();
    assert.equal(await consent.isChecked(), false, "a newer version needs a fresh review");
    assert.equal(await publishButton.isEnabled(), false);
    assert.match(await consent.locator("xpath=..").innerText(), /reviewed version 4/);
    await page.evaluate(() => window.setDirty(true)); await settle();
    assert.equal(await consent.isDisabled(), true, "unsaved edits can't be reviewed for publishing");
    await page.evaluate(() => window.setDirty(false)); await settle();
    await consent.check(); await publishButton.click();
    await page.getByText("Your saved website is live").waitFor();
    assert.equal(posts.length, 1); assert.equal(posts[0].version, 4, "publishes the version that was reviewed");
    pass("legacy publish: consent is bound to the reviewed version; a newer save clears it; the reviewed version is published");

    // Client-ready check names what it read.
    assert.match(await page.locator(".client-ready-scope").innerText(), /^Checked saved version 4\.$/);
    await page.evaluate(() => window.setDirty(true)); await settle();
    assert.match(await page.locator(".client-ready-scope").innerText(), /^Checked version 4 with unsaved changes\.$/);
    await page.evaluate(() => window.setDirty(false)); await settle();
    pass("client-ready check states which version (and whether unsaved changes) it read");

    // 5: SEO results are labelled with their version and marked stale after edits or saves.
    await page.getByRole("button", { name: "Check my site" }).click();
    const label = page.locator(".ws-checked");
    await label.waitFor();
    assert.equal(await label.innerText(), "Checked saved version 4.");
    await page.evaluate(() => window.edit("export default function App() { return <h1>Changed</h1>; }"));
    await page.waitForFunction(() => /Your site changed after this check/.test(document.querySelector(".ws-checked")?.textContent ?? ""), null, { timeout: 5000 });
    assert.match(await label.innerText(), /Your site changed after this check, so these results may be out of date/);
    assert.equal(await page.locator(".ws-results[data-stale]").count(), 1);
    await page.getByRole("button", { name: "Check my site" }).click();
    await page.waitForFunction(() => document.querySelector(".ws-checked")?.textContent === "Checked saved version 4.");
    await page.evaluate(() => window.setVersion(5)); await settle();
    assert.match(await label.innerText(), /^Checked saved version 4\. Your site changed/);
    pass("SEO results name their version and turn out-of-date after an edit or a newer save");
  } finally { await browser.close(); server.close(); }
  console.log(`${passed} mounted checked-version checks passed (Chromium, routed API, nothing published).`);
}
main().catch(error => { console.error(error); process.exit(1); });
