/* eslint-disable @typescript-eslint/no-require-imports -- Offline fixture runner, never bundled. */
const fs = require("node:fs"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { creationStyles, retainCreationStyle, styleConcept } = require("./creation-styles.ts");
let count = 0;
function check(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
for (const [kind, expected] of [["book", ["direction-field", "direction-handbook"]], ["website", ["direction-form", "direction-solstice"]], ["presentation", ["direction-signal", "direction-atlas"]]]) {
  check(`${kind} directions first`, () => assert.deepEqual(creationStyles([], kind).slice(0, 2).map(style => style.id), expected));
  check(`${kind} keeps all six`, () => assert.equal(new Set(creationStyles([], kind).map(style => style.id)).size, 6));
}
const field = retainCreationStyle([], "direction-field");
check("retains only chosen direction", () => assert.equal(field.length, 1));
check("retains exact palette", () => assert.equal(field[0].color, "#274BBD"));
check("retention is idempotent", () => assert.equal(retainCreationStyle(field, "direction-field"), field));
const changed = { ...field[0], color: "#123456" };
check("saved palette wins", () => assert.equal(creationStyles([changed], "book")[0].color, "#123456"));
check("changed palette hides original concept", () => assert.equal(styleConcept(changed), undefined));
check("original palette has concept", () => assert.equal(styleConcept(field[0]).id, "field"));
check("unknown style is rejected", () => assert.throws(() => retainCreationStyle([], "unknown")));
const custom = [{ ...changed, id: "custom-a" }, { ...changed, id: "custom-b" }];
check("custom ordering preserved", () => assert.deepEqual(creationStyles(custom, "book").slice(2, 4).map(style => style.id), ["custom-a", "custom-b"]));
check("saved array unchanged", () => { creationStyles(custom, "book"); assert.equal(custom.length, 2); });
console.log(`${count} creation style checks passed.`);
