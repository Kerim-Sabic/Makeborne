/* eslint-disable @typescript-eslint/no-require-imports -- Offline schema checks. */
const fs = require("node:fs"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { WebsiteRecordSchema, websiteHref, reviseWebsiteRecord, WebsiteHistorySchema } = require("./website-record.ts");
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
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const at = "2026-10-03T13:00:00.000Z";
const revised = reviseWebsiteRecord(record, [], { ...record, hosting: "New host" }, id(1), at);
assert.equal(revised.history[0].record.hosting, "Example host");
assert.equal(revised.record.hosting, "New host");
assert.equal(record.hosting, "Example host");
assert.equal(reviseWebsiteRecord(revised.record, revised.history, revised.record, id(2), at).changed, false);
assert.equal(reviseWebsiteRecord(undefined, [], record, id(1), at).history.length, 0);
const full = Array.from({length:100}, (_, i) => ({id:id(i+1),record,replacedAt:at}));
assert.throws(() => reviseWebsiteRecord(record, full, {...record, notes:"Changed"}, id(101), at), /100 revisions/);
assert.equal(full.length,100);
assert.equal(WebsiteHistorySchema.safeParse([revised.history[0],revised.history[0]]).success,false);
console.log("23 website record/history assertions passed; no external URLs fetched.");
