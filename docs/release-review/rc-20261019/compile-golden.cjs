/* eslint-disable @typescript-eslint/no-require-imports -- Evidence script: candidate compile gate over saved golden websites (no AI, no network). */
// Runs the candidate's finish-time compile gate (compileVerdict over compileWebsite) and the
// static project check on the 20 saved golden websites, plus negative controls, so "passed",
// "failed" and "unverified" are each observed. Output: compile-golden.json.
// Usage (worktree root): node docs/release-review/rc-20261019/compile-golden.cjs
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module");
const ROOT = process.cwd();
const load = Module._load;
Module._load = function (name, parent, main) {
  if (name === "server-only") return {};
  if (name.startsWith("@/")) return load.call(this, path.join(ROOT, "src", name.slice(2)), parent, main);
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const { compileWebsite, compileVerdict } = require(path.join(ROOT, "src/lib/builder/compile.ts"));
const { ProjectFiles } = require(path.join(ROOT, "src/lib/builder/files.ts"));
const GOLDEN = path.resolve(ROOT, "../../../outputs/eval/runs/live-20261018T161405Z");
(async () => {
  const sites = fs.readdirSync(GOLDEN).filter(name => /^w\d\d-/.test(name) && fs.existsSync(path.join(GOLDEN, name, "source.json")));
  const results = [];
  for (const site of sites) {
    const source = JSON.parse(fs.readFileSync(path.join(GOLDEN, site, "source.json"), "utf8"));
    const files = new ProjectFiles(source.websiteSource ?? source);
    const outcome = await compileWebsite(files.files);
    const verdict = await compileVerdict(files.files, async () => outcome);
    results.push({ site, files: files.files.size, staticProblems: files.problems().length, compile: outcome.ok, ms: outcome.ms, verdict: verdict.status, errors: outcome.ok === false ? outcome.errors.slice(0, 2) : undefined });
  }
  // Negative controls on a real golden project: a syntax error must fail; an engine timeout must be unverified.
  const first = JSON.parse(fs.readFileSync(path.join(GOLDEN, sites[0], "source.json"), "utf8"));
  const broken = new ProjectFiles(first.websiteSource ?? first);
  broken.write("src/App.tsx", "export default function App() { return <main><h1>Broken</main>; }");
  const controls = {
    syntaxError: (await compileVerdict(broken.files)).status,
    missingImport: await (async () => { const f = new ProjectFiles(first.websiteSource ?? first); f.write("src/App.tsx", 'import Missing from "./components/DoesNotExist";\nexport default function App() { return <Missing />; }'); return (await compileVerdict(f.files)).status; })(),
    engineTimeout: (await compileVerdict(new ProjectFiles(first.websiteSource ?? first).files, async () => ({ ok: null, ms: 20000, reason: "compile timed out" }))).status,
    realOneMsBudget: (await compileWebsite(new ProjectFiles(first.websiteSource ?? first).files, { timeoutMs: 1 })).ok,
  };
  const summary = { at: new Date().toISOString(), source: "outputs/eval/runs/live-20261018T161405Z/*/source.json (reused)", sites: results.length,
    passed: results.filter(r => r.verdict === "passed").length, failed: results.filter(r => r.verdict === "failed").map(r => r.site), unverified: results.filter(r => r.verdict === "unverified").map(r => r.site),
    medianMs: results.map(r => r.ms).sort((a, b) => a - b)[Math.floor(results.length / 2)], maxMs: Math.max(...results.map(r => r.ms)), controls, results };
  fs.writeFileSync("docs/release-review/rc-20261019/compile-golden.json", JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, results: undefined }, null, 2));
})().catch(error => { console.error(error); process.exit(1); });
