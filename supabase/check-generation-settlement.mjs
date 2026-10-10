/** Actual local settlement race. Append-only fixture receipts are retained. */
import {readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import assert from "node:assert/strict";
import {Pool} from "pg";

if (process.env.MAKEBORNE_VERIFY_LOCAL_JOBS !== "true" || !process.env.MAKEBORNE_LOCAL_STATUS_FILE) {
  console.log("NOT RUN: enable MAKEBORNE_VERIFY_LOCAL_JOBS and provide ignored local status file."); process.exit(2);
}
let pool, created = false, first, second, pending, stage = "local configuration";
const owner = randomUUID(), workspace = randomUUID(), project = randomUUID(), artifact = randomUUID(), proposal = randomUUID();
const result = randomUUID(), worker = randomUUID();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const config = JSON.parse((await readFile(process.env.MAKEBORNE_LOCAL_STATUS_FILE, "utf8")).replace(/^\uFEFF/, ""));
  const url = new URL(config.DB_URL);
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "55322"); assert.equal(url.pathname, "/postgres");
  pool = new Pool({connectionString: url.href, max: 4, connectionTimeoutMillis: 3000, options: "-c statement_timeout=10000 -c lock_timeout=5000"});
  pool.on("error", () => {});
  stage = "applied migration parity";
  const migration = await readFile(new URL("./migrations/20261008135727_generation_outcome_settlement.sql", import.meta.url), "utf8");
  let definitions = 0;
  for (const match of migration.matchAll(/create function makeborne_private\.([a-z_]+)\([\s\S]*?\bas \$\$([\s\S]*?)\$\$;/g)) {
    const stored = await pool.query("select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='makeborne_private' and p.proname=$1", [match[1]]);
    assert.equal(stored.rows.length, 1); assert.equal(stored.rows[0].prosrc.trim(), match[2].trim()); definitions++;
  }
  assert.equal(definitions, 4); console.log("PASS four applied accounting function bodies match the final migration exactly");
  stage = "create disposable accounting fixture";
  first = await pool.connect();
  await first.query("begin");
  await first.query("insert into auth.users(id,email) values($1,$2)", [owner, `accounting-${owner}@example.invalid`]);
  await first.query("insert into public.workspaces(id,name,owner_id) values($1,'Disposable accounting race fixture',$2)", [workspace, owner]);
  await first.query("insert into public.projects(id,workspace_id,title,kind) values($1,$2,'Fixture','website')", [project, workspace]);
  await first.query("insert into public.artifacts(id,workspace_id,project_id,title,kind) values($1,$2,$3,'Fixture','website')", [artifact, workspace, project]);
  const preparedAt = new Date().toISOString(), expiresAt = new Date(Date.now()+3600000).toISOString();
  const snapshot = {version: "generation-proposal-v1", inputHash: "a".repeat(64), approvalHash: "b".repeat(64), input: {scope: {workspaceId: workspace, projectId: project, artifactId: artifact}, baseVersionId: null}, workflow: {version: "workflow-v1", output: "website", approved: false, maximumVendorMicrousd: "12", maximumCustomerCredits: "3", preparedAt, expiresAt, stages: [{}, {}, {}]}};
  await first.query(`insert into makeborne_private.generation_proposals(id,workspace_id,project_id,artifact_id,input_hash,approval_hash,snapshot,maximum_vendor_microusd,maximum_customer_credits,prepared_at,expires_at)
    values($1,$2,$3,$4,$5,$6,$7,12,3,$8,$9)`, [proposal, workspace, project, artifact, snapshot.inputHash, snapshot.approvalHash, snapshot, preparedAt, expiresAt]);
  await first.query("insert into makeborne_private.generation_budgets(workspace_id,spending_enabled,vendor_limit,credit_limit) values($1,true,12,3)", [workspace]);
  let job = (await first.query("select (makeborne_private.reserve_and_enqueue_generation_job($1,$2,$3,$4,$5,$6)).*", [proposal, randomUUID(), owner, snapshot.approvalHash, snapshot.inputHash, new Date(Date.now()+600000).toISOString()])).rows[0];
  job = (await first.query("select (makeborne_private.acquire_generation_job_lease($1,$2,120)).*", [job.id, worker])).rows[0];
  const claim = (await first.query("select makeborne_private.claim_generation_job_dispatch($1,$2,$3,$4) as claim", [job.id, worker, job.fence, randomUUID()])).rows[0].claim;
  assert.equal(claim.claimed, true);
  await first.query("insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,content,style_snapshot,created_by,created_at) values($1,$2,$3,1,'{}','{}',$4,clock_timestamp())", [result, workspace, artifact, owner]);
  await first.query("select makeborne_private.record_generation_job_outcome($1,$2,$3,$4,true,7,'offline','offline','test-v1',$5,$6,$7)", [job.id, worker, job.fence, claim.dispatchId, `fixture-${job.id}`, "e".repeat(64), result]);
  job = (await first.query("select * from public.generation_jobs where id=$1", [job.id])).rows[0];
  await first.query("commit"); created = true;

  stage = "real settlement lock contention";
  second = await pool.connect();
  const application = `settlement-race-${randomUUID()}`;
  await second.query("select set_config('application_name',$1,false)", [application]);
  const values = [job.id, owner, job.run_revision, "f".repeat(64)];
  const sql = "select (makeborne_private.settle_generation_job($1,$2,$3,true,$4)).*";
  await first.query("begin"); await first.query("set local role service_role");
  const winner = (await first.query(sql, values)).rows[0];
  await second.query("begin"); await second.query("set local role service_role");
  pending = second.query(sql, values).then(value => ({value}), error => ({code: error.code}));
  let blocked = false;
  for (let attempt=0; attempt<60; attempt++) {
    const check = await pool.query("select count(*)::int as n from pg_stat_activity where application_name=$1 and wait_event_type='Lock'", [application]);
    if (check.rows[0].n===1) {blocked = true; break;}
    await pause(30);
  }
  assert(blocked, "Second real settlement must be observed waiting for the first transaction");
  await first.query("commit");
  const loser = await pending; pending = null;
  assert.equal(loser.code, undefined); assert.equal(loser.value.rows[0].id, winner.id);
  await second.query("commit");
  const budget = (await pool.query("select vendor_spent,credit_spent,vendor_reserved,credit_reserved,active_reservations from makeborne_private.generation_budgets where workspace_id=$1", [workspace])).rows[0];
  assert.deepEqual(budget, {vendor_spent: "7", credit_spent: "3", vendor_reserved: "0", credit_reserved: "0", active_reservations: 0});
  const ledger = (await pool.query("select count(*)::int as n,sum(amount_microusd)::text as cost,sum(customer_credits)::text as credits from public.usage_ledger where job_id=$1", [job.id])).rows[0];
  assert.deepEqual(ledger, {n: 2, cost: "7", credits: "3"});
  assert.equal((await pool.query("select count(*)::int as n from makeborne_private.generation_job_settlements where job_id=$1", [job.id])).rows[0].n, 1);
  assert.equal((await pool.query("select count(*)::int as n from makeborne_private.generation_job_outbox where job_id=$1 and kind='settled'", [job.id])).rows[0].n, 1);
  console.log("PASS two real service-role settlements contend and commit one customer debit, one provider cost and one settlement event");
  await assert.rejects(pool.query("select makeborne_private.settle_generation_job($1,$2,$3,false,$4)", values), error => error.code === "PT409");
  console.log("PASS changed decision replay is rejected after committed settlement; exact counters reconcile to ledger");
  console.log(`LOCAL ACCOUNTING RUN ${workspace}. No provider call or production readiness claimed.`);
}
try {await main();} catch (error) {
  console.error(`FAIL ${stage}: ${typeof error?.code === "string" ? error.code : "ASSERTION_OR_LOCAL_CHECK"}`); process.exitCode = 1;
} finally {
  if (first) await first.query("rollback").catch(() => {});
  if (pending) await pending;
  if (second) {await second.query("rollback").catch(() => {}); second.release();}
  if (first) first.release();
  if (created) {
    try {
      await pool.query("update makeborne_private.generation_budgets set spending_enabled=false,emergency_stop=true where workspace_id=$1", [workspace]);
      console.log("PASS disposable local accounting receipts retained append-only with spending disabled; no administrator grant created");
    } catch {console.error("FAIL scoped fixture budget cleanup required"); process.exitCode=1;}
  }
  if (pool) await pool.end();
}
