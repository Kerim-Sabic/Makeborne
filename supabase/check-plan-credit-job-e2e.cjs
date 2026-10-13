/* eslint-disable @typescript-eslint/no-require-imports -- End-to-end job check. ISOLATED DATABASE ONLY. */
// Runs the real reconciliation job and the real server recording functions
// against the real SQL functions in a disposable database; only Whop is mocked.
// It commits fixtures, so it refuses to run against `postgres` or any database
// holding plan or credit data. Cleanup deletes its fixtures.
// Run: node supabase/check-plan-credit-job-e2e.cjs postgresql://postgres:postgres@127.0.0.1:55322/makeborne_crm_isolated
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { Client } = require("pg");
const url = process.argv[2];
if (!url || /\/postgres(\?|$)/.test(url)) { console.error("Refusing to run: pass the URL of a disposable database (not /postgres)."); process.exit(2); }

class RequestError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
const src = path.join(__dirname, "..", "src", "lib");
function load(file, env, modules = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.join(src, file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {}, process: { env }, Buffer, Date, URL, URLSearchParams, AbortSignal, console, setTimeout, require: name => name === "server-only" ? {} : modules[name] ?? require(name) };
  vm.runInNewContext(output, context);
  return context.exports;
}

(async () => {
  const db = new Client({ connectionString: url });
  await db.connect();
  const { rows: [guard] } = await db.query(`select current_database() as name,
    (select count(*) from makeborne_private.plan_periods)::int as periods, (select count(*) from public.credit_ledger)::int as ledger,
    (select count(*) from makeborne_private.billing_job_runs)::int as runs`);
  if (guard.name === "postgres" || guard.periods || guard.ledger || guard.runs) { console.error(`Refusing to run in ${guard.name}: it holds data.`); process.exit(2); }

  // PostgREST-style rpc over pg: named arguments, set-returning functions as rows.
  const rpc = async (name, args = {}) => {
    const keys = Object.keys(args);
    const call = `public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(", ")})`;
    try {
      const values = keys.map(key => args[key] !== null && typeof args[key] === "object" ? JSON.stringify(args[key]) : args[key]);
      if (name === "makeborne_billing_job_due_memberships") return { data: (await db.query(`select * from ${call}`, values)).rows, error: null };
      return { data: (await db.query(`select ${call} as result`, values)).rows[0].result, error: null };
    } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
  };

  const env = { WHOP_PLAN_CREDIT_MAP: "plan_e2eAnnual:studio:yearly", WHOP_ACCESS_PLAN_IDS: "plan_e2eAnnual", WHOP_COMPANY_ID: "biz_CV9cZg1zFX3h7f" };
  const plans = load("billing/plans.ts", env);
  const schedule = load("billing/plan-schedule.ts", env, { "./plans": plans });
  const config = load("billing/config.ts", env, { "./plan-schedule": schedule });
  const planCredits = load("billing/plan-credits.ts", env, { "./config": config, "./plans": plans, "./plan-schedule": schedule });
  const credits = load("credits/server.ts", env, { "@/lib/account/privileges": { getAccountPrivileges: async () => ({ isAdmin: false, unlimitedCredits: false }) },
    "@/lib/billing/database": { billingDatabase: () => ({ rpc }) }, "@/lib/billing/plan-credits": planCredits, "@/lib/server/http": { RequestError } });
  const job = load("billing/reconcile-job.ts", env);

  const user = "22222222-2222-4222-8222-222222222222";
  const start = new Date(Date.now() - 100 * 86_400_000); start.setUTCMilliseconds(0);
  const end = new Date(start); end.setUTCFullYear(end.getUTCFullYear() + 1);
  const membership = { id: "mem_e2e1", status: "active", company: { id: env.WHOP_COMPANY_ID }, plan: { id: "plan_e2eAnnual" }, user: { id: "user_e2e1" },
    checkout_configuration_id: "ch_e2e1", renewal_period_start: start.toISOString(), renewal_period_end: end.toISOString() };
  const payments = { payments: [{ id: "pay_e2eCreate", planId: "plan_e2eAnnual", billingReason: "subscription_create", paidAt: new Date(start.getTime() + 30_000).toISOString(), refunded: false }], skipped: 0, complete: true };
  let fetches = 0, paymentReads = 0;
  const deps = {
    rpc, companyId: env.WHOP_COMPANY_ID,
    updateMembership: async (id, userId, fields) => { await db.query(`update public.billing_memberships set status=$1, verified_until=$2, period_end=$3, checked_at=$4 where membership_id=$5 and user_id=$6`,
      [fields.status, fields.verified_until, fields.period_end, fields.checked_at, id, userId]); return { error: null }; },
    fetchMembership: async () => { fetches++; return membership; },
    listPayments: async () => { paymentReads++; return payments; },
    recordObservation: (userId, observation) => credits.recordPlanObservation(userId, observation),
    recordPayment: (userId, id, payment) => credits.recordPlanPayment(userId, id, payment),
    isActive: m => ["active", "canceling"].includes(m.status) && Date.parse(m.renewal_period_end) > Date.now(),
    hasCreditRule: planId => planCredits.creditRuleFor(planId) !== null,
  };
  const ledger = async () => (await db.query(`select count(*)::int as grants, coalesce(sum(delta),0)::int as total from public.credit_ledger where user_id=$1 and kind='plan_grant'`, [user])).rows[0];

  try {
    await db.query(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())`, [user, `${user}@plan-e2e.example.invalid`]);
    await db.query(`insert into public.billing_checkouts(request_id,user_id,plan_id,checkout_id,return_path,status) values(gen_random_uuid(),$1,'plan_e2eAnnual','ch_e2e1','/studio','ready')`, [user]);
    await db.query(`insert into public.billing_memberships(membership_id,user_id,checkout_id,whop_user_id,plan_id,status,period_end,verified_until) values('mem_e2e1',$1,'ch_e2e1','user_e2e1','plan_e2eAnnual','active',$2,now())`, [user, end.toISOString()]);

    // Run 1: first observation ever (missed webhooks). Month 4 has evidence; months 1-3 become open issues.
    let result = await job.runPlanCreditReconcileJob(deps, { staleSeconds: 60 });
    assert.equal(result.status, "succeeded", JSON.stringify(result));
    assert.deepEqual(await ledger(), { grants: 1, total: 850 });
    assert.equal((await db.query(`select count(*)::int as n from makeborne_private.plan_credit_issues where membership_id='mem_e2e1' and resolved_at is null`)).rows[0].n, 3);
    assert.equal(paymentReads, 0);

    // A day later: the job sees open issues, reads payments, and the paid initial payment resolves months 1-3.
    await db.query(`update makeborne_private.plan_observations set recorded_at = recorded_at - interval '1 day' where membership_id='mem_e2e1'`);
    result = await job.runPlanCreditReconcileJob(deps, { staleSeconds: 60 });
    assert.equal(result.status, "succeeded", JSON.stringify(result));
    assert.equal(paymentReads, 1);
    assert.deepEqual(await ledger(), { grants: 4, total: 4 * 850 });
    assert.equal((await db.query(`select count(*)::int as n from makeborne_private.plan_credit_issues where membership_id='mem_e2e1' and resolved_at is null`)).rows[0].n, 0);
    // Two-month rollover: month 1 is past its rollover and lapsed; months 2-3 are still inside it and month 4 is current.
    // The soonest expiry is month 2's end plus two months, which is the start plus 4 months.
    const wallet = (await db.query(`select public.makeborne_credit_wallet($1) as w`, [user])).rows[0].w;
    // Postgres month arithmetic (clamped at month end), as the allocation schedule uses.
    const monthFourEnd = (await db.query(`select ($1::timestamptz at time zone 'UTC' + interval '4 months') at time zone 'UTC' as at`, [start.toISOString()])).rows[0].at;
    assert.equal(wallet.available, 3 * 850);
    assert.equal(Date.parse(wallet.nextExpiry.at), monthFourEnd.getTime());
    assert.equal((await db.query(`select count(*)::int as n from makeborne_private.credit_lots where user_id=$1 and source='plan' and lapsed=amount`, [user])).rows[0].n, 1);
    assert.equal(result.stats.expiryWallets >= 0, true);

    // Run 3 right away: nothing stale, nothing granted twice.
    const before = fetches;
    result = await job.runPlanCreditReconcileJob(deps, { staleSeconds: 60 });
    assert.equal(result.status, "succeeded");
    assert.equal(fetches, before);
    assert.deepEqual(await ledger(), { grants: 4, total: 4 * 850 });

    // Overlap: a live lease held elsewhere makes the job skip.
    const held = await rpc("makeborne_billing_job_begin", { p_job: "plan_credits", p_lease_seconds: 300 });
    result = await job.runPlanCreditReconcileJob(deps, { staleSeconds: 60 });
    assert.equal(result.status, "skipped");
    await rpc("makeborne_billing_job_finish", { p_run: held.data, p_status: "succeeded", p_stats: {}, p_error: null });

    const health = (await rpc("makeborne_billing_job_health")).data;
    assert.equal(health.overdue, false);
    assert.equal(health.openIssues, 0);
    const runs = (await db.query(`select status, count(*)::int as n from makeborne_private.billing_job_runs group by status order by status`)).rows;
    assert.deepEqual(runs, [{ status: "succeeded", n: 4 }]);
    console.log("PASS end-to-end: real job + real SQL (mocked Whop): first run opens 3 issues and grants month 4; next run reads payments and grants months 1-3 (month 1 past its two-month rollover and lapsed; months 2-4 spendable); idle run grants nothing; overlapping run skipped; health ok");
  } finally {
    await db.query(`delete from makeborne_private.billing_job_runs`);
    await db.query(`delete from public.billing_memberships where membership_id='mem_e2e1'`);
    await db.query(`delete from auth.users where id=$1`, [user]);
    await db.end();
  }
})().catch(error => { console.error(error); process.exit(1); });
