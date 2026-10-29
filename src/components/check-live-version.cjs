/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks: version history marks the public version only from a confirmed live site, for this project (audit M07). */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict"), Module = require("node:module");
const load = Module._load;
Module._load = function (name, parent, main) { return name === "./cloud-api" ? { cloudAccountGuard: () => () => {} } : name === "react" ? { useEffect() {}, useState: value => [value, () => {}] } : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { liveVersionFrom, liveAddressFrom } = require("./use-live-version.ts");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }

check("only a confirmed live site names a live version", () => {
  assert.equal(liveVersionFrom({ site: { live: true, version_number: 7 } }), 7);
  assert.equal(liveVersionFrom({ site: { live: false, version_number: 7 } }), "offline", "taken offline");
  assert.equal(liveVersionFrom({ site: null }), "offline", "never published");
  assert.equal(liveVersionFrom({ site: { live: true, version_number: "7" } }), "offline", "malformed is not live");
  assert.equal(liveVersionFrom(null), "offline");
});

check("the public address is offered only while a version is live", () => {
  assert.equal(liveAddressFrom({ site: { live: true, version_number: 3 }, address: "https://sites.makeborne.com/ovenbird" }), "https://sites.makeborne.com/ovenbird");
  assert.equal(liveAddressFrom({ site: { live: false, version_number: 3 }, address: "https://sites.makeborne.com/ovenbird" }), null, "taken offline: no address");
  assert.equal(liveAddressFrom({ site: null, address: null }), null, "never published");
  assert.equal(liveAddressFrom({ site: { live: true, version_number: 3 }, address: "javascript:alert(1)" }), null, "only web addresses");
  assert.equal(liveAddressFrom(null), null);
});

check("history wiring: read-only, scoped, websites only", () => {
  const hook = fs.readFileSync(path.join(__dirname, "use-live-version.ts"), "utf8");
  assert.ok(hook.includes('cache: "no-store"') && !/method:\s*"(POST|PATCH|DELETE)"/.test(hook), "GET only");
  assert.ok(hook.includes("enabled && state?.scope === scope ? state : null"), "a value for another project is never shown");
  const studio = fs.readFileSync(path.join(__dirname, "cloud-studio.tsx"), "utf8");
  assert.ok(studio.includes('useLivePublication(accountId, workspaceId, artifact.id, artifact.kind === "website", `${view}:${liveRefresh}`)'), "websites only; re-read on view changes and after publishing");
  assert.ok(hook.includes("[enabled, scope, accountId, workspaceId, artifactId, refreshKey]"), "the refresh key re-reads the status");
  assert.ok(studio.includes('{v.number === liveVersion && <span className="cloud-version-live">Live</span>}'));
  assert.ok(studio.includes("Couldn&apos;t check which version is live."), "a failed check is not shown as 'not live'");
});

console.log(`\n${passed} live-version checks passed.`);
