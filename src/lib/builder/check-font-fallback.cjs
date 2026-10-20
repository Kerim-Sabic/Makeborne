/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks (audit FNT §5.4/§5.7): NFC before font-subset selection, combining marks, and warnings for characters outside the embedded Latin + Latin Extended subsets. No network, no providers. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true}}).outputText, filename);
const portable = require("../../../infra/project-runtime/font-portability.cjs");
const {fontSubsets} = require("./fonts.ts");
const {nfc, uncoveredCharacters, decomposedLetters, describeTyped, fontCoverage, documentTexts} = require("./font-fallback.ts");
const {clientReadyCheck} = require("./client-ready.ts");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const BOTH = ["latin-ext", "latin"];

check("NFC before subset selection: a letter typed as c + U+030C embeds Latin Extended like č", () => {
  assert.equal(nfc("č"), "č", "c + combining caron is č");
  // The shared runtime helper (unchanged, part of the build image) sees only "c" and an uncovered mark.
  assert.deepEqual(portable.fontSubsets(["č"]), ["latin"], "without NFC the caron letter would not load Latin Extended");
  assert.deepEqual(fontSubsets(["č"]), BOTH);
  assert.deepEqual(fontSubsets(["Cevapčići"]), BOTH, "decomposed Ćevapčići");
  assert.deepEqual(fontSubsets(["Žabljak", "plain"]), BOTH, "Ž typed as Z + caron");
  assert.deepEqual(fontSubsets(["café", "naïve"]), ["latin"], "é and ï are in the Latin file either way");
  assert.deepEqual(fontSubsets(new Set(["Łódź"]).values()), BOTH, "any iterable");
});

check("characters outside Latin + Latin Extended are listed once, after NFC; emoji, icons and spacing are not", () => {
  assert.deepEqual(uncoveredCharacters("Ćevapčići, Łódź, Đurđevdan, İzmir, £20 – “ok” € ₺"), []);
  assert.deepEqual(uncoveredCharacters("Добро Phở ở Ж"), ["Д", "о", "б", "р", "ở", "Ж"]);
  assert.deepEqual(uncoveredCharacters("Ἀθῆναι").length > 0, true, "Greek");
  assert.deepEqual(uncoveredCharacters("東京"), ["東", "京"]);
  assert.deepEqual(uncoveredCharacters("Great 😀👍🏽 🇬🇧 \u{E001} a b　c​"), [], "emoji, flags, private-use icons and invisible spacing");
  assert.deepEqual(uncoveredCharacters("č"), [], "composes to a covered letter");
  assert.deepEqual(uncoveredCharacters("q̌"), ["̌"], "no precomposed q-caron: the combining mark itself falls back");
});

check("letters typed with separate accent marks are reported with what NFC joins them into", () => {
  assert.deepEqual(decomposedLetters("Cevapčići"), [{typed: "č", letter: "č"}, {typed: "ć", letter: "ć"}]);
  assert.deepEqual(decomposedLetters("Ćevapčići"), [], "precomposed text is fine");
  assert.deepEqual(decomposedLetters("q̌"), [], "nothing to join it into");
  assert.equal(describeTyped("č"), "c + U+030C");
});

check("coverage collects places per character (bounded) and documents are labelled by chapter or slide", () => {
  const result = fontCoverage([{text: "Ж", where: "a"}, {text: "Жč", where: "b"}, {text: "Ж", where: "a"}], 1);
  assert.deepEqual(result.uncovered, [{char: "Ж", locations: ["a"], count: 2}]);
  assert.deepEqual(result.decomposed, [{typed: "č", letter: "č", locations: ["b"], count: 1}]);
  const places = documentTexts({kind: "book", title: "Ж", chapters: [{title: "One", text: "x"}, {title: "Two", text: "Phở"}], theme: {fonts: "x"}});
  assert.deepEqual(places.map(item => item.where), ["details", "title", "chapter 1", "chapter 1", "chapter 2", "chapter 2", "details"]);
  assert.deepEqual(fontCoverage(places).uncovered.map(item => [item.char, item.locations]), [["Ж", ["title"]], ["ở", ["chapter 2"]]]);
  const deck = documentTexts({kind: "deck", slides: [{title: "a"}, {title: "b", notes: "Ж"}]});
  assert.deepEqual(fontCoverage(deck).uncovered[0].locations, ["slide 2"]);
});

const INDEX = '<!doctype html><html lang="en"><head><title>Kafana Ovenbird</title><meta name="description" content="Grill house."></head><body><div id="root"></div></body></html>';
const site = (app, extra = []) => ({files: [{path: "index.html", content: INDEX}, {path: "src/App.tsx", content: app}, ...extra], routes: [{path: "/"}], assets: []});
const rule = (findings, id) => findings.find(finding => finding.rule === id);

check("client-ready: uncovered characters warn with their place, only when the site embeds catalogue fonts", () => {
  const app = 'import "@makeborne/fonts/fraunces.css";\nexport default function App() {\n  return <main><h1>Ćevapčići</h1>\n<p>Добро пожаловать</p></main>;\n}';
  const found = rule(clientReadyCheck(site(app)), "font-fallback");
  assert.ok(found, "Cyrillic outside the embedded subsets is reported");
  assert.equal(found.severity, "warning");
  assert.ok(found.locations.every(location => location.startsWith("src/App.tsx:4 ")), found.locations.join());
  assert.ok(found.locations.some(location => location.endsWith("(Д)")));
  assert.equal(rule(clientReadyCheck(site(app.replace('import "@makeborne/fonts/fraunces.css";\n', ""))), "font-fallback"), undefined, "system fonts only: no embedded subsets to fall out of");
  assert.equal(rule(clientReadyCheck(site('import "@makeborne/fonts/fraunces.css";\nexport default () => <h1>Ćevapčići, Łódź</h1>;')), "font-fallback"), undefined, "Latin Extended is covered");
  const pages = clientReadyCheck({...site('import "@makeborne/fonts/fraunces.css";\nexport default () => <h1>Menu</h1>;'), pages: [{path: "/menu", html: "<main><p>Phở bò</p></main>"}]});
  assert.deepEqual(rule(pages, "font-fallback").locations, ["page /menu (ở)"], "prepared pages catch text built from data");
});

check("client-ready: decomposed letters are reported as advice with the joined letter", () => {
  const found = rule(clientReadyCheck(site('import "@makeborne/fonts/fraunces.css";\nexport default () => <h1>Cevapčići</h1>;')), "decomposed-text");
  assert.ok(found);
  assert.equal(found.severity, "info");
  assert.deepEqual(found.locations, ["src/App.tsx:2 (c + U+030C → č)", "src/App.tsx:2 (c + U+0301 → ć)"]);
});

check("document preview shows the coverage note; the bundler and review frame use the NFC-aware subsets", () => {
  const preview = fs.readFileSync(path.join(__dirname, "../../components/document-preview.tsx"), "utf8");
  assert.ok(preview.includes("fontCoverage(documentTexts(doc), 3)") && preview.includes("<FontCoverageNote document={doc} />"));
  for (const file of ["browser-bundler.ts", "../../components/client-document-review.tsx"]) assert.match(fs.readFileSync(path.join(__dirname, file), "utf8"), /import \{[^}]*fontSubsets[^}]*\} from "(?:\.\/fonts|@\/lib\/builder\/fonts)"/, file);
});

console.log(`\n${passed} font fallback checks passed.`);
