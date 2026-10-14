/* eslint-disable @typescript-eslint/no-require-imports -- Real Chromium layout checks for book pages at schema limits (offline; no network, no paid calls). */
const fs = require("node:fs"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true}}).outputText, filename);
const {DocumentSourceSchema} = require("./schema.ts");
const {bookHtml} = require("./render-book.ts");
const {defaultTheme, FONTS} = require("./theme.ts");
const {chromium} = require("playwright");

const base = {kind: "book", schemaVersion: 1, title: "Book layout limits", author: "Synthetic fixture", cover: {}, assets: []};
// Schema maxima: 40 chapters, 120-character titles, 40-character labels.
const longTitle = n => (`Practical chapter ${String(n).padStart(2, "0")}: Welcoming repair volunteers and building responsible community workshops with useful records and clear agreements for every participant`).slice(0, 120).replace(/ $/, "s");
const unbroken = n => `${String(n).padStart(2, "0")}${"Supercalifragilistic".repeat(6)}`.slice(0, 120);
const chapter = (i, extra) => ({id: `chapter-${i + 1}`, title: `Chapter ${i + 1}`, text: "A short synthetic paragraph that exercises page layout only.", ...extra});
const cases = {
  "40 long titles": Array.from({length: 40}, (_, i) => chapter(i, {title: longTitle(i + 1)})),
  "40 long titles and labels": Array.from({length: 40}, (_, i) => chapter(i, {title: longTitle(i + 1), label: `Part ${i + 1}: The long road back home ag`.slice(0, 40)})),
  "40 unbroken titles": Array.from({length: 40}, (_, i) => chapter(i, {title: unbroken(i + 1)})),
  "9 long titles": Array.from({length: 9}, (_, i) => chapter(i, {title: longTitle(i + 1)})),
  "40 short titles": Array.from({length: 40}, (_, i) => chapter(i)),
  "tables": [chapter(0, {text: [
    `| Reference | Notes |\n| --- | --- |\n| ${"ABCDEFGHIJ".repeat(80)} | This row must remain visible in a printed book. |`,
    `| ${Array.from({length: 8}, (_, i) => `Column ${i + 1}`).join(" | ")} |\n|${" --- |".repeat(8)}\n| ${Array.from({length: 8}, () => "Responsibilities-and-agreements-for-volunteers").join(" | ")} |`,
    `A paragraph with an unbroken run: ${"https://example.invalid/".repeat(20)} must stay on the page.`,
  ].join("\n\n")})],
};

async function measure(page) {
  return page.evaluate(() => {
    const px = value => Math.round(value * 10) / 10;
    const contents = [...document.querySelectorAll(".contents")].map(section => {
      const box = section.getBoundingClientRect(), bottomPadding = parseFloat(getComputedStyle(section).paddingBottom);
      const rows = [...section.querySelectorAll("li")].map(li => ({bottom: li.getBoundingClientRect().bottom - box.top, right: li.getBoundingClientRect().right - box.left, size: parseFloat(getComputedStyle(li).fontSize), text: li.textContent}));
      return {height: px(box.height), width: px(box.width), scrollHeight: section.scrollHeight, clientHeight: section.clientHeight, scrollWidth: section.scrollWidth, clientWidth: section.clientWidth, contentBottom: px(box.height - bottomPadding), rows};
    });
    const chapters = [...document.querySelectorAll(".chapter")].map(chapter => {
      const style = getComputedStyle(chapter), box = chapter.getBoundingClientRect();
      const inner = {left: box.left + parseFloat(style.paddingLeft), right: box.right - parseFloat(style.paddingRight)};
      const overflow = [...chapter.querySelectorAll("p,td,th,.table,table,li,figcaption")].map(el => {
        const r = el.getBoundingClientRect();
        return {tag: el.tagName, beyond: px(Math.max(r.right - inner.right, inner.left - r.left, el.scrollWidth - el.clientWidth))};
      }).filter(item => item.beyond > 1);
      return {overflow};
    });
    return {contents, chapters, pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth};
  });
}

(async () => {
  const browser = await chromium.launch({headless: true});
  let passed = 0;
  try {
    const context = await browser.newContext({viewport: {width: 800, height: 1000}, javaScriptEnabled: false, serviceWorkers: "block"});
    await context.route("**/*", route => route.abort());
    for (const fonts of Object.keys(FONTS)) {
      for (const [name, chapters] of Object.entries(cases)) {
        const book = DocumentSourceSchema.parse({...base, theme: {...defaultTheme("book"), fonts}, chapters});
        for (const mode of ["preview", "print"]) {
          const page = await context.newPage();
          await page.emulateMedia({media: mode === "print" ? "print" : "screen"});
          await page.setContent(bookHtml(book, {}, mode));
          await page.evaluate(() => document.fonts.ready);
          const result = await measure(page);
          await page.close();
          const where = `${fonts} / ${name} / ${mode}`;
          const listed = result.contents.flatMap(section => section.rows.map(row => row.text));
          if (chapters.length > 1) assert.equal(listed.length, chapters.length, `${where}: every chapter is listed`);
          result.contents.forEach((section, index) => {
            assert.ok(section.scrollHeight <= section.clientHeight + 1, `${where}: contents page ${index + 1} overflows (${section.scrollHeight} > ${section.clientHeight})`);
            assert.ok(section.scrollWidth <= section.clientWidth + 1, `${where}: contents page ${index + 1} is too wide`);
            for (const row of section.rows) {
              assert.ok(row.bottom <= section.contentBottom + 1, `${where}: "${row.text.slice(0, 40)}" ends ${Math.round(row.bottom - section.contentBottom)}px into the bottom margin`);
              assert.ok(row.right <= section.width + 1, `${where}: "${row.text.slice(0, 40)}" runs off the page`);
              assert.ok(row.size >= 13.9, `${where}: contents text shrank to ${row.size}px`);
            }
          });
          result.chapters.forEach(chapter => assert.deepEqual(chapter.overflow, [], `${where}: body content wider than the text block`));
          assert.ok(result.pageScroll <= 1, `${where}: the page scrolls sideways`);
        }
      }
    }
    passed = Object.keys(FONTS).length * Object.keys(cases).length * 2;
  } finally { await browser.close(); }
  console.log(`${passed} Chromium book layout cases passed (${Object.keys(FONTS).length} font pairings × ${Object.keys(cases).length} limit cases × preview/print); zero external requests.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
