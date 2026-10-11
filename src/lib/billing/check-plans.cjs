/* eslint-disable @typescript-eslint/no-require-imports -- Offline pricing regression checks. */
const fs = require("node:fs");
const ts = require("typescript");
const assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { planPrice } = require("./plans.ts");
for (const [id, monthly, firstMonth, yearly, firstYear, credits] of [
  ["create", 2900, 2030, 27840, 19488, 300],
  ["studio", 7900, 5530, 75840, 53088, 850],
  ["scale", 19900, 13930, 191040, 133728, 2200],
]) {
  assert.equal(planPrice(id, "monthly", false).priceCents, monthly);
  assert.equal(planPrice(id, "monthly", true).priceCents, firstMonth);
  assert.equal(planPrice(id, "yearly", false).priceCents, yearly);
  assert.equal(planPrice(id, "yearly", true).priceCents, firstYear);
  assert.equal(planPrice(id, "yearly", true).standardCents, yearly);
  assert.equal(planPrice(id, "yearly", true).monthlyCredits, credits);
}
assert.throws(() => planPrice("coffee", "monthly", true));
const ui = fs.readFileSync(require.resolve("../../components/founding-plans.tsx"), "utf8");
assert.ok(ui.includes('disabled>{founding ? "Founder checkout being prepared" : "Opens at launch"}'));
assert.ok(!ui.includes('fetch('));
console.log("21 pricing and closed-checkout checks passed; no payment or API calls.");
