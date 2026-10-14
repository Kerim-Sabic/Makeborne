/* eslint-disable @typescript-eslint/no-require-imports -- Offline sign-out storage cleanup checks. */
const fs = require("node:fs"), vm = require("node:vm"), ts = require("typescript"), assert = require("node:assert/strict");
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve("./account-local-data.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const { clearAccountLocalData } = context.exports;
function memory(entries) {
  const records = new Map(Object.entries(entries));
  return { records, get length() { return records.size; }, key: i => [...records.keys()][i] ?? null, getItem: key => records.get(key) ?? null, removeItem: key => records.delete(key) };
}
const a = "11111111-1111-4111-8111-111111111111", b = "22222222-2222-4222-8222-222222222222", w = "33333333-3333-4333-8333-333333333333";
const local = memory({
  [`makeborne.cloud-draft.${a}.${w}.x`]: "<html>A</html>",
  [`makeborne.generation.v1.${a}.${w}.x`]: "{}",
  [`makeborne.creation-reference.v1.${a}.${w}`]: "{}",
  "makeborne.pending-write.aa": JSON.stringify({ accountId: a }),
  "makeborne.pending-write.bb": JSON.stringify({ accountId: b }),
  "makeborne.pending-write.cc": "not json",
  [`makeborne.cloud-draft.${b}.${w}.x`]: "<html>B</html>",
  "makeborne.local-workspace.v1": "{}",
  "other-app.key": "keep",
});
const session = memory({
  [`makeborne.project-conversation.v1:${a}:${w}:x`]: "{}",
  [`makeborne.wizard-draft.v1.website.account.${a}.workspace.new.seed`]: "draft",
  [`makeborne.wizard-draft.active.v1.account.${a}.workspace.new.seed`]: "website",
  "makeborne.wizard-draft.v1.website.device.seed": "device draft",
});
clearAccountLocalData(a, [local, session]);
assert.deepEqual([...local.records.keys()].sort(), ["makeborne.local-workspace.v1", "makeborne.pending-write.bb", "makeborne.pending-write.cc", `makeborne.cloud-draft.${b}.${w}.x`, "other-app.key"].sort());
assert.deepEqual([...session.records.keys()], ["makeborne.wizard-draft.v1.website.device.seed"]);
clearAccountLocalData(null, [local]);
assert.equal(local.records.size, 5);
const broken = { get length() { throw new Error("blocked"); } };
assert.doesNotThrow(() => clearAccountLocalData(a, [broken]));
console.log("PASS: 4 sign-out storage cleanup checks; other accounts and device projects kept.");
