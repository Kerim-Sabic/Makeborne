/* eslint-disable @typescript-eslint/no-require-imports -- Offline version comparison checks. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const src = path.join(__dirname, "..", "..");
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name.startsWith("@/")) return load.call(this, path.join(src, `${name.slice(2)}.ts`), parent, main);
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { diffLines, toHunks, readableLines, compareContent } = require("./version-diff.ts");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const sides = lines => ({ old: lines.filter(line => line.type !== "add").map(line => line.text).join("\n"), next: lines.filter(line => line.type !== "remove").map(line => line.text).join("\n") });

check("line diff finds minimal edits and numbers both sides", () => {
  assert.deepEqual(diffLines("a\nb\nc", "a\nb\nc").map(line => line.type), ["same", "same", "same"]);
  const edit = diffLines("a\nb\nc\nd", "a\nB\nc\nd\ne");
  assert.deepEqual(edit.map(line => `${line.type[0]}${line.text}`), ["sa", "rb", "aB", "sc", "sd", "ae"]);
  assert.deepEqual(edit.map(line => [line.old ?? null, line.new ?? null]), [[1, 1], [2, null], [null, 2], [3, 3], [4, 4], [null, 5]]);
  assert.deepEqual(diffLines("", "x\ny").map(line => line.type), ["add", "add"]);
  assert.deepEqual(diffLines("x\ny", "").map(line => line.type), ["remove", "remove"]);
  assert.equal(diffLines("a\r\nb", "a\nb").every(line => line.type === "same"), true, "CRLF and LF compare equal");
  assert.equal(diffLines(Array.from({ length: 7000 }, (_, i) => `x${i}`).join("\n"), Array.from({ length: 7000 }, (_, i) => `y${i}`).join("\n")), null, "oversized input is refused");
});

check("random edits always rebuild both versions exactly", () => {
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let round = 0; round < 400; round++) {
    const a = Array.from({ length: Math.floor(random() * 40) }, () => "abcde"[Math.floor(random() * 5)]);
    const b = a.filter(() => random() > 0.2).flatMap(line => random() > 0.85 ? [line, "abcde"[Math.floor(random() * 5)]] : [line]);
    const lines = diffLines(a.join("\n"), b.join("\n"));
    const rebuilt = sides(lines);
    assert.equal(rebuilt.old, a.join("\n")); assert.equal(rebuilt.next, b.join("\n"));
    const edits = lines.filter(line => line.type !== "same").length;
    assert.ok(edits <= a.length + b.length);
  }
});

check("hunks keep three lines of context and merge nearby changes", () => {
  const before = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
  const after = [...before]; after[4] = "changed 5"; after[7] = "changed 8"; after[24] = "changed 25";
  const hunks = toHunks(diffLines(before.join("\n"), after.join("\n")));
  assert.equal(hunks.length, 2, "edits 3 lines apart share a hunk");
  assert.deepEqual([hunks[0].oldStart, hunks[0].newStart, hunks[1].oldStart], [2, 2, 22]);
  assert.equal(hunks[0].lines[0].text, "line 2"); assert.equal(hunks[0].lines.at(-1).text, "line 11");
  assert.equal(hunks[1].lines.filter(line => line.type === "same").length, 6);
  assert.deepEqual(toHunks(diffLines("a", "a")), []);
});

check("structured content reads as stable, sorted lines", () => {
  assert.deepEqual(readableLines({ title: "Hi", id: "x", body: "One\nTwo", points: [{ text: "A" }, { text: "B", title: "T" }], empty: "" }),
    ["body:", "  One", "  Two", "points:", "  - text: A", "  - text: B", "    title: T", "title: Hi"]);
  assert.deepEqual(readableLines({ b: 1, a: 2 }), readableLines({ a: 2, b: 1 }));
});

const site = files => ({ title: "Bakery", sections: [], websiteSource: { schemaVersion: 1, toolchainId: "react-vite-v1", entrypoint: "src/main.tsx", files: Object.entries(files).map(([path, content]) => ({ path, content })), assets: [], routes: [{ path: "/", title: "Home" }] } });

check("websites compare file by file", () => {
  const before = site({ "src/App.tsx": "<h1>Bread</h1>\n<p>Hi</p>", "src/old.css": "a{}", "index.html": "<div id=root></div>" });
  const after = site({ "src/App.tsx": "<h1>Fresh bread</h1>\n<p>Hi</p>", "src/new.css": "b{}", "index.html": "<div id=root></div>" });
  const result = compareContent(before, after);
  assert.deepEqual(result.changes.map(change => `${change.status} ${change.label}`), ["changed src/App.tsx", "added src/new.css", "removed src/old.css"]);
  assert.deepEqual([result.added, result.removed, result.unchanged], [2, 2, 4]);
  assert.equal(result.changes[0].hunks[0].lines.find(line => line.type === "add").text, "<h1>Fresh bread</h1>");
  assert.deepEqual(compareContent(before, before).changes, []);
  const retitled = compareContent(before, { ...before, title: "Ovenbird" });
  assert.deepEqual(retitled.changes.map(change => change.label), ["Title"]);
});

const deck = slides => ({ title: "Pitch", sections: [], document: { kind: "deck", title: "Pitch", theme: { fonts: "modern", motif: "grid" }, slides } });

check("decks compare slide by slide, matched by id even when reordered", () => {
  const before = deck([{ id: "cover", layout: "cover", title: "Stop leaks" }, { id: "market", layout: "stats", title: "Market", stats: [{ value: "$14B", label: "Claims" }] }]);
  const after = deck([{ id: "market", layout: "stats", title: "Market", stats: [{ value: "$15B", label: "Claims" }] }, { id: "cover", layout: "cover", title: "Stop leaks" }, { id: "ask", layout: "closing", title: "The ask" }]);
  const result = compareContent(before, after);
  assert.deepEqual(result.changes.map(change => `${change.status} ${change.label}`), ["changed Slide 1 · Market", "added Slide 3 · The ask"]);
  const line = result.changes[0].hunks[0].lines.filter(item => item.type !== "same").map(item => `${item.type} ${item.text.trim()}`);
  assert.deepEqual(line, ["remove value: $14B", "add value: $15B"], "only the edited line is marked");
  const themed = compareContent(before, { ...before, document: { ...before.document, theme: { fonts: "fraunces", motif: "grid" } } });
  assert.deepEqual(themed.changes.map(change => change.label), ["Theme"]);
});

check("books and outline sections compare by chapter and section", () => {
  const book = chapters => ({ title: "Guide", sections: [], document: { kind: "book", title: "Guide", theme: {}, chapters } });
  const result = compareContent(book([{ id: "one", title: "Start", text: "Para one.\n\nPara two." }]), book([{ id: "one", title: "Start", text: "Para one.\n\nPara 2." }]));
  assert.equal(result.changes[0].label, "Chapter 1 · Start");
  const outline = blocks => ({ title: "Draft", sections: [{ id: "s1", title: "Intro", blocks }] });
  const sections = compareContent(outline([{ id: "b1", type: "paragraph", text: "Hello" }]), outline([{ id: "b1", type: "paragraph", text: "Hello there" }]));
  assert.deepEqual(sections.changes.map(change => change.label), ["Section 1 · Intro"]);
});

console.log(`\n${passed} version comparison checks passed.`);
