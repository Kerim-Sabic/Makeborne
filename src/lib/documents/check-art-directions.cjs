/* eslint-disable @typescript-eslint/no-require-imports -- Offline art-direction checks: every direction × composition fits in the
   scene model, in Chromium with the embedded faces and in PPTX with the Office faces; renders are deterministic; legacy decks
   still validate and render; planned decks vary their compositions. No network, no providers, no paid calls. */
const fs = require("node:fs"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
global.fetch = () => { throw Error("External requests are forbidden in this check"); };
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const path = require("node:path"), JSZip = require("jszip"), sharp = require("sharp");
const { chromium } = require("playwright");
const { DocumentSourceSchema, MOTIFS } = require("./schema.ts");
const { DIRECTIONS, DIRECTION_SPECS, legacyDirection, directionOf } = require("./directions.ts");
const { COMPOSITIONS, ALL_COMPOSITIONS } = require("./composition-catalog.ts");
const { composeSlide, planDeck, compositionKind, candidates, W, H } = require("./slide-scene.ts");
const { deckHtml, deckFaces } = require("./render-deck.ts"), { deckPptx, PPTX_MONO } = require("./pptx.ts");
const { FONTS } = require("./theme.ts");
const { embeddedFontSources } = require("./fonts-server.ts");
const { DocumentEditor, emptyDocument, deckRhythmIssues } = require("./editor.ts");
const { DECK_SYSTEM } = require("../builder/docs-prompt.ts");
const fixtures = require("./fixtures/art-directions.cjs");

const modulesRoot = path.dirname(path.dirname(path.dirname(require.resolve("playwright/package.json"))));
const parse = doc => DocumentSourceSchema.parse(doc);
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
/** Pairings exercised per direction: its first recommendation plus faces with very different metrics. */
const PAIRINGS = ["geist", "fraunces", "instrument", "archivo", "sora", "newsreader", "editorial", "humanist"];

/** Every fixture slide pinned to every composition that accepts it, chunked into valid decks (≤ 40 slides). */
function pinnedDecks(direction, fonts, fitting = true) {
  const base = parse(fixtures.deck(fonts, direction)), pinned = [];
  base.slides.forEach((slide, i) => {
    for (const id of COMPOSITIONS[slide.layout]) {
      if (id === "cover-image") continue;
      const copy = { ...base, slides: base.slides.map((s, j) => j === i ? { ...slide, variant: id } : s) };
      const scene = composeSlide(copy, copy.slides[i], i, copy.slides.length);
      // Measurement covers what renders; a composition that reports a fit issue is never accepted silently.
      if (scene.composition === id && (!fitting || !scene.issues.length)) pinned.push({ ...slide, id: `${slide.id}-${id}`.slice(0, 48), variant: id });
    }
  });
  const decks = [];
  for (let at = 0; at < pinned.length; at += 40) decks.push(parse({ ...base, slides: pinned.slice(at, at + 40) }));
  return decks;
}
const textShapes = xml => [...xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)].map(([, body]) => body).filter(body => /<a:t>/.test(body)).map(body => {
  const off = /<a:off x="(-?\d+)" y="(-?\d+)"\/>/.exec(body), ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(body);
  const text = [...body.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")).join(" ");
  return { x: +off[1] / 9525, y: +off[2] / 9525, w: +ext[1] / 9525, h: +ext[2] / 9525, text, face: /<a:latin typeface="([^"]+)"/.exec(body)?.[1], size: Number(/ sz="(\d+)"/.exec(body)?.[1]) / 100, pitch: Number(/<a:spcPts val="(\d+)"/.exec(body)?.[1]) / 100, bold: / b="1"/.test(body), italic: / i="1"/.test(body), spc: Number(/ spc="(-?\d+)"/.exec(body)?.[1] ?? 0) / 100 };
});
const slideXmls = async bytes => { const zip = await JSZip.loadAsync(bytes); return Promise.all(Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)[1]) - Number(/(\d+)\.xml$/.exec(b)[1])).map(n => zip.file(n).async("string"))); };

