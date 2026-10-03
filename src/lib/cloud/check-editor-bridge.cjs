/* eslint-disable @typescript-eslint/no-require-imports -- Offline adapter regression checks. */
const fs = require("node:fs"), ts = require("typescript"), assert = require("node:assert/strict"), { randomUUID } = require("node:crypto");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { inspectAccountContent, applyAccountTextEdits, accountStyleFromStudio } = require("./editor-bridge.ts");
const { curatedStyles } = require("../curated-styles.ts");
const sourceId = randomUUID();
const block = (text, locked = false) => ({ id: randomUUID(), type: "paragraph", text, assetId: null, locked, sourceIds: [sourceId] });
const content = { schemaVersion: 1, title: "Account fixture", kind: "book", sections: [
  { id: randomUUID(), title: "First chapter", blocks: [block("Original"), block("Locked", true)] },
  { id: randomUUID(), title: "Second chapter", blocks: [block("Conclusion")] },
] };
let count = 0;
function check(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
const view = inspectAccountContent(content);
check("supported document editable", () => assert.equal(view.editable, true));
check("unchanged roundtrip preserves all structure and metadata", () => assert.deepEqual(applyAccountTextEdits(content, view.blocks), content));
check("text edit retains provenance", () => assert.deepEqual(applyAccountTextEdits(content, view.blocks.map((b, i) => i ? b : { ...b, text: "Revised" })).sections[0].blocks[0].sourceIds, [sourceId]));
check("locked edit rejected", () => assert.throws(() => applyAccountTextEdits(content, view.blocks.map((b, i) => i === 1 ? { ...b, text: "Changed" } : b))));
check("locked deletion rejected", () => assert.throws(() => applyAccountTextEdits(content, view.blocks.filter((_, i) => i !== 1))));
check("cross section reorder rejected", () => assert.throws(() => applyAccountTextEdits(content, [...view.blocks].reverse())));
check("duplicate block rejected", () => assert.throws(() => applyAccountTextEdits(content, [...view.blocks, view.blocks[0]])));
check("section id collision rejected", () => assert.throws(() => applyAccountTextEdits(content, [...view.blocks, { id: content.sections[0].id, type: "paragraph", text: "New" }])));
check("new block follows preceding section", () => {
  const next = applyAccountTextEdits(content, [...view.blocks.slice(0, 2), { id: randomUUID(), type: "heading", text: "Added" }, view.blocks[2]]);
  assert.equal(next.sections[0].blocks.length, 3); assert.equal(next.sections[1].blocks.length, 1);
});
for (const type of ["image", "table", "chart", "list", "callout"]) check(`${type} never silently flattened`, () => {
  const value = structuredClone(content); value.sections[0].blocks[0].type = type;
  const result = inspectAccountContent(value); assert.equal(result.editable, false); assert.equal(result.blocks, null);
  assert.throws(() => applyAccountTextEdits(value, view.blocks));
});
check("linked asset never discarded", () => {
  const value = structuredClone(content); value.sections[0].blocks[0].assetId = randomUUID();
  assert.equal(inspectAccountContent(value).editable, false);
});
for (const { style } of curatedStyles) check(`${style.name} palette retained`, () => {
  const result = accountStyleFromStudio(style);
  assert.deepEqual(result.colors, { accent: style.color, ink: style.textColor, canvas: style.background });
});
check("input remains unchanged", () => assert.equal(content.sections[0].blocks[0].text, "Original"));
console.log(`${count} account/editor bridge checks passed. No account writes or provider calls.`);
