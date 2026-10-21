/* eslint-disable @typescript-eslint/no-require-imports -- Render the real ebook CSS with local Chromium and embedded fonts. */
const fs = require("node:fs"), Module = require("node:module"), assert = require("node:assert/strict"), ts = require("typescript");
const load = Module._load;
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const { chromium } = require("playwright"), { emptyDocument } = require("./editor.ts"), { bookHtml } = require("./render-book.ts"), { embeddedFontSources } = require("./fonts-server.ts"), { FONTS } = require("./theme.ts");
(async () => {
  const book = { ...emptyDocument("book", "Numbered worksheets"), chapters: [{ id: "numbers", title: "Worksheet", text: "## Double digits\n\n10. Neutral colour reference\n11. Saved preset\n12. Product flaws\n\n## Three digits\n\n100. First item\n101. Second item\n102. Third item" }] };
  const fonts = await embeddedFontSources(FONTS[book.theme.fonts].faces), html = bookHtml(book, {}, "preview", fonts);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage(); let requests = 0; await page.route("**/*", route => { requests++; return route.abort(); });
    async function measure(source) {
      await page.setContent(source); await page.evaluate(() => document.fonts.ready);
      return page.locator(".chapter ol").evaluateAll(lists => lists.map(list => {
        const style = getComputedStyle(list), li = list.querySelector("li"), font = getComputedStyle(li), canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
        ctx.font = `${font.fontWeight} ${font.fontSize} ${font.fontFamily}`;
        const last = Number(list.start || 1) + list.children.length - 1;
        return { start: list.start, gutter: parseFloat(style.marginLeft), required: ctx.measureText(String(last) + ".").width + parseFloat(font.fontSize) * 0.4 };
      }));
    }
    const before = await measure(html.replace(".chapter ol{margin-left:2.75em}", "")); assert(before.some(x => x.gutter < x.required), "Regression must reproduce the old insufficient marker gutter");
    const after = await measure(html); assert.equal(after.length, 2); assert.deepEqual(after.map(x => x.start), [10, 100]); assert(after.every(x => x.gutter >= x.required)); assert.equal(requests, 0);
    console.log("PASS real book markup retains double/triple-digit starts and keeps markers inside page gutters with embedded fonts, no network");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
