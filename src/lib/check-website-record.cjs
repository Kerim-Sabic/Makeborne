/* eslint-disable @typescript-eslint/no-require-imports -- Offline schema checks. */
const fs = require("node:fs"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { WebsiteRecordSchema, websiteHref } = require("./website-record.ts");
const record = { previewUrl: "https://preview.example.com", liveUrl: "https://example.com", hosting: "Example host", notes: "Handover", updatedAt: "2026-10-03T12:00:00.000Z" };
assert.equal(WebsiteRecordSchema.parse(record).liveUrl, record.liveUrl);
assert.equal(WebsiteRecordSchema.parse({ ...record, liveUrl: "", previewUrl: "" }).liveUrl, "");
for (const liveUrl of ["javascript:alert(1)", "data:text/html,test", "file:///etc/passwd", "https://user:secret@example.com", "not a url"]) {
  assert.equal(WebsiteRecordSchema.safeParse({ ...record, liveUrl }).success, false);
  assert.equal(websiteHref(liveUrl), null);
}
assert.equal(WebsiteRecordSchema.safeParse({ ...record, notes: "a".repeat(5001) }).success, false);
assert.equal(WebsiteRecordSchema.safeParse({ ...record, updatedAt: "yesterday" }).success, false);
assert.equal(WebsiteRecordSchema.parse({ ...record, hosting: " Example host " }).hosting, "Example host");
console.log("15 website record assertions passed; no external URLs fetched.");
