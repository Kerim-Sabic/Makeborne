/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks: every placed slide image is shown (HTML, PDF and PPTX) or refused before it is paid for. */
const fs = require("node:fs"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const JSZip = require("jszip"), sharp = require("sharp");
const { DocumentSourceSchema, SLIDE_LAYOUTS } = require("./schema.ts");
const { composeSlide, W, H } = require("./slide-scene.ts");
const { DocumentEditor, DocToolError, emptyDocument } = require("./editor.ts");
const { DIRECTIONS, DIRECTION_SPECS } = require("./directions.ts");
const { imageSupport, scrimOpacity, zoneBrightness, RAIL_W, RAIL_WIDE, BAND_H, BAND_CHART_H, SCRIM_TOP } = require("./compose-image.ts");
const { numeralMark, BADGE_RATIO, BADGE_MIN, BADGE_MAX, FIGURE_RATIO } = require("./design.ts");
const { POINT_ROWS_STACKED, CALLOUT_VALUE, CALLOUT_CAPTION_MIN, CHART_TEXT_UP, BAND_CHART_MIN } = require("./compose-content.ts");
const { CLOSING_STEPS_STACKED } = require("./compose-title.ts");
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
      // A chart's band is thinner (its headline, plot and callout need the height); tables and diagrams keep 200 px.
      const img = imageOf(scene, "band-art"), band = layout === "chart" ? BAND_CHART_H : BAND_H;
      assert.deepEqual([img.y, img.w, img.h], [0, W, band]);
      assert.ok(scene.prims.filter(prim => prim !== img).every(prim => (prim.k === "line" ? Math.min(prim.y1, prim.y2) : prim.y) >= band), `${layout} content overlaps the band`);
      // Under the band a chart keeps BAND_CHART_MIN of height, or the slide takes the side rail instead.
      if (layout === "chart") assert.ok(scene.prims.some(prim => prim.k === "chart" && prim.h >= BAND_CHART_MIN));
    }
  });
  await check("image-led lists and charts: badge or figure numerals at heading scale, larger item type that steps down to its minimum, a larger band chart", async () => {
    const harbour = (direction, slides) => base(direction, slides, [asset("rail", "portrait"), asset("band")]);
    const points = [{ title: "Later workdays", text: "The last sailing now leaves before most harbour offices close" }, { title: "Quiet decks", text: "Evening riders asked for calm seating and room for bikes" }, { title: "One extra crew", text: "Two night sailings need a single additional crew" }];
    const flat = value => value.replace(/\s+/g, " ");
    const isItemTitle = (prim, items) => prim.k === "text" && prim.role !== "title" && items.some(item => item.title === flat(prim.text));
    const behind = (scene, prim) => [...scene.prims].reverse().find(shape => (shape.k === "ellipse" || shape.k === "rect") && shape.fill && shape.opacity === undefined && prim.x >= shape.x - 0.5 && prim.y >= shape.y - 0.5 && prim.x + prim.w <= shape.x + shape.w + 0.5 && prim.y + prim.h <= shape.y + shape.h + 0.5);
    let stepped = 0;
    for (const direction of DIRECTIONS) {
      const deck = harbour(direction, [
        { id: "why", layout: "points", notes: "n", image: "rail", imagePlacement: "side", variant: "points-rows", title: "Why evening sailings work", points },
        { id: "close", layout: "closing", notes: "n", image: "rail", title: "Approve a 12-week evening pilot", body: "Harbour Light Ferries, Operations", points: [{ title: "Approve the pilot", text: "Board, at the next meeting" }, { title: "Train one crew", text: "Operations, within four weeks" }, { title: "Open bookings", text: "Marketing, two weeks before launch" }] },
      ]);
      for (const [index, slide] of deck.slides.entries()) {
        const scene = composeSlide(deck, slide, index, 2), items = slide.points;
        assert.deepEqual(scene.issues, [], `${direction} ${slide.id}`);
        const titles = scene.prims.filter(prim => isItemTitle(prim, items)), size = titles[0].size;
        assert.equal(titles.length, items.length, `${direction} ${slide.id}: one title per item`);
        // Items are set alike, never below the last step; in the editorial harbour deck these short items take one of the
        // largest steps (A2 set 28/21 for the points and 22/18 for the steps beside the rail).
        const steps = slide.id === "why" ? POINT_ROWS_STACKED : CLOSING_STEPS_STACKED, [floorTitle, floorBody] = steps.at(-1);
        const supporting = scene.prims.filter(prim => prim.k === "text" && items.some(item => item.text === flat(prim.text)));
        assert.ok(titles.every(prim => prim.size === size) && size >= Math.floor(floorTitle * 0.9), `${direction} ${slide.id}: item titles ${titles.map(prim => prim.size)}`);
        assert.ok(supporting.length === items.length && supporting.every(prim => prim.size === supporting[0].size && prim.size >= floorBody), `${direction} ${slide.id}: supporting text ${supporting.map(prim => prim.size)}`);
        if (direction === "editorial") assert.ok(size >= (slide.id === "why" ? 32 : 36) && supporting[0].size >= 23, `editorial ${slide.id}: ${size}/${supporting[0].size}`);
        // Balanced explicit breaks (the same in HTML and PPTX): a broken line is never a lone short word, nor the last line a stub.
        for (const prim of supporting) {
          const lines = prim.text.split("\n");
          assert.ok(lines.length === 1 || (lines.every(line => line.includes(" ") || line.length > 3) && lines.at(-1).length >= lines[0].length * 0.4), `${direction}: ${JSON.stringify(prim.text)}`);
        }
        const numerals = scene.prims.filter(prim => prim.k === "text" && /^(0?[1-3]|I{1,3})$/.test(prim.text) && prim.x < titles[0].x);
        assert.equal(numerals.length, items.length, `${direction} ${slide.id}: one numeral per item`);
        const mark = slide.id === "close" ? "figure" : numeralMark({ dir: DIRECTION_SPECS[direction] });
        for (const prim of numerals) {
          const shape = behind(scene, prim);
          if (mark === "figure") {
            assert.ok(!shape && prim.size >= Math.round(size * FIGURE_RATIO) - 1, `${direction} ${slide.id}: figure ${prim.size}px for ${size}px titles`);
            assert.ok(contrast(prim.color, scene.background) >= 4.5, `${direction} ${slide.id}: figure ${prim.color} on ${scene.background}`);
          } else {
            // The badge is a native shape carrying a live numeral; badge on slide and numeral on badge both read at 4.5:1.
            assert.ok(shape && shape.k === (mark === "circle" ? "ellipse" : "rect"), `${direction} ${slide.id}: ${mark} badge behind "${prim.text}"`);
            assert.equal(shape.w, Math.max(BADGE_MIN, Math.min(BADGE_MAX, Math.round(size * BADGE_RATIO))), `${direction}: badge size`);
            assert.ok(contrast(prim.color, shape.fill) >= 4.5 && contrast(shape.fill, scene.background) >= 4.5, `${direction}: ${prim.color} on ${shape.fill} on ${scene.background}`);
          }
        }
      }
      // Long items step down together, never below the last step.
      const long = harbour(direction, [{ id: "long", layout: "points", notes: "n", image: "rail", imagePlacement: "side", variant: "points-rows", title: "Why evening sailings work",
        points: points.concat(points).slice(0, 4).map((point, i) => ({ title: `${point.title} and more ${i}`, text: `${point.text} each week` })) }]);
      const scene = composeSlide(long, long.slides[0], 0, 1);
      if (!scene.issues.length) {
        stepped++;
        const sizes = scene.prims.filter(prim => prim.k === "text" && prim.role !== "title" && / and more \d$/.test(flat(prim.text))).map(prim => prim.size);
        assert.ok(sizes.length === 4 && new Set(sizes).size === 1 && sizes[0] < POINT_ROWS_STACKED[0][0] && sizes[0] >= Math.floor(POINT_ROWS_STACKED.at(-1)[0] * 0.9), `${direction}: long item titles ${sizes}`);
      }
    }
    assert.ok(stepped >= DIRECTIONS.length / 2, `long items fit beside the rail in ${stepped} directions`);
    // The band chart: a larger headline, statistic and caption, a taller native chart with larger labels (HTML and PPTX), the same data.
    const chartDeck = harbour("editorial", [{ id: "demand", layout: "chart", notes: "n", image: "band", title: "Evening demand rises through the summer", body: "August peaks at twice the evening demand of May.",
      chart: { type: "column", categories: ["May", "Jun", "Jul", "Aug", "Sep"], series: [{ name: "Evening riders per day", values: [180, 240, 320, 360, 290] }], highlight: 3, source: "Illustrative data" } }]);
    const scene = composeSlide(chartDeck, chartDeck.slides[0], 0, 1);
    assert.equal(scene.composition, "chart-annotated");
    assert.deepEqual(scene.issues, []);
    const title = scene.prims.find(prim => prim.k === "text" && prim.role === "title"), chart = scene.prims.find(prim => prim.k === "chart");
    const value = scene.prims.find(prim => prim.k === "text" && prim.text === "360"), caption = scene.prims.find(prim => prim.k === "text" && /August peaks/.test(prim.text));
    assert.ok(title.size >= 60, `chart headline ${title.size}px (58 before)`);
    assert.ok(chart.h >= 270 && chart.w >= 680 && chart.style.text === CHART_TEXT_UP, `chart ${chart.w}x${chart.h}, labels x${chart.style.text}`);
    assert.ok(value.size >= CALLOUT_VALUE * 0.9 && caption.size >= 32 && caption.size >= CALLOUT_CAPTION_MIN, `callout ${value.size}px, caption ${caption.size}px`);
    assert.ok(caption.x >= chart.x + chart.w && value.x >= chart.x + chart.w, "the callout sits beside the chart");
    // The statistic reads at 4.5:1 even where the theme's accent only reaches the 3:1 of large type.
    const light = DocumentSourceSchema.parse({ ...chartDeck, theme: { ...chartDeck.theme, palette: { ...palette, accent: "#C4553A", background: "#F4EEE6" } } });
    const lightValue = composeSlide(light, light.slides[0], 0, 1).prims.find(prim => prim.k === "text" && prim.text === "360");
    assert.ok(contrast("#C4553A", "#F4EEE6") < 4.5 && contrast(lightValue.color, "#F4EEE6") >= 4.5, `statistic ${lightValue.color}`);
    const { chartSvg } = require("./chart-svg.ts");
    const svg = chartSvg(chart.chart, chart.w, chart.h, chart.colors, { heading: "Fraunces", body: "Inter" }, chart.style);
    const sizes = [...svg.matchAll(/font-size="([\d.]+)"/g)].map(match => Number(match[1]));
    assert.ok(Math.min(...sizes) >= 18, `chart labels from ${Math.min(...sizes)}px`);
    const zip = await JSZip.loadAsync(await deckPptx(chartDeck, {}));
    const xml = await zip.file(Object.keys(zip.files).find(name => /^ppt\/charts\/chart\d+\.xml$/.test(name))).async("string");
    assert.deepEqual([...xml.matchAll(/<c:v>(\d+)<\/c:v>/g)].map(match => Number(match[1])), [180, 240, 320, 360, 290], "native chart, same data");
    assert.ok([...xml.matchAll(/<a:defRPr[^>]* sz="(\d+)"/g)].filter(match => match[1] === "1400").length >= 2, "category and value labels at 14 pt in the PPTX");
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
