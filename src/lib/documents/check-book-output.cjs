/* eslint-disable @typescript-eslint/no-require-imports -- Book output checks: sidebars and quotes keep their lines, numbering, tables, and a real Chromium print with contents page numbers, recto openers and bookmarks (offline; no paid calls). */
const fs = require("node:fs"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const { DocumentSourceSchema } = require("./schema.ts");
const { parseBookMarkup, noteBlocks, checkItem } = require("./book-markup.ts");
const { bookHtml, chapterLabel, chapterNumber } = require("./render-book.ts");
const { pdfOutline, bookPagesFromOutline, fixPdfBookmarks, bookHeadings } = require("./book-pagination.ts");
const { defaultTheme } = require("./theme.ts");

let count = 0;
async function check(name, fn) { await fn(); count++; console.log(`PASS ${name}`); }
const book = (chapters, extra = {}) => DocumentSourceSchema.parse({ kind: "book", schemaVersion: 1, title: "The Repair Table", cover: {}, theme: defaultTheme("book"), assets: [], chapters, ...extra });

(async () => {
  await check("quoted lines keep their breaks; a lazy line continues the one above", () => {
    const [quote] = parseBookMarkup("> REQUEST: \"We need a new logo.\"\n> ↓ why?\n> NEED: \"Our logo looks dated.\"\n>\n> PROBLEM: buyers walk past\nour stand.\n> — Field notes");
    assert.deepEqual(quote, { type: "quote", text: "REQUEST: \"We need a new logo.\"\n↓ why?\nNEED: \"Our logo looks dated.\"\n\nPROBLEM: buyers walk past our stand.", attribution: "Field notes" });
    const html = bookHtml(book([{ id: "c1", title: "One", text: "> Line one\n> Line two" }]), {});
    assert.match(html, /<blockquote><p>Line one<br>Line two<\/p><\/blockquote>/);
  });
  await check("sidebars keep paragraphs and line breaks, and parse lists and checklists", () => {
    const source = "[[note:Reusable intake checklist|Ask these at the table:\n[ ] Visitor's name\n[x] Item and fault\n\nThen record:\n1. Before\n2. After\nLine one\nline two]]";
    const [note] = parseBookMarkup(source);
    assert.equal(note.type, "note");
    assert.deepEqual(noteBlocks(note.text), [
      { type: "lines", lines: ["Ask these at the table:"] }, { type: "list", ordered: false, items: ["[ ] Visitor's name", "[x] Item and fault"] },
      { type: "lines", lines: ["Then record:"] }, { type: "list", ordered: true, items: ["Before", "After"] }, { type: "lines", lines: ["Line one", "line two"] },
    ]);
    assert.deepEqual(checkItem("[x] Done"), { done: true, text: "Done" });
    assert.equal(checkItem("[market size] is unknown"), null);
    const html = bookHtml(book([{ id: "c1", title: "One", text: source }]), {});
    assert.match(html, /<ul class="checklist"><li class="check"><span class="box" aria-hidden="true">☐<\/span>Visitor’s name<\/li><li class="check done">/);
    assert.match(html, /<ol><li>Before<\/li><li>After<\/li><\/ol><p>Line one<br>line two<\/p><\/aside>/);
    // A sidebar written with blank lines inside it is still one sidebar.
    const blocks = parseBookMarkup("[[note:Tip|First paragraph.\n\nSecond paragraph.]]\n\nAfter.");
    assert.deepEqual(blocks.map(block => block.type), ["note", "paragraph"]);
    assert.equal(blocks[0].text, "First paragraph.\n\nSecond paragraph.");
    // An unclosed one does not swallow the chapter.
    assert.deepEqual(parseBookMarkup("[[note:Oops\n\nA paragraph.").map(block => block.type), ["paragraph", "paragraph"]);
  });
  await check("chapter numbers count numbered chapters only", () => {
    const b = book([{ id: "intro", label: "Introduction", title: "Before we start", text: "x" }, { id: "one", title: "Intake", text: "x" }, { id: "two", title: "Repair", text: "x" }, { id: "app", label: "Appendix", title: "Logs", text: "x" }]);
    assert.deepEqual(b.chapters.map((_, i) => chapterLabel(b, i)), ["Introduction", "Chapter One", "Chapter Two", "Appendix"]);
    assert.equal(chapterNumber(b, 2), 2);
    const html = bookHtml(b, {});
    assert.match(html, /class="numeral">1<\/div>\s*<div class="opener-text"><p class="label">Chapter One/);
  });
  await check("long tables break between rows with a repeated header; short ones stay whole", () => {
    const rows = n => `| # | Item |\n| --- | --- |\n${Array.from({ length: n }, (_, i) => `| ${i + 1} | Toaster |`).join("\n")}`;
    const html = bookHtml(book([{ id: "c1", title: "One", text: `${rows(4)}\n\nBetween.\n\n${rows(28)}` }]), {}, "print");
    assert.equal((html.match(/<div class="table">/g) ?? []).length, 1);
    assert.equal((html.match(/<div class="table long">/g) ?? []).length, 1);
    assert.match(html, /\.chapter \.table\.long\{break-inside:auto\}\.chapter thead\{display:table-header-group\}\.chapter tr\{break-inside:avoid\}/);
    assert.match(html, /orphans:3;widows:3/);
    assert.match(html, /\.chapter>p\.lead\{hyphens:manual;-webkit-hyphens:manual\}/, "no hyphen inside the small-caps lead-in");
    assert.match(bookHtml(book([{ id: "c1", title: "One", text: "**Success**\n\n- Ask it\n- Write it" }]), {}), /<p class="runin"><strong>Success<\/strong><\/p><ul>/);
  });
  await check("print: contents page numbers, chapter openers on right-hand pages and bookmarks with their spaces (real Chromium)", async () => {
    const { chromium } = require("playwright");
    const para = "The volunteer greets the visitor, asks what a good outcome looks like and writes it down before anything is opened. ".repeat(9);
    const b = book([
      { id: "intro", label: "Introduction", title: "Before the Doors Open", text: `${para}\n\n${para}` },
      { id: "one", title: "Receiving the Item and Agreeing Its Scope with the Visitor", text: `${para}\n\n## Ask what fixed means for this visitor today\n\n${para}\n\n${para}` },
      { id: "two", title: "A Safe, Respectful Repair Conversation", text: para },
      { id: "three", title: "Recording the Result", opening: "inline", text: para },
    ]);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await (await browser.newContext({ javaScriptEnabled: false })).newPage();
      const print = async html => { await page.setContent(html, { waitUntil: "load" }); await page.emulateMedia({ media: "print" }); return Buffer.from(await page.pdf({ printBackground: true, preferCSSPageSize: true, tagged: true, outline: true })); };
      const first = await print(bookHtml(b, {}, "print"));
      const pages = bookPagesFromOutline(b, pdfOutline(first));
      assert.ok(pages, "every chapter is found in the bookmarks");
      assert.ok(pages.blankBefore.length >= 1, `the fixture exercises a recto blank (${JSON.stringify(pages)})`);
      const pdf = fixPdfBookmarks(await print(bookHtml(b, {}, "print", undefined, pages)), bookHeadings(b));
      const outline = pdfOutline(pdf);
      // Openers on right-hand (odd) pages; the inline chapter is not forced.
      for (const chapter of b.chapters) {
        const entry = outline.find(item => item.title === chapter.title);
        assert.ok(entry, `bookmark for "${chapter.title}" keeps its word spaces`);
        assert.equal(entry.page, pages.chapters[chapter.id], `${chapter.id}: contents number matches the printed page`);
        if (chapter.opening !== "inline") assert.equal(entry.page % 2, 1, `${chapter.id} opens on a right-hand page`);
      }
      assert.ok(outline.some(item => item.title === "Ask what fixed means for this visitor today"));
      assert.ok(outline.some(item => item.title === "Contents"));
      const html = bookHtml(b, {}, "print", undefined, pages);
      for (const chapter of b.chapters) assert.match(html, new RegExp(`<b class="pg">${pages.chapters[chapter.id]}</b>`));
      assert.equal((html.match(/class="full blank"/g) ?? []).length, pages.blankBefore.length);
      assert.doesNotMatch(bookHtml(b, {}, "preview", undefined, pages), /class="pg"|full blank/, "the preview has no page numbers");
      // The rebuilt cross-reference table still points at every object.
      const text = pdf.toString("latin1"), xref = text.lastIndexOf("\nxref\n") + 1, start = Number(/startxref\s+(\d+)/.exec(text.slice(xref))[1]);
      assert.equal(start, xref);
      const rows = text.slice(xref).split("\n").slice(2).filter(row => / n $/.test(row));
      rows.forEach(row => { const at = Number(row.slice(0, 10)); assert.match(text.slice(at, at + 20), /^\d+ 0 obj/); });
    } finally { await browser.close(); }
  });
  await check("a requested length counts every page but the cover, and is never met by shrinking the type", () => {
    const { bookLengthPlan, countedPages, WORDS_PER_TEXT_PAGE, BODY_TYPE_PT } = require("./book-pagination.ts");
    assert.equal(countedPages(47), 46, "the cover does not count");
    assert.deepEqual(bookLengthPlan(47, 8), { front: 3, openers: 12, textPages: 32, words: 32 * WORDS_PER_TEXT_PAGE });
    assert.deepEqual(bookLengthPlan(20, 4, 0), { front: 3, openers: 0, textPages: 17, words: 17 * WORDS_PER_TEXT_PAGE }, "inline openings save pages");
    const short = bookHtml(book([{ id: "a", title: "A", text: "Short." }]), {}, "print");
    const long = bookHtml(book(Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, title: `Chapter ${i}`, text: "Words. ".repeat(4000) }))), {}, "print");
    for (const html of [short, long]) assert.ok(html.includes(`.chapter{font-size:${BODY_TYPE_PT}pt;`));
    const prompt = fs.readFileSync(require.resolve("../builder/docs-prompt.ts"), "utf8");
    assert.match(prompt, /LENGTH: A requested length in pages counts every printed page except the cover/);
    assert.match(prompt, /never ask for smaller type/);
  });
  console.log(`\n${count} book output checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
