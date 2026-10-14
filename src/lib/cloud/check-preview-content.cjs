/* eslint-disable @typescript-eslint/no-require-imports -- Offline preview fidelity checks. */
const fs = require("node:fs"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { previewBlocks, previewSlides } = require("./preview-content.ts");
const block = (id, type, text) => ({ id, type, text, assetId: null, locked: false, sourceIds: [] });
const content = { title: "Deck", kind: "presentation", sections: [{ id: "section", title: "Opening", blocks: [block("one", "heading", "Opening"), block("two", "paragraph", "Exact words"), block("three", "heading", "Next"), block("four", "quote", "Keep this quote")] }] };
const original = JSON.stringify(content);
assert.equal(previewBlocks(content).length, 4);
const slides = previewSlides(content);
assert.equal(slides.length, 2);
assert.equal(slides[0].title, "Opening");
assert.equal(slides[0].blocks[0].text, "Exact words");
assert.equal(slides[1].blocks[0].type, "quote");
assert.equal(JSON.stringify(content), original);
assert.equal(previewSlides({ title: "Empty", sections: [] })[0].title, "Empty");
const paragraphOnly = { title: "Untitled layout", sections: [{ id: "s", title: "", blocks: [block("p", "paragraph", "No heading")] }] };
assert.equal(previewSlides(paragraphOnly)[0].blocks[0].text, "No heading");
assert.equal(previewSlides(paragraphOnly)[0].title, "Untitled layout");
const titledSection = { ...paragraphOnly, sections: [{ ...paragraphOnly.sections[0], title: "Section heading" }] };
assert.equal(previewBlocks(titledSection)[0].text, "Section heading");
// Generated decks keep presenter notes as "Speaker notes:" callouts: never slide content, attached as notes.
const generated = { title: "Talk", kind: "presentation", sections: [{ id: "s1", title: "Hello", blocks: [block("h1", "heading", "Hello"), block("p1", "paragraph", "Visible line"), block("n1", "callout", "Speaker notes: Say thanks first.")] }] };
const talk = previewSlides(generated);
assert.deepEqual(talk[0].blocks.map(item => item.id), ["p1"], "notes are not slide content");
assert.equal(talk[0].notes, "Say thanks first.");
assert.ok(!JSON.stringify(talk[0].blocks).includes("Speaker notes"));
assert.equal(previewSlides({ ...generated, sections: [{ ...generated.sections[0], blocks: [block("c", "callout", "A real callout")] }] })[0].blocks[0].type, "callout", "ordinary callouts stay visible");
console.log("PASS 14 preview checks: source order, headings, exact text, empty content, no mutation, and speaker notes kept off slides.");
