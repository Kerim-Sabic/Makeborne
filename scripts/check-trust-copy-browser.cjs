/* eslint-disable @typescript-eslint/no-require-imports -- Mounted Chromium checks for the trust-copy slice: Studio Settings labels where each setting is stored; the client review page keeps unsent feedback per link and version and never sends it by itself; composers use the app type scale (>=15px desktop, 16px on phones). All APIs are routed with fictional data; no network beyond 127.0.0.1, no AI, no mail.
 * Run: node scripts/check-trust-copy-browser.cjs [screenshot-dir] */
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs");
const { build } = require("esbuild"), { browserType, engineLabel, args: engineArgs } = require("./browser-engine.cjs"), { createServer } = require("node:http");

const shots = engineArgs[0] ? path.resolve(engineArgs[0]) : null;
const token = "Rv".repeat(21) + "x";
const review = version => ({ status: "active", kind: "website", title: "Harbour Bakery website", version, pinned: true, mode: "html", html: "<!doctype html><html><body style=\"font-family:sans-serif\"><header><h1>Harbour Bakery</h1></header><section><h2>Fresh every morning</h2><p>Sourdough and pastries.</p></section></body></html>",
  content: null, style: null, recipientName: "Ana Reed", message: "", expiresAt: "2099-01-01T00:00:00Z", decision: null, comments: [] });
const fixture = `import React from "react"; import { createRoot } from "react-dom/client";
import ClientReviewPage from "./src/components/client-review-page";
import Studio from "./src/components/studio";
const params = new URLSearchParams(location.search), view = params.get("view");
const reviews = { 4: ${JSON.stringify(review(4))}, 5: ${JSON.stringify(review(5))} };
createRoot(document.getElementById("root")).render(view === "studio" ? <Studio initialTab="settings" /> : <ClientReviewPage token=${JSON.stringify(token)} review={reviews[params.get("version") || 4]} />);`;
const mocks = {
  "next/link": `import React from "react"; export default function Link({ href, children, prefetch, ...rest }) { return <a href={typeof href === "string" ? href : "#"} {...rest}>{children}</a>; }`,
  "next/image": `import React from "react"; export default function Image({ src, alt, fill, sizes, priority, ...rest }) { return <img src={typeof src === "string" ? src : ""} alt={alt} {...rest} />; }`,
  "next/navigation": `export function useRouter() { return { push() {}, replace() {}, refresh() {}, prefetch() {} }; } export function usePathname() { return "/studio"; } export function useSearchParams() { return new URLSearchParams(); }`,
  "supabase-client": `export function createClient() { return { auth: { getUser: async () => ({ data: { user: null }, error: null }), getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) } }; }`,
  "use-creation-account": `export function useCreationAccount() { return { ready: true, error: "", accountId: null, workspace: null, clients: [] }; }`,
  "studio-account": `export default function StudioAccount() { return null; }`,
  "getting-started": `export default function GettingStarted() { return null; }`,
};
const mockFor = request => request.startsWith("next/") ? request
  : /[\\/]supabase[\\/]client$/.test(request) ? "supabase-client"
  : /(?:^|[\\/])(use-creation-account|studio-account|getting-started)$/.exec(request)?.[1];

async function bundle() {
  const css = [];
  const output = await build({ stdin: { contents: fixture, loader: "jsx", resolveDir: process.cwd() }, write: false, bundle: true, platform: "browser", jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
    logLevel: "silent", plugins: [{ name: "fixture", setup(b) {
      b.onResolve({ filter: /.*/ }, args => { const mock = mockFor(args.path); return mock && mocks[mock] ? { path: mock, namespace: "mock" } : undefined; });
      b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path], loader: "jsx", resolveDir: process.cwd() }));
      b.onResolve({ filter: /^@\// }, args => {
        const base = path.resolve("src", args.path.slice(2));
        return { path: [base, `${base}.tsx`, `${base}.ts`].find(file => fs.existsSync(file) && fs.statSync(file).isFile()) };
      });
      b.onLoad({ filter: /\.css$/ }, args => { css.push(fs.readFileSync(args.path, "utf8")); return { contents: "", loader: "js" }; });
    } }] });
  const styles = [fs.readFileSync("src/app/globals.css", "utf8"), ...css, fs.readFileSync("src/app/client-review.css", "utf8")].join("\n").replace(/@import[^;]+;/g, "");
  return { js: output.outputFiles[0].contents, styles };
}

