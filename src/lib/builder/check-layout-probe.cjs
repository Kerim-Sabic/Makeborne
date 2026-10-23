/* eslint-disable @typescript-eslint/no-require-imports -- Rendered layout gate (layout-probe.ts) in headless Chromium on fixture pages (a 127.0.0.1 server, no other network, no providers): the two defects of round 3D w22 that every instrument missed (a line running under a cut-out image with pointer-events: none, a tag band wrapping an orphan word onto a second row), the cases that must pass, and the static reduced-motion band gate. */
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const { qualityProblems } = require("./quality-gates.ts");
const { coveredProblem, wrappedProblem } = require("./contrast-gate.ts");

let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }

const BASE = "body{margin:0;font:18px/1.4 Arial,sans-serif;background:#1d1430;color:#f3eefb}h1{font-size:64px;margin:0}";
// Round 3D w22: the hero line runs to its box's right edge, and a cut-out bike (absolutely positioned, pointer-events: none) is laid over its end.
const OCCLUDED = `<style>${BASE}.hero{position:relative;width:1200px;height:420px;padding:40px}.lede{width:900px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#c6f04a}
.bike{position:absolute;left:640px;top:150px;width:420px;height:260px;pointer-events:none;background:#555}</style>
<section class="hero"><h1>Flat tyre? Just roll in.</h1><p class="lede">Lekke band? Gewoon binnenlopen. Al het andere op afspraak, dus bel of boek online.</p><img class="bike" alt="" width="420" height="300" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></section>`;
// The same layout done right: the text block sits above the image on a solid panel.
const ON_PANEL = `<style>${BASE}.hero{position:relative;width:1200px;height:420px;padding:40px}.lede{position:relative;z-index:2;width:900px;background:#1d1430;padding:8px}
.bike{position:absolute;left:640px;top:150px;width:420px;height:260px;pointer-events:none;z-index:1;background:#555}</style>
<section class="hero"><h1>Flat tyre? Just roll in.</h1><p class="lede">Lekke band? Gewoon binnenlopen. Al het andere op afspraak.</p><img class="bike" alt="" width="420" height="300" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></section>`;
// An ellipsis that ends well before a neighbouring image: clipped on purpose, never covered.
const ELLIPSIS = `<style>${BASE}.row{position:relative;width:1200px;height:200px}.lede{width:500px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pic{position:absolute;left:620px;top:0;width:400px;height:200px;background:#555}</style>
<div class="row"><p class="lede">Lekke band? Gewoon binnenlopen. Al het andere op afspraak, dus bel of boek online.</p><img class="pic" alt="" width="400" height="200" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div>`;
const tags = ["City bikes ✳", "Cargo bikes ✳", "E-bikes, all brands ✳", "Walk-in flat tyres ✳", "Refurbished bikes ✳", "3-month workshop guarantee ✳", "Utrecht ✳"].map(tag => `<li>${tag}</li>`).join("");
// Round 3D w22: the lime tag band wraps "Utrecht ✳" onto a second row.
const WRAPPED = `<style>${BASE}.marquee{background:#c6f04a;color:#1d1430;max-width:1000px}.marquee-track{display:flex;flex-wrap:wrap;gap:24px;list-style:none;margin:0;padding:12px 24px}</style>
<div class="marquee" aria-label="What we fix"><ul class="marquee-track">${tags}</ul></div>`;
// One row, clipped by the band (also when it does not move).
const ONE_ROW = `<style>${BASE}.marquee{background:#c6f04a;color:#1d1430;overflow:clip}.marquee-track{display:flex;flex-wrap:nowrap;width:max-content;gap:24px;list-style:none;margin:0;padding:12px 24px}.marquee-track li{white-space:nowrap}</style>
<div class="marquee" aria-label="What we fix"><ul class="marquee-track">${tags}</ul></div>`;

