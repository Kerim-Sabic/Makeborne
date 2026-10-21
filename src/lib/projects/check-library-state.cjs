/* eslint-disable @typescript-eslint/no-require-imports -- Offline project library state checks. */
// The studio's "Your projects will live here" welcome claims nothing is saved.
// It may appear only when that is known; loading and failed loads say so instead.
const fs = require("node:fs"), vm = require("node:vm"), ts = require("typescript"), assert = require("node:assert/strict");
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve("./library-state.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
const { accountLibraryStatus, projectsWelcome, sameLibraryStatus } = context.exports;
let count = 0;
function check(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
const account = "11111111-1111-4111-8111-111111111111";
const base = { cloud: "available", authReady: true, accountId: account, busy: false, loadedCount: null, noWorkspace: false, failed: false };
const state = input => JSON.parse(JSON.stringify(accountLibraryStatus({ ...base, ...input })));

check("capability check still running is not empty", () => {
  assert.deepEqual(state({ cloud: "unknown", authReady: false, accountId: null }), { state: "checking" });
  assert.equal(projectsWelcome(0, accountLibraryStatus({ ...base, cloud: "unknown", authReady: false, accountId: null })), "pending");
});
check("signed-in account before its session is known is not empty", () => {
  assert.deepEqual(state({ authReady: false, accountId: null }), { state: "checking" });
});
check("loading snapshot is not empty", () => {
  const status = accountLibraryStatus({ ...base, busy: true });
  assert.equal(status.state, "loading");
  assert.equal(projectsWelcome(0, status), "pending");
});
check("loaded with saved projects hides the welcome", () => {
  const status = accountLibraryStatus({ ...base, loadedCount: 71 });
  assert.deepEqual(JSON.parse(JSON.stringify(status)), { state: "loaded", count: 71 });
  assert.equal(projectsWelcome(0, status), "none");
});
check("loaded and actually empty shows the welcome", () => {
  assert.equal(projectsWelcome(0, accountLibraryStatus({ ...base, loadedCount: 0 })), "welcome");
  assert.equal(projectsWelcome(0, accountLibraryStatus({ ...base, noWorkspace: true })), "welcome");
});
check("failed load never shows a friendly empty state", () => {
  const status = accountLibraryStatus({ ...base, failed: true });
  assert.equal(status.state, "failed");
  assert.equal(projectsWelcome(0, status), "none");
  assert.equal(projectsWelcome(0, accountLibraryStatus({ ...base, cloud: "error", authReady: true, accountId: null })), "none");
});
check("retry in progress after a failure shows loading", () => {
  assert.equal(state({ failed: true, busy: true }).state, "loading");
});
check("failed refresh after a successful load keeps the loaded list", () => {
  assert.deepEqual(state({ loadedCount: 4, failed: false }), { state: "loaded", count: 4 });
});
check("cloud off and signed out are local-only and may welcome", () => {
  const off = accountLibraryStatus({ ...base, cloud: "off", accountId: null });
  const out = accountLibraryStatus({ ...base, accountId: null });
  assert.deepEqual(JSON.parse(JSON.stringify(off)), { state: "unavailable", reason: "cloud-off" });
  assert.deepEqual(JSON.parse(JSON.stringify(out)), { state: "unavailable", reason: "signed-out" });
  assert.equal(projectsWelcome(0, off), "welcome");
  assert.equal(projectsWelcome(0, out), "welcome");
});
check("device projects always win over the welcome", () => {
  for (const status of [{ state: "checking" }, { state: "loading" }, { state: "failed" }, { state: "loaded", count: 0 }, { state: "unavailable", reason: "cloud-off" }])
    assert.equal(projectsWelcome(2, status), "none");
});
check("status identity only changes when its meaning does", () => {
  assert.equal(sameLibraryStatus({ state: "loaded", count: 2 }, { state: "loaded", count: 2 }), true);
  assert.equal(sameLibraryStatus({ state: "loaded", count: 2 }, { state: "loaded", count: 3 }), false);
  assert.equal(sameLibraryStatus({ state: "loading" }, { state: "failed" }), false);
  assert.equal(sameLibraryStatus({ state: "unavailable", reason: "cloud-off" }, { state: "unavailable", reason: "signed-out" }), false);
});

// M03: returning users get their library first; new users keep the prompt-first entry.
const { libraryLayout, readLibraryHint, writeLibraryHint, LIBRARY_HINT_KEY } = context.exports;
check("saved projects put the library first; known-empty and local-only stay prompt-first", () => {
  assert.equal(libraryLayout(0, { state: "loaded", count: 3 }, null), "library-first");
  assert.equal(libraryLayout(2, { state: "loading" }, false), "library-first", "device projects are known immediately");
  assert.equal(libraryLayout(2, { state: "unavailable", reason: "signed-out" }, null), "library-first");
  assert.equal(libraryLayout(0, { state: "loaded", count: 0 }, true), "prompt-first", "loaded data beats the remembered answer");
  assert.equal(libraryLayout(0, { state: "unavailable", reason: "cloud-off" }, true), "prompt-first");
  assert.equal(libraryLayout(0, { state: "unavailable", reason: "signed-out" }, true), "prompt-first", "a signed-out page never uses an account's memory");
});
check("unknown states never flip the page: they keep this account's last answer, and a first visit stays prompt-first", () => {
  for (const status of [{ state: "checking" }, { state: "loading" }, { state: "failed" }]) {
    assert.equal(libraryLayout(0, status, true), "library-first", `${status.state} keeps a returning layout (refresh, load more, failed reload)`);
    assert.equal(libraryLayout(0, status, false), "prompt-first");
    assert.equal(libraryLayout(0, status, null), "prompt-first", "no memory: prompt-first, as before");
  }
});
check("layout memory holds one account's yes/no only and tolerates blocked storage", () => {
  const data = new Map();
  const storage = () => ({ getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) });
  const other = "22222222-2222-4222-8222-222222222222";
  assert.equal(readLibraryHint(storage, account), null);
  writeLibraryHint(storage, account, true);
  assert.deepEqual(JSON.parse(data.get(LIBRARY_HINT_KEY)), { accountId: account, returning: true }, "no titles, counts or project IDs");
  assert.equal(readLibraryHint(storage, account), true);
  assert.equal(readLibraryHint(storage, undefined), true, "account not known yet: the device's last account");
  assert.equal(readLibraryHint(storage, other), null, "another account never inherits it");
  assert.equal(readLibraryHint(storage, null), null, "signed out");
  data.set(LIBRARY_HINT_KEY, "{not json"); assert.equal(readLibraryHint(storage, account), null);
  data.set(LIBRARY_HINT_KEY, JSON.stringify({ accountId: account, returning: "yes" })); assert.equal(readLibraryHint(storage, account), null);
  const blocked = () => { throw new Error("SecurityError"); };
  assert.equal(readLibraryHint(blocked, account), null);
  assert.doesNotThrow(() => writeLibraryHint(blocked, account, true));
});

// Wiring: the studio decides with the status, never with a truthy count.
const studio = fs.readFileSync("src/components/studio.tsx", "utf8");
const projects = fs.readFileSync("src/components/account-projects.tsx", "utf8");
check("studio and list are wired through the status, with Retry on failure", () => {
  assert.doesNotMatch(studio, /accountProjectCount/);
  assert.match(studio, /projectsWelcome\(workspace\.projects\.length, accountLibrary\) !== "welcome"/);
  assert.match(projects, /onStatus\?\.\(status, accountId\)/);
  assert.match(projects, /setLoadAttempt\(attempt => attempt \+ 1\)/);
  assert.match(projects, /\}, \[accountId, target, loadAttempt\]\);/, "retry re-runs the guarded load");
  assert.match(projects, /version !== requestVersion\.current/, "request-version guard kept");
  assert.match(projects, /role="alert">\{message\} Your saved projects haven/);
  assert.match(projects, /setCloud\("error"\)/);
});

