/* eslint-disable @typescript-eslint/no-require-imports -- Offline document builder checks (no network, no paid calls). */
const fs = require("node:fs"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true}}).outputText, filename);
const {DocumentEditor, DocToolError, DocToolInputs, docToolDefinitions, emptyDocument} = require("./editor.ts");
const {parseBookMarkup, inlineHtml} = require("./book-markup.ts");
const {composeSlide, W, H} = require("./slide-scene.ts");
const {deckHtml} = require("./render-deck.ts");
const {bookHtml} = require("./render-book.ts");
const {projectDocument} = require("./project.ts");
const {ArtifactContentSchema} = require("../domain.ts");
const {deckPptx} = require("./pptx.ts");

let count = 0;
async function check(name, fn) { await fn(); count++; console.log(`PASS ${name}`); }
const slide = (extra) => ({ id: "s1", layout: "statement", title: "Towns lack financing, not sun", notes: "Say why.", ...extra });
const deck = () => new DocumentEditor(emptyDocument("deck", "Pitch"));
const book = () => new DocumentEditor(emptyDocument("book", "Tales"));
const invalid = (editor, name, input, pattern) => assert.throws(() => editor.apply(name, input), error => (error instanceof DocToolError || error.name === "ZodError") && (!pattern || pattern.test(error.message)), `${name} should reject ${JSON.stringify(input).slice(0, 80)}`);

