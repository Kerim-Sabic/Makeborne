/* eslint-disable @typescript-eslint/no-require-imports -- Offline: design comps in the owner's reference pattern (layout %, hex, quoted lines, navigation, pill, TAIL_SITE), the comp canvas and quality (measured cells only), and the first phone screen rule in headless Chromium on 127.0.0.1 fixtures. No providers. */
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const { TAIL_SITE, TAIL_PHONE, COMP_SHAPE, COMP_CANVASES, CompInputSchema, compPrompt, compInputIssues, compText, compCell, colourName } = require("./comp-prompt.ts");
const { COMP_FRAME } = require("./layout-probe.ts");
const { firstScreenProblem, BLOCKING_PROBLEM } = require("./contrast-gate.ts");
const { sizeIssue } = require("../ai/image-cells.ts");

let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }

// The reference r_bikes, written as a comp input.
const BIKES = CompInputSchema.parse({ section: "top", viewport: "desktop", brand: "Spoke & Chain", colors: { ground: "#1D3FA8", ink: "#FFFFFF", accent: "#C6F04A" }, type: "bold condensed sans",
  nav: ["Repairs", "Bikes", "Workshop"], cta: { label: "Book a repair", style: "filled", color: "#C6F04A" },
  layout: [{ area: "left", pct: 46, content: "solid cobalt #1D3FA8 type field with the headline, the line and the pill" }, { area: "right", pct: 54, content: "full-bleed photograph" }],
  lines: [{ role: "headline", text: "Fixed by / Friday." }, { role: "subline", text: "Repairs, servicing and second-hand bikes in Leipzig." }], accent: { words: "Friday.", treatment: "in lime" },
  subject: "a crisp studio photograph of a vintage steel road bike in teal with a brown leather saddle, side view" });
const CONCEPT = { chosen: { name: "Friday promise" }, artSystem: { palette: "cobalt ground, white ink, electric lime accent", type: "a bold condensed grotesk for display, a plain sans for text", imagery: "crisp studio photographs of bikes, side view", motif: "a lime underline", motion: "one wipe" },
  sections: [{ id: "top", composition: "editorial-split", job: "the Friday promise and the booking" }, { id: "rates", composition: "price-list", job: "repair prices" }] };

