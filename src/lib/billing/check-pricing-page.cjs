/* eslint-disable @typescript-eslint/no-require-imports -- Offline /billing pricing-page checks: outcome math, no literal figures in JSX, approved entitlements, branded titles. */
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const root = path.join(__dirname, "..", "..", "..");
const plans = require("./plans.ts");
const { builderEstimates, MEASURED_RUN } = require("../builder/credit-estimate.ts");
let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }

check("outcome ranges round down from the most expensive to the typical measured build", () => {
  const at3 = builderEstimates(0.03);
  const expected = { create: [[6, 9], [33, 37], [21, 25]], studio: [[16, 23], [83, 93], [53, 62]], scale: [[34, 48], [172, 193], [110, 129]] };
  for (const plan of plans.CREATION_PLANS) {
    const outcomes = plans.planOutcomes(plan.monthlyCredits, at3);
    assert.deepEqual(outcomes.map(item => item.kind), ["website", "presentation", "book"]);
    assert.deepEqual(outcomes.map(item => [item.low, item.typical]), expected[plan.id], plan.id);
    assert.deepEqual(outcomes.map(item => item.few), [false, true, true], "n<5 is marked as a rough guide");
    assert.deepEqual(outcomes.map(item => item.samples), [20, 2, 2]);
  }
  assert.equal(plans.planOutcomes(300, null), null, "no measurements, no figures");
  assert.equal(plans.FEW_SAMPLES, 5);
});
check("default-effort floors, customer price per credit and credit multiples come from the catalogue", () => {
  assert.deepEqual(plans.CREATION_PLANS.map(plan => plans.mediumFloor(plan.monthlyCredits, 50)), [6, 15, 31]);
  assert.equal(plans.mediumFloor(300, null), null);
  assert.deepEqual(plans.CREATION_PLANS.map(plan => plans.pricePerCreditCents(plan.id)), [6.7, 6.5, 6.4]);
  assert.deepEqual(plans.CREATION_PLANS.map(plan => plans.creditMultiple(plan.id)), [null, "2.5×", "over 5×"]);
  assert.equal(plans.matchPlanTier("Makeborne Studio"), "studio");
  assert.equal(plans.matchPlanTier("makeborne scale (monthly)"), "scale");
  for (const name of ["Studios", "Create or Scale", "", null, "Coffee"]) assert.equal(plans.matchPlanTier(name), null, String(name));
  assert.equal(MEASURED_RUN.label, "18 October 2026 test runs");
  assert.equal(MEASURED_RUN.id, "golden-20261018");
});
check("only approved, verified entitlements and true promises are listed", () => {
  assert.deepEqual([...plans.PLAN_INCLUDES], [
    "Websites, books and presentations",
    "Unlimited websites while your plan is active. Fair use: 50 new sites per day, 1,000 live sites per workspace.",
    "Publishing and hosting for your sites at no credit cost while your plan is active",
    "Client tracking and follow-ups in the built-in CRM, plus client reviews",
    "Editing by hand, previews, versions and source download at no credit cost",
    "Spending controls: a low-balance alert and a monthly usage limit",
    "Usage history showing the project and action behind each charge",
  ]);
  assert.equal(plans.PLAN_INCLUDES_FOOTNOTE, "Custom-domain connections are not available yet.");
  assert.deepEqual(plans.PLAN_PROMISES.map(item => item.title), ["Limit shown first", "Errors and unsaved work cost nothing", "Credits carry over", "Cancel any time", "Refundable until used"]);
  assert.match(plans.PLAN_PROMISES.at(-1).body, /Your statutory rights still apply\.$/);
  assert.deepEqual(plans.notReadyYet({ hasYearly: false, topupsOpen: false }).map(item => item.id), ["domains", "print", "yearly", "switching", "packs"]);
  assert.deepEqual(plans.notReadyYet({ hasYearly: true, topupsOpen: true }).map(item => item.id), ["domains", "print", "switching"]);
  assert.equal(plans.RECOMMENDED_BADGE, "Best for client work");
  assert.doesNotMatch(JSON.stringify(plans), /Most popular/);
  for (const plan of plans.CREATION_PLANS) assert.equal(Object.hasOwn(plan, "features"), false, "no per-card bullets that imply tier exclusives");
  assert.deepEqual(plans.TAX_NOTE, { short: "Tax and any checkout fee shown before you pay.", inline: " plus any tax or checkout fee Whop shows", long: "Any tax or checkout fee is shown by Whop before you pay." });
});
check("no outcome count, floor or AI cost per credit is typed into the pricing JSX", () => {
  const banned = [/\d+\s*[–-]\s*\d+\s*(first builds|\(\d+ tests?\))/, /\bat least \d+ requests?\b/i, /\$0\.0\d/, /cost per credit/i, /\b\d+(\.\d+)?\s*¢/];
  for (const file of ["src/components/creation-plans.tsx", "src/components/plan-assurances.tsx", "src/components/billing-workspace.tsx"]) {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const texts = [];
    (function visit(node) {
      if (ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) texts.push(node.text);
      else if (ts.isTemplateExpression(node)) texts.push(node.head.text, ...node.templateSpans.map(span => span.literal.text));
      ts.forEachChild(node, visit);
    })(source);
    for (const text of texts) for (const pattern of banned) assert.doesNotMatch(text, pattern, `${file}: literal figure "${text.trim().slice(0, 80)}"`);
    const imports = source.statements.filter(ts.isImportDeclaration).filter(item => !item.importClause?.isTypeOnly).map(item => item.moduleSpecifier.text);
    if (file.endsWith("plan-assurances.tsx")) assert.deepEqual(imports.sort(), ["@/lib/billing/plans", "lucide-react"], "plan-assurances loads in the check-plans VM");
    if (file.endsWith("billing-workspace.tsx")) assert.ok(!imports.includes("@/lib/billing/plans"), "billing-workspace takes formatted prices as props");
  }
  const ui = fs.readFileSync(path.join(root, "src/components/creation-plans.tsx"), "utf8");
  assert.match(ui, /className="founding-cta" disabled=/, "the CTA class stays exactly founding-cta before disabled");
  assert.doesNotMatch(ui, /useSearchParams|priceCents:/);
  assert.match(ui, /body: JSON\.stringify\(\{ \.\.\.choice, withdrawalConsent: WITHDRAWAL_CONSENT_VERSION \}\)/, "the checkout POST sends only the pending selection and the ticked consent version, never a price");
});
check("the pricing page carries plans first and keeps the support anchor, SUPPORT and its route", () => {
  const page = fs.readFileSync(path.join(root, "src/app/billing/page.tsx"), "utf8");
  assert.match(page, /publicPageMetadata\("\/billing", "Pricing: plans & credits",/);
  assert.match(page, /plansFirst=\{plansFirst\}/);
  assert.match(fs.readFileSync(path.join(root, "src/components/billing-workspace.tsx"), "utf8"), /plansFirst = false/, "the dashboard order stays the default");
  assert.match(fs.readFileSync(path.join(root, "src/lib/billing/config.ts"), "utf8"), /export const SUPPORT\b/);
  assert.ok(fs.existsSync(path.join(root, "src/app/api/billing/support-checkout/route.ts")));
  assert.match(fs.readFileSync(path.join(root, "next.config.ts"), "utf8"), /\{ source: "\/pricing", destination: "\/billing", permanent: true \}/);
  const home = fs.readFileSync(path.join(root, "src/components/creation-home.tsx"), "utf8");
  assert.equal((home.match(/<Link href="\/billing">Pricing<\/Link>/g) || []).length, 2, "desktop and mobile navigation link to pricing");
});
check("titles carry the brand once: in the tab via the template, absolutely in social previews", () => {
  const { publicPageMetadata, brandedTitle } = require("../site-metadata.ts");
  for (const [route, title] of [["/billing", "Pricing: plans & credits"], ["/privacy", "Privacy"], ["/privacy", "Privacy | Makeborne"]]) {
    const metadata = publicPageMetadata(route, title, "A description long enough for a test.");
    assert.equal(metadata.title, title.replace(" | Makeborne", ""));
    assert.equal(metadata.openGraph.title, `${title.replace(" | Makeborne", "")} · Makeborne`);
    assert.equal(metadata.twitter.title, metadata.openGraph.title);
    assert.doesNotMatch(`${metadata.title} · Makeborne`, /Makeborne.*Makeborne/, "the root template adds the brand once");
  }
  assert.equal(brandedTitle("Makeborne Help Center: guides and how-tos").social, "Makeborne Help Center: guides and how-tos", "titles that already name the brand stay as they are");
  for (const file of ["src/app/billing/page.tsx", "src/app/privacy/page.tsx", "src/app/billing/terms/page.tsx"])
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), "utf8"), /publicPageMetadata\([^)]*\| Makeborne/, `${file} title doubles the brand`);
});
console.log(`${passed} pricing page checks passed; no network, payment or account calls.`);
