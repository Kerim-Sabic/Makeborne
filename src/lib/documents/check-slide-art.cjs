/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for full-image slides (text gate, unique plan, exports) and the book image plan. Providers are fakes: no network, no paid calls. */
const fs = require("node:fs"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const JSZip = require("jszip"), sharp = require("sharp");
const { DocumentEditor, emptyDocument, unescapeLiterals } = require("./editor.ts");
const { composeSlide, H } = require("./slide-scene.ts");
const { ART_COMPOSITION, ART_SAFE_MARGIN_PCT, artAlt, artFontsFor, artScene, plateRange, plateScrim, artPlaceholders, artPlanIssues, artPrompt, artTextIssues, compareSlideText, slideClaimIssues, slideText, textKey, verifiedArt } = require("./slide-art.ts");
const { deckModeFromBrief, bookImagePlanFromBrief } = require("./creation-options.ts");
const { bookImageIssues, bookImagePlanText, plannedBookImages } = require("./book-images.ts");
const { fitArtwork, ARTWORK_IMAGE_LIMIT, ARTWORK_TOTAL_LIMIT } = require("./artwork-fit.ts");
const { deckPptx } = require("./pptx.ts");
const { deckHtml } = require("./render-deck.ts");
const { runDocumentBuilder, CHECK_ATTEMPTS } = require("../builder/docs-agent.ts");
const { RunSpend, memoryGate } = require("../ai/run-spend.ts");
const { imageCallBoundMicrousd } = require("../ai/prices.ts");
const { ContextMeter, IMAGE_TOKENS_UNKNOWN } = require("../ai/anthropic-call.ts");
const { contrast, mix } = require("./theme.ts");
const { briefWithAnswers, standardQuestion } = require("../builder/brief-questions.ts");
const { ART_IMAGE_SHARE, BUILDER_EFFORT, deckArtImageMax, deckArtSlidesFor } = require("../builder/pricing.ts");

let count = 0;
async function check(name, fn) { await fn(); count++; console.log(`PASS ${name}`); }
const palette = { background: "#F6F3EE", surface: "#E9E3D8", ink: "#14181F", muted: "#4E5663", accent: "#A9471F", accent2: "#2E5E73", dark: "#121A24" };
const THEME = { palette, fonts: "fraunces", direction: "editorial", mood: "Calm, civic", imageStyle: "Editorial documentary photography at blue hour" };
const SYSTEM = "A twelve-column grid with wide margins; titles in a high-contrast editorial serif in sentence case, body in a neutral grotesk; warm off-white and deep navy grounds, burnt orange only for emphasis; blue-hour documentary photography; a thin orange rule recurs under every title.";
const SLIDES = [
  { id: "cover", layout: "cover", tone: "dark", title: "Night crossings for Harbour Light", subtitle: "An evening ferry pilot", art: { frame: "full-bleed", brief: "The ferry crosses the bay in the lower third; the title sits large on the calm sky, upper left." }, notes: "Fictional client." },
  { id: "why", layout: "statement", title: "Evening riders want calm crossings", body: "Two late sailings and one extra crew.", art: { frame: "type-poster", brief: "Huge serif type fills the left two thirds; a narrow photo strip of the deck at dusk on the right." }, notes: "From the rider survey." },
  { id: "demand", layout: "chart", title: "Demand doubles by August", chart: { type: "column", categories: ["May", "Jun", "Jul", "Aug"], series: [{ name: "Riders", values: [180, 240, 320, 360] }], highlight: 3, source: "Illustrative data" }, art: { frame: "chart-feature", brief: "A clean column chart on the left two thirds with the takeaway in the right column." }, notes: "Illustrative figures." },
];
const toolUse = (name, input) => ({ type: "tool_use", id: `tu_${Math.random().toString(36).slice(2, 10)}`, name, input });
const transcriptOf = slide => slideText(slide).map(line => line.text).join(" ");
const misspell = slide => transcriptOf(slide).replace(/e/, "ee");

/** Scripted model: each stream() returns the next step; a step may be a function of the request (to read tool results). */
function fakeAnthropic(steps) {
  const log = { streams: [] };
  return { log, client: { beta: { messages: {
    async countTokens() { return { input_tokens: 5000 }; },
    stream(params) {
      log.streams.push({ toolNames: (params.tools ?? []).map(tool => tool.name), messages: structuredClone(params.messages), system: params.system });
      let step = steps.shift();
      if (!step) throw new Error("Mock script exhausted: unexpected provider call.");
      if (typeof step === "function") step = step(params);
      const stream = { currentMessage: undefined, on() { return stream; },
        async finalMessage() { const message = { model: params.model, usage: { input_tokens: 5000, output_tokens: 400 }, content: step, stop_reason: "tool_use" }; stream.currentMessage = message; return message; } };
      return stream;
    },
  } } } };
}
async function canvas(label, width = 1536, height = 1024) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#121A24"/><text x="80" y="${height / 2}" font-size="64" fill="#F6F3EE" font-family="Arial">${label}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
function fakeImages() {
  const log = { prompts: [] };
  return { log, client: { images: { async generate(body) {
    log.prompts.push(body.prompt);
    const bytes = await canvas(`render ${log.prompts.length}`, ...body.size.split("x").map(Number));
    return { data: [{ b64_json: bytes.toString("base64") }], usage: { input_tokens: 900, output_tokens: 343, input_tokens_details: { text_tokens: 900, image_tokens: 0 } } };
  } } } };
}
let stored = 0;
const storeImage = async request => ({ id: `00000000-0000-4000-8000-${String(++stored).padStart(12, "0")}`, path: `public/images/${request.name}.webp`, sha256: "a".repeat(64), bytes: 9, mediaType: "image/webp", url: `/images/${request.name}.webp` });
const spendFor = (credits = 90) => new RunSpend({ run: `slide-art-${Math.random()}`, providerCapMicrousd: Math.floor(credits * 0.03 * 1e6), customerCapMicrousd: null, gate: memoryGate(), deadline: Date.now() + 280_000 });
const run = (editor, anthropic, images, extra = {}) => runDocumentBuilder({ client: null, scope: { workspaceId: "w", projectId: "p" }, editor, effort: "high", spend: spendFor(), request: "Make the Harbour Light deck: an evening ferry pilot with two late sailings and one extra crew; evening riders want calm crossings and demand doubles by August (use illustrative monthly figures).", context: "", attachments: [],
  emit: () => {}, signal: new AbortController().signal, deadline: Date.now() + 280_000, anthropic: anthropic.client, imageClient: images.client, storeImage, imageModels: ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare"], ...extra });
const imagesIn = stream => stream.messages.at(-1).content.flatMap(block => Array.isArray(block.content) ? block.content : []).filter(block => block.type === "image");

(async () => {
  await check("a new deck is full-image by default; editable text slides only when chosen or explicitly asked for", () => {
    assert.equal(deckModeFromBrief("A pitch deck for our ferry pilot").mode, "image");
    assert.equal(deckModeFromBrief("Keep native text, shapes and chart editable in PowerPoint.").mode, "live");
    assert.equal(deckModeFromBrief("Make it editable in PowerPoint\n\nThe client's answers to Makeborne's questions (follow them):\n- Slide style: Full-image slides (Each slide designed as one generated image, text included (default))").mode, "image", "the chosen answer wins over the brief's wording");
    const slides = standardQuestion("presentation", "slides");
    assert.equal(deckModeFromBrief(briefWithAnswers("A sales deck", [slides], { slides: { option: "live" } })).mode, "live");
    assert.equal(deckModeFromBrief(briefWithAnswers("A sales deck", [slides], { slides: { option: "auto" } })).mode, "image");
    assert.deepEqual(emptyDocument("deck", "Pitch", undefined, { slideMode: "image" }).art, { mode: "image", system: "", renders: [] });
    assert.equal(emptyDocument("deck", "Pitch").art, undefined, "a deck without the option (saved before it) keeps editable slides");
    const runSource = fs.readFileSync(require.resolve("../builder/docs-run.ts"), "utf8");
    assert.match(runSource, /slideMode: deckModeFromBrief\(options\)\.mode/, "new decks take their mode from the brief and answers");
  });

  await check("full-image decks: no slide limit from the image heuristic; images may use 70% of the unchanged allowance", () => {
    assert.equal(deckArtImageMax(10), 17);
    assert.equal(ART_IMAGE_SHARE, 0.7);
    assert.equal(deckArtSlidesFor(1.5), 42, "a medium run ($1.50) expects about 42 renders at $0.025 within its 70% share");
    assert.deepEqual(Object.fromEntries(Object.entries(BUILDER_EFFORT).map(([level, policy]) => [level, policy.ceilingCredits])), { light: 20, medium: 50, high: 90, super_high: 140, ultra: 240 }, "credit ceilings unchanged");
    const agent = fs.readFileSync(require.resolve("../builder/docs-agent.ts"), "utf8");
    assert.doesNotMatch(agent, /plan at most/, "the designer is never told to plan fewer slides");
    assert.match(agent, /there is no slide limit/);
    assert.match(agent, /Math\.floor\(spend\.allowanceMicrousd \/ imageBound \/ 3\)/, "books and editable decks keep a third");
  });

  await check("the text gate compares words as read back, ignoring case, quotes and punctuation, never misspellings or numbers", () => {
    const expected = ["Night crossings for Harbour Light", "May", "180", "“Calm decks”", "— Rider survey"];
    assert.ok(compareSlideText(expected, "NIGHT CROSSINGS FOR HARBOUR LIGHT. May 180 \"Calm decks\" - Rider survey").ok);
    assert.deepEqual(compareSlideText(expected, "Night crosings for Harbour Light May 180 Calm decks Rider survey").missing, ["crossings"]);
    assert.deepEqual(compareSlideText(expected, "Night crossings for Harbour Light May 18O Calm decks Rider survey").extra, ["18o"]);
    assert.deepEqual(compareSlideText(expected, "Night crossings for Harbour Light May 180 Calm decks Rider survey Lorem").extra, ["lorem"]);
    assert.ok(!compareSlideText(["€38M", "61%"], "€38 M 61%").ok, "a broken figure fails");
    assert.ok(compareSlideText(["Join in store", "Book check-ups"], "1 Join in store 02 Book check-ups", { numerals: 2 }).ok, "step numerals on an ordered slide are design");
    assert.deepEqual(compareSlideText(["Join in store", "Book check-ups"], "1 Join in store 2 Book check-ups 3", { numerals: 2 }).extra, ["3"], "but only 1..N, once each");
    assert.deepEqual(compareSlideText(["May", "180"], "1 May 180").extra, ["1"], "never on a chart");
  });

  await check("each slide has a unique composition plan: consecutive layouts and frames are flagged, too much text is refused", () => {
    const editor = new DocumentEditor(emptyDocument("deck", "Harbour Light", undefined, { slideMode: "image" }));
    editor.apply("set_theme", THEME);
    for (const slide of SLIDES) editor.apply("write_slide", { slide });
    assert.deepEqual(artPlanIssues(editor.doc), []);
    const repeat = editor.apply("write_slide", { slide: { ...SLIDES[2], id: "again", art: { ...SLIDES[2].art } } });
    assert.match(repeat, /both use the chart layout/);
    assert.ok(artPlanIssues(editor.doc).some(issue => /chart-feature frame/.test(issue.message)));
    const wordy = { ...SLIDES[1], body: "word ".repeat(40).trim() };
    assert.ok(artTextIssues(wordy).some(issue => /words besides the title/.test(issue)));
    assert.ok(artTextIssues({ ...SLIDES[1], title: "one two three four five six seven eight nine ten eleven" }).some(issue => /title has 11 words/.test(issue)));
    const prompt = artPrompt({ ...editor.doc, art: { mode: "image", system: SYSTEM, renders: [] } }, editor.doc.slides[2]);
    for (const part of [SYSTEM, "Demand doubles by August", '"360"', "chart-feature", "16:9", "Avoid the AI look", "no other words"]) assert.ok(prompt.includes(part), part);
  });

  // ---- The gate end to end, with fakes: pass; misspelling -> regenerate -> pass; misspelling twice -> live-text fallback ----
  const editor = new DocumentEditor(emptyDocument("deck", "Harbour Light", undefined, { slideMode: "image" }));
  const images = fakeImages();
  const anthropic = fakeAnthropic([
    [toolUse("set_theme", THEME), toolUse("set_deck_details", { title: "Night crossings for Harbour Light", art_system: SYSTEM }), ...SLIDES.map(slide => toolUse("write_slide", { slide }))],
    [toolUse("render_slides", { ids: SLIDES.map(slide => slide.id) })],
    [toolUse("check_slide", { id: "cover", transcript: transcriptOf(SLIDES[0]), artifacts: [], verdict: "pass" }),
      toolUse("check_slide", { id: "why", transcript: misspell(SLIDES[1]), artifacts: [], verdict: "pass" }),
      toolUse("check_slide", { id: "demand", transcript: transcriptOf(SLIDES[2]), artifacts: ["the 240 column is drawn taller than 320"], verdict: "fail", fix: "Draw the columns in exact proportion." })],
    [toolUse("check_slide", { id: "why", transcript: transcriptOf(SLIDES[1]), artifacts: [], verdict: "pass" }),
      toolUse("check_slide", { id: "demand", transcript: misspell(SLIDES[2]), artifacts: [], verdict: "fail" })],
    [toolUse("check_image", { name: "plate-demand", artifacts: [], verdict: "pass" }), toolUse("finish", { summary: "Three slides." })],
    [toolUse("finish", { summary: "Three slides: two full images, one editable fallback." })],
  ]);
  const result = await run(editor, anthropic, images);

  await check("text gate: a correct render passes; a misspelling is regenerated once and passes; a second failure falls back to live text", () => {
    assert.equal(result.finished, true);
    assert.deepEqual(result.checks.map(entry => `${entry.id}:${entry.attempt}:${entry.outcome}`).sort(), ["cover:1:passed", "demand:1:retry", "demand:2:fallback", "plate-demand:1:passed", "why:1:retry", "why:2:passed"]);
    assert.ok(result.checks.find(entry => entry.id === "why" && entry.outcome === "retry").problems.some(problem => /missing or misspelled/.test(problem)), "the programmatic comparison catches a misspelling the model called a pass");
    const renders = Object.fromEntries(editor.doc.art.renders.map(entry => [entry.slide, entry]));
    assert.deepEqual([renders.cover.outcome, renders.cover.attempts, renders.why.outcome, renders.why.attempts, renders.demand.outcome, renders.demand.attempts], ["passed", 1, "passed", 2, "fallback", 2]);
    assert.equal(images.log.prompts.length, 6, "three first attempts, two regenerations and one plate for the fallback slide, no more");
    assert.match(images.log.prompts[5], /text-free background plate[\s\S]*RESERVED AREA: from \d+% to \d+% across[\s\S]*Absolutely no text/, "the plate reserves the live text's area");
    assert.ok(images.log.prompts[3].includes("CORRECTION") || images.log.prompts[4].includes("CORRECTION"));
    assert.ok(images.log.prompts.slice(3).some(prompt => /missing or misspelled/.test(prompt)), "the corrected prompt names the misspelling");
    assert.ok(images.log.prompts.slice(3).some(prompt => /exact proportion/.test(prompt)), "the model's fix reaches the corrected prompt");
    assert.equal(CHECK_ATTEMPTS, 2);
  });

  await check("renders come back to the model as image blocks in the tool result; the art tools are offered only in full-image mode", () => {
    assert.ok(anthropic.log.streams[0].toolNames.includes("render_slides") && anthropic.log.streams[0].toolNames.includes("check_slide"));
    assert.match(anthropic.log.streams[0].system[0].text, /FULL-IMAGE SLIDES/);
    assert.equal(imagesIn(anthropic.log.streams[2]).length, 3, "three renders to check");
    assert.equal(imagesIn(anthropic.log.streams[3]).length, 2, "two regenerations to check");
    const block = imagesIn(anthropic.log.streams[2])[0];
    assert.equal(block.source.media_type, "image/jpeg");
  });

  await check("a verified slide is drawn as its full image; a fallback and an edited slide use the editable layout", () => {
    const deck = editor.doc;
    assert.equal(composeSlide(deck, deck.slides[0], 0, 3).composition, ART_COMPOSITION);
    assert.equal(composeSlide(deck, deck.slides[1], 1, 3).composition, ART_COMPOSITION);
    assert.notEqual(composeSlide(deck, deck.slides[2], 2, 3).composition, ART_COMPOSITION, "fallback: live text");
    const plated = composeSlide(deck, deck.slides[2], 2, 3);
    assert.equal(deck.art.renders.find(entry => entry.slide === "demand").plate, "plate-demand", "the checked plate is recorded");
    assert.match(plated.composition, /^plate-/);
    assert.deepEqual([plated.prims[0].k, plated.prims[0].name, plated.prims[0].w], ["image", "plate-demand", 1280], "the plate is full-bleed behind the live layout");
    assert.equal(deck.art.fonts, "newsreader", "the art system's 'high-contrast editorial serif' maps to the bundled Newsreader pairing");
    assert.equal(deck.theme.fonts, "newsreader", "and every editable slide uses it");
    assert.ok(composeSlide(deck, deck.slides[2], 2, 3).prims.some(prim => prim.k === "text" && prim.text.replace(/\n/g, " ").includes("Demand doubles")));
    const copy = new DocumentEditor(deck);
    copy.apply("write_slide", { slide: { ...SLIDES[1], title: "Evening riders want quiet crossings" } });
    assert.equal(verifiedArt(copy.doc, copy.doc.slides[1]), null, "changed words: the render no longer shows");
    assert.ok(!copy.doc.art.renders.some(entry => entry.slide === "why"), "and its stale record is dropped");
    assert.equal(verifiedArt({ ...deck, art: { ...deck.art, mode: "live" } }, deck.slides[0]), null, "editable mode never shows renders");
    assert.notEqual(textKey(SLIDES[1]), textKey({ ...SLIDES[1], body: "Two late sailings and one extra crew!" }));
  });

  await check("PDF/HTML show the slide image full-bleed; PPTX carries it with alt text, notes and an off-slide title placeholder", async () => {
    const deck = editor.doc, bytes = await canvas("slide", 1536, 864);
    const html = deckHtml(deck, { "art-cover": "data:image/png;base64,AAAA", "art-why": "data:image/png;base64,AAAA" }, "print");
    assert.ok(html.includes(`alt="${artAlt(deck.slides[0]).replace(/"/g, "&quot;")}"`));
    assert.ok(html.includes("left:0.0000%;top:0.0000%;width:100.0000%;height:100.0000%"));
    const pptx = await deckPptx(deck, { "art-cover": bytes, "art-why": bytes, "plate-demand": bytes });
    const zip = await JSZip.loadAsync(pptx);
    const slide1 = await zip.file("ppt/slides/slide1.xml").async("string");
    assert.match(slide1, /<p:pic>/);
    assert.ok(slide1.includes(`descr="${artAlt(deck.slides[0]).slice(0, 30)}`), "alt text is the slide's words");
    assert.match(slide1, /<p:ph type="title"\/>/, "the title is a title placeholder");
    const offY = Number(/<p:sp>[\s\S]*?<a:off x="\d+" y="(\d+)"/.exec(slide1)[1]);
    assert.ok(offY > (H / 96) * 914400, "placed below the slide: not shown or printed");
    const notes = await Promise.all(Object.keys(zip.files).filter(name => /notesSlide\d+\.xml$/.test(name)).map(name => zip.file(name).async("string")));
    assert.ok(notes.some(xml => xml.includes("Slide text: Night crossings for Harbour Light")), "speaker notes start with the slide's exact words");
    const slide3 = await zip.file("ppt/slides/slide3.xml").async("string");
    assert.ok(!/<p:pic>[\s\S]*Image art-demand/.test(slide3) && slide3.includes("Demand doubles"), "the fallback slide is native editable text");
    assert.match(slide3, /name="Image plate-demand"/, "over its plate as a picture");
  });

  await check("render_slides refuses consecutive repeats and wordy slides before any image is paid for", async () => {
    const local = new DocumentEditor(emptyDocument("deck", "Harbour Light", undefined, { slideMode: "image" }));
    const pictures = fakeImages();
    const fake = fakeAnthropic([
      [toolUse("set_theme", THEME), toolUse("set_deck_details", { title: "Harbour Light", art_system: SYSTEM }), toolUse("write_slide", { slide: SLIDES[1] }),
        toolUse("write_slide", { slide: { ...SLIDES[1], id: "twin", title: "Quiet decks win riders back" } }), toolUse("write_slide", { slide: { ...SLIDES[2], body: "word ".repeat(40).trim() } })],
      [toolUse("render_slides", { ids: ["why", "twin", "demand"] })],
      [toolUse("finish", { summary: "x" })], [toolUse("finish", { summary: "x" })],
    ]);
    await run(local, fake, pictures);
    assert.equal(pictures.log.prompts.filter(prompt => !/background plate/.test(prompt)).length, 0, "no slide render was paid for");
    const reply = JSON.stringify(fake.log.streams[2].messages.at(-1));
    assert.match(reply, /never repeat a layout on consecutive slides/);
    assert.match(reply, /too much text for one image/);
  });

  await check("casing: short lines must keep their capitalisation (capitals or a capital first letter allowed); long text stays case-insensitive", () => {
    assert.deepEqual(compareSlideText(["How it works", "Three steps from sign-up to riding"], "How iT works Three steps from sign-up to riding").casing, ['"iT" for "it"'], "the live d01 eyebrow");
    assert.ok(compareSlideText(["How it works"], "HOW IT WORKS").ok && compareSlideText(["How it works"], "How It Works").ok);
    assert.ok(compareSlideText(["Three steps from sign-up to riding"], "THREE STEPS FROM SIGN-UP TO RIDING").ok, "long lines ignore case");
  });

  const D02 = JSON.parse(fs.readFileSync(require.resolve("../../../scripts/eval/briefs/d02-tidewater-seed-pitch.json"), "utf8")).brief;
  const ASK = { id: "ask", layout: "diagram", eyebrow: "The ask", title: "€1.2M takes Tidewater to 500 homes", diagram: { kind: "timeline", items: [{ label: "2025", detail: "40-home pilot, Split" }, { label: "Seed", detail: "€1.2M raised" }, { label: "End of 2027", detail: "500 homes" }] },
    art: { frame: "timeline", brief: "A thin terracotta line crosses the slide with three dated stops; a coastline photo in the lower third." }, notes: "The ask." };
  await check("claims: every figure and status on a slide traces to the brief (the live d02 '€1.2M raised' case)", async () => {
    assert.ok(slideClaimIssues(ASK, D02).some(issue => /"raised" states something the brief does not \(it says "raising"\)/.test(issue)));
    assert.deepEqual(slideClaimIssues({ ...ASK, diagram: { ...ASK.diagram, items: [ASK.diagram.items[0], { label: "Seed", detail: "Raising €1.2M now" }, ASK.diagram.items[2]] } }, D02), [], "the brief's own status passes");
    const invented = slideClaimIssues({ ...ASK, title: "€2M takes Tidewater to 900 homes" }, D02).join(" ");
    assert.ok(/has 2,000,000/.test(invented) && /has 900/.test(invented), "figures that are not in the brief fail");
    assert.deepEqual(slideClaimIssues({ id: "team", layout: "stats", title: "Six builders, two from the EV industry", stats: [{ value: "6", label: "Team members" }, { value: "2", label: "EV battery engineers" }], notes: "x" }, D02), [], "number words in the brief count");
    assert.deepEqual(slideClaimIssues({ id: "c", layout: "chart", title: "Visits grow each quarter", chart: { type: "column", categories: ["Q1", "Q2"], series: [{ name: "Visits", values: [12, 18] }], source: "Illustrative data" }, notes: "x" }, "A deck."), [], "labelled illustrative figures and Q1 labels pass");
    // End to end: refused before any image is paid for; refused again unchanged, the slide stays editable text.
    const local = new DocumentEditor(emptyDocument("deck", "Tidewater", undefined, { slideMode: "image" }));
    const pictures = fakeImages();
    const fake = fakeAnthropic([
      [toolUse("set_theme", THEME), toolUse("set_deck_details", { title: "Tidewater", art_system: SYSTEM }), toolUse("write_slide", { slide: ASK })],
      [toolUse("render_slides", { ids: ["ask"] })], [toolUse("render_slides", { ids: ["ask"] })],
      [toolUse("finish", { summary: "x" })], [toolUse("finish", { summary: "x" })],
    ]);
    await run(local, fake, pictures, { request: D02 });
    assert.equal(pictures.log.prompts.filter(prompt => !/background plate/.test(prompt)).length, 0, "no slide render for a slide with an unsupported claim");
    assert.match(JSON.stringify(fake.log.streams[2].messages.at(-1)), /was not rendered: .*raised/);
    const render = local.doc.art.renders.find(entry => entry.slide === "ask");
    assert.equal(render.outcome, "fallback");
    assert.ok(render.problems.some(problem => /claim: "raised"/.test(problem)));
    assert.match(JSON.stringify(fake.log.streams[4].messages.at(-1)), /Slide 1 \(ask\): \\"raised\\" states something/, "the first finish names the claim on the editable slide too");
  });

  await check("placeholders are never baked into a slide image: the slide stays editable text so the client can type the value", async () => {
    const team = { id: "team", layout: "stats", eyebrow: "Team", title: "Six builders, two from the EV industry", body: "[Founder names and roles]", stats: [{ value: "6", label: "Team members" }, { value: "2", label: "EV battery engineers" }],
      art: { frame: "big-number", brief: "Two huge terracotta numerals on warm stone; a photo of hands at work on a battery on the left." }, notes: "x" };
    assert.deepEqual(artPlaceholders(team), ['body: "[Founder names and roles]"']);
    assert.ok(artPlaceholders({ ...team, body: undefined, stats: [{ value: "[€ TBD]", label: "Market size" }] }).length);
    assert.ok(artPlaceholders({ ...team, body: "Market size TBD" }).length && !artPlaceholders({ ...team, body: undefined }).length);
    const local = new DocumentEditor(emptyDocument("deck", "Tidewater", undefined, { slideMode: "image" }));
    const pictures = fakeImages();
    const fake = fakeAnthropic([
      [toolUse("set_theme", THEME), toolUse("set_deck_details", { title: "Tidewater", art_system: SYSTEM }), toolUse("write_slide", { slide: team })],
      [toolUse("render_slides", { ids: ["team"] })], [toolUse("finish", { summary: "x" })], [toolUse("finish", { summary: "x" })],
    ]);
    await run(local, fake, pictures, { request: D02 });
    assert.equal(pictures.log.prompts.length, 1, "no slide render; one text-free plate");
    assert.match(pictures.log.prompts[0], /text-free background plate/);
    assert.equal(local.doc.art.renders.find(entry => entry.slide === "team").outcome, "fallback");
    assert.notEqual(composeSlide(local.doc, local.doc.slides[0], 0, 1).composition, ART_COMPOSITION, "drawn as editable text");
    assert.ok(composeSlide(local.doc, local.doc.slides[0], 0, 1).prims.some(prim => prim.k === "text" && prim.text.includes("[Founder names and roles]")), "with the field the client can fill in");
  });

  await check("editable slides of a full-image deck: art-system fonts, text kept at 4.5:1 over the plate, safe margins in the prompt", () => {
    assert.equal(artFontsFor("Condensed DIN-style headlines, a clean sans for body", "editorial"), "archivo");
    assert.equal(artFontsFor("Titles in Fraunces, sentence case; Inter for labels", "editorial"), "fraunces");
    assert.equal(artFontsFor("A characterful ink-trap grotesk for titles", "editorial"), "bricolage");
    assert.equal(artFontsFor("No type notes here", "geist"), "geist", "nothing to map: keep the theme's pairing");
    const calm = { luma: Array(64).fill(246), shade: Array(64).fill(236) }, busy = { luma: Array(64).fill(250), shade: Array(64).fill(40) };
    const box = { x: 100, y: 100, w: 600, h: 120 };
    assert.equal(plateScrim("#14181F", "#F6F3EE", plateRange(calm, box)), 0, "dark text on a calm light field needs no scrim");
    const alpha = plateScrim("#14181F", "#F6F3EE", plateRange(busy, box));
    assert.ok(alpha > 0.5, `a busy area gets a scrim (${alpha})`);
    assert.ok(contrast("#14181F", mix("#282828", "#F6F3EE", alpha)) >= 4.5 && contrast("#14181F", mix("#FAFAFA", "#F6F3EE", alpha)) >= 4.5, "and the text reaches 4.5:1 over its darkest and brightest pixels");
    // A numeral on its badge keeps its badge (live d02 re-run: badges were scrimmed over and the numerals vanished).
    const plateDeck = { ...editor.doc, assets: [...editor.doc.assets, { name: "plate-demand", id: "00000000-0000-4000-8000-000000000099", aspect: "landscape", alt: "", prompt: "", luma: busy.luma, shade: busy.shade }] };
    const live = () => ({ background: "#F6F3EE", issues: [], prims: [
      { k: "ellipse", x: 100, y: 300, w: 40, h: 40, fill: "#A9471F" },
      { k: "text", x: 105, y: 305, w: 30, h: 30, text: "1", font: "body", size: 20, weight: 600, color: "#FFFFFF", align: "center", valign: "middle", lh: 1 },
      { k: "text", x: 160, y: 300, w: 500, h: 40, text: "Market size", font: "heading", size: 30, weight: 600, color: "#14181F", align: "left", valign: "top", lh: 1.1 }] });
    const scene = artScene(plateDeck, plateDeck.slides[2], live);
    assert.equal(scene.prims[0].name, "plate-demand");
    const scrims = scene.prims.filter(prim => prim.k === "rect");
    assert.equal(scrims.length, 1, "one scrim: behind the heading on the busy plate, none over the badge");
    assert.ok(scrims[0].x >= 140 && scene.prims.indexOf(scrims[0]) === scene.prims.findIndex(prim => prim.k === "text" && prim.text === "Market size") - 1);
    const prompt = artPrompt({ ...editor.doc }, editor.doc.slides[0]);
    assert.match(prompt, /top 14% and bottom 14% of the canvas hold no words at all/);
    assert.match(prompt, /keeps 6\.5% clear above the first line/);
    assert.equal(ART_SAFE_MARGIN_PCT, 6.5);
  });

  // ---- Any deck length (owner, 23 Oct 2026): an 18-slide plan at medium; continuation renders the rest; no credits leaves editable slides ----
  const FRAMES = ["type-poster", "split", "full-bleed", "card-grid", "inset-frame", "collage"];
  const WORDS = ["harbour", "ferry", "evening", "quiet", "crossing", "lantern", "tide", "deck", "pier", "rope", "beacon", "island", "current", "keel", "mast", "sail", "wake", "quay"];
  const longSlides = count => Array.from({ length: count }, (_, i) => i % 2
    ? { id: `s${i + 1}`, layout: "points", title: `Why the ${WORDS[i]} matters`, points: [{ title: "Calm", text: `Riders like the ${WORDS[i]}` }, { title: "Clear", text: "Plans stay simple" }], art: { frame: FRAMES[i % 6], brief: "Type block on the left third; a quiet harbour photograph fills the rest." }, notes: "x" }
    : { id: `s${i + 1}`, layout: "statement", title: `The ${WORDS[i]} sets the tone`, art: { frame: FRAMES[i % 6], brief: "A single large statement set across the upper half over a calm field." }, notes: "x" });
  const checksFor = slides => slides.map(slide => toolUse("check_slide", { id: slide.id, transcript: transcriptOf(slide), artifacts: [], verdict: "pass" }));
  const gateSpend = credits => { const gate = memoryGate(); return { gate, spend: new RunSpend({ run: `long-${Math.random()}`, providerCapMicrousd: Math.floor(credits * 0.03 * 1e6), customerCapMicrousd: null, gate, deadline: Date.now() + 280_000 }) }; };

  await check("an 18-slide full-image deck at medium is planned and rendered in full; every call still reserves its worst case", async () => {
    const slides = longSlides(18), local = new DocumentEditor(emptyDocument("deck", "Harbour Light", undefined, { slideMode: "image" }));
    const pictures = fakeImages(), { gate, spend } = gateSpend(BUILDER_EFFORT.medium.ceilingCredits);
    const fake = fakeAnthropic([
      [toolUse("set_theme", THEME), toolUse("set_deck_details", { title: "Harbour Light", art_system: SYSTEM }), ...slides.map(slide => toolUse("write_slide", { slide }))],
      [toolUse("render_slides", { ids: slides.slice(0, 12).map(slide => slide.id) }), toolUse("render_slides", { ids: slides.slice(12).map(slide => slide.id) })],
      checksFor(slides), [toolUse("finish", { summary: "Eighteen slides." })], [toolUse("finish", { summary: "Eighteen slides." })],
    ]);
    const result = await run(local, fake, pictures, { spend, effort: "medium" });
    assert.doesNotMatch(JSON.stringify(fake.log.streams[0].messages[0]), /plan at most/);
    assert.equal(result.finished, true);
    assert.equal(local.doc.art.renders.filter(entry => entry.outcome === "passed").length, 18, "all 18 slides are full images");
    const openai = gate.log.begin.filter(call => call.provider === "openai").map(call => call.boundMicrousd).sort((a, b) => a - b);
    const expected = pictures.log.prompts.map(prompt => imageCallBoundMicrousd("gpt-image-2.5-sunburst", "medium", "1536x1024", prompt)).sort((a, b) => a - b);
    assert.deepEqual(openai, expected, "each render reserved exactly its worst-case bound before the provider was called");
  });

  await check("a deck larger than one request's credits saves its renders, waits, and a continuation renders the rest; no credits leaves editable slides", async () => {
    const slides = longSlides(8), first = new DocumentEditor(emptyDocument("deck", "Harbour Light", undefined, { slideMode: "image" }));
    const small = gateSpend(10);
    const fake = fakeAnthropic([
      [toolUse("set_theme", THEME), toolUse("set_deck_details", { title: "Harbour Light", art_system: SYSTEM }), ...slides.map(slide => toolUse("write_slide", { slide }))],
      [toolUse("render_slides", { ids: slides.map(slide => slide.id) })],
      params => { const text = JSON.stringify(params.messages.at(-1)); return checksFor(slides.filter(slide => text.includes(`check_slide for \\"${slide.id}\\"`))); },
      [toolUse("finish", { summary: "Done for now." })], [toolUse("finish", { summary: "Done for now." })], [toolUse("finish", { summary: "Done for now." })],
    ]);
    const one = await run(first, fake, fakeImages(), { spend: small.spend, effort: "medium" });
    const waiting = first.doc.art.renders.filter(entry => entry.deferred).map(entry => entry.slide);
    const done = first.doc.art.renders.filter(entry => entry.outcome === "passed").length;
    assert.ok(done >= 1 && waiting.length >= 1 && done + waiting.length === 8, `rendered ${done}, waiting ${waiting.length}`);
    assert.equal(one.finished, false, "saved progress, not a finished deck");
    assert.match(one.summary, new RegExp(`^${done} of 8 slides rendered\\. Continue to render the remaining ${waiting.length} \\(about \\d+ credits\\)`));
    for (const id of waiting) { const index = first.doc.slides.findIndex(slide => slide.id === id); assert.notEqual(composeSlide(first.doc, first.doc.slides[index], index, 8).composition, ART_COMPOSITION, "a waiting slide shows as editable text"); }

    // Not enough credits to continue: the waiting slides stay editable and the deck stays whole.
    const broke = new DocumentEditor(first.doc);
    const none = await run(broke, fakeAnthropic([[toolUse("render_slides", { ids: waiting })], [toolUse("finish", { summary: "x" })], [toolUse("finish", { summary: "x" })], [toolUse("finish", { summary: "x" })]]), fakeImages(), { spend: gateSpend(2).spend, effort: "medium" });
    assert.equal(none.finished, false);
    assert.deepEqual(broke.doc.art.renders.filter(entry => entry.deferred).map(entry => entry.slide).sort(), [...waiting].sort());
    assert.ok(broke.doc.slides.every((slide, index) => composeSlide(broke.doc, slide, index, 8).prims.some(prim => prim.k === "image" || prim.k === "text")), "every slide still draws");

    // The client's Continue (a new stage with its own allowance) renders exactly the waiting slides.
    const second = new DocumentEditor(first.doc), pictures = fakeImages();
    const cont = fakeAnthropic([[toolUse("render_slides", { ids: waiting })], checksFor(slides.filter(slide => waiting.includes(slide.id))), [toolUse("finish", { summary: "All eight." })], [toolUse("finish", { summary: "All eight." })]]);
    const two = await run(second, cont, pictures, { spend: gateSpend(50).spend, effort: "medium" });
    assert.match(JSON.stringify(cont.log.streams[0].messages[0]), new RegExp(`CONTINUATION: ${done} of 8 slides are done`));
    assert.equal(pictures.log.prompts.length, waiting.length, "only the waiting slides are rendered");
    assert.equal(two.finished, true);
    assert.equal(second.doc.art.renders.filter(entry => entry.outcome === "passed").length, 8);
    assert.ok(!second.doc.art.renders.some(entry => entry.deferred));
  });

  await check("the decoder fixes the live b01 caption (c0182ba)", () => {
    const caption = "The real problem behind the request: a small wrapped loaf in a busy caf\\u00e9 display, its label too small and detailed to read.";
    assert.ok(caption.includes("\\u00e9"));
    assert.equal(unescapeLiterals(caption), "The real problem behind the request: a small wrapped loaf in a busy café display, its label too small and detailed to read.");
    const book = new DocumentEditor(emptyDocument("book", "The Useful Client Brief"));
    book.apply("write_chapter", { chapter: { id: "what", title: "What a Brief Is For", text: `A brief.\n\n[[figure:cafe-counter|${caption}]]` } });
    assert.match(book.doc.chapters[0].text, /\[\[figure:cafe-counter\|The real problem behind the request: a small wrapped loaf in a busy café display,/);
  });

  await check("the context meter bounds an image block by its token cost, not its base64 bytes", async () => {
    const meter = new ContextMeter(async () => 1000);
    await meter.bound([{ role: "user", content: "x" }]);
    const big = "A".repeat(400_000);
    const bound = await meter.bound([{ role: "user", content: "x" }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: big } }] }] }]);
    // An unreadable image (no PNG/JPEG/GIF/WebP header) counts at the worst case, never by its base64 bytes.
    assert.ok(bound < 1000 * 1.05 + 512 + IMAGE_TOKENS_UNKNOWN + 16 + 400, `bound ${bound}`);
    assert.ok(bound >= 1000 + IMAGE_TOKENS_UNKNOWN);
  });

  await check("book image plan: the client's choice from the questions, their words, or cover and openers by default", () => {
    const images = standardQuestion("book", "images"), style = standardQuestion("book", "imagestyle");
    const answered = (option, styleOption, custom) => bookImagePlanFromBrief(briefWithAnswers("A field guide to the coast", [images, style], { images: custom ? { custom } : { option }, imagestyle: { option: styleOption } }));
    assert.deepEqual(bookImagePlanFromBrief("A field guide to the coast"), { placement: "openers", style: "auto" }, "default when unanswered");
    assert.deepEqual(answered("none", "auto"), { placement: "none", style: "auto" });
    assert.deepEqual(answered("cover", "photo"), { placement: "cover", style: "photo" });
    assert.deepEqual(answered("openers", "illustration"), { placement: "openers", style: "illustration" });
    assert.deepEqual(answered("every6", "technique"), { placement: "every", everyPages: 6, style: "technique" });
    assert.deepEqual(answered("every3", "photo"), { placement: "every", everyPages: 3, style: "photo" });
    assert.deepEqual(answered("rich", "auto"), { placement: "rich", style: "auto" });
    assert.deepEqual(answered(null, "auto", "One picture every 10 pages"), { placement: "every", everyPages: 10, style: "auto" }, "the client's own N");
    assert.deepEqual(bookImagePlanFromBrief(briefWithAnswers("A herbal", [style], { imagestyle: { custom: "Botanical watercolour" } })), { placement: "openers", style: "technique", technique: "Botanical watercolour" });
    assert.equal(bookImagePlanFromBrief("A memoir with no images of real people").placement, "openers", "'no images of' is not 'no images'");
    assert.equal(bookImagePlanFromBrief("A text-only report, no images").placement, "none");
    assert.deepEqual(emptyDocument("book", "Guide", undefined, { imagePlan: { placement: "every", everyPages: 6, style: "auto" } }).imagePlan, { placement: "every", everyPages: 6, style: "auto" });
    assert.match(fs.readFileSync(require.resolve("../builder/docs-run.ts"), "utf8"), /imagePlan: bookImagePlanFromBrief\(options\)/);
  });

  await check("book image plan: planned counts, plan text for the designer, and adherence", () => {
    const text = "Words ".repeat(230 * 12).trim();
    const book = emptyDocument("book", "Guide", undefined, { imagePlan: { placement: "every", everyPages: 6, style: "photo" } });
    book.chapters = [{ id: "one", title: "One", text }, { id: "two", title: "Two", text, opening: "inline" }];
    assert.deepEqual(plannedBookImages(book), { cover: 1, openers: 1, figures: 4, total: 6, textPages: 24 });
    assert.match(bookImagePlanText(book), /one figure about every 6 pages/);
    assert.ok(bookImageIssues(book).advisory.some(issue => /about 4 figures/.test(issue)));
    assert.deepEqual(plannedBookImages({ ...book, imagePlan: { placement: "rich", style: "auto" } }).figures, 12);
    assert.deepEqual(plannedBookImages({ ...book, imagePlan: undefined }), { cover: 1, openers: 1, figures: 0, total: 2, textPages: 24 }, "books saved before the plan: cover and openers");
    const none = { ...book, imagePlan: { placement: "none", style: "auto" }, cover: { image: "cover-art" } };
    assert.ok(bookImageIssues(none).blocking.length);
    assert.ok(bookImageIssues({ ...book, imagePlan: { placement: "cover", style: "auto" }, chapters: [{ ...book.chapters[0], image: "opener" }] }).blocking.length);
  });

  await check("book images: a failed check regenerates once, a second failure drops the image and every reference; no images means no image tools", async () => {
    const book = new DocumentEditor(emptyDocument("book", "Tide pools", undefined, { imagePlan: { placement: "every", everyPages: 3, style: "illustration" } }));
    const pictures = fakeImages();
    const chapter = { id: "pools", title: "Reading a tide pool", image: "pools-opener", text: "The pool is a small sea.\n\n[[figure:anemone|A beadlet anemone, open at high water]]\n\nIt closes when the tide falls." };
    const fake = fakeAnthropic([
      [toolUse("set_theme", { ...THEME, motif: "frame" }), toolUse("write_chapter", { chapter }), toolUse("generate_image", { name: "pools-opener", prompt: "A rock pool at low tide, gouache, wide calm composition", aspect: "landscape", alt: "A rock pool at low tide" }),
        toolUse("generate_image", { name: "anemone", prompt: "A beadlet anemone in a rock pool, gouache, scientific clarity", aspect: "landscape", alt: "A beadlet anemone" })],
      [toolUse("check_image", { name: "pools-opener", artifacts: [], verdict: "pass" }), toolUse("check_image", { name: "anemone", artifacts: ["garbled pseudo-text on a rock"], verdict: "fail", fix: "No marks that look like letters." })],
      [toolUse("check_image", { name: "anemone", artifacts: ["extra tentacles merged into the rock"], verdict: "fail" })],
      [toolUse("finish", { summary: "x" })], [toolUse("finish", { summary: "x" })],
    ]);
    const outcome = await run(book, fake, pictures);
    assert.deepEqual(outcome.checks.map(entry => `${entry.id}:${entry.attempt}:${entry.outcome}`).sort(), ["anemone:1:retry", "anemone:2:dropped", "pools-opener:1:passed"]);
    assert.equal(pictures.log.prompts.length, 3);
    assert.match(pictures.log.prompts[2], /CORRECTION[\s\S]*No marks that look like letters/);
    assert.ok(!book.hasImage("anemone") && book.hasImage("pools-opener"));
    assert.ok(!book.doc.chapters[0].text.includes("[[figure:anemone"), "the figure line is gone");
    assert.match(book.doc.chapters[0].text, /The pool is a small sea\.\n\nIt closes when the tide falls\./, "the text flows on without it");
    const escaped = new DocumentEditor(emptyDocument("book", "Cafe"));
    escaped.apply("write_chapter", { chapter: { id: "cafe", title: "The caf\\u00e9", text: "[[figure:loaf|A loaf in a busy caf\\u00e9 display]]" } });
    assert.ok(!"The caf\\u00e9".includes("\u00e9"), "the fixture really is a literal backslash-u sequence");
    assert.equal(escaped.doc.chapters[0].title, "The café");
    assert.match(escaped.doc.chapters[0].text, /busy café display/, "a double-escaped character from tool JSON is decoded");
    assert.equal(book.doc.chapters[0].image, "pools-opener");
    assert.equal(imagesIn(fake.log.streams[1]).length, 2, "both images came back to be checked");

    const plain = new DocumentEditor(emptyDocument("book", "Plain", undefined, { imagePlan: { placement: "none", style: "auto" } }));
    const quiet = fakeAnthropic([[toolUse("write_chapter", { chapter: { id: "a", title: "A", text: "Text." } }), toolUse("finish", { summary: "x" })]]);
    await run(plain, quiet, fakeImages());
    assert.ok(!quiet.log.streams[0].toolNames.includes("generate_image") && !quiet.log.streams[0].toolNames.includes("check_image"));
    assert.match(JSON.stringify(quiet.log.streams[0].messages[0]), /No images at all/);
  });

  await check("exports keep artwork within 3 MB per image and 12 MB in all, re-encoding instead of refusing", async () => {
    assert.equal(ARTWORK_IMAGE_LIMIT, 3_000_000); assert.equal(ARTWORK_TOTAL_LIMIT, 12_000_000);
    const noise = async seed => { const raw = Buffer.alloc(1600 * 1200 * 3); let x = seed; for (let i = 0; i < raw.length; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; raw[i] = x >> 16 & 255; } return sharp(raw, { raw: { width: 1600, height: 1200, channels: 3 } }).png().toBuffer(); };
    const buffers = {}; for (let i = 0; i < 4; i++) buffers[`plate-${i}`] = await noise(i + 1);
    const fitted = await fitArtwork(buffers, { perImage: 700_000, total: 1_800_000 });
    const sizes = Object.values(fitted).map(bytes => bytes.length);
    assert.ok(sizes.every(size => size <= 700_000), sizes.join(","));
    assert.ok(sizes.reduce((a, b) => a + b, 0) <= 1_800_000, sizes.join(","));
    assert.ok(Object.values(fitted).every(bytes => bytes[0] === 0xff && bytes[1] === 0xd8), "JPEG");
    assert.match(fs.readFileSync(require.resolve("./export-server.ts"), "utf8"), /fitArtwork\(buffers\)/, "the PDF exporter uses the limits");
  });

  console.log(`${count} full-image slide and book image checks passed.`);
})().catch(error => { console.error(error); process.exit(1); });