(async () => {
  const { build } = require("esbuild"), { chromium } = require("playwright");
  const bundle = await build({ entryPoints: [path.join(__dirname, "layout-probe.ts")], bundle: true, write: false, format: "iife", globalName: "LP", platform: "browser" });
  const server = http.createServer((req, res) => { res.setHeader("Content-Type", req.url === "/lp.js" ? "text/javascript" : "text/html"); res.end(req.url === "/lp.js" ? bundle.outputFiles[0].contents : "<!doctype html><script src=\"/lp.js\"></script>"); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const probe = (html, width = 1440) => page.evaluate(({ html, width }) => new Promise((resolve, reject) => {
      const frame = document.createElement("iframe");
      frame.setAttribute("sandbox", "allow-same-origin");
      frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;height:900px;border:0`;
      frame.addEventListener("load", () => {
        try {
          const doc = frame.contentDocument, view = frame.contentWindow;
          const before = doc.documentElement.outerHTML;
          const result = { covered: LP.coveredText(doc, view, width), wrapped: LP.wrappedBands(doc, view, width) };
          resolve({ ...result, restored: doc.documentElement.outerHTML === before });
        } catch (error) { reject(error); } finally { frame.remove(); }
      }, { once: true });
      frame.srcdoc = `<!doctype html><html lang="en"><head></head><body>${html}</body></html>`;
      document.body.appendChild(frame);
    }), { html, width });

    await check("covered text: a line running under a cut-out image with pointer-events: none is found (round 3D w22)", async () => {
      const result = await probe(OCCLUDED);
      assert.equal(result.covered.length, 1, JSON.stringify(result.covered));
      assert.match(result.covered[0].text, /^Lekke band\? Gewoon binnenlopen/); assert.match(result.covered[0].by, /^img\.bike/);
      assert.ok(result.restored, "the probe leaves the page as it found it");
      assert.match(coveredProblem(result.covered[0]), /Covered text: "Lekke band\? Gewoon binnenlopen.*hidden under img\.bike at 1440 px wide/);
    });
    await check("covered text: text set above an image on a panel, and an ellipsis that ends before an image, pass", async () => {
      assert.deepEqual((await probe(ON_PANEL)).covered, []);
      assert.deepEqual((await probe(ELLIPSIS)).covered, []);
    });
    await check("wrapped band: a tag band with an orphan second row is found; a one-row band passes, at desktop and phone widths", async () => {
      const wrapped = await probe(WRAPPED, 1440);
      assert.equal(wrapped.wrapped.length, 1); assert.ok(wrapped.wrapped[0].rows >= 2);
      assert.match(wrappedProblem(wrapped.wrapped[0]), /Wrapped band: ul\.marquee-track .* breaks into \d rows at 1440 px wide.*one row/);
      assert.equal((await probe(WRAPPED, 390)).wrapped.length, 1);
      assert.deepEqual((await probe(ONE_ROW, 1440)).wrapped, []);
      assert.deepEqual((await probe(ONE_ROW, 390)).wrapped, []);
    });
  } finally { await browser.close(); server.close(); }

  await check("static gate: a reduced-motion block that wraps a marquee track is refused; one that keeps one row passes", () => {
    const files = new Map([["src/styles/motion.css", "@keyframes mq{to{transform:translateX(-50%)}}\n@media (prefers-reduced-motion: reduce) { .marquee-track { animation: none; flex-wrap: wrap; } .marquee-track [aria-hidden] { display: none; } }"]]);
    const problems = qualityProblems({ files, changed: new Set(files.keys()) });
    assert.ok(problems.some(problem => /Under prefers-reduced-motion \.marquee-track wraps a marquee or tag band into several rows/.test(problem)), problems.join("\n"));
    const ok = new Map([["src/styles/motion.css", "@keyframes mq{to{transform:translateX(-50%)}}\n@media (prefers-reduced-motion: reduce) { .marquee-track { animation: none; } .marquee { mask-image: linear-gradient(90deg, #000 85%, transparent); } }"]]);
    assert.ok(!qualityProblems({ files: ok, changed: new Set(ok.keys()) }).some(problem => /wraps a marquee/.test(problem)));
  });

  await check("the builder is told: images never cover text, bands are always one row", () => {
    const prompt = fs.readFileSync(path.join(__dirname, "prompt.ts"), "utf8");
    assert.match(prompt, /a positioned image or cut-out never covers a line of text, even with pointer-events: none/);
    assert.match(prompt, /It is always exactly one row \(flex-wrap: nowrap on the track, white-space: nowrap on the items, overflow: clip on the band\)/);
    assert.doesNotMatch(prompt, /becomes a static wrapped list/);
    const probe = fs.readFileSync(path.join(__dirname, "contrast-probe.ts"), "utf8");
    assert.match(probe, /wrapped: wrappedBands\(doc, view, width\)/, "the finish gate runs the band check");
  });

  console.log(`\n${passed} layout probe checks passed (headless Chromium on 127.0.0.1 fixtures).`);
})().catch(error => { console.error(error); process.exit(1); });
