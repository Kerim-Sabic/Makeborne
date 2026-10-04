/* eslint-disable @typescript-eslint/no-require-imports -- Offline content integrity checks. */
const fs = require("node:fs"), ts = require("typescript"), assert = require("node:assert/strict"), { randomUUID } = require("node:crypto");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { moveAccountBlock, removeAccountBlock, restoreAccountBlock } = require("./block-actions.ts");
const make = (type, text, locked = false) => ({ id: randomUUID(), type, text, locked, sourceIds: [randomUUID()], assetId: null });
const sectionId = randomUUID(), a = make("heading", "Heading"), b = make("paragraph", "Paragraph"), c = make("quote", "Locked", true);
const content = { schemaVersion: 1, title: "Fixture", kind: "book", sections: [{ id: sectionId, title: "Section", blocks: [a,b,c] }, { id: randomUUID(), title: "Other", blocks: [] }] };
const snapshot = structuredClone(content);
let count = 0;
function check(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
check("moves adjacent blocks", () => assert.deepEqual(moveAccountBlock(content, sectionId, b.id, -1).sections[0].blocks.map(item => item.id), [b.id,a.id,c.id]));
check("preserves source references and IDs", () => assert.deepEqual(moveAccountBlock(content, sectionId, b.id, -1).sections[0].blocks[0], b));
check("does not mutate input", () => assert.deepEqual(content, snapshot));
check("cannot move locked block", () => assert.throws(() => moveAccountBlock(content, sectionId, c.id, -1), /locked/));
check("cannot swap past locked neighbor", () => assert.throws(() => moveAccountBlock(content, sectionId, b.id, 1), /locked/));
check("cannot move beyond section edge", () => assert.throws(() => moveAccountBlock(content, sectionId, a.id, -1), /edge/));
check("cannot remove locked block", () => assert.throws(() => removeAccountBlock(content, sectionId, c.id), /locked/));
check("missing block rejected", () => assert.throws(() => removeAccountBlock(content, sectionId, randomUUID()), /no longer/));
check("invalid direction rejected", () => assert.throws(() => moveAccountBlock(content, sectionId, a.id, 2), /adjacent/));
const removal = removeAccountBlock(content, sectionId, b.id);
check("removal affects only selected block", () => assert.deepEqual(removal.content.sections[0].blocks, [a,c]));
check("other sections preserved", () => assert.deepEqual(removal.content.sections[1], content.sections[1]));
check("undo restores exact content", () => assert.deepEqual(restoreAccountBlock(removal.content, removal.removed), content));
check("undo preserves subsequent edits", () => { const edited = structuredClone(removal.content); edited.sections[0].blocks[0].text = "New heading"; assert.equal(restoreAccountBlock(edited, removal.removed).sections[0].blocks[0].text, "New heading"); });
check("duplicate undo rejected", () => assert.throws(() => restoreAccountBlock(content, removal.removed), /already/));
check("undo cannot target missing section", () => assert.throws(() => restoreAccountBlock({ ...content, sections: [] }, removal.removed), /section/));
console.log(`${count} block action checks passed.`);
