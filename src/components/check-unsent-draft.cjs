/* eslint-disable @typescript-eslint/no-require-imports -- Offline unsent composer draft checks. */
// Pure storage rules plus the useUnsentDraft hook, driven by a minimal hook runtime
// (state, refs, effects, effect events) so account switches, multi-tab updates,
// discard and submit are exercised without a browser.
const fs = require("node:fs"), vm = require("node:vm"), ts = require("typescript"), assert = require("node:assert/strict");
function load(file, modules = {}, globals = {}) {
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = { exports: {}, require: name => { if (name in modules) return modules[name]; throw new Error(`unexpected import ${name}`); }, JSON, Date, Number, Object, Array, Error, queueMicrotask, ...globals };
  vm.runInNewContext(source, context);
  return context.exports;
}
const draft = load("src/lib/unsent-draft.ts");
const { clearAccountLocalData } = load("src/lib/account-local-data.ts");
const EFFORTS = ["light", "medium", "high", "super_high", "ultra"];
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const ownerA = draft.unsentDraftOwner(A), ownerB = draft.unsentDraftOwner(B), device = draft.unsentDraftOwner(null);
let count = 0;
async function check(name, fn) { await fn(); count++; console.log(`PASS ${name}`); }
function memory(entries = {}) {
  const records = new Map(Object.entries(entries));
  return { records, get length() { return records.size; }, key: i => [...records.keys()][i] ?? null, getItem: key => records.has(key) ? records.get(key) : null, setItem: (key, value) => { records.set(key, String(value)); }, removeItem: key => { records.delete(key); } };
}
const now = Date.UTC(2026, 9, 20, 12);
const book = { kind: "book", mode: "plan", effort: "high", text: "Fictional field guide to tidal pools." };

