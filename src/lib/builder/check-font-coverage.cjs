/* eslint-disable @typescript-eslint/no-require-imports -- Offline Unicode font-coverage qualification (audit M13/M16):
   the installed font files' character maps, the CSS every output declares, and Chromium renders of a website,
   a book and a deck (preview, print and PDF) plus the PPTX text, for regional names such as Ćevapčići and Łódź.
   No network beyond a 127.0.0.1 file server, no providers. MAKEBORNE_FONT_EVIDENCE_DIR=<dir> also saves the
   rendered HTML, screenshots, PDFs, PPTX and a JSON coverage report there. */
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), zlib = require("node:zlib");
const ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  // Node esbuild-wasm needs no browser initialisation (wasmURL/worker).
  if (name === "esbuild-wasm" && parent?.filename?.endsWith("browser-bundler.ts")) return {...load.call(this, name, parent, main), initialize: async () => {}};
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true}}).outputText, filename);
const JSZip = require("jszip");
const {chromium} = require("playwright");
const {inspectFont} = require("./font-cmap.cjs");
const portable = require("../../../infra/project-runtime/font-portability.cjs");
const builderFonts = require("./fonts.ts");
const {ProjectFiles} = require("./files.ts");
const {DOCUMENT_FACES, FACE_SUBSETS, faceFile, faceKey, facePublicUrl, faceStyles, fontFaceCss} = require("../documents/fonts.ts");
const {embeddedFontSources} = require("../documents/fonts-server.ts");
const {DocumentSourceSchema} = require("../documents/schema.ts");
const {FONTS} = require("../documents/theme.ts");
const {deckHtml, deckFaces} = require("../documents/render-deck.ts"), {bookHtml} = require("../documents/render-book.ts");
const {deckPptx} = require("../documents/pptx.ts");
const {documentPdf} = require("../documents/export-server.ts");
const fixtures = require("../documents/fixtures/design-quality.cjs");

const repo = path.resolve(__dirname, "../../..");
const runtimeFonts = path.join(repo, "public", "builder-runtime", "fonts");
const evidence = process.env.MAKEBORNE_FONT_EVIDENCE_DIR ? path.resolve(process.env.MAKEBORNE_FONT_EVIDENCE_DIR) : null;
if (evidence) fs.mkdirSync(evidence, {recursive: true});
const save = (name, bytes) => { if (evidence) fs.writeFileSync(path.join(evidence, name), bytes); };
const report = {};

/** The audit's names plus Central/Eastern European and Turkish letters (both cases). */
const SAMPLE = "Ćevapčići, Łódź, Đurđevdan, Šibenik, Žabljak";
const REGIONAL = "ĆćČčŠšĐđŽžŁłŹźŻżŐőŰűĞğŞşİ";
const ASCII = Array.from({length: 0x7f - 0x20}, (_, index) => String.fromCharCode(0x20 + index)).join("");
const points = text => [...new Set([...text].map(char => char.codePointAt(0)))];
const pkgDir = font => path.join(repo, "node_modules", portable.fontPackage(font));
const styles = font => font.italic ? ["normal", "italic"] : ["normal"];
const missing = (cmap, text) => points(text).filter(point => !cmap.has(point)).map(point => String.fromCodePoint(point)).join("");

let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }

