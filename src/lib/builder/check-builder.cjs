/* eslint-disable @typescript-eslint/no-require-imports -- Offline builder checks (no network, no paid calls). */
const fs = require("node:fs"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
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
console.log(`${count} builder checks passed`);
