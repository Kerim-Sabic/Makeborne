/* eslint-disable @typescript-eslint/no-require-imports -- Offline pure redirect checks. */
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const source = fs.readFileSync(require.resolve("./auth-flow.ts"), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const context = { exports: {}, URLSearchParams, URL };
vm.runInNewContext(output, context);
const { authDestination } = context.exports;
for (const target of [null, "", "https://example.com", "//example.com", "/\\example.com", "/auth/update-password?next=evil", "/admin", "/billingevil", "/studioevil"]) assert.equal(authDestination(target), "/studio");
for (const target of ["/studio", "/studio/cloud", "/chat", "/billing", "/auth/update-password"]) assert.equal(authDestination(target), target);
const workspace = "12345678-1234-1234-1234-123456789012", artifact = "22345678-1234-1234-1234-123456789012";
for (const tab of ["clients", "projects", "styles", "settings"]) {
  const url = new URL(authDestination(`/studio?tab=${tab}&workspace=${workspace}&artifact=${artifact}&next=https://evil.example`), "https://makeborne.invalid");
  assert.equal(url.pathname, "/studio");
  assert.equal(url.searchParams.get("workspace"), workspace);
  assert.equal(url.searchParams.get("artifact"), artifact);
  assert.equal(url.searchParams.get("tab"), tab);
  assert.equal(url.searchParams.has("next"), false);
}
const draft = `/studio?create=book&from=home&draft=${workspace}&claim=${artifact}`;
const draftResult = new URL(authDestination(draft), "https://makeborne.invalid");
assert.equal(draftResult.searchParams.get("draft"), workspace);
assert.equal(draftResult.searchParams.get("claim"), artifact);
assert.equal(draftResult.searchParams.get("create"), "book");
const billing = `/billing?required=membership&next=${encodeURIComponent(draft)}#support`;
const billingResult = new URL(authDestination(billing), "https://makeborne.invalid");
assert.equal(billingResult.searchParams.get("next"), authDestination(draft));
assert.equal(billingResult.searchParams.get("required"), "membership");
assert.equal(billingResult.hash, "#support");
assert.equal(authDestination("/billing?next=https://evil.example#wrong"), "/billing");
assert.equal(authDestination(`/billing/return?request=${workspace}`), `/billing/return?request=${workspace}`);
assert.equal(authDestination("/billing/return?request=bad"), "/billing");
assert.equal(authDestination("/studio?draft=bad&claim=bad&create=evil&next=https://evil.example"), "/studio");
console.log("PASS: internal account, draft, billing and checkout return URLs preserved; external and unsupported destinations rejected.");