// Every composer people type into, with the real stylesheets: >= 15px on desktop, 16px on phones (iOS zooms below 16px).
const composerHtml = `<div class="studio-shell"><div class="creation-modal"><div class="prompt-source"><textarea data-name="studio creation brief"></textarea></div></div></div>
<div class="lb"><div class="lb-composer"><textarea data-name="live builder"></textarea></div></div>
<div class="build-composer"><textarea data-name="build conversation"></textarea></div>
<div class="mk-composer"><textarea data-name="home composer" data-desktop="16"></textarea></div>
<form class="cr-composer"><textarea data-name="client review comment"></textarea></form><label class="cr-field"><textarea data-name="client review decision note"></textarea></label>
<div class="advisor-composer"><textarea data-name="advisor" data-desktop="14"></textarea></div>
<div class="mc-sheet"><textarea data-name="client email" data-desktop="13"></textarea></div>`;
const composerCss = ["globals", "creation-plan", "live-builder", "build-workspace", "home", "client-review", "expert-chat", "account-clients"].map(name => fs.readFileSync(`src/app/${name}.css`, "utf8")).join("\n").replace(/@import[^;]+;/g, "");

async function main() {
  const { js, styles } = await bundle();
  const server = createServer((req, res) => {
    const file = req.url.split("?")[0];
    if (file === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(js); }
    res.setHeader("Content-Type", "text/html");
    if (file === "/composers") return res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${composerCss}</style>${composerHtml}`);
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><div id="root"></div><script src="/fixture.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await browserType.launch({ headless: true });
  let passed = 0; const pass = name => { passed++; console.log(`PASS ${name}`); };
  const noScroll = async (page, label) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label}: no horizontal page scroll`);
  try {
    // ---- Settings: one storage label per setting, matching where it is stored.
    {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors = []; page.on("pageerror", error => errors.push(error.message));
      await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
      // Signed out for everything else; the badge setting answers as an owner (the later route wins).
      await page.route("**/api/**", route => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "AUTH_REQUIRED", message: "Sign in." } }) }));
      await page.route("**/api/workspaces/branding", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ showBadge: true, owned: true }) }));
      await page.goto(`${base}/?view=studio&tab=settings`);
      // The studio reads its tab from the address; open Settings from the navigation if it starts elsewhere.
      if (!(await page.getByRole("heading", { name: "Workspace settings." }).isVisible().catch(() => false))) await page.getByRole("button", { name: "Settings", exact: true }).first().click().catch(() => page.getByRole("link", { name: "Settings", exact: true }).first().click());
      await page.getByRole("heading", { name: "Workspace settings." }).waitFor({ timeout: 15000 }).catch(async error => { throw new Error(`${error.message}
page errors: ${errors.join(" | ")}
${(await page.locator("body").innerText()).slice(0, 600)}`); });
      await page.getByRole("heading", { name: /Website badge/ }).waitFor();
      const sections = await page.locator(".settings-panel section h2").evaluateAll(headings => headings.map(heading => [heading.firstChild.textContent.trim(), heading.querySelector(".settings-storage")?.textContent.trim() ?? null]));
      assert.deepEqual(sections, [["Account projects", "Saved to your account"], ["Drafts on this device", "This device"], ["Studio sounds", "This device"], ["Website badge", "Saved to your account"], ["Your data", "Saved to your account"]]);
      const text = await page.locator(".settings-panel").innerText();
      assert.doesNotMatch(text, /does not sync to the cloud|cloud/i);
      assert.match(text, /They are not saved to your account or other devices/);
      assert.equal(errors.length, 0, errors.join("\n"));
      pass("Settings: every setting says where it is stored, consistently, with no cloud vocabulary");
      if (shots) for (const [width, height] of [[1440, 1100], [375, 1400], [320, 1500]]) {
        await page.setViewportSize({ width, height }); await noScroll(page, `settings ${width}`);
        await page.locator(".settings-panel").screenshot({ path: path.join(shots, `settings-${width}.png`) });
      }
      await page.close();
    }

    // ---- Client review: unsent feedback survives closing; per link and version; never sent by itself.
    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage();
      await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
      const posts = [];
      await page.route("**/api/review/**", route => {
        const url = route.request().url();
        if (url.endsWith("/comments")) { posts.push(route.request().postDataJSON()); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ comment: { id: "c1", kind: "comment", version: 4, authorName: "Ana Reed", body: posts.at(-1).body, anchor: { kind: "general" }, resolved: false, createdAt: "2026-10-20T10:00:00Z" } }) }); }
        if (url.endsWith("/decision")) { posts.push(route.request().postDataJSON()); return route.fulfill({ status: 500, contentType: "application/json", body: "{}" }); }
        return route.fulfill({ status: 204, body: "" });
      });
      const open = async version => { await page.goto(`${base}/?version=${version}`); await page.getByRole("heading", { name: "Harbour Bakery website" }).waitFor(); await page.waitForTimeout(150); };
      const comment = () => page.locator("#cr-comment");
      await open(4);
      await page.getByLabel("Your name").fill("Ana Reed");
      await comment().fill("The hero photo feels too dark on phones.");
      await page.getByRole("button", { name: "Request changes" }).click();
      await page.getByLabel("Summary (optional)").fill("Please brighten the hero and add the new prices.");
      const keys = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("makeborne.review-draft.")));
      assert.equal(keys.length, 1); assert.ok(!keys[0].includes(token.slice(0, 20)), "the link token is not the storage key");
      const stored = await page.evaluate(key => localStorage.getItem(key), keys[0]);
      assert.doesNotMatch(stored, /Ana Reed/, "identity is not part of the draft");

      await open(4); // closing and reopening the link
      assert.equal(await comment().inputValue(), "The hero photo feels too dark on phones.");
      assert.equal(await page.getByLabel("Summary (optional)").inputValue(), "Please brighten the hero and add the new prices.");
      assert.match(await page.locator(".cr-draft-restored").innerText(), /Your unsent feedback from .+ is back\. Nothing has been sent\./);
      assert.equal(posts.length, 0, "restoring sends nothing");
      pass("unsent comment and change-request note come back after the page is closed, with nothing sent");
      if (shots) for (const [width, height] of [[1440, 1000], [375, 1300], [320, 1400]]) {
        await page.setViewportSize({ width, height }); await noScroll(page, `review ${width}`);
        await page.screenshot({ path: path.join(shots, `review-draft-${width}.png`), fullPage: width !== 1440 });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });

      await open(5);
      assert.equal(await comment().inputValue(), ""); assert.equal(await page.locator(".cr-draft-restored").count(), 0);
      pass("another version of the work does not show this version's draft");

      await open(4);
      await page.getByRole("button", { name: "Discard" }).click();
      assert.equal(await comment().inputValue(), "");
      assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("makeborne.review-draft.")).length), 0);
      await open(4);
      assert.equal(await comment().inputValue(), "");
      pass("Discard clears the fields and the stored copy");

      await comment().fill("Love the new logo.");
      await page.getByLabel("Your name").first().fill("Ana Reed");
      await page.getByRole("button", { name: "Post comment" }).click();
      await page.getByText("Comment added. Thank you!").waitFor();
      assert.equal(posts.length, 1); assert.equal(posts[0].body, "Love the new logo.");
      await open(4);
      assert.equal(await comment().inputValue(), "", "a posted comment is not restored");
      pass("posting a comment clears its draft; only the explicit Post button sends");
      await context.close();
    }

    // ---- Type scale: composers.
    {
      const page = await browser.newPage();
      for (const [width, expected] of [[1440, null], [375, 16], [320, 16]]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${base}/composers`);
        const sizes = await page.locator("textarea").evaluateAll(fields => fields.map(field => [field.dataset.name, parseFloat(getComputedStyle(field).fontSize), Number(field.dataset.desktop || 15)]));
        for (const [name, size, desktop] of sizes) {
          if (expected) assert.equal(size, expected, `${name} at ${width}px`);
          else assert.ok(size >= desktop, `${name} at ${width}px: ${size}px`);
        }
      }
      const tokens = await page.evaluate(() => { const style = getComputedStyle(document.documentElement); return ["--type-input", "--type-input-touch", "--state-error"].map(name => style.getPropertyValue(name).trim()); });
      assert.deepEqual(tokens, ["15px", "16px", "#9a2f2a"]);
      pass("composers: at least 15px on desktop (live builder, build, review, creation brief) and 16px on phones everywhere");
      await page.close();
    }
  } finally { await browser.close(); server.close(); }
  console.log(`${passed} mounted trust-copy checks passed (${engineLabel}, routed APIs, no network).`);
}
main().catch(error => { console.error(error); process.exit(1); });
