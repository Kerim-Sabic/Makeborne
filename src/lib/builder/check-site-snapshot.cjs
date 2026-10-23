/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for the cached site snapshot (src/lib/builder/site-snapshot.ts): which version is the snapshot, and that the cached block stays byte-identical. */
const fs = require("node:fs"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
require.extensions[".json"] = (module, filename) => { module.exports = JSON.parse(fs.readFileSync(filename, "utf8")); };
const { SNAPSHOT_BLOCK, snapshotAnchor, snapshotText, filesSince, snapshotVersion } = require("./site-snapshot.ts");
const { ProjectFiles } = require("./files.ts");

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };
// A site of five files; `edit` changes one file's text (about a fifth of the site).
const SITE = { "src/App.tsx": "A".repeat(4000), "src/styles.css": "S".repeat(4000), "src/Hero.tsx": "H".repeat(4000), "src/Menu.tsx": "M".repeat(4000), "index.html": "I".repeat(4000) };
const version = (number, files) => ({ number, files: new Map(Object.entries(files)) });
const edit = (files, path, mark) => ({ ...files, [path]: `${files[path].slice(0, -40)}${mark.repeat(40)}` });
/** A history: each step's files from the previous one. */
function history(steps, start = 1) {
  const versions = [];
  let files = SITE;
  steps.forEach((step, index) => { files = step(files); versions.push(version(start + index, files)); });
  return versions;
}
const anchors = versions => versions.map(item => snapshotAnchor(versions, item.number)?.number ?? null);

check("anchor: a run keeps the snapshot the run before it sent while the changes stay small; a large change becomes the new snapshot", () => {
  const small = history([files => files, files => edit(files, "src/App.tsx", "x"), files => edit(files, "src/Hero.tsx", "y"), files => edit(files, "src/App.tsx", "z")]);
  assert.deepEqual(anchors(small), [1, 1, 1, 1]);
  // Rewriting three of five files (60% of the site) re-anchors; the next small edit keeps the new snapshot.
  const large = history([files => files, files => ({ ...files, "src/App.tsx": "a".repeat(4000), "src/Hero.tsx": "h".repeat(4000), "src/Menu.tsx": "m".repeat(4000) }), files => edit(files, "src/App.tsx", "q")]);
  assert.deepEqual(anchors(large), [1, 2, 2]);
});

check("anchor: fixed version blocks, so every run recomputes the same anchor from the versions at hand", () => {
  const steps = Array.from({ length: 14 }, (_, i) => i === 0 ? files => files : files => edit(files, i % 2 ? "src/App.tsx" : "src/Menu.tsx", String.fromCharCode(97 + i)));
  const versions = history(steps);
  const all = anchors(versions);
  assert.deepEqual(all, [1, 1, 1, 1, 1, 1, 7, 7, 7, 7, 7, 7, 13, 13], `blocks of ${SNAPSHOT_BLOCK}`);
  // Each run's anchor is the previous run's anchor or its own version: consecutive runs share the cached snapshot.
  for (let i = 1; i < all.length; i++) assert.ok(all[i] === all[i - 1] || all[i] === versions[i].number);
  // The build route loads the last 8 versions: the same anchors follow from any window that holds the current block.
  for (let current = 8; current <= 14; current++) assert.equal(snapshotAnchor(versions.filter(item => item.number > current - 8 && item.number <= current), current).number, all[current - 1]);
});

check("anchor: no files, no snapshot; a version missing from the block makes the current version its own snapshot", () => {
  assert.equal(snapshotAnchor([version(1, {})], 1), null);
  const versions = [version(1, {}), ...history([files => files, files => edit(files, "src/App.tsx", "x")], 2)];
  assert.deepEqual(anchors(versions), [null, 2, 2], "a first build's empty start is never a snapshot");
  const gap = history([files => files, files => edit(files, "src/App.tsx", "x"), files => edit(files, "src/App.tsx", "y")]).filter(item => item.number !== 2);
  assert.equal(snapshotAnchor(gap, 3).number, 3);
  assert.equal(snapshotVersion({ number: 4, content: { websiteSource: { files: [{ path: "a.tsx", content: "x" }] } } }).files.get("a.tsx"), "x");
  assert.equal(snapshotVersion({ number: 5, content: {} }).files.size, 0);
});

check("snapshot text: byte-identical for the same version whatever the file order; sorted like the builder's file view", () => {
  const forward = snapshotText(version(3, SITE)), reverse = snapshotText(version(3, Object.fromEntries(Object.entries(SITE).reverse())));
  assert.equal(forward, reverse);
  assert.match(forward, /^<current_files snapshot="v3">\n<file path="index.html">/);
  const working = new ProjectFiles();
  for (const [path, content] of Object.entries(SITE).reverse()) working.files.set(path, content);
  assert.equal(forward, `<current_files snapshot="v3">\n${working.snapshot()}\n</current_files>`);
});

check("files since the snapshot: changed and added files in full, deleted paths named, unchanged files left out; images listed", () => {
  const anchor = version(1, SITE);
  const same = new ProjectFiles();
  for (const [path, content] of Object.entries(SITE)) same.files.set(path, content);
  assert.equal(filesSince(anchor, same), "The files in the snapshot above are current.\nExisting images: none");
  const working = new ProjectFiles();
  for (const [path, content] of Object.entries(edit(SITE, "src/App.tsx", "x"))) if (path !== "src/Menu.tsx") working.files.set(path, content);
  working.files.set("src/Footer.tsx", "export default function Footer() { return null; }");
  working.assets.set("public/images/hero.webp", { id: "a", path: "public/images/hero.webp", sha256: "0".repeat(64), bytes: 1, mediaType: "image/webp" });
  const text = filesSince(anchor, working);
  assert.match(text, /^<changes_since_snapshot>\nThe project changed after the snapshot above \(v1\)\. These files are current: their content below replaces the snapshot's copy\. Deleted since: src\/Menu\.tsx\./);
  assert.match(text, /<file path="src\/App\.tsx">\nA+x{40}\n<\/file>\n\n<file path="src\/Footer\.tsx">/);
  assert.doesNotMatch(text, /src\/Hero\.tsx|src\/styles\.css/, "unchanged files stay in the cached snapshot only");
  assert.match(text, /<\/changes_since_snapshot>\nExisting images: \/images\/hero\.webp$/);
});

console.log(`${passed} site snapshot checks passed (no model or network).`);
