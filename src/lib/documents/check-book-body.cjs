/* eslint-disable @typescript-eslint/no-require-imports -- Offline book body checks (no network, no paid calls). */
const fs = require("node:fs"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true}}).outputText, filename);
const {DocumentEditor, emptyDocument} = require("./editor.ts");
const {parseBookMarkup, smartPunctuation, bodyHtml, inlineHtml} = require("./book-markup.ts");
const {bookHtml} = require("./render-book.ts");
const {projectDocument} = require("./project.ts");

let count = 0;
function check(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
const types = source => parseBookMarkup(source).map(block => block.type);
const bookWith = chapters => {
  const editor = new DocumentEditor(emptyDocument("book", "Tales"));
  chapters.forEach((chapter, index) => editor.apply("write_chapter", { chapter: { id: `c${index + 1}`, title: `Chapter title ${index + 1}`, text: "Body.", ...chapter } }));
  return editor.doc;
};

check("blocks written with blank lines parse exactly as before", () => {
  const blocks = parseBookMarkup("Para *one* and **two**.\n\n## Heading\n\n> Quote line\n> — Ana\n\n- a\n- b\n\n1. x\n2. y\n\n* * *\n\n[[figure:cat|A cat]]\n\n[[note:Tip|Do it]]\n\n[[note:Line one\nline two]]");
  assert.deepEqual(blocks, [
    { type: "paragraph", text: "Para *one* and **two**." }, { type: "subheading", text: "Heading" }, { type: "quote", text: "Quote line", attribution: "Ana" },
    { type: "list", ordered: false, items: ["a", "b"] }, { type: "list", ordered: true, items: ["x", "y"] }, { type: "break" },
    { type: "figure", image: "cat", caption: "A cat" }, { type: "note", title: "Tip", text: "Do it" }, { type: "note", text: "Line one\nline two" },
  ]);
  // A hard-wrapped paragraph stays one paragraph.
  assert.deepEqual(parseBookMarkup("The harbour was quiet\nthat morning, and the boats\nwaited."), [{ type: "paragraph", text: "The harbour was quiet that morning, and the boats waited." }]);
});

check("blocks written without a blank line are split, not flattened", () => {
  assert.deepEqual(parseBookMarkup("## The plan\nWe start small."), [{ type: "subheading", text: "The plan" }, { type: "paragraph", text: "We start small." }]);
  assert.deepEqual(parseBookMarkup("You will need:\n- flour\n- water\nThen knead."), [
    { type: "paragraph", text: "You will need:" }, { type: "list", ordered: false, items: ["flour", "water Then knead."] },
  ], "a wrapped line continues the item above it");
  assert.deepEqual(types("Intro line.\n1. First\n2. Second"), ["paragraph", "list"]);
  assert.deepEqual(parseBookMarkup("* one\n* two"), [{ type: "list", ordered: false, items: ["one", "two"] }]);
  assert.deepEqual(parseBookMarkup("*Italic opening* stays prose."), [{ type: "paragraph", text: "*Italic opening* stays prose." }]);
  assert.deepEqual(parseBookMarkup("> A line\nthat wraps\n— Ana"), [{ type: "quote", text: "A line that wraps", attribution: "Ana" }]);
});

check("numbered lists keep their starting number; a wrapped year stays prose", () => {
  assert.deepEqual(parseBookMarkup("4. Four\n5. Five"), [{ type: "list", ordered: true, items: ["Four", "Five"], start: 4 }]);
  assert.deepEqual(types("It ended in\n1984. Nobody noticed."), ["paragraph"]);
});

check("tables parse with and without a header row", () => {
  assert.deepEqual(parseBookMarkup("| Tool | Cost |\n|---|---:|\n| Hammer | $12 |\n| Saw | $30 |"), [{ type: "table", header: ["Tool", "Cost"], rows: [["Hammer", "$12"], ["Saw", "$30"]] }]);
  assert.deepEqual(parseBookMarkup("| a | b |\n| c | d |"), [{ type: "table", rows: [["a", "b"], ["c", "d"]] }]);
  assert.deepEqual(types("Prices:\n| a | b |\n|--|--|\n| 1 | 2 |"), ["paragraph", "table"]);
});

check("body text gets typographic punctuation; stored text is untouched", () => {
  assert.equal(smartPunctuation(`"Don't," she said -- softly... 'Fine.'`), "“Don’t,” she said — softly… ‘Fine.’");
  assert.equal(smartPunctuation("pages 10-20, the '90s, (\"aside\")"), "pages 10-20, the ’90s, (“aside”)");
  assert.equal(smartPunctuation(`*"Hello,"* he said. "It's 'fine'."`), "*“Hello,”* he said. “It’s ‘fine’.”");
  assert.equal(smartPunctuation(`The "best"! -- and 'that' "`), "The “best”! — and ‘that’ ”");
  assert.equal(bodyHtml(`<b>"*hi*"</b> **bold**`), "&lt;b&gt;“<em>hi</em>”&lt;/b&gt; <strong>bold</strong>");
  // Titles and covers keep the plain inline renderer.
  assert.equal(inlineHtml(`"Title"`), "&quot;Title&quot;");
  const book = bookWith([{ text: `She said "yes" -- at last.` }]);
  assert.equal(book.chapters[0].text, `She said "yes" -- at last.`);
  assert.match(bookHtml(book, {}, "print"), /She said “yes” — at last\./);
});

check("tables render escaped, with header cells, and survive project conversion", () => {
  const book = bookWith([{ text: "| Item | Note |\n|---|---|\n| <img src=x> | **bold** |" }]);
  const html = bookHtml(book, {}, "print");
  assert.match(html, /<div class="table"><table><thead><tr><th[^>]*>Item<\/th><th[^>]*>Note<\/th><\/tr><\/thead><tbody><tr><td[^>]*>&lt;img src=x&gt;<\/td><td[^>]*><strong>bold<\/strong><\/td><\/tr><\/tbody><\/table><\/div>/);
  assert.match(html, /<th style="min-width:\d+pt">Item<\/th>/, "columns keep room for their longest word");
  assert.ok(!html.includes("<img src=x>"));
  const project = projectDocument(book, () => null);
  assert.ok(project[0].blocks.some(block => block.type === "list" && block.text === "Item | Note\n<img src=x> | bold"), "table text kept in the project copy");
});

check("drop cap only on a long opening paragraph", () => {
  const long = "A".repeat(10) + " " + "word ".repeat(50);
  assert.match(bookHtml(bookWith([{ text: long }]), {}, "print"), /<p class="lead">/);
  assert.ok(!bookHtml(bookWith([{ text: "Short opener.\n\n" + long }]), {}, "print").includes('class="lead"'), "a one-line opener gets no drop cap");
  assert.ok(!bookHtml(bookWith([{ text: "## Heading first\n\n" + long }]), {}, "print").includes('class="lead"'), "no drop cap when the chapter opens with a heading");
  assert.match(bookHtml(bookWith([{ text: long }]), {}, "print"), /\.chapter>p\.lead::first-letter\{initial-letter:3/);
});

check("contents never cut off: roomy for short books, paged and compact for long ones", () => {
  const short = bookHtml(bookWith(Array.from({ length: 5 }, () => ({}))), {}, "print");
  assert.equal((short.match(/class="full front contents"/g) || []).length, 1);
  const long = bookHtml(bookWith(Array.from({ length: 25 }, () => ({}))), {}, "print");
  assert.equal((long.match(/class="full front contents compact"/g) || []).length, 2);
  assert.match(long, /Contents, continued/);
  for (let index = 1; index <= 25; index++) assert.ok(long.includes(`</span>Chapter title ${index}</a></li>`), `contents links chapter ${index}`);
  assert.match(long, /<ol start="19">/);
  assert.equal((bookHtml(bookWith([{}]), {}, "print").match(/front contents/g) || []).length, 0, "one-chapter books have no contents page");
});

console.log(`${count} book body checks passed.`);
