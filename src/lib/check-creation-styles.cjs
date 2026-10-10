/* eslint-disable @typescript-eslint/no-require-imports -- Offline fixture runner, never bundled. */
const fs = require("node:fs"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { creationStyles, retainCreationStyle, styleConcept } = require("./creation-styles.ts");
let count = 0;
function check(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
for (const [kind, expected] of [["book", ["direction-field", "direction-handbook"]], ["website", ["direction-form", "direction-solstice"]], ["presentation", ["direction-signal", "direction-atlas"]]]) {
  check(`${kind} defaults to automatic design before optional directions`, () => assert.deepEqual(creationStyles([], kind).slice(0, 3).map(style => style.id), ["automatic", ...expected]));
  check(`${kind} shows automatic design and its six authored directions`, () => assert.equal(new Set(creationStyles([], kind).map(style => style.id)).size, 7));
}
const field = retainCreationStyle([], "direction-field");
check("retains only chosen direction", () => assert.equal(field.length, 1));
check("retains exact palette", () => assert.equal(field[0].color, "#274BBD"));
check("retention is idempotent", () => assert.equal(retainCreationStyle(field, "direction-field"), field));
const changed = { ...field[0], color: "#123456" };
check("saved palette wins for its selected direction", () => assert.equal(creationStyles([changed], "book").find(style => style.id === changed.id).color, "#123456"));
check("changed palette hides original concept", () => assert.equal(styleConcept(changed), undefined));
check("original palette has concept", () => assert.equal(styleConcept(field[0]).id, "field"));
check("unknown style is rejected", () => assert.throws(() => retainCreationStyle([], "unknown")));
const custom = [{ ...changed, id: "custom-a" }, { ...changed, id: "custom-b" }];
check("custom ordering preserved", () => assert.deepEqual(creationStyles(custom, "book").filter(style => style.id.startsWith("custom-")).map(style => style.id), ["custom-a", "custom-b"]));
check("new authored style retains its exact palette", () => assert.equal(retainCreationStyle([], "electric-mint")[0].background, "#142824"));
check("new style has its own generated artwork", () => assert.equal(styleConcept(retainCreationStyle([], "brass-house")[0]).id, "brass-house"));
check("book rejects saved website styles", () => assert.ok(!creationStyles(retainCreationStyle([], "brass-house"), "book").some(s => s.id === "brass-house")));
check("book rejects saved slide styles", () => assert.ok(!creationStyles(retainCreationStyle([], "direction-atlas"), "book").some(s => s.id === "direction-atlas")));
check("saved array unchanged", () => { creationStyles(custom, "book"); assert.equal(custom.length, 2); });
console.log(`${count} creation style checks passed.`);
