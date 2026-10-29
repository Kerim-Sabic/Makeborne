/* eslint-disable @typescript-eslint/no-require-imports -- Real deterministic review checks on fixture websites, PDFs and PPTX files built in this harness (offline Chromium, no network, no paid call). */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
// Stored project objects for the asset-serving check (server-key storage reads are faked; the RLS client is faked below).
const stored = new Map();
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  if (/(^|\/)billing\/database$/.test(name)) return { billingDatabase: () => ({ storage: { from: bucket => ({ download: async objectPath => bucket === "project-assets" && stored.has(objectPath)
    ? { data: new Blob([stored.get(objectPath)]), error: null } : { data: null, error: new Error("Object not found") } }) }, rpc: () => { throw Error("no RPC in the render harness"); } }) };
  if (name.startsWith("@/")) return load.call(this, path.join(__dirname, "../..", name.slice(2)), parent, main);
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const sharp = require("sharp"), JSZip = require("jszip");
const { chromium } = require("playwright");
const capture = require("./capture-server.ts"), deterministic = require("./deterministic.ts"), claims = require("./claims.ts"), assemble = require("./assemble.ts");
const contract = require("./contract.ts"), validate = require("./validate.ts"), loop = require("./loop.ts"), guard = require("./guard.ts");
const { inspectPdf } = require("./pdf-inspect.ts");
const { emptyDocument } = require("../documents/editor.ts");
const { documentPdf } = require("../documents/export-server.ts");
const { deckPptx } = require("../documents/pptx.ts");
const siteAssets = require("./website-assets.ts"), { resolveProjectImages } = require("../projects/source-assets.ts"), { RequestError } = require("../server/http.ts");
const { createHash } = require("node:crypto");

/** A minimal RLS-bound client: the rows this member can see (projects and registered assets). */
function rlsClient(tables) {
  return { from(table) {
    const filters = [], query = { select: () => query, eq: (column, value) => { filters.push(row => row[column] === value); return query; },
      in: (column, values) => { filters.push(row => values.includes(row[column])); return query; }, limit: () => query,
      maybeSingle: async () => ({ data: (tables[table] ?? []).filter(row => filters.every(test => test(row)))[0] ?? null, error: null }),
      then: (resolve, reject) => Promise.resolve({ data: (tables[table] ?? []).filter(row => filters.every(test => test(row))), error: null }).then(resolve, reject) };
    return query;
  } };
}

let passed = 0;
async function check(name, fn) { const started = Date.now(); await fn(); passed++; console.log(`PASS ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`); }
const facts = { snapshotId: "facts-7", facts: [{ id: "price-box", statement: "The weekly bread box costs €49 per month.", value: "€49" }] };
const brief = { id: "brief-1", version: 1, approved: true, summary: "One-page bakery site.", requirements: [{ id: "contact", text: "Visitors can send a message." }] };
const ARTIFACT = "6f1c2b8e-4a1d-4c3e-9d2a-7b5e8f0a1c2d";

