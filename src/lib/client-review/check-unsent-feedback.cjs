/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks: unsent client-review feedback is kept per review link and version, expires, never stores identity, and is never posted from storage. No network. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict");
globalThis.fetch = async () => { throw new Error("Network forbidden"); };
const compiledModule = file => {
  const compiled = { exports: {} };
  new Function("require", "module", "exports", ts.transpileModule(fs.readFileSync(path.join(__dirname, file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(require, compiled, compiled.exports);
  return compiled.exports;
};
const draft = compiledModule("unsent-feedback.ts");
const page = fs.readFileSync(path.join(__dirname, "..", "..", "components", "client-review-page.tsx"), "utf8");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
function memory(entries = {}) {
  const records = new Map(Object.entries(entries));
  return { records, getItem: key => records.has(key) ? records.get(key) : null, setItem: (key, value) => { records.set(key, String(value)); }, removeItem: key => { records.delete(key); } };
}
const now = Date.UTC(2026, 9, 20, 12);
const tokenA = "AxqyiSWPscmAmQiBlCunGJiOUuAuU51si6DMK0Ff6YE", tokenB = "Bxqyi-different-link-token-0000000000000000";
const fields = { comment: "The hero photo feels too dark.", pin: { x: 0.25, y: 0.5, ref: "page", label: "Website" }, decision: null, note: "" };

check("scope: one link and one version; the raw link token is never in the key", () => {
  const a3 = draft.reviewDraftScope(tokenA, 3);
  assert.equal(a3, draft.reviewDraftScope(tokenA, 3), "stable");
  assert.notEqual(a3, draft.reviewDraftScope(tokenA, 4));
  assert.notEqual(a3, draft.reviewDraftScope(tokenB, 3));
  assert.ok(!draft.reviewDraftKey(a3).includes(tokenA));
  assert.match(draft.reviewDraftKey(a3), /^makeborne\.review-draft\.v1\.[0-9a-f]{16}\.3$/);
});

check("round trip restores text, pin and the open decision note; another link or version sees nothing", () => {
  const storage = memory(), a3 = draft.reviewDraftScope(tokenA, 3);
  assert.equal(draft.saveReviewDraft(storage, a3, { ...fields, decision: "changes_requested", note: "Pricing needs the new tiers." }, now), true);
  assert.deepEqual(draft.readReviewDraft(storage, a3, now + 1000), { fields: { ...fields, decision: "changes_requested", note: "Pricing needs the new tiers." }, savedAt: now });
  assert.equal(draft.readReviewDraft(storage, draft.reviewDraftScope(tokenA, 4), now), null);
  assert.equal(draft.readReviewDraft(storage, draft.reviewDraftScope(tokenB, 3), now), null);
  // A record copied under another scope's key is refused and removed.
  const b3 = draft.reviewDraftScope(tokenB, 3);
  storage.setItem(draft.reviewDraftKey(b3), storage.getItem(draft.reviewDraftKey(a3)));
  assert.equal(draft.readReviewDraft(storage, b3, now), null); assert.equal(storage.getItem(draft.reviewDraftKey(b3)), null);
});

check("only text and pin are stored: no name, email, token or decision without a panel", () => {
  const raw = draft.encodeReviewDraft({ ...fields, name: "Jane Doe", email: "jane@example.test", note: "ignored without a decision" }, "scope", now);
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ["comment", "decision", "note", "pin", "savedAt", "scope", "v"]);
  assert.doesNotMatch(raw, /Jane|jane@|ignored/);
});

check("expired, future-dated, after link expiry, malformed or empty drafts are removed, not restored", () => {
  const scope = draft.reviewDraftScope(tokenA, 1), key = draft.reviewDraftKey(scope);
  const stored = (savedAt, extra = {}) => memory({ [key]: JSON.stringify({ ...JSON.parse(draft.encodeReviewDraft(fields, scope, savedAt)), ...extra }) });
  for (const [storage, at, expiresAt, label] of [
    [stored(now - draft.REVIEW_DRAFT_TTL_MS - 1), now, undefined, "older than seven days"],
    [stored(now + 120_000), now, undefined, "from the future"],
    [stored(now), now, now - 1, "link already expired"],
    [stored(now, { pin: { x: 2, y: 0, ref: "page", label: "" } }), now, undefined, "pin outside the page"],
    [stored(now, { decision: "publish" }), now, undefined, "unknown decision"],
    [stored(now, { extra: true }), now, undefined, "unknown field"],
    [stored(now, { comment: "   " }), now, undefined, "only whitespace"],
    [memory({ [key]: "{not json" }), now, undefined, "unreadable"],
  ]) {
    assert.equal(draft.readReviewDraft(storage, scope, at, expiresAt), null, label);
    if (label !== "link already expired") assert.equal(storage.getItem(key), null, `${label}: removed`);
  }
});

check("empty fields remove the draft; storage failures never throw", () => {
  const storage = memory(), scope = draft.reviewDraftScope(tokenA, 2);
  draft.saveReviewDraft(storage, scope, fields, now);
  draft.saveReviewDraft(storage, scope, { comment: "", pin: fields.pin, decision: null, note: "" }, now);
  assert.equal(storage.records.size, 0, "a pin alone is not kept");
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(draft.readReviewDraft(broken, scope, now), null);
  assert.equal(draft.saveReviewDraft(broken, scope, fields, now), false);
  assert.equal(draft.discardReviewDraft(broken, scope), false);
});

check("the review page restores into the fields only, writes after reading, clears on post or decision, and offers Discard", () => {
  assert.match(page, /reviewDraftScope\(token, initial\.version\)/);
  assert.match(page, /readReviewDraft\(storage, draftScope, Date\.now\(\), Date\.parse\(initial\.expiresAt\)\)/);
  assert.match(page, /if \(draftReadFor !== draftScope\) return;/, "nothing is written before the stored draft is read");
  assert.match(page, /saveReviewDraft\(storage, draftScope, \{ comment: body, pin, decision: deciding, note \}, Date\.now\(\)\)/);
  assert.match(page, /Nothing has been sent\. <button type="button" onClick=\{discardDraft\}>Discard<\/button>/);
  // Restoring never calls the post or decide paths: those run only from the form submit and the decision button.
  const restore = page.slice(page.indexOf("const draft = storage && readReviewDraft"), page.indexOf("setDraftReadFor(draftScope);"));
  assert.doesNotMatch(restore, /send\(|decide\(|post</);
  assert.match(page, /setBody\(""\); setPin\(null\); setActive\(result\.comment\.id\); setDraftRestoredAt\(null\);/, "a posted comment's draft is cleared");
  assert.match(page, /setDeciding\(null\); setNote\(""\); setDraftRestoredAt\(null\);/, "a sent decision's note is cleared");
  assert.match(page, /const IDENTITY_KEY = "makeborne\.review-identity\.v1";/, "identity stays in its own key");
});

console.log(`${passed}/6 unsent review feedback checks passed.`);
