/* eslint-disable @typescript-eslint/no-require-imports -- Offline URL boundary checks. */
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const context = { exports: {}, URL, Error };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(`${__dirname}/checkout-navigation.ts`, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, context);
const { topupNavigationUrl: resolve } = context.exports;
const live = "https://whop.com/checkout/ch_test123/";
const sandbox = "https://sandbox.whop.com/checkout/ch_test123/?session=fixture";
let checks = 0;
for (const origin of ["https://makeborne.com", "https://makeborne.vercel.app", "https://preview.vercel.app", "http://localhost:3068", "http://127.0.0.1:3068", "http://[::1]:3068"]) {
  assert.equal(resolve(live, origin), live); checks++;
}
for (const origin of ["http://localhost:3068", "http://127.0.0.1:3068", "http://[::1]:3068"]) {
  assert.equal(resolve(sandbox, origin), sandbox); checks++;
}
for (const origin of ["https://makeborne.com", "https://preview.vercel.app", "https://localhost.evil.test", "ftp://localhost", "https://user@localhost", "invalid"]) {
  assert.throws(() => resolve(sandbox, origin), /could not be verified/); checks++;
}
for (const url of [null, {}, "not a url", "//whop.com/checkout/ch_test", "http://whop.com/checkout/ch_test", "https://whop.com.evil.test/checkout/ch_test", "https://whop.com:444/checkout/ch_test", "https://user:pass@whop.com/checkout/ch_test", "https://whop.com/checkout/plan_test", "https://whop.com/checkout/ch_test/extra", "https://whop.com/checkout/%63h_test", "https://sandbox.whop.com.evil.test/checkout/ch_test"]) {
  assert.throws(() => resolve(url, "http://localhost:3068"), /could not be verified/); checks++;
}
const component = fs.readFileSync(`${__dirname}/../../components/billing-topups.tsx`, "utf8");
assert.match(component, /window\.location\.assign\(topupNavigationUrl\(data\?\.url, window\.location\.origin\)\)/);
console.log(`${checks + 1} checkout navigation checks passed; no network or checkout actions.`);
