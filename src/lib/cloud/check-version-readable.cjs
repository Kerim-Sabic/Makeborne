/* eslint-disable @typescript-eslint/no-require-imports -- Offline readable comparison and checkpoint checks (audit M11). */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const src = path.join(__dirname, "..", "..");
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name.startsWith("@/")) return load.call(this, path.join(src, `${name.slice(2)}.ts`), parent, main);
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { compareContent } = require("./version-diff.ts");
const { extractCopy, wordDiff, readableChanges, limitReadable, READABLE_LIMITS } = require("./version-readable.ts");
const { saveCheckpoint, removeCheckpoint, parseCheckpoints, serializeCheckpoints, placeCheckpoints, cleanLabel, checkpointKey, CHECKPOINT_LIMITS } = require("./version-checkpoints.ts");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const site = (files, routes = [{ path: "/", title: "Home" }]) => ({ title: "Bakery", sections: [], websiteSource: { schemaVersion: 1, toolchainId: "react-vite-v1", entrypoint: "src/main.tsx", files: Object.entries(files).map(([p, content]) => ({ path: p, content })), assets: [], routes } });
const readable = (before, after) => readableChanges(before, after, compareContent(before, after));
const marks = words => words.map(part => part.type === "add" ? `{+${part.text}}` : part.type === "remove" ? `{-${part.text}}` : part.text).join("");

const APP = `import "./app.css";
// A comment with Words that are not copy
export default function App() {
  const items = [{ title: "Sourdough loaf", price: "£4.50" }, { title: "Rye", className: "px-4 py-2" }];
  return <main className="mx-auto max-w-3xl">
    <h1>Fresh bread every morning</h1>
    <img src="/hero.webp" alt="Loaves cooling on a rack" />
    <p>Hello {name}, welcome to the bakery.</p>
    {/* JSX comment text */}
  </main>;
}`;

check("website copy is read from tags, readable attributes and prose strings, with source lines", () => {
  const copy = extractCopy(APP, "src/App.tsx");
  assert.deepEqual(copy.map(item => `${item.line}:${item.text}`), ["4:Sourdough loaf", "4:£4.50", "4:Rye", "6:Fresh bread every morning", "7:Loaves cooling on a rack", "8:Hello", "8:, welcome to the bakery."]);
  assert.equal(copy.some(item => /comment|px-4|mx-auto|app\.css|hero\.webp/.test(item.text)), false, "comments, class lists and paths are not wording (prices are)");
  const html = extractCopy('<!doctype html><html><head><title>Ovenbird</title><meta name="description" content="Sourdough in Leith."><style>h1{color:red}</style><script>var a = "Hidden text";</script></head><body><h1>Welcome &amp; hello</h1></body></html>', "index.html");
  assert.deepEqual(html.map(item => item.text), ["Ovenbird", "Sourdough in Leith.", "Welcome & hello"]);
});

check("word-level marks for a changed sentence", () => {
  assert.equal(marks(wordDiff("Fresh bread every morning", "Fresh sourdough every single morning")), "Fresh {-bread}{+sourdough} every{+ single} morning");
  assert.equal(wordDiff("x ".repeat(READABLE_LIMITS.wordTokens), "y"), null, "very long lines are not marked word by word");
});

