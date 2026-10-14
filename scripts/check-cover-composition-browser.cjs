/* eslint-disable @typescript-eslint/no-require-imports -- Local synthetic renderer qualification; no services or model calls. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const { chromium } = require("playwright"), sharp = require("sharp");
const { fixtures, text } = require("../src/lib/documents/fixtures/authored-covers.cjs");
const { DocumentSourceSchema } = require("../src/lib/documents/schema.ts");
const { bookHtml } = require("../src/lib/documents/render-book.ts"), { deckHtml } = require("../src/lib/documents/render-deck.ts"), { deckPptx } = require("../src/lib/documents/pptx.ts");
const output = path.join(process.cwd(), "outputs/authored-cover-qualification");
fs.mkdirSync(output, { recursive: true });
const report = { synthetic: true, modelGenerated: false, externalRequests: 0, providerCalls: 0, cases: [], cropParity: false };
async function inspectText(page, selector) {
  return page.locator(selector).evaluateAll(elements => elements.flatMap(element => {
    const box = element.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(element);
    return [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0 && (rect.left < box.left - 2 || rect.right > box.right + 2 || rect.top < box.top - 2 || rect.bottom > box.bottom + 2)).map(rect => ({ text: element.textContent, box: { x: box.x, y: box.y, w: box.width, h: box.height }, textBox: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } }));
  }));
}
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: "block" });
    await context.route("**/*", route => { report.externalRequests++; return route.abort(); });
    const page = await context.newPage();
    for (const { id, book, deck } of fixtures()) {
      const item = { id, synthetic: true, book: {}, slides: [] };
      const preview = bookHtml(book, {});
      fs.writeFileSync(path.join(output, `${id}-book.html`), preview);
      await page.setContent(preview); await page.evaluate(() => document.fonts.ready);
      const cover = page.locator(".authored-cover"), dimensions = await cover.boundingBox();
      assert.ok(Math.abs(dimensions.width / dimensions.height - 2 / 3) < 0.001);
      assert.deepEqual(await inspectText(page, ".authored-cover [data-cover-text]"), []);
      assert.equal(await cover.locator("h1").innerText(), book.title);
      await cover.screenshot({ path: path.join(output, `${id}-book-preview.png`) });
      await page.setContent(bookHtml(book, {}, "print")); await page.emulateMedia({ media: "print" });
      assert.deepEqual(await inspectText(page, ".authored-cover [data-cover-text]"), []);
      await page.locator(".authored-cover").screenshot({ path: path.join(output, `${id}-book-print.png`) });
      const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true }); fs.writeFileSync(path.join(output, `${id}-book.pdf`), pdf);
      assert.match(pdf.toString("latin1"), /\/MediaBox\s*\[0 0 432 648\]/);
      item.book = { width: dimensions.width, height: dimensions.height, portrait: true, textOverflow: [], pdfPoints: [432, 648] };
      await page.setContent(deckHtml(deck, {}, "print"));
      assert.deepEqual(await inspectText(page, ".slide .t"), []);
      for (let i = 0; i < deck.slides.length; i++) {
        const slide = page.locator(".slide").nth(i), box = await slide.boundingBox(); assert.equal(box.width, 1280); assert.equal(box.height, 720);
        await slide.screenshot({ path: path.join(output, `${id}-${deck.slides[i].layout}.png`) });
        item.slides.push({ layout: deck.slides[i].layout, width: box.width, height: box.height, textOverflow: [] });
      }
      const slidePdf = await page.pdf({ printBackground: true, preferCSSPageSize: true }); fs.writeFileSync(path.join(output, `${id}-deck.pdf`), slidePdf);
      assert.match(slidePdf.toString("latin1"), /\/MediaBox\s*\[0 0 960 540\]/);
      fs.writeFileSync(path.join(output, `${id}-deck.pptx`), await deckPptx(deck, {}));
      await page.emulateMedia({ media: "screen" }); await page.setContent(deckHtml(deck, {}, "preview"));
      assert.deepEqual(await inspectText(page, ".slide .t"), []);
      report.cases.push(item);
    }
    const pixels = Buffer.alloc(800 * 300 * 3);
    for (let y = 0; y < 300; y++) for (let x = 0; x < 800; x++) { const i = (y * 800 + x) * 3; pixels[i] = x < 260 ? 230 : 20; pixels[i + 1] = x >= 260 && x < 540 ? 180 : 15; pixels[i + 2] = x >= 540 ? ((x + y) % 2 ? 255 : 30) : 15; }
    const raster = await sharp(pixels, { raw: { width: 800, height: 300, channels: 3 } }).png().toBuffer();
    const deck = fixtures()[0].deck; deck.slides = [deck.slides[0]]; deck.slides[0].image = "asymmetric";
    deck.slides[0].composition.elements = [text("title", 7, 10, 48, 35, 8), { type: "image", x: 60, y: 10, w: 35, h: 80 }];
    deck.assets = [{ name: "asymmetric", id: "00000000-0000-4000-8000-000000000001", aspect: "landscape", alt: "Asymmetric synthetic raster", prompt: "" }];
    await page.setContent(deckHtml(DocumentSourceSchema.parse(deck), { asymmetric: `data:image/png;base64,${raster.toString("base64")}` }, "print"));
    const image = page.locator(".slide img"), box = await image.boundingBox(), screenshot = await image.screenshot();
    const actual = await sharp(screenshot).removeAlpha().raw().toBuffer();
    const expected = await sharp(raster).resize(Math.round(box.width), Math.round(box.height), { fit: "cover", position: "center" }).removeAlpha().raw().toBuffer();
    assert.equal(actual.length, expected.length);
    assert.ok(actual.every((value, index) => Math.abs(value - expected[index]) <= 2));
    assert.equal(await image.getAttribute("alt"), "Asymmetric synthetic raster");
    await page.locator(".slide").screenshot({ path: path.join(output, "center-crop.png") });
    report.cropParity = true;
    assert.equal(report.externalRequests, 0);
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
