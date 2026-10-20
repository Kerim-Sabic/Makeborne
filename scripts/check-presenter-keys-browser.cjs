/* eslint-disable @typescript-eslint/no-require-imports -- Mounted deck Presenter in Chromium (audit F14): native buttons keep Enter/Space; canvas shortcuts, Escape and click-to-advance still work. The slide renderer is replaced by three inert slides (host keyboard routing only, not renderer fidelity); fullscreen is denied by the page. Local only. Run: node scripts/check-presenter-keys-browser.cjs */
const path = require("node:path"), assert = require("node:assert/strict"), { build } = require("esbuild"), { chromium } = require("playwright"), { createServer } = require("node:http");

const fixture = `import React, { useState } from "react"; import { createRoot } from "react-dom/client";
import { Presenter } from "./src/components/document-preview";
const deck = { kind: "deck", title: "Fixture deck", slides: [{}, {}, {}] };
function App() { const [open, setOpen] = useState(true); window.reopen = () => setOpen(true); window.isOpen = open;
  return <><button type="button" id="opener" onClick={() => setOpen(true)}>Present</button>{open ? <Presenter deck={deck} images={{}} onClose={() => setOpen(false)} /> : <p id="closed">closed</p>}</>; }
createRoot(document.getElementById("root")).render(<App />);`;
// Three inert slides; slide 2 has a link and selectable text to test click-to-advance.
const renderDeck = `export function deckHtml() { return '<!doctype html><body><div class="deck">' +
  '<section class="slide"><h1>One</h1></section><section class="slide"><h1>Two</h1><p id="text">Selectable sentence</p><a id="link" href="#x">A link</a></section><section class="slide"><h1>Three</h1></section></div></body>'; }`;