check("readable summary: wording changes in a file, located on the line in the version that has them", () => {
  const before = site({ "src/App.tsx": APP, "src/app.css": "h1{color:#111}", "src/main.tsx": "x" });
  const after = site({ "src/App.tsx": APP.replace("Fresh bread every morning", "Fresh sourdough every morning").replace('alt="Loaves cooling on a rack" ', "").replace("</main>", "  <p>Open daily from 8am.</p>\n  </main>"), "src/app.css": "h1{color:#222}", "src/main.tsx": "x" }, [{ path: "/", title: "Home" }, { path: "/menu", title: "Menu" }]);
  const result = readable(before, after);
  const app = result.units.find(unit => unit.path === "src/App.tsx");
  assert.deepEqual(app.entries.map(entry => [entry.kind, entry.before, entry.after, entry.at]), [
    ["changed", "Fresh bread every morning", "Fresh sourdough every morning", { side: "to", line: 6 }],
    ["removed", "Loaves cooling on a rack", null, { side: "from", line: 7 }],
    ["added", null, "Open daily from 8am.", { side: "to", line: 10 }],
  ]);
  assert.equal(marks(app.entries[0].words), "Fresh {-bread}{+sourdough} every morning");
  const css = result.units.find(unit => unit.path === "src/app.css");
  assert.deepEqual([css.kind, css.summaryOnly, css.entries.length, css.first], ["styles", "styles", 0, { side: "to", line: 1 }]);
  const pages = result.units.find(unit => unit.key === "site:pages");
  assert.deepEqual(pages.entries.map(entry => [entry.kind, entry.after]), [["added", "/menu · Menu"]]);
  // Code that changes no wording is summarised as code, not as an empty wording change.
  const codeOnly = readable(before, site({ "src/App.tsx": APP.replace('className="mx-auto max-w-3xl"', 'className="mx-auto max-w-4xl"'), "src/app.css": "h1{color:#111}", "src/main.tsx": "x" }));
  assert.deepEqual(codeOnly.units.map(unit => [unit.path, unit.summaryOnly, unit.added, unit.removed]), [["src/App.tsx", "code", 1, 1]]);
});

check("documents read as text: slides and chapters by their wording", () => {
  const deck = slides => ({ title: "Pitch", sections: [], document: { kind: "deck", title: "Pitch", theme: { fonts: "modern" }, slides } });
  const result = readable(deck([{ id: "m", title: "Market", stats: [{ value: "$14B", label: "Claims" }] }]), deck([{ id: "m", title: "Market", stats: [{ value: "$15B", label: "Claims" }] }]));
  assert.deepEqual(result.units.map(unit => [unit.label, unit.kind, unit.path]), [["Slide 1 · Market", "content", null]]);
  assert.deepEqual(result.units[0].entries.map(entry => [entry.kind, entry.before, entry.after, entry.at]), [["changed", "value: $14B", "value: $15B", null]]);
});

check("bounded: long text is clipped and only the first N changes are listed, with the rest counted", () => {
  const long = "word ".repeat(200).trim();
  const before = site({ "src/A.tsx": Array.from({ length: 50 }, (_, i) => `<p>Line ${i} old</p>`).join("\n"), "src/B.tsx": `<p>${long}</p>`, "src/c.css": "a{}" });
  const after = site({ "src/A.tsx": Array.from({ length: 50 }, (_, i) => `<p>Line ${i} new</p>`).join("\n"), "src/B.tsx": `<p>${long} more</p>`, "src/c.css": "b{}" });
  const result = readable(before, after);
  assert.equal(result.total, 52, "50 wording changes, 1 long change and 1 styling-only file");
  const b = result.units.find(unit => unit.path === "src/B.tsx").entries[0];
  assert.equal(b.clipped, true); assert.equal(b.after.length, READABLE_LIMITS.textChars); assert.ok(b.after.endsWith("…"));
  const first = limitReadable(result, 30);
  assert.deepEqual([first.shown, first.hidden, first.units.length, first.units[0].entries.length], [30, 22, 1, 30]);
  const all = limitReadable(result, 60);
  assert.deepEqual([all.shown, all.hidden, all.units.length], [52, 0, 3]);
  // Comparing never rewrites either saved version.
  const frozen = JSON.stringify([before, after]); readable(before, after); assert.equal(JSON.stringify([before, after]), frozen);
});