async function main() {
  await check("owners are scoped and malformed ids rejected", () => {
    assert.equal(ownerA, `account.${A}`); assert.equal(device, "device");
    assert.notEqual(draft.unsentDraftKey("home", ownerA), draft.unsentDraftKey("home", ownerB));
    assert.notEqual(draft.unsentDraftKey("home", ownerA), draft.unsentDraftKey("studio", ownerA));
    assert.throws(() => draft.unsentDraftOwner("../other"));
  });
  await check("round trip keeps text, format, mode and effort and nothing else", () => {
    const storage = memory();
    assert.equal(draft.saveUnsentDraft(storage, "home", ownerA, { ...book, generationConsent: { accepted: true }, requestId: "x" }, now), true);
    const raw = JSON.parse(storage.getItem(draft.unsentDraftKey("home", ownerA)));
    assert.deepEqual(Object.keys(raw).sort(), ["effort", "kind", "mode", "owner", "savedAt", "text", "v"]);
    const restored = draft.readUnsentDraft(storage, "home", ownerA, now + 1000, EFFORTS);
    assert.equal(JSON.stringify(restored.fields), JSON.stringify(book));
    assert.equal(restored.savedAt, now);
  });
  await check("another account and the signed-out device cannot read the draft", () => {
    const storage = memory();
    draft.saveUnsentDraft(storage, "home", ownerA, book, now);
    assert.equal(draft.readUnsentDraft(storage, "home", ownerB, now, EFFORTS), null);
    assert.equal(draft.readUnsentDraft(storage, "home", device, now, EFFORTS), null);
    // A copy placed under B's key but claiming A is rejected and removed.
    storage.setItem(draft.unsentDraftKey("home", ownerB), storage.getItem(draft.unsentDraftKey("home", ownerA)));
    assert.equal(draft.readUnsentDraft(storage, "home", ownerB, now, EFFORTS), null);
    assert.equal(storage.getItem(draft.unsentDraftKey("home", ownerB)), null);
    assert.ok(storage.getItem(draft.unsentDraftKey("home", ownerA)), "A's own draft is untouched");
  });
  await check("expired, future-dated, other-version and malformed drafts are removed, not restored", () => {
    const storage = memory(), key = draft.unsentDraftKey("studio", ownerA);
    const cases = [
      draft.encodeUnsentDraft(book, ownerA, now - draft.UNSENT_DRAFT_TTL_MS - 1),
      draft.encodeUnsentDraft(book, ownerA, now + 5 * 60_000),
      JSON.stringify({ ...JSON.parse(draft.encodeUnsentDraft(book, ownerA, now)), v: 2 }),
      JSON.stringify({ ...JSON.parse(draft.encodeUnsentDraft(book, ownerA, now)), effort: "infinite" }),
      JSON.stringify({ ...JSON.parse(draft.encodeUnsentDraft(book, ownerA, now)), approved: true }),
      JSON.stringify({ ...JSON.parse(draft.encodeUnsentDraft(book, ownerA, now)), text: "   " }),
      "{not json",
    ];
    for (const raw of cases) {
      storage.setItem(key, raw);
      assert.equal(draft.readUnsentDraft(storage, "studio", ownerA, now, EFFORTS), null, raw.slice(0, 40));
      assert.equal(storage.getItem(key), null);
    }
    assert.ok(draft.readUnsentDraft(memory({ [key]: draft.encodeUnsentDraft(book, ownerA, now - draft.UNSENT_DRAFT_TTL_MS + 1000) }), "studio", ownerA, now, EFFORTS), "still inside the expiry window");
  });
  await check("an empty brief removes the draft; settings alone are not kept", () => {
    const storage = memory();
    draft.saveUnsentDraft(storage, "home", ownerA, book, now);
    draft.saveUnsentDraft(storage, "home", ownerA, { ...book, text: "  " }, now);
    assert.equal(storage.records.size, 0);
  });
  await check("blocked storage never throws", () => {
    const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("quota"); }, removeItem() { throw new Error("blocked"); } };
    assert.equal(draft.readUnsentDraft(blocked, "home", ownerA, now, EFFORTS), null);
    assert.equal(draft.saveUnsentDraft(blocked, "home", ownerA, book, now), false);
    assert.equal(draft.discardUnsentDraft(blocked, "home", ownerA), false);
  });
  await check("other tabs converge on stored state and ignore unrelated keys", () => {
    const stored = draft.encodeUnsentDraft(book, ownerA, now);
    assert.equal(draft.remoteUnsentDraft(draft.unsentDraftKey("home", ownerB), "home", ownerA, stored, now, EFFORTS).action, "ignore");
    assert.equal(draft.remoteUnsentDraft(draft.unsentDraftKey("studio", ownerA), "home", ownerA, stored, now, EFFORTS).action, "ignore");
    assert.equal(draft.remoteUnsentDraft(draft.unsentDraftKey("home", ownerA), "home", ownerA, stored, now, EFFORTS).action, "adopt");
    assert.equal(draft.remoteUnsentDraft(draft.unsentDraftKey("home", ownerA), "home", ownerA, null, now, EFFORTS).action, "cleared");
    assert.equal(draft.remoteUnsentDraft(null, "home", ownerA, null, now, EFFORTS).action, "cleared", "storage.clear() in another tab");
  });
  await check("sign-out cleanup removes only that account's unsent drafts", () => {
    const local = memory({ [draft.unsentDraftKey("home", ownerA)]: "a", [draft.unsentDraftKey("studio", ownerA)]: "a", [draft.unsentDraftKey("home", ownerB)]: "b", [draft.unsentDraftKey("home", device)]: "d" });
    clearAccountLocalData(A, [local]);
    assert.deepEqual([...local.records.keys()].sort(), [draft.unsentDraftKey("home", device), draft.unsentDraftKey("home", ownerB)].sort());
  });

  // ---- Hook behaviour with a minimal runtime ----
  function runtime() {
    const hooks = []; let index = 0, dirty = false; const queue = [];
    const React = {
      useState(init) { const i = index++; if (!(i in hooks)) hooks[i] = { value: typeof init === "function" ? init() : init }; const h = hooks[i]; return [h.value, update => { const next = typeof update === "function" ? update(h.value) : update; if (!Object.is(next, h.value)) { h.value = next; dirty = true; } }]; },
      useRef(init) { const i = index++; if (!(i in hooks)) hooks[i] = { current: init }; return hooks[i]; },
      useEffect(fn, deps) { const i = index++; const prev = hooks[i]; if (prev && deps && deps.every((d, k) => Object.is(d, prev.deps[k]))) return; hooks[i] = { deps, cleanup: prev?.cleanup }; queue.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = fn() || undefined; }); },
      useEffectEvent(fn) { const i = index++; if (!(i in hooks)) { const h = { fn }; h.call = (...args) => h.fn(...args); hooks[i] = h; } hooks[i].fn = fn; return hooks[i].call; },
    };
    return { React, async render(component) { let result; for (let pass = 0; pass < 20; pass++) { index = 0; dirty = false; result = component(); while (queue.length) queue.shift()(); await new Promise(resolve => setTimeout(resolve, 0)); if (!dirty) return result; } throw new Error("render loop did not settle"); } };
  }
  function tab(storage, listeners) {
    const window = { localStorage: storage, addEventListener: (type, fn) => listeners.push(fn), removeEventListener: (type, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } };
    const rt = runtime();
    const { useUnsentDraft } = load("src/components/use-unsent-draft.ts", {
      react: rt.React, "@/lib/routing/effort": { EFFORT_LEVELS: EFFORTS }, "@/lib/unsent-draft": draft,
    }, { window });
    const defaults = { kind: "website", mode: "create", effort: "medium", text: "" };
    const host = { account: null, enabled: true, edits: [] };
    const component = () => {
      const [fields, setFields] = rt.React.useState(defaults);
      host.fields = fields; host.setFields = setFields;
      host.api = useUnsentDraft({ surface: "home", account: host.account, enabled: host.enabled, fields, defaults, apply: next => setFields(next) });
      return host.api;
    };
    host.render = () => rt.render(component);
    host.type = async next => { host.setFields({ ...host.fields, ...next }); await host.render(); };
    return host;
  }
  const keyA = draft.unsentDraftKey("home", ownerA), keyB = draft.unsentDraftKey("home", ownerB);

  await check("hook restores after reload without submitting or restoring consent", async () => {
    const storage = memory(), listeners = [];
    const first = tab(storage, listeners); await first.render();
    first.account = { accountId: A }; await first.render();
    await first.type(book);
    assert.ok(storage.getItem(keyA), "saved immediately on edit");
    const reloaded = tab(storage, []); await reloaded.render();
    assert.equal(reloaded.fields.text, "", "nothing is read before the account is known");
    reloaded.account = { accountId: A }; await reloaded.render();
    assert.equal(JSON.stringify(reloaded.fields), JSON.stringify(book));
    assert.equal(typeof reloaded.api.restoredAt, "number");
    assert.deepEqual(Object.keys(reloaded.api).sort(), ["discard", "restoredAt", "storageRefused", "submitted"], "no submit or consent surface");
  });
  await check("hook never shows or writes account A's brief for account B", async () => {
    const storage = memory({ [keyB]: draft.encodeUnsentDraft({ kind: "presentation", mode: "create", effort: "light", text: "B's own brief" }, ownerB, Date.now()) });
    const host = tab(storage, []); host.account = { accountId: A }; await host.render();
    await host.type(book);
    host.account = { accountId: B }; await host.render();
    assert.equal(host.fields.text, "B's own brief", "B sees only B's draft");
    assert.equal(JSON.parse(storage.getItem(keyB)).text, "B's own brief", "A's text was never written under B");
    assert.equal(JSON.parse(storage.getItem(keyA)).text, book.text, "A's draft stays in A's scope");
    host.account = { accountId: null }; await host.render();
    assert.equal(host.fields.text, "", "signed-out device starts empty");
    assert.equal(storage.getItem(draft.unsentDraftKey("home", device)), null);
  });
  await check("hook switch to an account without a draft clears the composer", async () => {
    const storage = memory();
    const host = tab(storage, []); host.account = { accountId: A }; await host.render();
    await host.type(book);
    host.account = { accountId: B }; await host.render();
    assert.equal(JSON.stringify(host.fields), JSON.stringify({ kind: "website", mode: "create", effort: "medium", text: "" }));
    assert.equal(storage.getItem(keyB), null);
    await host.type({ text: "B types" });
    assert.equal(JSON.parse(storage.getItem(keyB)).text, "B types", "saving resumes for the new owner");
  });
  await check("hook discard clears composer and storage; submit clears storage only", async () => {
    const storage = memory();
    const host = tab(storage, []); host.account = { accountId: A }; await host.render();
    await host.type(book);
    host.api.discard(); await host.render();
    assert.equal(host.fields.text, ""); assert.equal(storage.getItem(keyA), null);
    await host.type({ text: "Ready to send" });
    host.api.submitted(); await host.render();
    assert.equal(storage.getItem(keyA), null, "submitted brief is not restored later");
    assert.equal(host.fields.text, "Ready to send", "submit does not wipe the visible brief");
  });
  await check("hook keeps text typed before the account resolved", async () => {
    const storage = memory({ [keyA]: draft.encodeUnsentDraft(book, ownerA, Date.now()) });
    const host = tab(storage, []); await host.render();
    await host.type({ text: "Typed early" });
    host.account = { accountId: A }; await host.render();
    assert.equal(host.fields.text, "Typed early");
  });
  await check("hook disabled during a handoff neither restores nor overwrites", async () => {
    const storage = memory({ [keyA]: draft.encodeUnsentDraft(book, ownerA, Date.now()) });
    const host = tab(storage, []); host.enabled = false; host.account = { accountId: A }; await host.render();
    await host.type({ text: "Handoff brief" });
    assert.equal(JSON.parse(storage.getItem(keyA)).text, book.text);
    assert.equal(host.fields.text, "Handoff brief");
  });
  await check("two tabs converge with last write wins and no write-back loop", async () => {
    const storage = memory(), listeners1 = [], listeners2 = [];
    const one = tab(storage, listeners1), two = tab(storage, listeners2);
    one.account = two.account = { accountId: A }; await one.render(); await two.render();
    let writes = 0; const setItem = storage.setItem; storage.setItem = (k, v) => { writes++; setItem(k, v); };
    await one.type(book);
    assert.equal(writes, 1);
    for (const fn of listeners2) fn({ key: keyA, storageArea: storage }); await two.render();
    assert.equal(JSON.stringify(two.fields), JSON.stringify(book), "second tab adopts");
    assert.equal(writes, 1, "adopting does not write back");
    await two.type({ text: "Second tab wins" });
    for (const fn of listeners1) fn({ key: keyA, storageArea: storage }); await one.render();
    assert.equal(one.fields.text, "Second tab wins");
    assert.equal(writes, 2);
    // A stale event payload is ignored in favour of what storage holds now.
    for (const fn of listeners1) fn({ key: keyA, newValue: draft.encodeUnsentDraft(book, ownerA, Date.now()), storageArea: storage }); await one.render();
    assert.equal(one.fields.text, "Second tab wins");
    two.api.discard(); await two.render();
    for (const fn of listeners1) fn({ key: keyA, storageArea: storage }); await one.render();
    assert.equal(one.fields.text, "", "discard in one tab clears the other");
    for (const fn of listeners1) fn({ key: keyB, storageArea: storage }); await one.render();
    assert.equal(writes, 2);
  });
  await check("hook reports when the browser refuses to keep a copy", async () => {
    const storage = memory(); storage.setItem = () => { throw new Error("quota"); };
    const host = tab(storage, []); host.account = { accountId: A }; await host.render();
    await host.type(book);
    assert.equal(host.api.storageRefused, true);
  });

  // Wiring: both composers use the hook, gate it on known ownership and clear it on submit.
  const home = fs.readFileSync("src/components/creation-home.tsx", "utf8"), studio = fs.readFileSync("src/components/studio.tsx", "utf8");
  await check("composers are wired with ownership gates and submit cleanup", () => {
    for (const [source, name, owner] of [[home, "unsent", "account"], [studio, "unsentBrief", "composerAccount"]]) {
      assert.match(source, new RegExp(`account: ${owner}\\.accountId \\? \\{ accountId: ${owner}\\.accountId \\} : ${owner}\\.ready \\? \\{ accountId: null \\} : null`));
      assert.match(source, new RegExp(`${name}\\.submitted\\(\\);`));
      assert.match(source, new RegExp(`onDiscard=\\{${name}\\.discard\\}`));
    }
    assert.match(studio, /enabled: loaded && routeSettled && !creating && !directStart/);
    const notice = fs.readFileSync("src/components/unsent-draft-notice.tsx", "utf8");
    assert.match(notice, /Nothing has been sent\./);
  });
  console.log(`${count} unsent draft checks passed.`);
}
main().catch(error => { console.error(error); process.exit(1); });
