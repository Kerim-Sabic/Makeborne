/* eslint-disable @typescript-eslint/no-require-imports -- Offline authored-composition validation and native export checks. */
const fs = require("node:fs"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const load = Module._load;
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const sharp = require("sharp"), JSZip = require("jszip");
const { fixtures, text } = require("./fixtures/authored-covers.cjs");
const { CoverCompositionSchema } = require("./composition-schema.ts");
const { DocumentSourceSchema, SlideSchema } = require("./schema.ts");
const { DocumentEditor, emptyDocument, docToolDefinitions } = require("./editor.ts");
const { composeSlide } = require("./slide-scene.ts"), { bookCoverScene } = require("./cover-composition.ts");
const { bookHtml } = require("./render-book.ts"), { deckHtml } = require("./render-deck.ts"), { deckPptx } = require("./pptx.ts");
const hash = value => crypto.createHash("sha256").update(value.replace(/Copyright © \d{4}/g, "Copyright © YEAR")).digest("hex");
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
const fixture = fixtures()[0];
const copy = value => structuredClone(value);
(async () => {
  await check("legacy book preview/print and deck preview/scenes retain exact pre-change rendering", () => {
    const book = { ...emptyDocument("book", "Legacy book"), subtitle: "Subheading", author: "Author", chapters: [{ id: "chapter-one", title: "A chapter", text: "A paragraph for the legacy book." }] };
    const deck = { ...emptyDocument("deck", "Legacy deck"), slides: [{ id: "cover", layout: "cover", tone: "dark", title: "Legacy title", subtitle: "Legacy subtitle", notes: "Notes" }, { id: "close", layout: "closing", tone: "light", title: "Legacy closing", body: "Next steps", notes: "Notes" }] };
    // Re-pinned 2026-10-13 for optional book openings/contents links. This no-label, one-chapter fixture's
    // DOM was compared with the frozen pre-change renderer and is unchanged; only CSS was added/adjusted.
    assert.equal(hash(bookHtml(book, {})), "d5f96829b0edd919287ed6be329492bcdddda44f3954a56e5f73281be8bed691");
    assert.equal(hash(bookHtml(book, {}, "print")), "8b60abde00591634d209f932e10718a288294c77d068cbf5b7e5b3a798d8f1ca");
    assert.equal(hash(deckHtml(deck, {})), "aebc19cb4928ac358d2af86422a331f7c49f8f025fcfe9f7ec31070c4c911ca1");
    assert.equal(hash(JSON.stringify(deck.slides.map((s, i) => composeSlide(deck, s, i, 2)))), "99a0c779d96ce096aecbde1f150424a804e09a153356712f29a5cd1356a814fd");
  });
  await check("three synthetic subject compositions stay editable, distinct and within both canvases", async () => {
    const signatures = new Set();
    for (const { book, deck } of fixtures()) {
      const scenes = [bookCoverScene(book), ...deck.slides.map((slide, i) => composeSlide(deck, slide, i, 2))];
      signatures.add(JSON.stringify(scenes[0].prims.filter(p => p.k !== "text")));
      scenes.forEach((scene, index) => {
        assert.deepEqual(scene.issues, []);
        const width = index ? 1280 : 576, height = index ? 720 : 864;
        assert.equal(scene.prims.filter(p => p.k === "text" && p.role === "title").length, 1);
        for (const p of scene.prims) if (p.k !== "line") { assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= width + 0.01 && p.y + p.h <= height + 0.01); }
      });
      const html = bookHtml(book, {}); assert.match(html, /class="full authored-cover"/); assert.doesNotMatch(html, /class="disc"/); assert.match(html, /<h1 data-cover-text="true"/);
      const pptx = await JSZip.loadAsync(await deckPptx(deck, {}));
      for (let i = 1; i <= 2; i++) {
        const xml = await pptx.file(`ppt/slides/slide${i}.xml`).async("string"), scene = scenes[i];
        assert.equal((xml.match(/<p:sp>/g) ?? []).length, scene.prims.length);
        assert.equal((xml.match(/<a:t>/g) ?? []).length, scene.prims.filter(p => p.k === "text").length);
        assert.ok(xml.includes(book.title)); assert.doesNotMatch(xml, /<p:pic>/);
        for (const p of scene.prims.filter(p => p.k === "text")) { assert.ok(xml.includes(`x="${Math.round(p.x / 96 * 914400)}"`)); assert.ok(xml.includes(`y="${Math.round(p.y / 96 * 914400)}"`)); }
      }
    }
    assert.equal(signatures.size, 3);
  });
  await check("strict schema rejects off-canvas boxes/strokes, unsafe text margins, duplicates, overlaps and raw markup", () => {
    const valid = fixture.book.cover.composition;
    for (const bad of [
      { ...valid, rawHtml: "<svg/>" }, { ...valid, elements: [] }, { ...valid, elements: valid.elements.filter(e => e.type !== "text") },
      { ...valid, elements: [...valid.elements, valid.elements.find(e => e.role === "title")] },
      { ...valid, elements: [...valid.elements, { type: "image", x: 99, y: 4, w: 10, h: 10 }] },
      { ...valid, elements: [...valid.elements, { type: "line", x1: 0, y1: 5, x2: 100, y2: 5, width: 2, color: "ink" }] },
      { ...valid, elements: [text("title", 0, 5, 80, 20, 10)] },
      { ...valid, elements: [text("title", 5, 5, 80, 20, 10), text("subtitle", 6, 6, 60, 15, 3)] },
      { ...valid, elements: [text("title", 5, 5, 80, 20, 10, "url(evil)")] },
      { ...valid, elements: [text("title", 5, 5, 80, 20, Infinity)] },
    ]) {
      assert.equal(CoverCompositionSchema.safeParse(bad).success, false);
      const book = copy(fixture.book); book.cover.composition = bad;
      assert.equal(DocumentSourceSchema.safeParse(book).success, false, "nested invalid composition returns validation errors without throwing");
      const deck = copy(fixture.deck); deck.slides[0].composition = bad;
      assert.equal(DocumentSourceSchema.safeParse(deck).success, false);
    }
  });
  await check("document boundary refuses unreadable/missing text, art collisions, empty images and wrong slide layout", () => {
    const changes = [
      comp => { comp.elements.find(e => e.role === "title").color = "background"; },
      comp => { Object.assign(comp.elements.find(e => e.role === "title"), { w: 1, h: 1 }); },
      comp => { comp.elements.push(text("body", 8, 83, 80, 5, 3)); },
      comp => { comp.elements.push({ type: "image", x: 8, y: 18, w: 84, h: 18 }); },
      comp => { comp.elements.push({ type: "ellipse", x: 8, y: 18, w: 84, h: 18, fill: "accent" }); },
    ];
    for (const change of changes) { const book = copy(fixture.book); change(book.cover.composition); assert.equal(DocumentSourceSchema.safeParse(book).success, false); }
    assert.equal(SlideSchema.safeParse({ ...fixture.deck.slides[0], layout: "statement" }).success, false);
    const deck = copy(fixture.deck); deck.slides[0].composition.elements.push({ type: "image", x: 1, y: 1, w: 3, h: 3 }); assert.equal(DocumentSourceSchema.safeParse(deck).success, false);
  });
  await check("book tool preserves composition on edit, explicitly removes it on null and refuses invalid replacement atomically", () => {
    const editor = new DocumentEditor(fixture.book), b = editor.doc;
    const details = { title: b.title, subtitle: b.subtitle, author: b.author, tagline: b.cover.tagline };
    editor.apply("set_book_details", details); assert.deepEqual(editor.doc.cover.composition, b.cover.composition);
    const before = editor.snapshot(), bad = copy(b.cover.composition); bad.elements.find(e => e.role === "title").color = "background";
    assert.throws(() => editor.apply("set_book_details", { ...details, cover_composition: bad }), /contrast/); assert.equal(editor.snapshot(), before);
    editor.apply("set_book_details", { ...details, cover_composition: null }); assert.equal(editor.doc.cover.composition, undefined);
    editor.apply("set_book_details", { ...details, cover_composition: b.cover.composition }); assert.deepEqual(editor.doc.cover.composition, b.cover.composition);
    for (const kind of ["book", "deck"]) assert.ok(JSON.stringify(docToolDefinitions(kind, false)).includes("composition"));
  });
  await check("wide glyphs, CJK and preserved tabs cannot pass a box sized for average glyphs", () => {
    for (const title of ["W".repeat(80), "界".repeat(80), `A${"\t".repeat(30)}Z`]) {
      const book = { ...emptyDocument("book", title), cover: { composition: { version: 1, background: "background", elements: [text("title", 8, 8, 84, 12, 4)] } } };
      const result = DocumentSourceSchema.safeParse(book); assert.equal(result.success, false); assert.match(JSON.stringify(result.error.issues), /does not fit/);
    }
    const narrow = { ...emptyDocument("book", "W"), cover: { composition: { version: 1, background: "background", elements: [text("title", 8, 8, 1, 60, 4)] } } };
    assert.equal(DocumentSourceSchema.safeParse(narrow).success, false, "one wide glyph cannot overflow a narrow but tall box");
  });
  await check("theme changes preserve the previous document when authored contrast fails", () => {
    const book = copy(fixture.book); book.theme.palette.accent = book.theme.palette.ink;
    book.cover.composition.elements.find(e => e.role === "title").color = "accent";
    const editor = new DocumentEditor(book), before = editor.snapshot();
    assert.throws(() => editor.apply("set_theme", { ...book.theme, palette: { ...book.theme.palette, accent: book.theme.palette.background } }), /contrast/);
    assert.equal(editor.snapshot(), before);
  });
  await check("declaring an image before generation remains possible and registering it clears the asset gate", () => {
    const editor = new DocumentEditor(emptyDocument("book", "Coastal reading"));
    editor.apply("write_chapter", { chapter: { id: "intro", title: "Introduction", text: "A fixture paragraph." } });
    editor.apply("set_book_details", { title: "Coastal reading", cover_image: "coast-image", cover_composition: { version: 1, background: "background", elements: [text("title", 8, 8, 84, 24, 10), { type: "image", x: 8, y: 40, w: 84, h: 45 }] } });
    assert.ok(editor.problems().some(issue => issue.includes("coast-image")));
    editor.addAsset({ name: "coast-image", id: "00000000-0000-4000-8000-000000000002", aspect: "portrait", alt: "Coastal landscape", prompt: "" });
    assert.deepEqual(editor.problems(), []);
  });
  await check("missing authored images remain blocked by existing asset gates and text is escaped", () => {
    const book = copy(fixture.book); book.cover.image = "not-yet-generated"; book.cover.composition.elements.unshift({ type: "image", x: 92, y: 1, w: 7, h: 5 });
    const editor = new DocumentEditor(book); assert.ok(editor.problems().some(issue => issue.includes("not-yet-generated"))); assert.ok(editor.problems().some(issue => issue.includes("not-yet-generated")));
    const escaped = copy(fixture.book); escaped.title = '<svg onload="x">'; escaped.cover.composition.elements.find(e => e.role === "title").w = 84;
    assert.doesNotMatch(bookHtml(DocumentSourceSchema.parse(escaped), {}), /<svg onload/);
  });
  await check("authored PPTX raster framing uses exact center crop; legacy images keep exact attention crop", async () => {
    const data = Buffer.alloc(800 * 300 * 3);
    for (let y = 0; y < 300; y++) for (let x = 0; x < 800; x++) { const i = (y * 800 + x) * 3; data[i] = x < 260 ? 230 : 20; data[i + 1] = x >= 260 && x < 540 ? 180 : 15; data[i + 2] = x >= 540 ? ((x + y) % 2 ? 255 : 30) : 15; }
    const raster = await sharp(data, { raw: { width: 800, height: 300, channels: 3 } }).png().toBuffer();
    for (const authored of [true, false]) {
      const deck = copy(fixture.deck); deck.slides = [deck.slides[0]]; const slide = deck.slides[0]; slide.image = "asymmetric";
      if (authored) slide.composition.elements = [text("title", 7, 10, 48, 35, 8), { type: "image", x: 60, y: 10, w: 35, h: 80 }]; else delete slide.composition;
      deck.assets = [{ name: "asymmetric", id: "00000000-0000-4000-8000-000000000001", aspect: "landscape", alt: "Asymmetric synthetic raster", prompt: "" }];
      const parsed = DocumentSourceSchema.parse(deck), prim = composeSlide(parsed, parsed.slides[0], 0, 1).prims.find(p => p.k === "image");
      const scale = Math.min(2, 2400 / Math.max(prim.w, prim.h)), crop = authored ? "center" : "attention";
      const expected = await sharp(raster).rotate().resize(Math.round(prim.w * scale), Math.round(prim.h * scale), { fit: "cover", position: crop }).jpeg({ quality: 88 }).toBuffer();
      const other = await sharp(raster).rotate().resize(Math.round(prim.w * scale), Math.round(prim.h * scale), { fit: "cover", position: authored ? "attention" : "center" }).jpeg({ quality: 88 }).toBuffer();
      assert.notDeepEqual(expected, other, "fixture must distinguish the crop policies");
      const pptx = await JSZip.loadAsync(await deckPptx(parsed, { asymmetric: raster })), media = Object.keys(pptx.files).filter(name => /^ppt\/media\/.+\.(png|jpe?g)$/.test(name));
      assert.equal(media.length, 1); assert.deepEqual(await pptx.file(media[0]).async("nodebuffer"), expected);
      assert.match(deckHtml(parsed, { asymmetric: `data:image/png;base64,${raster.toString("base64")}` }), /object-fit:cover/);
    }
  });
  console.log(`${passed} authored composition checks passed; all examples synthetic, zero external requests.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
