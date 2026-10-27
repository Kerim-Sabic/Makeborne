/* eslint-disable @typescript-eslint/no-require-imports -- Offline margin guardrail checks. */
const fs = require("node:fs");
const ts = require("typescript");
const assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { MARGIN_POLICY, creditOffers, aiMargin, maxAiCostUsdPerCredit, offersBelow } = require("./margins.ts");
const { aiCostUsdPerCredit, DEFAULT_AI_COST_USD_PER_CREDIT, MAX_AI_COST_USD_PER_CREDIT, creditsForUsd } = require("../builder/pricing.ts");
const { FOUNDING_DISCOUNT_PERCENT } = require("./plans.ts");

let passed = 0;
const check = (name, fn) => { fn(); passed++; };
const cost = DEFAULT_AI_COST_USD_PER_CREDIT;
const pct = value => `${(value * 100).toFixed(1)}%`;

check("internal AI cost per credit: new name, legacy fallback, safe defaults", () => {
  const original = console.error; console.error = () => {};
  try {
    assert.equal(aiCostUsdPerCredit({}), 0.03);
    assert.equal(aiCostUsdPerCredit({ MAKEBORNE_USD_PER_CREDIT: "0.025" }), 0.025, "legacy name still honoured");
    assert.equal(aiCostUsdPerCredit({ MAKEBORNE_AI_COST_USD_PER_CREDIT: "0.02", MAKEBORNE_USD_PER_CREDIT: "0.025" }), 0.02, "new name wins");
    assert.equal(aiCostUsdPerCredit({ MAKEBORNE_AI_COST_USD_PER_CREDIT: " ", MAKEBORNE_USD_PER_CREDIT: "0.025" }), 0.025, "blank new name falls back");
    for (const bad of ["abc", "0", "-1", "0.05", "10"]) assert.equal(aiCostUsdPerCredit({ MAKEBORNE_AI_COST_USD_PER_CREDIT: bad }), cost, `rejects ${bad}`);
  } finally { console.error = original; }
  assert.equal(creditsForUsd(0.8), 27);
});

const live = creditOffers();
check("catalogue covers every plan, interval, founding term and top-up", () => {
  assert.equal(live.length, 3 * 2 * (FOUNDING_DISCOUNT_PERCENT ? 2 : 1) + 3);
  for (const offer of live) assert.ok(offer.revenueCents > 0 && offer.credits > 0, offer.id);
});

check("enforced floor: every live offer keeps the minimum AI-only margin at full usage", () => {
  const below = offersBelow(live, cost, MARGIN_POLICY.enforcedMinAiMargin);
  assert.deepEqual(below.map(offer => offer.id), [], `below ${pct(MARGIN_POLICY.enforcedMinAiMargin)}: ${below.map(offer => `${offer.id} ${pct(offer.margin)}`).join(", ")}`);
  assert.ok(cost <= MAX_AI_COST_USD_PER_CREDIT, "default cost must sit under the enforced ceiling");
  assert.ok(Math.abs(MAX_AI_COST_USD_PER_CREDIT - maxAiCostUsdPerCredit(live, MARGIN_POLICY.enforcedMinAiMargin)) < 1e-12);
});

check("monthly plans keep the 50% target; only yearly plans sit between the floors", () => {
  const below = offersBelow(live, cost, MARGIN_POLICY.proposedMinAiMargin).map(offer => offer.id).sort();
  assert.deepEqual(below, ["create:yearly", "scale:yearly", "studio:yearly"]);
});

check("no founding discount at launch, so first terms cost the standard price", () => {
  assert.equal(FOUNDING_DISCOUNT_PERCENT, 0);
  assert.equal(live.some(offer => offer.id.endsWith(":founding")), false);
});

check("top-ups never undercut plans and keep at least 60%", () => {
  for (const offer of live.filter(item => item.kind === "topup")) assert.ok(aiMargin(offer, cost) >= 0.6, offer.id);
});

console.log(`AI-only margin at full usage, $${cost}/credit internal cost:`);
for (const offer of live) console.log(`  ${offer.id.padEnd(24)} $${(offer.revenueCents / 100 / offer.credits).toFixed(4)}/credit  ${pct(aiMargin(offer, cost))}`);
console.log(`${passed} margin checks passed; enforced floor ${pct(MARGIN_POLICY.enforcedMinAiMargin)}, cost ceiling $${MAX_AI_COST_USD_PER_CREDIT.toFixed(4)}; monthly target ${pct(MARGIN_POLICY.proposedMinAiMargin)}.`);
