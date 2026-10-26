/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for the image quality and shape controls (no network, no AI). */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
Module._load = function(name, parent, main) { return name.endsWith(".css") ? {} : load.call(this, name, parent, main); };
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) { if (typeof request === "string" && request.startsWith("@/")) request = path.join(__dirname, "..", request.slice(2)); return resolve.call(this, request, parent, ...rest); };
// JSX only in .tsx: a .ts file may use <Type>value assertions.
const compile = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
require.extensions[".ts"] = compile; require.extensions[".tsx"] = compile;
const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const controls = require("./document-image-controls.tsx");
const formats = require("../lib/documents/art-formats.ts");
const { emptyDocument } = require("../lib/documents/editor.ts");

const offers = formats.documentImageOffers("gpt-image-2.5-sunburst", 0.03);
let count = 0;
const check = (name, fn) => { fn(); count++; console.log(`PASS ${name}`); };

check("the controls name the shape and the quality in plain words, price each quality per slide, and disable what cannot render yet", () => {
  const html = renderToStaticMarkup(React.createElement(controls.default, { kind: "presentation", value: { shape: "16:9", quality: "high" }, offers, onChange: () => {} }));
  assert.match(html, /aria-label="Slide shape"/);
  for (const label of ["Widescreen 16:9", "Standard 4:3", "Square 1:1", "Vertical 9:16"]) assert.ok(html.includes(label), label);
  assert.match(html, /<option value="best" disabled="">Best \(not available yet\)<\/option>/);
  const high = offers.presentation["16:9"].find(offer => offer.quality === "high");
  assert.ok(html.includes(`High · ~${high.perImage.expected} cr`), "High shows its expected credits per slide");
  assert.doesNotMatch(html, /gpt|sunburst|flare|openai|model/i, "no provider or model named");
  const book = renderToStaticMarkup(React.createElement(controls.default, { kind: "book", value: { shape: "portrait", quality: "standard" }, offers, onChange: () => {} }));
  for (const label of ["Portrait 6 × 9 in", "Square 8.5 × 8.5 in", "Landscape 10 × 8 in"]) assert.ok(book.includes(label), label);
  assert.match(book, /aria-label="Page shape"/);
});

check("the credit impact is shown before generating, from the bound, and says when a quality is not available", () => {
  const high = offers.presentation["16:9"].find(offer => offer.quality === "high").perImage;
  assert.equal(controls.creditImpact("presentation", offers, { shape: "16:9", quality: "high" }), `High images: about ${high.expected} credits per generated slide (at most ${high.max} with a retry), inside this request's limit.`);
  assert.equal(controls.creditImpact("presentation", offers, { shape: "1:1", quality: "high" }), "High is not available for this shape yet.");
  assert.equal(controls.creditImpact("presentation", null, { shape: "16:9", quality: "high" }), "");
});

check("initial choice: the saved document's, else the brief's answers, else 16:9 / 6x9 at High when it can render; an unavailable saved choice shows the next lower", () => {
  assert.deepEqual(controls.initialImageChoice("presentation", offers), { shape: "16:9", quality: "high" });
  assert.deepEqual(controls.initialImageChoice("presentation", offers, "A deck\n\n- Slide shape: Vertical 9:16\n- Image quality: High"), { shape: "9:16", quality: "standard" }, "High 9:16 is unmeasured");
  assert.deepEqual(controls.initialImageChoice("book", offers), { shape: "portrait", quality: "standard" });
  const deck = emptyDocument("deck", "x", undefined, { slideMode: "image", aspect: "4:3", quality: "standard" });
  assert.deepEqual(controls.initialImageChoice("presentation", offers, "- Slide shape: Vertical 9:16", deck), { shape: "4:3", quality: "standard" }, "the saved document wins over the brief");
  assert.deepEqual(controls.initialImageChoice("presentation", null), { shape: "16:9", quality: "high" }, "before the offers load: the default");
});

check("creation writes the choice into the brief as answer lines that the first build reads back", () => {
  for (const [kind, choice] of [["presentation", { shape: "9:16", quality: "standard" }], ["presentation", { shape: "4:3", quality: "high" }], ["book", { shape: "square", quality: "standard" }], ["book", { shape: "landscape", quality: "high" }]]) {
    const brief = `A brief\n\n${controls.imageChoiceLines(kind, choice)}`;
    const read = formats.newDocumentFormat(kind, brief, {}, "gpt-image-2.5-sunburst");
    assert.deepEqual(read, kind === "presentation" ? { aspect: choice.shape, quality: choice.quality } : { shape: choice.shape, quality: choice.quality }, brief);
  }
  assert.deepEqual(controls.imageOptionsOf("presentation", { shape: "1:1", quality: "standard" }), { quality: "standard", aspect: "1:1" });
  assert.deepEqual(controls.imageOptionsOf("book", { shape: "square", quality: "high" }), { quality: "high", shape: "square" });
});

check("wiring: the composer sends the choice only when a request starts; creation appends it to the brief; the studio passes the offers", () => {
  const builder = fs.readFileSync(path.join(__dirname, "live-builder.tsx"), "utf8"), home = fs.readFileSync(path.join(__dirname, "creation-home.tsx"), "utf8"), studio = fs.readFileSync(path.join(__dirname, "cloud-studio.tsx"), "utf8");
  assert.match(builder, /"actionKey" in requestOperation && docKind && imageChoice && imageControls \? \{ imageOptions: imageOptionsOf\(docKind, imageChoice\) \}/);
  assert.match(builder, /creditImpact\(docKind, imageOffers, imageChoice\)/);
  assert.match(home, /imageChoiceLines\(docKind, imageChoice\)/);
  assert.match(studio, /imageOffers=\{documentImages\} projectBrief=\{project\?\.brief \?\? ""\}/);
});

console.log(`${count} image quality and shape control checks passed.`);
