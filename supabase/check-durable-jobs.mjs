/** Opt-in disposable local Postgres + actual pg-boss qualification. No providers. */
import {readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {PgBoss} from "pg-boss";
import {publishGenerationOutbox, GENERATION_QUEUE} from "../infra/generation-worker/publish-outbox.mjs";

if (process.env.MAKEBORNE_VERIFY_LOCAL_JOBS !== "true" || !process.env.MAKEBORNE_LOCAL_STATUS_FILE) {
  console.log("NOT RUN: enable MAKEBORNE_VERIFY_LOCAL_JOBS and provide the ignored local status file."); process.exit(2);
}
let pool, boss, stage = "read local configuration", created = false, queueCreated = false;
const owner = randomUUID(), workspace = randomUUID(), project = randomUUID(), artifact = randomUUID();
const proposals = Array.from({length: 4}, () => randomUUID()), keys = proposals.map(() => randomUUID());
const hashes = ["b", "c", "d", "e"].map(value => value.repeat(64));
const queueSchema = `makeborne_queue_probe_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const deadline = new Date(Date.now() + 10 * 60_000).toISOString();
const enqueueSql = "select (makeborne_private.reserve_and_enqueue_generation_job($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::timestamptz)).id as id";
const enqueueArgs = index => [proposals[index], keys[index], owner, hashes[index], "a".repeat(64), deadline];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function race(firstSql, firstValues, secondSql, secondValues, operatorSecond = false) {
  const first = await pool.connect(), second = await pool.connect(), application = `job-race-${randomUUID()}`;
  let secondPending;
  try {
    await first.query("begin"); await first.query("set local role service_role");
    if (!operatorSecond) await second.query("set role service_role");
    await second.query("select set_config('application_name',$1,false)", [application]);
    const winner = await first.query(firstSql, firstValues);
    let finished = false;
    secondPending = second.query(secondSql, secondValues).then(result => ({result}), error => ({error})).finally(() => {finished = true;});
    let blocked = false; const until = Date.now() + 2500;
    while (Date.now() < until && !finished) {
      const observed = await pool.query("select count(*)::int as n from pg_stat_activity where application_name=$1 and wait_event_type='Lock'", [application]);
      if (observed.rows[0].n === 1) {blocked = true; break;}
      await pause(30);
    }
    assert(blocked, "A real competing database session must be observed waiting for a lock");
    await first.query("commit");
    return {first: winner, second: await secondPending};
  } finally {
    await first.query("rollback").catch(() => {});
    if (secondPending) await secondPending;
    await second.query("reset role").catch(() => {});
    first.release(); second.release();
  }
}

async function main() {
  const config = JSON.parse((await readFile(process.env.MAKEBORNE_LOCAL_STATUS_FILE, "utf8")).replace(/^\uFEFF/, ""));
  const url = new URL(config.DB_URL); assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "55322"); assert.equal(url.pathname, "/postgres");
  pool = new Pool({connectionString: url.href, max: 8, connectionTimeoutMillis: 3000, options: "-c statement_timeout=10000 -c lock_timeout=5000"});
  // Deliberately terminated test sessions can emit after release. Never dump a
  // driver's error object: it can include connection configuration.
  pool.on("error", () => {});
  stage = "migration function source parity";
  const migration = await readFile(new URL("./migrations/20261008133918_durable_generation_job_leases.sql", import.meta.url), "utf8");
  let definitions = 0;
  for (const match of migration.matchAll(/create function makeborne_private\.([a-z_]+)\([\s\S]*?\bas \$\$([\s\S]*?)\$\$;/g)) {
    const stored = await pool.query("select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='makeborne_private' and p.proname=$1", [match[1]]);
    assert.equal(stored.rows.length, 1); assert.equal(stored.rows[0].prosrc.trim(), match[2].trim()); definitions++;
  }
  assert(definitions >= 8); console.log(`PASS ${definitions} applied lifecycle function bodies match the final migration exactly`);
  stage = "create disposable local SQL fixture";
  const fixture = await pool.connect();
  try {
    await fixture.query("begin");
    await fixture.query("insert into auth.users(id,email) values($1,$2)", [owner, `job-${owner}@example.invalid`]);
    await fixture.query("insert into public.workspaces(id,name,owner_id) values($1,'Durable race fixture',$2)", [workspace, owner]);
    await fixture.query("insert into public.projects(id,workspace_id,title,kind) values($1,$2,'Fixture','website')", [project, workspace]);
    await fixture.query("insert into public.artifacts(id,workspace_id,project_id,title,kind) values($1,$2,$3,'Fixture','website')", [artifact, workspace, project]);
    const prepared = new Date().toISOString(), expires = new Date(Date.now() + 60 * 60_000).toISOString();
    for (let index = 0; index < proposals.length; index++) {
      const snapshot = {version: "generation-proposal-v1", inputHash: "a".repeat(64), approvalHash: hashes[index],
        input: {scope: {workspaceId: workspace, projectId: project, artifactId: artifact}, baseVersionId: null},
        workflow: {version: "workflow-v1", output: "website", approved: false, maximumVendorMicrousd: "12", maximumCustomerCredits: "3", preparedAt: prepared, expiresAt: expires, stages: [{}, {}, {}]}};
      await fixture.query(`insert into makeborne_private.generation_proposals(id,workspace_id,project_id,artifact_id,input_hash,approval_hash,snapshot,
        maximum_vendor_microusd,maximum_customer_credits,prepared_at,expires_at) values($1,$2,$3,$4,$5,$6,$7,12,3,$8,$9)`,
        [proposals[index], workspace, project, artifact, "a".repeat(64), hashes[index], snapshot, prepared, expires]);
    }
    await fixture.query("insert into makeborne_private.generation_budgets(workspace_id,spending_enabled,vendor_limit,credit_limit,concurrency_limit) values($1,true,36,9,10)", [workspace]);
    await fixture.query("commit"); created = true;
  } catch (error) {await fixture.query("rollback"); throw error;} finally {fixture.release();}
  stage = "concurrent enqueue replay";
  const same = await race(enqueueSql, enqueueArgs(0), enqueueSql, enqueueArgs(0));
  assert.equal(same.second.error, undefined); const job = same.first.rows[0].id;
  assert.equal(same.second.result.rows[0].id, job);
  assert.equal((await pool.query("select count(*)::int as n from makeborne_private.generation_job_outbox where workspace_id=$1", [workspace])).rows[0].n, 1);
  console.log("PASS real concurrent enqueue replay waits on the budget lock and creates one job/reservation/outbox event");
  stage = "legacy dispatch versus uncommitted enqueue";
  const reserved = (await pool.query("select makeborne_private.reserve_generation_proposal($1,$2,$3,$4,$5) as id", enqueueArgs(1).slice(0, 5))).rows[0].id;
  // Legacy worker execution is now revoked; retain its owner-only lock-race
  // regression as defense for explicit operator reconciliation.
  const legacy = await race(enqueueSql, enqueueArgs(1), "select makeborne_private.claim_generation_dispatch($1,$2,$3,$4,$5)", [reserved, randomUUID(), owner, hashes[1], "a".repeat(64)], true);
  assert.equal(legacy.second.error?.code, "PT409"); const recoverJob = legacy.first.rows[0].id;
  assert.equal((await pool.query("select count(*)::int as n from makeborne_private.generation_dispatches where reservation_id=$1", [reserved])).rows[0].n, 0);
  console.log("PASS operator-only legacy dispatch racing an uncommitted enqueue cannot bypass fencing after waiting");
  stage = "last available reservation race";
  const final = await race(enqueueSql, enqueueArgs(2), enqueueSql, enqueueArgs(3));
  assert.equal(final.second.error?.code, "MB402");
  const budget = (await pool.query("select vendor_reserved::text,credit_reserved::text,active_reservations,vendor_spent::text,credit_spent::text from makeborne_private.generation_budgets where workspace_id=$1", [workspace])).rows[0];
  assert.deepEqual(budget, {vendor_reserved: "36", credit_reserved: "9", active_reservations: 3, vendor_spent: "0", credit_spent: "0"});
  console.log("PASS two real requests racing the last balance reserve only once; customer/vendor counters stay exact");
  stage = "concurrent worker leases";
  const workerA = randomUUID(), workerB = randomUUID();
  const leaseSql = "select (makeborne_private.acquire_generation_job_lease($1,$2,30)).id as id";
  const leases = await race(leaseSql, [job, workerA], leaseSql, [job, workerB]);
  assert.equal(leases.first.rows[0].id, job); assert.equal(leases.second.result.rows[0].id, null);
  console.log("PASS only one competing live worker receives the lease");
  stage = "worker connection death and lease recovery";
  const deadWorker = randomUUID(), replacement = randomUUID(), dying = await pool.connect(); dying.on("error", () => {});
  try {
    await dying.query("set role service_role");
    const initial = (await dying.query("select (makeborne_private.acquire_generation_job_lease($1,$2,1)).fence::text as fence", [recoverJob, deadWorker])).rows[0].fence;
    assert.equal(initial, "1");
    const pid = (await dying.query("select pg_backend_pid() as pid")).rows[0].pid;
    assert.equal((await pool.query("select pg_terminate_backend($1) as terminated", [pid])).rows[0].terminated, true);
  } finally {dying.release(true);}
  const until = Date.now() + 4000;
  while (true) {
    const expired = (await pool.query("select lease_expires_at<=clock_timestamp() as expired from public.generation_jobs where id=$1", [recoverJob])).rows[0].expired;
    if (expired) break; assert(Date.now() < until); await pause(50);
  }
  const renewed = (await pool.query("select (makeborne_private.acquire_generation_job_lease($1,$2,30)).fence::text as fence", [recoverJob, replacement])).rows[0].fence;
  assert.equal(renewed, "2");
  assert.equal((await pool.query("select makeborne_private.renew_generation_job_lease($1,$2,1,30) as renewed", [recoverJob, deadWorker])).rows[0].renewed, false);
  await assert.rejects(pool.query("select makeborne_private.claim_generation_job_dispatch($1,$2,1,$3)", [recoverJob, deadWorker, randomUUID()]), error => error.code === "PT409");
  console.log("PASS terminated worker session recovers after actual lease expiry; old fence cannot heartbeat or dispatch");
  stage = "real pg-boss transactional outbox delivery";
  const terminal = (await pool.query(`insert into public.generation_jobs(workspace_id,project_id,artifact_id,kind,status,idempotency_key)
    values($1,$2,$3,'website','cancelled',$4) returning *`, [workspace, project, artifact, randomUUID()])).rows[0];
  await pool.query(`select makeborne_private.append_generation_job_event(j,'queued') from public.generation_jobs j where id=$1`, [terminal.id]);
  const terminalPending = (await pool.query(`select e.id from makeborne_private.generation_job_outbox e
    join public.generation_jobs j on j.id=e.job_id where e.kind='queued' and e.published_at is null
    and j.status in ('succeeded','failed','cancelled')`)).rows.map(row => row.id);
  assert.match(queueSchema, /^makeborne_queue_probe_[a-f0-9]{12}$/);
  queueCreated = true;
  boss = new PgBoss({connectionString: url.href, schema: queueSchema, supervise: false, schedule: false});
  boss.on("error", () => {}); await boss.start(); await boss.createQueue(GENERATION_QUEUE);
  const publisher = await pool.connect();
  try {
    const interrupted = {query: (text, values) => text.includes("ack_generation_job_outbox")
      ? Promise.reject(new Error("INJECTED_PUBLISHER_CRASH")) : publisher.query(text, values)};
    await assert.rejects(publishGenerationOutbox(boss, interrupted), /INJECTED_PUBLISHER_CRASH/);
    assert.equal((await pool.query(`select count(*)::int as n from "${queueSchema}".job`)).rows[0].n, 0);
    assert.equal((await pool.query("select count(*)::int as n from makeborne_private.generation_job_outbox where workspace_id=$1 and published_at is not null", [workspace])).rows[0].n, 0);
    console.log("PASS publisher failure after real pg-boss insertion rolls back both queue message and acknowledgment");
    const publisher2 = await pool.connect();
    try {
      const published = await Promise.all([publishGenerationOutbox(boss, publisher), publishGenerationOutbox(boss, publisher2)]);
      assert(published.every(Boolean)); assert.notEqual(published[0].eventId, published[1].eventId);
    } finally {publisher2.release();}
    assert(await publishGenerationOutbox(boss, publisher)); assert.equal(await publishGenerationOutbox(boss, publisher), null);
    const events = (await pool.query("select id,job_id,queue_job_id from makeborne_private.generation_job_outbox where workspace_id=$1 and kind='queued' and job_id<>$2", [workspace, terminal.id])).rows;
    assert.equal(events.length, 3);
    for (const event of events) {
      assert.equal(event.queue_job_id, event.id);
      const delivered = await boss.getJobById(GENERATION_QUEUE, event.id);
      assert.deepEqual(delivered.data, {jobId: event.job_id, workspaceId: workspace, eventId: event.id});
    }
    assert.equal((await pool.query(`select count(*)::int as n from "${queueSchema}".job`)).rows[0].n, 3);
    console.log("PASS concurrent pg-boss publishers deliver each outbox event once with exact job/scope identity; retries find no duplicate work");
    if (terminalPending.length) {
      assert.equal((await pool.query("select count(*)::int as n from makeborne_private.generation_job_outbox where id=any($1::uuid[]) and published_at is null", [terminalPending])).rows[0].n, terminalPending.length);
      console.log("PASS delayed publisher skips existing terminal work without inventing queue acknowledgment");
    }
  } finally {publisher.release();}
  console.log("LOCAL DURABLE JOB QUALIFICATION PASSED. No paid worker, provider call, settlement or production readiness is claimed.");
}
try {await main();} catch (error) {console.error(`LOCAL JOB CHECK FAILED at ${stage}; code ${error.code ?? "ASSERTION_OR_RUNTIME"}; response bodies and configuration omitted.`); process.exitCode = 1;}
finally {
  await boss?.stop().catch(() => {});
  if (pool) {
    try {
      if (queueCreated) {assert.match(queueSchema, /^makeborne_queue_probe_[a-f0-9]{12}$/); await pool.query(`drop schema if exists "${queueSchema}" cascade`);}
      if (created) {
        const cleanup = await pool.connect();
        try {
          await cleanup.query("begin");
          for (const table of ["makeborne_private.generation_job_outbox", "public.generation_jobs", "makeborne_private.generation_reservations"]) {
            if (table.endsWith("generation_reservations")) await cleanup.query("delete from makeborne_private.generation_dispatches where reservation_id in (select id from makeborne_private.generation_reservations where workspace_id=$1)", [workspace]);
            await cleanup.query(`delete from ${table} where workspace_id=$1`, [workspace]);
          }
          for (const table of ["makeborne_private.generation_proposals", "makeborne_private.generation_budgets", "public.artifacts", "public.projects"]) await cleanup.query(`delete from ${table} where workspace_id=$1`, [workspace]);
          await cleanup.query("delete from public.workspaces where id=$1", [workspace]); await cleanup.query("delete from auth.users where id=$1", [owner]);
          await cleanup.query("commit"); console.log("PASS dedicated queue schema and all committed job-race fixtures removed");
        } catch (error) {await cleanup.query("rollback"); throw error;} finally {cleanup.release();}
      }
    } catch {console.error("LOCAL JOB FIXTURE CLEANUP UNCONFIRMED"); process.exitCode = 1;}
    await pool.end();
  }
}
