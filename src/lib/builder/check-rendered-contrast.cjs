/* eslint-disable @typescript-eslint/no-require-imports -- Rendered-state contrast (audit NPD): pure helpers offline, then the real measurement in headless Chromium on fixture pages (a 127.0.0.1 server, no other network, no providers). Shows the static CSS-pair check misses state colours that the rendered measurement finds. */
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true}}).outputText, filename);
const {rewriteSelector, contrast, over, compositeBackground, requiredRatio, summarizeFindings} = require("./rendered-contrast.ts");
const {clientReadyCheck} = require("./client-ready.ts");

let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }

// A brand whose hover, focus and error colours are only set as state rules; the backgrounds come from parents.
const CSS = `body{margin:0;background:#ffffff;color:#1d1d24;font:16px/1.5 system-ui}
.nav{background:#ffffff;padding:12px}.nav a{color:#1d1d24;text-decoration:none}
.nav a:hover{color:#c7c7cf}
.cta{background:#3b2fc4;color:#ffffff;padding:10px 16px;border:0;font-size:16px}
.cta:focus-visible{background:#d9d6ff}
@media (hover:hover){.card:hover .card-title{color:#d0d0d8}}
.card{background:#ffffff;padding:16px}.card-title{color:#1d1d24}
input{border:2px solid #6b6b78;color:#1d1d24;background:#ffffff;padding:6px}
input:invalid,input[aria-invalid="true"]{border-color:#ffd4d4;color:#ff9a9a}
.fine{color:#1d1d24}.fine:hover{color:#000000}
.hero{background-image:linear-gradient(#000,#333);color:#ffffff}`;
const HTML = `<!doctype html><html lang="en"><head><style>${CSS}</style></head><body>
<nav class="nav"><a href="/menu">Menu</a> <a href="/about">About us</a></nav>
<main><h1>Ovenbird</h1><button class="cta" type="button">Book a table</button>
<a class="card" href="/menu"><span class="card-title">Seasonal menu</span></a>
<form><label>Email <input name="email" type="email" value="hello@ovenbird.co.uk" required></label></form>
<a class="fine" href="/contact">Contact</a><p class="hero">Over a gradient</p>
<p style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);color:#ffffff">Skip text</p></main></body></html>`;

