/* eslint-disable @typescript-eslint/no-require-imports -- Offline builder checks (no network, no paid calls). */
const fs = require("node:fs"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true}}).outputText, filename);
const {ProjectFiles, FileToolError} = require("./files.ts");
const {usageCost, creditsForUsd, BUILDER_EFFORT} = require("./pricing.ts");
const {renderHostedSnapshot} = require("../hosting/snapshot.ts");
const {ReviewInputSchema, reviewRequest, reviewAttachments} = require("./review.ts");
const {REVIEW_LIMITS, REVIEW_VIEWPORTS, autoReviewRounds, reviewCreditCeiling, REVIEW_MAX_TURNS} = require("./review-policy.ts");

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
const shot = (viewport, index, of, extra = {}) => ({viewport, index, of, mediaType: "image/jpeg", width: viewport === "desktop" ? 1080 : 390, height: 600, data: "A".repeat(400), ...extra});
const report = (viewport, extra = {}) => ({viewport, width: viewport === "desktop" ? 1440 : 390, height: viewport === "desktop" ? 900 : 844, pageHeight: 5000, capturedHeight: 3600, overflowX: 0, wide: [], brokenImages: [], missingAlt: 0, ...extra});
check("review requests validate screenshot counts, sizes and encoding", () => {
  const valid = {round: 1, screenshots: [shot("desktop", 0, 2), shot("desktop", 1, 2), shot("mobile", 0, 1)], viewports: [report("desktop"), report("mobile")], errors: []};
  assert.ok(ReviewInputSchema.safeParse(valid).success);
  assert.equal(ReviewInputSchema.parse({...valid, round: undefined}).round, 1);
  const reject = (input, why) => assert.equal(ReviewInputSchema.safeParse(input).success, false, why);
  reject({...valid, screenshots: [], errors: []}, "needs screenshots or errors");
  assert.ok(ReviewInputSchema.safeParse({...valid, screenshots: [], errors: ["Build error: x"]}).success, "errors alone are reviewable");
  reject({...valid, screenshots: [shot("desktop", 0, 1, {data: "A".repeat(REVIEW_LIMITS.maxShotBase64 + 4)})]}, "oversized screenshot");
  reject({...valid, screenshots: [shot("desktop", 0, 1, {data: "<script>".repeat(40)})]}, "non-base64 data");
  reject({...valid, screenshots: [shot("desktop", 0, 1, {width: REVIEW_LIMITS.maxShotEdge + 1})]}, "edge over the limit");
  reject({...valid, screenshots: [shot("desktop", 3, 2)]}, "index past the count");
  reject({...valid, screenshots: [shot("desktop", 0, 1, {mediaType: "image/svg+xml"})]}, "svg screenshots");
  const desktopMax = REVIEW_VIEWPORTS.find(v => v.id === "desktop").maxTiles;
  reject({...valid, screenshots: Array.from({length: desktopMax + 1}, (_, i) => shot("desktop", i, desktopMax + 1))}, "too many desktop tiles");
  reject({...valid, viewports: [report("mobile"), report("mobile")]}, "duplicate viewport report");
  reject({...valid, round: 3}, "at most two rounds");
  reject({...valid, errors: Array.from({length: REVIEW_LIMITS.maxErrors + 1}, () => "x")}, "too many errors");
  reject({...valid, extra: true}, "unknown fields");
});
check("review prompt carries diagnostics, errors and ordered screenshots", () => {
  const input = ReviewInputSchema.parse({round: 2, screenshots: [shot("mobile", 0, 1), shot("desktop", 1, 2), shot("desktop", 0, 2)],
    viewports: [report("mobile", {overflowX: 37, wide: ['div.pricing "Plans"'], brokenImages: ["/images/missing.webp"], missingAlt: 2})], errors: ["Desktop: TypeError: x is undefined"]});
  const text = reviewRequest(input);
  assert.match(text, /37px wider than the viewport/);
  assert.match(text, /div\.pricing/);
  assert.match(text, /missing\.webp/);
  assert.match(text, /TypeError: x is undefined/);
  assert.match(text, /review round 2/);
  assert.match(text, /No changes needed — the design passed review\./);
  const blocks = reviewAttachments(input);
  assert.equal(blocks.filter(block => block.type === "image").length, 3);
  assert.deepEqual(blocks.filter(block => block.type === "text").map(block => block.text), ["Desktop 1440px — screen 1 of 2", "Desktop 1440px — screen 2 of 2", "Mobile 390px — screen 1 of 1"]);
});
check("review policy: auto rounds by effort and change size, bounded credits and tiles", () => {
  assert.equal(autoReviewRounds("light", {firstBuild: true, filesTouched: 9}), 0);
  assert.equal(autoReviewRounds("medium", {firstBuild: true, filesTouched: 1}), 1);
  assert.equal(autoReviewRounds("high", {firstBuild: false, filesTouched: 2}), 0);
  assert.equal(autoReviewRounds("high", {firstBuild: false, filesTouched: 3}), 1);
  assert.equal(autoReviewRounds("ultra", {firstBuild: true, filesTouched: 5}), 2);
  for (const [level, policy] of Object.entries(BUILDER_EFFORT)) {
    const ceiling = reviewCreditCeiling(policy.ceilingCredits);
    assert.ok(ceiling <= policy.ceilingCredits && ceiling >= Math.min(12, policy.ceilingCredits), level);
    assert.ok(ceiling <= Math.max(12, Math.ceil(policy.ceilingCredits * 0.3)), `${level} review stays a fraction of a build`);
  }
  assert.ok(REVIEW_MAX_TURNS >= 2 && REVIEW_MAX_TURNS <= 8);
  assert.equal(REVIEW_LIMITS.maxShots, REVIEW_VIEWPORTS.reduce((sum, v) => sum + v.maxTiles, 0));
  for (const v of REVIEW_VIEWPORTS) {
    assert.ok(Math.round(v.width * v.scale) <= REVIEW_LIMITS.maxShotEdge && Math.round(v.height * v.scale) <= REVIEW_LIMITS.maxShotEdge, v.id);
    // Rough Claude image-token estimate (w*h/750) keeps one round of screenshots cheap.
    assert.ok(v.maxTiles * (v.width * v.scale) * (v.height * v.scale) / 750 < 8000, `${v.id} tiles stay under ~8k tokens`);
  }
});
console.log(`${count} builder checks passed`);