(async () => {
  await check("desktop comp: the reference paragraph (brand, hex colours, navigation, pill, layout %, quoted lines with breaks, accent, subject) and TAIL_SITE", async () => {
    const prompt = compPrompt(BIKES, CONCEPT, "2560x1440");
    for (const part of [/^The homepage of a website called "Spoke & Chain": cobalt blue background #1D3FA8, white text #FFFFFF, [a-z ]*lime accent #C6F04A\./,
      /Top navigation: wordmark "Spoke & Chain" left; "Repairs", "Bikes", "Workshop" right of centre; a [a-z ]*lime pill "Book a repair" \(#C6F04A\) right\./,
      /Left 46%: solid cobalt #1D3FA8 type field with the headline, the line and the pill\. Right 54%: full-bleed photograph\./,
      /a huge bold condensed sans headline on two lines "Fixed by" \/ "Friday\." with "Friday\." in lime; a short line "Repairs, servicing and second-hand bikes in Leipzig\."/,
      /The photograph: a crisp studio photograph of a vintage steel road bike in teal with a brown leather saddle, side view\./, /Art system: palette cobalt ground/]) assert.match(prompt, part);
    assert.ok(prompt.endsWith(TAIL_SITE), "the tail closes the prompt");
    assert.match(TAIL_SITE, /^Flat, straight-on, pixel-perfect screenshot of the homepage filling the entire 16:9 image edge to edge: no browser chrome, no device, no hands, no desk, no perspective\. Award-winning, distinctive design with its own typefaces and colours, crisp typography, generous whitespace\. All text spelled exactly as given, perfectly legible, correctly kerned, no extra words, no garbled letters, no lorem ipsum\.$/);
    assert.doesNotMatch(prompt, /cropped away/, "a native 16:9 canvas needs no crop note");
    // On the measured 3:2 canvas the cut margins are named.
    assert.match(compPrompt(BIKES, CONCEPT, "1536x1024"), /The top 7\.8% and bottom 7\.8% of the canvas are cropped away: keep the navigation, every word and the pill inside the middle 84\.4%/);
    assert.equal(compText(BIKES), "Spoke & Chain / Repairs / Bikes / Workshop / Fixed by / Friday. / Repairs, servicing and second-hand bikes in Leipzig. / Book a repair");
    assert.deepEqual(compInputIssues(BIKES), []);
    console.log(`  sample prompt (${prompt.length} chars):\n${prompt.split("\n").map(line => `    ${line}`).join("\n")}`);
  });

  await check("phone comp: the whole first phone screen, headline and pill inside it, the photograph a band, the phone tail", async () => {
    const phone = CompInputSchema.parse({ ...BIKES, viewport: "mobile", nav: undefined, layout: [{ area: "top", pct: 30, content: "the photograph as a band under the top bar" }, { area: "bottom", pct: 70, content: "cobalt type field with the headline, the line and the pill" }] });
    const prompt = compPrompt(phone, CONCEPT, "1152x2496");
    assert.match(prompt, /^The first phone screen of the homepage of a website called "Spoke & Chain"/);
    assert.match(prompt, /Top bar: wordmark "Spoke & Chain" left, a simple menu icon right\./);
    assert.match(prompt, /Top 30%: the photograph as a band under the top bar\. Bottom 70%: cobalt type field/);
    assert.match(prompt, /below it a [a-z ]*lime pill "Book a repair"/);
    assert.match(prompt, /This is one phone screen, 390 × 844 px: the top bar, the whole headline and the "Book a repair" pill sit fully inside it, the pill above the bottom tenth/);
    assert.ok(prompt.endsWith(TAIL_PHONE));
    assert.match(compPrompt(phone, CONCEPT, "1024x1536"), /The left 15\.3% and right 15\.3% of the canvas are cropped away/);
    assert.deepEqual(compInputIssues(phone), [], "phones need no navigation items");
  });

  await check("comp inputs that cannot be drawn as written are sent back", async () => {
    const issues = input => compInputIssues(CompInputSchema.parse({ ...BIKES, ...input }));
    assert.match(issues({ layout: [{ area: "left", pct: 40, content: "type" }, { area: "right", pct: 54, content: "photo" }] })[0], /left \+ right must be 100% \(they are 94%\)/);
    assert.match(issues({ layout: [{ area: "full", pct: 100, content: "photo" }, { area: "left", pct: 50, content: "type" }] })[0], /full area is the whole screen/);
    assert.match(issues({ nav: [] }).join(), /spells out its 2-4 top navigation items/);
    assert.match(issues({ accent: { words: "Monday.", treatment: "in lime" } }).join(), /"Monday\." is not in any line/);
    assert.match(issues({ lines: [{ role: "subline", text: "Only a line" }] }).join(), /needs its headline/);
    assert.match(issues({ lines: [{ role: "headline", text: Array(20).fill("ab").join(" ") }, { role: "subline", text: Array(20).fill("cd").join(" ") }] }).join(), /43 words besides the navigation; at most 40 on a desktop comp/);
    assert.match(compInputIssues(CompInputSchema.parse({ ...BIKES, viewport: "mobile", lines: [{ role: "headline", text: "One / Two / Three / Four / Five" }] })).join(), /at most four lines/);
    assert.throws(() => CompInputSchema.parse({ ...BIKES, colors: { ground: "blue", ink: "#FFFFFF", accent: "#C6F04A" } }), /#RRGGBB/);
    assert.equal(colourName("#1D3FA8"), "cobalt blue"); assert.equal(colourName("#F4EDE3"), "warm cream"); assert.equal(colourName("#111111"), "near-black");
  });

  await check("the comp plan names the four comps by section id; the gate asks twice and names the missing ones; comps keep their ground", () => {
    const { compPlan, compsNextStep, compsFromSource, conceptComment } = require("./concept.ts");
    const sections = [{ id: "top", composition: "editorial-split", job: "x" }, { id: "menu", composition: "price-list", job: "x" }, { id: "book", composition: "form-panel", job: "x" }, { id: "room", composition: "full-bleed-photo", job: "x" }];
    assert.deepEqual(compPlan(sections), ["top (desktop)", "top (mobile)", "menu (desktop)", "room (desktop)"], "forms, contact cards and quotes are not heart sections");
    assert.match(compsNextStep(sections), /call generate_comp 4 times, for exactly these: top \(desktop\), top \(mobile\), menu \(desktop\), room \(desktop\)/);
    const agent = fs.readFileSync(path.join(__dirname, "agent.ts"), "utf8");
    assert.match(agent, /compsAsked < 2 && \(compsAsked === 0 \|\| compAffordable\)/, "asked up to twice while another comp is affordable");
    assert.match(agent, /still missing: \$\{missing\.join\(", "\)\}/);
    assert.match(agent, /ground: input\.colors\.ground\.toUpperCase\(\)/);
    const record = { chosen: { name: "A", headline: "B c d", device: "e", archetype: "f", ground: "g", action: "h", angle: "i", scores: { memorable: 4, specific: 4, action: 4, buildable: 4 } }, runnersUp: [], why: "why",
      comps: [{ section: "top", viewport: "desktop", asset: "00000000-0000-4000-8000-000000000001", ground: "#1D3FA8", reading: { section: "top", viewport: "desktop", headlineCapHeightPct: 9, imageAreaPct: 50, imageSide: "right", ground: "#1D3FA8" } }] };
    const back = compsFromSource(`${conceptComment(record)}
export default function App() {}`);
    assert.equal(back[0].reading.ground, "#1D3FA8"); assert.equal(back[0].ground, "#1D3FA8");
    const prompt = compPrompt(BIKES, CONCEPT, "2560x1440");
    assert.match(prompt, /Colours flat and at full strength exactly as given, like a printed poster/);
    assert.match(prompt, /The headline set at poster scale in the heaviest cut of its typeface/);
    const builder = fs.readFileSync(path.join(__dirname, "prompt.ts"), "utf8");
    assert.match(builder, /SIGNATURE COLOUR AND SCALE/); assert.match(builder, /never a wider, lighter or different family than the comp shows/);
  });

  await check("photographs wait for the comps on a first build, also while the concept is not recorded yet (live w05)", () => {
    const agent = fs.readFileSync(path.join(__dirname, "agent.ts"), "utf8");
    assert.ok(agent.includes("if (compsAvailable && compsStarted < MIN_COMPS && compsAsked < 2 && (compsAsked === 0 || compAffordable)) {"), "the comp gate does not wait for a recorded concept");
    assert.match(agent, /record the concept \(fix what its tool result asked for\), then the design comps/);
  });

  await check("comp canvas and quality: native sizes first once measured, else the measured canvas cut to the shape; never an unmeasured cell", async () => {
    assert.deepEqual(COMP_CANVASES.desktop, ["2560x1440", "1536x1024"]); assert.deepEqual(COMP_CANVASES.mobile, ["1152x2496", "1024x1536"]);
    for (const size of [...COMP_CANVASES.desktop, ...COMP_CANVASES.mobile]) assert.equal(sizeIssue(size), null, size);
    // Measured 26 Oct 2026 (scope quality-v14-20261026): desktop comps render natively at 2560x1440 high, the phone comp at 1152x2496 high.
    const desk = compCell("gpt-image-2.5-sunburst", "desktop");
    assert.deepEqual([desk.ok, desk.quality, desk.size, desk.native, desk.crop], [true, "high", "2560x1440", true, { left: 0, top: 0, width: 2560, height: 1440 }]);
    const phone = compCell("gpt-image-2.5-flare", "mobile");
    assert.deepEqual([phone.ok, phone.quality, phone.size], [true, "high", "1152x2496"]);
    assert.ok(Math.abs(phone.crop.width / phone.crop.height - 390 / 844) < 0.01);
    // A model with only the published sizes: high on the measured 3:2 / 2:3 canvases, cut to shape.
    const fallback = compCell("gpt-image-2", "desktop"), fallbackPhone = compCell("gpt-image-2", "mobile");
    assert.deepEqual([fallback.size, fallback.native, fallback.crop], ["1536x1024", false, { left: 0, top: 80, width: 1536, height: 864 }]);
    assert.deepEqual([fallbackPhone.quality, fallbackPhone.size, fallbackPhone.native], ["high", "1024x1536", false]);
    assert.equal(compCell("gpt-image-unknown", "desktop").ok, false, "a model without measurements has no comp canvas");
    assert.deepEqual(COMP_FRAME, COMP_SHAPE, "the finish gate measures comps in the comps' own frame");
  });

  await check("first phone screen: the h1 and the primary action inside 390 x 844 (W16); a hero that pushes them down is found", async () => {
    const { build } = require("esbuild"), { chromium } = require("playwright");
    const bundle = await build({ entryPoints: [path.join(__dirname, "layout-probe.ts")], bundle: true, write: false, format: "iife", globalName: "LP", platform: "browser" });
    const server = http.createServer((req, res) => { res.setHeader("Content-Type", req.url === "/lp.js" ? "text/javascript" : "text/html"); res.end(req.url === "/lp.js" ? bundle.outputFiles[0].contents : "<!doctype html><script src=\"/lp.js\"></script>"); });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      const probe = (html, width, height) => page.evaluate(async ({ html, width, height }) => new Promise(resolve => {
        const frame = document.createElement("iframe");
        frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;height:${height}px;border:0`;
        frame.addEventListener("load", () => { resolve(window.LP.firstScreenMiss(frame.contentDocument, frame.contentWindow, width, height)); frame.remove(); }, { once: true });
        frame.srcdoc = html; document.body.appendChild(frame);
      }), { html, width, height });
      const BASE = "<style>body{margin:0;font:18px/1.4 Arial,sans-serif;background:#1D3FA8;color:#fff}header{height:64px;display:flex;align-items:center;justify-content:space-between;padding:0 16px}h1{font-size:56px;line-height:1;margin:24px 16px 12px}p{margin:0 16px 16px}.pill{display:inline-block;margin:0 16px;padding:14px 22px;border-radius:999px;background:#C6F04A;color:#111;text-decoration:none}nav a{color:#fff}</style>";
      // The W16 regression: a tall hero photograph first, so the h1 and the pill fall below the phone screen.
      const pushed = `${BASE}<header><b>Spoke &amp; Chain</b><nav><a href="#r">Repairs</a></nav></header><main><img alt="" width="390" height="700" style="display:block;width:100%;height:700px;background:#555"><h1>Fixed by Friday.</h1><p>Repairs, servicing and second-hand bikes in Leipzig.</p><a class="pill" href="#book">Book a repair</a></main>`;
      const miss = await probe(pushed, 390, 844);
      assert.ok(miss && miss.missing.includes("h1") && miss.missing.includes("action"), JSON.stringify(miss));
      assert.equal(miss.action, "Book a repair");
      const problem = firstScreenProblem(miss);
      assert.match(problem, /^First screen: on a 390 × 844 phone screen the h1 \("Fixed by Friday\."\) ends at \d+ px and the primary action \("Book a repair"\) ends at \d+ px; both must be fully visible without scrolling\./);
      assert.doesNotMatch(problem, BLOCKING_PROBLEM, "it blocks a finish once, like the other quality findings (never strands the work)");
      // The comp's layout: a photograph band, then the headline and the pill, all inside the screen.
      const tight = `${BASE}<header><b>Spoke &amp; Chain</b><nav><a href="#r">Repairs</a></nav></header><main><img alt="" width="390" height="230" style="display:block;width:100%;height:230px;background:#555"><h1>Fixed by Friday.</h1><p>Repairs, servicing and second-hand bikes in Leipzig.</p><a class="pill" href="#book">Book a repair</a></main>`;
      assert.equal(await probe(tight, 390, 844), null);
      // A plain nav link is not the primary action: with the pill far below the first screen, the action is missing there;
      // a filled pill in the header is in it. A page with no prominent action anywhere is not asked for one by this check.
      const navOnly = `${BASE}<header><b>Spoke &amp; Chain</b><nav><a href="#r">Repairs</a></nav></header><main><h1>Fixed by Friday.</h1><p>Repairs in Leipzig.</p><div style="height:1200px"></div><a class="pill" href="#book">Book a repair</a></main>`;
      assert.deepEqual((await probe(navOnly, 390, 844))?.missing, ["action"]);
      const noAction = `${BASE}<header><b>Spoke &amp; Chain</b><nav><a href="#r">Repairs</a></nav></header><main><h1>Fixed by Friday.</h1><p>Repairs in Leipzig.</p></main>`;
      assert.equal(await probe(noAction, 390, 844), null);
      const headerPill = `${BASE}<header><b>Spoke &amp; Chain</b><nav><a class="pill" href="#book">Book a repair</a></nav></header><main><h1>Fixed by Friday.</h1></main>`;
      assert.equal(await probe(headerPill, 390, 844), null);
      // 360 x 780 is measured too.
      assert.ok(await probe(pushed, 360, 780));
    } finally { await browser.close(); server.close(); }
  });

  console.log(`\n${passed} comp prompt checks passed (no providers, no network beyond 127.0.0.1).`);
})().catch(error => { console.error(error); process.exit(1); });
