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
    const covered = await check(site(
      'export default function App() { return <main><section className="hero"><h1>Fast repairs</h1><p className="phone">Call (555) 010-0187</p><div className="card">Work order card</div></section><p>Below the hero</p></main>; }\n',
      "body { margin: 0; background: #ffffff; color: #111111; font: 16px/1.5 system-ui, sans-serif; }\n.hero { position: relative; min-height: 400px; }\n.card { position: absolute; top: 40px; left: 0; width: 600px; height: 160px; background: #ffffff; color: #111111; border: 1px solid #111111; }\n"));
    assert.ok(covered.some(problem => /^Covered text: "Call \(555\) 010-0187"/.test(problem) && /hidden under div\.card/.test(problem)), JSON.stringify(covered));
    pass("text painted over by another element (a card over the phone number) blocks the finish");
    const headline = await check(site(
      'export default function App() { return <main><h1 className="big"><span className="line">Nothing gets lost</span> <span className="line"><span className="hl">at handover</span></span></h1><section className="hero"><div className="mock">Night shift docket</div></section><section className="band">Full-width band</section><div className="track"><div className="marquee">Moving words in a marquee band that is wider than the screen</div></div></main>; }\n',
      "body { margin: 0; background: #ffffff; color: #111111; font: 16px/1.5 system-ui, sans-serif; overflow-x: clip; }\n.big { font-size: 96px; line-height: 0.86; margin: 40px; }\n.line { display: block; }\n.hl { background: #ff5a3c; padding: 0.12em 0.1em; }\n.hero { position: relative; height: 300px; }\n.mock { position: absolute; left: 800px; top: 20px; width: 760px; height: 200px; background: #fdf8f4; border: 1px solid #111111; }\n.band { background: #e8eef0; padding: 24px; }\n.track { overflow: hidden; }\n.marquee { width: 2400px; background: #f4f0e0; animation: slide 20s linear infinite; }\n@keyframes slide { to { transform: translateX(-50%); } }\n"));
    assert.ok(headline.some(problem => /^Covered text: "Nothing gets lost"/.test(problem) && /span\.hl/.test(problem)), JSON.stringify(headline));
    assert.ok(headline.some(problem => /^Cut off: div\.mock \("Night shift docket"\) runs past the right edge of the screen at 1440 px wide/.test(problem)), JSON.stringify(headline));
    assert.ok(!headline.some(problem => /section\.band|marquee|div\.track/.test(problem)), "full-width bands and marquees are not cut-off panels");
    pass("a headline highlight painted over the line above, and a card running off the screen edge, block the finish; full-width bands and marquees do not");
    const phone = await check(site(
      'export default function App() { return <><a className="skip" href="#main">Skip to content</a><header className="hdr"><span className="logo">Ledger</span><a className="btn" href="#join">Sign up free</a></header><main id="main"><p>Body</p></main></>; }\n',
      "body { margin: 0; background: #ffffff; color: #111111; font: 16px/1.5 system-ui, sans-serif; overflow-x: clip; }\n.skip { position: absolute; left: -999px; top: 0; }\n.hdr { display: flex; gap: 16px; padding: 12px 20px; }\n.logo { flex: 0 0 auto; width: 220px; }\n.btn { flex: 0 0 auto; width: 130px; background: #111111; color: #ffffff; padding: 8px; }\n"));
    assert.ok(phone.some(problem => /^Cut off: a\.btn \("Sign up free"\) runs past the right edge of the screen at 360 px wide/.test(problem)), JSON.stringify(phone));
    assert.ok(!phone.some(problem => /Skip to content/.test(problem)), "a skip link parked off screen is not cut off");
    pass("on a 360 px phone a header button past the edge blocks the finish; a parked skip link does not");
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
