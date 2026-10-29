/* eslint-disable @typescript-eslint/no-require-imports -- Offline design-quality checks for decks and books: layouts, motifs,
   embedded fonts, measured text fit in Chromium, PPTX box/font/spacing parity and presenter motion. No network, no providers. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
global.fetch = () => { throw Error("External requests are forbidden in this check"); };
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const JSZip = require("jszip"), sharp = require("sharp");
const { chromium } = require("playwright");
const { DocumentSourceSchema, FONT_PAIRINGS, MOTIFS, SLIDE_LAYOUTS } = require("./schema.ts");
const { FONTS, MOTIF_NOTES } = require("./theme.ts");
const { DOCUMENT_FACES, FACE_SUBSETS, PRINT_WEIGHTS, faceFile, faceStyles, fontFaceCss, hasStaticCuts, staticFaceFile } = require("./fonts.ts");
const { embeddedFontSources } = require("./fonts-server.ts");
const { composeSlide, W, H } = require("./slide-scene.ts");
const { deckHtml, deckFaces } = require("./render-deck.ts"), { bookHtml } = require("./render-book.ts"), { deckPptx, PPTX_MONO } = require("./pptx.ts");
const { DocumentEditor, DocToolInputs, deckRhythmIssues, emptyDocument } = require("./editor.ts");
const { parseBookMarkup } = require("./book-markup.ts");
const { projectDocument } = require("./project.ts");
const { DECK_SYSTEM, BOOK_SYSTEM } = require("../builder/docs-prompt.ts");
const fixtures = require("./fixtures/design-quality.cjs");

const repo = path.resolve(__dirname, "../../..");
const modulesRoot = path.dirname(path.dirname(path.dirname(require.resolve("playwright/package.json"))));
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
const parse = doc => DocumentSourceSchema.parse(doc);
const OFFICE = new Set(["Georgia", "Segoe UI", "Segoe UI Semibold", "Century Gothic", "Palatino Linotype", "Garamond", "Franklin Gothic Medium", "Arial", "Trebuchet MS", "Verdana", "Bahnschrift", "Impact", "Consolas"]);
const GENERIC = new Set(["serif", "sans-serif", "monospace"]);
const families = stack => stack.split(",").map(part => part.trim().replace(/^"|"$/g, ""));

/** Natural (line-box) height and width of every text primitive versus its box. */
async function htmlOverflow(page) {
  return page.evaluate(() => [...document.querySelectorAll(".slide")].flatMap((slide, index) => [...slide.querySelectorAll(".t")].flatMap(element => {
    const box = element.getBoundingClientRect(), height = element.style.height;
    element.style.height = "auto"; const natural = element.getBoundingClientRect().height; element.style.height = height;
    const wide = element.scrollWidth - element.clientWidth;
    return natural > box.height + 2 || wide > 1 ? [{ slide: index + 1, text: element.textContent.slice(0, 50), natural: Math.round(natural), box: Math.round(box.height), wide }] : [];
  })));
}
const pptxSlides = async bytes => {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)[1]) - Number(/(\d+)\.xml$/.exec(b)[1]));
  return Promise.all(names.map(name => zip.file(name).async("string")));
};
const textShapes = xml => [...xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)].map(([, body]) => body).filter(body => /<a:t>/.test(body)).map(body => {
  const off = /<a:off x="(-?\d+)" y="(-?\d+)"\/>/.exec(body), ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(body);
  return { x: +off[1] / 9525, y: +off[2] / 9525, w: +ext[1] / 9525, h: +ext[2] / 9525, faces: [...body.matchAll(/<a:latin typeface="([^"]+)"/g)].map(m => m[1]), spacing: [...body.matchAll(/<a:lnSpc><a:(spcPts|spcPct) val="(\d+)"\/>/g)].map(m => [m[1], +m[2]]), sizes: [...body.matchAll(/ sz="(\d+)"/g)].map(m => +m[1] / 100), spc: [...body.matchAll(/ spc="(-?\d+)"/g)].map(m => +m[1] / 100) };
});

(async () => {
  const art = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: "#5B7F7A" } }).jpeg().toBuffer();
  const artUrl = `data:image/jpeg;base64,${art.toString("base64")}`;

  await check("saved documents stay valid: motif, new layouts and new pairings are optional additions", () => {
    const legacy = parse({ ...emptyDocument("deck", "Legacy"), slides: [{ id: "a", layout: "statement", title: "Old slide", notes: "n" }] });
    assert.equal(legacy.theme.motif, undefined, "no stored default is added");
    for (const pairing of ["editorial", "modern", "geometric", "classic", "garamond", "grotesk", "humanist", "condensed"]) assert.ok(FONT_PAIRINGS.includes(pairing), `${pairing} still accepted`);
    assert.deepEqual(SLIDE_LAYOUTS.slice(0, 12), ["cover", "section", "statement", "points", "split", "stats", "chart", "diagram", "compare", "quote", "image", "closing"]);
    assert.equal(DocumentSourceSchema.safeParse({ ...legacy, theme: { ...legacy.theme, motif: "confetti" } }).success, false);
    for (const [layout, field] of [["team", "people"], ["pricing", "tiers"], ["table", "table"]]) assert.match(JSON.stringify(DocumentSourceSchema.safeParse({ ...legacy, slides: [{ id: "x", layout, title: "t", notes: "n" }] }).error.issues), new RegExp(field));
    assert.equal(DocumentSourceSchema.safeParse({ ...legacy, slides: [{ id: "x", layout: "table", title: "t", notes: "n", table: { columns: ["a", "b"], rows: [["only one"]] } }] }).success, false, "row width must match columns");
    assert.equal(DocumentSourceSchema.safeParse({ ...legacy, slides: [{ id: "x", layout: "table", title: "t", notes: "n", table: { columns: ["a", ""], rows: [["1", "2"]] } }] }).success, false, "only the corner heading may be empty");
    assert.equal(DocumentSourceSchema.safeParse({ ...legacy, slides: [{ id: "x", layout: "pricing", title: "t", notes: "n", tiers: [{ name: "a", price: "$1", highlight: true }, { name: "b", price: "$2", highlight: true }] }] }).success, false, "one highlighted tier");
  });

  await check("set_theme accepts a motif and keeps the current one when omitted", () => {
    const editor = new DocumentEditor(emptyDocument("deck", "Deck"));
    const palette = fixtures.palette;
    assert.match(editor.apply("set_theme", { palette, fonts: "fraunces", motif: "band" }), /fraunces, band motif/);
    editor.apply("set_theme", { palette, fonts: "geist" });
    assert.equal(editor.doc.theme.motif, "band");
    assert.equal(editor.doc.theme.fonts, "geist");
    assert.ok(DocToolInputs.set_theme.safeParse({ palette, fonts: "modern" }).success, "old set_theme calls stay valid");
  });

  await check("every pairing × motif × layout composes inside the canvas without fit issues", () => {
    let slides = 0;
    for (const fonts of FONT_PAIRINGS) for (const motif of [undefined, ...MOTIFS]) {
      const doc = parse(fixtures.deck(fonts, motif));
      doc.slides.forEach((slide, index) => {
        const scene = composeSlide(doc, slide, index, doc.slides.length);
        assert.deepEqual(scene.issues, [], `${fonts}/${motif ?? "default"}/${slide.id}: ${scene.issues.join("; ")}`);
        for (const prim of scene.prims) {
          if (prim.k === "line") assert.ok(Math.min(prim.x1, prim.x2) >= 0 && Math.max(prim.x1, prim.x2) <= W && Math.min(prim.y1, prim.y2) >= 0 && Math.max(prim.y1, prim.y2) <= H, `${fonts}/${motif}/${slide.id} line outside canvas`);
          else if (prim.k !== "ellipse") assert.ok(prim.x >= 0 && prim.y >= 0 && prim.x + prim.w <= W + 0.5 && prim.y + prim.h <= H + 0.5, `${fonts}/${motif}/${slide.id} ${prim.k} outside canvas`);
          if (prim.k === "text" && slide.layout !== "cover" && slide.layout !== "closing" && slide.layout !== "image" && slide.layout !== "section") assert.ok(prim.y >= 28, `${slide.id}: text inside the top safe margin`);
        }
        slides++;
      });
    }
    assert.ok(slides >= 16 * 6 * 18);
  });

  await check("every pairing embeds open-licensed faces so the serverless PDF never falls back to Open Sans", async () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(repo, "infra/project-runtime/font-catalog.json"), "utf8"));
    // The export route traces exactly the files the PDF printer reads: the static print cuts of variable faces
    // (Chromium embeds variable fonts as Type 3), the variable file only for condensed widths, single static files as they are.
    const traced = require(path.join(repo, "next.config.ts")).default.outputFileTracingIncludes["/api/cloud/workspaces/*/artifacts/*/document-export"]
      .map(glob => new RegExp(`^${glob.replace(/^\.\//, "").replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\0").replace(/\*/g, "[^/]*").replace(/\0/g, ".*")}$`));
    const isTraced = file => traced.some(glob => glob.test(file));
    for (const [id, face] of Object.entries(DOCUMENT_FACES)) {
      const entry = catalog.find(font => font.id === id);
      assert.ok(entry, `${id} is in the website font catalogue, so public/builder-runtime/fonts serves it`);
      assert.deepEqual([entry.family, entry.axis, entry.weight, entry.italic], [face.family, face.axis, face.weight, face.italic], `${id} matches the catalogue`);
      for (const style of faceStyles(id)) for (const subset of FACE_SUBSETS) {
        const screen = `node_modules/${face.pkg}/${id}/files/${faceFile(id, style, subset)}`;
        assert.ok(fs.existsSync(path.join(modulesRoot, screen)), `${id} ${style} ${subset} file installed`);
        assert.equal(isTraced(screen), !hasStaticCuts(id) || "stretch" in face, `${screen}: traced only where the printer reads it`);
        if (hasStaticCuts(id)) for (const weight of PRINT_WEIGHTS) {
          const cut = `node_modules/@fontsource/${id}/files/${staticFaceFile(id, style, weight, subset)}`;
          assert.ok(fs.existsSync(path.join(modulesRoot, cut)), `${cut} installed`);
          assert.ok(isTraced(cut), `${cut} traced into the export route`);
        }
      }
    }
    // Only the print weights are traced: no other static cut ships with the route.
    const cutsDir = id => path.join(modulesRoot, "node_modules/@fontsource", id, "files");
    for (const id of Object.keys(DOCUMENT_FACES).filter(hasStaticCuts)) for (const file of fs.readdirSync(cutsDir(id)))
      assert.equal(isTraced(`node_modules/@fontsource/${id}/files/${file}`), /^[a-z-]+-latin(-ext)?-(400|600|700)-(normal|italic)\.woff2$/.test(file) && file.startsWith(`${id}-latin`), `${id}/${file}`);
    for (const fonts of FONT_PAIRINGS) {
      const pairing = FONTS[fonts];
      for (const stack of [pairing.heading, pairing.body]) {
        const names = families(stack), embedded = names.find(name => Object.values(DOCUMENT_FACES).some(face => face.family === name));
        assert.ok(embedded, `${fonts}: "${stack}" names an embedded face`);
        assert.ok(pairing.faces.some(id => DOCUMENT_FACES[id].family === embedded), `${fonts}: ${embedded} is declared in faces`);
        // Nothing generic or Open Sans may come before the embedded face.
        assert.ok(names.slice(0, names.indexOf(embedded)).every(name => !GENERIC.has(name)), `${fonts}: embedded face precedes generic fallbacks`);
      }
      assert.ok(OFFICE.has(pairing.pptxHeading) && OFFICE.has(pairing.pptxBody), `${fonts}: PPTX uses Office faces`);
      const sources = await embeddedFontSources(pairing.faces, modulesRoot);
      const css = fontFaceCss(pairing.faces, sources);
      for (const id of pairing.faces) for (const style of faceStyles(id)) assert.ok(css.includes(`font-family:"${DOCUMENT_FACES[id].family}";font-style:${style}`) && css.includes("data:font/woff2;base64,"), `${fonts}: ${id} ${style} embedded`);
      const html = deckHtml(parse(fixtures.deck(fonts)), {}, "print", sources);
      assert.ok(!/url\(\/builder-runtime/.test(html), "print HTML uses only inline font data");
    }
    // The preview uses same-origin copies; untrusted sources are never emitted.
    assert.match(fontFaceCss(["inter"]), /url\(\/builder-runtime\/fonts\/inter-normal\.woff2\)/);
    assert.equal(fontFaceCss(["inter"], { "inter:normal": "https://evil.example/x.woff2" }), "");
  });

  await check("measured in Chromium with the embedded faces: no slide text spills its box for any pairing or motif", async () => {
    const browser = await chromium.launch({ headless: true });
    let pages = 0, boxes = 0;
    try {
      const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block", viewport: { width: W, height: H } });
      await context.route("**/*", route => route.abort());
      // Ordinary copy for every pairing and motif, then copy dominated by wide glyphs (m, w, capitals).
      const cases = [...FONT_PAIRINGS.map((fonts, i) => [fonts, MOTIFS[i % MOTIFS.length], fixtures.deck]), ...MOTIFS.map(motif => ["instrument", motif, fixtures.deck]), ["modern", undefined, fixtures.deck],
        ...FONT_PAIRINGS.map((fonts, i) => [fonts, MOTIFS[(i + 2) % MOTIFS.length], fixtures.wideDeck])];
      for (const [fonts, motif, make] of cases) {
        const doc = parse(make(fonts, motif));
        // Slides the layout engine already reports as too long are excluded: the agent is told to shorten those.
        const flagged = new Set(doc.slides.flatMap((slide, index) => composeSlide(doc, slide, index, doc.slides.length).issues.length ? [index + 1] : []));
        const page = await context.newPage();
        await page.setContent(deckHtml(doc, { art: artUrl }, "print", await embeddedFontSources(deckFaces(doc), modulesRoot)), { waitUntil: "load" });
        await page.emulateMedia({ media: "print" });
        await page.evaluate(() => document.fonts.ready);
        // Fallback faces load lazily (only where the Office face is missing), so load each explicitly to prove its data decodes.
        const loaded = await page.evaluate(async families => Promise.all(families.map(async family => (await document.fonts.load(`16px "${family}"`)).length > 0 && document.fonts.check(`16px "${family}"`))), FONTS[fonts].faces.map(id => DOCUMENT_FACES[id].family));
        assert.ok(loaded.every(Boolean), `${fonts}: embedded faces decode`);
        const overflow = (await htmlOverflow(page)).filter(entry => !flagged.has(entry.slide));
        assert.deepEqual(overflow, [], `${fonts}/${motif}/${make.name}: ${JSON.stringify(overflow.slice(0, 3))}`);
        boxes += await page.locator(".t").count();
        await page.close(); pages++;
      }
    } finally { await browser.close(); }
    assert.ok(pages >= 38 && boxes > 2000);
  });

  await check("PPTX: same boxes as the scene, Office faces, exact line pitch, heading tracking and fade transitions", async () => {
    for (const fonts of FONT_PAIRINGS) {
      const doc = parse(fixtures.deck(fonts, MOTIFS[FONT_PAIRINGS.indexOf(fonts) % MOTIFS.length]));
      const xmls = await pptxSlides(await deckPptx(doc, { art }));
      assert.equal(xmls.length, doc.slides.length);
      xmls.forEach((xml, index) => {
        const scene = composeSlide(doc, doc.slides[index], index, doc.slides.length);
        const texts = scene.prims.filter(prim => prim.k === "text"), shapes = textShapes(xml);
        assert.equal(shapes.length, texts.length, `${fonts} slide ${index + 1}: one native text box per text primitive`);
        texts.forEach((prim, i) => {
          const shape = shapes[i];
          assert.ok(Math.abs(shape.x - prim.x) < 0.6 && Math.abs(shape.y - prim.y) < 0.6 && Math.abs(shape.w - prim.w) < 0.6 && Math.abs(shape.h - prim.h) < 0.6, `${fonts} slide ${index + 1}: box parity for "${prim.text}"`);
          assert.ok(shape.faces.every(face => face === (prim.font === "heading" ? FONTS[fonts].pptxHeading : prim.font === "mono" ? PPTX_MONO : FONTS[fonts].pptxBody)), `${fonts}: PPTX face for ${prim.font}`);
          assert.ok(shape.spacing.length && shape.spacing.every(([kind, value]) => kind === "spcPts" && Math.abs(value / 100 - Math.round(prim.size * prim.lh * 0.75 * 10) / 10) < 0.06), `${fonts} slide ${index + 1}: exact line pitch equals the preview's line-height`);
          if (prim.font === "heading" && prim.tracking === undefined && parseFloat(FONTS[fonts].headingTracking)) assert.ok(shape.spc.length && shape.spc.every(value => value < 0), `${fonts}: heading tracking carried into PPTX`);
        });
        assert.match(xml, /<\/p:clrMapOvr><p:transition spd="med"><p:fade\/><\/p:transition><\/p:sld>$/, "transition sits after clrMapOvr");
      });
    }
  });

  await check("PPTX text fits its boxes when laid out with the Office faces and PowerPoint's exact line pitch", async () => {
    const browser = await chromium.launch({ headless: true });
    let measured = 0, skipped = 0;
    try {
      const page = await browser.newPage();
      await page.setContent("<body></body>");
      const installed = await page.evaluate(faces => faces.filter(face => {
        const probe = text => { const span = document.createElement("span"); span.style.cssText = `font:400 60px ${text};white-space:nowrap`; span.textContent = "The quick brown fox 0123"; document.body.append(span); const width = span.getBoundingClientRect().width; span.remove(); return width; };
        return Math.abs(probe(`"${face}", monospace`) - probe("monospace")) > 1;
      }), [...OFFICE]);
      for (const [fonts, make] of [...FONT_PAIRINGS.map(fonts => [fonts, fixtures.deck]), ...FONT_PAIRINGS.map(fonts => [fonts, fixtures.wideDeck])]) {
        const doc = parse(make(fonts, MOTIFS[FONT_PAIRINGS.indexOf(fonts) % MOTIFS.length]));
        const flagged = new Set(doc.slides.flatMap((slide, index) => composeSlide(doc, slide, index, doc.slides.length).issues.length ? [index + 1] : []));
        const xmls = await pptxSlides(await deckPptx(doc, { art }));
        const runs = xmls.flatMap((xml, slide) => [...xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)].map(([, body]) => body).filter(body => /<a:t>/.test(body)).map(body => {
          const shape = textShapes(`<p:sp>${body}</p:sp>`)[0];
          const text = [...body.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")).join(" ");
          return { slide: slide + 1, text, face: shape.faces[0], size: shape.sizes[0], pitch: shape.spacing[0][1] / 100, bold: / b="1"/.test(body), italic: / i="1"/.test(body), spc: shape.spc[0] ?? 0, w: shape.w, h: shape.h };
        }));
        assert.ok(runs.length > 50);
        const usable = runs.filter(run => installed.includes(run.face) && !flagged.has(run.slide));
        skipped += runs.length - usable.length;
        const overflow = await page.evaluate(runs => runs.flatMap(run => {
          const div = document.createElement("div");
          div.style.cssText = `position:absolute;width:${run.w}px;font-family:'${run.face}';font-size:${run.size * 4 / 3}px;line-height:${run.pitch * 4 / 3}px;font-weight:${run.bold ? 700 : 400};font-style:${run.italic ? "italic" : "normal"};letter-spacing:${run.spc * 4 / 3}px;font-kerning:none;overflow-wrap:anywhere`;
          div.textContent = run.text; document.body.append(div);
          const height = div.getBoundingClientRect().height; div.remove();
          return height > run.h + 2 ? [{ slide: run.slide, text: run.text.slice(0, 40), height: Math.round(height), box: Math.round(run.h) }] : [];
        }), usable);
        assert.deepEqual(overflow, [], `${fonts}/${make.name}: ${JSON.stringify(overflow.slice(0, 3))}`);
        measured += usable.length;
      }
    } finally { await browser.close(); }
    // Office faces exist on the Windows/macOS machines this runs on; elsewhere the parity checks above still apply.
    console.log(`  measured ${measured} PPTX text boxes with installed Office faces (${skipped} skipped: face not installed)`);
  });

  await check("presenter view: script-free CSS transitions and builds, instant under reduced motion", async () => {
    const doc = parse(fixtures.deck("geist", "grid"));
    const html = deckHtml(doc, { art: artUrl }, "present");
    assert.ok(!/<script|\son[a-z]+=/i.test(html), "no scripts or inline handlers");
    assert.match(html, /prefers-reduced-motion:reduce/);
    assert.equal((html.match(/class="slide is-current"/g) || []).length, 1, "first slide visible without any host script");
    assert.ok(!/ m-(title|text|shape|line|art|img|chart)/.test(deckHtml(doc, {}, "print")) && !/ m-(title|text|shape)/.test(deckHtml(doc, {}, "preview")), "print and preview carry no motion markup");
    const browser = await chromium.launch({ headless: true });
    try {
      for (const reducedMotion of ["no-preference", "reduce"]) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion, javaScriptEnabled: false });
        await context.route("**/*", route => route.abort());
        const page = await context.newPage();
        await page.setContent(html, { waitUntil: "load" });
        const state = await page.evaluate(() => {
          const slides = [...document.querySelectorAll(".deck .slide")];
          slides[0].classList.replace("is-current", "is-past"); slides[1].classList.add("is-current");
          const title = slides[1].querySelector(".m-title"), style = getComputedStyle(slides[1]);
          return { visible: style.visibility, duration: style.transitionDuration, animation: getComputedStyle(title).animationName };
        });
        assert.equal(state.visible, "visible");
        if (reducedMotion === "reduce") { assert.match(state.duration, /^0s/); assert.equal(state.animation, "none"); }
        else { assert.notEqual(state.duration.split(",")[0].trim(), "0s"); assert.match(state.animation, /^mb-/, "the title enters with its direction's choreography"); }
        await context.close();
      }
    } finally { await browser.close(); }
  });

  await check("rhythm advisories catch repetitive decks and pass a varied one", () => {
    const base = { title: "t", notes: "n", points: [{ text: "a" }, { text: "b" }] };
    const same = { slides: ["a", "b", "c"].map(id => ({ id, layout: "points", ...base })) };
    assert.match(deckRhythmIssues(same)[0].message, /all use the points layout/);
    const heavy = { slides: [{ id: "a", layout: "points", ...base }, { id: "b", layout: "compare", ...base }, { id: "c", layout: "table", ...base }] };
    assert.match(deckRhythmIssues(heavy)[0].message, /text-heavy/);
    assert.deepEqual(deckRhythmIssues(parse(fixtures.deck("geist", "grid"))).filter(issue => !/text-heavy/.test(issue.message)), []);
    const editor = new DocumentEditor(emptyDocument("deck", "Deck"));
    for (const id of ["a", "b", "c"]) editor.apply("write_slide", { slide: { id, layout: "points", ...base } });
    assert.ok(editor.problems().some(problem => /rhythm/.test(problem)), "first finish surfaces rhythm");
    assert.deepEqual(editor.problems(), [], "advisory, like fit: the second finish is accepted");
  });

  await check("books: pull quotes, motif covers and embedded faces in print", async () => {
    assert.deepEqual(parseBookMarkup("[[pullquote:Make next month boring.|A client]]"), [{ type: "pullquote", text: "Make next month boring.", attribution: "A client" }]);
    const doc = parse(fixtures.book("fraunces", "frame"));
    const sources = await embeddedFontSources(FONTS.fraunces.faces, modulesRoot);
    const html = bookHtml(doc, {}, "print", sources);
    assert.match(html, /<aside class="pullquote"><p>The goal is not to earn more next month\. The goal is to make next month boring\.<\/p><span>— A client<\/span><\/aside>/);
    assert.match(html, /\.chapter h3\{[^}]*break-inside:avoid/, "the subheading rule never strands at a page foot");
    assert.ok(projectDocument(doc, () => "id").some(section => section.blocks.some(block => block.type === "quote" && /boring/.test(block.text))), "pull quotes survive the outline projection");
    for (const motif of [undefined, ...MOTIFS]) {
      const page = bookHtml(parse(fixtures.book("garamond", motif)), {}, "preview");
      if (!motif || motif === "orbit") assert.match(page, /<div class="disc"><\/div><div class="ring"><\/div>/);
      else assert.match(page, new RegExp(`class="full cover motif-${motif}"`));
    }
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 576, height: 864 } });
      await context.route("**/*", route => route.abort());
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: "load" }); await page.emulateMedia({ media: "print" }); await page.evaluate(() => document.fonts.ready);
      assert.ok(await page.evaluate(() => document.fonts.check('16px "Fraunces"') && document.fonts.check('16px "Inter"')));
      assert.ok((await page.pdf({ preferCSSPageSize: true, printBackground: true })).length > 10_000);
    } finally { await browser.close(); }
  });

  await check("agent guidance names every pairing, motif and new layout, and asks for takeaway headlines", () => {
    for (const fonts of FONT_PAIRINGS) assert.ok(DECK_SYSTEM.includes(`${fonts} = `) && BOOK_SYSTEM.includes(`${fonts} = `), `${fonts} documented`);
    for (const motif of Object.keys(MOTIF_NOTES)) assert.ok(DECK_SYSTEM.includes(`${motif} = `), `${motif} documented`);
    for (const layout of ["team", "pricing", "table"]) assert.match(DECK_SYSTEM, new RegExp(`- ${layout}:`));
    assert.match(DECK_SYSTEM, /HEADLINES ARE THE TAKEAWAY/);
    assert.match(DECK_SYSTEM, /RHYTHM:/);
    assert.match(BOOK_SYSTEM, /\[\[pullquote:/);
  });

  console.log(`\n${passed} design-quality checks passed.`);
})().catch(error => { console.error(error); process.exit(1); });
