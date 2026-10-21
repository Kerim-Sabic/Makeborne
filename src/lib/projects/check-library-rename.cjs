/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for library rename and "Untitled" name suggestions (S1/S1b). Mounted: scripts/check-library-previews-browser.cjs. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const rename = require("./library-rename.ts");
const root = path.join(__dirname, "..", "..", "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
let count = 0;
const check = (name, fn) => { fn(); count++; console.log(`PASS ${name}`); };

check("a rename needs a real, changed name within the title limit", () => {
  assert.deepEqual(rename.checkRename("  Harbour   Dental — York  ", "Untitled presentation"), { ok: true, name: "Harbour Dental — York" });
  assert.deepEqual(rename.checkRename("   ", "Clinic"), { ok: false, reason: "empty" });
  assert.deepEqual(rename.checkRename("Clinic", "Clinic"), { ok: false, reason: "unchanged" });
  assert.deepEqual(rename.checkRename("x".repeat(201), "Clinic"), { ok: false, reason: "too-long" });
  assert.equal(rename.checkRename("x".repeat(200), "Clinic").ok, true);
  for (const reason of ["empty", "unchanged", "too-long"]) assert.ok(rename.RENAME_REASON[reason]);
});

check("suggestions only for placeholder names, from authorized content, best first, never a placeholder", () => {
  const brief = "Hi, could you build a website for Harbour Dental in York. Call 01904 123456 or visit harbourdental.co.uk";
  const suggested = rename.renameSuggestions("Untitled website", "website", { documentTitle: null, brief, projectTitle: "Untitled website" });
  assert.deepEqual(suggested, ["Website for Harbour Dental in York"]);
  assert.ok(!suggested.some(name => /01904|harbourdental\.co\.uk/.test(name)), "no contact details or links");
  assert.deepEqual(rename.renameSuggestions("Untitled book", "book", { documentTitle: "The Quiet Garden", brief: "A practical book about shade planting for small gardens.", projectTitle: "Shade book" }),
    ["The Quiet Garden", "A practical book about shade planting for small gardens", "Shade book"]);
  assert.deepEqual(rename.renameSuggestions("Untitled", "presentation", { documentTitle: "Untitled presentation", brief: "", projectTitle: "untitled" }), [], "placeholders are never suggested");
  assert.deepEqual(rename.renameSuggestions("Untitled book", "book", { documentTitle: "Moss", brief: null, projectTitle: "moss" }), ["Moss"], "no case-insensitive duplicates");
  assert.deepEqual(rename.renameSuggestions("Harbour Pitch", "presentation", { documentTitle: "Something else", brief: "A pitch deck", projectTitle: "Other" }), [], "a deliberate name gets no suggestions");
  assert.equal(rename.renameSuggestions("Untitled book", "book", { documentTitle: "a".repeat(400) })[0].length, rename.RENAME_MAX);
});

check("a rename changes only the saved title; the document keeps its own cover title", () => {
  const content = { schemaVersion: 1, kind: "book", title: "Untitled book", sections: [{ id: "s", title: "Intro", blocks: [] }], document: { kind: "book", title: "The Quiet Garden" }, seo: { siteName: "x" } };
  const next = rename.renamedContent(content, "Quiet Garden — client edition");
  assert.equal(next.title, "Quiet Garden — client edition");
  assert.equal(next.document, content.document); assert.equal(next.sections, content.sections); assert.equal(next.seo, content.seo);
  assert.equal(content.title, "Untitled book", "the input is not mutated");
  assert.equal(rename.renameSummary("York deck"), "Renamed to “York deck”");
});

check("the dialog says what a rename does for each format", () => {
  assert.match(rename.renameEffect("website", 4, false), /^Saves Version 4 with the new name\./);
  assert.match(rename.renameEffect("website", 4, false), /default title in browser tabs and search results; a live site shows it after you publish again/);
  assert.match(rename.renameEffect("website", 4, false), /A rename alone doesn’t count as an unpublished change.$/);
  assert.ok(rename.isRenameSummary(rename.renameSummary("Harbour Dental")) && !rename.isRenameSummary("Changed the hero"), "a rename summary is recognised");
  assert.match(rename.renameEffect("book", 2, true), /cover keeps the title written on it/);
  assert.match(rename.renameEffect("presentation", 2, true), /slides keep the title written on them/);
  assert.doesNotMatch(rename.renameEffect("presentation", 2, false), /slides keep/, "an outline deck has no separate slide title");
});

check("failures are honest: a conflict asks for a refresh, an unconfirmed save is not called a failure, nothing claims success", () => {
  assert.deepEqual(rename.renameFailure(Object.assign(new Error("The artifact changed."), { status: 409 })), { message: "This project was saved again since the library loaded, so it wasn’t renamed. Refresh the library and try again.", conflict: true });
  assert.equal(rename.renameFailure(Object.assign(new Error("Gone"), { status: 404 })).conflict, false);
  assert.match(rename.renameFailure(Object.assign(new Error("Gone"), { status: 403 })).message, /no longer available/);
  const uncertain = Object.assign(new Error("We couldn’t confirm whether your change saved. Check the record before retrying."), { status: 503, uncertain: true });
  assert.equal(rename.renameFailure(uncertain).message, uncertain.message, "the cloud client's own uncertain-write message is kept");
  assert.equal(rename.renameFailure(Object.assign(new Error("Your account changed."), { status: 409, code: "ACCOUNT_CHANGED" })).conflict, false, "an account switch is not a project conflict");
  assert.match(rename.renameFailure(new Error("Network down")).message, /^Network down\. The project keeps its current name\.$/);
  assert.match(rename.renameFailure("weird").message, /couldn’t be saved\. The project keeps its current name\./);
});

check("source guards: rename goes through the authorized version save with its conflict guard; card actions are real", () => {
  const dialog = read("src/components/library-card-actions.tsx"), projects = read("src/components/account-projects.tsx");
  assert.match(dialog, /api<\{ artifact: CloudArtifact; versions: CloudVersion\[\] \}>\(`\/api\/cloud\/workspaces\/\$\{workspaceId\}\/artifacts\/\$\{artifact\.id\}`\)/, "reads the current version through the editor's route");
  assert.match(dialog, /if \(result\.artifact\.currentVersion !== artifact\.currentVersion\) return setDetail\(\{ status: "stale"/, "a newer save is caught before writing");
  assert.match(dialog, /`\/api\/cloud\/workspaces\/\$\{workspaceId\}\/artifacts\/\$\{artifact\.id\}\/versions`, \{\s*expectedVersion: ready\.number, content: renamedContent\(ready\.content, check\.name\), style: ready\.style, assetIds: ready\.assetIds, changeSummary: renameSummary\(check\.name\),/);
  assert.doesNotMatch(dialog, /\/projects\/\$\{|"PATCH"/, "the project record is not what a card names");
  assert.match(dialog, /onCancel=\{event => \{ event\.preventDefault\(\); if \(!savingRef\.current\) onClose\(\); \}\}/, "Escape cannot abandon a save in flight");
  assert.match(dialog, /Choosing a suggestion only fills in the name\. Nothing changes until you press Rename\./);
  assert.match(dialog, /else if \(event\.key === "Escape"\) \{ event\.preventDefault\(\); event\.stopPropagation\(\); close\(true\); \}/, "Escape returns focus to the trigger");
  assert.match(dialog, /role="menuitem" tabIndex=\{-1\}/);
  // Only actions that exist: Rename needs an editor and a saved version; a live link needs the authorized live row.
  assert.match(projects, /snapshot!\.workspace\.role !== "reviewer" && artifact\.currentVersion > 0 \? \[\{ id: "rename"/);
  assert.match(projects, /address = liveAddress\(facts\)/);
  assert.match(projects, /\.\.\.\(address \? \[\{ id: "copy", label: "Copy live link"/);
  assert.doesNotMatch(projects, /id: "(?:archive|delete|duplicate|remove)"|label: "(?:Archive|Delete|Duplicate|Remove)/i, "no archive, delete or other unbacked actions");
  assert.match(projects, /The live link couldn’t be copied in this browser\. Here it is to copy yourself:/, "a failed copy shows the address instead");
  // Renamed results are applied only to the same workspace and re-read their facts for the new version.
  assert.match(projects, /setSnapshot\(current => current && current\.workspace\.id === inWorkspace \?/);
  assert.match(projects, /metaRequested\.current\.ids\.delete\(next\.id\); setMetaAttempt/);
  assert.match(projects, /setRenaming\(null\); setNotice\(null\);/, "an account or workspace change closes the dialog and clears messages");
});

console.log(`${count} library rename checks passed.`);