// ---- Fixture website (generated here). Defects are seeded by name. ----
function site(defects = []) {
  const has = name => defects.includes(name);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Harbour Bakery</title>
<style>:root{--ink:#1d2433;--accent:${has("rebrand") ? "#1f7a3a" : "#b4441c"};--paper:#fbf7f0}*{box-sizing:border-box}body{margin:0;font-family:Georgia,serif;color:var(--ink);background:var(--paper)}
header{display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between;padding:16px 24px}header img{width:40px;height:20px;display:block}nav a{margin-right:12px;color:var(--ink)}
section{padding:40px 24px;max-width:1100px;margin:0 auto}h1{font-size:clamp(32px,6vw,64px);margin:0 0 16px}.hero img{max-width:100%;height:auto;display:block}.price{font-size:24px;color:var(--accent)}
form{display:grid;gap:12px;max-width:420px}label{display:grid;gap:4px}input,textarea{font:inherit;padding:8px;border:1px solid #999;width:100%}footer{padding:24px;text-align:center}</style></head><body>
<header><img src="/assets/logo.png" alt="Harbour Bakery logo" class="logo"><nav><a href="#menu">Menu</a><a href="#visit">Visit</a>${has("dead-link") ? '<a href="#team">Team</a>' : ""}</nav></header>
<main>
<section id="hero" class="hero"><h1>Bread baked at dawn</h1><p>Sourdough and pastries from the harbour.</p><img src="/assets/hero.png" alt="Loaves on a wooden shelf" width="800" height="400">${has("overflow") ? '<div class="strip" style="width:600px;height:12px;background:#ccc"></div>' : ""}</section>
<section id="menu"><h2>Menu</h2><p class="price">Weekly bread box: ${has("claim") ? "€59" : "€49"} per month</p>${has("broken") ? '<img src="/assets/missing.png" alt="The bread box">' : ""}${has("clipped") ? '<p class="badge" style="width:140px;overflow:hidden;white-space:nowrap;border:1px solid #999">Free delivery inside the old town walls every Saturday</p>' : ""}<p>Order by Thursday for Saturday pickup.</p></section>
<section id="visit"><h2>Visit</h2>${has("covered") ? '<div class="hours" style="position:relative"><p>Open daily from seven until two</p><div class="stamp" style="position:absolute;inset:0;background:#b4441c"></div></div>' : "<p>Open daily from seven until two</p>"}
<form><label>Name<input name="name" required></label>${has("unlabelled") ? '<input name="email" placeholder="Email">' : ""}<label>Message<textarea name="message"></textarea></label><button type="submit">Send</button></form></section>
</main>
<footer><p>${has("footer") ? "Harbour Bakery, now on Pier 9" : "Harbour Bakery, Pier 4"}</p></footer>
</body></html>`;
}
let browser;
// One shared offline Chromium for the website and slide captures (each capture closes its contexts; close() is a no-op here).
const launch = async () => ({ newContext: (...args) => browser.newContext(...args), close: async () => {} });
let assets;
async function captureSite(html, extra = {}) {
  return capture.captureWebsite({ routes: [{ path: "/", html }], assets: async pathname => assets[pathname] ?? null, launch, ...extra });
}
function review(capture, version, html, model = { ok: true, review: { findings: [], coverageNotes: [] } }) {
  const diagnostics = deterministic.websiteDiagnostics({ probes: capture.probes, runtimeErrors: [], facts, claims: claims.defaultClaimsCheck });
  const request = assemble.assembleRequest({ subject: { artifactId: ARTIFACT, version, contentSha: contract.contentSha({ html }) }, brief, facts, evidence: capture.evidence, diagnostics, coverage: capture.coverage });
  return { request, diagnostics, result: validate.buildResult({ request, deterministic: deterministic.deterministicFindings(diagnostics), model, claims: claims.defaultClaimsCheck }) };
}
const failed = (diagnostics, check) => diagnostics.filter(item => item.check === check && item.status === "failed");

(async () => {
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { console.log(`SKIP real-render review checks: Chromium is unavailable (${String(error.message).split("\n")[0]})`); return; }
  try {
    const png = (w, h, color) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
    assets = { "/assets/logo.png": { body: await png(40, 20, "#1d2433"), contentType: "image/png" }, "/assets/hero.png": { body: await png(800, 400, "#c9a46a"), contentType: "image/png" } };

    await check("website, acceptable fixture: real desktop and phone renders, no blocker/major, nothing to repair, explicit coverage limits", async () => {
      const html = site();
      const captured = await captureSite(html);
      const { request, diagnostics, result } = review(captured, 3, html);
      const bad = diagnostics.filter(item => item.status === "failed");
      assert.deepEqual(bad.map(item => `${item.id} ${item.measured}`), [], "no false positives on acceptable work");
      assert.equal(result.status, "acceptable");
      assert.deepEqual(request.evidence.routes[0].viewports.map(item => [item.viewport, item.width, item.images.length > 0]), [["desktop", 1440, true], ["phone", 390, true]]);
      assert.ok(request.evidence.images.every(image => image.mediaType === "image/jpeg" && image.width <= 1568));
      assert.ok(request.coverage.notInspected.some(item => /scripts, motion/.test(item.what)), "interactivity is listed as not inspected");
      assert.ok(request.coverage.notInspected.some(item => /site\.runtime-errors/.test(item.what)), "unrun checks are coverage limits");
      for (const check of ["site.render", "site.overflow", "site.covered-text", "site.clipped-text", "site.dead-link", "site.form-label", "site.claims", "site.broken-asset"])
        assert.ok(diagnostics.some(item => item.check === check && item.status === "passed"), `${check} ran`);
      let repairs = 0;
      const outcome = await loop.runReviewRepairLoop({ review: async () => result, repair: async () => { repairs++; return { ok: false, code: "unused" }; }, reverify: async () => [], guard: async () => ({ ok: true, changed: [] }), current: async () => result.subject }, { subject: result.subject });
      assert.deepEqual([outcome.outcome, repairs], ["complete", 0], "acceptable work is not redesigned");
    });

    await check("website, seeded defects: broken asset, clipped and covered text, unsupported price, dead link, unlabelled field, phone overflow", async () => {
      const captured = await captureSite(site(["broken", "clipped", "covered", "claim", "dead-link", "unlabelled", "overflow"]));
      const { diagnostics, result } = review(captured, 3, "defects");
      const broken = failed(diagnostics, "site.broken-asset");
      assert.ok(broken.length >= 1 && broken.every(item => /missing\.png/.test(item.measured)), "broken asset found; the logo and hero are not");
      assert.ok(failed(diagnostics, "site.clipped-text").some(item => /Free delivery/.test(item.measured) && item.location.selector === "p.badge"));
      assert.ok(failed(diagnostics, "site.covered-text").some(item => /Open daily/.test(item.measured) && /div\.stamp/.test(item.measured)));
      assert.deepEqual(failed(diagnostics, "site.claims").map(item => item.measured), ["\"€59\" (price) is not in the approved facts"]);
      assert.match(failed(diagnostics, "site.dead-link")[0].measured, /Team.*no element with id "team"/);
      assert.match(failed(diagnostics, "site.form-label")[0].measured, /"email" has no label/);
      const overflow = failed(diagnostics, "site.overflow");
      assert.deepEqual(overflow.map(item => item.location.viewport), ["phone"], "overflow only at phone width");
      assert.match(overflow[0].measured, /div\.strip/);
      assert.equal(result.status, "changes_needed");
      assert.ok(result.findings.every(item => item.source === "deterministic" && item.grounding === "measured" && item.verificationMethod.type === "deterministic"));
    });

    await check("website repair loop: the fix touches only the finding's section, keeps the brand, and re-verification proves it; an unfixed or rebranding repair is incomplete", async () => {
      const versions = [site(["broken"])];
      const subjectOf = index => ({ artifactId: ARTIFACT, version: 3 + index, contentSha: contract.contentSha({ html: versions[index] }) });
      const probeFor = async (html, targets) => (await captureSite(html, { targets, screenshots: false })).probes.find(item => item.viewport === "desktop").report;
      const ports = repair => ({
        review: async at => { const index = at.version - 3; return review(await captureSite(versions[index]), at.version, versions[index]).result; },
        repair: async ({ findings }) => { versions.push(repair(versions.at(-1), findings)); return { ok: true, subject: subjectOf(versions.length - 1) }; },
        guard: async ({ before, after, findings }) => {
          const targets = findings.flatMap(item => item.location.kind === "route" && item.location.selector ? [item.location.selector] : []);
          return guard.websiteGuard(await probeFor(versions[before.version - 3], targets), await probeFor(versions[after.version - 3], targets), findings);
        },
        reverify: async ({ subject, findings }) => {
          const html = versions[subject.version - 3];
          const { diagnostics } = review(await captureSite(html, { screenshots: false }), subject.version, html);
          return assemble.reverifyFindings(findings, diagnostics, null);
        },
        current: async () => subjectOf(versions.length - 1),
      });
      const good = await loop.runReviewRepairLoop(ports(html => html.replace("/assets/missing.png", "/assets/hero.png")), { subject: subjectOf(0) });
      assert.deepEqual([good.outcome, good.stoppedBy], ["complete", "verified"]);
      assert.deepEqual(good.rounds[0].guard, { ok: true, changed: ["#menu"] }, "only the menu section changed");
      assert.equal(good.rounds[0].verification[0].status, "resolved");
      versions.splice(1);
      const useless = await loop.runReviewRepairLoop(ports(html => html.replace('alt="The bread box"', 'alt="Our bread box"')), { subject: subjectOf(0) });
      assert.deepEqual([useless.outcome, useless.stoppedBy, useless.unresolved[0].verificationMethod.checkId], ["incomplete", "max_rounds", "site.broken-asset"], "a repair that does not fix the defect is not complete");
      versions.splice(1);
      const rebrand = await loop.runReviewRepairLoop(ports(html => html.replace("/assets/missing.png", "/assets/hero.png").replace("--accent:#b4441c", "--accent:#1f7a3a").replace("Pier 4", "Pier 9")), { subject: subjectOf(0) });
      assert.deepEqual([rebrand.outcome, rebrand.stoppedBy], ["incomplete", "guard"]);
      assert.match(rebrand.rounds[0].guard.violations.join(" | "), /brand identity changed \(CSS design tokens/);
      assert.match(rebrand.rounds[0].guard.violations.join(" | "), /footer.*changed but no finding named it/);
    });

    await check("book: the actual exported PDF — page count, 432×648 pt pages, chapter coverage from the outline, page balance; acceptable has no blocker/major", async () => {
      const book = emptyDocument("book", "Harbour Notes");
      book.chapters = [
        { id: "dawn", title: "Dawn bakes", text: Array.from({ length: 70 }, (_, i) => `Paragraph ${i + 1}: the ovens are lit before the boats leave, and the first loaves cool on the racks by the window while the harbour wakes.`).join("\n\n") },
        { id: "box", title: "The bread box", text: "The weekly bread box costs €49 per month and is collected on Saturdays." },
      ];
      const bytes = await documentPdf(book, {});
      const pdf = inspectPdf(bytes);
      assert.ok(pdf && pdf.pageCount >= 5, "pages read from the exported file");
      assert.ok(pdf.pages.every(page => page.width === 432 && page.height === 648));
      const captured = await capture.captureBook(book, {}, {}, { launch, pdf: async () => bytes });
      const diagnostics = deterministic.bookDiagnostics({ pdf: captured.pdf, exportError: captured.exportError, chapters: captured.evidence.chapters, facts, claims: claims.defaultClaimsCheck });
      assert.deepEqual(diagnostics.filter(item => item.status === "failed").map(item => item.measured), []);
      assert.deepEqual(diagnostics.filter(item => item.check === "book.coverage").map(item => item.status), ["passed", "passed"]);
      assert.ok(captured.evidence.images.length >= 1 && captured.coverage.notInspected.some(item => /rasters of the exported PDF/.test(item.what)), "page rasters are an explicit limitation");
      const request = assemble.assembleRequest({ subject: { artifactId: ARTIFACT, version: 2, contentSha: contract.contentSha(book) }, brief, facts, evidence: captured.evidence, diagnostics, coverage: captured.coverage });
      assert.equal(request.evidence.pdf.pageCount, pdf.pageCount);

      // Seeded: a chapter missing from the export, one page at the wrong size, an unsupported price.
      const missing = inspectPdf(await documentPdf({ ...book, chapters: [book.chapters[0]] }, {}));
      const resized = Buffer.from(bytes.toString("latin1").replace("/MediaBox [0 0 432 648]", "/MediaBox [0 0 612 792]"), "latin1");
      const claimed = { ...book, chapters: [book.chapters[0], { ...book.chapters[1], text: "The weekly bread box costs €59 per month." }] };
      const coverage = deterministic.bookDiagnostics({ pdf: missing, exportError: null, chapters: claimed.chapters, facts, claims: claims.defaultClaimsCheck });
      assert.deepEqual(failed(coverage, "book.coverage").map(item => item.measured), ["chapter \"The bread box\" is missing from the exported PDF"]);
      assert.equal(deterministic.CHECKS["book.coverage"].severity, "blocker");
      assert.match(failed(coverage, "book.claims")[0].measured, /€59/);
      const size = deterministic.bookDiagnostics({ pdf: inspectPdf(resized), exportError: null, chapters: book.chapters, facts, claims: claims.defaultClaimsCheck });
      assert.deepEqual(failed(size, "book.page-size").map(item => item.location), [{ kind: "page", page: 1, chapterId: null }]);
      // Page balance on the measured page ink: an empty page inside a chapter and a last page of a few stray glyphs.
      const unbalanced = { ...pdf, pages: pdf.pages.map(page => ({ ...page })) };
      const dawn = pdf.outline.find(entry => entry.title === "Dawn bakes").page, boxStart = pdf.outline.find(entry => entry.title === "The bread box").page;
      assert.ok(boxStart - dawn >= 5, "the long chapter spans several pages");
      unbalanced.pages[dawn].glyphs = 0; unbalanced.pages[dawn].images = 0; unbalanced.pages[boxStart - 2].glyphs = 12;
      const balance = deterministic.bookDiagnostics({ pdf: unbalanced, exportError: null, chapters: book.chapters, facts, claims: claims.defaultClaimsCheck });
      assert.deepEqual(failed(balance, "book.blank-page").map(item => item.location), [{ kind: "page", page: dawn + 1, chapterId: "dawn" }]);
      assert.deepEqual(failed(balance, "book.page-balance").map(item => item.location.page), [boxStart - 1]);
      assert.match(diagnostics.find(item => item.check === "book.page-balance").measured, /glyphs per page/);
      const broken = deterministic.bookDiagnostics({ pdf: null, exportError: "The export could not finish.", chapters: book.chapters, facts, claims: claims.defaultClaimsCheck });
      assert.deepEqual(broken.map(item => [item.check, item.status]), [["book.export", "failed"]]);
    });

    await check("book page images keep the PDF's page box: text pages show the real top and side margins and no line is cut between pages (2026-10-24 regression)", async () => {
      const { BOOK_TRIM } = require("../documents/render-book.ts");
      const book = emptyDocument("book", "Harbour Notes");
      book.chapters = [{ id: "dawn", title: "Dawn bakes", text: Array.from({ length: 26 }, (_, i) => `The ovens are lit long before the shop opens, and batch ${i + 1} of loaves cools by the window while the harbour wakes and the first customers wait outside.`).join("\n\n") },
        { id: "box", title: "The bread box", text: "The weekly bread box costs €49 per month and is collected on Saturdays." }];
      const captured = await capture.captureBook(book, {}, {}, { launch, pdf: async () => documentPdf(book, {}) });
      const text = captured.evidence.images.filter(image => /text page/.test(image.label));
      assert.ok(text.length >= 2, `text pages are rendered as pages (${captured.evidence.images.map(image => image.label).join(" | ")})`);
      const px = inches => Math.floor(inches * 96);
      for (const image of text) {
        assert.deepEqual([image.width, image.height], [576, 864], "the 6 × 9 in page box");
        const bytes = Buffer.from(image.data, "base64");
        const band = async region => Math.max(...(await sharp(await sharp(bytes).extract(region).png().toBuffer()).stats()).channels.slice(0, 3).map(channel => channel.stdev));
        assert.ok(await band({ left: 0, top: 0, width: 576, height: px(BOOK_TRIM.top) - 8 }) < 4, `${image.id}: the top margin is empty`);
        assert.ok(await band({ left: 0, top: 0, width: px(BOOK_TRIM.inside) - 8, height: 864 }) < 4, `${image.id}: the inside margin is empty`);
        assert.ok(await band({ left: 576 - px(BOOK_TRIM.outside) + 8, top: 0, width: px(BOOK_TRIM.outside) - 8, height: 864 }) < 4, `${image.id}: the outside margin is empty`);
        assert.ok(await band({ left: 0, top: 864 - px(BOOK_TRIM.bottom) + 8, width: 576, height: px(BOOK_TRIM.bottom) - 8 }) < 4, `${image.id}: the bottom margin is empty`);
      }
    });

    await check("deck: rendered slides plus the actual PPTX — native editable charts and speaker notes; seeded export defects are found", async () => {
      const deck = emptyDocument("deck", "Harbour Bakery");
      deck.slides = [
        { id: "intro", layout: "statement", tone: "light", title: "Bread baked at dawn", notes: "Open with the morning routine." },
        { id: "growth", layout: "chart", tone: "light", title: "Boxes sold per month", notes: "Explain the growth.", chart: { type: "column", categories: ["Jan", "Feb", "Mar"], series: [{ name: "Boxes", values: [120, 160, 210] }], source: "Shop records" } },
        { id: "offer", layout: "points", tone: "light", title: "The weekly box", notes: "Price and pickup.", points: [{ text: "€49 per month" }, { text: "Pickup on Saturdays" }] },
      ];
      const bytes = await deckPptx(deck, {});
      const captured = await capture.captureDeck(deck, {}, {}, { launch, pptx: async () => bytes });
      const slides = deck.slides.map(slide => ({ id: slide.id, title: slide.title, notes: slide.notes, hasChart: slide.layout === "chart" }));
      const diagnostics = deterministic.deckDiagnostics({ pptx: captured.pptx, exportError: null, slides, probes: captured.probes, facts, claims: claims.defaultClaimsCheck });
      assert.deepEqual(diagnostics.filter(item => item.status === "failed").map(item => `${item.id} ${item.measured}`), [], "acceptable deck: no false positives");
      assert.match(diagnostics.find(item => item.check === "deck.chart-editable").measured, /native barChart with embedded data/);
      assert.equal(captured.evidence.slides.filter(slide => slide.notes).length, 3);
      assert.equal(captured.evidence.images.length, 3, "each slide rendered for the reviewer");
      const request = assemble.assembleRequest({ subject: { artifactId: ARTIFACT, version: 4, contentSha: contract.contentSha(deck) }, brief, facts, evidence: captured.evidence, diagnostics, coverage: captured.coverage });
      assert.equal(request.evidence.slides[1].charts[0].native, true);

      // Seeded: the chart exported as a picture-less frame without its part, notes stripped from slide 3, and a long title overflowing its frame.
      const zip = await JSZip.loadAsync(bytes);
      const rels = Object.keys(zip.files).filter(name => /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(name));
      for (const name of rels) {
        let xml = await zip.file(name).async("string");
        if (name.includes("slide2.")) xml = xml.replace(/<Relationship [^>]*\/chart"[^>]*\/>/, "");
        if (name.includes("slide3.")) xml = xml.replace(/<Relationship [^>]*\/notesSlide"[^>]*\/>/, "");
        zip.file(name, xml);
      }
      const damaged = await capture.captureDeck(deck, {}, {}, { launch, screenshots: false, pptx: async () => zip.generateAsync({ type: "nodebuffer" }) });
      const seeded = deterministic.deckDiagnostics({ pptx: damaged.pptx, exportError: null, slides, probes: damaged.probes, facts, claims: claims.defaultClaimsCheck });
      assert.deepEqual(failed(seeded, "deck.chart-editable").map(item => item.location.slideId), ["growth"]);
      assert.deepEqual(failed(seeded, "deck.notes").map(item => item.location.slideId), ["offer"]);
      // The deck renderer fits text to its frames, so clipping is seeded on a hand-built slide with the same structure (section.slide > .p.t).
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await page.setContent(`<style>.slide{position:relative;width:1280px;height:720px;overflow:hidden}.p{position:absolute}.t{display:flex;flex-direction:column;white-space:pre-wrap}</style>
        <section class="slide"><div class="p t" style="left:80px;top:80px;width:260px;height:60px;font:48px/1.1 Georgia">Bread baked at dawn by hand every single morning</div></section>
        <section class="slide"><div class="p t" style="left:80px;top:80px;width:600px;height:80px;font:40px/1.1 Georgia">Fits well</div></section>`);
      const probes = await page.evaluate(require("./probe.ts").probeSlides);
      await page.close();
      const clipped = deterministic.deckDiagnostics({ pptx: captured.pptx, exportError: null, slides, probes, facts, claims: claims.defaultClaimsCheck });
      assert.deepEqual(failed(clipped, "deck.text-clipped").map(item => item.location.slide), [1], "text overflowing its frame is measured; fitting text is not");
    });

    await check("deck claim review ignores server counters but retains factual numbers, prices, dates and notes", async () => {
      const deck = emptyDocument("deck", "Studio plan");
      deck.slides = [
        { id: "steps", layout: "points", tone: "light", title: "Our process", notes: "Discuss the process.", points: [{ text: "Listen carefully" }, { text: "Build thoughtfully" }] },
        { id: "facts", layout: "stats", tone: "light", title: "Business figures", notes: "Target 25% growth.", stats: [{ value: "1", label: "studio" }, { value: "2027", label: "opening" }, { value: "6 weeks", label: "duration" }, { value: "€99", label: "fee" }] },
      ];
      const captured = await capture.captureDeck(deck, {}, {}, { launch, screenshots: false });
      const probes = captured.probes;
      assert.ok(/\b0?1\b/.test(probes[0].text), "visible counter retained for render evidence");
      assert.doesNotMatch(probes[0].claimText, /\d/, "only generated counters excluded from factual copy");
      for (const value of ["1", "2027", "6 weeks", "€99"]) assert.ok(probes[1].claimText.includes(value), value);
      const emptyFacts = { snapshotId: "empty", facts: [] };
      const checker = require("./knowledge.ts").knowledgeClaimsCheck({ facts: emptyFacts, claimFacts: [], contextSha256: null }, { ...brief, summary: "Studio process", requirements: [] });
      const diagnostics = deterministic.deckDiagnostics({ pptx: captured.pptx, exportError: null, slides: deck.slides.map(slide => ({ ...slide, hasChart: false })), probes, facts: emptyFacts, claims: checker });
      const claimFailures = failed(diagnostics, "deck.claims");
      assert.ok(!claimFailures.some(item => item.location.slideId === "steps"), JSON.stringify(claimFailures));
      assert.ok(claimFailures.some(item => item.location.slideId === "facts"));
      assert.ok(checker("1", emptyFacts).some(item => !item.supported), "a bare user-authored one is still checked");
      assert.ok(claimFailures.some(item => /25/.test(item.measured)), "speaker-note claims stay checked");
    });

    await check("website: the project's own images are served to the capture from verified storage; missing or changed bytes are broken, unconfirmed ones not checked", async () => {
      const W = "6f1c2b8e-4a1d-4c3e-9d2a-7b5e8f0a1c20", P = "6f1c2b8e-4a1d-4c3e-9d2a-7b5e8f0a1c21";
      const ids = ["6f0d0b8e-3f43-4c1f-9d55-0c5f8b6a1f10", "6f0d0b8e-3f43-4c1f-9d55-0c5f8b6a1f11", "6f0d0b8e-3f43-4c1f-9d55-0c5f8b6a1f12", "6f0d0b8e-3f43-4c1f-9d55-0c5f8b6a1f13"];
      const hero = await png(800, 400, "#c9a46a"), oven = await png(400, 300, "#6a4a2a"), tampered = await png(400, 300, "#ff00ff"), later = await png(200, 200, "#3a6a8a");
      const sha = bytes => createHash("sha256").update(bytes).digest("hex");
      const asset = (id, name, bytes) => ({ id, path: `public/images/${name}.png`, sha256: sha(bytes), bytes: bytes.length, mediaType: "image/png" });
      const assets = [asset(ids[0], "hero", hero), asset(ids[1], "oven", oven), asset(ids[2], "gone", oven), asset(ids[3], "later", later)];
      const objectPath = item => `${W}/${P}/artwork/${item.id}.png`;
      stored.clear();
      stored.set(objectPath(assets[0]), hero);
      stored.set(objectPath(assets[1]), tampered); // changed after registration: the sha256 no longer matches
      stored.set(objectPath(assets[3]), later);    // its read fails transiently below
      const client = rlsClient({ projects: [{ id: P, workspace_id: W }],
        assets: assets.filter(item => item.id !== ids[2]).map(item => ({ id: item.id, workspace_id: W, project_id: P, object_path: objectPath(item), content_type: item.mediaType, sha256: item.sha256 })) });
      const content = { schemaVersion: 1, kind: "website", title: "Harbour Bakery", sections: [], websiteSource: {
        schemaVersion: 1, toolchainId: "react-vite-v1", entrypoint: "src/main.tsx", assets, routes: [{ path: "/", title: "Home" }],
        files: [{ path: "index.html", content: "<!doctype html><html><head></head><body><div id=\"root\"></div></body></html>" }, { path: "package-lock.json", content: "{}" },
          { path: "package.json", content: "{\"name\":\"bakery\"}" }, { path: "src/main.tsx", content: "export {};\n" }] } };
      const snapshot = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Harbour Bakery</title><style>img{display:block;width:200px;height:100px}</style></head><body><div id="root"><main>
        <h1>Bread baked at dawn</h1><img src="/images/hero.png" alt="Loaves on a shelf"><img src="/images/oven.png" alt="The oven"><img src="/images/gone.png" alt="The shop">
        <img src="/images/later.png" alt="The harbour"><img src="https://cdn.example.com/x.png" alt="Remote"><p>Weekly bread box: €49 per month</p></main></div></body></html>`;
      const built = siteAssets.reviewWebsiteHtmlWithAssets(content, snapshot, "http://127.0.0.1:3000");
      assert.ok(built, "React sites get the asset-keeping review copy");
      assert.deepEqual([...built.assets.keys()].sort(), ["/images/gone.png", "/images/hero.png", "/images/later.png", "/images/oven.png"]);
      assert.ok(!built.html.includes("cdn.example.com"), "remote images are still dropped by the sanitiser");
      assert.match(built.html, /img-src data: 'self'/);
      let transient = true;
      const images = siteAssets.projectImageResolver(built.assets, async item => {
        if (item.id === ids[3] && transient) throw new RequestError("SOURCE_ASSET_UNCONFIRMED", "Project artwork could not be verified.", 503);
        try { return (await resolveProjectImages(client, { workspaceId: W, projectId: P }, [{ id: item.id, path: item.path, sha256: item.sha256, mediaType: item.mediaType, bytes: item.bytes }]))[0].bytes; }
        catch (error) { throw error instanceof RequestError && error.code === "SOURCE_ASSET_UNAVAILABLE" ? new siteAssets.ReviewAssetMissing(item.path) : error; }
      });
      const captured = await capture.captureWebsite({ routes: [{ path: "/", html: built.html }], assets: images.resolve, launch, absentSrcUnknown: true, screenshots: false });
      const report = images.report();
      assert.deepEqual([report.served, report.broken.sort(), report.unavailable], [["/images/hero.png"], ["/images/gone.png", "/images/oven.png"], ["/images/later.png"]]);
      const diagnostics = deterministic.websiteDiagnostics({ probes: captured.probes, runtimeErrors: [], facts, claims: claims.defaultClaimsCheck });
      const broken = failed(diagnostics, "site.broken-asset").map(item => item.measured).join(" | ");
      assert.match(broken, /gone\.png/); assert.match(broken, /oven\.png/, "a changed object fails its sha256 check and is reported broken");
      assert.ok(!/hero\.png|later\.png/.test(broken), "verified images load; unconfirmed ones are not called broken");
      assert.ok(captured.coverage.notInspected.some(item => /image/.test(item.what)), "the unconfirmed image is listed as not inspected");
      const desktop = captured.probes.find(probe => probe.viewport === "desktop");
      assert.ok(desktop.report.failedImages.every(item => !/hero\.png/.test(item.src)));
      // Before: every project image was "unavailable" (not checked). Now the same snapshot checks them.
      const before = await capture.captureWebsite({ routes: [{ path: "/", html: built.html }], assets: async () => "unavailable", launch, absentSrcUnknown: true, screenshots: false });
      assert.equal(failed(deterministic.websiteDiagnostics({ probes: before.probes, runtimeErrors: [], facts, claims: claims.defaultClaimsCheck }), "site.broken-asset").length, 0, "without the resolver nothing is checked");
      transient = false;
    });
  } finally { await browser.close(); }
  console.log(`\n${passed} real-render review checks passed.`);
})().catch(error => { console.error(error); process.exit(1); });
