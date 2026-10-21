/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for the client palette's query-bound search state (audit F03). The mounted browser journey is scripts/check-palette-search-browser.cjs. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { clampActive, currentClients, searchKey, searchNotice } = require("./palette-search.ts");

let count = 0;
const check = (name, fn) => { fn(); count++; console.log(`PASS ${name}`); };
const maple = { id: "fictional-maple", name: "Maple Studio" };

check("results belong to the workspace + query they were requested for", () => {
  const ws = "ws-1", empty = searchKey(ws, ""), next = searchKey(ws, "ZZ-NO-MATCH");
  const ready = { status: "ready", key: empty, clients: [maple] };
  assert.deepEqual(currentClients(ready, empty), [maple]);
  assert.deepEqual(currentClients(ready, next), [], "a newer query never shows the old rows");
  assert.deepEqual(currentClients(ready, searchKey("ws-2", "")), [], "another workspace never shows them");
  assert.deepEqual(currentClients({ status: "loading", key: next }, next), []);
  assert.deepEqual(currentClients({ status: "error", key: next }, next), []);
  assert.equal(searchKey(ws, "  maple "), searchKey(ws, "maple"), "surrounding spaces are one query");
});

check("pending, failed, empty and found are distinct notices", () => {
  const key = searchKey("ws", "x");
  assert.equal(searchNotice({ status: "ready", key: searchKey("ws", ""), clients: [maple] }, key, 0), "searching", "stale result while the new one is pending");
  assert.equal(searchNotice({ status: "loading", key }, key, 2), "searching", "static actions may show, but the search is still running");
  assert.equal(searchNotice({ status: "error", key }, key, 0), "error", "a failed request is not 'no matches'");
  assert.equal(searchNotice({ status: "ready", key, clients: [] }, key, 0), "empty");
  assert.equal(searchNotice({ status: "ready", key, clients: [] }, key, 1), null, "an action matched; nothing to say");
  assert.equal(searchNotice({ status: "ready", key, clients: [maple] }, key, 1), null);
});

check("the active row is always a visible item, or none", () => {
  assert.equal(clampActive(3, 0), -1, "an empty list has no active descendant");
  assert.equal(clampActive(5, 2), 1);
  assert.equal(clampActive(-1, 2), 0);
  assert.equal(clampActive(0, 1), 0);
});

check("the palette wires it: no stale choice, Retry keeps the query, failures never render as empty", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "components", "client-command-palette.tsx"), "utf8");
  assert.match(source, /const clients = currentClients\(search, key\);/);
  assert.match(source, /\.catch\(\(\) => \{ if \(live\) setSearch\(\{ status: "error", key: requested \}\); \}\)/);
  assert.doesNotMatch(source, /setClients\(\[\]\)/, "a failure no longer becomes an empty list");
  assert.match(source, /aria-activedescendant=\{current >= 0 \? `cp-item-\$\{current\}` : undefined\}/);
  assert.match(source, /setAttempt\(value => value \+ 1\)/);
  assert.match(source, /return \(\) => \{ live = false; window\.clearTimeout\(timer\); \};/, "late responses after cleanup are still ignored");
});

console.log(`${count} palette search checks passed.`);
