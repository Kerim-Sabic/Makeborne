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

// Wiring: the studio decides with the status, never with a truthy count.
const studio = fs.readFileSync("src/components/studio.tsx", "utf8");
const projects = fs.readFileSync("src/components/account-projects.tsx", "utf8");
check("studio and list are wired through the status, with Retry on failure", () => {
  assert.doesNotMatch(studio, /accountProjectCount/);
  assert.match(studio, /projectsWelcome\(workspace\.projects\.length, accountLibrary\) !== "welcome"/);
  assert.match(projects, /onStatus\?\.\(status\)/);
  assert.match(projects, /setLoadAttempt\(attempt => attempt \+ 1\)/);
  assert.match(projects, /\}, \[accountId, target, loadAttempt\]\);/, "retry re-runs the guarded load");
  assert.match(projects, /version !== requestVersion\.current/, "request-version guard kept");
  assert.match(projects, /role="alert">\{message\} Your saved projects haven/);
  assert.match(projects, /setCloud\("error"\)/);
});

console.log(`${count} project library state checks passed.`);
