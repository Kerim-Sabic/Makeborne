/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for the reference-pattern prompts, the client's image quality and shape, export page sizes and generated book pages. Providers are fakes: no network, no paid calls. */
const fs = require("node:fs"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const JSZip = require("jszip"), sharp = require("sharp");
const { DocumentEditor, emptyDocument } = require("./editor.ts");
const { composeSlide } = require("./slide-scene.ts");
const { ART_COMPOSITION, artPrompt, compareSlideText, gateText, slideFurniture, textKey, verifiedArt } = require("./slide-art.ts");
const { colourName, displayLines, quotedLines, tailBook, tailSlide } = require("./art-direction.ts");
const formats = require("./art-formats.ts");
const { bookArtPrompt, pageKind, pageText, pageTextKey, pagesWanted, verifiedPage } = require("./book-art.ts");
const { bookHtml, bookTrim, bookPagePx } = require("./render-book.ts");
const { deckHtml, deckPage } = require("./render-deck.ts");
const { deckPptx } = require("./pptx.ts");
const { bookPagesFromOutline } = require("./book-pagination.ts");
const { bookImagePlanFromBrief } = require("./creation-options.ts");
const { runDocumentBuilder } = require("../builder/docs-agent.ts");
const { newDocumentFormat } = formats;
const { RunSpend, memoryGate } = require("../ai/run-spend.ts");
const { imageCallBoundMicrousd } = require("../ai/prices.ts");

let count = 0;
async function check(name, fn) { await fn(); count++; console.log(`PASS ${name}`); }
const SUN = "gpt-image-2.5-sunburst";
/** A model with only the three published sizes measured: it shows the fallback canvases and the refusals. */
const G2 = "gpt-image-2";
const palette = { background: "#F4EDE3", surface: "#EDE3D5", ink: "#2A1D14", muted: "#6B5A4C", accent: "#B5562F", accent2: "#5E6B45", dark: "#2A1D14" };
const THEME = { palette, fonts: "playfair", direction: "editorial", mood: "Warm, crafted", imageStyle: "Warm documentary photography at dawn, 35mm" };
const SYSTEM = "A twelve-column grid with wide margins; an elegant high-contrast serif for headlines in sentence case, a clean sans for figures; cream grounds, terracotta only for emphasis; warm documentary photography of the bakery at dawn; a thin terracotta rule under every headline.";
const COVER = { id: "cover", layout: "cover", tone: "light", title: "A second oven.", subtitle: "Plan for 2027", notes: "Alba Bakehouse.",
  art: { frame: "split", layout: "Left 50%: cream type field; right 50%: full-bleed photograph", subject: "a glowing wood-fired brick bread oven with a baker sliding out round sourdough loaves on a long wooden peel", accent: "oven.", brief: "The headline set huge, bottom-aligned in the type field." } };
const NUMBERS = { id: "numbers", layout: "stats", tone: "light", title: "Sold out by 11 a.m.", stats: [{ value: "1,240", label: "loaves a week" }, { value: "6 years", label: "one oven" }], notes: "From the brief.",
  art: { frame: "big-number", brief: "Two figures in a row with a thin terracotta rule beneath; no photograph." } };
const toolUse = (name, input) => ({ type: "tool_use", id: `tu_${Math.random().toString(36).slice(2, 10)}`, name, input });
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
const canvas = async (width, height) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#2A1D14"/></svg>`)).png().toBuffer();
function fakeImages() {
  const log = { bodies: [] };
  return { log, client: { images: { async generate(body) {
    log.bodies.push(body);
    const [width, height] = body.size.split("x").map(Number);
    return { data: [{ b64_json: (await canvas(width, height)).toString("base64") }], usage: { input_tokens: 900, output_tokens: body.quality === "high" ? 1372 : 343, input_tokens_details: { text_tokens: 900, image_tokens: 0 } } };
  } } } };
}
let stored = 0;
const storeImage = async request => ({ id: `00000000-0000-4000-8000-${String(++stored).padStart(12, "0")}`, path: `public/images/${request.name}.webp`, sha256: "a".repeat(64), bytes: 9, mediaType: "image/webp", url: `/images/${request.name}.webp` });
const spendFor = (credits = 90) => new RunSpend({ run: `art-formats-${Math.random()}`, providerCapMicrousd: Math.floor(credits * 0.03 * 1e6), customerCapMicrousd: null, gate: memoryGate(), deadline: Date.now() + 280_000 });
const run = (editor, anthropic, images, request = "Alba Bakehouse needs a second oven: sold out by 11 a.m., 1,240 loaves a week, six years on one oven; a plan for 2027.", extra = {}) => runDocumentBuilder({ client: null, scope: { workspaceId: "w", projectId: "p" }, editor, effort: "high", spend: spendFor(), request, context: "", attachments: [],
  emit: () => {}, signal: new AbortController().signal, deadline: Date.now() + 280_000, anthropic: anthropic.client, imageClient: images.client, storeImage, imageModels: [SUN, "gpt-image-2.5-flare"], ...extra });
const deckWith = (art = {}) => {
  const editor = new DocumentEditor(emptyDocument("deck", "A second oven", undefined, { slideMode: "image", pageNumbers: true, ...art }));
  editor.apply("set_theme", THEME);
  editor.apply("set_deck_details", { title: "A second oven", art_system: SYSTEM, wordmark: "Alba Bakehouse" });
  editor.apply("write_slide", { slide: COVER }); editor.apply("write_slide", { slide: NUMBERS });
  return editor;
};

(async () => {
  await check("art direction words: colours as designer's words plus hex, display line breaks quoted as the reference writes them", () => {
    assert.deepEqual(["#F4EDE3", "#2A1D14", "#B5562F", "#1D3FA8", "#FFFFFF", "#111111"].map(colourName), ["warm cream", "deep brown-black", "terracotta", "cobalt blue", "white", "near-black"]);
    assert.deepEqual(displayLines("Fresh lemonade. Finally, on Mars."), ["Fresh lemonade.", "Finally,", "on Mars."]);
    assert.deepEqual(displayLines("Fixed by Friday."), ["Fixed by Friday."]);
    assert.equal(quotedLines("x", ["Fixed by", "Friday."]), 'on two lines "Fixed by" / "Friday."');
    assert.match(tailSlide("16:9"), /^A flat, straight-on 16:9 presentation slide filling the entire image \(no laptop, no screen, no room, no perspective\)\. Perfect alignment, generous margins, crisp vector-sharp typography\. All text spelled exactly as given, perfectly legible, no extra words, no garbled letters\.$/);
    assert.match(tailBook("portrait 2:3"), /no mock-up, no table, no hands, no perspective, no visible book edges\. Museum-quality book design\./);
  });

  await check("slide prompt follows the reference pattern: layout %, hex palette, type style, quoted lines with breaks, accent, wordmark, page number, subject, TAIL_SLIDE", () => {
    const editor = deckWith(), deck = editor.doc;
    const prompt = artPrompt(deck, deck.slides[0], undefined, { size: "2560x1440", crop: { left: 0, top: 0, width: 2560, height: 1440 } });
    for (const part of ["Title slide (slide 1 of 2)", "warm cream #F4EDE3 background", "deep brown-black #2A1D14 text", "terracotta #B5562F accent", "a refined editorial text serif for headlines",
      "Left 50%: cream type field; right 50%: full-bleed photograph.", 'A small wordmark "Alba Bakehouse" at the top-left', 'headline on two lines "A second" / "oven."', 'with "oven." in terracotta #B5562F italic',
      'below it a line "Plan for 2027"', 'bottom-left a tiny page number "01"', "The image: a glowing wood-fired brick bread oven", SYSTEM, tailSlide("16:9")]) assert.ok(prompt.includes(part), part);
    assert.doesNotMatch(prompt, /cropped away/, "a native 16:9 canvas has no cropped margins");
    const cropped = artPrompt(deck, deck.slides[1]);
    assert.match(cropped, /The top 7\.8% and bottom 7\.8% of the canvas are cropped away/);
    assert.match(cropped, /two big figures in a row with small labels underneath: "1,240" labelled "loaves a week", "6 years" labelled "one oven"/);
    assert.match(cropped, /The figures fill the left 60% at poster size/, "the frame's default split in percentages");
    assert.match(cropped, /bottom-left a tiny page number "02"/);
    const vertical = new DocumentEditor({ ...deck, art: { ...deck.art, aspect: "9:16" } }).doc;
    assert.ok(artPrompt(vertical, vertical.slides[0]).includes(tailSlide("vertical 9:16")));
    assert.throws(() => editor.apply("write_slide", { slide: { ...COVER, art: { ...COVER.art, accent: "bread" } } }), /art\.accent "bread" is not in the slide's text/);
  });

  await check("the gate expects the furniture: wordmark and page number (read with or without its zero); a moved slide or a new wordmark needs a new render", () => {
    const editor = deckWith(), deck = editor.doc;
    assert.deepEqual(slideFurniture(deck, deck.slides[1]).map(line => line.text), ["Alba Bakehouse", "02"]);
    const words = gateText(deck, deck.slides[1]).map(line => line.text);
    assert.ok(compareSlideText(words, "Alba Bakehouse Sold out by 11 a.m. 1,240 loaves a week 6 years one oven 2").ok, "\"2\" reads as page \"02\"");
    assert.ok(!compareSlideText(words, "Sold out by 11 a.m. 1,240 loaves a week 6 years one oven 2").ok, "a missing wordmark fails");
    const passed = { ...deck, assets: [{ name: "art-numbers", id: "00000000-0000-4000-8000-000000000001", aspect: "landscape", alt: "", prompt: "" }],
      art: { ...deck.art, renders: [{ slide: "numbers", image: "art-numbers", verified: textKey(deck.slides[1]), page: 2, wordmark: "Alba Bakehouse", attempts: 1, outcome: "passed", problems: [] }] } };
    assert.equal(verifiedArt(passed, passed.slides[1]), "art-numbers");
    assert.equal(verifiedArt({ ...passed, slides: [passed.slides[1], passed.slides[0]] }, passed.slides[1]), null, "moved to page 1: its page number is wrong");
    assert.equal(verifiedArt({ ...passed, art: { ...passed.art, wordmark: "Alba" } }, passed.slides[1]), null, "a new wordmark");
    assert.equal(verifiedArt({ ...passed, art: { ...passed.art, aspect: "4:3" } }, passed.slides[1]), null, "a new slide shape");
  });

  await check("quality and shape: only measured cells resolve; the native sizes once measured, else a measured canvas cut to shape; unmeasured qualities refused", () => {
    // The 2.5 models, measured 26 Oct 2026: every shape renders natively at High and Best.
    for (const [target, size] of [[{ kind: "deck", aspect: "16:9" }, "2560x1440"], [{ kind: "deck", aspect: "4:3" }, "2048x1536"], [{ kind: "deck", aspect: "1:1" }, "1920x1920"], [{ kind: "deck", aspect: "9:16" }, "1440x2560"],
      [{ kind: "book", shape: "portrait" }, "1536x2304"], [{ kind: "book", shape: "square", spread: true }, "2560x1280"], [{ kind: "book", shape: "landscape", spread: true }, "2880x1152"]]) {
      for (const quality of ["high", "best"]) { const cell = formats.artCell(SUN, target, quality); assert.deepEqual([cell.ok, cell.size, cell.native], [true, size, true], `${JSON.stringify(target)} ${quality}`); }
    }
    // A model with only the published sizes: High is cut from a measured 3:2 canvas, Best is refused.
    const deck169 = formats.artCell(G2, { kind: "deck", aspect: "16:9" }, "high");
    assert.deepEqual([deck169.ok, deck169.size, deck169.native], [true, "1536x1024", false]);
    assert.equal(formats.artCell(G2, { kind: "deck", aspect: "16:9" }, "best").ok, false, "no measured xhigh canvas");
    assert.equal(formats.artCell(SUN, { kind: "deck", aspect: "1:1" }, "standard").size, "1024x1024");
    assert.deepEqual(formats.artCell(G2, { kind: "deck", aspect: "4:3" }, "high").crop, { left: 85, top: 0, width: 1365, height: 1024 });
    assert.deepEqual(formats.artCell(SUN, { kind: "deck", aspect: "9:16" }, "standard").crop, { left: 80, top: 0, width: 864, height: 1536 });
    const lower = formats.artCellOrLower(G2, { kind: "deck", aspect: "9:16" }, "best");
    assert.deepEqual([lower.chosen, lower.downgraded, lower.quality], ["high", true, "high"]);
    assert.equal(formats.defaultArtQuality(SUN, { kind: "deck", aspect: "16:9" }), "high");
    assert.equal(formats.defaultArtQuality(SUN, { kind: "deck", aspect: "1:1" }), "high");
    assert.equal(formats.defaultArtQuality("gpt-image-unknown", { kind: "deck", aspect: "1:1" }), "standard");
    assert.equal(formats.defaultArtQuality(null, { kind: "deck", aspect: "16:9" }), "standard");
    assert.deepEqual(formats.artCell(SUN, { kind: "book", shape: "landscape", spread: true }, "standard").crop, { left: 0, top: 205, width: 1536, height: 614 });
    assert.equal(formats.artTextModel(["gpt-image-2", "gpt-image-2.5-flare"]), "gpt-image-2.5-flare");
    assert.equal(formats.artTextModel(["gpt-image-2"]), null);
  });

  await check("credit impact before generating: each quality's per-image credits from the bound; unavailable qualities carry no price; the client parses only well-formed offers", () => {
    const offers = formats.documentImageOffers(SUN, 0.03);
    const wide = Object.fromEntries(offers.presentation["16:9"].map(offer => [offer.quality, offer]));
    const bound = (q, size) => imageCallBoundMicrousd(SUN, q, size, "x".repeat(formats.PREVIEW_PROMPT_BYTES)) / 1e6;
    assert.equal(wide.high.perImage.max, Math.ceil(bound("high", "2560x1440") * 2 / 0.03 - 1e-9), "most: the bound of one image and its regeneration");
    assert.equal(wide.best.perImage.max, Math.ceil(bound("xhigh", "2560x1440") * 2 / 0.03 - 1e-9));
    assert.equal(wide.standard.perImage.max, Math.ceil(bound("medium", "1536x1024") * 2 / 0.03 - 1e-9));
    assert.ok(wide.high.perImage.expected < wide.high.perImage.max && wide.high.perImage.expected > wide.standard.perImage.expected && wide.best.perImage.expected > wide.high.perImage.expected, JSON.stringify(wide));
    const partial = Object.fromEntries(formats.documentImageOffers(G2, 0.03).presentation["16:9"].map(offer => [offer.quality, offer]));
    assert.equal(partial.best.available, false);
    assert.equal(partial.best.perImage, undefined);
    assert.deepEqual(formats.parseDocumentImageOffers(JSON.parse(JSON.stringify(offers))), offers);
    for (const bad of [null, {}, { ...offers, presentation: { ...offers.presentation, "4:3": [] } }, { ...offers, book: { ...offers.book, square: { page: offers.book.square.page, spread: [{ quality: "high", available: true, perImage: { expected: 3, max: 1 } }, ...offers.book.square.spread.slice(1)] } } }])
      assert.equal(formats.parseDocumentImageOffers(bad), null);
    assert.equal(formats.documentImageOffers(null, 0.03).presentation["16:9"].every(offer => !offer.available), true, "no text-capable model: nothing offered");
  });

  await check("server validation: unmeasured quality or shape refused in plain words, never naming a model; kinds keep their own option", () => {
    assert.equal(formats.imageOptionsIssue("presentation", { quality: "high", aspect: "16:9" }, SUN), null);
    assert.equal(formats.imageOptionsIssue("presentation", { quality: "best", aspect: "9:16" }, SUN), null, "measured: Best vertical renders");
    assert.match(formats.imageOptionsIssue("presentation", { quality: "best" }, G2), /^Best quality is not available for Widescreen 16:9 yet\./);
    assert.match(formats.imageOptionsIssue("presentation", { quality: "best", aspect: "1:1" }, G2), /Best quality is not available for Square 1:1 yet/);
    assert.match(formats.imageOptionsIssue("presentation", { quality: "best" }, G2, { aspect: "1:1" }), /Square 1:1/, "the saved shape counts when only the quality changes");
    assert.match(formats.imageOptionsIssue("presentation", { shape: "square" }, SUN), /Page shapes apply to books/);
    assert.match(formats.imageOptionsIssue("book", { aspect: "4:3" }, SUN), /Slide shapes apply to presentations/);
    assert.match(formats.imageOptionsIssue("book", { quality: "high" }, null), /not available right now/);
    for (const message of [formats.imageOptionsIssue("presentation", { quality: "best" }, G2), formats.imageOptionsIssue("book", { quality: "high" }, null)]) assert.doesNotMatch(message, /gpt|openai|sunburst|flare|model/i);
    const route = fs.readFileSync(require.resolve("../../app/api/build/route.ts"), "utf8");
    assert.match(route, /imageOptions: z\.object\(\{ quality: z\.enum\(ART_QUALITIES\)\.optional\(\), aspect: z\.enum\(DECK_ASPECTS\)\.optional\(\), shape: z\.enum\(BOOK_SHAPES\)\.optional\(\) \}\)\.strict\(\)\.optional\(\)/);
    assert.match(route, /IMAGE_OPTION_UNAVAILABLE/);
    assert.ok(route.indexOf("IMAGE_OPTION_UNAVAILABLE") < route.indexOf("beginOperation({"), "refused before any operation or credit hold");
  });

  await check("new documents take the client's choices: composer options, then the questions' answers or the brief, then 16:9 / 6x9 at High where it can render", () => {
    assert.deepEqual(newDocumentFormat("presentation", "A pitch deck", {}, SUN), { aspect: "16:9", quality: "high" });
    assert.deepEqual(newDocumentFormat("presentation", "Instagram stories for our launch", {}, SUN), { aspect: "9:16", quality: "high" });
    assert.deepEqual(newDocumentFormat("presentation", "A deck\n- Slide shape: Standard 4:3 (Older projectors)\n- Image quality: Standard (Good for drafts)", {}, SUN), { aspect: "4:3", quality: "standard" });
    assert.deepEqual(newDocumentFormat("presentation", "A deck", { aspect: "1:1", quality: "standard" }, SUN), { aspect: "1:1", quality: "standard" });
    assert.deepEqual(newDocumentFormat("book", "A children's picture book about a cat\n- Page shape: Square 8.5 × 8.5 in (Picture books)", {}, SUN), { shape: "square", quality: "high" });
    assert.deepEqual(newDocumentFormat("book", "A field guide", {}, SUN), { shape: "portrait", quality: "high" });
    assert.deepEqual(newDocumentFormat("book", "A field guide", {}, G2), { shape: "portrait", quality: "high" }, "the published portrait high size is enough for High");
    assert.equal(bookImagePlanFromBrief("A children's picture book about a lighthouse cat").placement, "picture");
    const deck = emptyDocument("deck", "x", undefined, { slideMode: "image", aspect: "9:16", quality: "high", pageNumbers: true });
    assert.deepEqual(deck.art, { mode: "image", system: "", aspect: "9:16", quality: "high", pageNumbers: true, renders: [] });
    assert.equal(emptyDocument("deck", "x", undefined, { slideMode: "live", aspect: "9:16" }).art.aspect, undefined, "editable decks stay 16:9");
  });

  await check("export page sizes follow the shape: PDF @page, preview ratio, PPTX slide size; editable layouts sit centred, full images fill the page", async () => {
    const editor = deckWith({ aspect: "9:16" }), deck = editor.doc;
    assert.deepEqual(deckPage(deck), { width: 1280, height: 2276 });
    const print = deckHtml(deck, {}, "print");
    assert.match(print, /@page\{size:1280px 2276px;margin:0\}/);
    assert.match(print, /\.slide\{position:relative;width:100%;aspect-ratio:1280\/2276/);
    assert.match(print, /<div class="sc" style="top:34\.1828%;height:31\.6344%">/, "the 1280x720 editable layout centred on the tall page");
    assert.match(deckHtml(deckWith({ aspect: "4:3" }).doc, {}, "print"), /@page\{size:1280px 960px;margin:0\}/);
    assert.match(deckHtml(deckWith().doc, {}, "print"), /@page\{size:1280px 720px;margin:0\}/);
    const verified = { ...deck, assets: [{ name: "art-cover", id: "00000000-0000-4000-8000-000000000002", aspect: "portrait", alt: "", prompt: "" }],
      art: { ...deck.art, renders: [{ slide: "cover", image: "art-cover", verified: textKey(deck.slides[0]), aspect: "9:16", page: 1, wordmark: "Alba Bakehouse", attempts: 1, outcome: "passed", problems: [] }] } };
    assert.equal(composeSlide(verified, verified.slides[0], 0, 2).composition, ART_COMPOSITION);
    assert.ok(deckHtml(verified, { "art-cover": "data:image/png;base64,AAAA" }, "print").includes('<section class="slide" aria-label="Slide 1: A second oven." style="background:#2A1D14"><img class="p" style="left:0.0000%;top:0.0000%;width:100.0000%;height:100.0000%'), "the full image fills the tall page");
    const zip = await JSZip.loadAsync(await deckPptx(verified, { "art-cover": await canvas(864, 1536) }));
    const size = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(await zip.file("ppt/presentation.xml").async("string"));
    assert.ok(Math.abs(Number(size[2]) / Number(size[1]) - 2276 / 1280) < 0.002, `PPTX slide is 9:16 (${size[1]} x ${size[2]})`);
    const slide2 = await zip.file("ppt/slides/slide2.xml").async("string");
    const ys = [...slide2.slice(slide2.indexOf("</p:grpSpPr>")).matchAll(/<a:off x="\d+" y="(\d+)"/g)].map(match => Number(match[1]));
    assert.ok(ys.length && Math.min(...ys) >= Math.round((2276 - 720) / 2 / 96 * 914400) - 1, `editable shapes moved down onto the centred band (${ys.join(",")})`);
  });

  await check("a High 16:9 deck renders natively at 2560x1440 with allowHigh, reserves its measured bound, and records shape, page and wordmark; a High 9:16 deck renders at 1440x2560", async () => {
    const editor = deckWith({ quality: "high" }), images = fakeImages();
    const transcript = slide => gateText(editor.doc, slide).map(line => line.text).join(" ");
    const anthropic = fakeAnthropic([
      [toolUse("render_slides", { ids: ["cover", "numbers"] })],
      () => [toolUse("check_slide", { id: "cover", transcript: transcript(editor.doc.slides[0]), artifacts: [], verdict: "pass" }), toolUse("check_slide", { id: "numbers", transcript: transcript(editor.doc.slides[1]), artifacts: [], verdict: "pass" })],
      [toolUse("finish", { summary: "Two slides." })],
    ]);
    const gate = memoryGate(), spend = new RunSpend({ run: `art-high-${Math.random()}`, providerCapMicrousd: Math.floor(90 * 0.03 * 1e6), customerCapMicrousd: null, gate, deadline: Date.now() + 280_000 });
    const result = await run(editor, anthropic, images, undefined, { spend });
    assert.equal(result.finished, true, result.summary);
    assert.deepEqual(images.log.bodies.map(body => [body.size, body.quality]), [["2560x1440", "high"], ["2560x1440", "high"]]);
    const reserved = gate.log.begin.filter(call => call.provider === "openai").map(call => call.boundMicrousd).sort((a, b) => a - b);
    assert.deepEqual(reserved, images.log.bodies.map(body => imageCallBoundMicrousd(SUN, "high", "2560x1440", body.prompt)).sort((a, b) => a - b), "each render reserved its measured high bound before the call");
    assert.ok(images.log.bodies.every(body => body.prompt.includes(tailSlide("16:9")) && !body.prompt.includes("cropped away")), "native canvas: nothing is cropped");
    const cover = editor.doc.art.renders.find(entry => entry.slide === "cover");
    assert.deepEqual([cover.outcome, cover.page, cover.wordmark, cover.aspect], ["passed", 1, "Alba Bakehouse", undefined]);
    assert.ok(verifiedArt(editor.doc, editor.doc.slides[1]));

    const tall = deckWith({ aspect: "9:16", quality: "high" }), tallImages = fakeImages();
    tall.apply("delete_slide", { id: "numbers" });
    const tallAnthropic = fakeAnthropic([
      [toolUse("render_slides", { ids: ["cover"] })],
      () => [toolUse("check_slide", { id: "cover", transcript: gateText(tall.doc, tall.doc.slides[0]).map(line => line.text).join(" "), artifacts: [], verdict: "pass" })],
      [toolUse("finish", { summary: "Cover." })],
    ]);
    const tallResult = await run(tall, tallAnthropic, tallImages);
    assert.deepEqual(tallImages.log.bodies.map(body => [body.size, body.quality]), [["1440x2560", "high"]]);
    assert.doesNotMatch(tallResult.summary, /not available/);
    assert.equal(tall.doc.art.renders.find(entry => entry.slide === "cover").aspect, "9:16");
    assert.match(tallAnthropic.log.streams[0].messages[0].content.at(-1).text, /Every slide is vertical 9:16 \(9:16\): compose for that shape \(a tall, phone-first page/);
  });

  // ---- Books: generated cover, openers and picture-book spreads ----
  const bookTheme = { palette: { background: "#F3EBDD", surface: "#E8DCC8", ink: "#1B2433", muted: "#4F5866", accent: "#C8892B", accent2: "#3B5878", dark: "#14203A" }, fonts: "fraunces", mood: "Warm", imageStyle: "Gouache and coloured pencil on rich textured paper", motif: "quiet" };
  const BOOK_SYSTEM = "Gouache and coloured pencil on rich textured paper, deep navy and warm amber; the title hand-lettered in large cream letters; a small lantern motif recurs on every page.";
  const pictureBook = () => {
    const editor = new DocumentEditor(emptyDocument("book", "Captain Biscuit Keeps the Light", undefined, { imagePlan: { placement: "picture", style: "illustration" }, shape: "landscape", bookArt: true }));
    editor.apply("set_theme", bookTheme);
    editor.apply("set_book_details", { title: "Captain Biscuit Keeps the Light", author: "Mira Holt", art_system: BOOK_SYSTEM,
      cover_art: { layout: "The title hand-lettered across the top 30% of the night sky; the illustration fills the cover", subject: "a plump grey tabby cat sits proudly on a dark sea rock at night with a small brass ship's lantern strapped on his head; its warm golden beam sweeps across a calm indigo sea towards a tiny ferry", accent: "Light" } });
    editor.apply("write_chapter", { chapter: { id: "afraid", title: "Afraid of the water", text: "Ollie was the only whale\n\nwho was afraid of the water.", art: { subject: "a big gentle blue whale peeking nervously over the edge of a small wooden pier, a little girl in a yellow raincoat holding out her hand, soft pastel watercolour sea and gulls" } } });
    return editor;
  };

  await check("book prompts follow the reference pattern with TAIL_BOOK: cover words, the shape, picture-book spreads with the words on the art and clear of the gutter", () => {
    const book = pictureBook().doc;
    assert.deepEqual(pagesWanted(book), [{ target: "cover", kind: "cover" }, { target: "afraid", kind: "spread" }]);
    assert.deepEqual(pageText(book, "afraid").map(line => line.text), ["Ollie was the only whale", "who was afraid of the water."]);
    const cover = bookArtPrompt(book, "cover", { size: "1600x1280", crop: { left: 0, top: 0, width: 1600, height: 1280 } });
    for (const part of ['The landscape 5:4 front cover of a book titled "Captain Biscuit Keeps the Light"', "warm cream #F3EBDD ground", "The title hand-lettered across the top 30% of the night sky", 'the author\'s name "Mira Holt" small',
      'with "Light" in amber #C8892B italic', "The art: a plump grey tabby cat", BOOK_SYSTEM, tailBook("landscape 5:4")]) assert.ok(cover.includes(part), part);
    const spread = bookArtPrompt(book, "afraid", { size: "1536x1024", crop: { left: 0, top: 205, width: 1536, height: 614 } });
    for (const part of ["A double-page spread from the picture book", '"Ollie was the only whale" / "who was afraid of the water."', "never cross the centre gutter", "at least 8% from the centre gutter", "The top 20% and bottom 20% of the canvas are cropped away",
      "landscape 5:4 double-page spread (two 10 x 8 in pages side by side)"]) assert.ok(spread.includes(part), part);
    const plain = new DocumentEditor(emptyDocument("book", "Guide", undefined, { imagePlan: { placement: "openers", style: "photo" }, bookArt: true }));
    plain.apply("write_chapter", { chapter: { id: "one", title: "Where to start", text: "Text." } });
    plain.apply("write_chapter", { chapter: { id: "two", title: "Notes", opening: "inline", text: "Text." } });
    assert.deepEqual(pagesWanted(plain.doc).map(page => `${page.target}:${page.kind}`), ["cover:cover", "one:opener"], "inline chapters have no generated opener");
    assert.deepEqual(pageText(plain.doc, "one").map(line => line.text), ["Chapter One", "Where to start"]);
    assert.equal(emptyDocument("book", "x", undefined, { imagePlan: { placement: "none", style: "auto" }, bookArt: true }).art, undefined, "no images: no generated pages");
  });

  await check("book pages: the gate checks each generated page; a pass shows it whole (a spread as two facing pages), a second failure keeps it typeset", async () => {
    const editor = pictureBook(), images = fakeImages();
    const words = target => pageText(editor.doc, target).map(line => line.text).join(" ");
    const anthropic = fakeAnthropic([
      [toolUse("render_pages", { targets: ["cover", "afraid"] })],
      () => [toolUse("check_page", { target: "cover", transcript: words("cover"), artifacts: [], verdict: "pass" }), toolUse("check_page", { target: "afraid", transcript: words("afraid").replace("whale", "whael"), artifacts: [], verdict: "pass" })],
      () => [toolUse("check_page", { target: "afraid", transcript: words("afraid").replace("water", "watter"), artifacts: [], verdict: "fail" })],
      [toolUse("finish", { summary: "A cover and one spread." })],
    ]);
    const result = await run(editor, anthropic, images, "A picture book: Captain Biscuit Keeps the Light, by Mira Holt.");
    assert.equal(result.finished, true, result.summary);
    assert.ok(anthropic.log.streams[0].toolNames.includes("render_pages") && anthropic.log.streams[0].toolNames.includes("check_page"));
    assert.match(anthropic.log.streams[0].system[0].text, /FULL-IMAGE PAGES/);
    assert.deepEqual(images.log.bodies.map(body => body.size), ["1536x1024", "1536x1024", "1536x1024"], "landscape page and spread fall back to the measured 3:2 canvas at Standard");
    assert.ok(images.log.bodies.every(body => body.prompt.includes("Museum-quality book design")));
    const renders = Object.fromEntries(editor.doc.art.renders.map(entry => [entry.target, entry]));
    assert.deepEqual([renders.cover.outcome, renders.cover.shape, renders.afraid.outcome, renders.afraid.attempts], ["passed", "landscape", "fallback", 2]);
    assert.equal(verifiedPage(editor.doc, "cover"), "page-cover");
    assert.equal(verifiedPage(editor.doc, "afraid"), null);
    const html = bookHtml(editor.doc, { "page-cover": "data:image/png;base64,AAAA" }, "print");
    assert.match(html, /<section class="full page-full cover-full"><img class="page-art" src="data:image\/png;base64,AAAA" alt="Captain Biscuit Keeps the Light\. Mira Holt"><h1 class="art-words">Captain Biscuit Keeps the Light<\/h1><\/section>/);
    assert.match(html, /@page\{size:10in 8in;/, "landscape trim");
    // A verified spread prints as two facing pages cut from one picture, its left page on a left-hand page.
    const spread = { ...editor.doc, assets: [...editor.doc.assets, { name: "page-afraid", id: "00000000-0000-4000-8000-000000000003", aspect: "landscape", alt: "", prompt: "" }],
      art: { ...editor.doc.art, renders: [...editor.doc.art.renders.filter(entry => entry.target !== "afraid"), { target: "afraid", kind: "spread", image: "page-afraid", verified: pageTextKey(editor.doc, "afraid"), shape: "landscape", attempts: 1, outcome: "passed", problems: [] }] } };
    const spreadHtml = bookHtml(spread, { "page-cover": "data:x", "page-afraid": "data:y" }, "print");
    assert.match(spreadHtml, /<section class="full page-full spread-half left" id="chapter-afraid">[\s\S]*?<section class="full page-full spread-half right">/);
    assert.doesNotMatch(spreadHtml, /<section class="chapter"[^>]*>[\s\S]*Ollie was the only whale<\/p>/, "the words are on the art, not typeset again");
    assert.match(bookHtml(spread, { "page-afraid": "data:y" }), /<div class="spread">/, "the preview shows the spread side by side");
    assert.deepEqual(bookPagesFromOutline(spread, [{ title: spread.title, page: 2 }, { title: "Afraid of the water", page: 3 }], ["afraid"]).blankBefore, ["afraid"], "a spread starting on a right-hand page gets a blank before it");
    assert.deepEqual(bookPagesFromOutline(spread, [{ title: spread.title, page: 2 }, { title: "Afraid of the water", page: 4 }], ["afraid"]).blankBefore, []);
    // A new page shape invalidates every generated page.
    const square = new DocumentEditor(editor.doc);
    assert.equal(square.setBookFormat({ shape: "square" }), true);
    assert.equal(verifiedPage(square.doc, "cover"), null);
    assert.deepEqual(bookTrim(square.doc), { width: 8.5, height: 8.5, top: 0.75, bottom: 0.85, inside: 0.82, outside: 0.62 });
    assert.deepEqual(bookPagePx(square.doc), { width: 816, height: 816 });
    assert.equal(pageKind(square.doc, "afraid"), "spread");
  });

  console.log(`${count} reference-pattern, image quality and shape checks passed.`);
})().catch(error => { console.error(error); process.exit(1); });
