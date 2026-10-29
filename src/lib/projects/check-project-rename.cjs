/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for renaming a project from the library card and the editor header (new-user journey, round 2).
 * Same semantics as feature/library-redesign (library-rename.ts and the card-meta rename-only state). Mounted: scripts/check-library-rename-browser.cjs, scripts/check-editor-journey-browser.cjs. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const rename = require("./library-rename.ts"), meta = require("./library-card-meta.ts");
const root = path.join(__dirname, "..", "..", "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
let count = 0;
const check = (name, fn) => { fn(); count++; console.log(`PASS ${name}`); };

check("a rename needs a real, changed name within the saved title's 200-character limit", () => {
  assert.deepEqual(rename.checkRename("  Saffron   Table — Leeds  ", "A website for Saffron Table"), { ok: true, name: "Saffron Table — Leeds" });
  assert.deepEqual(rename.checkRename("   ", "Clinic"), { ok: false, reason: "empty" });
  assert.deepEqual(rename.checkRename("Clinic", "Clinic"), { ok: false, reason: "unchanged" });
  assert.deepEqual(rename.checkRename("x".repeat(201), "Clinic"), { ok: false, reason: "too-long" });
  assert.match(read("src/lib/domain.ts"), /title: text\.min\(1\)\.max\(200\)/, "the saved content's title allows 200 characters");
});

check("a rename changes only content.title and says so in the version summary", () => {
  const content = { schemaVersion: 1, kind: "website", title: "Old", sections: [{ id: "s", title: "Old", blocks: [] }], seo: { siteName: "x" } };
  const next = rename.renamedContent(content, "New");
  assert.deepEqual({ ...next, title: "Old" }, content);
  assert.equal(content.title, "Old", "the input is not mutated");
  assert.equal(rename.renameSummary("New"), "Renamed to “New”");
  assert.ok(rename.isRenameSummary(rename.renameSummary("New")) && !rename.isRenameSummary("Changed the hero"));
  assert.match(rename.renameEffect("website", 4, false), /A rename alone doesn’t count as an unpublished change\.$/);
});

check("a rename alone keeps a live site's card Live; a real edit, style or asset change still counts", () => {
  assert.equal(meta.publicationState(2, { live: true, version_number: 1 }), "live-behind");
  assert.equal(meta.publicationState(2, { live: true, version_number: 1 }, true), "live", "versions that only rename are not unpublished changes");
  assert.equal(meta.publicationState(2, { live: false, version_number: 1 }, true), "draft", "a rename never makes an offline site Live");
  const v = (content, extra = {}) => ({ content, style_snapshot: { palette: ["#111"] }, asset_manifest: [{ id: "a1" }], ...extra });
  assert.ok(meta.sameExceptTitle(v({ title: "Old", kind: "website", sections: [] }), v({ kind: "website", sections: [], title: "New" })), "title and key order are ignored");
  assert.ok(!meta.sameExceptTitle(v({ title: "Old", sections: [1] }), v({ title: "New", sections: [2] })), "a content change counts");
  assert.ok(!meta.sameExceptTitle(v({ title: "A" }), v({ title: "A" }, { style_snapshot: { palette: ["#000"] } })), "a style change counts");
  assert.ok(!meta.sameExceptTitle(v({ title: "A" }), v({ title: "A" }, { asset_manifest: [] })), "an asset change counts");
});

check("the card-meta route believes a rename only after reading every later version and comparing the saved content", () => {
  const route = read("src/app/api/cloud/workspaces/[workspaceId]/artifacts/card-meta/route.ts");
  assert.match(route, /const state = publicationState\(row\.current_version, site, renamedOnly\.has\(row\.id\)\);/);
  assert.match(route, /rows\.length === item\.current - item\.live && rows\.every\(row => isRenameSummary/, "every later version must have been read and say it is a rename");
  assert.match(route, /if \(live && current && sameExceptTitle\(live, current\)\) found\.add\(item\.id\);/, "the summary alone never decides");
  assert.match(route, /\.slice\(0, RENAME_VERIFY_MAX\)/, "content reads are bounded per request");
  assert.match(route, /await cloudContext\(workspaceId\)/, "read with the caller's own session (RLS decides)");
});

check("both entry points save through the authorized version route with its expectedVersion guard; reviewers get neither", () => {
  const actions = read("src/components/library-card-actions.tsx"), projects = read("src/components/account-projects.tsx"), editor = read("src/components/cloud-studio.tsx"), header = read("src/components/project-header.tsx");
  assert.match(actions, /expectedVersion: ready\.number, content: renamedContent\(ready\.content, check\.name\), style: ready\.style, assetIds: ready\.assetIds, changeSummary: renameSummary\(check\.name\),/);
  assert.match(actions, /if \(result\.artifact\.currentVersion !== artifact\.currentVersion\) return setDetail\(\{ status: "stale"/, "the library catches a newer save before writing");
  assert.match(projects, /snapshot!\.workspace\.role !== "reviewer" && artifact\.currentVersion > 0 \? \[\{ id: "rename"/);
  assert.match(editor, /expectedVersion, content: renamedContent\(savedVersion\.content, name\), style: savedVersion\.style, assetIds: savedVersion\.assetIds, changeSummary: renameSummary\(name\),/);
  assert.match(editor, /rename=\{role !== "reviewer" \? \{/);
  assert.match(editor, /const renameBlocked = dirty \|\| busy \|\| conflict \|\| uncertainSave \|\| recovery \|\| lockChangePending \|\| live \?/, "never while edits, saves or builds are unsettled");
  for (const source of [actions, editor]) assert.doesNotMatch(source.slice(source.indexOf("renam")), /\/projects\/\$\{[^}]+\}`, \{[^}]*title/, "the project record is not what the library and header name");
  assert.match(header, /disabled=\{Boolean\(rename\.blocked\)\}/);
});

console.log(`${count} project rename checks passed.`);