/** Fonts Chromium actually drew for the regional text of the page (direct text of each element). */
async function drawnFonts(context, page) {
  const marked = await page.evaluate(regional => {
    let index = 0;
    for (const element of document.querySelectorAll("body *")) {
      const own = [...element.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent).join("");
      if ([...own].some(char => regional.includes(char))) element.setAttribute("data-font-probe", String(index++));
    }
    return index;
  }, REGIONAL);
  const cdp = await context.newCDPSession(page);
  await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
  const {root} = await cdp.send("DOM.getDocument", {depth: -1});
  const found = [];
  for (let index = 0; index < marked; index++) {
    const {nodeId} = await cdp.send("DOM.querySelector", {nodeId: root.nodeId, selector: `[data-font-probe="${index}"]`});
    const {fonts} = await cdp.send("CSS.getPlatformFontsForNode", {nodeId});
    const text = await page.$eval(`[data-font-probe="${index}"]`, element => [...element.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent).join("").trim().slice(0, 60));
    found.push({text, fonts: fonts.map(font => ({family: font.familyName, custom: font.isCustomFont, glyphs: font.glyphCount}))});
  }
  await cdp.detach();
  return found;
}
/** Every regional run is drawn only by the embedded faces, never a system fallback. */
function assertIntended(label, drawn, families) {
  assert.ok(drawn.length > 0, `${label}: regional text is on the page`);
  for (const node of drawn) for (const font of node.fonts) {
    assert.ok(font.custom && families.some(family => font.family.startsWith(family)), `${label}: "${node.text}" drew ${font.glyphs} glyph(s) with ${font.family}${font.custom ? "" : " (system fallback)"}; expected ${families.join(" / ")}`);
  }
}
const withoutLatinExt = html => html.replace(/@font-face\{[^{}]*unicode-range:U\+0100-[^{}]*\}\n?/g, "");

/** Fonts embedded in a Chromium PDF and the Unicode text each one draws (from its ToUnicode CMap). */
function pdfFonts(bytes) {
  const text = bytes.toString("latin1"), objects = new Map();
  for (const match of text.matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/g)) objects.set(Number(match[1]), {body: match[2], at: match.index + match[0].indexOf(match[2])});
  const stream = id => {
    const object = objects.get(id), start = object.body.indexOf("stream");
    if (start < 0) return null;
    const dataStart = object.at + start + "stream".length + (text[object.at + start + 6] === "\r" ? 2 : 1);
    const length = Number(/\/Length (\d+)/.exec(object.body)[1]);
    const data = bytes.subarray(dataStart, dataStart + length);
    return /\/FlateDecode/.test(object.body.slice(0, start)) ? zlib.inflateSync(data) : data;
  };
  const fonts = [];
  for (const [, object] of objects) {
    if (!/\/Type\s*\/Font\b/.test(object.body) || !/\/ToUnicode (\d+) 0 R/.test(object.body)) continue;
    // Skia writes variable fonts as Type3 fonts: their name is on the font descriptor.
    const descriptor = objects.get(Number(/\/FontDescriptor (\d+) 0 R/.exec(object.body)?.[1]))?.body ?? "";
    const name = /\/FontFamily\s*\(([^)]*)\)/.exec(descriptor)?.[1] ?? /\/BaseFont\s*\/([^\s/<>[\]]+)/.exec(object.body)?.[1] ?? /\/FontName\s*\/([^\s/<>[\]]+)/.exec(descriptor)?.[1] ?? "(unnamed)";
    const cmap = stream(Number(/\/ToUnicode (\d+) 0 R/.exec(object.body)[1])).toString("latin1"), drawn = new Set();
    const decode = hex => { let out = ""; for (let at = 0; at + 4 <= hex.length; at += 4) out += String.fromCharCode(parseInt(hex.slice(at, at + 4), 16)); return out; };
    for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const pair of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) for (const char of decode(pair[2])) drawn.add(char);
    for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) for (const range of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]+>|\[[^\]]*\])/g)) {
      const low = parseInt(range[1], 16), high = parseInt(range[2], 16);
      if (range[3].startsWith("[")) for (const item of range[3].matchAll(/<([0-9A-Fa-f]+)>/g)) for (const char of decode(item[1])) drawn.add(char);
      else { const first = parseInt(range[3].slice(1, -1), 16); for (let code = first; code <= first + high - low; code++) drawn.add(String.fromCharCode(code)); }
    }
    fonts.push({name: name.replace(/^[A-Z]{6}\+/, ""), drawn});
  }
  return fonts;
}
function assertPdf(label, bytes, families) {
  const fonts = pdfFonts(bytes);
  assert.ok(fonts.length > 0, `${label}: PDF embeds fonts`);
  for (const char of REGIONAL.replace("İ", "")) {
    const users = fonts.filter(font => font.drawn.has(char));
    if (!users.length) continue;
    for (const font of users) assert.ok(families.some(family => font.name.replace(/[-_ ]/g, "").toLowerCase().startsWith(family.replace(/ /g, "").toLowerCase())), `${label}: "${char}" is drawn by embedded ${font.name}, expected ${families.join(" / ")}`);
  }
  for (const char of new Set(SAMPLE.replace(/[ ,]/g, ""))) assert.ok(fonts.some(font => font.drawn.has(char)), `${label}: "${char}" is drawn`);
  return fonts.map(font => ({font: font.name, regional: [...font.drawn].filter(char => REGIONAL.includes(char)).join("")}));
}