(async () => {
  await check("tool definitions are plain object schemas for each kind", () => {
    const deckTools = docToolDefinitions("deck", true), bookTools = docToolDefinitions("book", false);
    assert.deepEqual(deckTools.map(tool => tool.name), ["set_theme", "set_deck_details", "write_slide", "delete_slide", "move_slide", "generate_image", "finish"]);
    assert.ok(!bookTools.some(tool => tool.name === "generate_image"));
    for (const tool of [...deckTools, ...bookTools]) { assert.equal(tool.input_schema.type, "object"); assert.equal(tool.input_schema.$schema, undefined); }
    assert.ok(JSON.stringify(deckTools.find(tool => tool.name === "write_slide").input_schema).includes("\"chart\""));
  });
  await check("write_slide input validation rejects incomplete or oversized slides", () => {
    const editor = deck();
    invalid(editor, "write_slide", { slide: slide({ notes: "" }) });
    invalid(editor, "write_slide", { slide: { id: "s1", layout: "statement", title: "x" } });
    invalid(editor, "write_slide", { slide: slide({ id: "Bad Id" }) });
    invalid(editor, "write_slide", { slide: slide({ layout: "nope" }) });
    invalid(editor, "write_slide", { slide: slide({ layout: "chart" }) }, /chart/);
    invalid(editor, "write_slide", { slide: slide({ layout: "chart", chart: { type: "column", categories: ["a", "b"], series: [{ name: "x", values: [1] }] } }) }, /values/);
    invalid(editor, "write_slide", { slide: slide({ layout: "chart", chart: { type: "donut", categories: ["a", "b"], series: [{ name: "x", values: [1, 2] }, { name: "y", values: [1, 2] }] } }) }, /donut/);
    invalid(editor, "write_slide", { slide: slide({ layout: "diagram", diagram: { kind: "matrix", items: [{ label: "a" }, { label: "b" }] } }) }, /matrix/);
    invalid(editor, "write_slide", { slide: slide({ layout: "points", points: [{ text: "only one" }] }) }, /at least 2/);
    invalid(editor, "write_slide", { slide: slide({ title: "x".repeat(121) }) });
    invalid(editor, "write_slide", { slide: slide({ script: "<script>" }) });
    invalid(editor, "write_slide", { slide: slide({ layout: "split", body: "text" }) }, /image/);
    assert.equal(editor.changed, false);
    assert.match(editor.apply("write_slide", { slide: slide() }), /Added slide 1 of 1/);
  });
  await check("tools are scoped to their document kind and unknown tools fail", () => {
    invalid(book(), "write_slide", { slide: slide() }, /not available/);
    invalid(deck(), "write_chapter", { chapter: { id: "c1", title: "One", text: "Hi" } }, /not available/);
    invalid(deck(), "rm_rf", {}, /Unknown tool/);
    invalid(deck(), "finish", { summary: "x" }, /Unknown tool/);
  });
  await check("generate_image and finish inputs are validated", () => {
    assert.throws(() => DocToolInputs.generate_image.parse({ name: "Cover Art", prompt: "a lighthouse at dawn over calm water", aspect: "portrait", alt: "Lighthouse" }));
    assert.throws(() => DocToolInputs.generate_image.parse({ name: "cover", prompt: "short", aspect: "portrait", alt: "Lighthouse" }));
    assert.throws(() => DocToolInputs.generate_image.parse({ name: "cover", prompt: "a lighthouse at dawn over calm water", aspect: "wide", alt: "Lighthouse" }));
    assert.doesNotThrow(() => DocToolInputs.generate_image.parse({ name: "cover", prompt: "a lighthouse at dawn over calm water", aspect: "portrait", alt: "Lighthouse" }));
    assert.throws(() => DocToolInputs.finish.parse({ summary: "" }));
  });
  await check("slides are placed, replaced, moved and deleted by id", () => {
    const editor = deck();
    for (const id of ["a", "b", "c"]) editor.apply("write_slide", { slide: slide({ id }) });
    editor.apply("write_slide", { slide: slide({ id: "z" }), after: "start" });
    editor.apply("write_slide", { slide: slide({ id: "b", title: "Replaced in place" }) });
    assert.deepEqual(editor.doc.slides.map(s => s.id), ["z", "a", "b", "c"]);
    assert.equal(editor.doc.slides[2].title, "Replaced in place");
    editor.apply("move_slide", { id: "z", after: "c" });
    assert.deepEqual(editor.doc.slides.map(s => s.id), ["a", "b", "c", "z"]);
    invalid(editor, "move_slide", { id: "a", after: "missing" }, /No item/);
    editor.apply("delete_slide", { id: "b" });
    assert.deepEqual(editor.doc.slides.map(s => s.id), ["a", "c", "z"]);
    invalid(editor, "delete_slide", { id: "b" }, /No slide/);
  });
  await check("themes are contrast-checked and keep the image style unless replaced", () => {
    const editor = deck();
    const palette = { background: "#F7F4EE", surface: "#ECE5D8", ink: "#15181C", muted: "#545A62", accent: "#D2561E", accent2: "#2D5B6B", dark: "#132027" };
    editor.apply("set_theme", { palette, fonts: "editorial", imageStyle: "soft gouache" });
    editor.apply("set_theme", { palette: { ...palette, accent: "#C2410C" }, fonts: "modern" });
    assert.equal(editor.doc.theme.imageStyle, "soft gouache");
    assert.equal(editor.doc.theme.fonts, "modern");
    invalid(editor, "set_theme", { palette: { ...palette, ink: "#BBBBBB" }, fonts: "modern" }, /contrast/);
    invalid(editor, "set_theme", { palette: { ...palette, ink: "red" }, fonts: "modern" });
    assert.match(editor.imagePrompt("A roof with solar panels"), /soft gouache[\s\S]*No text/);
  });
  await check("finish blocks on missing images and reports layout fit once", () => {
    const editor = deck();
    editor.apply("write_slide", { slide: slide({ id: "img", layout: "image", image: "roof" }) });
    assert.ok(editor.problems().some(problem => problem.includes("roof")));
    editor.addAsset({ name: "roof", id: "00000000-0000-4000-8000-000000000001", aspect: "landscape", alt: "Roof", prompt: "" });
    assert.deepEqual(editor.problems(), []);
    // Art directions fall back across compositions until one fits, so the overflow must defeat every table composition.
    const cell = "Far more words than any slide can show in one table cell";
    editor.apply("write_slide", { slide: slide({ id: "long", layout: "table", table: { columns: ["One", "Two", "Three", "Four", "Five", "Six"], rows: Array.from({ length: 8 }, () => Array.from({ length: 6 }, () => cell)) } }) });
    const first = editor.problems();
    assert.ok(first.some(problem => /Shorten/.test(problem)), "fit warning should block once");
    assert.deepEqual(editor.problems(), [], "second finish accepts heuristic fit warnings");
  });
  await check("chapters support exact, unique edits", () => {
    const editor = book();
    editor.apply("write_chapter", { chapter: { id: "one", title: "One", text: "First paragraph.\n\nSecond paragraph about the sea. The sea again." } });
    invalid(editor, "edit_chapter", { id: "one", old_string: "missing", new_string: "x" }, /not found/);
    invalid(editor, "edit_chapter", { id: "one", old_string: "sea", new_string: "ocean" }, /appears 2 times/);
    editor.apply("edit_chapter", { id: "one", old_string: "sea", new_string: "ocean", replace_all: true });
    assert.match(editor.doc.chapters[0].text, /about the ocean\. The ocean again/);
    invalid(editor, "edit_chapter", { id: "two", old_string: "a", new_string: "b" }, /No chapter/);
    assert.match(editor.apply("write_chapter", { chapter: { id: "two", title: "Two", image: "harbor", text: "[[figure:harbor|The harbor]]" } }), /not generated/);
    assert.ok(editor.problems().some(problem => problem.includes("harbor")));
  });
  await check("book markup parses blocks and escapes inline HTML", () => {
    const blocks = parseBookMarkup("Para *one* and **two**.\n\n## Heading\n\n> Quote line\n> — Ana\n\n- a\n- b\n\n1. x\n2. y\n\n* * *\n\n[[figure:cat|A cat]]\n\n[[note:Tip|Do it]]");
    assert.deepEqual(blocks.map(b => b.type), ["paragraph", "subheading", "quote", "list", "list", "break", "figure", "note"]);
    assert.equal(blocks[2].attribution, "Ana");
    assert.equal(blocks[4].ordered, true);
    assert.equal(inlineHtml("<b>*hi*</b> **bold**"), "&lt;b&gt;<em>hi</em>&lt;/b&gt; <strong>bold</strong>");
  });
  await check("every slide layout composes inside the 16:9 canvas", () => {
    const editor = deck();
    editor.addAsset({ name: "art", id: "00000000-0000-4000-8000-000000000002", aspect: "landscape", alt: "Art", prompt: "" });
    const slides = [
      slide({ id: "a", layout: "cover", subtitle: "Sub", tone: "dark" }), slide({ id: "b", layout: "section", eyebrow: "02" }), slide({ id: "c", layout: "statement", body: "Body" }),
      slide({ id: "d", layout: "points", points: [{ title: "A", text: "Alpha" }, { title: "B", text: "Beta" }, { text: "Gamma" }] }), slide({ id: "e", layout: "split", image: "art", body: "Body" }),
      slide({ id: "f", layout: "stats", stats: [{ value: "61%", label: "Covered" }] }), slide({ id: "g", layout: "chart", body: "Up", chart: { type: "line", categories: ["a", "b", "c"], series: [{ name: "x", values: [1, 2, 3] }] } }),
      ...["process", "cycle", "pyramid", "funnel", "timeline"].map((kind, i) => slide({ id: `h${i}`, layout: "diagram", diagram: { kind, items: [{ label: "One" }, { label: "Two" }, { label: "Three", detail: "Detail" }] } })),
      slide({ id: "m", layout: "diagram", diagram: { kind: "matrix", items: [{ label: "1" }, { label: "2" }, { label: "3" }, { label: "4" }] } }),
      slide({ id: "n", layout: "compare", compare: { left: { heading: "Old", points: ["slow"] }, right: { heading: "New", points: ["fast"] } } }),
      slide({ id: "o", layout: "quote", quote: { text: "Quoted words", attribution: "Ana" } }), slide({ id: "p", layout: "image", image: "art" }), slide({ id: "q", layout: "closing", tone: "accent" }),
    ];
    for (const entry of slides) editor.apply("write_slide", { slide: entry });
    editor.doc.slides.forEach((entry, index) => {
      const scene = composeSlide(editor.doc, entry, index, editor.doc.slides.length);
      assert.ok(scene.prims.length > 0, entry.id);
      assert.deepEqual(scene.issues, [], `${entry.id}: ${scene.issues.join("; ")}`);
      for (const prim of scene.prims) if ("w" in prim && prim.k !== "ellipse") assert.ok(prim.x >= 0 && prim.y >= 0 && prim.x + prim.w <= W + 0.5 && prim.y + prim.h <= H + 0.5, `${entry.id} ${prim.k} outside canvas`);
    });
  });
  await check("rendered HTML escapes user text and never emits scripts", () => {
    const editor = deck();
    editor.apply("write_slide", { slide: slide({ title: "<script>alert(1)</script>", notes: "<img src=x onerror=alert(1)>" }) });
    const html = deckHtml(editor.doc, {}, "preview");
    assert.ok(!/<script/i.test(html) && !/<img src=x/.test(html));
    const b = book();
    b.apply("write_chapter", { chapter: { id: "one", title: "<script>x</script>", text: "Hello <iframe src=//evil>" } });
    const bookPage = bookHtml(b.doc, {}, "print");
    assert.ok(!/<script|<iframe/i.test(bookPage));
    assert.ok(bookPage.includes('@page ch-0:right{@top-right{content:"\\00003Cscript\\00003Ex'), "running heads are CSS-escaped");
  });
  await check("outline projection is a valid artifact content with the document", () => {
    const editor = book();
    editor.apply("write_chapter", { chapter: { id: "one", title: "One", text: "Para.\n\n## Sub\n\n> Quote" } });
    const content = { schemaVersion: 1, kind: "book", title: "Tales", sections: projectDocument(editor.doc), document: editor.doc };
    const parsed = ArtifactContentSchema.parse(content);
    assert.equal(parsed.document.kind, "book");
    assert.deepEqual(parsed.sections[0].blocks.map(b => b.type), ["heading", "paragraph", "heading", "quote"]);
    assert.throws(() => ArtifactContentSchema.parse({ ...content, kind: "presentation" }), /match the artifact kind/);
  });
  await check("PPTX is a valid package with notes and escaped chart formats", async () => {
    const editor = deck();
    editor.apply("write_slide", { slide: slide({ id: "c", layout: "chart", chart: { type: "column", categories: ["a", "b"], series: [{ name: "x", values: [1.5, 2] }], unit: "\"GW" } }) });
    const bytes = await deckPptx(editor.doc, {});
    assert.equal(bytes.subarray(0, 2).toString(), "PK");
    const JSZip = require("jszip");
    const zip = await JSZip.loadAsync(bytes);
    const chart = await zip.file(/charts\/chart\d+\.xml$/)[0].async("string");
    assert.ok(!/formatCode="[^"]*"[^ />]/.test(chart) && !chart.includes('typeface="\\"'), "chart XML attributes must stay well-formed");
    assert.ok(Object.keys(zip.files).some(name => name.includes("notesSlide")));
  });
  console.log(`\n${count} document checks passed.`);
})().catch(error => { console.error(error); process.exit(1); });
