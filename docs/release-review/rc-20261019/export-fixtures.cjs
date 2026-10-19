/* eslint-disable @typescript-eslint/no-require-imports -- Evidence script: renders the candidate's exports from saved golden documents (no AI, no network). */
// Renders book PDF, deck PDF and deck PPTX with the candidate's own export code
// (src/lib/documents/export-server.ts, the code GET .../document-export calls) from the
// documents saved by the 2026-10-18 golden run. Output: docs/release-review/rc-20261019/exports/.
// Usage (worktree root): node docs/release-review/rc-20261019/export-fixtures.cjs
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), crypto = require("node:crypto");
const ROOT = process.cwd();
const load = Module._load;
Module._load = function (name, parent, main) {
  if (name === "server-only") return {};
  if (name.startsWith("@/")) return load.call(this, path.join(ROOT, "src", name.slice(2)), parent, main);
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
require.extensions[".tsx"] = require.extensions[".ts"];
const { documentPdf, documentPptx } = require(path.join(ROOT, "src/lib/documents/export-server.ts"));
const GOLDEN = path.resolve(ROOT, "../../../outputs/eval/runs/live-20261018T161405Z");
const OUT = path.join(ROOT, "docs/release-review/rc-20261019/exports");
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const results = [];
  for (const [name, dir, formats] of [["book-b02", "b02-repair-table", ["pdf"]], ["deck-d02", "d02-tidewater-seed-pitch", ["pdf", "pptx"]], ["book-b01", "b01-useful-client-brief", ["pdf"]], ["deck-d01", "d01-keep-the-wheels-turning", ["pdf", "pptx"]]]) {
    const doc = JSON.parse(fs.readFileSync(path.join(GOLDEN, dir, "document.json"), "utf8"));
    for (const format of formats) {
      const started = Date.now();
      try {
        const bytes = format === "pdf" ? await documentPdf(doc, {}) : await documentPptx(doc, {});
        const file = path.join(OUT, `${name}.${format}`);
        fs.writeFileSync(file, bytes);
        results.push({ name, format, ok: true, bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), ms: Date.now() - started, assets: (doc.assets ?? []).length });
      } catch (error) {
        results.push({ name, format, ok: false, error: error instanceof Error ? error.message.slice(0, 300) : String(error), ms: Date.now() - started });
      }
    }
  }
  fs.writeFileSync(path.join(OUT, "exports.json"), JSON.stringify({ at: new Date().toISOString(), source: "outputs/eval/runs/live-20261018T161405Z (document.json, reused)", results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exit(1); });
