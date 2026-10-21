/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks: pre-publish consent and check results belong to the version they describe (audit M07). Mounted journey: scripts/check-checked-version-browser.cjs. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { checkedFingerprint, checkedLabel, checkIsCurrent } = require("./checked-version.ts");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "..", ...parts), "utf8");
const source = { files: [{ path: "src/App.tsx", content: "<h1>One</h1>" }], assets: [{ path: "public/a.webp", sha256: "a".repeat(64) }], routes: [{ path: "/", title: "Home" }] };

check("a fingerprint changes with any source edit, asset hash or check setting", () => {
  const base = checkedFingerprint(source, ["Site", { description: "x" }]);
  assert.equal(checkedFingerprint(JSON.parse(JSON.stringify(source)), ["Site", { description: "x" }]), base, "same content, same fingerprint");
  assert.notEqual(checkedFingerprint({ ...source, files: [{ path: "src/App.tsx", content: "<h1>Two</h1>" }] }, ["Site", { description: "x" }]), base);
  assert.notEqual(checkedFingerprint({ ...source, assets: [{ path: "public/a.webp", sha256: "b".repeat(64) }] }, ["Site", { description: "x" }]), base);
  assert.notEqual(checkedFingerprint(source, ["Site", { description: "y" }]), base);
});

check("labels say which version was read", () => {
  assert.equal(checkedLabel({ version: 4, dirty: false }), "Checked saved version 4");
  assert.equal(checkedLabel({ version: 4, dirty: true }), "Checked version 4 with unsaved changes");
  assert.equal(checkedLabel({ version: 0, dirty: true }), "Checked your unsaved draft");
});

check("a result is current only for the exact content, version and saved state it read", () => {
  const scope = { fingerprint: "f", version: 4, dirty: false };
  assert.equal(checkIsCurrent(scope, "f", 4, false), true);
  assert.equal(checkIsCurrent(scope, "g", 4, false), false, "edited");
  assert.equal(checkIsCurrent(scope, "f", 5, false), false, "a newer save");
  assert.equal(checkIsCurrent(scope, "f", 4, true), false, "unsaved changes since");
  assert.equal(checkIsCurrent(null, "f", 4, false), false);
});

check("panels are wired to the version they describe", () => {
  const legacy = read("components", "website-publish.tsx");
  assert.ok(legacy.includes("const agreed=agreedVersion===version&&!dirty;"), "legacy consent is bound to the reviewed version");
  assert.ok(legacy.includes("I’ve reviewed version {version}"));
  assert.ok(!/\bsetAgreed\(/.test(legacy));
  const trusted = read("components", "trusted-website-publish.tsx");
  assert.ok(trusted.includes("matches&&!dirty?preparation.previewRoutes:undefined"), "prepared pages are not mixed with unsaved source");
  assert.ok((trusted.match(/reconcile\(error instanceof Error/g) || []).length === 2, "unconfirmed publish and offline both re-read status");
  const seo = read("components", "website-seo.tsx");
  assert.ok(seo.includes("checkIsCurrent(checked, fingerprint, version, dirty)") && seo.includes("Your site changed after this check"));
  const studio = read("components", "cloud-studio.tsx");
  assert.ok(studio.includes("version={expectedVersion} dirty={dirty}"));
  // The full Restore effect (no AI/credits, no publish, no refund) is worded once in action-semantics.ts.
  assert.ok(studio.includes('restoreEffect(inspectedVersion.number, expectedVersion, artifact.kind === "website")'), "website restore states its publishing effect");
  assert.ok(read("lib", "builder", "action-semantics.ts").includes("Your live website doesn't change until you publish again."), "restore says it does not publish");
});

console.log(`\n${passed} checked-version checks passed.`);
