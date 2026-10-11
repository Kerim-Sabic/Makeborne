/** Local-only cross-workspace/provider race. No external call exists here. */
import {readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import assert from "node:assert/strict";
import {Pool} from "pg";
if (process.env.MAKEBORNE_VERIFY_LOCAL_JOBS !== "true" || !process.env.MAKEBORNE_LOCAL_STATUS_FILE) {
  console.log("NOT RUN: explicit local job verification and ignored config required."); process.exit(2);
}
let pool, first, second, pending, created = false, baseline, stage = "local guard";
const fixtures = ["anthropic", "openai"].map(provider => ({provider, owner: randomUUID(), workspace: randomUUID(), project: randomUUID(), artifact: randomUUID(), proposal: randomUUID(), worker: randomUUID(), job: null}));
const scopes = ["global", "anthropic", "openai"];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const config = JSON.parse((await readFile(process.env.MAKEBORNE_LOCAL_STATUS_FILE, "utf8")).replace(/^\uFEFF/, ""));
  const url = new URL(config.DB_URL); assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "55322"); assert.equal(url.pathname, "/postgres");
  pool = new Pool({connectionString: url.href, max: 4, connectionTimeoutMillis: 3000, options: "-c statement_timeout=10000 -c lock_timeout=5000"});
  pool.on("error", () => {});
  assert.equal((await pool.query("select limit_cents::text as allowance from makeborne_private.claude_pilot_budget where id")).rows[0].allowance, "0");
  baseline = (await pool.query("select * from makeborne_private.generation_execution_caps where scope=any($1::text[]) order by scope", [scopes])).rows;
  assert.equal(baseline.length, 3);
  assert(baseline.every(cap => !cap.enabled && cap.vendor_reserved === "0" && cap.active_dispatches === 0));
  stage = "applied cap function parity";
  const migration = await readFile(new URL("./migrations/20261008141212_generation_execution_caps.sql", import.meta.url), "utf8");
  let definitions = 0;
  for (const match of migration.matchAll(/create function makeborne_private\.([a-z_]+)\([\s\S]*?\bas \$\$([\s\S]*?)\$\$;/g)) {
    const stored = await pool.query("select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='makeborne_private' and p.proname=$1", [match[1] === 'claim_capped_generation_dispatch' ? 'claim_capped_generation_dispatch_unchecked' : match[1]]);
    assert.equal(stored.rows.length, 1); assert.equal(stored.rows[0].prosrc.trim(), match[2].trim()); definitions++;
  }
  assert.equal(definitions, 4); console.log("PASS four applied cap function bodies match the migration exactly");
  first = await pool.connect();
  await first.query("begin");
  for (const f of fixtures) {
    await first.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [f.owner, `cap-race-${f.owner}@example.invalid`]);
    f.session=randomUUID();
    await first.query("insert into auth.sessions(id,user_id,created_at,updated_at) values($1,$2,now(),now())",[f.session,f.owner]);
    await first.query("insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values($1,true,false,'Disposable authorized cap race')",[f.owner]);
    await first.query("insert into public.workspaces(id,name,owner_id) values($1,'Disposable execution cap race fixture',$2)", [f.workspace, f.owner]);
    await first.query("insert into public.projects(id,workspace_id,title,kind) values($1,$2,'Fixture','website')", [f.project, f.workspace]);
    await first.query("insert into public.artifacts(id,workspace_id,project_id,title,kind) values($1,$2,$3,'Fixture','website')", [f.artifact, f.workspace, f.project]);
    const preparedAt = new Date().toISOString(), expiresAt = new Date(Date.now()+3600000).toISOString();
    const route = {provider: f.provider, model: "offline", status: "ready", adapterVerified: true, policyApproved: true, licenseApproved: true, price: {version: "fixture-v1", expiresAt}};
    const snapshot = {version: "generation-proposal-v1", inputHash: "a".repeat(64), approvalHash: "b".repeat(64), input: {scope: {workspaceId: f.workspace, projectId: f.project, artifactId: f.artifact}, baseVersionId: null,sourceIds:[]}, workflow: {version: "workflow-v1", output: "website", approved: false, maximumVendorMicrousd: "12", maximumCustomerCredits: "3", preparedAt, expiresAt, stages: ["planning", "draft", "review"].map(stage => ({stage, route}))}};
    await first.query(`insert into makeborne_private.generation_proposals(id,workspace_id,project_id,artifact_id,input_hash,approval_hash,snapshot,maximum_vendor_microusd,maximum_customer_credits,prepared_at,expires_at)
      values($1,$2,$3,$4,$5,$6,$7,12,3,$8,$9)`, [f.proposal, f.workspace, f.project, f.artifact, snapshot.inputHash, snapshot.approvalHash, snapshot, preparedAt, expiresAt]);
    await first.query("insert into makeborne_private.generation_budgets(workspace_id,spending_enabled,vendor_limit,credit_limit) values($1,true,12,3)", [f.workspace]);
    f.job = (await first.query("select * from makeborne_private.authorize_and_enqueue_generation_job($1,$2,$3,$4,$5,$6,$7,$8,true,true,true)", [f.proposal, randomUUID(), f.owner, snapshot.approvalHash, snapshot.inputHash, new Date(Date.now()+600000).toISOString(), f.session,new Date(Date.now()+1800000).toISOString()])).rows[0];
    f.job = (await first.query("select * from makeborne_private.acquire_generation_job_lease($1,$2,120)", [f.job.id, f.worker])).rows[0];
  }
  await first.query("commit"); created = true;
  stage = "cross-workspace and provider global-cap contention";
  second = await pool.connect(); const application = `cap-race-${randomUUID()}`;
  await second.query("select set_config('application_name',$1,false)", [application]);
  await first.query("begin");
  await first.query("update makeborne_private.generation_execution_caps set enabled=true,emergency_stop=false,vendor_limit=vendor_spent+12,concurrency_limit=10 where scope=any($1::text[])", [scopes]);
  await first.query("set local role service_role");
  const sql = "select makeborne_private.claim_capped_generation_dispatch($1,$2,$3,$4) as claim";
  const args = f => [f.job.id, f.worker, f.job.fence, randomUUID()];
  const winner = (await first.query(sql, args(fixtures[0]))).rows[0].claim; assert.equal(winner.claimed, true);
  await second.query("begin"); await second.query("set local role service_role");
  pending = second.query(sql, args(fixtures[1])).then(value => ({value}), error => ({code: error.code}));
  let blocked = false;
  for (let attempt=0; attempt<60; attempt++) {
    const check = await pool.query("select count(*)::int as n from pg_stat_activity where application_name=$1 and wait_event_type='Lock'", [application]);
    if (check.rows[0].n===1) {blocked = true; break;}
    await pause(30);
  }
  assert(blocked, "Different workspace/provider must wait on the shared cap lock");
  await first.query("commit");
  const loser = await pending; pending = null; assert.equal(loser.code, "MB402"); await second.query("rollback");
  const caps = (await pool.query("select scope,vendor_reserved,active_dispatches from makeborne_private.generation_execution_caps where scope=any($1::text[]) order by scope", [scopes])).rows;
  assert.deepEqual(caps, [{scope: "anthropic", vendor_reserved: "12", active_dispatches: 1}, {scope: "global", vendor_reserved: "12", active_dispatches: 1}, {scope: "openai", vendor_reserved: "0", active_dispatches: 0}]);
  assert.equal((await pool.query("select count(*)::int as n from makeborne_private.generation_execution_holds where workspace_id=any($1::uuid[])", [fixtures.map(f => f.workspace)])).rows[0].n, 1);
  console.log("PASS real service workers from different workspaces and providers contend on global balance; only one dispatch commits");
  console.log("PASS denied competitor creates no dispatch/cap hold; global and provider counters remain exact");
}
try {await main();} catch (error) {console.error(`FAIL ${stage}: ${typeof error?.code === "string" ? error.code : "ASSERTION_OR_LOCAL_CHECK"}`); process.exitCode=1;}
finally {
  if (first) await first.query("rollback").catch(() => {});
  if (pending) await pending;
  if (second) {await second.query("rollback").catch(() => {}); second.release();}
  if (first) first.release();
  if (created) {
    try {
      await pool.query("update makeborne_private.generation_execution_caps set enabled=false,emergency_stop=true where scope=any($1::text[])", [scopes]);
      // This fixture never calls a provider. Its external cost is known zero,
      // unlike a real lost response, so the operator can attest that fact.
      for (const f of fixtures) {
        const dispatched = (await pool.query(`select d.id,h.provider,h.model,h.tariff_version from makeborne_private.generation_dispatches d
          join makeborne_private.generation_execution_holds h on h.dispatch_id=d.id where h.job_id=$1`, [f.job.id])).rows[0];
        if (dispatched) {
          await pool.query("select makeborne_private.record_generation_outcome_core($1,$2,false,0,$3,$4,$5,$6,$7,null)", [f.job.id, dispatched.id, dispatched.provider, dispatched.model, dispatched.tariff_version, `local-only-${f.job.id}`, "e".repeat(64)]);
          const revision = (await pool.query("select run_revision from public.generation_jobs where id=$1", [f.job.id])).rows[0].run_revision;
          await pool.query("select makeborne_private.settle_generation_job($1,$2,$3,false,$4)", [f.job.id, f.owner, revision, "f".repeat(64)]);
        } else await pool.query("select makeborne_private.cancel_generation_job($1,$2,'No external dispatch in local fixture')", [f.job.id, f.owner]);
        await pool.query("update makeborne_private.generation_budgets set spending_enabled=false,emergency_stop=true where workspace_id=$1", [f.workspace]);
        await pool.query("delete from makeborne_private.account_privileges where user_id=$1 and reason='Disposable authorized cap race'",[f.owner]);
        await pool.query("delete from auth.sessions where id=$1",[f.session]);
      }
      for (const cap of baseline) {
        const current = (await pool.query("select vendor_spent,vendor_reserved,active_dispatches from makeborne_private.generation_execution_caps where scope=$1", [cap.scope])).rows[0];
        assert.equal(current.vendor_spent, cap.vendor_spent); assert.equal(current.vendor_reserved, cap.vendor_reserved); assert.equal(current.active_dispatches, cap.active_dispatches);
        await pool.query("update makeborne_private.generation_execution_caps set enabled=$2,emergency_stop=$3,vendor_limit=$4,concurrency_limit=$5 where scope=$1", [cap.scope, cap.enabled, cap.emergency_stop, cap.vendor_limit, cap.concurrency_limit]);
      }
      console.log("PASS known-zero local fixture reconciles and releases both cap holds; original disabled policies restored; immutable receipts retained");
      console.log(`LOCAL CAP RUN ${fixtures.map(f => f.workspace).join(",")}; temporary local grants and sessions removed; no paid calls or production changes.`);
    } catch {console.error("FAIL local cap fixture requires scoped operator cleanup; keep spending disabled"); process.exitCode=1;}
  }
  if (pool) await pool.end();
}