const v = (number, id = `v${number}`) => ({ id, number });
check("checkpoints: one per version, named and noted, edited in place, removed without touching the version", () => {
  let list = [];
  const first = saveCheckpoint(list, v(4), "  Verified   baseline ", "Client liked\u0000 this\n\n\n\nversion", "2026-10-20T10:00:00Z");
  assert.equal(first.ok, true); list = first.checkpoints;
  assert.deepEqual(list, [{ versionId: "v4", versionNumber: 4, name: "Verified baseline", note: "Client liked this\n\nversion", createdAt: "2026-10-20T10:00:00Z", updatedAt: "2026-10-20T10:00:00Z" }]);
  const renamed = saveCheckpoint(list, v(4), "Baseline — Добро", "", "2026-10-20T11:00:00Z").checkpoints;
  assert.equal(renamed.length, 1, "a repeated save updates rather than duplicates");
  assert.deepEqual([renamed[0].name, renamed[0].createdAt, renamed[0].updatedAt], ["Baseline — Добро", "2026-10-20T10:00:00Z", "2026-10-20T11:00:00Z"]);
  assert.deepEqual(saveCheckpoint(list, v(5), "   ", ""), { ok: false, message: "Give the checkpoint a name." });
  assert.equal(cleanLabel("abc‮def⁦", 80), "abcdef", "bidirectional overrides cannot disguise a label");
  assert.equal(cleanLabel("😀".repeat(100), CHECKPOINT_LIMITS.name), "😀".repeat(80), "length counts characters, not UTF-16 units");
  const full = Array.from({ length: CHECKPOINT_LIMITS.perProject }, (_, i) => ({ versionId: `x${i}`, versionNumber: i + 1, name: "n", note: "", createdAt: "", updatedAt: "" }));
  assert.equal(saveCheckpoint(full, v(99), "One more", "").ok, false);
  assert.equal(saveCheckpoint(full, { id: "x3", number: 4 }, "Rename still works", "").ok, true);
  assert.deepEqual(removeCheckpoint(renamed, "v4"), []);
  assert.equal(checkpointKey({ accountId: "acct", workspaceId: "w", artifactId: "a" }), "makeborne.version-checkpoints.v1.acct.w.a");
});

check("checkpoint storage round-trips and rejects damaged or foreign records", () => {
  const list = saveCheckpoint([], v(2), "Draft for review", "", "2026-10-20T10:00:00Z").checkpoints;
  assert.deepEqual(parseCheckpoints(serializeCheckpoints(list)), list);
  assert.deepEqual(parseCheckpoints("not json"), []); assert.deepEqual(parseCheckpoints(null), []);
  assert.deepEqual(parseCheckpoints(JSON.stringify({ v: 2, checkpoints: list })), [], "an unknown store version is ignored");
  const damaged = JSON.stringify({ v: 1, checkpoints: [...list, list[0], { versionId: "", versionNumber: 1 }, { versionId: "v9", versionNumber: -1, name: "x", note: "", createdAt: "", updatedAt: "" }, { versionId: "v3", versionNumber: 3, name: "<b>x</b>‮", note: 7, createdAt: "", updatedAt: "" }] });
  assert.deepEqual(parseCheckpoints(damaged).map(item => item.versionId), ["v2"], "duplicates and malformed entries are dropped");
});

check("checkpoints are placed against the loaded history without guessing", () => {
  const list = [
    { versionId: "v9", versionNumber: 9, name: "Latest", note: "", createdAt: "", updatedAt: "" },
    { versionId: "v2", versionNumber: 2, name: "Old", note: "", createdAt: "", updatedAt: "" },
    { versionId: "gone", versionNumber: 8, name: "Replaced", note: "", createdAt: "", updatedAt: "" },
  ];
  const loaded = [v(9), v(8), v(7)];
  assert.deepEqual(placeCheckpoints(list, loaded, true).map(place => `${place.checkpoint.name}:${place.state}`), ["Latest:loaded", "Replaced:missing", "Old:not-loaded"]);
  assert.deepEqual(placeCheckpoints(list, loaded, false).map(place => place.state), ["loaded", "missing", "missing"], "with the whole history loaded, an absent version is missing");
});

console.log(`\n${passed} readable comparison and checkpoint checks passed.`);
