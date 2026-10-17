/* eslint-disable @typescript-eslint/no-require-imports -- Offline click-to-edit checks: tagging, describing and exact source edits. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const src = path.join(__dirname, "..", "..");
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name.startsWith("@/")) return load.call(this, path.join(src, `${name.slice(2)}.ts`), parent, main);
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
globalThis.fetch = async () => { throw new Error("Network forbidden"); };

const { instrumentSource, parseLoc, formatLoc, describeElement, applyVisualEdit, remapLoc, assetPublicPath, LOC_ATTRIBUTE } = require("./visual-edit.ts");
const { tsxLanguage } = require("@codemirror/lang-javascript");

const APP = `import { Check } from "lucide-react";
import { MENU } from "./data";

export default function App() {
  const count = MENU.length;
  return (
    <main className="page">
      <section className="hero" style={{ padding: 24 }}>
        <h1>Fresh bread daily</h1>
        <p className="lede">Baked by hand in Sarajevo &amp; sold warm</p>
        <p>We bake {count} loaves each morning</p>
        <img src="/images/hero.webp" alt="Loaves on a wooden rack" />
        <a href="#menu" className="cta">See the menu</a>
        <h2 style={heading}>Our menu</h2>
        <h3>
          Cooked by the <em>season</em>, served warm
        </h3>
      </section>
      <ul id="menu">
        {MENU.map(item => <li key={item.name}><Check size={14} /><span>{item.name}</span></li>)}
      </ul>
      <footer>
        <p>{"Open every day"}</p>
        <small>Since 1998</small>
      </footer>
    </main>
  );
}
const heading = { letterSpacing: "0.02em" };
`;
const DATA = `export const MENU = [
  { name: "Sourdough loaf", price: 6 },
  { name: 'Rye & caraway', price: 5 },
  { name: "Cinnamon bun", price: 3 },
];
export const TAGLINE = "Cinnamon bun";
`;
const source = {
  schemaVersion: 1, toolchainId: "react-vite-v1", entrypoint: "src/main.tsx",
  files: [
    { path: "index.html", content: "<!doctype html><html><head></head><body><div id=\"root\"></div></body></html>" },
    { path: "package-lock.json", content: "{}" },
    { path: "package.json", content: "{\"name\":\"bakery\"}" },
    { path: "src/App.tsx", content: APP },
    { path: "src/data.ts", content: DATA },
    { path: "src/main.tsx", content: "import { createRoot } from \"react-dom/client\";\nimport App from \"./App\";\ncreateRoot(document.getElementById(\"root\")!).render(<App />);\n" },
  ],
  assets: [
    { id: "6f0d0b8e-3f43-4c1f-9d55-0c5f8b6a1f10", path: "public/images/hero.webp", sha256: "a".repeat(64), bytes: 1000, mediaType: "image/webp" },
    { id: "6f0d0b8e-3f43-4c1f-9d55-0c5f8b6a1f11", path: "public/images/oven.webp", sha256: "b".repeat(64), bytes: 1000, mediaType: "image/webp" },
  ],
  routes: [{ path: "/", title: "Home" }],
};
const ASSETS = source.assets.map(asset => assetPublicPath(asset.path));
const fileOf = (project, file) => project.files.find(item => item.path === file).content;
const at = (snippet, project = source, file = "src/App.tsx") => {
  const offset = fileOf(project, file).indexOf(snippet);
  assert.ok(offset >= 0, `missing ${snippet}`);
  return { path: file, offset };
};
const parses = code => { let errors = 0; tsxLanguage.parser.parse(code).iterate({ enter(node) { if (node.type.isError) errors++; } }); return errors === 0; };
const ok = result => { assert.equal(result.ok, true, result.message); assert.ok(parses(fileOf(result.source, result.change.path)) || !result.change.path.endsWith(".tsx"), "edited file still parses"); return result; };

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }

check("instrumentation tags every HTML element with its original offset and skips components", () => {
  const tagged = instrumentSource("src/App.tsx", APP);
  const locs = [...tagged.matchAll(new RegExp(`${LOC_ATTRIBUTE}="([^"]+)"`, "g"))].map(match => parseLoc(match[1]));
  assert.equal(locs.length, 16);
  for (const loc of locs) assert.equal(APP[loc.offset], "<", formatLoc(loc));
  assert.doesNotMatch(tagged, /<Check data-mb-loc/);
  assert.ok(parses(tagged));
  assert.equal(instrumentSource("src/data.ts", DATA), DATA, "non-JSX files are untouched");
  assert.equal(instrumentSource("src/App.css", "a{color:red}"), "a{color:red}");
});

check("locations parse strictly", () => {
  assert.deepEqual(parseLoc("src/App.tsx@120"), { path: "src/App.tsx", offset: 120 });
  for (const bad of ["src/App.css@1", "../x.tsx@1", "src/App.tsx@-1", "src/App.tsx@1e3", 42, "src/A pp.tsx@1"]) assert.equal(parseLoc(bad), null, String(bad));
});

check("describe reports text, attributes, inline style and what can't be edited", () => {
  const h1 = describeElement(source, at("<h1>"));
  assert.equal(h1.tag, "h1"); assert.equal(h1.text.value, "Fresh bread daily"); assert.equal(h1.line, 9); assert.equal(h1.removable, true);
  assert.equal(describeElement(source, at('<p className="lede">')).text.value, "Baked by hand in Sarajevo & sold warm");
  assert.match(describeElement(source, at("<p>We bake")).text.reason, /live values/);
  assert.match(describeElement(source, at("<section")).text.reason, /contains other elements/);
  assert.deepEqual(describeElement(source, at("<section")).style, { padding: "24px" });
  assert.equal(describeElement(source, at("<main")).removable, false, "a component's outer element is not removable");
  const img = describeElement(source, at("<img"));
  assert.deepEqual([img.src.value, img.alt.value], ["/images/hero.webp", "Loaves on a wooden rack"]);
  assert.equal(describeElement(source, at("<a href")).href.value, "#menu");
  assert.equal(describeElement(source, at('<p>{"Open')).text.value, "Open every day");
  assert.equal(describeElement(source, { path: "src/App.tsx", offset: 3 }), null);
});

check("text beside inline accents is edited run by run", () => {
  const h3 = describeElement(source, at("<h3>"));
  assert.deepEqual(h3.text.parts, ["Cooked by the", ", served warm"]);
  const first = ok(applyVisualEdit(source, { kind: "text", loc: at("<h3>"), value: "Picked for the", part: 0 }));
  assert.match(fileOf(first.source, "src/App.tsx"), /<h3>\n {10}Picked for the <em>season<\/em>, served warm\n {8}<\/h3>/);
  const second = ok(applyVisualEdit(source, { kind: "text", loc: at("<h3>"), value: ", and served hot", part: 1 }));
  assert.match(fileOf(second.source, "src/App.tsx"), /<em>season<\/em>, and served hot\n {8}<\/h3>/, "the run's layout whitespace is kept");
  assert.equal(applyVisualEdit(source, { kind: "text", loc: at("<h3>"), value: "x", part: 5 }).ok, false);
  assert.equal(describeElement(source, at("<em>")).text.value, "season");
  assert.match(describeElement(source, at("<section")).text.reason, /contains other elements/, "block children are not runs");
});

check("text from data resolves to its one string literal, and refuses ambiguous text", () => {
  const span = at("<span>{item.name}");
  const sourdough = describeElement(source, span, "Sourdough loaf");
  assert.equal(sourdough.text.path, "src/data.ts"); assert.equal(sourdough.text.shared, true); assert.equal(sourdough.text.line, 2);
  const edited = ok(applyVisualEdit(source, { kind: "text", loc: span, value: "Sourdough \"country\" loaf", rendered: "Sourdough loaf" }));
  assert.match(fileOf(edited.source, "src/data.ts"), /name: "Sourdough \\"country\\" loaf"/);
  const rye = ok(applyVisualEdit(source, { kind: "text", loc: span, value: "Rye's best", rendered: "Rye & caraway" }));
  assert.match(fileOf(rye.source, "src/data.ts"), /name: 'Rye\\'s best'/);
  assert.match(describeElement(source, span, "Cinnamon bun").text.reason, /several places/);
  assert.match(describeElement(source, span, "Not in the code").text.reason, /produced by code/);
});

check("text edits keep formatting, escape JSX and refuse empty or oversized text", () => {
  const h1 = ok(applyVisualEdit(source, { kind: "text", loc: at("<h1>"), value: "Warm bread, every morning" }));
  assert.match(fileOf(h1.source, "src/App.tsx"), /<h1>Warm bread, every morning<\/h1>/);
  assert.equal(h1.summary, "Edited text of <h1> in src/App.tsx");
  const braces = ok(applyVisualEdit(source, { kind: "text", loc: at("<h1>"), value: "Bread {fresh} <today> & more" }));
  assert.match(fileOf(braces.source, "src/App.tsx"), /<h1>\{"Bread \{fresh\} <today> & more"\}<\/h1>/);
  const literal = ok(applyVisualEdit(source, { kind: "text", loc: at('<p>{"Open'), value: "Open 7–19 daily" }));
  assert.match(fileOf(literal.source, "src/App.tsx"), /<p>\{"Open 7–19 daily"\}<\/p>/);
  assert.equal(applyVisualEdit(source, { kind: "text", loc: at("<h1>"), value: "   " }).ok, false);
  assert.equal(applyVisualEdit(source, { kind: "text", loc: at("<h1>"), value: "x".repeat(2001) }).ok, false);
  assert.match(applyVisualEdit(source, { kind: "text", loc: at("<h1>"), value: "Fresh bread daily" }).message, /Nothing changed/);
});

check("style edits merge into literal objects, wrap expressions, add and remove the attribute", () => {
  const merged = ok(applyVisualEdit(source, { kind: "style", loc: at("<section"), style: { color: "#1a2b3c", padding: "32px 16px" } }));
  assert.match(fileOf(merged.source, "src/App.tsx"), /<section className="hero" style=\{\{ padding: "32px 16px", color: "#1a2b3c" \}\}>/);
  assert.deepEqual(describeElement(merged.source, at("<section", merged.source)).style, { padding: "32px 16px", color: "#1a2b3c" });
  const added = ok(applyVisualEdit(source, { kind: "style", loc: at("<h1>"), style: { textAlign: "center", fontWeight: "700" } }));
  assert.match(fileOf(added.source, "src/App.tsx"), /<h1 style=\{\{ textAlign: "center", fontWeight: "700" \}\}>Fresh bread daily<\/h1>/);
  const selfClosing = ok(applyVisualEdit(source, { kind: "style", loc: at("<img"), style: { borderRadius: "12px" } }));
  assert.match(fileOf(selfClosing.source, "src/App.tsx"), /alt="Loaves on a wooden rack" style=\{\{ borderRadius: "12px" \}\} \/>/);
  const wrapped = ok(applyVisualEdit(source, { kind: "style", loc: at("<h2"), style: { color: "rgb(10, 20, 30)" } }));
  assert.match(fileOf(wrapped.source, "src/App.tsx"), /<h2 style=\{\{ \.\.\.heading, color: "rgb\(10, 20, 30\)" \}\}>/);
  const cleared = ok(applyVisualEdit(source, { kind: "style", loc: at("<section"), style: { padding: "" } }));
  assert.match(fileOf(cleared.source, "src/App.tsx"), /<section className="hero">/);
  for (const style of [{ color: "red; background:url(x)" }, { fontSize: "12px;" }, { padding: "1px 2px 3px 4px 5px" }, { position: "fixed" }])
    assert.equal(applyVisualEdit(source, { kind: "style", loc: at("<h1>"), style }).ok, false, JSON.stringify(style));
});

check("links, image descriptions and project images are validated", () => {
  const link = ok(applyVisualEdit(source, { kind: "attribute", loc: at("<a href"), name: "href", value: "/contact" }));
  assert.match(fileOf(link.source, "src/App.tsx"), /<a href="\/contact" className="cta">/);
  for (const value of ["javascript:alert(1)", "data:text/html,x", "//evil.example", "/a b"]) assert.equal(applyVisualEdit(source, { kind: "attribute", loc: at("<a href"), name: "href", value }).ok, false, value);
  const alt = ok(applyVisualEdit(source, { kind: "attribute", loc: at("<img"), name: "alt", value: "Rye \"loaves\" cooling" }));
  assert.match(fileOf(alt.source, "src/App.tsx"), /alt=\{"Rye \\"loaves\\" cooling"\}/);
  const image = ok(applyVisualEdit(source, { kind: "attribute", loc: at("<img"), name: "src", value: "/images/oven.webp" }, ASSETS));
  assert.match(fileOf(image.source, "src/App.tsx"), /src="\/images\/oven.webp"/);
  assert.equal(applyVisualEdit(source, { kind: "attribute", loc: at("<img"), name: "src", value: "https://example.com/x.png" }, ASSETS).ok, false);
  assert.equal(applyVisualEdit(source, { kind: "attribute", loc: at("<h1>"), name: "href", value: "/x" }).ok, false);
});

check("removal drops whole lines, refuses outer elements, and selections are remapped", () => {
  const removed = ok(applyVisualEdit(source, { kind: "remove", loc: at("<small>") }));
  assert.doesNotMatch(fileOf(removed.source, "src/App.tsx"), /Since 1998/);
  assert.match(fileOf(removed.source, "src/App.tsx"), /<p>\{"Open every day"\}<\/p>\n {6}<\/footer>/);
  assert.equal(applyVisualEdit(source, { kind: "remove", loc: at("<main") }).ok, false);
  assert.equal(applyVisualEdit(source, { kind: "remove", loc: at("<li key") }).ok, false, "elements inside {…} stay in Code");
  const footer = at("<footer>");
  const edit = ok(applyVisualEdit(source, { kind: "text", loc: at("<h1>"), value: "Bread" }));
  const moved = remapLoc(footer, edit.change);
  assert.equal(fileOf(edit.source, "src/App.tsx")[moved.offset], "<");
  assert.equal(describeElement(edit.source, moved).tag, "footer");
  assert.deepEqual(remapLoc(at("<h1>"), edit.change), at("<h1>"), "the edited element keeps its place");
  const styled = ok(applyVisualEdit(source, { kind: "style", loc: at("<h1>"), style: { color: "#000" } }));
  assert.equal(describeElement(styled.source, remapLoc(footer, styled.change)).tag, "footer");
  assert.equal(describeElement(styled.source, remapLoc(at("<h1>"), styled.change)).tag, "h1");
  assert.equal(remapLoc(at("<small>"), removed.change), null);
  assert.deepEqual(remapLoc({ path: "src/data.ts", offset: 5 }, edit.change), { path: "src/data.ts", offset: 5 });
});

check("stale selections and managed files fail closed", () => {
  assert.match(applyVisualEdit(source, { kind: "text", loc: { path: "src/App.tsx", offset: 1 }, value: "x" }).message, /changed since you selected/);
  assert.match(applyVisualEdit(source, { kind: "text", loc: { path: "src/Missing.tsx", offset: 0 }, value: "x" }).message, /changed since you selected/);
});

check("handing a text to the client moves it into site.json without changing the page", () => {
  const { ProjectFiles } = require("./files.ts");
  const { contentKey, contentImportPath, SITE_CONTENT_IMPORT } = require("./visual-edit.ts");
  assert.equal(contentKey("Hero headline", []), "heroHeadline");
  assert.equal(contentKey("Hero headline", ["heroHeadline"]), "heroHeadline2");
  assert.equal(contentKey("2025 offer!", []), "text2025Offer");
  assert.equal(contentKey("Čevapi — opening", []), "cevapiOpening");
  assert.equal(contentKey("!!!", []), "text");
  assert.equal(contentImportPath("src/App.tsx"), "./content/site.json");
  assert.equal(contentImportPath("src/components/Hero.tsx"), "../content/site.json");
  assert.equal(contentImportPath("src/content/x.ts"), "./site.json");

  const first = ok(applyVisualEdit(source, { kind: "extract", loc: at("<h1>"), label: "Headline" }));
  const app = fileOf(first.source, "src/App.tsx");
  assert.match(app, /<h1>\{siteContent\.headline\}<\/h1>/);
  assert.match(app, /^import \{ MENU \} from "\.\/data";\nimport siteContent from "\.\/content\/site\.json";\n/m, "import goes after the last import");
  const manifest = JSON.parse(fileOf(first.source, "src/content/collections.json"));
  assert.deepEqual(manifest.collections.site, { label: "Website text", kind: "single", fields: { headline: { type: "text", label: "Headline", required: true, max: 80 } } });
  assert.deepEqual(JSON.parse(fileOf(first.source, "src/content/site.json")), { headline: "Fresh bread daily" });
  assert.deepEqual(new ProjectFiles(first.source).problems(), []);
  assert.match(describeElement(first.source, at("<h1>", first.source)).text.reason, /client edits this text in their portal, under Website text/, "a handed-over text says where it is edited");
  assert.equal(describeElement(source, at('<p>{"Open')).text.value, "Open every day", "other expressions are unaffected");
  assert.equal(describeElement(first.source, remapLoc(at("<footer>"), first.change)).tag, "footer", "selection survives the import insert");

  const second = ok(applyVisualEdit(first.source, { kind: "extract", loc: at('<p className="lede">', first.source), label: "Headline" }));
  const app2 = fileOf(second.source, "src/App.tsx");
  assert.equal(app2.split(SITE_CONTENT_IMPORT + " from").length, 2, "one import");
  assert.match(app2, /<p className="lede">\{siteContent\.headline2\}<\/p>/);
  assert.deepEqual(JSON.parse(fileOf(second.source, "src/content/site.json")), { headline: "Fresh bread daily", headline2: "Baked by hand in Sarajevo & sold warm" });
  assert.deepEqual(Object.keys(JSON.parse(fileOf(second.source, "src/content/collections.json")).collections.site.fields), ["headline", "headline2"]);
  assert.deepEqual(new ProjectFiles(second.source).problems(), []);

  const literal = ok(applyVisualEdit(source, { kind: "extract", loc: at('<p>{"Open'), label: "Opening line" }));
  assert.match(fileOf(literal.source, "src/App.tsx"), /<p>\{siteContent\.openingLine\}<\/p>/);
  assert.deepEqual(new ProjectFiles(literal.source).problems(), []);
});

check("hand-over keeps existing collections, multi-line imports and refuses what it can't move", () => {
  const { ProjectFiles } = require("./files.ts");
  const withImports = { ...source, files: source.files.map(file => file.path === "src/App.tsx"
    ? { ...file, content: file.content.replace('import { MENU } from "./data";', 'import {\n  MENU,\n  TAGLINE,\n} from "./data";') } : file) };
  const multi = ok(applyVisualEdit(withImports, { kind: "extract", loc: at("<small>", withImports), label: "Since" }));
  assert.match(fileOf(multi.source, "src/App.tsx"), /\n\} from "\.\/data";\nimport siteContent from "\.\/content\/site\.json";\n/);
  assert.deepEqual(new ProjectFiles(multi.source).problems(), []);

  const hours = { version: 1, collections: { hours: { label: "Hours", kind: "single", fields: { note: { type: "text", label: "Note" } } } } };
  const declared = { ...source, files: [...source.files,
    { path: "src/content/collections.json", content: JSON.stringify(hours) },
    { path: "src/content/hours.json", content: "{\"note\":\"Closed Sundays\"}" }].map(file => file.path === "src/App.tsx"
    ? { ...file, content: `import hoursData from "./content/hours.json";\n${file.content.replace("<small>Since 1998</small>", "<small>{hoursData.note}</small>")}` } : file) };
  const kept = ok(applyVisualEdit(declared, { kind: "extract", loc: at("<h1>", declared), label: "Headline" }));
  assert.deepEqual(Object.keys(JSON.parse(fileOf(kept.source, "src/content/collections.json")).collections), ["hours", "site"]);
  assert.deepEqual(new ProjectFiles(kept.source).problems(), []);

  assert.match(applyVisualEdit(source, { kind: "extract", loc: at("<h3>"), label: "Tagline" }).message, /styled differently/);
  assert.equal(applyVisualEdit(source, { kind: "extract", loc: at("<p>We bake"), label: "Bake" }).ok, false, "live values stay in code");
  assert.match(applyVisualEdit(source, { kind: "extract", loc: at("<h1>"), label: " <> " }).message, /Give this text a name/);
  const clash = { ...source, files: source.files.map(file => file.path === "src/App.tsx" ? { ...file, content: file.content.replace("const heading", "const siteContent = 1;\nconst heading") } : file) };
  assert.match(applyVisualEdit(clash, { kind: "extract", loc: at("<h1>", clash), label: "Headline" }).message, /already uses the name siteContent/);
  const list = { ...declared, files: declared.files.map(file => file.path === "src/content/collections.json"
    ? { ...file, content: JSON.stringify({ version: 1, collections: { ...hours.collections, site: { label: "Sites", kind: "list", fields: { name: { type: "text", label: "Name" } } } } }) } : file) };
  assert.match(applyVisualEdit(list, { kind: "extract", loc: at("<h1>", list), label: "Headline" }).message, /“site” for a list/);
});

console.log(`\n${passed} visual edit checks passed.`);
