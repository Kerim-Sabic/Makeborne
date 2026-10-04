/* eslint-disable @typescript-eslint/no-require-imports -- Offline workspace selection regression checks. */
const fs = require("node:fs"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { creationWorkspace } = require("./creation-workspace.ts");
const owner = { id: "owner", name: "Owned", role: "owner" }, editor = { id: "editor", name: "Shared", role: "editor" }, reviewer = { id: "reviewer", name: "Read only", role: "reviewer" };
assert.equal(creationWorkspace([editor, owner]), owner);
assert.equal(creationWorkspace([owner, editor], "editor"), editor);
assert.equal(creationWorkspace([owner, editor], "owner"), owner);
assert.equal(creationWorkspace([editor]), editor);
assert.equal(creationWorkspace([]), null);
assert.throws(() => creationWorkspace([owner, reviewer], "reviewer"), /read-only/);
assert.throws(() => creationWorkspace([owner], "missing"), /no longer available/);
assert.throws(() => creationWorkspace([], "missing"), /no longer available/);
assert.throws(() => creationWorkspace([reviewer]), /read-only/);
console.log("PASS 9 creation workspace checks: explicit destination retained; missing/read-only handoffs rejected.");
