/* eslint-disable @typescript-eslint/no-require-imports -- Offline margin guardrail checks. */
const fs = require("node:fs");
const ts = require("typescript");
const assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { MARGIN_POLICY, creditOffers, aiMargin, maxAiCostUsdPerCredit, offersBelow } = require("./margins.ts");
const { aiCostUsdPerCredit, DEFAULT_AI_COST_USD_PER_CREDIT, MAX_AI_COST_USD_PER_CREDIT, creditsForUsd } = require("../builder/pricing.ts");

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
  assert.equal(live.length, 3 * 2 * 2 + 3);
  for (const offer of live) assert.ok(offer.revenueCents > 0 && offer.credits > 0, offer.id);
});

check("enforced floor: every live offer keeps the minimum AI-only margin at full usage", () => {
  const below = offersBelow(live, cost, MARGIN_POLICY.enforcedMinAiMargin);
  assert.deepEqual(below.map(offer => offer.id), [], `below ${pct(MARGIN_POLICY.enforcedMinAiMargin)}: ${below.map(offer => `${offer.id} ${pct(offer.margin)}`).join(", ")}`);
  assert.ok(cost <= MAX_AI_COST_USD_PER_CREDIT, "default cost must sit under the enforced ceiling");
  assert.ok(Math.abs(MAX_AI_COST_USD_PER_CREDIT - maxAiCostUsdPerCredit(live, MARGIN_POLICY.enforcedMinAiMargin)) < 1e-12);
});

check("live offers below the proposed floor are exactly the founding first years (decision pending)", () => {
  const below = offersBelow(live, cost, MARGIN_POLICY.proposedMinAiMargin).map(offer => offer.id).sort();
  assert.deepEqual(below, ["create:yearly:founding", "scale:yearly:founding", "studio:yearly:founding"]);
});

const draft = creditOffers({ foundingYearlyDiscountPercent: MARGIN_POLICY.proposedFoundingYearlyDiscountPercent });
check("DRAFT: a 15% founding yearly discount brings every offer to the proposed 50% floor", () => {
  const below = offersBelow(draft, cost, MARGIN_POLICY.proposedMinAiMargin);
  assert.deepEqual(below.map(offer => offer.id), []);
  assert.ok(maxAiCostUsdPerCredit(draft, MARGIN_POLICY.proposedMinAiMargin) >= cost);
  // The draft changes only the founding yearly offers.
  for (const offer of draft) {
    const current = live.find(item => item.id === offer.id);
    if (!offer.id.endsWith("yearly:founding")) assert.equal(offer.revenueCents, current.revenueCents, offer.id);
    else assert.ok(offer.revenueCents > current.revenueCents, offer.id);
  }
});

check("top-ups never undercut plans and keep at least 60%", () => {
  for (const offer of live.filter(item => item.kind === "topup")) assert.ok(aiMargin(offer, cost) >= 0.6, offer.id);
});

console.log(`AI-only margin at full usage, $${cost}/credit internal cost (live | draft 15% founding yearly):`);
for (const offer of live) {
  const proposal = draft.find(item => item.id === offer.id);
  const changed = proposal.revenueCents !== offer.revenueCents ? ` | ${pct(aiMargin(proposal, cost))}` : "";
  console.log(`  ${offer.id.padEnd(24)} $${(offer.revenueCents / 100 / offer.credits).toFixed(4)}/credit  ${pct(aiMargin(offer, cost))}${changed}`);
}
console.log(`${passed} margin checks passed; enforced floor ${pct(MARGIN_POLICY.enforcedMinAiMargin)}, cost ceiling $${MAX_AI_COST_USD_PER_CREDIT.toFixed(4)}; draft floor ${pct(MARGIN_POLICY.proposedMinAiMargin)} not enforced on live prices.`);
