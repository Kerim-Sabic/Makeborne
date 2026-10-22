/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks: every placed slide image is shown (HTML, PDF and PPTX) or refused before it is paid for. */
const fs = require("node:fs"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const JSZip = require("jszip"), sharp = require("sharp");
const { DocumentSourceSchema, SLIDE_LAYOUTS } = require("./schema.ts");
const { composeSlide, W, H } = require("./slide-scene.ts");
const { DocumentEditor, DocToolError, emptyDocument } = require("./editor.ts");
const { DIRECTIONS } = require("./directions.ts");
const { imageSupport, scrimOpacity, zoneBrightness, RAIL_W, RAIL_WIDE, BAND_H, SCRIM_TOP } = require("./compose-image.ts");
const { imageLuma } = require("./image-luma.ts");
const { contrast, luminance } = require("./theme.ts");
const { deckPptx } = require("./pptx.ts");
const { deckHtml } = require("./render-deck.ts");

let count = 0;
async function check(name, fn) { await fn(); count++; console.log(`PASS ${name}`); }
const palette = { background: "#F7F4EE", surface: "#ECE5D8", ink: "#15181C", muted: "#545A62", accent: "#B4471A", accent2: "#2D5B6B", dark: "#132027" };
const asset = (name, aspect = "landscape", extra = {}) => ({ name, id: `00000000-0000-4000-8000-${String(1000 + name.length).padStart(12, "0")}`.slice(0, 36), aspect, alt: `Photo of ${name.replace(/-/g, " ")}`, prompt: "", ...extra });
const base = (direction, slides, assets) => DocumentSourceSchema.parse({ kind: "deck", schemaVersion: 1, title: "Harbour Light Ferries", theme: { palette, fonts: "editorial", direction, mood: "", imageStyle: "" }, slides, assets });
const samples = {
  statement: { title: "Night crossings sell out first", body: "Evening sailings fill two weeks ahead." },
  points: { title: "Three reasons riders return", points: [{ title: "On time", text: "Departures every 20 minutes" }, { title: "Quiet decks", text: "Calm seating forward" }, { title: "Bikes free", text: "No surcharge on any sailing" }] },
  stats: { title: "A busy first season", stats: [{ value: "41k", label: "Riders" }, { value: "96%", label: "On time" }] },
  agenda: { title: "Today", points: [{ title: "Season", text: "What happened" }, { title: "Fleet", text: "What changes" }, { title: "Ask", text: "What we need" }] },
  quote: { title: "Rider voice", quote: { text: "The calmest twenty minutes of my day.", attribution: "Illustrative rider quote" } },
  section: { title: "The fleet", eyebrow: "02" },
  chart: { title: "Ridership climbs each month", chart: { type: "column", categories: ["May", "Jun", "Jul", "Aug"], series: [{ name: "Riders (k)", values: [6, 9, 12, 14] }], highlight: 3, source: "Illustrative data" } },
  table: { title: "Two routes compared", table: { columns: ["", "North", "South"], rows: [["Crossing", "18 min", "24 min"], ["Sailings", "40", "28"]], highlight: 1 } },
  diagram: { title: "How a crossing runs", diagram: { kind: "process", items: [{ label: "Board" }, { label: "Cross" }, { label: "Land" }] } },
  compare: { title: "Ferry or bridge", compare: { left: { heading: "Bridge", points: ["Traffic at peak"] }, right: { heading: "Ferry", points: ["Fixed timetable"] } } },
  team: { title: "Crew leads", people: [{ name: "Ana Kovač", role: "Captain" }, { name: "Ivo Marić", role: "Engineer" }] },
  pricing: { title: "Passes", tiers: [{ name: "Day", price: "€6" }, { name: "Month", price: "€48" }] },
  canvas: { title: "Canvas", blocks: [{ type: "text", style: "headline", text: "Cross calmly", col: 1, span: 8, row: 2, rows: 3 }] },
  cover: { title: "Harbour Light Ferries", subtitle: "Season review" },
  closing: { title: "Ride with us next season" },
  image: { title: "The evening crossing" },
  split: { title: "Built for bikes", body: "Racks on every deck." },
};
const imageOf = (scene, name) => scene.prims.find(prim => prim.k === "image" && prim.name === name);

(async () => {
  await check("every layout in every direction either shows its slide image or is refused before an image is paid for", () => {
    const refused = new Set();
    for (const direction of DIRECTIONS) for (const layout of SLIDE_LAYOUTS) {
      const slide = { id: `s-${layout}`, layout, notes: "Say it.", image: "harbour", ...samples[layout] };
      const support = imageSupport(slide);
      if (!support.ok) { assert.match(support.message, new RegExp(`layout ${layout} does not show images`)); refused.add(layout); continue; }
      const deck = base(direction, [slide], [asset("harbour")]);
      const scene = composeSlide(deck, deck.slides[0], 0, 1);
      assert.ok(imageOf(scene, "harbour"), `${direction} ${layout} (${scene.composition}) dropped its image`);
    }
    assert.deepEqual([...refused].sort(), ["canvas", "compare", "pricing", "team"]);
  });
  await check("write_slide refuses an image the layout cannot show, before any image exists", () => {
    const editor = new DocumentEditor(emptyDocument("deck", "Ferries"));
    assert.throws(() => editor.apply("write_slide", { slide: { id: "c", layout: "compare", notes: "n", image: "harbour", ...samples.compare } }), error => error instanceof DocToolError && /compare does not show images/.test(error.message));
    assert.throws(() => editor.apply("write_slide", { slide: { id: "p", layout: "points", notes: "n", image: "harbour", imagePlacement: "full", ...samples.points } }), /imagePlacement full is not available/);
    assert.match(editor.apply("write_slide", { slide: { id: "p", layout: "points", notes: "n", image: "harbour", ...samples.points } }), /Added slide 1/);
    assert.ok(editor.problems().some(problem => /harbour/.test(problem)), "the image still has to be generated");
  });
  await check("a side rail holds the image at 38% width (46% for short copy in a stacked composition) and keeps every composed primitive in the text zone", () => {
    const STACKED = new Set(["points-rows", "closing-next", "statement-centered", "statement-hero", "statement-hanging", "quote-centered"]);
    let wide = 0;
    for (const direction of DIRECTIONS) for (const layout of ["statement", "points", "stats", "agenda"]) {
      const deck = base(direction, [{ id: "s", layout, notes: "n", image: "rail-art", imagePlacement: "side", ...samples[layout] }], [asset("rail-art", "portrait")]);
      const scene = composeSlide(deck, deck.slides[0], 0, 1);
      assert.equal(scene.imagePlacement, "side", `${direction} ${layout}`);
      assert.deepEqual(scene.issues, [], `${direction} ${layout} ${scene.composition}`);
      const img = imageOf(scene, "rail-art"), rail = img.w;
      assert.ok(rail === RAIL_W || (rail === RAIL_WIDE && STACKED.has(scene.composition)), `${direction} ${layout} ${scene.composition}: rail ${rail}`);
      if (rail === RAIL_WIDE) wide++;
      assert.deepEqual([img.x, img.y, img.h], [W - rail, 0, H]);
      for (const prim of scene.prims) if (prim !== img) {
        const right = prim.k === "line" ? Math.max(prim.x1, prim.x2) : prim.x + prim.w;
        assert.ok(right <= W - rail + 2, `${direction} ${layout}: ${prim.k} reaches into the rail`);
      }
    }
    assert.ok(wide > 0, "short copy gives some slides the wide rail");
    // A stacked composition beside the rail runs its title across the column: no title column of one word per line.
    const pts = base("editorial", [{ id: "s", layout: "points", notes: "n", image: "rail-art", imagePlacement: "side", variant: "points-rows", ...samples.points }], [asset("rail-art", "portrait")]);
    const title = composeSlide(pts, pts.slides[0], 0, 1).prims.find(prim => prim.k === "text" && prim.role === "title");
    assert.ok(title.w > 500 && title.text.split("\n").length <= 2, `points title ${title.w}px wide, ${JSON.stringify(title.text)}`);
  });
  await check("chart, table and diagram slides take a top band and keep the chart native", () => {
    for (const layout of ["chart", "table", "diagram"]) {
      const deck = base("swiss", [{ id: "s", layout, notes: "n", image: "band-art", ...samples[layout] }], [asset("band-art")]);
      const scene = composeSlide(deck, deck.slides[0], 0, 1);
      assert.equal(scene.imagePlacement, "band", layout);
      assert.deepEqual(scene.issues, []);
      const img = imageOf(scene, "band-art");
      assert.deepEqual([img.y, img.w, img.h], [0, W, BAND_H]);
      assert.ok(scene.prims.filter(prim => prim !== img).every(prim => (prim.k === "line" ? Math.min(prim.y1, prim.y2) : prim.y) >= BAND_H), `${layout} content overlaps the band`);
      if (layout === "chart") assert.ok(scene.prims.some(prim => prim.k === "chart" && prim.h >= 180));
    }
  });
  await check("full-bleed text sits on a scrim that reaches 4.5:1 over the brightest pixels it covers", async () => {
    // Worst case (no measurement): pure white under the text.
    for (const text of ["#FFFFFF", "#F2F2F2"]) {
      const alpha = scrimOpacity(255, luminance(text)), shown = Math.round(255 * (1 - alpha)), hex = `#${shown.toString(16).padStart(2, "0").repeat(3)}`;
      assert.ok(contrast(text, hex) >= 4.5, `${text} over white at ${alpha}: ${contrast(text, hex)}`);
    }
    // A measured dark image needs a lighter scrim than a measured bright one.
    const dark = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#1A2630" } }).png().toBuffer();
    const bright = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#F4EEDC" } }).png().toBuffer();
    const scrimFor = async (bytes) => {
      const deck = base("editorial", [{ id: "s", layout: "statement", notes: "n", image: "night", imagePlacement: "full", ...samples.statement }], [asset("night", "landscape", { luma: await imageLuma(bytes) })]);
      const scene = composeSlide(deck, deck.slides[0], 0, 1);
      assert.equal(scene.imagePlacement, "full");
      const scrim = scene.prims.find(prim => prim.k === "rect" && prim.y === SCRIM_TOP && !prim.fade);
      const texts = scene.prims.filter(prim => prim.k === "text");
      assert.ok(texts.length && texts.every(prim => prim.y >= SCRIM_TOP), "text stays inside the text-safe zone");
      for (const prim of texts) {
        const shown = Math.round(zoneBrightness(deck.assets[0], { x: 0, y: 0, w: W, h: H }, { x: 0, y: SCRIM_TOP, w: W, h: H - SCRIM_TOP }) * (1 - scrim.opacity));
        assert.ok(contrast(prim.color, `#${shown.toString(16).padStart(2, "0").repeat(3)}`) >= 4.5, `"${prim.text}" ${prim.color}`);
      }
      return scrim.opacity;
    };
    const [low, high] = [await scrimFor(dark), await scrimFor(bright)];
    assert.ok(low < high, `scrim ${low} on a dark image should be lighter than ${high} on a bright one`);
  });
  await check("a split-direction cover runs a dark measured photograph full bleed behind a side scrim at 4.5:1; a bright one keeps the split", async () => {
    const cover = async (background) => {
      const bytes = await sharp({ create: { width: 300, height: 300, channels: 3, background } }).png().toBuffer();
      const deck = base("editorial", [{ id: "c", layout: "cover", notes: "n", image: "night", eyebrow: "Proposal", ...samples.cover }], [asset("night", "square", { luma: await imageLuma(bytes) })]);
      return { deck, scene: composeSlide(deck, deck.slides[0], 0, 1) };
    };
    const dark = await cover("#1A2630"), img = imageOf(dark.scene, "night");
    assert.deepEqual([img.x, img.y, img.w, img.h], [0, 0, W, H], "full bleed");
    const [scrim, fade] = dark.scene.prims.filter(prim => prim.k === "rect");
    assert.ok(scrim.x === 0 && scrim.h === H && !scrim.fade && fade.fade === "right" && fade.x === scrim.w, "solid scrim under the text, fading to the right");
    const texts = dark.scene.prims.filter(prim => prim.k === "text");
    const title = texts.find(prim => prim.role === "title");
    assert.ok(title.size >= 80, `cover title ${title.size}px`);
    for (const prim of texts) {
      assert.ok(prim.x + prim.w <= scrim.w, `"${prim.text}" sits on the solid scrim`);
      const shown = Math.round(zoneBrightness(dark.deck.assets[0], { x: 0, y: 0, w: W, h: H }, { x: 0, y: prim.y, w: scrim.w, h: prim.h }) * (1 - scrim.opacity));
      assert.ok(contrast(prim.color, `#${shown.toString(16).padStart(2, "0").repeat(3)}`) >= 4.5, `"${prim.text}" ${prim.color}`);
    }
    const xml = await (await JSZip.loadAsync(await deckPptx(dark.deck, { night: await sharp({ create: { width: 60, height: 60, channels: 3, background: "#1A2630" } }).png().toBuffer() }))).file("ppt/slides/slide1.xml").async("string");
    assert.match(xml, /name="Scrim fade right"[\s\S]*?<a:gradFill[\s\S]*?<a:lin ang="10800000"/, "the PPTX fade runs the same way");
    const bright = await cover("#F4EEDC");
    assert.ok(imageOf(bright.scene, "night").w < W, "a bright photograph keeps the split");
  });
  await check("the PPTX places the same images with their alt text, names the slide title and keeps caps as formatting", async () => {
    const deck = base("swiss", [
      { id: "cover", layout: "cover", notes: "n", image: "harbour", eyebrow: "Season review", ...samples.cover },
      { id: "pts", layout: "points", notes: "n", image: "deck-crew", eyebrow: "Why riders return", ...samples.points },
      { id: "ch", layout: "chart", notes: "n", image: "missing-art", ...samples.chart },
    ], [asset("harbour"), asset("deck-crew", "portrait"), asset("missing-art")]);
    const png = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#456" } }).png().toBuffer();
    const missing = [];
    const zip = await JSZip.loadAsync(await deckPptx(deck, { harbour: png, "deck-crew": png }, missing));
    assert.deepEqual(missing, ["missing-art"], "an unavailable image is reported");
    const slides = await Promise.all([1, 2, 3].map(n => zip.file(`ppt/slides/slide${n}.xml`).async("string")));
    assert.ok(!slides.join("").includes("preencoded"), "no picture is described by its file name");
    assert.match(slides[0], /<p:pic>[\s\S]*?descr="Photo of harbour"/);
    assert.match(slides[1], /<p:pic>[\s\S]*?descr="Photo of deck crew"/);
    assert.ok(!/<p:pic>/.test(slides[2]) && !/D9D6CF/.test(slides[2]), "no grey stand-in box for the missing image");
    for (const [index, xml] of slides.entries()) {
      const titles = xml.match(/<p:ph type="title"\/>/g) ?? [];
      assert.equal(titles.length, 1, `slide ${index + 1} has one title placeholder`);
      assert.match(xml, new RegExp(`name="Title"[\\s\\S]*?<a:t>${deck.slides[index].title.split(" ")[0]}`), `slide ${index + 1} title text`);
    }
    // Swiss labels are set in capitals: the PPTX keeps the words as written with all-caps formatting.
    assert.match(slides[1], /<a:rPr cap="all" lang="en-US"[^>]*>[\s\S]*?<a:t>Why riders return<\/a:t>/);
    assert.ok(!slides[1].includes("WHY RIDERS RETURN"));
    // HTML carries the same images.
    const html = deckHtml(deck, { harbour: "data:image/png;base64,AA==", "deck-crew": "data:image/png;base64,AA==" }, "print");
    assert.equal((html.match(/<img /g) ?? []).length, 2);
  });
  await check("decorative artwork is marked decorative instead of carrying a file name", async () => {
    const deck = base("tech", [{ id: "st", layout: "statement", notes: "n", ...samples.statement }], []);
    const xml = await (await JSZip.loadAsync(await deckPptx(deck, {}))).file("ppt/slides/slide1.xml").async("string");
    for (const pic of xml.match(/<p:pic>[\s\S]*?<\/p:pic>/g) ?? []) assert.match(pic, /descr=""><a:extLst><a:ext uri="\{C183D7F6-B498-43B3-948B-1728B52AA6E4\}"><adec:decorative/);
  });
  await check("an image-led deck may have one image per slide from medium effort (16 at most); a book a cover plus one per chapter", () => {
    const { documentImageMax, DOCUMENT_IMAGE_CAP, BUILDER_EFFORT } = require("../builder/pricing.ts");
    assert.equal(DOCUMENT_IMAGE_CAP, 16);
    assert.equal(documentImageMax("deck", "light", 12), BUILDER_EFFORT.light.maxImages, "light keeps its count");
    for (const effort of ["medium", "high", "super_high", "ultra"]) {
      assert.equal(documentImageMax("deck", effort, 12), 12, effort);
      assert.equal(documentImageMax("deck", effort, 30), 16, `${effort} cap`);
      assert.equal(documentImageMax("deck", effort, 1), BUILDER_EFFORT[effort].maxImages, `${effort} floor`);
      assert.equal(documentImageMax("book", effort, 7), 8, `${effort}: cover + 7 openers`);
    }
    // The run still bounds images by its spend allowance (a third of it) before this count applies.
    const agent = fs.readFileSync(require.resolve("../builder/docs-agent.ts"), "utf8");
    assert.match(agent, /imageBudget = imageModelId \? Math\.max\(0, Math\.floor\(spend\.allowanceMicrousd \/ imageBound \/ 3\)\)/);
    assert.match(agent, /imagesUsed >= imageLimitNow\(\)/);
  });
  console.log(`\n${count} slide image checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
