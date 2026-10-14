/* eslint-disable @typescript-eslint/no-require-imports -- Offline plan credit schedule and mapping checks. */
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
class RequestError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
function load(file, env, modules = {}) {
  const output = ts.transpileModule(fs.readFileSync(require.resolve(file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {}, process: { env }, Buffer, Date, URL, console, require: name => name === "server-only" ? {} : modules[name] ?? require(name) };
  vm.runInNewContext(output, context);
  return context.exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
let passed = 0;
const check = async (name, fn) => { await fn(); passed++; };

const env = { WHOP_PLAN_CREDIT_MAP: "", WHOP_ACCESS_PLAN_IDS: "" };
const plans = load("./plans.ts", env);
const schedule = load("./plan-schedule.ts", env, { "./plans": plans });
const config = load("./config.ts", env, { "./plan-schedule": schedule });
const planCredits = load("./plan-credits.ts", env, { "./config": config, "./plans": plans, "./plan-schedule": schedule });
const { CREATION_CATALOG, SUPPORT } = config;

(async () => {
  await check("Whop period fields: date-time and Unix seconds both parse; anything else is no period", () => {
    const whop = load("./whop.ts", env, { "@/lib/server/http": { RequestError }, "./config": config });
    assert.equal(whop.whopTime("2027-01-31T10:00:00.000Z"), "2027-01-31T10:00:00.000Z");
    assert.equal(whop.whopTime("2027-01-31T10:00:00Z"), "2027-01-31T10:00:00.000Z");
    assert.equal(whop.whopTime(1801648800), "2027-02-03T10:00:00.000Z");
    assert.equal(whop.whopTime("1801648800"), "2027-02-03T10:00:00.000Z");
    for (const bad of ["", "soon", 0, -5, NaN, {}]) assert.equal(whop.whopTime(bad), null, String(bad));
    const parsed = whop.membershipSchema.parse({ id: "mem_a", status: "active", company: { id: "biz_a" }, plan: { id: "plan_a" }, user: null,
      checkout_configuration_id: null, renewal_period_start: 1801648800, renewal_period_end: "2028-02-04T08:00:00Z" });
    assert.deepEqual([parsed.renewal_period_start, parsed.renewal_period_end], ["2027-02-03T10:00:00.000Z", "2028-02-04T08:00:00.000Z"]);
    assert.equal(whop.membershipSchema.parse({ id: "mem_a", status: "active", company: { id: "biz_a" }, plan: { id: "plan_a" }, user: null,
      checkout_configuration_id: null, renewal_period_end: null }).renewal_period_start, null, "missing start stays null (never derived)");
  });

  await check("every configured plan ID resolves; overrides add or change plans; unknown and malformed IDs fail closed", () => {
    const parsed = schedule.parsePlanCreditRules(CREATION_CATALOG,
      "plan_Yearly1:create:yearly, plan_Studio2:studio, plan_Scale3:scale:monthly, plan_qs8XNbKQsowC6:studio:yearly, bogus, plan_x:enterprise, plan_y:create:weekly, plan_z:create:yearly:extra, " + SUPPORT.planId + ":create",
      [SUPPORT.planId]);
    const rules = Object.fromEntries([...parsed.rules].map(([id, rule]) => [id, `${rule.tier}/${rule.interval}`]));
    assert.deepEqual(rules, {
      [CREATION_CATALOG.create]: "studio/yearly", [CREATION_CATALOG.studio]: "studio/monthly", [CREATION_CATALOG.scale]: "scale/monthly",
      plan_Yearly1: "create/yearly", plan_Studio2: "studio/monthly", plan_Scale3: "scale/monthly",
    });
    assert.deepEqual(plain(parsed.issues).map(issue => issue.value), ["bogus", "plan_x:enterprise", "plan_y:create:weekly", "plan_z:create:yearly:extra", SUPPORT.planId + ":create"]);
    const access = schedule.parseAccessPlanIds(`${CREATION_CATALOG.create}, plan_Yearly1, plan_unknown, ${SUPPORT.planId}, plan_Yearly1, not-a-plan`, parsed.rules, [SUPPORT.planId]);
    assert.deepEqual(plain(access.ids), [CREATION_CATALOG.create, "plan_Yearly1"]);
    assert.deepEqual(plain(access.issues).map(issue => issue.value), ["plan_unknown", SUPPORT.planId, "not-a-plan"]);
  });

  await check("billing config grants access to override plans and reports misconfiguration; the support plan never grants", () => {
    env.WHOP_PLAN_CREDIT_MAP = "plan_Annual9:studio:yearly";
    env.WHOP_ACCESS_PLAN_IDS = `${CREATION_CATALOG.create},plan_Annual9,plan_Ghost,${SUPPORT.planId}`;
    const billing = config.billingConfig();
    assert.deepEqual(plain(billing.accessPlanIds), [CREATION_CATALOG.create, "plan_Annual9"]);
    assert.deepEqual(plain(billing.planConfigIssues).map(issue => issue.value), ["plan_Ghost", SUPPORT.planId]);
    const rule = plain(planCredits.creditRuleFor("plan_Annual9"));
    assert.deepEqual(rule, { planId: "plan_Annual9", tier: "studio", interval: "yearly", monthlyCredits: 850 });
    assert.equal(planCredits.creditRuleFor(SUPPORT.planId), null);
    assert.equal(planCredits.creditRuleFor("plan_Ghost"), null);
    assert.equal(planCredits.creditPlanFor("scale").monthlyCredits, 2200);
    env.WHOP_PLAN_CREDIT_MAP = ""; env.WHOP_ACCESS_PLAN_IDS = "";
  });

  // ---- The app only records verified observations; the database decides what is owed.
  function loadCredits(rpc) {
    return load("../credits/server.ts", env, {
      "@/lib/account/privileges": { getAccountPrivileges: async () => ({ isAdmin: false, unlimitedCredits: false }) },
      "@/lib/billing/database": { billingDatabase: () => ({ rpc }) }, "@/lib/billing/plan-credits": planCredits, "@/lib/server/http": { RequestError },
    });
  }
  const user = "11111111-1111-4111-8111-111111111111";

  await check("observations carry the plan's own tier, interval and allowance plus Whop's period, unchanged", async () => {
    env.WHOP_PLAN_CREDIT_MAP = "plan_Annual9:studio:yearly";
    const calls = [];
    const credits = loadCredits(async (name, args) => { calls.push([name, plain(args)]); return { data: { outcome: "recorded", owed: 1, granted: 1 }, error: null }; });
    const result = await credits.recordPlanObservation(user, { membershipId: "mem_annual", planId: "plan_Annual9", status: "active", paid: true,
      periodStart: "2027-01-31T10:00:00.000Z", periodEnd: "2028-01-31T10:00:00.000Z", source: "webhook" });
    assert.deepEqual(plain(result), { outcome: "recorded", granted: 1 });
    assert.deepEqual(calls, [["makeborne_record_plan_observation", { p_user: user, p_membership: "mem_annual", p_whop_plan_id: "plan_Annual9", p_tier: "studio",
      p_interval: "yearly", p_monthly_credits: 850, p_status: "active", p_paid: true, p_period_start: "2027-01-31T10:00:00.000Z", p_period_end: "2028-01-31T10:00:00.000Z", p_source: "webhook" }]]);
    env.WHOP_PLAN_CREDIT_MAP = "";
  });

  await check("unknown plans and invalid memberships are refused before any database call", async () => {
    let called = 0;
    const credits = loadCredits(async () => { called++; return { data: {}, error: null }; });
    const base = { status: "active", paid: true, periodStart: null, periodEnd: "2027-03-31T00:00:00.000Z", source: "webhook" };
    await assert.rejects(credits.recordPlanObservation(user, { ...base, membershipId: "mem_x", planId: "plan_Ghost" }), error => error.code === "UNKNOWN_CREDIT_PLAN");
    await assert.rejects(credits.recordPlanObservation(user, { ...base, membershipId: "mem_x", planId: SUPPORT.planId }), error => error.code === "UNKNOWN_CREDIT_PLAN");
    await assert.rejects(credits.recordPlanObservation(user, { ...base, membershipId: "bad", planId: CREATION_CATALOG.create }), error => error.code === "INVALID_MEMBERSHIP");
    assert.equal(called, 0);
  });

  await check("cancellation: a canceling membership keeps its paid months; cancelled or expired memberships stop granting", () => {
    env.WHOP_API_KEY = "k"; env.WHOP_COMPANY_ID = SUPPORT.companyId; env.WHOP_ACCESS_PLAN_IDS = CREATION_CATALOG.create;
    const whop = load("./whop.ts", env, { "@/lib/server/http": { RequestError }, "./config": config });
    const membership = status => ({ id: "mem_c", status, company: { id: SUPPORT.companyId }, plan: { id: CREATION_CATALOG.create }, user: { id: "user_c" },
      checkout_configuration_id: "ch_c", renewal_period_end: new Date(Date.now() + 10 * 86_400_000).toISOString() });
    assert.equal(whop.activeMembership(membership("canceling")), true, "paid until the period ends");
    for (const status of ["canceled", "expired", "past_due", "unresolved"]) assert.equal(whop.activeMembership(membership(status)), false, status);
    assert.equal(whop.activeMembership({ ...membership("active"), renewal_period_end: new Date(Date.now() - 1000).toISOString() }), false, "ended period");
    env.WHOP_ACCESS_PLAN_IDS = "";
  });

  console.log(`${passed} plan credit checks passed (Whop period parsing, plan mapping, observation wiring, cancellation). Allocation history is checked in supabase/check-plan-credit-allocations.sql. No live services called.`);
})().catch(error => { console.error(error); process.exit(1); });
