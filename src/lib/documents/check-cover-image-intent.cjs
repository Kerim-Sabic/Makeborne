/* eslint-disable @typescript-eslint/no-require-imports -- Offline regression for image intent across shared preview/PDF/PPTX scenes. */
const fs = require("node:fs"), Module = require("node:module"), assert = require("node:assert/strict"), ts = require("typescript");
const load = Module._load;
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const { emptyDocument } = require("./editor.ts"), { composeSlide, planDeck } = require("./slide-scene.ts"), { deckHtml } = require("./render-deck.ts"), { deckPptx } = require("./pptx.ts");
const sharp = require("sharp"), JSZip = require("jszip");
const make = (layout = "cover", image = "hero") => ({ ...emptyDocument("deck", "Image intent"), assets: image ? [{ id: "11111111-1111-4111-8111-111111111111", name: "hero", alt: "Cut-paper fields", aspect: "landscape" }] : [], slides: [{ id: "cover", layout, tone: "light", variant: layout === "cover" ? "cover-masthead" : "closing-ask", title: "Design that starts in the field", subtitle: "An independent studio turning research into brands and websites.", notes: "Explain the offer.", ...(image ? { image } : {}) }] });
(async () => {
  for (const layout of ["cover", "closing"]) {
    const deck = make(layout), scene = composeSlide(deck, deck.slides[0], 0, 1);
    assert.equal(scene.composition, "cover-image"); assert.equal(scene.prims.filter(p => p.k === "image" && p.name === "hero").length, 1); assert.deepEqual(scene.issues, []);
    assert.equal(planDeck(deck)[0].id, "cover-image");
    console.log(`PASS ${layout} image survives an incompatible decorative variant in preview and shared export scene`);
  }
  const plain = make("cover", null); assert.equal(composeSlide(plain, plain.slides[0], 0, 1).composition, "cover-masthead");
  console.log("PASS decorative variants remain available when no image was requested");
  const long = make(); long.slides[0].title = "W".repeat(2000); const crowded = composeSlide(long, long.slides[0], 0, 1);
  assert(crowded.prims.some(p => p.k === "image")); assert(crowded.issues.length > 0);
  console.log("PASS non-fitting copy reports an issue instead of silently dropping the image");
  const bytes = await sharp({ create: { width: 80, height: 60, channels: 3, background: "#246A50" } }).png().toBuffer(), deck = make();
  const html = deckHtml(deck, { hero: `data:image/png;base64,${bytes.toString("base64")}` }); assert(html.includes("<img")); assert(html.includes(bytes.toString("base64")));
  const zip = await JSZip.loadAsync(await deckPptx(deck, { hero: bytes })); const slide = await zip.file("ppt/slides/slide1.xml").async("string");
  assert(slide.includes("<p:pic>")); assert(slide.includes("Design that starts in the field")); assert(Object.keys(zip.files).some(n => n.startsWith("ppt/media/") && !n.endsWith("/")));
  console.log("PASS HTML and native editable PowerPoint retain the image and actual text");
})().catch(error => { console.error(error); process.exitCode = 1; });