check("studio orders the page by the layout without remounting the account list", () => {
  assert.match(studio, /const libraryFirst = libraryLayout\(workspace\.projects\.length, accountLibrary, libraryHint\) === "library-first";/);
  assert.equal((studio.match(/<AccountProjects /g) ?? []).length, 1, "one account list position: changing the order never refetches it");
  assert.match(studio, /!libraryFirst && <div className="studio-create">\{creationEntry\}<\/div>\}\s*<AccountProjects /, "new users: creation above the list");
  const after = studio.slice(studio.indexOf("<AccountProjects "));
  assert.match(after, /libraryFirst && <div className="studio-create">\{creationEntry\}<\/div>\}\s*\{!accountRoute\?\.artifactId && workspace\.projects\.length === 0 && \(\s*<TemplateGallery/, "returning users: creation stays on the page, below their projects");
  assert.match(studio, /libraryFirst \? "returning-workspace" : "fresh-workspace"/);
  assert.match(studio, /writeLibraryHint\(\(\) => localStorage, accountId, next\.count > 0\)/, "memory only changes on loaded data");
  // Explicit creation links are untouched: New project still goes to the prompt-first home.
  assert.match(studio, /<Link className="button primary" href="\/">\s*<Plus size=\{17\} \/> New project/);
  assert.match(studio, /<Link className="button create-button" href="\/">/);
});

console.log(`${count} project library state checks passed.`);