(async () => {
  await check("state pseudo-classes become attributes of the same specificity; other selectors are untouched", () => {
    assert.equal(rewriteSelector(".nav a:hover"), '.nav a[data-mb-state~="hover"]');
    assert.equal(rewriteSelector("a:focus-visible, button:focus, a:active"), 'a[data-mb-state~="focus"], button[data-mb-state~="focus"], a[data-mb-state~="hover"]');
    assert.equal(rewriteSelector("input:user-invalid,input:invalid"), 'input[data-mb-state~="invalid"],input[data-mb-state~="invalid"]');
    assert.equal(rewriteSelector("form:focus-within label"), 'form[data-mb-state~="focus-within"] label');
    assert.equal(rewriteSelector(".hovered, .x::before"), null);
  });

  await check("contrast is computed on composited colours with WCAG size rules", () => {
    assert.equal(contrast([255, 255, 255, 1], [0, 0, 0, 1]), 21);
    assert.deepEqual(over([0, 0, 0, 0.5], [255, 255, 255, 1]), [127.5, 127.5, 127.5, 1]);
    assert.deepEqual(compositeBackground([[0, 0, 0, 0], [0, 0, 255, 0.5], [255, 255, 255, 1], [0, 0, 0, 1]]), [127.5, 127.5, 255, 1], "stops at the first opaque layer");
    assert.deepEqual(compositeBackground([[0, 0, 0, 0]]), [255, 255, 255, 1], "the canvas is white");
    assert.equal(compositeBackground([[0, 0, 0, 0], "image"]), "image");
    assert.equal(requiredRatio(16, 400), 4.5); assert.equal(requiredRatio(24, 400), 3); assert.equal(requiredRatio(19, 700), 3); assert.equal(requiredRatio(19, 400), 4.5);
    const one = {page: "/", state: "hover", kind: "text", element: "a", ratio: 2, required: 4.5, foreground: "#c7c7cf", background: "#ffffff"};
    assert.equal(summarizeFindings([one, {...one}, {...one, state: "focus"}]).length, 2);
  });

  await check("the static CSS-pair check doesn't see these state colours (the gap this closes)", () => {
    const findings = clientReadyCheck({files: [{path: "src/styles.css", content: CSS}], routes: [{path: "/"}], assets: []});
    assert.equal(findings.find(finding => finding.rule === "low-contrast"), undefined, "pre-change: no contrast finding for hover, focus or error colours");
  });

  // ---- The real measurement in Chromium -------------------------------------
  const {build} = require("esbuild"), {chromium} = require("playwright");
  const bundle = await build({entryPoints: [path.join(__dirname, "rendered-contrast.ts")], bundle: true, write: false, format: "iife", globalName: "RC", platform: "browser"});
  const server = http.createServer((req, res) => { res.setHeader("Content-Type", req.url === "/rc.js" ? "text/javascript" : "text/html"); res.end(req.url === "/rc.js" ? bundle.outputFiles[0].contents : "<!doctype html><script src=\"/rc.js\"></script>"); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage();
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
    page.on("pageerror", error => { throw error; });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const measure = html => page.evaluate(html => new Promise((resolve, reject) => {
      const frame = document.createElement("iframe");
      frame.setAttribute("sandbox", "allow-same-origin");
      frame.style.cssText = "position:fixed;left:-20000px;top:0;width:1280px;height:900px;border:0;visibility:hidden";
      frame.addEventListener("load", () => {
        try {
          const before = frame.contentDocument.documentElement.outerHTML;
          const result = RC.measureRenderedContrast(frame.contentDocument, frame.contentWindow, "/", RC.canvasColorParser(document));
          const after = frame.contentDocument.documentElement.outerHTML.replace(/<style data-mb-measure="">[^<]*<\/style>/, "");
          resolve({...result, restored: before === after, scripts: frame.contentDocument.querySelectorAll("script").length});
        } catch (error) { reject(error); }
      }, {once: true});
      frame.srcdoc = html;
      document.body.appendChild(frame);
    }), html);

    await check("Chromium: hover, focus and error colours are measured over their real backgrounds", async () => {
      const result = await measure(HTML);
      const got = result.findings.map(finding => `${finding.state} ${finding.kind} ${finding.element} ${finding.foreground}/${finding.background}`);
      assert.ok(got.includes("hover text a “Menu” #c7c7cf/#ffffff"), got.join("\n"));
      assert.ok(got.includes("hover text a “About us” #c7c7cf/#ffffff"));
      assert.ok(got.includes("focus text button “Book a table” #ffffff/#d9d6ff"), "focus background from a state rule, text colour from the default rule");
      assert.ok(got.includes("hover text span “Seasonal menu” #d0d0d8/#ffffff"), "parent :hover inside @media (hover:hover)");
      assert.ok(got.includes("invalid text input “hello@ovenbird.co.uk” #ff9a9a/#ffffff"));
      assert.ok(got.some(line => line.startsWith("invalid field-border input “email” #ffd4d4/")), "the invalid field's border is under 3:1");
      assert.ok(!got.some(line => /Contact|Ovenbird”|Skip text/.test(line)), "passing states, the heading and screen-reader-only text aren't reported");
      assert.ok(!got.some(line => line.startsWith("default")), "default colours here pass");
      assert.ok(result.unmeasured.image >= 1, "text over a gradient is counted as unmeasured, not passed");
      assert.ok(result.rewrittenRules >= 5 && result.measured > 8);
      assert.equal(result.restored, true, "the page is left exactly as loaded (state attributes removed)");
      assert.equal(result.scripts, 0);
      const menu = result.findings.find(finding => finding.element === "a “Menu”");
      assert.equal(menu.required, 4.5); assert.ok(menu.ratio < 2, String(menu.ratio));
    });

    await check("Chromium: a modern colour space (oklch) is read as sRGB; a page with good colours has no findings", async () => {
      const oklch = await measure('<!doctype html><html><head><style>body{background:#fff}a{color:#111}a:hover{color:oklch(0.66 0.1748 280)}</style></head><body><a href="/x">Low on hover</a></body></html>');
      assert.equal(oklch.findings.length, 1); assert.equal(oklch.findings[0].state, "hover"); assert.ok(oklch.findings[0].ratio > 2 && oklch.findings[0].ratio < 4.5, String(oklch.findings[0].ratio));
      const good = await measure('<!doctype html><html><head><style>body{background:#fff;color:#111}a:hover{color:#000;background:#eee}input:invalid{border:2px solid #b42318;color:#111}</style></head><body><a href="/x">Fine</a><input value="x" required pattern="y"></body></html>');
      assert.deepEqual(good.findings, []);
    });
  } finally { await browser.close(); server.close(); }
  console.log(`\n${passed} rendered contrast checks passed.`);
})().catch(error => { console.error(error); process.exit(1); });
