/* eslint-disable @typescript-eslint/no-require-imports -- Offline pure redirect checks. */
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const source = fs.readFileSync(require.resolve("./auth-flow.ts"), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const context = { exports: {} };
vm.runInNewContext(output, context);
const { authDestination } = context.exports;
for (const target of [null, "", "/studio", "/studio/cloud", "https://example.com", "//example.com", "/auth/update-password?next=evil"]) {
  assert.equal(authDestination(target), "/studio");
}
assert.equal(authDestination("/auth/update-password"), "/auth/update-password");
console.log("PASS: 8 auth destination checks; main studio default, recovery preserved, external redirects rejected.");
