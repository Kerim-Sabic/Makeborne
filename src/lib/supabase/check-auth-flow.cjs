/* eslint-disable @typescript-eslint/no-require-imports -- Offline pure redirect checks. */
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const source = fs.readFileSync(require.resolve("./auth-flow.ts"), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const context = { exports: {}, URLSearchParams };
vm.runInNewContext(output, context);
const { authDestination } = context.exports;
for (const target of [null, "", "/studio", "/studio/cloud", "https://example.com", "//example.com", "/auth/update-password?next=evil"]) {
  assert.equal(authDestination(target), "/studio");
}
assert.equal(authDestination("/auth/update-password"), "/auth/update-password");
const workspace = "12345678-1234-1234-1234-123456789012", artifact = "22345678-1234-1234-1234-123456789012";
const deep = `/studio?tab=projects&workspace=${workspace}&artifact=${artifact}`;
assert.equal(authDestination(deep), deep);
assert.equal(authDestination(deep + "&next=https://evil.example"), deep);
assert.equal(authDestination(`/studio?tab=projects&workspace=${workspace}`), `/studio?tab=projects&workspace=${workspace}`);
for (const target of ["/studio?tab=projects&workspace=https://evil.example", "/studio?tab=projects&artifact=" + artifact, deep + "/../../admin", "/studio?tab=settings&workspace=" + workspace, "/studio?tab=projects&workspace=" + "a".repeat(600)]) assert.equal(authDestination(target), "/studio");
console.log("PASS: 16 auth destination checks; account links preserved, unsupported destinations rejected.");
