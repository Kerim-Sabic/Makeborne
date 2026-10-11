/* eslint-disable @typescript-eslint/no-require-imports -- Offline builder checks (no network, no paid calls). */
const fs = require("node:fs"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  // Node esbuild-wasm needs no browser initialisation (wasmURL/worker).
  if (name === "esbuild-wasm" && parent?.filename?.endsWith("browser-bundler.ts")) return {...load.call(this, name, parent, main), initialize: async () => {}};
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true}}).outputText, filename);
const {ProjectFiles, FileToolError} = require("./files.ts");
const {usageCost, creditsForUsd, BUILDER_EFFORT} = require("./pricing.ts");
const {renderHostedSnapshot} = require("../hosting/snapshot.ts");

let count = 0;
function check(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
const base = () => {
  const files = new ProjectFiles();
  files.write("index.html", '<!doctype html><html><head><title>T</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>');
  files.write("src/main.tsx", 'import { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./styles.css";\ncreateRoot(document.getElementById("root")!).render(<App />);');
  files.write("src/App.tsx", 'export default function App() { return <main><h1>Hello</h1></main>; }');
  files.write("src/styles.css", "body { margin: 0 }");
  return files;
};

check("a complete project validates with pinned toolchain files", () => {
  const files = base();
  assert.deepEqual(files.problems(), []);
  const source = files.toSource();
  assert.ok(source.files.some(file => file.path === "package.json"));
  assert.ok(source.files.some(file => file.path === "package-lock.json"));
  assert.deepEqual(source.routes, [{path: "/", title: "Home"}]);
});
check("protected and unsafe paths are rejected", () => {
  const files = base();
  for (const path of ["package.json", "vite.config.ts", "../escape.ts", "public/x.png", ".env", "src/a.exe", "node_modules/x.js"]) {
    assert.throws(() => files.write(path, "x"), FileToolError, path);
  }
});
check("edit requires an exact unique match", () => {
  const files = base();
  assert.throws(() => files.edit("src/App.tsx", "Missing", "x"), /not found/);
  files.write("src/twice.ts", "a a");
  assert.throws(() => files.edit("src/twice.ts", "a", "b"), /appears 2 times/);
  files.edit("src/twice.ts", "a", "b", true);
  assert.equal(files.files.get("src/twice.ts"), "b b");
  files.edit("src/App.tsx", "Hello", "Hi $& there");
  assert.match(files.files.get("src/App.tsx"), /Hi \$& there/);
});
check("static checks catch missing imports, unknown packages and stray asset paths", () => {
  const files = base();
  files.write("src/App.tsx", 'import { motion } from "framer-motion";\nimport Hero from "./components/Hero";\nexport default function App() { return <img src="/images/none.webp" />; }');
  files.write("src/extra.css", '@import "./missing.css";');
  const problems = files.problems().join("\n");
  assert.match(problems, /framer-motion/);
  assert.match(problems, /components\/Hero/);
  assert.match(problems, /missing\.css/);
});
check("file and folder names cannot collide", () => {
  const files = base();
  assert.throws(() => files.write("src/App.tsx/inner.ts", "x"), FileToolError);
  assert.throws(() => files.write("SRC/app.tsx", "x"), FileToolError);
});
check("pricing converts usage to whole credits and respects effort ceilings", () => {
  const usd = usageCost("claude-opus-5-5", {input_tokens: 100_000, output_tokens: 20_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0});
  assert.equal(Math.round(usd * 100) / 100, 0.8);
  assert.equal(creditsForUsd(0.8), 27); // $0.03 per credit, rounded up
  assert.equal(creditsForUsd(0.03), 1);
  assert.equal(creditsForUsd(0), 0);
  assert.ok(usageCost("unknown-model", {input_tokens: 1_000_000, output_tokens: 0}) >= 4);
  for (const level of Object.values(BUILDER_EFFORT)) assert.ok(level.ceilingCredits > 0 && level.maxTurns > 0);
  const ceilings = Object.values(BUILDER_EFFORT).map(level => level.ceilingCredits);
  assert.deepEqual([...ceilings].sort((a, b) => a - b), ceilings);
  assert.ok(ceilings[0] * 0.03 >= 0.5, "light must afford a typical ~$0.20 chat edit with headroom");
});
check("published snapshots drop scripts, handlers and remote resources", () => {
  const html = renderHostedSnapshot('<!doctype html><html lang="de"><head><style>body{background:url(https://evil.test/x.png)} .a{color:red}</style><script>alert(1)</script></head><body><main><h1 onclick="steal()">Hi</h1><img src="https://evil.test/a.png" alt="x"><img src="data:image/webp;base64,AAAA" alt="ok"><a href="javascript:alert(1)">bad</a><a href="#top">top</a><script>evil()</script><iframe src="https://x"></iframe><svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg></main></body></html>', "Site", "Desc", "https://sites.makeborne.com/site");
  assert.doesNotMatch(html, /<script|onclick|javascript:|evil\.test|<iframe/i);
  assert.match(html, /data:image\/webp;base64,AAAA/);
  assert.match(html, /href="#top"/);
  assert.match(html, /<svg viewBox="0 0 10 10"><path d="M0 0L10 10"/);
  assert.match(html, /lang="de"/);
  assert.match(html, /\.a\{color:red\}/);
});
const {detectFonts, fontFaceRule, unavailableFonts, FONT_CATALOG, FONTS_BY_ID} = require("./fonts.ts");
const {lucideImports, lucideIconFile, unknownLucideIcons, LUCIDE_VERSION} = require("./icons.ts");
const {BUILDER_SYSTEM} = require("./prompt.ts");

check("font catalogue is complete and documented in the prompt", () => {
  assert.ok(FONT_CATALOG.length >= 16 && FONT_CATALOG.length <= 24);
  assert.equal(new Set(FONT_CATALOG.map(font => font.family)).size, FONT_CATALOG.length);
  for (const category of ["serif", "sans", "mono", "display"]) assert.ok(FONT_CATALOG.some(font => font.category === category), category);
  for (const font of FONT_CATALOG) {
    assert.match(font.weight, /^\d{3,4}( \d{3,4})?$/);
    assert.ok(BUILDER_SYSTEM.includes(`"${font.family}"`), `${font.family} is documented in the prompt`);
  }
  assert.doesNotMatch(BUILDER_SYSTEM, /no icon librar|system font stacks/i);
});
check("fonts are detected only when a project references them", () => {
  const css = (content, extra = {}) => detectFonts(Object.entries({"src/styles/tokens.css": content, ...extra}));
  assert.deepEqual(css(':root{--font-display:"Fraunces", Georgia, serif;--font-text:\'DM Sans\', system-ui}').fonts.map(font => font.id), ["fraunces", "dm-sans"]);
  assert.deepEqual(css("h1{font-family: Space Grotesk, sans-serif}").fonts.map(font => font.id), ["space-grotesk"]);
  assert.deepEqual(css("body{color:red}", {"src/main.tsx": 'import "@makeborne/fonts/bebas-neue.css";'}).fonts.map(font => font.id), ["bebas-neue"]);
  assert.deepEqual(css("p{font-family: Georgia, serif} .internal{content:'International'}").fonts, []);
  assert.deepEqual(css('h1{font-family:"Inter Tight"}').fonts, [], "a different family is not Inter");
  assert.equal(css('h1{font-family:"Fraunces"}').italic, false);
  assert.equal(css('h1{font-family:"Fraunces"}', {"src/App.tsx": "<p>A <em>very</em> good loaf</p>"}).italic, true);
  assert.equal(css('h1{font-family:"Fraunces";font-style:italic}').italic, true);
  assert.equal(fontFaceRule(FONTS_BY_ID.get("archivo"), "normal", "data:font/woff2;base64,AA"),
    '@font-face{font-family:"Archivo";font-style:normal;font-weight:100 900;font-stretch:62% 125%;font-display:swap;src:url(data:font/woff2;base64,AA) format("woff2")}');
  assert.deepEqual(unavailableFonts(':root{--display:"Poppins", sans-serif} p{font-family: Georgia, "Montserrat"}'), ["Poppins"]);
});
check("lucide imports resolve names, aliases and Icon/Lucide spellings", () => {
  assert.equal(LUCIDE_VERSION, require("lucide-react/package.json").version, "run: node scripts/prepare-builder-runtime.mjs --icons-manifest");
  const found = lucideImports('import {\n  ArrowRight,\n  AlertTriangle as Warn,\n  MailIcon, LucideHome, type LucideIcon\n} from "lucide-react";\nimport type { LucideProps } from "lucide-react";');
  assert.deepEqual(found, {names: ["ArrowRight", "AlertTriangle", "MailIcon", "LucideHome"], problems: []});
  assert.equal(lucideIconFile("ArrowRight"), "arrow-right");
  assert.equal(lucideIconFile("AlertTriangle"), "triangle-alert");
  assert.equal(lucideIconFile("MailIcon"), "mail");
  assert.equal(lucideIconFile("LucideHome"), "house");
  assert.deepEqual(unknownLucideIcons(["ArrowRight", "Instagram", "Icon", "Sparklez"]), ["Instagram", "Sparklez"]);
  assert.equal(lucideImports('import * as Icons from "lucide-react";').problems.length, 1);
  assert.equal(lucideImports('import Icons from "lucide-react";').problems.length, 1);
  assert.equal(lucideImports('import { X } from "lucide-react/dynamic";').problems.length, 1);
});
check("static checks accept the font library and icons but reject unknown ones", () => {
  const files = base();
  files.write("src/App.tsx", 'import "@makeborne/fonts/fraunces.css";\nimport { ArrowUpRight, Instagram } from "lucide-react";\nexport default function App() { return <main><h1>Hi <ArrowUpRight /></h1><Instagram /></main>; }');
  files.write("src/styles.css", ':root{--font-display:"Poppins", sans-serif}\n@import "@makeborne/fonts/comic-sans.css";\n@import url("https://fonts.googleapis.com/css2?family=Inter");');
  const problems = files.problems().join("\n");
  assert.match(problems, /Instagram/);
  assert.doesNotMatch(problems, /ArrowUpRight|fraunces/);
  assert.match(problems, /"Poppins", which is not available/);
  assert.match(problems, /comic-sans\.css", which is not in the font library/);
  assert.match(problems, /Remote stylesheets/);
  files.write("src/styles.css", ':root{--font-display:"Fraunces", Georgia, serif}');
  files.write("src/App.tsx", 'import { ArrowUpRight } from "lucide-react";\nexport default function App() { return <main><h1>Hi <ArrowUpRight /></h1></main>; }');
  assert.deepEqual(files.problems(), []);
});
check("published snapshots keep embedded woff2 fonts and Lucide SVG markup", () => {
  const icon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>';
  const html = renderHostedSnapshot(`<!doctype html><html><head><style>@font-face{font-family:"Fraunces";src:url(data:font/woff2;base64,d09GMgAB) format("woff2")}@font-face{font-family:"X";src:url(https://fonts.gstatic.com/x.woff2)}</style></head><body><main>${icon}</main></body></html>`, "Site", "Desc", "https://sites.makeborne.com/site");
  assert.match(html, /url\(data:font\/woff2;base64,d09GMgAB\)/);
  assert.doesNotMatch(html, /gstatic/);
  assert.ok(html.includes(icon), "inline Lucide SVG survives sanitising");
});

/** The in-browser bundler, run in Node against the prepared runtime files. */
async function checkBundler() {
  const {join} = require("node:path");
  const root = join(__dirname, "..", "..", "..");
  const runtime = join(root, "public", "builder-runtime");
  // Offline and idempotent: refreshes the generated runtime when its stamp changed.
  const prepared = require("node:child_process").spawnSync(process.execPath, ["scripts/prepare-builder-runtime.mjs"], {cwd: root, encoding: "utf8"});
  assert.equal(prepared.status, 0, prepared.stderr);
  const origin = "http://runtime.test";
  const fetched = [];
  globalThis.location = {origin};
  globalThis.fetch = async url => {
    fetched.push(String(url));
    const path = String(url).startsWith(`${origin}/builder-runtime/`) ? join(runtime, String(url).slice(`${origin}/builder-runtime/`.length)) : "";
    return path && fs.existsSync(path) ? new Response(fs.readFileSync(path)) : new Response("missing", {status: 404});
  };
  const {bundleProject} = require("./browser-bundler.ts");
  const project = Object.fromEntries(base().files);
  project["src/App.tsx"] = 'import { ArrowRight, AlertTriangle, MailIcon } from "lucide-react";\nimport "@makeborne/fonts/jetbrains-mono.css";\nexport default function App() { return <main><h1>Hi <ArrowRight size={18} aria-hidden="true" /></h1><AlertTriangle /><MailIcon /></main>; }';
  project["src/styles.css"] = ':root{--font-display:"Instrument Serif", Georgia, serif} h1{font-family:var(--font-display);font-style:italic}';
  const built = await bundleProject(project, {}, "publish");
  assert.ok(built.ok, built.error);
  const html = built.html;
  assert.match(html, /@font-face\{font-family:"Instrument Serif";font-style:normal;font-weight:400;font-display:swap;src:url\(data:font\/woff2;base64,d09GMg/);
  assert.match(html, /font-family:"Instrument Serif";font-style:italic/);
  assert.match(html, /font-family:"JetBrains Mono";font-style:normal/);
  assert.doesNotMatch(html, /font-family:"Fraunces"/, "unused fonts are not embedded");
  assert.ok(html.includes("M5 12h14") && html.includes("m12 5 7 7-7 7"), "imported icons are bundled");
  assert.ok(!html.includes('"arrow-left"') && !/from\s*"lucide-react"/.test(html), "only imported icons, no bare import left");
  assert.equal(fetched.filter(url => url.includes("/vendor/lucide/icons/")).length, 3);
  assert.ok(!fetched.some(url => /lucide\/(?:react|chunk)/.test(url)), "Lucide resolves React to the shared vendored copy");
  const broken = await bundleProject({...project, "src/App.tsx": 'import { Instagram } from "lucide-react";\nexport default function App() { return <Instagram />; }'}, {}, "publish");
  assert.equal(broken.ok, false);
  assert.match(broken.error, /Not Lucide icons: Instagram/);
  const unknown = await bundleProject({...project, "src/App.tsx": 'import "@makeborne/fonts/papyrus.css";\nexport default function App() { return null; }'}, {}, "publish");
  assert.match(unknown.error, /not in the font library/);
  count++; console.log("PASS bundler resolves lucide-react per icon and embeds only used fonts");
}

checkBundler().then(() => console.log(`${count} builder checks passed`), error => { console.error(error); process.exit(1); });
