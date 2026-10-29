/* eslint-disable @typescript-eslint/no-require-imports -- Offline reconciliation job checks with mocked Whop responses. */
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
class RequestError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
function load(file, env, modules = {}, extra = {}) {
  const output = ts.transpileModule(fs.readFileSync(require.resolve(file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {}, process: { env }, Buffer, Date, URL, URLSearchParams, AbortSignal, Response, Headers, console, setTimeout,
    require: name => name === "server-only" ? {} : modules[name] ?? require(name), ...extra };
  vm.runInNewContext(output, context);
  return context.exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
let passed = 0;
const check = async (name, fn) => { await fn(); passed++; };
const company = "biz_CV9cZg1zFX3h7f";
const env = { WHOP_API_KEY: "k", WHOP_COMPANY_ID: company, WHOP_ACCESS_PLAN_IDS: "", WHOP_PLAN_CREDIT_MAP: "" };
const plans = load("./plans.ts", env);
const schedule = load("./plan-schedule.ts", env, { "./plans": plans });
const config = load("./config.ts", env, { "./plan-schedule": schedule });
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
function whopWith(fetchImpl) { return load("./whop.ts", env, { "@/lib/server/http": { RequestError }, "./config": config }, { fetch: fetchImpl }); }

(async () => {
  await check("Both request paths pin the validated API schema", async () => {
    const versions = [];
    const whop = whopWith(async (_url, options) => {
      versions.push(options.headers["Api-Version-Date"]);
      return json(200, {});
    });
    await whop.whopRequest("/memberships/mem_fixture");
    await whop.whopGet("/memberships/mem_fixture", { attempts: 1 });
    assert.deepEqual(versions, ["2025-01-01", "2025-01-01"]);
  });
  await check("API base: production by default, Whop sandbox allowed, invalid explicit hosts fail closed", () => {
    const whop = whopWith(async () => json(200, {}));
    assert.equal(whop.whopApiBase(undefined), "https://api.whop.com/api/v1");
    assert.equal(whop.whopApiBase("https://sandbox-api.whop.com/api/v1"), "https://sandbox-api.whop.com/api/v1");
    assert.throws(() => whop.whopApiBase("https://evil.example/api/v1"), e => e.code === "BILLING_ENVIRONMENT_INVALID");
    assert.throws(() => whop.whopApiBase("https://sandbox-api.whop.com/api/v1/"), e => e.code === "BILLING_ENVIRONMENT_INVALID");
  });

  await check("retry/backoff: 429 honours Retry-After, 5xx and network errors back off, 404 never retries, retries are bounded", async () => {
    const sleeps = [];
    const sleep = async ms => { sleeps.push(ms); };
    let calls = 0;
    let whop = whopWith(async () => { calls++; return calls === 1 ? json(429, {}, { "retry-after": "2" }) : calls === 2 ? json(503, {}) : json(200, { ok: true }); });
    assert.deepEqual(plain(await whop.whopGet("/x", { sleep, baseDelayMs: 100 })), { ok: true });
    assert.equal(calls, 3);
    assert.equal(sleeps[0], 2000, "Retry-After seconds");
    assert.ok(sleeps[1] >= 200 && sleeps[1] < 300, `exponential second delay, got ${sleeps[1]}`);
    calls = 0;
    whop = whopWith(async () => { calls++; return json(404, {}); });
    await assert.rejects(whop.whopGet("/x", { sleep }), error => error.code === "WHOP_REQUEST_REJECTED");
    assert.equal(calls, 1, "4xx is not retried");
    calls = 0;
    whop = whopWith(async () => { calls++; throw new TypeError("network down"); });
    await assert.rejects(whop.whopGet("/x", { sleep, attempts: 3 }), error => error.code === "PAYMENT_PROVIDER_UNAVAILABLE");
    assert.equal(calls, 3, "bounded attempts");
    const capped = [];
    whop = whopWith(async () => json(429, {}, { "retry-after": "999" }));
    await assert.rejects(whop.whopGet("/x", { sleep: async ms => { capped.push(ms); }, attempts: 2, maxDelayMs: 30000 }));
    assert.equal(capped[0], 30000, "delay capped");
  });

  await check("payments: paginated, filtered to this membership and merchant, refunds detected, unpaid ignored, page limit reported", async () => {
    const pages = {
      "": { data: [
        { id: "pay_a", status: "paid", billing_reason: "subscription_create", paid_at: "2027-01-31T10:00:30Z", plan: { id: "plan_x" }, membership: { id: "mem_1" }, company: { id: company } },
        { id: "pay_other", status: "paid", billing_reason: "subscription_cycle", paid_at: "2027-02-01T00:00:00Z", plan: { id: "plan_x" }, membership: { id: "mem_10" } },
        { id: "pay_foreign", status: "paid", billing_reason: "subscription_cycle", paid_at: "2027-02-01T00:00:00Z", plan: { id: "plan_x" }, membership: { id: "mem_1" }, company: { id: "biz_other" } },
        { id: "pay_open", status: "open", billing_reason: "subscription_cycle", paid_at: null, plan: { id: "plan_x" }, membership: { id: "mem_1" } },
      ], page_info: { end_cursor: "c1", has_next_page: true } },
      c1: { data: [
        { id: "pay_b", status: "paid", billing_reason: "subscription_cycle", paid_at: 1801648800, refunded_at: "2027-03-01T00:00:00Z", plan: { id: "plan_x" }, membership: { id: "mem_1" } },
        // Shape observed from the real Whop sandbox after a full refund (2026-10-12, pay_JVp4TjClPsS0Hs):
        // status stays "paid"; only substatus and refunded_amount change, and refunded_at is not set.
        { id: "pay_c", status: "paid", substatus: "refunded", refunded_amount: 29, refunded_at: null, billing_reason: "subscription_cycle", paid_at: "2027-03-03T10:00:00Z", plan: { id: "plan_x" }, membership: { id: "mem_1" } },
        { garbage: true },
      ], page_info: { end_cursor: null, has_next_page: false } },
    };
    const urls = [];
    const whop = whopWith(async url => { urls.push(url); const after = new URL(url).searchParams.get("after") ?? ""; return json(200, pages[after]); });
    const result = plain(await whop.listMembershipPayments("mem_1", { sleep: async () => {} }));
    assert.deepEqual(result.payments.map(p => [p.id, p.billingReason, p.refunded]), [["pay_a", "subscription_create", false], ["pay_b", "subscription_cycle", true], ["pay_c", "subscription_cycle", true]]);
    assert.equal(result.payments[1].paidAt, "2027-02-03T10:00:00.000Z");
    assert.equal(result.skipped, 3);
    assert.equal(result.complete, true);
    assert.equal(new URL(urls[0]).searchParams.get("query"), "mem_1");
    assert.equal(new URL(urls[0]).searchParams.get("company_id"), company, "Merchant-scoped keys require explicit company scope");
    const endless = whopWith(async () => json(200, { data: [], page_info: { end_cursor: "n", has_next_page: true } }));
    assert.equal(plain(await endless.listMembershipPayments("mem_1", { maxPages: 3, sleep: async () => {} })).complete, false, "bounded pages");
  });

  await check("cron auth: exact bearer secret only; missing or short secrets never authorize", () => {
    const auth = load("../server/cron-auth.ts", env);
    const secret = "s".repeat(40);
    const request = value => new Request("https://x/api/cron/billing-reconcile", { headers: value ? { authorization: value } : {} });
    assert.equal(auth.authorizedCron(request(`Bearer ${secret}`), secret), true);
    assert.equal(auth.authorizedCron(request(`Bearer ${secret}x`), secret), false);
    assert.equal(auth.authorizedCron(request(null), secret), false);
    assert.equal(auth.authorizedCron(request("Bearer short"), "short"), false, "secret under 32 characters");
    assert.equal(auth.authorizedCron(request("Bearer "), undefined), false);
  });

  // ---- The job, with a fake database and fake Whop.
  const job = load("./reconcile-job.ts", env);
  function harness({ due = [], memberships = {}, payments = {}, leaseHeld = false, failReconcile = false, failExpiry = false, clockStep = 0 } = {}) {
    const calls = { rpc: [], observations: [], paymentsRecorded: [], updates: [], finish: null, fetched: [] };
    let clock = 1_000_000;
    const deps = {
      companyId: company,
      now: () => (clock += clockStep),
      rpc: async (name, args) => {
        calls.rpc.push(name);
        if (name === "makeborne_billing_job_begin") return { data: leaseHeld ? null : 7, error: null };
        if (name === "makeborne_billing_job_due_memberships") return { data: due, error: null };
        if (name === "makeborne_reconcile_plan_credits") return failReconcile ? { data: null, error: { code: "XX000" } } : { data: { memberships: 4, granted: 2 }, error: null };
        if (name === "makeborne_credit_expire_due") return failExpiry ? { data: null, error: { code: "XX000" } } : { data: { wallets: 3 }, error: null };
        if (name === "makeborne_provider_calls_expire") return { data: { expired: 2 }, error: null };
        if (name === "makeborne_billing_job_finish") { calls.finish = plain(args); return { data: true, error: null }; }
        return { data: true, error: null };
      },
      updateMembership: async (id, user, fields) => { calls.updates.push([id, fields.status]); return { error: null }; },
      fetchMembership: async id => { calls.fetched.push(id); const m = memberships[id]; if (!m) throw Object.assign(new Error("down"), { code: "PAYMENT_PROVIDER_UNAVAILABLE" }); return m; },
      listPayments: async id => payments[id] ?? { payments: [], skipped: 0, complete: true },
      recordObservation: async (user, observation) => { calls.observations.push(plain(observation)); return { outcome: "recorded", granted: 1 }; },
      recordPayment: async (user, id, payment) => { calls.paymentsRecorded.push(payment.id); return { outcome: "evidence", granted: 2 }; },
      isActive: m => ["active", "canceling"].includes(m.status),
      hasCreditRule: planId => planId !== "plan_unknown",
    };
    return { deps, calls };
  }
  const membership = (id, extra = {}) => ({ id, status: "active", company: { id: company }, plan: { id: "plan_x" }, user: { id: `user_${id.slice(4)}` },
    checkout_configuration_id: `ch_${id.slice(4)}`, renewal_period_start: "2027-01-31T10:00:00.000Z", renewal_period_end: "2099-01-31T10:00:00.000Z", ...extra });
  const due = id => ({ membership_id: id, user_id: "11111111-1111-4111-8111-111111111111", plan_id: "plan_x", checkout_id: `ch_${id.slice(4)}`, whop_user_id: `user_${id.slice(4)}`, needs_payments: false });

  await check("overlapping run: another lease holder means skip, with no Whop calls and no finish", async () => {
    const { deps, calls } = harness({ leaseHeld: true, due: [due("mem_a")], memberships: { mem_a: membership("mem_a") } });
    const result = plain(await job.runPlanCreditReconcileJob(deps));
    assert.equal(result.status, "skipped");
    assert.deepEqual(calls.fetched, []);
    assert.equal(calls.finish, null);
  });

  await check("run: refreshes bound memberships, records observations and payment evidence, rejects binding mismatches, survives provider failures, finishes partial", async () => {
    const rows = [due("mem_ok"), { ...due("mem_pay"), needs_payments: true }, due("mem_bad"), due("mem_down"), { ...due("mem_unk"), plan_id: "plan_unknown" }];
    const { deps, calls } = harness({ due: rows, memberships: {
      mem_ok: membership("mem_ok"), mem_pay: membership("mem_pay", { status: "canceling" }),
      mem_bad: membership("mem_bad", { checkout_configuration_id: "ch_someone_else" }),
      mem_unk: membership("mem_unk", { plan: { id: "plan_unknown" } }),
    }, payments: { mem_pay: { payments: [{ id: "pay_1", planId: "plan_x", billingReason: "subscription_create", paidAt: "2027-01-31T10:00:30.000Z", refunded: false }], skipped: 0, complete: true } } });
    const result = plain(await job.runPlanCreditReconcileJob(deps, { pageSize: 10 }));
    assert.equal(result.status, "partial");
    assert.deepEqual([result.stats.processed, result.stats.failed, result.stats.bindingMismatch, result.stats.unknownPlan], [2, 1, 1, 1]);
    assert.deepEqual(calls.observations.map(o => [o.membershipId, o.paid, o.source, o.periodStart]), [["mem_ok", true, "reconcile", "2027-01-31T10:00:00.000Z"], ["mem_pay", true, "reconcile", "2027-01-31T10:00:00.000Z"]]);
    assert.deepEqual(calls.paymentsRecorded, ["pay_1"]);
    assert.equal(result.stats.paymentsGranted, 2);
    assert.deepEqual(result.stats.reconciledMemberships, 4);
    assert.equal(calls.finish.p_status, "partial");
    assert.match(calls.finish.p_error, /mem_down: PAYMENT_PROVIDER_UNAVAILABLE/);
    assert.deepEqual(calls.fetched.filter(id => id === "mem_down").length, 1, "a failing membership is attempted once per run (no loop)");
  });

  await check("refunds: every refreshed membership's recent payments are reconciled (current state) before allocation evidence; old ones skipped; failures stay per membership", async () => {
    const pay = (id, paidAt) => ({ id, planId: "plan_x", billingReason: "subscription_cycle", paidAt, refunded: true });
    const rows = [due("mem_ref"), { ...due("mem_ev"), needs_payments: true }, due("mem_err")];
    const { deps, calls } = harness({ due: rows, memberships: { mem_ref: membership("mem_ref"), mem_ev: membership("mem_ev"), mem_err: membership("mem_err") }, payments: {
      mem_ref: { payments: [pay("pay_old", "2026-06-01T00:00:00.000Z"), pay("pay_recent", "2026-10-19T13:33:08.000Z")], skipped: 0, complete: true },
      mem_ev: { payments: [pay("pay_ev", "2026-10-10T00:00:00.000Z")], skipped: 0, complete: true },
      mem_err: { payments: [pay("pay_err", "2026-10-18T00:00:00.000Z")], skipped: 0, complete: true } } });
    const order = [];
    deps.now = () => Date.parse("2026-10-20T00:00:00.000Z");
    deps.recordPayment = async (user, id, payment) => { order.push(`evidence:${payment.id}`); return { outcome: "evidence", granted: 0 }; };
    deps.reconcilePayment = async (user, m, paymentId) => {
      order.push(`reconcile:${m.id}:${paymentId}`);
      if (paymentId === "pay_err") throw Object.assign(new Error("evidence"), { code: "PLAN_PAYMENT_UNVERIFIED" });
      return { outcome: "updated", state: paymentId === "pay_recent" ? "reversed" : "funded" };
    };
    const result = plain(await job.runPlanCreditReconcileJob(deps, { pageSize: 10 }));
    assert.deepEqual(order, ["reconcile:mem_ref:pay_recent", "reconcile:mem_ev:pay_ev", "evidence:pay_ev", "reconcile:mem_err:pay_err"]);
    assert.deepEqual([result.stats.paymentsReconciled, result.stats.paymentsNotFunded, result.stats.processed, result.stats.failed], [2, 1, 2, 1]);
    assert.equal(result.status, "partial");
    assert.match(calls.finish.p_error, /mem_err: PLAN_PAYMENT_UNVERIFIED/);
    assert(!calls.observations.some(o => o.membershipId === "mem_err"), "failed financial read must not mark the membership recently reconciled");
  });

  await check("bounded: time budget and membership cap stop the run as partial; heartbeats renew the lease", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => due(`mem_${String(i).padStart(2, "0")}x`));
    const memberships = Object.fromEntries(rows.map(r => [r.membership_id, membership(r.membership_id)]));
    let h = harness({ due: rows, memberships, clockStep: 1000 });
    let result = plain(await job.runPlanCreditReconcileJob(h.deps, { budgetMs: 12_000 }));
    assert.equal(result.status, "partial");
    assert.equal(result.stats.budgetExhausted, true);
    assert.ok(result.stats.processed < 30 && result.stats.processed > 0);
    h = harness({ due: rows, memberships });
    result = plain(await job.runPlanCreditReconcileJob(h.deps, { maxMemberships: 25, pageSize: 10 }));
    assert.equal(result.stats.processed, 25);
    assert.equal(result.status, "partial");
    assert.equal(result.stats.backlog, true);
    assert.equal(h.calls.rpc.filter(name => name === "makeborne_billing_job_heartbeat").length, 2);
    h = harness({ due: rows.slice(0, 20), memberships });
    result = plain(await job.runPlanCreditReconcileJob(h.deps, { maxMemberships: 20, pageSize: 10 }));
    assert.equal(result.status, "succeeded", "Exactly the cap is complete when no further membership is due");
    assert.equal(result.stats.backlog, false);
    h = harness({ due: rows.slice(0, 21), memberships });
    result = plain(await job.runPlanCreditReconcileJob(h.deps, { maxMemberships: 20, pageSize: 10 }));
    assert.equal(result.status, "partial", "The extra due row must be detected even at a page boundary");
    assert.equal(result.stats.processed, 20);
  });

  await check("individual binding, plan, incomplete page and skipped evidence issues cannot report success", async () => {
    const cases = [
      { stat: "bindingMismatch", row: due("mem_issue"), membership: membership("mem_issue", { plan: { id: "plan_changed" } }) },
      { stat: "unknownPlan", row: { ...due("mem_issue"), plan_id: "plan_unknown" }, membership: membership("mem_issue", { plan: { id: "plan_unknown" } }) },
      { stat: "paymentPagesIncomplete", row: { ...due("mem_issue"), needs_payments: true }, membership: membership("mem_issue"), payment: { payments: [], skipped: 0, complete: false } },
      { stat: "paymentEvidenceSkipped", row: { ...due("mem_issue"), needs_payments: true }, membership: membership("mem_issue"), payment: { payments: [], skipped: 1, complete: true } },
    ];
    for (const fixture of cases) {
      const { deps, calls } = harness({ due: [fixture.row], memberships: { mem_issue: fixture.membership }, payments: { mem_issue: fixture.payment } });
      const result = plain(await job.runPlanCreditReconcileJob(deps));
      assert.equal(result.stats[fixture.stat], 1, fixture.stat);
      assert.equal(result.stats.failed, 0, "No unrelated failure may mask the issue");
      assert.equal(result.status, "partial", fixture.stat);
      assert.equal(calls.finish.p_status, "partial", fixture.stat);
      assert.equal(calls.finish.p_stats[fixture.stat], 1, "Persisted health retains the reason");
      if (["bindingMismatch", "unknownPlan"].includes(fixture.stat)) {
        assert.deepEqual(calls.updates, []);assert.deepEqual(calls.observations, []);
      }
      assert.deepEqual(calls.observations, [], "incomplete or skipped evidence must remain due rather than advancing the financial checkpoint");
    }
  });

  await check("failure: a database reconcile error marks the run failed and still releases it", async () => {
    const { deps, calls } = harness({ due: [], failReconcile: true });
    const result = plain(await job.runPlanCreditReconcileJob(deps));
    assert.equal(result.status, "failed");
    assert.equal(calls.finish.p_status, "failed");
  });

  await check("expiry: after the reconcile the run records due credit expiries and abandoned AI calls; a failure marks the run failed", async () => {
    let h = harness({ due: [] });
    let result = plain(await job.runPlanCreditReconcileJob(h.deps));
    assert.equal(result.status, "succeeded");
    assert.equal(result.stats.expiryWallets, 3);
    assert.equal(result.stats.expiredProviderCalls, 2);
    const order = h.calls.rpc.filter(name => ["makeborne_reconcile_plan_credits", "makeborne_credit_expire_due", "makeborne_provider_calls_expire", "makeborne_billing_job_finish"].includes(name));
    assert.deepEqual(order, ["makeborne_reconcile_plan_credits", "makeborne_credit_expire_due", "makeborne_provider_calls_expire", "makeborne_billing_job_finish"]);
    h = harness({ due: [], failExpiry: true });
    result = plain(await job.runPlanCreditReconcileJob(h.deps));
    assert.equal(result.status, "failed");
    assert.equal(h.calls.finish.p_status, "failed");
  });

  await check("first-checkout discovery runs inside the job lease and persists failures/backlog", async () => {
    let h = harness({ due: [] }), calls = 0;
    h.deps.recoverCheckouts = async () => { calls++; assert.equal(h.calls.rpc[0], "makeborne_billing_job_begin"); return { processed: 2, recovered: 1, failed: 1, backlog: true }; };
    const result = await job.runPlanCreditReconcileJob(h.deps);
    assert.equal(calls, 1); assert.equal(result.status, "partial");
    assert.equal(result.stats.checkoutRecoveries, 1); assert.equal(result.stats.checkoutRecoveryFailures, 1); assert.equal(result.stats.backlog, false); assert.equal(result.stats.checkoutRecoveryBacklog, true);
    assert.equal(h.calls.finish.p_stats.checkoutRecoveryFailures, 1);
    h = harness({ due: [] }); h.deps.recoverCheckouts = async () => { throw new Error("Discovery storage unavailable"); };
    const failed = await job.runPlanCreditReconcileJob(h.deps);
    assert.equal(failed.status, "failed"); assert.equal(h.calls.finish.p_status, "failed");
  });
  await check("unpaid checkout lookahead is informational; genuine financial backlog and discovery failures remain partial", async () => {
    const h = harness({ due: [due("mem_ok")], memberships: { mem_ok: membership("mem_ok") } });
    h.deps.recoverCheckouts = async () => ({ processed: 10, recovered: 0, failed: 0, backlog: true });
    let result = await job.runPlanCreditReconcileJob(h.deps);
    assert.equal(result.status, "succeeded", "More than ten unpaid checkout attempts cannot permanently postpone lastSuccessAt");
    assert.equal(result.stats.checkoutRecoveryBacklog, true);
    assert.equal(result.stats.backlog, false);
    assert.equal(h.calls.finish.p_status, "succeeded");
    assert.equal(h.calls.finish.p_stats.checkoutRecoveryBacklog, true, "Persist informational lookahead");
    for (const backlog of [false, true]) {
      h.deps.recoverCheckouts = async () => ({ processed: 10, recovered: 0, failed: 1, backlog });
      result = await job.runPlanCreditReconcileJob(h.deps);
      assert.equal(result.status, "partial", "A thrown recovery or review result must remain unhealthy");
      assert.equal(result.stats.checkoutRecoveryFailures, 1);
    }
    const capped = harness({ due: [due("mem_a"), due("mem_b")], memberships: { mem_a: membership("mem_a") } });
    capped.deps.recoverCheckouts = async () => ({ processed: 10, recovered: 0, failed: 0, backlog: true });
    result = await job.runPlanCreditReconcileJob(capped.deps, { maxMemberships: 1 });
    assert.equal(result.status, "partial"); assert.equal(result.stats.backlog, true);
    const cron = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
    assert.deepEqual(cron.crons, [{ path: "/api/cron/billing-reconcile", schedule: "17 3 * * *" }]);
  });
  console.log(`${passed} reconciliation job checks passed (retry/backoff, sandbox base, payment pagination, cron auth, overlap, binding, failures, budget, heartbeat, expiry, checkout discovery). Whop and the database are mocked.`);
})().catch(error => { console.error(error); process.exit(1); });
