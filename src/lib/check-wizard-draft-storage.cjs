/* eslint-disable @typescript-eslint/no-require-imports -- Offline draft recovery checks. */
const fs = require("node:fs"), vm = require("node:vm"), ts = require("typescript"), assert = require("node:assert/strict");
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve("./wizard-draft-storage.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const { readWizardDraft, writeWizardDraft, clearWizardDrafts, wizardDraftKey, wizardDraftScope } = context.exports;
const records = new Map();
const storage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) };
let count = 0;
function check(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
check("fresh wizard uses requested format", () => { const result = readWizardDraft(storage, "client-a", "book"); assert.equal(result.kind, "book"); assert.equal(result.raw, null); });
check("legacy draft remains recoverable", () => { records.set(wizardDraftKey("legacy", "website"), "legacy text"); assert.equal(readWizardDraft(storage, "legacy", "website").raw, "legacy text"); });
check("reopens the latest format", () => { writeWizardDraft(storage, "client-a", "website", "website text"); writeWizardDraft(storage, "client-a", "presentation", "presentation text"); const result = readWizardDraft(storage, "client-a", "website"); assert.equal(result.kind, "presentation"); assert.equal(result.raw, "presentation text"); });
check("contexts cannot select each other's drafts", () => assert.equal(readWizardDraft(storage, "client-b", "website").raw, null));
check("failed draft write does not change active format", () => { const broken = { ...storage, setItem: () => { throw new Error("Quota"); } }; assert.throws(() => writeWizardDraft(broken, "client-a", "book", "new text")); assert.equal(readWizardDraft(storage, "client-a", "website").kind, "presentation"); });
check("invalid pointer is preserved and rejected", () => { records.set("makeborne.wizard-draft.active.v1.bad", "../../secret"); assert.throws(() => readWizardDraft(storage, "bad", "website"), /Invalid/); assert.equal(records.get("makeborne.wizard-draft.active.v1.bad"), "../../secret"); });
check("missing pointed draft is not silently replaced", () => { records.set("makeborne.wizard-draft.active.v1.missing", "book"); assert.throws(() => readWizardDraft(storage, "missing", "website"), /missing/); });
check("successful creation cleanup removes all formats and pointer", () => { clearWizardDrafts(storage, "client-a"); assert.equal(readWizardDraft(storage, "client-a", "website").raw, null); assert.equal(records.has(wizardDraftKey("client-a", "presentation")), false); });
check("cleanup preserves other contexts", () => assert.equal(readWizardDraft(storage, "legacy", "website").raw, "legacy text"));
const ownerA = "11111111-1111-4111-8111-111111111111", ownerB = "22222222-2222-4222-8222-222222222222", workspaceA = "33333333-3333-4333-8333-333333333333", workspaceB = "44444444-4444-4444-8444-444444444444";
const scopeA = wizardDraftScope("same-brief", ownerA, workspaceA), scopeB = wizardDraftScope("same-brief", ownerB, workspaceA), deviceScope = wizardDraftScope("same-brief", null, null);
check("same account and workspace recover their own draft", () => { writeWizardDraft(storage, scopeA, "book", "Private account A text"); assert.equal(readWizardDraft(storage, scopeA, "website").raw, "Private account A text"); });
check("different account cannot recover the draft", () => assert.equal(readWizardDraft(storage, scopeB, "website").raw, null));
check("different workspace cannot recover the draft", () => assert.equal(readWizardDraft(storage, wizardDraftScope("same-brief", ownerA, workspaceB), "website").raw, null));
check("signed-out device namespace cannot recover account draft", () => assert.equal(readWizardDraft(storage, deviceScope, "website").raw, null));
check("unscoped legacy draft is not attributed to an account", () => { writeWizardDraft(storage, "same-brief", "website", "Unknown owner"); assert.equal(readWizardDraft(storage, scopeB, "website").raw, null); });
check("clearing one account leaves other accounts intact", () => { writeWizardDraft(storage, scopeB, "presentation", "Private B text"); clearWizardDrafts(storage, scopeA); assert.equal(readWizardDraft(storage, scopeB, "website").raw, "Private B text"); });
check("workspace without account rejected", () => assert.throws(() => wizardDraftScope("same-brief", null, workspaceA)));
check("invalid account rejected", () => assert.throws(() => wizardDraftScope("same-brief", "invalid", null)));
console.log(`${count} wizard draft storage checks passed.`);