(async () => {
  // Refresh the generated same-origin font copies (offline, idempotent).
  const prepared = require("node:child_process").spawnSync(process.execPath, ["scripts/prepare-builder-runtime.mjs"], {cwd: repo, encoding: "utf8"});
  assert.equal(prepared.status, 0, prepared.stderr);

  await check("Fontsource ranges match the shared declaration; latin-ext is required only for text beyond latin", () => {
    for (const font of portable.catalog) {
      const ranges = JSON.parse(fs.readFileSync(path.join(pkgDir(font), "unicode.json"), "utf8"));
      for (const subset of portable.FONT_SUBSETS) assert.equal(ranges[subset], portable.UNICODE_RANGES[subset], `${font.id} ${subset}`);
    }
    assert.deepEqual(portable.FONT_SUBSETS, ["latin-ext", "latin"], "extended first, base last (the base wins overlaps)");
    for (const text of ["Plain English, café, naïve, £20 – “quoted” † 2026", "Istanbul ı"]) assert.deepEqual(builderFonts.fontSubsets([text]), ["latin"], text);
    for (const text of [SAMPLE, "İzmir", "Kerim Sabić", "Őrség", "Ğ", "ş", "₺"]) assert.deepEqual(builderFonts.fontSubsets(["Plain", text]), ["latin-ext", "latin"], text);
  });

  await check("every catalogue face: latin alone lacks the regional letters, latin + latin-ext covers ASCII and all of them", () => {
    for (const font of portable.catalog) for (const style of styles(font)) {
      const files = Object.fromEntries(portable.FONT_SUBSETS.map(subset => [subset, path.join(pkgDir(font), "files", portable.packageFontFile(font, style, subset))]));
      const latin = inspectFont(fs.readFileSync(files.latin)).codePoints, ext = inspectFont(fs.readFileSync(files["latin-ext"])).codePoints;
      const union = new Set([...latin, ...ext]);
      assert.equal(missing(latin, SAMPLE.replace(/[^ĆčćŁźĐđŠŽ]/g, "")).length > 0, true, `${font.id} ${style}: latin file alone covers the sample (the gap this guards is gone?)`);
      assert.equal(missing(union, ASCII + REGIONAL + "ı"), "", `${font.id} ${style}: latin + latin-ext cover ASCII and regional letters`);
      // Each regional letter comes from the file whose unicode-range claims it.
      assert.equal(missing(ext, REGIONAL.replace("ı", "")), "", `${font.id} ${style}: latin-ext file has every regional letter`);
      for (const subset of portable.FONT_SUBSETS) {
        const copy = path.join(runtimeFonts, portable.runtimeFontFile(font, style, subset));
        assert.ok(fs.readFileSync(copy).equals(fs.readFileSync(files[subset])), `${copy} is the package file`);
      }
      report[`${font.id}:${style}`] = {latinMissing: missing(latin, REGIONAL), unionMissing: missing(union, ASCII + REGIONAL), latinBytes: fs.statSync(files.latin).size, latinExtBytes: fs.statSync(files["latin-ext"]).size, extAloneMissingAscii: missing(ext, ASCII).length};
    }
    // Variable files carry every weight; the static faces (Instrument Serif, DM Serif Display, Bebas Neue) are 400 only.
    assert.ok(portable.catalog.every(font => /^\d+$/.test(font.axis) ? font.weight === font.axis : / /.test(font.weight)));
  });

  await check("documents embed, preview and trace both subset files of every face", async () => {
    const config = fs.readFileSync(path.join(repo, "next.config.ts"), "utf8");
    assert.match(config, /\.flatMap\(\(file\) => \["latin", "latin-ext"\]\.map\(\(subset\) => `\.\/node_modules\/\$\{file\.replace\("SUBSET", subset\)\}`\)\)/);
    for (const [id, face] of Object.entries(DOCUMENT_FACES)) {
      assert.ok(config.includes(`"${face.pkg}/${id}/files/${id}-SUBSET-${face.axis}-*.woff2"`), `${id} traced into the export route`);
      for (const style of faceStyles(id)) for (const subset of FACE_SUBSETS) {
        assert.ok(fs.existsSync(path.join(repo, "node_modules", face.pkg, id, "files", faceFile(id, style, subset))), `${id} ${style} ${subset} installed`);
        assert.ok(fs.existsSync(path.join(repo, "public", facePublicUrl(id, style, subset))), `${id} ${style} ${subset} served`);
      }
    }
    const sources = await embeddedFontSources(["fraunces", "inter"], repo);
    assert.deepEqual(Object.keys(sources).sort(), ["fraunces:italic", "fraunces:italic:latin-ext", "fraunces:normal", "fraunces:normal:latin-ext", "inter:italic", "inter:italic:latin-ext", "inter:normal", "inter:normal:latin-ext"]);
    const css = fontFaceCss(["fraunces"], sources);
    assert.equal((css.match(/@font-face/g) || []).length, 4);
    assert.ok(css.indexOf(`unicode-range:${portable.UNICODE_RANGES["latin-ext"]}`) < css.indexOf(`unicode-range:${portable.UNICODE_RANGES.latin}`), "extended rule precedes the base rule");
    const preview = fontFaceCss(["inter"]);
    assert.match(preview, /url\(\/builder-runtime\/fonts\/inter-latin-ext-normal\.woff2\) format\("woff2"\);unicode-range:U\+0100-/);
    assert.match(preview, /url\(\/builder-runtime\/fonts\/inter-normal\.woff2\) format\("woff2"\);unicode-range:U\+0000-00FF/);
    // A missing extended file drops only that rule: the base face keeps working.
    assert.equal((fontFaceCss(["inter"], {[faceKey("inter", "normal")]: sources["inter:normal"]}).match(/@font-face/g) || []).length, 1);
  });

  await check("portable builds link both subsets per style with their unicode-ranges", () => {
    const input = [{path: "index.html", content: "<html><head></head><body></body></html>"}, {path: "src/theme.css", content: 'body{font-family:"Inter"}h1{font-family:"Fraunces";font-style:italic}'}];
    const result = portable.portableFontFiles(input);
    const css = result.files.find(file => file.path === portable.FONT_CSS).content;
    assert.equal(result.styles.length, 4);
    assert.equal((css.match(/@font-face/g) || []).length, 8, "latin-ext + latin for every style, whatever the text");
    for (const {font, style} of result.styles) for (const subset of portable.FONT_SUBSETS) {
      const file = `./node_modules/${portable.fontPackage(font)}/files/${portable.packageFontFile(font, style, subset)}`;
      assert.ok(css.includes(`src:url(${file}) format("woff2");unicode-range:${portable.UNICODE_RANGES[subset]}`), file);
      assert.ok(fs.existsSync(path.join(repo, file)), file);
    }
  });

  // Website: the in-browser bundler (preview, review capture, snapshot) run in Node against the prepared runtime.
  const origin = "http://runtime.test";
  globalThis.location = {origin};
  globalThis.fetch = async url => {
    const file = String(url).startsWith(`${origin}/builder-runtime/`) ? path.join(repo, "public", "builder-runtime", String(url).slice(`${origin}/builder-runtime/`.length)) : "";
    return file && fs.existsSync(file) ? new Response(fs.readFileSync(file)) : new Response("missing", {status: 404});
  };
  const {bundleProject} = require("./browser-bundler.ts");
  const site = text => {
    const files = new ProjectFiles();
    files.write("index.html", '<!doctype html><html lang="hr"><head><meta charset="utf-8"><title>Coverage</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>');
    files.write("src/main.tsx", 'import { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./styles.css";\ncreateRoot(document.getElementById("root")!).render(<App />);');
    files.write("src/App.tsx", `export default function App() { return <main><h1>${text}</h1><p>${text}. Open daily from 9.</p><p><em>${text}</em></p></main>; }`);
    files.write("src/styles.css", 'body{margin:24px;font-family:"Inter",system-ui,sans-serif;font-size:20px}h1{font-family:"Fraunces",Georgia,serif;font-size:44px}');
    return Object.fromEntries(files.files);
  };
  const english = await bundleProject(site("Fresh grilled food"), {}, "publish");
  const regional = await bundleProject(site(SAMPLE), {}, "publish");
  assert.ok(english.ok && regional.ok, english.error || regional.error);
  const {buildPublishBundle} = require("./browser-bundler.ts");
  const hostedCss = (await buildPublishBundle(site(SAMPLE))).css;
  await check("website bundles embed latin-ext with its unicode-range only when the text needs it", () => {
    assert.equal((english.html.match(/@font-face\{/g) || []).length, 4, "English: latin only (Fraunces + Inter, normal + italic)");
    assert.doesNotMatch(english.html, /unicode-range:U\+0100/);
    assert.equal((regional.html.match(/@font-face\{/g) || []).length, 8);
    for (const family of ["Fraunces", "Inter"]) for (const style of ["normal", "italic"]) {
      assert.match(regional.html, new RegExp(`font-family:"${family}";font-style:${style};[^{}]*data:font/woff2;base64,[^)]+\\) format\\("woff2"\\);unicode-range:U\\+0100-`), `${family} ${style} latin-ext embedded`);
    }
    const {SITE_LIMITS} = require("../../../infra/customer-sites/site-policy.js");
    report.websiteHtmlBytes = {english: Buffer.byteLength(english.html), regional: Buffer.byteLength(regional.html), hostedHtmlLimit: SITE_LIMITS.html, regionalHostedCss: Buffer.byteLength(hostedCss), hostedStyleLimit: SITE_LIMITS.style};
    assert.ok(Buffer.byteLength(regional.html) < SITE_LIMITS.html, "regional snapshot stays inside the hosted HTML limit");
    assert.equal((hostedCss.match(/unicode-range:U\+0100-/g) || []).length, 4, "the hosted bundle stylesheet carries the latin-ext faces too");
    assert.ok(Buffer.byteLength(hostedCss) < SITE_LIMITS.style, "two families with italics and latin-ext fit the hosted stylesheet limit");
    // Published static snapshots keep both embedded faces and their ranges through sanitising.
    const {renderHostedSnapshot} = require("../hosting/snapshot.ts");
    const faces = hostedCss.match(/@font-face\{[^{}]*\}/g).join("");
    const snapshot = renderHostedSnapshot(`<!doctype html><html><head><style>${faces}</style></head><body><main><h1>${SAMPLE}</h1></main></body></html>`, "Site", "Desc", "https://sites.makeborne.com/site");
    assert.equal((snapshot.match(/unicode-range:U\+0100-/g) || []).length, 4);
    assert.equal((snapshot.match(/unicode-range:U\+0000-00FF/g) || []).length, 4);
    assert.ok(snapshot.includes(SAMPLE), "the snapshot keeps the exact Unicode text");
  });

  const book = fixtures.book("fraunces");
  Object.assign(book, {title: SAMPLE, subtitle: "Vodič za Šibenik, Łódź i Őrség", author: "Kerim Sabić"});
  book.chapters[0] = {...book.chapters[0], title: "Đurđevdan u Žabljaku", text: `${SAMPLE}. *Ćevapčići u Łódźi* i **Đurđevdan, Ğebze, Şile.**\n\n${book.chapters[0].text}`};
  const deck = fixtures.deck("fraunces");
  deck.slides = deck.slides.filter(slide => ["cover", "statement", "points3", "closing"].includes(slide.id)).map(slide => ({...slide, title: SAMPLE, ...(slide.body ? {body: "Kerim Sabić, Šibenik i Łódź: Ğebze, Şile, Őrség."} : {})}));
  const bookDoc = DocumentSourceSchema.parse(book), deckDoc = DocumentSourceSchema.parse(deck);
  const families = ["Fraunces", "Inter"];

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const file = url.pathname.startsWith("/builder-runtime/fonts/") ? path.join(runtimeFonts, path.basename(url.pathname)) : null;
    if (url.pathname === "/page" && server.page) { response.writeHead(200, {"content-type": "text/html; charset=utf-8"}); response.end(server.page); return; }
    if (file && fs.existsSync(file)) { response.writeHead(200, {"content-type": "font/woff2"}); response.end(fs.readFileSync(file)); return; }
    response.writeHead(404); response.end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const local = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({headless: true});
  try {
    const open = async (html, {viewport = {width: 1100, height: 900}, javaScriptEnabled = true, served = false, media} = {}) => {
      const context = await browser.newContext({viewport, javaScriptEnabled, serviceWorkers: "block"});
      await context.route("**/*", route => route.request().url().startsWith(local) ? route.continue() : route.abort());
      const page = await context.newPage();
      if (served) { server.page = html; await page.goto(`${local}/page`, {waitUntil: "load"}); }
      else await page.setContent(html, {waitUntil: "load"});
      if (media) await page.emulateMedia({media});
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      return {context, page};
    };

    await check("Chromium draws the regional website text in Fraunces and Inter, and the latin-only form visibly falls back", async () => {
      const {context, page} = await open(regional.html);
      await page.waitForSelector("h1");
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const drawn = await drawnFonts(context, page);
      if (evidence) { save("website-regional.html", regional.html); save("website-regional.png", await page.screenshot({fullPage: true})); }
      report.website = drawn;
      assertIntended("website", drawn, ["Fraunces", "Inter"]);
      await context.close();
      // Control: the same page without its latin-ext rules uses a system face for ć, Ł, Đ... (what main shipped).
      const control = await open(withoutLatinExt(regional.html));
      await control.page.waitForSelector("h1");
      await control.page.evaluate(() => document.fonts.ready.then(() => undefined));
      const fallback = await drawnFonts(control.context, control.page);
      if (evidence) save("website-latin-only-control.png", await control.page.screenshot({fullPage: true}));
      report.websiteLatinOnlyControl = fallback;
      assert.ok(fallback.some(node => node.fonts.some(font => !font.custom)), "the latin-only control shows the fallback this check would catch");
      await control.context.close();
    });


    await check("book and deck preview (same-origin files) and print (embedded) HTML draw regional text in their faces", async () => {
      const sources = await embeddedFontSources(deckFaces(deckDoc), repo);
      const cases = [
        ["book-preview", bookHtml(bookDoc, {}, "preview"), {viewport: {width: 576, height: 864}, served: true, javaScriptEnabled: false}],
        ["book-print", bookHtml(bookDoc, {}, "print", await embeddedFontSources(FONTS.fraunces.faces, repo)), {viewport: {width: 576, height: 864}, javaScriptEnabled: false, media: "print"}],
        ["deck-preview", deckHtml(deckDoc, {}, "preview"), {viewport: {width: 1280, height: 720}, served: true, javaScriptEnabled: false}],
        ["deck-print", deckHtml(deckDoc, {}, "print", sources), {viewport: {width: 1280, height: 720}, javaScriptEnabled: false, media: "print"}],
      ];
      for (const [label, html, options] of cases) {
        const {context, page} = await open(html, options);
        const drawn = await drawnFonts(context, page);
        if (evidence) { save(`${label}.html`, html); save(`${label}.png`, await page.screenshot()); }
        report[label] = drawn;
        assertIntended(label, drawn, families);
        await context.close();
      }
    });

    await check("PDF export (the production printer path) embeds the faces that draw every regional letter", async () => {
      for (const [label, doc] of [["book", bookDoc], ["deck", deckDoc]]) {
        const pdf = await documentPdf(doc, {});
        save(`${label}.pdf`, pdf);
        report[`${label}-pdf`] = assertPdf(`${label} PDF`, pdf, families);
      }
      // Control: printed from latin-only sources (what main embedded), another face draws the regional letters.
      const latinOnly = Object.fromEntries(Object.entries(await embeddedFontSources(FONTS.fraunces.faces, repo)).filter(([key]) => !key.endsWith(":latin-ext")));
      const {context, page} = await open(bookHtml(bookDoc, {}, "print", latinOnly), {viewport: {width: 576, height: 864}, javaScriptEnabled: false, media: "print"});
      const control = await page.pdf({printBackground: true, preferCSSPageSize: true});
      await context.close();
      assert.throws(() => assertPdf("latin-only control", control, families), /is drawn by embedded/);
      report["book-pdf-latin-only-control"] = pdfFonts(control).filter(font => [...font.drawn].some(char => REGIONAL.includes(char)) && !families.some(family => font.name.startsWith(family))).map(font => font.name);
    });
  } finally {
    await browser.close();
    server.close();
  }

  await check("PPTX keeps the exact Unicode text and names Office faces that cover it on this OS", async () => {
    const bytes = await deckPptx(deckDoc, {});
    save("deck.pptx", bytes);
    const zip = await JSZip.loadAsync(bytes);
    const slides = await Promise.all(Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).map(name => zip.file(name).async("string")));
    const xml = slides.join("");
    // Display text carries explicit balanced line breaks (<a:br/> between runs); the words themselves are unchanged NFC.
    const runs = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(match => match[1]).join(" ");
    assert.ok(runs.includes(SAMPLE.normalize("NFC")), "slide XML carries the NFC text unchanged");
    const faces = [...new Set([...xml.matchAll(/<a:latin typeface="([^"]+)"/g)].map(match => match[1]))];
    assert.deepEqual(faces.sort(), [FONTS.fraunces.pptxHeading, FONTS.fraunces.pptxBody].sort());
    // Office faces are not embedded; where this OS has them, prove their own coverage.
    const office = {Georgia: "georgia.ttf", "Segoe UI": "segoeui.ttf", "Segoe UI Semibold": "seguisb.ttf", "Century Gothic": "GOTHIC.TTF", "Palatino Linotype": "pala.ttf", Garamond: "GARA.TTF", "Franklin Gothic Medium": "framd.ttf", Arial: "arial.ttf", "Trebuchet MS": "trebuc.ttf", Verdana: "verdana.ttf", Bahnschrift: "bahnschrift.ttf", Impact: "impact.ttf", Consolas: "consola.ttf"};
    const fontsDir = process.env.WINDIR ? path.join(process.env.WINDIR, "Fonts") : null;
    report.officeFaces = {};
    for (const [family, file] of Object.entries(office)) {
      const full = fontsDir && path.join(fontsDir, file);
      if (!full || !fs.existsSync(full)) { report.officeFaces[family] = "not installed here: qualify in Office"; continue; }
      const gap = missing(inspectFont(fs.readFileSync(full)).codePoints, REGIONAL + "ı");
      report.officeFaces[family] = gap ? `missing ${gap}` : "covers regional letters";
      assert.equal(gap, "", `${family} (${file}) lacks ${gap}`);
    }
  });

  if (evidence) save("coverage-report.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${passed} font coverage groups passed; no network or provider calls${evidence ? `; evidence in ${evidence}` : ""}.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
