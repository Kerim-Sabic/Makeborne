/* eslint-disable @typescript-eslint/no-require-imports -- Offline full-source search checks (audit M12): scopes, counts, snippets, line identity, duplicate basenames, staleness and bounds. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const src = path.join(__dirname, "..", "..");
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name.startsWith("@/")) return load.call(this, path.join(src, `${name.slice(2)}.ts`), parent, main);
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { searchSource, sourceFingerprint, searchIsCurrent, searchedLabel, locateHit, SOURCE_SEARCH_LIMITS } = require("./source-search.ts");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const project = files => ({ files: Object.entries(files).map(([p, content]) => ({ path: p, content })), assets: [{ path: "public/hero.webp" }] });
const id = { artifactId: "a1", version: 4, dirty: false };
const text = hit => hit.parts.map(part => part.match ? `[${part.text}]` : part.text).join("");

const site = project({
  "package.json": '{ "name": "workshops-site", "dependencies": { "react": "19" } }',
  "src/routes/workshops.tsx": "export function Workshops() {\n  return <section>\n    <h1>Workshops</h1>\n    <p>Our workshops run weekly. workshops, WORKSHOPS.</p>\n  </section>;\n}",
  "src/routes/index.tsx": "import { Workshops } from './workshops';\nexport default function Home() {\n  return <main><h1>Explore handmade collections</h1><Workshops /></main>;\n}",
  "src/components/index.tsx": "export const Card = () => <div>Card</div>;",
  "src/content.ts": "export const nav = ['Home', 'Workshops'];",
});

check("file-name and content scopes are separate, with honest per-file and total counts", () => {
  const all = searchSource(site, "workshops", id);
  assert.deepEqual(all.names.map(item => item.path), ["src/routes/workshops.tsx"]);
  // A file that matches by name is still searched for content (Lovable's grouping omitted it).
  const workshops = all.files.find(file => file.path === "src/routes/workshops.tsx");
  assert.ok(workshops, "the filename match is also a content match");
  assert.equal(workshops.occurrences, 5, "case-insensitive, every occurrence counted, repeated matches on one line included");
  assert.equal(workshops.lines, 3); assert.equal(workshops.hits.find(hit => hit.line === 4).matches, 3);
  assert.equal(all.totals.occurrences, all.files.reduce((sum, file) => sum + file.occurrences, 0));
  assert.equal(all.totals.contentFiles, all.files.length);
  assert.equal(all.files.find(file => file.path === "package.json").managed, true);
  assert.equal(all.files.at(-1).path, "package.json", "managed files rank after your own files");
  assert.deepEqual(searchSource(site, "workshops", id, { scope: "names" }).files, []);
  assert.deepEqual(searchSource(site, "workshops", id, { scope: "content" }).names, []);
  const exact = searchSource(site, "Workshops", id, { caseSensitive: true });
  assert.equal(exact.files.find(file => file.path === "src/routes/workshops.tsx").occurrences, 2);
  const skipped = searchSource(site, "workshops", id, { skipManaged: true });
  assert.equal(skipped.files.some(file => file.managed), false); assert.deepEqual(skipped.skipped.managed, ["package.json"]);
  assert.equal(all.skipped.images, 1, "artwork is never read, and that is reported");
});

check("hits carry line, column and a highlighted snippet; ids name artifact, version and full path", () => {
  const result = searchSource(site, "Explore handmade collections", id);
  const [file] = result.files;
  assert.equal(file.path, "src/routes/index.tsx");
  const [hit] = file.hits;
  assert.deepEqual([hit.line, hit.column], [3, 20]);
  assert.equal(text(hit), "return <main><h1>[Explore handmade collections]</h1><Workshops /></main>;");
  assert.match(hit.id, /^a1:4:[^:]+:line:src\/routes\/index\.tsx:3$/);
  assert.equal(locateHit(site, file.path, hit.line, hit.column, result.query, false).ok, true);
});

check("duplicate basenames are disambiguated by directory and never substituted for each other", () => {
  const result = searchSource(site, "index", id, { scope: "names" });
  assert.deepEqual(result.names.map(item => [item.path, item.duplicate, item.directory]), [["src/components/index.tsx", true, "src/components"], ["src/routes/index.tsx", true, "src/routes"]]);
  const moved = project({ "src/components/index.tsx": "export const Card = () => <div>Card</div>;" });
  assert.deepEqual(locateHit(moved, "src/routes/index.tsx", 3, 20, "Explore", false), { ok: false, reason: "missing-file" }, "a same-named file elsewhere is not used");
});

check("literal special characters, unicode, long lines and empty/short queries", () => {
  const special = project({ "a.ts": "const price = '$4.50 (each)*';\nconst re = /a+b/;\nconst greet = 'Добро пожаловать';", "b.css": `.x{content:"${"y".repeat(5000)}needle${"z".repeat(5000)}"}` });
  assert.equal(searchSource(special, "$4.50 (each)*", id).totals.occurrences, 1, "no pattern syntax");
  assert.equal(searchSource(special, "a+b", id).totals.occurrences, 1);
  assert.equal(searchSource(special, "ПОЖАЛОВАТЬ", id).totals.occurrences, 1, "case-insensitive beyond ASCII");
  const long = searchSource(special, "needle", id).files[0].hits[0];
  assert.equal(long.clippedStart, true); assert.equal(long.clippedEnd, true);
  assert.ok(long.parts.reduce((sum, part) => sum + part.text.length, 0) <= SOURCE_SEARCH_LIMITS.snippetRadius * 3 + 6, "a long line is clipped around the match");
  assert.equal(long.column, 5013);
  assert.deepEqual([searchSource(special, "", id).names, searchSource(special, "   ", id).files], [[], []]);
  const short = searchSource(special, "a", id);
  assert.equal(short.contentTooShort, true); assert.deepEqual(short.files, []); assert.deepEqual(short.names.map(item => item.path), ["a.ts", "b.css"].filter(p => p.includes("a")));
  assert.equal(searchSource(special, "no such text", id).totals.occurrences, 0);
});

check("ranking: exact basename, then prefix, then contains, then directory", () => {
  const files = project({ "src/hero-card.tsx": "", "src/card.tsx": "", "src/cards/list.tsx": "", "src/my-card.tsx": "" });
  assert.deepEqual(searchSource(files, "card", id, { scope: "names" }).names.map(item => item.path), ["src/card.tsx", "src/hero-card.tsx", "src/my-card.tsx", "src/cards/list.tsx"]);
});

check("results go stale when the code changes; same content keeps them current", () => {
  const before = sourceFingerprint(site);
  const result = searchSource(site, "workshops", id);
  assert.equal(result.identity.fingerprint, before);
  assert.equal(searchIsCurrent(result, "a1", before), true);
  const edited = { ...site, files: site.files.map(file => file.path === "src/routes/workshops.tsx" ? { ...file, content: `// note\n${file.content}` } : file) };
  const after = sourceFingerprint(edited);
  assert.notEqual(after, before);
  assert.equal(searchIsCurrent(result, "a1", after), false);
  assert.equal(searchIsCurrent(result, "other-artifact", before), false, "another project's results are never current");
  const renamed = { ...site, files: site.files.map(file => file.path === "src/content.ts" ? { ...file, path: "src/copy.ts" } : file) };
  assert.notEqual(sourceFingerprint(renamed), before, "a rename changes the fingerprint");
  const hit = result.files.find(file => file.path === "src/routes/workshops.tsx").hits[0];
  assert.deepEqual(locateHit(edited, "src/routes/workshops.tsx", hit.line, hit.column, "workshops", false), { ok: false, reason: "moved" }, "an out-of-date line is refused, not guessed");
  assert.equal(locateHit(edited, "src/routes/workshops.tsx", hit.line + 1, hit.column, "workshops", false).ok, true);
  assert.equal(searchedLabel({ version: 4, dirty: false }), "Searching saved version 4");
  assert.equal(searchedLabel({ version: 4, dirty: true }), "Searching version 4 with unsaved changes");
});

check("bounded: 200 files / ~2 MB searched quickly, hits and counts capped honestly", () => {
  const files = {};
  for (let index = 0; index < 200; index++) files[`src/pages/page-${String(index).padStart(3, "0")}.tsx`] = Array.from({ length: 125 }, (_, line) => `  <p className="text-sm">Line ${line} of page ${index}: a common word appears here.</p>`).join("\n");
  const big = project(files);
  const bytes = big.files.reduce((sum, file) => sum + file.content.length, 0);
  assert.ok(bytes > 1_900_000 && bytes <= 2_000_000, `fixture is ~2 MB (${bytes})`);
  const started = process.hrtime.bigint();
  const common = searchSource(big, "of page 199:", id);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 1500, `search took ${ms.toFixed(0)} ms`);
  assert.equal(common.countCapped, false); assert.equal(common.totals.occurrences, 125); assert.deepEqual(common.files.map(file => file.path), ["src/pages/page-199.tsx"]);
  assert.equal(common.files[0].hits.length, SOURCE_SEARCH_LIMITS.hitsPerFile); assert.equal(common.files[0].capped, true, "a file with more matching lines than listed says so");
  const capped = searchSource(big, "e", id, {});
  assert.equal(capped.contentTooShort, true, "single characters search names only");
  const started2 = process.hrtime.bigint();
  const many = searchSource(big, "common", id);
  const ms2 = Number(process.hrtime.bigint() - started2) / 1e6;
  assert.ok(ms2 < 1500, `capped search took ${ms2.toFixed(0)} ms`);
  assert.equal(many.countCapped, true, "counting stops at the cap and says so");
  assert.equal(many.totals.occurrences, SOURCE_SEARCH_LIMITS.countCap);
  assert.equal(many.hitsCapped, true);
  assert.ok(many.files.every(file => file.hits.length >= 1 && file.hits.length <= SOURCE_SEARCH_LIMITS.hitsPerFile), "every listed file keeps at least its first hit");
  assert.ok(many.totals.shownHits <= SOURCE_SEARCH_LIMITS.totalHits + many.files.length);
  const fp = process.hrtime.bigint(); sourceFingerprint(big);
  assert.ok(Number(process.hrtime.bigint() - fp) / 1e6 < 500, "fingerprinting 2 MB is cheap");
  console.log(`     (200 files, ${(bytes / 1e6).toFixed(2)} MB: a rare phrase in ${ms.toFixed(0)} ms, a capped common word in ${ms2.toFixed(0)} ms)`);
});

console.log(`\n${passed} source search checks passed.`);