async function main() {
  const output = await build({ stdin: { contents: fixture, loader: "jsx", resolveDir: process.cwd() }, write: false, bundle: true, platform: "browser", jsx: "automatic", define: { "process.env": "{}" },
    plugins: [{ name: "fixture", setup(b) {
      b.onResolve({ filter: /render-deck$|render-book$|book-markup$|cloud-api$/ }, args => ({ path: args.path, namespace: "mock" }));
      b.onLoad({ filter: /render-deck$/, namespace: "mock" }, () => ({ contents: renderDeck, loader: "js" }));
      b.onLoad({ filter: /render-book$/, namespace: "mock" }, () => ({ contents: "export const BOOK_TRIM = {}; export function bookHtml() { return ''; } export function chapterLabel() { return ''; }", loader: "js" }));
      b.onLoad({ filter: /book-markup$/, namespace: "mock" }, () => ({ contents: "export function wordCount() { return 0; }", loader: "js" }));
      b.onLoad({ filter: /cloud-api$/, namespace: "mock" }, () => ({ contents: "export async function readCloudImage() { throw new Error('no images'); }", loader: "js" }));
      b.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
      b.onResolve({ filter: /^@\// }, args => ({ path: path.resolve("src", args.path.slice(2) + (args.path.endsWith(".css") ? "" : ".ts")) }));
    } }] });
  const server = createServer((req, res) => {
    res.setHeader("Permissions-Policy", "fullscreen=()");
    res.setHeader("Content-Type", req.url === "/fixture.js" ? "text/javascript" : "text/html");
    res.end(req.url === "/fixture.js" ? output.outputFiles[0].contents : '<!doctype html><div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  let passed = 0; const pass = name => { passed++; console.log(`PASS ${name}`); };
  try {
    const page = await browser.newPage();
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const counter = async () => (await page.locator(".dp-present-bar span").innerText()).trim();
    const open = async () => (await page.locator(".dp-present").count()) === 1;
    const reopen = async () => { await page.evaluate(() => window.reopen()); await page.locator(".dp-present").waitFor(); await page.locator("iframe").evaluate(frame => new Promise(resolve => frame.contentDocument?.readyState === "complete" ? resolve() : frame.addEventListener("load", resolve, { once: true }))); };
    await page.locator("iframe").evaluate(frame => new Promise(resolve => frame.contentDocument?.readyState === "complete" ? resolve() : frame.addEventListener("load", resolve, { once: true })));

    await page.getByRole("button", { name: "Next slide" }).click();
    assert.equal(await counter(), "2 / 3"); pass("pointer Next advances (1 → 2)");

    // The audit's failures: Enter and Space on a focused Previous button, Enter on Exit.
    await page.getByRole("button", { name: "Previous slide" }).focus();
    await page.keyboard.press("Enter");
    assert.equal(await counter(), "1 / 3", "Enter on Previous goes back, not forward"); pass("Enter on focused Previous slide goes back (2 → 1)");
    await page.getByRole("button", { name: "Next slide" }).click();
    await page.getByRole("button", { name: "Previous slide" }).focus();
    await page.keyboard.press(" ");
    assert.equal(await counter(), "1 / 3"); pass("Space on focused Previous slide goes back (2 → 1)");
    await page.getByRole("button", { name: "Next slide" }).focus();
    await page.keyboard.press("Enter");
    assert.equal(await counter(), "2 / 3", "Enter on Next advances exactly once"); pass("Enter on focused Next slide advances exactly one slide");
    await page.getByRole("button", { name: "Exit presentation" }).focus();
    await page.keyboard.press("Enter");
    assert.equal(await open(), false, "Enter on Exit closes"); pass("Enter on focused Exit presentation closes the presenter");

    // Canvas shortcuts still work from the presenter itself.
    await reopen();
    await page.locator(".dp-present").focus();
    await page.keyboard.press("ArrowRight"); assert.equal(await counter(), "2 / 3");
    await page.keyboard.press("End"); assert.equal(await counter(), "3 / 3");
    await page.keyboard.press("ArrowRight"); assert.equal(await counter(), "3 / 3", "stops at the last slide");
    await page.keyboard.press("Home"); assert.equal(await counter(), "1 / 3");
    await page.keyboard.press("ArrowLeft"); assert.equal(await counter(), "1 / 3", "stops at the first slide");
    await page.keyboard.press(" "); assert.equal(await counter(), "2 / 3", "Space on the canvas advances");
    await page.keyboard.press("Shift+ "); assert.equal(await counter(), "1 / 3", "Shift+Space goes back");
    await page.keyboard.press("Control+ArrowRight"); await page.keyboard.press("Alt+ArrowRight"); assert.equal(await counter(), "1 / 3", "modifier shortcuts are left to the browser");
    pass("canvas Arrow/Home/End/Space work with first/last limits; modifier combinations are ignored");

    // Inside the slide frame: keys and click-to-advance, but not on a link or a text selection.
    const slide = page.frameLocator("iframe");
    await page.locator("iframe").focus();
    await slide.locator("body").press("ArrowRight"); assert.equal(await counter(), "2 / 3", "keys from the slide frame navigate once");
    // A srcdoc frame resolves "#x" against the host URL; keep the fixture frame in place.
    // (attached from the host realm, like the presenter's own listener: the sandbox has no allow-scripts).
    await page.locator("iframe").evaluate(frame => frame.contentDocument.getElementById("link").addEventListener("click", event => event.preventDefault()));
    await slide.locator("#link").click(); assert.equal(await counter(), "2 / 3", "clicking a link in a slide does not advance");
    await slide.locator("#text").selectText();
    await slide.locator("#text").dispatchEvent("click");
    assert.equal(await counter(), "2 / 3", "ending a text selection does not advance");
    await page.locator("iframe").evaluate(frame => frame.contentWindow.getSelection().removeAllRanges());
    await slide.locator("h1").nth(1).click(); assert.equal(await counter(), "3 / 3", "clicking the slide itself advances");
    pass("in the slide frame: keys navigate once; links and selections don't advance; a plain click does");

    await page.keyboard.press("Escape");
    assert.equal(await open(), false); pass("Escape closes the presenter (fullscreen denied by the page: modal fallback)");

    // Focus enters the presenter on open and returns to the control that opened it on close.
    const focused = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.className || document.activeElement?.tagName);
    for (const close of ["Escape", "Exit"]) {
      await page.locator("#opener").focus(); await page.keyboard.press("Enter");
      await page.locator(".dp-present").waitFor();
      assert.equal(await focused(), "dp-present", "opening moves focus into the presenter");
      await page.getByRole("button", { name: "Next slide" }).click();
      assert.equal(await counter(), "2 / 3", "presenting works after opening from the control");
      if (close === "Escape") { await page.locator(".dp-present").focus(); await page.keyboard.press("Escape"); }
      else { await page.getByRole("button", { name: "Exit presentation" }).focus(); await page.keyboard.press("Enter"); }
      assert.equal(await open(), false);
      assert.equal(await focused(), "opener", `closing with ${close} returns focus to the opener`);
    }
    pass("focus moves into the presenter on open and back to its opener on Escape or Exit");
  } finally { await browser.close(); server.close(); }
  console.log(`${passed} mounted presenter checks passed (Chromium, inert slides, no network).`);
}
main().catch(error => { console.error(error); process.exit(1); });