(async () => {
  const art = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: "#5B7F7A" } }).jpeg().toBuffer();

  await check("schema: direction and variant are optional, validated and kept by set_theme; canvas blocks are validated", () => {
    const doc = parse(fixtures.deck("geist"));
    assert.equal(doc.theme.direction, undefined, "no stored default is added");
    for (const direction of DIRECTIONS) assert.equal(parse(fixtures.deck("geist", direction)).theme.direction, direction);
    assert.equal(DocumentSourceSchema.safeParse(fixtures.deck("geist", "vaporwave")).success, false);
    const withVariant = (layout, variant) => DocumentSourceSchema.safeParse({ ...doc, slides: [{ ...doc.slides.find(s => s.layout === layout), variant }] });
    assert.ok(withVariant("stats", "stats-ledger").success);
    assert.match(JSON.stringify(withVariant("stats", "points-grid").error.issues), /not a stats composition/);
    const canvas = doc.slides.find(s => s.layout === "canvas");
    const blocks = canvas.blocks.map(b => b.type === "text" && b.style === "body" ? { ...b, col: 1, row: 2 } : b);
    assert.match(JSON.stringify(DocumentSourceSchema.safeParse({ ...doc, slides: [{ ...canvas, blocks }] }).error.issues), /overlaps text block/);
    assert.match(JSON.stringify(DocumentSourceSchema.safeParse({ ...doc, slides: [{ ...canvas, blocks: canvas.blocks.filter(b => b.style !== "display") }] }).error.issues), /display or headline/);
    assert.match(JSON.stringify(DocumentSourceSchema.safeParse({ ...doc, slides: [{ ...canvas, blocks: [{ ...canvas.blocks[3], col: 10, span: 6 }] }] }).error.issues), /12 columns/);
    const editor = new DocumentEditor(emptyDocument("deck", "Deck"));
    assert.match(editor.apply("set_theme", { palette: fixtures.palette, fonts: "geist", direction: "swiss" }), /swiss direction/);
    editor.apply("set_theme", { palette: fixtures.palette, fonts: "fraunces" });
    assert.equal(editor.doc.theme.direction, "swiss", "omitting direction keeps it");
    const book = new DocumentEditor(emptyDocument("book", "Book"));
    book.apply("set_theme", { palette: fixtures.palette, fonts: "garamond", direction: "poster" });
    assert.equal(book.doc.theme.direction, undefined, "books keep motif covers");
    assert.match(editor.apply("write_slide", { slide: doc.slides[0] }), /\(cover as cover-/, "write_slide reports the composition it chose");
  });

  await check("legacy decks (no direction) still validate, map to a direction and render in HTML, PDF markup and PPTX", async () => {
    for (const motif of [undefined, ...MOTIFS]) for (const fonts of ["geist", "editorial", "fraunces", "modern"]) {
      const doc = parse({ ...fixtures.legacy(motif), theme: { ...fixtures.legacy(motif).theme, fonts } });
      assert.equal(doc.theme.direction, undefined);
      assert.equal(directionOf(doc.theme).id, legacyDirection(doc.theme));
      doc.slides.forEach((slide, i) => assert.deepEqual(composeSlide(doc, slide, i, doc.slides.length).issues, [], `${motif}/${fonts}/${slide.id}`));
      const html = deckHtml(doc, {}, "print");
      assert.equal((html.match(/<section class="slide"/g) ?? []).length, doc.slides.length);
      assert.equal((await slideXmls(await deckPptx(doc, {}))).length, doc.slides.length);
    }
    assert.equal(legacyDirection({ fonts: "geist", motif: "grid" }), "swiss");
    assert.equal(legacyDirection({ fonts: "fraunces", motif: "band" }), "organic");
    assert.equal(legacyDirection({ fonts: "editorial" }), "editorial");
    assert.equal(legacyDirection({ fonts: "playfair", motif: "frame" }), "luxury");
  });

  let pinnedTotal = 0;
  const pinnedTight = [];
  await check("every direction × composition × pairing composes inside the canvas with no fit issues and readable type", () => {
    for (const direction of DIRECTIONS) for (const fonts of [DIRECTION_SPECS[direction].pairings[0], ...PAIRINGS]) for (const doc of pinnedDecks(direction, fonts, false)) {
      doc.slides.forEach((slide, index) => {
        const scene = composeSlide(doc, slide, index, doc.slides.length);
        assert.equal(scene.composition, slide.variant);
        if (scene.issues.length) {
          // A pinned composition may be too tight for this copy: the issue is reported to the agent, and the
          // unpinned planner must still find a composition in this direction that fits.
          const free = { ...doc, slides: doc.slides.map((entry, j) => j === index ? { ...entry, variant: undefined } : entry) };
          assert.deepEqual(composeSlide(free, free.slides[index], index, free.slides.length).issues, [], `${direction}/${fonts}/${slide.id}: ${scene.issues.join("; ")}`);
          pinnedTight.push(`${direction}/${fonts}/${slide.variant}`);
          return;
        }
        assert.equal(scene.prims.filter(p => p.k === "text" && p.role === "title").length >= 1, true, `${direction}/${slide.id}: the headline is marked`);
        for (const prim of scene.prims) {
          if (prim.k === "line") assert.ok(Math.min(prim.x1, prim.x2) >= -0.5 && Math.max(prim.x1, prim.x2) <= W + 0.5 && Math.min(prim.y1, prim.y2) >= -0.5 && Math.max(prim.y1, prim.y2) <= H + 0.5, `${direction}/${slide.id} line outside canvas`);
          else if (prim.k !== "ellipse") assert.ok(prim.x >= -0.5 && prim.y >= -0.5 && prim.x + prim.w <= W + 0.5 && prim.y + prim.h <= H + 0.5, `${direction}/${slide.id} ${prim.k} outside canvas`);
          if (prim.k === "text") {
            assert.ok(prim.size >= 11, `${direction}/${slide.id}: "${prim.text}" at ${prim.size}px`);
            if (prim.text.length >= 50 && !prim.upper) assert.ok(prim.size >= 15, `${direction}/${slide.id}: running copy "${prim.text.slice(0, 30)}" at ${prim.size}px`);
          }
        }
        pinnedTotal++;
      });
    }
    assert.ok(pinnedTotal > 5000, `${pinnedTotal} pinned slides`);
    assert.ok(pinnedTight.length <= pinnedTotal * 0.002, `too many pinned compositions are tight: ${pinnedTight.join(", ")}`);
    console.log(`  ${pinnedTotal} pinned slides across ${DIRECTIONS.length} directions and ${ALL_COMPOSITIONS.length} compositions; ${pinnedTight.length} pinned-only fits reported to the agent (${pinnedTight.join(", ") || "none"})`);
  });

  await check("measured in Chromium with embedded faces: no composition spills text in any direction", async () => {
    const browser = await chromium.launch({ headless: true });
    let slides = 0;
    try {
      const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block", viewport: { width: W, height: H } });
      await context.route("**/*", route => route.abort());
      // Each direction's own pairing plus the riskiest wide face for it (capitals → the condensed poster face; otherwise the scaled display serif).
      for (const direction of DIRECTIONS) for (const fonts of [DIRECTION_SPECS[direction].pairings[0], DIRECTION_SPECS[direction].display.upper ? "archivo" : "instrument"]) for (const doc of pinnedDecks(direction, fonts)) {
        const page = await context.newPage();
        await page.setContent(deckHtml(doc, { art: `data:image/jpeg;base64,${art.toString("base64")}` }, "print", await embeddedFontSources(deckFaces(doc), modulesRoot)), { waitUntil: "load" });
        await page.emulateMedia({ media: "print" });
        await page.evaluate(() => document.fonts.ready);
        const overflow = await page.evaluate(() => [...document.querySelectorAll(".slide")].flatMap((slide, index) => [...slide.querySelectorAll(".t")].flatMap(element => {
          const box = element.getBoundingClientRect(), height = element.style.height;
          element.style.height = "auto"; const natural = element.getBoundingClientRect().height; element.style.height = height;
          const wide = element.scrollWidth - element.clientWidth;
          return natural > box.height + 2 || wide > 1 ? [{ slide: index + 1, text: element.textContent.slice(0, 40), natural: Math.round(natural), box: Math.round(box.height), wide }] : [];
        })));
        assert.deepEqual(overflow, [], `${direction}/${fonts}: ${JSON.stringify(overflow.slice(0, 3).map(o => ({ ...o, id: doc.slides[o.slide - 1].id })))}`);
        slides += doc.slides.length;
        await page.close();
      }
    } finally { await browser.close(); }
    console.log(`  ${slides} slides measured`);
  });

  await check("PPTX for every direction × composition: scene boxes, Office faces (Consolas for mono), native shapes for graphics, text fits", async () => {
    const browser = await chromium.launch({ headless: true });
    let measured = 0, custom = 0, pictures = 0;
    try {
      const page = await browser.newPage();
      await page.setContent("<body></body>");
      const OFFICE = ["Georgia", "Segoe UI", "Segoe UI Semibold", "Century Gothic", "Franklin Gothic Medium", "Trebuchet MS", "Verdana", "Impact", "Palatino Linotype", "Garamond", "Arial", "Bahnschrift"];
      const installed = await page.evaluate(faces => faces.filter(face => {
        const probe = font => { const span = document.createElement("span"); span.style.cssText = `font:400 60px ${font};white-space:nowrap`; span.textContent = "The quick brown fox 0123"; document.body.append(span); const width = span.getBoundingClientRect().width; span.remove(); return width; };
        return Math.abs(probe(`"${face}", monospace`) - probe("monospace")) > 1;
      }), OFFICE);
      for (const direction of DIRECTIONS) for (const doc of pinnedDecks(direction, DIRECTION_SPECS[direction].pairings[0])) {
        const xmls = await slideXmls(await deckPptx(doc, { art }));
        assert.equal(xmls.length, doc.slides.length);
        const runs = [];
        xmls.forEach((xml, index) => {
          const scene = composeSlide(doc, doc.slides[index], index, doc.slides.length), texts = scene.prims.filter(p => p.k === "text"), shapes = textShapes(xml);
          assert.equal(shapes.length, texts.length, `${direction} slide ${index + 1}: one native text box per text primitive`);
          texts.forEach((prim, i) => {
            const shape = shapes[i], font = FONTS[doc.theme.fonts];
            assert.ok(Math.abs(shape.x - prim.x) < 0.6 && Math.abs(shape.y - prim.y) < 0.6 && Math.abs(shape.w - prim.w) < 0.6 && Math.abs(shape.h - prim.h) < 0.6, `${direction} ${doc.slides[index].id}: box parity for "${prim.text}"`);
            assert.equal(shape.face, prim.font === "heading" ? font.pptxHeading : prim.font === "mono" ? PPTX_MONO : font.pptxBody);
            runs.push({ ...shape, slide: doc.slides[index].id });
          });
          custom += (xml.match(/<a:custGeom>/g) ?? []).length;
          pictures += (xml.match(/<p:pic>/g) ?? []).length;
          if (scene.prims.some(p => p.k === "path")) assert.match(xml, /<a:custGeom>/, "vector graphics are native custom geometry");
        });
        const usable = runs.filter(run => installed.includes(run.face));
        const overflow = await page.evaluate(runs => runs.flatMap(run => {
          const div = document.createElement("div");
          div.style.cssText = `position:absolute;width:${run.w}px;font-family:'${run.face}';font-size:${run.size * 4 / 3}px;line-height:${run.pitch * 4 / 3}px;font-weight:${run.bold ? 700 : 400};font-style:${run.italic ? "italic" : "normal"};letter-spacing:${run.spc * 4 / 3}px;font-kerning:none;overflow-wrap:anywhere`;
          div.textContent = run.text; document.body.append(div);
          const height = div.getBoundingClientRect().height; div.remove();
          return height > run.h + 2 ? [{ slide: run.slide, text: run.text.slice(0, 40), height: Math.round(height), box: Math.round(run.h) }] : [];
        }), usable);
        assert.deepEqual(overflow, [], `${direction}: ${JSON.stringify(overflow.slice(0, 3))}`);
        measured += usable.length;
      }
    } finally { await browser.close(); }
    assert.ok(custom > 100 && pictures > 10, "graphics reach the PPTX as custom geometry and rendered artwork");
    console.log(`  measured ${measured} PPTX text boxes with installed Office faces; ${custom} custom-geometry shapes, ${pictures} pictures`);
  });

  await check("deterministic: the same deck composes, renders and exports identically every time", async () => {
    for (const direction of DIRECTIONS) {
      const a = parse(fixtures.deck(DIRECTION_SPECS[direction].pairings[0], direction)), b = parse(fixtures.deck(DIRECTION_SPECS[direction].pairings[0], direction));
      const scenes = doc => JSON.stringify(doc.slides.map((slide, i) => composeSlide(doc, slide, i, doc.slides.length)));
      assert.equal(scenes(a), scenes(b), `${direction}: scenes`);
      assert.equal(deckHtml(a, {}, "print"), deckHtml(b, {}, "print"), `${direction}: print HTML`);
      assert.equal(deckHtml(a, {}, "present"), deckHtml(b, {}, "present"), `${direction}: presenter HTML`);
      assert.deepEqual(await slideXmls(await deckPptx(a, { art })), await slideXmls(await deckPptx(b, { art })), `${direction}: PPTX slides`);
      // A slide composed on its own (as the editor does) matches the whole-deck plan.
      a.slides.forEach((slide, i) => assert.equal(JSON.stringify(composeSlide({ ...a }, slide, i, a.slides.length)), JSON.stringify(planDeck(a)[i].scene)));
    }
  });

  await check("variety: no composition twice in a row, no back-to-back colour fields, and directions differ in structure", () => {
    const sequences = new Map(), covers = new Set(), signatures = new Set();
    for (const direction of DIRECTIONS) {
      const doc = parse(fixtures.deck(DIRECTION_SPECS[direction].pairings[0], direction)), plan = planDeck(doc);
      plan.forEach((entry, i) => {
        if (!i) return;
        const options = candidates(doc, doc.slides[i], i, doc.slides.length);
        if (options.length > 1) assert.notEqual(entry.id, plan[i - 1].id, `${direction}: slides ${i} and ${i + 1} share ${entry.id}`);
      });
      for (let i = 1; i < plan.length; i++) if (compositionKind(plan[i].id) === "field" && compositionKind(plan[i - 1].id) === "field") {
        const alternatives = candidates(doc, doc.slides[i], i, doc.slides.length).filter(id => compositionKind(id) !== "field" && id !== plan[i - 1].id);
        assert.equal(alternatives.length, 0, `${direction}: slides ${i} and ${i + 1} are both colour fields although ${alternatives.join(", ")} fit`);
      }
      sequences.set(direction, plan.map(entry => entry.id).join(","));
      covers.add(plan[0].id);
      signatures.add(JSON.stringify(plan[1].scene.prims.filter(p => p.k !== "text").map(p => [p.k, Math.round(p.x ?? p.x1), Math.round(p.y ?? p.y1)])));
    }
    assert.equal(new Set(sequences.values()).size, DIRECTIONS.length, "every direction composes the same content differently");
    assert.ok(covers.size >= 6, `cover compositions: ${[...covers].join(", ")}`);
    assert.ok(signatures.size >= 8, "graphic structure differs between directions");
    // Rhythm advisories now also catch an all-light deck in a light-ground direction.
    const flat = parse({ ...fixtures.deck("geist", "swiss"), slides: fixtures.slides().map(slide => ({ ...slide, tone: "light" })) });
    assert.ok(deckRhythmIssues(flat).some(issue => /every slide is light/.test(issue.message)));
    assert.ok(!deckRhythmIssues({ ...flat, theme: { ...flat.theme, direction: "tech" } }).some(issue => /every slide is light/.test(issue.message)), "dark-ground directions are exempt");
  });

  await check("presenter: each direction has its own choreography, script-free and off under reduced motion", () => {
    const keyframes = new Set();
    for (const direction of DIRECTIONS) {
      const html = deckHtml(parse(fixtures.deck("geist", direction)), {}, "present");
      assert.ok(!/<script|\son[a-z]+=/i.test(html));
      assert.match(html, new RegExp(`class="deck dir-${direction}"`));
      assert.match(html, /@media \(prefers-reduced-motion:reduce\)\{[^}]*\}[^}]*animation:none!important/);
      keyframes.add(/\.m-title\{animation:([a-z-]+)/.exec(html)[1]);
    }
    assert.ok(keyframes.size >= 5, `distinct title entrances: ${[...keyframes].join(", ")}`);
  });

  await check("agent guidance names every direction and composition", () => {
    for (const direction of DIRECTIONS) assert.ok(DECK_SYSTEM.includes(`- ${direction} = `), direction);
    for (const id of ALL_COMPOSITIONS) assert.ok(DECK_SYSTEM.includes(`${id} (`), id);
    assert.match(DECK_SYSTEM, /ART DIRECTION/);
    assert.match(DECK_SYSTEM, /- canvas:/);
    assert.match(DECK_SYSTEM, /- agenda:/);
  });

  console.log(`\n${passed} art-direction checks passed; zero external requests.`);
})().catch(error => { console.error(error); process.exit(1); });
