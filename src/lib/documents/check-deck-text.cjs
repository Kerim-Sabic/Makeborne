/* eslint-disable @typescript-eslint/no-require-imports -- Offline deck text checks: balanced title breaks shared by HTML and PPTX, grouped lists, placeholders, small accent contrast, compare rules and the closing (no paid calls). */
const fs = require("node:fs"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const JSZip = require("jszip");
const { DocumentSourceSchema } = require("./schema.ts");
const { composeSlide } = require("./slide-scene.ts");
const { balancedBreaks } = require("./scene-kit.ts");
const { DocumentEditor, emptyDocument, placeholderIssues } = require("./editor.ts");
const { DIRECTIONS } = require("./directions.ts");
const { contrast } = require("./theme.ts");
const { deckPptx } = require("./pptx.ts");
const { deckHtml } = require("./render-deck.ts");

let count = 0;
async function check(name, fn) { await fn(); count++; console.log(`PASS ${name}`); }
const palette = { background: "#F7F4EE", surface: "#ECE5D8", ink: "#15181C", muted: "#545A62", accent: "#D2561E", accent2: "#2D8A9B", dark: "#132027" };
const deckOf = (direction, slides, extra = {}) => DocumentSourceSchema.parse({ kind: "deck", schemaVersion: 1, title: "Keep the Wheels Turning", theme: { palette, fonts: "bricolage", direction, mood: "", imageStyle: "" }, slides, assets: [], ...extra });
const textOf = xml => [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(match => match[1]);

(async () => {
  await check("balanced breaks keep the fitted line count, leave no one-word line and never split a word", () => {
    const out = balancedBreaks("We give retired EV batteries a second home", 760, 48, 0.5);
    const lines = out.split("\n");
    assert.equal(lines.length, 2);
    assert.ok(lines.every(line => line.split(" ").length >= 2), out);
    assert.equal(out.replace(/\n/g, " "), "We give retired EV batteries a second home");
    assert.equal(balancedBreaks("Short", 560, 48, 0.5), "Short");
    assert.equal(balancedBreaks("Already\nbroken", 100, 48, 0.5), "Already\nbroken");
  });
  await check("titles break at the same words in the HTML and the PPTX (soft line breaks in one paragraph)", async () => {
    const deck = deckOf("editorial", [{ id: "s", layout: "statement", title: "Clear on what is included, and what is not included", notes: "n" }]);
    const title = composeSlide(deck, deck.slides[0], 0, 1).prims.find(prim => prim.k === "text" && prim.role === "title");
    assert.ok(title.text.includes("\n"), "a multi-line title carries explicit breaks");
    const html = deckHtml(deck, {}, "print");
    assert.ok(html.includes(title.text.replace(/'/g, "&#39;")) || html.includes(title.text), "the HTML sets the same breaks (white-space: pre-wrap)");
    assert.doesNotMatch(html, /text-wrap:balance/, "no browser-only re-balancing");
    const xml = await (await JSZip.loadAsync(await deckPptx(deck, {}))).file("ppt/slides/slide1.xml").async("string");
    const shape = /<p:sp>(?:(?!<\/p:sp>)[\s\S])*name="Title"[\s\S]*?<\/p:sp>/.exec(xml)[0];
    assert.equal((shape.match(/<a:p>/g) ?? []).length, 1, "one paragraph");
    assert.equal((shape.match(/<a:br\/>/g) ?? []).length, title.text.split("\n").length - 1);
    assert.deepEqual(textOf(shape), title.text.split("\n"));
  });
  await check("compare sides are one list text box each; the column rule never runs through a heading", async () => {
    const deck = deckOf("swiss", [{ id: "c", layout: "compare", variant: "compare-columns", title: "What is covered", notes: "n", compare: { left: { heading: "Not included", points: ["Parts and tyres", "Crash damage"] }, right: { heading: "Included", points: ["Two safety checks", "One tune-up", "Priority booking"] } } }]);
    const scene = composeSlide(deck, deck.slides[0], 0, 1);
    assert.equal(scene.composition, "compare-columns");
    const lists = scene.prims.filter(prim => prim.k === "text" && prim.list);
    assert.deepEqual(lists.map(prim => prim.text), ["Parts and tyres\nCrash damage", "Two safety checks\nOne tune-up\nPriority booking"]);
    const headings = scene.prims.filter(prim => prim.k === "text" && (prim.text === "Not included" || prim.text === "Included"));
    const rules = scene.prims.filter(prim => prim.k === "line" && prim.y1 === prim.y2);
    for (const heading of headings) for (const rule of rules) assert.ok(!(rule.y1 > heading.y && rule.y1 < heading.y + heading.h && rule.x1 < heading.x + heading.w && rule.x2 > heading.x), `rule at ${rule.y1} crosses "${heading.text}"`);
    const xml = await (await JSZip.loadAsync(await deckPptx(deck, {}))).file("ppt/slides/slide1.xml").async("string");
    assert.equal((xml.match(/<a:buChar char="&#x2013;"\/>/g) ?? []).length, 5, "five bulleted paragraphs");
    assert.match(xml, /<a:buClr><a:srgbClr val="[0-9A-F]{6}"\/><\/a:buClr><a:buSzPct/);
  });
  await check("small accent text (eyebrows, labels) reaches 4.5:1 in every direction and tone", () => {
    for (const direction of DIRECTIONS) for (const tone of ["light", "dark", "accent"]) {
      const deck = deckOf(direction, [{ id: "p", layout: "points", tone, eyebrow: "Why it works", title: "Three reasons riders return", notes: "n", points: [{ title: "On time", text: "Every 20 minutes" }, { title: "Quiet", text: "Calm decks" }, { title: "Bikes", text: "Free racks" }] }]);
      const scene = composeSlide(deck, deck.slides[0], 0, 1);
      const label = scene.prims.find(prim => prim.k === "text" && /why it works/i.test(prim.text));
      assert.ok(label, `${direction}/${tone}: eyebrow drawn`);
      // What is behind it: a filled pill or tag that holds the label, else the slide.
      const holder = scene.prims.filter(prim => prim.k === "rect" && !prim.noFill && prim.x <= label.x + 1 && prim.y <= label.y + 1 && prim.x + prim.w >= label.x + 10 && prim.y + prim.h >= label.y + label.size).pop();
      const behind = holder ? holder.fill : scene.background;
      assert.ok(contrast(label.color, behind) >= 4.5, `${direction}/${tone}: eyebrow ${label.color} on ${behind} is ${contrast(label.color, behind).toFixed(2)}:1`);
    }
  });
  await check("unfinished placeholders block the first finish; checklists and links do not", () => {
    const deck = deckOf("swiss", [
      { id: "m", layout: "statement", title: "Battery supply is growing", body: "Addressable market: [market size in EUR] across [number] homes.", notes: "Mention [pause] here." },
      { id: "t", layout: "points", title: "Team", notes: "n", points: [{ title: "Founder", text: "[Your name], CEO" }, { title: "Next", text: "Replace this with your hiring plan" }] },
    ]);
    const found = placeholderIssues(deck);
    assert.ok(found.some(item => item.includes("[market size in EUR]")) && found.some(item => item.includes("[Your name]")) && found.some(item => /Replace this/i.test(item)), found.join(" | "));
    assert.ok(!found.some(item => item.includes("pause")), "speaker notes are not scanned");
    const editor = new DocumentEditor(deck);
    assert.ok(editor.problems().some(problem => /Unfinished placeholders/.test(problem)));
    const book = DocumentSourceSchema.parse({ ...emptyDocument("book", "Guide"), chapters: [{ id: "c", title: "Checklist", text: "- [ ] Call the client\n- [x] Send the brief\n\nSee [the guide](https://example.invalid).\n\n[[note:Tip|Keep it short.]]" }] });
    assert.deepEqual(placeholderIssues(book), []);
  });
  await check("a closing with next steps is composed around them (numbered steps beside the ask, contact under a rule)", () => {
    for (const direction of DIRECTIONS) {
      const deck = deckOf(direction, [{ id: "close", layout: "closing", tone: "dark", title: "Join the founding member list", notes: "n", body: "Tern Bicycle Workshop", points: [{ title: "Join at the counter", text: "Any day we are open" }, { title: "Book your first check", text: "Within your first month" }] }]);
      const scene = composeSlide(deck, deck.slides[0], 0, 1);
      assert.equal(scene.composition, "closing-next", direction);
      assert.deepEqual(scene.issues, [], direction);
      const texts = scene.prims.filter(prim => prim.k === "text").map(prim => prim.text.replace(/\n/g, " "));
      for (const want of ["Join the founding member list", "Join at the counter", "Book your first check", "Tern Bicycle Workshop"]) assert.ok(texts.includes(want), `${direction}: ${want}`);
      assert.ok(!scene.prims.some(prim => prim.k === "art"), `${direction}: no decorative artwork competes with the ask`);
    }
  });
  await check("unrelated decks in one direction do not open with the same cover art", () => {
    const titles = ["Coastal homes, powered by second-life batteries", "Keep the Wheels Turning", "Harbour Light Ferries", "A Quieter Kitchen", "Night Market Lanterns", "The Repair Table"];
    for (const direction of DIRECTIONS) {
      const art = new Set(titles.map(title => {
        const deck = deckOf(direction, [{ id: "cover", layout: "cover", tone: "dark", title, subtitle: "Season review", notes: "n" }], { title });
        const scene = composeSlide(deck, deck.slides[0], 0, 1);
        return `${scene.composition}|${JSON.stringify(scene.prims.filter(prim => prim.k !== "text").map(prim => [prim.k, Math.round(prim.x ?? prim.x1), Math.round(prim.y ?? prim.y1)]))}`;
      }));
      assert.ok(art.size >= 3, `${direction}: only ${art.size} distinct covers for ${titles.length} decks`);
    }
  });
  console.log(`\n${count} deck text checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
