/* eslint-disable @typescript-eslint/no-require-imports -- Offline pricing regression checks. */
const fs = require("node:fs");
const ts = require("typescript");
const assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const catalogue = require("./plans.ts");
const { planPrice, CREATION_PLANS } = catalogue;
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
// Purchase availability is server-controlled; initial rendering fails closed.
const ui = fs.readFileSync(require.resolve("../../components/creation-plans.tsx"), "utf8");
assert.ok(ui.includes('/api/billing/availability'));
assert.ok(!/founding offer|founder/i.test(ui.replace(/className="founding-cta"/g, "")), "founding offer must not be advertised");
assert.ok(ui.includes("planPrice(plan.id, interval, false)"), "plans show standard prices");
// Render actual pricing and billing components with offline child boundaries.
// A billing history outage must not be presented as a generation outage.
const vm = require("node:vm");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const view = require("./view.ts");
function loadComponent(name, modules) {
  const filename = require.resolve(`../../components/${name}.tsx`);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  const context = {exports: {}, require: name => {
    if (Object.hasOwn(modules, name)) return modules[name];
    if (["react", "react/jsx-runtime", "lucide-react"].includes(name)) return require(name);
    throw new Error(`Unexpected pricing check dependency: ${name}`);
  }};
  vm.runInNewContext(compiled, context, {filename});
  return context.exports.default;
}
const link = {default: ({children, ...props}) => React.createElement("a", props, children)};
const CreationPlans = loadComponent("creation-plans", {"next/link": link, "next/navigation": {useRouter: () => ({push() {}})}, "@/lib/billing/plans": catalogue, "@/lib/supabase/auth-flow": require("../supabase/auth-flow.ts")});
const pricing = renderToStaticMarkup(React.createElement(CreationPlans));
assert.equal((pricing.match(/class="founding-cta" disabled=""/g) || []).length, 3, "every rendered plan remains closed");
assert.equal((pricing.match(/Fair use: 50 new sites per day, 1,000 live sites per workspace/g) || []).length, 3, "each card pairs unlimited with safety limits");
assert.match(pricing, /Custom-domain connections are not available yet/);
assert.doesNotMatch(pricing, /Team seats|Asset storage|\b[135] seats?\b|\b(?:2|10|30) GB\b|More work running at once|More asset storage|registered separately/);
for (const plan of CREATION_PLANS) {
  assert.equal(Object.hasOwn(plan, "seats"), false, "catalogue cannot sell an unimplemented seat entitlement");
  assert.equal(Object.hasOwn(plan, "storage"), false, "catalogue cannot sell an unimplemented storage entitlement");
  assert.equal(plan.sites, "unlimited");
}
// The per-action credit table renders the live pricing constants and only measured ranges.
const estimates = require("../builder/credit-estimate.ts");
const BillingCreditCosts = loadComponent("billing-credit-costs", {
  "@/lib/builder/pricing": require("../builder/pricing.ts"),
  "@/lib/builder/plan": require("../builder/plan.ts"),
  "@/lib/builder/review-policy": require("../builder/review-policy.ts"),
  "@/lib/routing/effort": require("../routing/effort.ts"),
});
const costs = renderToStaticMarkup(React.createElement(BillingCreditCosts, {estimates: estimates.builderEstimates(0.03)}));
for (const limit of ["10 credits", "20 credits", "50 credits", "90 credits", "140 credits", "240 credits", "Light 12 · Medium 15 · High 27 · Super high 42 · Ultra 72"]) assert.ok(costs.includes(limit), limit);
assert.ok(costs.includes("First website: 16–45 credits (20 test websites)"));
assert.ok(costs.includes("Medium: 8–11 credits (20 test rounds)"));
assert.equal((costs.match(/test websites/g) || []).length, 1, "measured ranges appear only at the measured effort");
assert.match(costs, /a plan that doesn’t finish/);
assert.doesNotMatch(costs, /failed runs are free/i);
const withoutMeasurements = renderToStaticMarkup(React.createElement(BillingCreditCosts, {estimates: null}));
assert.doesNotMatch(withoutMeasurements, /test websites/);
const BillingWorkspace = loadComponent("billing-workspace", {
  "next/link": link,
  "./billing-credit-costs": {default: BillingCreditCosts},
  "./brand-mark": {default: () => null},
  "./billing-plans": {default: CreationPlans},
  // The live return component is exercised separately in the browser harness.
  "./billing-topup-return": {default: ({orderId}) => React.createElement("div", {"data-topup-order": orderId})},
  "./credit-balance": {default: () => null, creditExpiryLabel: () => "Expiry"},
  "./billing-amount": {formatBillingCredits: value => value},
  "@/lib/billing/view": view,
});
for (const summary of [view.unavailableBilling, {status: "ready", unit: "whole_customer_credits", available: "0", reserved: "0", used: "0", period: "October 2026", entries: []}]) {
  const billing = renderToStaticMarkup(React.createElement(BillingWorkspace, {summary, accountPrivileges: {isAdmin: true, unlimitedCredits: true}}));
  assert.doesNotMatch(billing, /generation (?:is still )?disabled|creation services are disabled/i);
  assert.match(billing, /Generation depends on current service availability and safety limits/);
  assert.match(billing, /href="\/studio"/);
  if (summary.status === "unavailable") assert.match(billing, /Reserved and used amounts are unavailable/);
}
const returnOrder = "abcdefab-1234-4234-8234-123456789abc";
const returnView = props => renderToStaticMarkup(React.createElement(BillingWorkspace, {summary: view.unavailableBilling, ...props}));
assert.doesNotMatch(returnView({}), /data-topup-order/);
assert.match(returnView({topupOrderId: returnOrder}), new RegExp(`data-topup-order="${returnOrder}"`));
assert.match(returnView({topupOrderId: ""}), /data-topup-order=""/, "invalid return links must still reach the safe unavailable notice");
console.log("Pricing amounts, catalogue claims, rendered fair-use disclosures, administrator states and closed-checkout checks passed; no payment or API calls.");
