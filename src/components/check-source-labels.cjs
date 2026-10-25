/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks (audit M09 completion, DOC/IMP source vs output): every composer that lists project source files uses the same AI-readiness classifier and labels; uploads and generated outputs are labelled apart; PDFs state that partial reading can't be shown. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText, filename);
const {decideSources, PDF_PAGES_NOTE, SOURCE_STATE_LABELS} = require("../lib/builder/source-readiness.ts");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const read = file => fs.readFileSync(path.join(__dirname, file), "utf8");
const file = (id, name) => ({id, name, size: 10, type: "", blob: {size: 10}});

check("a ready PDF without the ingestion check says page-level reading isn't reported; 'partial' exists only for a measured result", () => {
  const report = decideSources([file("1", "menu.pdf"), file("2", "hero.png")], new Map([
    ["1", {kind: "readable", mediaType: "application/pdf", bytes: 10, digest: "a"}],
    ["2", {kind: "readable", mediaType: "image/png", bytes: 10, digest: "b"}],
  ]));
  assert.equal(report.entries[0].state, "ready");
  assert.equal(report.entries[0].reason, `AI reads this file with your next request. ${PDF_PAGES_NOTE}`);
  assert.match(PDF_PAGES_NOTE, /^The whole PDF is sent, but Makeborne doesn’t receive a page-by-page report, so it can’t show whether a page \(such as a scan or a chart\) was only partly understood\./);
  assert.equal(report.entries[1].reason, "AI reads this file with your next request.", "images keep the plain reason");
  assert.deepEqual(Object.keys(SOURCE_STATE_LABELS), ["ready", "local-only", "unsupported", "too-large", "failed", "partial", "checking"]);
  // "partial" is never inferred: it comes only from the server's extraction record (measured coverage).
  const measured = decideSources([file("3", "prices.xlsx")], new Map([["3", {kind: "incomplete", sourceType: "x", bytes: 10,
    inspection: {status: "partial", message: "Only part of this file could be read: Sheet “Bad” couldn’t be read.", coverage: {unit: "sheets", total: 2, read: 1, visual: "none", notes: []}, counts: {tables: 0, images: 0, slides: 0, sheets: 2, characters: 1}, details: {}, warnings: [], unsupported: [], format: "xlsx"}}]]));
  assert.equal(measured.entries[0].state, "partial");
  assert.equal(measured.entries[0].blocking, true);
  assert.match(measured.entries[0].reason, /1 of 2 sheets read.*remove it, or choose “Continue without it”/);
});

check("the studio creation modal and the build conversation use the shared classifier and labels", () => {
  const studio = read("studio.tsx");
  assert.ok(studio.includes('import { AttachmentList, useFileAttachments, useSourceReadiness } from "./file-attachments";'));
  assert.ok(studio.includes("const sourceReadiness = useSourceReadiness(sourceAttachments.files, NO_SOURCE_EXCLUSIONS);"));
  assert.ok(studio.includes('<AttachmentList files={sourceAttachments.files} readiness={sourceReadiness} onRetry={sourceReadiness.retry} readPrefix="When your project builds · "'));
  assert.ok(!/<AttachmentList files=\{sourceAttachments\.files\} \/>/.test(studio), "the old state-less list is gone");
  assert.ok(/^const NO_SOURCE_EXCLUSIONS: ReadonlySet<string> = new Set\(\);/m.test(studio), "a stable, module-level empty set (no re-analysis loop)");
  const conversation = read("build-conversation.tsx");
  assert.ok(conversation.includes("const readiness = useSourceReadiness(attachments.files, NO_EXCLUSIONS);"));
  assert.ok(conversation.includes('readiness={device ? undefined : readiness} onRetry={readiness.retry} readPrefix="With the next AI build · "'), "device-only projects can't build with AI, so they don't claim AI will read the files");
  for (const [name, source] of [["creation-home.tsx", read("creation-home.tsx")], ["live-builder.tsx", read("live-builder.tsx")], ["studio.tsx", studio], ["build-conversation.tsx", conversation]])
    assert.match(source, /useSourceReadiness\(/, `${name} classifies with the shared hook`);
});

check("uploads and generated outputs are labelled apart", () => {
  const list = read("file-attachments.tsx");
  assert.ok(list.includes('{readiness && <p className="attachment-heading">Source files <small>your uploads · AI reads them, never changes them</small></p>}'));
  const preview = read("document-preview.tsx");
  assert.ok(preview.includes('role="group" aria-label={`Generated outputs from saved version ${savedVersion}`}'));
  assert.ok(preview.includes(">Generated · v{savedVersion}</span>") && preview.includes("title={canExport ? `Generated output: download saved version ${savedVersion} as PDF`"));
});

console.log(`\n${passed} source label checks passed.`);
