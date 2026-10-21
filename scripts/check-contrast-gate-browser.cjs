/* eslint-disable @typescript-eslint/no-require-imports -- The rendered-contrast finish gate end to end: a real browser prepares and measures a fixture site from a local origin serving public/builder-runtime, as the build route does on the app origin. Local only, no network. Run: node scripts/check-contrast-gate-browser.cjs [--engine firefox|webkit] */
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), ts = require("typescript"), { createServer } = require("node:http");
const { browserType, engineLabel } = require("./browser-engine.cjs");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { renderedContrastCheck, contrastProblems, MAX_CONTRAST_PROBLEMS } = require("../src/lib/builder/contrast-gate.ts");

const root = path.resolve(__dirname, "..", "public");
const TYPES = { ".js": "text/javascript", ".wasm": "application/wasm", ".woff2": "font/woff2", ".json": "application/json", ".css": "text/css" };
const site = (app, css) => new Map(Object.entries({
  "index.html": '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fixture</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
  "src/main.tsx": 'import { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./styles.css";\ncreateRoot(document.getElementById("root")!).render(<App />);\n',
  "src/App.tsx": app, "src/styles.css": css,
}));

async function main() {
  if (!fs.existsSync(path.join(root, "builder-runtime", "contrast-probe.js"))) throw new Error("public/builder-runtime/contrast-probe.js is missing: run node scripts/prepare-builder-runtime.mjs");
  const requests = [];
  const server = createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    requests.push(req.url);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end(); return; }
    res.setHeader("Content-Type", TYPES[path.extname(file)] ?? "application/octet-stream");
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let passed = 0; const pass = name => { passed++; console.log(`PASS ${name}`); };
  try {
    const check = renderedContrastCheck({ origin, launch: () => browserType.launch({ headless: true }), timeoutMs: 90_000 });
    const failing = await check(site(
      'export default function App() { return <main><section className="block"><h2>Opening hours</h2><p className="muted">Muted note on a peach block</p></section><p className="ok">Readable paragraph</p><a className="link" href="#x">Book a table</a></main>; }\n',
      "body { margin: 0; background: #ffffff; color: #111111; font: 16px/1.5 system-ui, sans-serif; }\n.block { background: #f2ba9b; padding: 24px; }\n.block .muted { color: #9da3a7; }\n.ok { color: #222222; }\n.link { color: #1a3d8f; }\n.link:hover { color: #c9d3ff; }\n"));
    assert.ok(Array.isArray(failing), "the gate ran");
    assert.ok(failing.some(problem => /Muted note on a peach block/.test(problem) && /needs 4\.5:1/.test(problem) && /#9da3a7 on #f2ba9b/.test(problem)), JSON.stringify(failing));
    assert.ok(failing.some(problem => /Book a table/.test(problem) && /on hover/.test(problem)), "hover states are measured");
    assert.ok(!failing.some(problem => /Readable paragraph|Opening hours/.test(problem)), "passing pairs are not reported");
    pass("a failing text pair (muted text on a tinted block) and a failing hover state block the finish with the exact colours and ratio");
    const clean = await check(site('export default function App() { return <main><h1>Clear heading</h1><p>Plain readable text</p></main>; }\n', "body { margin: 0; background: #fafaf7; color: #1b1d1f; font: 16px/1.5 system-ui, sans-serif; }\n"));
    assert.deepEqual(clean, []);
    pass("a site whose text all passes reports no problem");
    assert.ok(requests.every(url => url.startsWith("/builder-runtime/")), `only the runtime is requested: ${requests.filter(url => !url.startsWith("/builder-runtime/")).join(", ")}`);
    pass("only /builder-runtime/* is fetched from the origin; nothing else leaves the page");
    const unavailable = await renderedContrastCheck({ origin, launch: async () => { throw new Error("no browser"); } })(site("export default function App() { return null; }\n", ""));
    assert.equal(unavailable, null);
    pass("no browser: the gate reports unverified (null) and never blocks");
    const many = Array.from({ length: 9 }, (_, index) => ({ page: "/", state: "default", kind: "text", element: `p "${index}"`, ratio: 2 + index / 10, required: 4.5, foreground: "#999999", background: "#ffffff" }));
    const problems = contrastProblems(many);
    assert.equal(problems.length, MAX_CONTRAST_PROBLEMS); assert.match(problems[0], /p "0"/, "worst pair first");
    pass("problems are capped and the worst pair comes first");
  } finally { server.close(); }
  console.log(`${passed} contrast gate checks passed (${engineLabel}, local origin, no network).`);
}
main().catch(error => { console.error(error); process.exit(1); });
