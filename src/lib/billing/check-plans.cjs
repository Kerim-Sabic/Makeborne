/* eslint-disable @typescript-eslint/no-require-imports -- Offline pricing regression checks. */
const fs = require("node:fs");
const ts = require("typescript");
const assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const catalogue = require("./plans.ts");
const { planPrice, CREATION_PLANS } = catalogue;
for (const [id, monthly, firstMonth, yearly, firstYear, credits] of [
  ["create", 2000, 2000, 19200, 19200, 300],
  ["studio", 4900, 4900, 47040, 47040, 750],
  ["scale", 9900, 9900, 95040, 95040, 1550],
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
// The plan choice is read from window.location.search in an effect, never useSearchParams
// (no Suspense/CSR bailout, and the useRouter-only mock below stays valid).
assert.ok(!ui.includes("useSearchParams"), "creation-plans must not use useSearchParams");
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
const CreationPlans = loadComponent("creation-plans", {"next/link": link, "next/navigation": {useRouter: () => ({push() {}})}, "@/lib/billing/plans": catalogue, "@/lib/supabase/auth-flow": require("../supabase/auth-flow.ts"), "@/lib/billing/checkout-navigation": require("./checkout-navigation.ts"), "@/lib/legal/versions": require("../legal/versions.ts")});
const text = html => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
const estimates = require("../builder/credit-estimate.ts");
const pricing = renderToStaticMarkup(React.createElement(CreationPlans));
assert.equal((pricing.match(/class="founding-cta" disabled=""/g) || []).length, 3, "every rendered plan remains closed");
assert.equal((pricing.match(/Checking…/g) || []).length, 3, "loading CTAs say they are checking, never 'Opens at launch'");
assert.doesNotMatch(pricing, /Opens at launch/, "the launch pill waits for loaded, empty availability");
assert.doesNotMatch(pricing, /billing-outcomes|first builds|How we counted/, "no outcome figures without measurements");
assert.doesNotMatch(pricing, /Fair use: 50 new sites per day/, "the fair-use sentence lives once in the shared includes list");
assert.doesNotMatch(pricing, /role="radiogroup"/, "no interval switch while yearly is not on sale");
assert.doesNotMatch(pricing, /Team seats|Asset storage|\b[135] seats?\b|\b(?:2|10|30) GB\b|More work running at once|More asset storage|registered separately/);
const measured = renderToStaticMarkup(React.createElement(CreationPlans, {estimates: estimates.builderEstimates(0.03), mediumCeilingCredits: 50, measuredRun: estimates.MEASURED_RUN}));
const measuredText = text(measured);
for (const line of ["Websites: 6–9 first builds", "Websites: 16–23 first builds", "Websites: 34–48 first builds",
  "or presentations: 33–37 (2 tests)", "or books: 21–25 (2 tests)", "or presentations: 83–93 (2 tests)", "or books: 53–62 (2 tests)", "or presentations: 172–193 (2 tests)", "or books: 110–129 (2 tests)",
  "At least 6 requests at the default effort, each capped at 50 credits, unless you approve going past a limit.", "At least 15 requests at the default effort, unless you approve going past a limit.", "At least 31 requests at the default effort, unless you approve going past a limit.",
  "Best for client work", "750 credits every month · 2.5× Create", "1,550 credits every month · over 5× Create",
  "$20 today, then $20 a month until you cancel. Tax and any checkout fee shown before you pay.", "$49 today, then $49 a month until you cancel.", "$99 today, then $99 a month until you cancel.",
  "18 October 2026 test runs", "20 websites (16–45 credits, typically 32);", "2 presentations of 8 and 10 slides (7–9);", "2 books of 13 and 38 pages (9–14).", "These runs predate our latest efficiency changes",
  "Plans renew automatically at the same price until you cancel in your Whop account", "Any tax or checkout fee is shown by Whop before you pay."]) assert.ok(measuredText.includes(line), line);
assert.equal((measuredText.match(/until you cancel\./g) || []).length, 3, "renewal terms sit under every CTA");
assert.match(measured, /aria-describedby="creation-availability plan-terms-studio"/);
for (const id of ["plan-create", "plan-studio", "plan-scale", "how-we-counted"]) assert.match(measured, new RegExp(`id="${id}"`), id);
assert.equal((measured.match(/billing-plan-featured/g) || []).length, 1, "one focal card");
for (const html of [pricing, measured]) {
  assert.doesNotMatch(html, /Most popular|<s>|<del>|line-through|coffee|Save 20%|test websites|cost per credit|\$0\.0/i);
  assert.match(html, /class="billing-sr-only">Plans</, "visually hidden plans heading");
}
const memberPlans = renderToStaticMarkup(React.createElement(CreationPlans, {currentTier: "studio"}));
assert.doesNotMatch(memberPlans, /Ask to switch/, "member mode waits for availability to confirm membership");
for (const plan of CREATION_PLANS) {
  assert.equal(Object.hasOwn(plan, "seats"), false, "catalogue cannot sell an unimplemented seat entitlement");
  assert.equal(Object.hasOwn(plan, "storage"), false, "catalogue cannot sell an unimplemented storage entitlement");
  assert.equal(plan.sites, "unlimited");
}
// The per-action credit table renders the live pricing constants and only measured ranges.
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
assert.match(costs, /a plan that fails to finish/);
assert.match(costs, /If you choose Stop:/);
assert.match(costs, /confirmed usage is charged once, unused reserved credits are returned/);
assert.doesNotMatch(costs, /a plan that doesn’t finish/);
assert.doesNotMatch(costs, /failed runs are free/i);
const withoutMeasurements = renderToStaticMarkup(React.createElement(BillingCreditCosts, {estimates: null}));
assert.doesNotMatch(withoutMeasurements, /test websites/);
const BillingWorkspace = loadComponent("billing-workspace", {
  "@/components/legal/legal-links": {default: () => null},
  "next/link": link,
  "./billing-credit-costs": {default: BillingCreditCosts},
  "./brand-mark": {default: () => null},
  "./billing-plans": {default: CreationPlans},
  "./billing-controls": {default: () => null},
  "./billing-subscriptions": {default: () => null},
  // The live return component is exercised separately in the browser harness.
  "./billing-topup-return": {default: ({orderId}) => React.createElement("div", {"data-topup-order": orderId})},
  // Automatic top-up setup renders only behind its qualification flag (check-autotopup.cjs).
  "./billing-autotopup": {default: () => React.createElement("div", {"data-autotopup-setup": "shown"})},
  "./credit-balance": {default: () => null, creditExpiryLabel: () => "Expiry"},
  "./billing-amount": {formatBillingCredits: value => value},
  "@/lib/billing/view": view,
  "@/lib/billing/usage-history": require("./usage-history.ts"),
});
// Buying reassurance: one fair-use sentence, the five promises, and what isn't ready yet.
const PlanAssurances = loadComponent("plan-assurances", {"@/lib/billing/plans": catalogue});
const assurances = renderToStaticMarkup(React.createElement(PlanAssurances, {topupsOpen: false}));
const assuranceText = text(assurances);
assert.equal((assurances.match(/Fair use: 50 new sites per day, 1,000 live sites per workspace/g) || []).length, 1, "unlimited websites are paired with their limits exactly once");
assert.match(assurances, /Custom-domain connections are not available yet/);
for (const promise of ["Every request shows the most it can charge before it starts. Going past it needs your OK.",
  "A request that stops with an error, runs out of time before saving, or can’t be saved isn’t charged. A request that runs but doesn’t give you a usable change is charged for what it used.",
  "Unused plan credits stay usable for two months after their month ends, soonest-expiring first.",
  "Cancel in your Whop account before your next renewal and keep access to the end of the period you paid for.",
  "A payment is refundable in full while none of its credits have been used. Email admin@makeborne.com with your Whop payment reference. Your statutory rights still apply."]) assert.ok(assuranceText.includes(promise), promise);
assert.match(assuranceText, /One-time credit packs: planned for members after launch\./);
assert.match(assuranceText, /Yearly billing\./);
const notReady = assurances.slice(assurances.indexOf("billing-not-ready"), assurances.indexOf("billing-promises-terms"));
assert.ok(/print-ready/i.test(notReady) && !/print-ready/i.test(assurances.replace(notReady, "")), "print-ready appears only in the not-ready box");
assert.doesNotMatch(assurances, /editable exports|badge removal|lead score|CSV import|A receipt for every request/i, "unverified entitlements stay off the list");
assert.match(assurances, /mailto:admin@makeborne\.com\?subject=Makeborne%20for%20my%20agency/);
assert.doesNotMatch(text(renderToStaticMarkup(React.createElement(PlanAssurances, {topupsOpen: true, hasYearly: true}))), /One-time credit packs|Yearly billing\./, "shipped items leave the not-ready box");
// billing-plans renders the reassurance only for visitors without a plan, and packs only for members.
const BillingPlans = loadComponent("billing-plans", {
  "./creation-plans": {default: () => React.createElement("section", {id: "plans"})},
  "./plan-assurances": {default: () => React.createElement("section", {id: "promises"})},
  "./billing-topups": {default: () => React.createElement("section", {id: "topups"})},
});
const buyer = renderToStaticMarkup(React.createElement(BillingPlans, {isMember: false}));
assert.match(buyer, /id="promises"/); assert.doesNotMatch(buyer, /id="topups"/);
const member = renderToStaticMarkup(React.createElement(BillingPlans, {isMember: true}));
assert.doesNotMatch(member, /id="promises"/); assert.match(member, /id="topups"/);
const admin = renderToStaticMarkup(React.createElement(BillingPlans, {unlimitedCredits: true}));
assert.doesNotMatch(admin, /id="promises"|id="topups"/); assert.match(admin, /You’re covered\./);
const billingSource = fs.readFileSync(require.resolve("../../components/billing-plans.tsx"), "utf8");
assert.doesNotMatch(billingSource, /EffortControl|SupportPlan|support-checkout/, "coffee support and the effort slider are off /billing");
for (const summary of [view.unavailableBilling, {status: "ready", unit: "whole_customer_credits", available: "0", reserved: "0", used: "0", period: "October 2026", entries: [], history: {periodKey: "2026-10", total: 0, newer: 0, olderCursor: null}}]) {
  const billing = renderToStaticMarkup(React.createElement(BillingWorkspace, {summary, accountPrivileges: {isAdmin: true, unlimitedCredits: true}}));
  assert.doesNotMatch(billing, /generation (?:is still )?disabled|creation services are disabled/i);
  assert.match(billing, /Generation depends on current service availability and safety limits/);
  assert.match(billing, /href="\/studio"/);
  if (summary.status === "unavailable") assert.match(billing, /Reserved and used amounts are unavailable/);
  else assert.match(billing, /administrator allowance holds and charges no credits/, "a ready, empty allowance history explains why nothing is listed");
}
const returnOrder = "abcdefab-1234-4234-8234-123456789abc";
const returnView = props => renderToStaticMarkup(React.createElement(BillingWorkspace, {summary: view.unavailableBilling, ...props}));
assert.doesNotMatch(returnView({}), /data-topup-order/);
assert.match(returnView({topupOrderId: returnOrder}), new RegExp(`data-topup-order="${returnOrder}"`));
assert.match(returnView({topupOrderId: ""}), /data-topup-order=""/, "invalid return links must still reach the safe unavailable notice");
// Plans first for signed-out visitors; the default render keeps the dashboard order.
const position = (html, id) => html.indexOf(`id="${id}"`);
for (const trialCredits of [null, 50]) {
  const signedOut = renderToStaticMarkup(React.createElement(BillingWorkspace, {summary: view.unavailableBilling, signedIn: false, plansFirst: true, trialCredits,
    planChips: CREATION_PLANS.map(plan => ({id: plan.id, name: plan.name, price: catalogue.usd(plan.monthlyCents)})), pricePerCredit: {min: 6.4, max: 6.7}, costs: estimates.builderEstimates(0.03), measuredRun: estimates.MEASURED_RUN, taxNote: catalogue.TAX_NOTE.long}));
  assert.ok(position(signedOut, "plans") > 0 && position(signedOut, "plans") < position(signedOut, "billing-questions") && position(signedOut, "billing-questions") < position(signedOut, "costs"), "plans, then questions, then costs");
  assert.doesNotMatch(signedOut, /Sign in to see your balance|Support us|Buy us a coffee|coffee|id="credits"|What building costs<\/a>/i);
  assert.match(signedOut, /href="\/login\?next=%2Fbilling%23plans">Sign in</);
  assert.match(signedOut, /href="#plan-studio">Studio \$49</, "the phone chip row jumps to each card");
  assert.match(signedOut, /<footer id="support"/);
  assert.match(text(signedOut), /On a plan, a credit costs between 6\.4¢ and 6\.7¢\./);
  assert.match(text(signedOut), /a first website used 16–45 credits \(typically 32, 20 tests\), a first presentation 7–9 and a first book 9–14 \(2 tests each\)\./);
  assert.match(text(signedOut), /Any tax or checkout fee is shown by Whop before you pay\. You see your total/);
  assert.equal(/Trial credits do not expire/.test(signedOut), trialCredits === 50, "trial wording follows the free-tier switch");
  assert.equal(/How does the free tier work\?/.test(signedOut), trialCredits === 50);
  assert.equal(/Yearly billing isn’t available yet\./.test(signedOut), trialCredits === null);
}
const dashboard = renderToStaticMarkup(React.createElement(BillingWorkspace, {summary: view.unavailableBilling}));
assert.ok(position(dashboard, "credits") > 0 && position(dashboard, "credits") < position(dashboard, "plans"), "members keep the dashboard first");
assert.doesNotMatch(dashboard, /coffee|Support us/i);
const required = renderToStaticMarkup(React.createElement(BillingWorkspace, {summary: view.unavailableBilling, plansFirst: true, membershipRequired: true, savedBrief: true, subscriptions: []}));
assert.match(required, /Your brief is saved\./); assert.match(required, /After checkout we take you back to it\./);
assert.ok(position(required, "plans") < position(required, "credits"), "plan-less accounts see plans before their balance");
assert.match(renderToStaticMarkup(React.createElement(BillingWorkspace, {summary: view.unavailableBilling, plansFirst: true, membershipRequired: true, subscriptions: []})), /Creating starts with a plan\./);
const pastDue = renderToStaticMarkup(React.createElement(BillingWorkspace, {summary: view.unavailableBilling, subscriptions: [{name: "Studio", tier: "studio", status: "past_due", periodEnd: null, checkedAt: "2026-10-21T00:00:00Z", standardPriceCents: 4900, interval: "monthly"}]}));
assert.match(pastDue, /Your last payment didn’t go through\./); assert.match(pastDue, />Open Whop</);
const canceling = renderToStaticMarkup(React.createElement(BillingWorkspace, {summary: view.unavailableBilling, subscriptions: [{name: "Studio", tier: "studio", status: "canceling", periodEnd: "2026-11-20T00:00:00Z", checkedAt: "2026-10-21T00:00:00Z", standardPriceCents: 4900, interval: "monthly"}]}));
assert.match(canceling, /Your plan is set to end on Nov 20, 2026\./);
console.log("Pricing amounts, catalogue claims, rendered fair-use disclosures, administrator states and closed-checkout checks passed; no payment or API calls.");
