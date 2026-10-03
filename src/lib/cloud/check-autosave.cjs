/* eslint-disable @typescript-eslint/no-require-imports -- Pure offline save-state checks. */
const fs = require("node:fs"), ts = require("typescript"), vm = require("node:vm"), assert = require("node:assert/strict");
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve("./autosave.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const { canAutosave, settleAccountSave } = context.exports;
const ready = { dirty: true, ready: true, busy: false, conflict: false, uncertain: false, paused: false, recovery: false, reviewer: false };
assert.equal(canAutosave(ready), true);
for (const gate of ["busy", "conflict", "uncertain", "paused", "recovery", "reviewer"]) assert.equal(canAutosave({ ...ready, [gate]: true }), false);
for (const gate of ["dirty", "ready"]) assert.equal(canAutosave({ ...ready, [gate]: false }), false);
assert.equal(settleAccountSave(2, 2, false).clearRecovery, true);
assert.equal(settleAccountSave(2, 3, false).clearRecovery, false);
assert.equal(settleAccountSave(2, 3, false).newerEdits, true);
assert.equal(settleAccountSave(2, 3, true).pauseForReview, true);
assert.equal(settleAccountSave(2, 2, true).pauseForReview, false);
assert.throws(() => settleAccountSave(2, 1, false));
console.log("PASS: 15 autosave state checks; no network writes.");
