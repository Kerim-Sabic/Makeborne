/** Actual restricted-role PostgreSQL/pg-boss consumer qualification. No provider. */
import {readFile} from "node:fs/promises";
import {randomUUID,randomBytes,createHash} from "node:crypto";
import {canonicalRuntimeJson} from "../infra/project-runtime/identity.mjs";
import {fileURLToPath} from "node:url";
import {fork} from "node:child_process";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {PgBoss} from "pg-boss";
import {publishGenerationOutbox, GENERATION_QUEUE} from "../infra/generation-worker/publish-outbox.mjs";
import {startGenerationWorker} from "../infra/generation-worker/consume-jobs.mjs";
import {createGenerationQueueRuntime} from "../infra/generation-worker/queue-runtime.mjs";

if (process.env.MAKEBORNE_VERIFY_LOCAL_JOBS !== "true" || !process.env.MAKEBORNE_LOCAL_STATUS_FILE) {
  console.log("NOT RUN: explicit local job verification and ignored config required."); process.exit(2);
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check, timeout = 10000) => {
  const end = Date.now()+timeout;
  while (true) {const value = await check(); if (value) return value; assert(Date.now()<end, "LOCAL_WAIT_EXPIRED"); await pause(50);}
};
let url;
try {
  const config = JSON.parse((await readFile(process.env.MAKEBORNE_LOCAL_STATUS_FILE, "utf8")).replace(/^\uFEFF/, ""));
  url = new URL(config.DB_URL);
  assert.equal(url.hostname,"127.0.0.1"); assert.equal(url.port,"55322"); assert.equal(url.pathname,"/postgres");
} catch {console.error("LOCAL WORKER CONFIGURATION REJECTED; configuration details omitted.");process.exit(2);}
const makePool = (role, credential) => {
  const connection = new URL(url);
  if(credential){connection.username=credential.name;connection.password=credential.password;}
  const pool = new Pool({connectionString: connection.href, max: 6, connectionTimeoutMillis: 2000, query_timeout: 4000,
    options: `-c statement_timeout=3000 -c lock_timeout=2000${role ? ` -c role=${role}` : ""}`});
  pool.on("error",()=>{}); return pool;
};
async function confirmLocalZeroCost(pool,lease) {
  const claim=(await pool.query("select makeborne_private.claim_capped_generation_dispatch($1,$2,$3,$4) as claim",[lease.jobId,lease.workerId,lease.fence,randomUUID()])).rows[0].claim;
  assert.equal(claim.claimed,true);
  await pool.query("select makeborne_private.record_capped_generation_outcome($1,$2,$3,$4,false,0,'anthropic','offline-worker-fixture','fixture-v1',$5,$6,null)",[lease.jobId,lease.workerId,lease.fence,claim.dispatchId,`local-worker-${lease.jobId}`,"e".repeat(64)]);
}
if (process.argv[2] === "--child") {
  const schema = process.argv[3];
  // Ephemeral local test credentials travel only over the owned child IPC pipe,
  // never argv, logs, committed files or the saved operator configuration.
  const init=await new Promise(resolve=>process.once("message",resolve));
  let runtime, consumer; const pool = makePool("makeborne_generation_worker",init.credential);
  try {
    runtime = await createGenerationQueueRuntime({pool,schema,role:"makeborne_generation_worker"});
    consumer = await startGenerationWorker({boss:runtime,pool,leaseSeconds:2,heartbeatMs:500,execute: async (lease,signal) => {
      if(init.mode==="confirmed") {
        // Synthetic local known-zero receipt, not a provider response. No network
        // provider is imported or called by this disposable qualification child.
        await confirmLocalZeroCost(pool,lease);
      }
      process.send?.({type:"entered",jobId:lease.jobId,fence:lease.fence});
      await new Promise((_,reject)=>signal.addEventListener("abort",()=>reject(signal.reason),{once:true}));
    }});
    process.send?.({type:"ready"});
    process.on("SIGTERM",async()=>{await consumer.stop().catch(()=>{});await runtime.stop().catch(()=>{});await pool.end();process.exit(0);});
  } catch {process.send?.({type:"failed"}); await runtime?.stop().catch(()=>{});await pool.end();process.exit(1);}
} else {
  let stage="roles",operator,publisher,worker,adminBoss,pubBoss,workBoss,consumer,child,created=false,queueCreated=false,baseline;
  const schema=`makeborne_queue_probe_${randomUUID().replaceAll("-","").slice(0,12)}`;
  const owner=randomUUID(),session=randomUUID(),sourceId=randomUUID(),workspace=randomUUID(),project=randomUUID(),artifact=randomUUID();
  const loginSuffix=randomUUID().replaceAll("-","").slice(0,12);
  const credentials=["publisher","worker"].map(kind=>({name:`makeborne_${kind}_probe_${loginSuffix}`,password:randomBytes(32).toString("hex")}));
  const createdLogins=[];
  const jobs=[];
  const jobRow=async id=>(await operator.query("select * from public.generation_jobs where id=$1",[id])).rows[0];
  const queueRow=async event=>(await operator.query(`select * from "${schema}".job where id=$1`,[event])).rows[0];
  const stopConsumer=async()=>{await consumer?.stop();consumer=null;};
  async function crashAfterEntry(job,mode="unused") {
    // Only the local operator shortens this owned probe's production 120s bound.
    await operator.query(`update "${schema}".job set expire_seconds=3 where id=$1`,[job.event]);
    const messages=[];child=fork(fileURLToPath(import.meta.url),["--child",schema],{stdio:["ignore","ignore","ignore","ipc"],windowsHide:true});
    child.on("message",message=>messages.push(message));child.send({credential:credentials[1],mode});
    stage=`${mode} child consumer delivery`;
    const oldLease=await until(()=>messages.find(message=>message.type==="entered"),10000);assert.equal(oldLease.jobId,job.id);
    const exited=new Promise(resolve=>child.once("exit",resolve));child.kill("SIGKILL");await exited;child=null;
    stage=`${mode} child lease expiry`;
    await until(async()=>new Date((await jobRow(job.id)).lease_expires_at).getTime()<=Date.now());
    stage=`${mode} child queue expiry`;
    await until(async()=>{await adminBoss.supervise(GENERATION_QUEUE);return (await queueRow(job.event)).state==="retry";},10000);
    return oldLease;
  }
  async function createJob(injectRollback=false) {
    const proposal=randomUUID(),preparedAt=new Date().toISOString(),expiresAt=new Date(Date.now()+3600000).toISOString();
    const route={provider:"anthropic",model:"offline-worker-fixture",status:"ready",adapterVerified:true,policyApproved:true,licenseApproved:true,price:{version:"fixture-v1",expiresAt}};
    const input={scope:{workspaceId:workspace,projectId:project,artifactId:artifact},baseVersionId:null,sourceIds:[sourceId]};
    const digest=value=>createHash('sha256').update(canonicalRuntimeJson(value)).digest('hex');
    const payload={version:"generation-proposal-v1",inputHash:digest(input),input,workflow:{version:"workflow-v1",output:"website",approved:false,maximumVendorMicrousd:"12",maximumCustomerCredits:"3",preparedAt,expiresAt,stages:["planning","draft","review"].map(stage=>({stage,route}))}};
    const snapshot={...payload,approvalHash:digest(payload)};
    await operator.query(`insert into makeborne_private.generation_proposals(id,workspace_id,project_id,artifact_id,input_hash,approval_hash,snapshot,maximum_vendor_microusd,maximum_customer_credits,prepared_at,expires_at) values($1,$2,$3,$4,$5,$6,$7,12,3,$8,$9)`,[proposal,workspace,project,artifact,snapshot.inputHash,snapshot.approvalHash,snapshot,preparedAt,expiresAt]);
    const job=(await operator.query("select j.* from makeborne_private.authorize_and_enqueue_generation_job($1,$2,$3,$4,$5,$6,$7,$8,true,true,true) j",[proposal,randomUUID(),owner,snapshot.approvalHash,snapshot.inputHash,new Date(Date.now()+600000).toISOString(),session,new Date(Date.now()+1800000).toISOString()])).rows[0];
    jobs.push(job.id);
    const client=await publisher.connect();let receipt;
    try {
      if(injectRollback){
        const interrupted={query:(text,values)=>text.includes("ack_generation_job_outbox")?Promise.reject(new Error("INJECTED_PUBLISHER_CRASH")):client.query(text,values)};
        await assert.rejects(publishGenerationOutbox(pubBoss,interrupted),/INJECTED_PUBLISHER_CRASH/);
        assert.equal((await operator.query(`select count(*)::int as n from "${schema}".job where data->>'jobId'=$1`,[job.id])).rows[0].n,0);
        assert.equal((await operator.query("select count(*)::int as n from makeborne_private.generation_job_outbox where job_id=$1 and published_at is not null",[job.id])).rows[0].n,0);
      }
      receipt=await publishGenerationOutbox(pubBoss,client);
    } finally {client.release();}
    assert.equal(receipt.jobId,job.id); return {...job,event:receipt.eventId};
  }
  const cancel=async id=>operator.query("select makeborne_private.cancel_generation_job($1,$2,'Local worker fixture only')",[id,owner]);
  const start=async(execute,options={})=>{consumer=await startGenerationWorker({boss:workBoss,pool:worker,leaseSeconds:2,heartbeatMs:500,execute,...options});};
  async function main() {
    operator=makePool();
    for(const [index,kind] of ["publisher","worker"].entries()) {
      const credential=credentials[index];assert.match(credential.name,/^makeborne_(?:publisher|worker)_probe_[a-f0-9]{12}$/);assert.match(credential.password,/^[a-f0-9]{64}$/);
      await operator.query(`create role "${credential.name}" login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '${credential.password}'`);
      createdLogins.push(credential.name);
      await operator.query(`grant makeborne_generation_${kind} to "${credential.name}" with set true`);
      await operator.query(`grant makeborne_generation_${kind} to "${credential.name}" with inherit false`);
    }
    publisher=makePool("makeborne_generation_publisher",credentials[0]);worker=makePool("makeborne_generation_worker",credentials[1]);
    const migration=await readFile(new URL("./migrations/20261008143555_generation_worker_lifecycle.sql",import.meta.url),"utf8");let definitions=0;
    for (const match of migration.matchAll(/create function makeborne_private\.([a-z_]+)\([\s\S]*?\bas \$\$([\s\S]*?)\$\$;/g)) {
      const stored=await operator.query("select prosrc,prosecdef,proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='makeborne_private' and p.proname=$1",[match[1]]);
      assert.equal(stored.rows.length,1);assert.equal(stored.rows[0].prosrc.trim(),match[2].trim());assert.equal(stored.rows[0].prosecdef,true);assert.deepEqual(stored.rows[0].proconfig,['search_path=""']);definitions++;
    }
    assert.equal(definitions,3);
    for (const pool of [worker,publisher]) {
      for (const query of ["select * from auth.users","select * from public.generation_jobs","select * from makeborne_private.generation_job_outbox","select * from makeborne_private.generation_proposals","select * from makeborne_private.generation_execution_caps","update public.generation_jobs set stage='forged'","update makeborne_private.generation_budgets set credit_spent=0","select makeborne_private.settle_generation_job(null,null,0,true,null)","select makeborne_private.claim_generation_job_dispatch(null,null,0,null)","select makeborne_private.claim_generation_dispatch(null,null,null,null,null)","select makeborne_private.record_generation_outcome_core(null,null,false,0,null,null,null,null,null,null)","select makeborne_private.acquire_generation_job_lease(null,null,1)"]) {
        await assert.rejects(pool.query(query),error=>error.code==="42501");
      }
    }
    const resetClient=await worker.connect();
    try {await resetClient.query("reset role");await assert.rejects(resetClient.query("select * from auth.users"),error=>error.code==="42501");await assert.rejects(resetClient.query("set role postgres"),error=>error.code==="42501");}
    finally {await resetClient.query("set role makeborne_generation_worker");resetClient.release();}
    await assert.rejects(publisher.query("select makeborne_private.claim_capped_generation_dispatch(null,null,0,null)"),error=>error.code==="42501");
    await assert.rejects(worker.query("select * from makeborne_private.lock_next_generation_outbox()"),error=>error.code==="42501");
    console.log("PASS three applied functions match source/fixed search path; restricted roles cannot read private inputs, mutate app/accounting tables, settle, reconcile or bypass capped dispatch");
    stage="queue provisioning";queueCreated=true;
    adminBoss=new PgBoss({connectionString:url.href,schema,supervise:false,schedule:false,registerInstance:false,monitorIntervalSeconds:1,superviseIntervalSeconds:1});adminBoss.on("error",()=>{});
    await adminBoss.start();await adminBoss.createQueue(GENERATION_QUEUE,{retryLimit:3,retryDelay:1,expireInSeconds:3});
    stage="queue grants";
    await operator.query(`grant usage on schema "${schema}" to makeborne_generation_publisher,makeborne_generation_worker;
      grant select on "${schema}".version,"${schema}".queue to makeborne_generation_publisher,makeborne_generation_worker;
      grant select,insert on "${schema}".job,"${schema}".job_common to makeborne_generation_publisher;
      grant select,insert,update,delete on "${schema}".job,"${schema}".job_common to makeborne_generation_worker`);
    stage="publisher runtime";pubBoss=await createGenerationQueueRuntime({pool:publisher,schema,role:"makeborne_generation_publisher"});
    stage="worker runtime";workBoss=await createGenerationQueueRuntime({pool:worker,schema,role:"makeborne_generation_worker"});
    stage="queue runtime denials";
    for (const pool of [worker,publisher]) await assert.rejects(pool.query(`create table "${schema}".forbidden(id int)`),error=>error.code==="42501");
    await assert.rejects(publisher.query(`delete from "${schema}".job`),error=>error.code==="42501");
    await assert.rejects(publisher.query(`update "${schema}".job set state='completed'`),error=>error.code==="42501");
    await assert.rejects(createGenerationQueueRuntime({pool:operator,schema,role:"makeborne_generation_worker"}),/RESTRICTED_GENERATION_ROLE_REQUIRED/);
    await operator.query(`grant makeborne_generation_publisher to "${credentials[1].name}" with set true`);
    try {await assert.rejects(createGenerationQueueRuntime({pool:worker,schema,role:"makeborne_generation_worker"}),/RESTRICTED_GENERATION_ROLE_REQUIRED/);}
    finally {await operator.query(`revoke makeborne_generation_publisher from "${credentials[1].name}"`);}
    console.log("PASS actual restricted-role pg-boss startup with no migrations/supervision; queue DDL, publisher mutation, operator credentials and extra role memberships rejected");
    stage="fixture setup";
    const setup=await operator.connect();
    try {
      await setup.query("begin");
      await setup.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",[owner,`worker-${owner}@example.invalid`]);
      await setup.query("insert into auth.sessions(id,user_id,created_at,updated_at) values($1,$2,now(),now())",[session,owner]);
      await setup.query("insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values($1,true,false,'Disposable worker authorization fixture')",[owner]);
      await setup.query("insert into public.workspaces(id,name,owner_id) values($1,'Disposable worker lifecycle fixture',$2)",[workspace,owner]);
      await setup.query("insert into public.projects(id,workspace_id,title,kind) values($1,$2,'Fixture','website')",[project,workspace]);
      await setup.query("insert into public.sources(id,workspace_id,project_id,title,kind,content,approved) values($1,$2,$3,'Approved worker material','text','Exact approved worker material.',true)",[sourceId,workspace,project]);
      await setup.query("insert into public.artifacts(id,workspace_id,project_id,title,kind) values($1,$2,$3,'Fixture','website')",[artifact,workspace,project]);
      await setup.query("insert into makeborne_private.generation_budgets(workspace_id,spending_enabled,vendor_limit,credit_limit,concurrency_limit) values($1,true,1200,300,100)",[workspace]);
      await setup.query("commit");created=true;
    } catch(error){await setup.query("rollback");throw error;} finally{setup.release();}
    stage="identity and heartbeat";
    const heartbeatJob=await createJob(true),fakeWorker=randomUUID();
    console.log("PASS restricted publisher insertion/ack roll back together on an injected crash; retry publishes the exact scoped event");
    for (const values of [[heartbeatJob.event,randomUUID(),heartbeatJob.id,workspace,fakeWorker,2],[heartbeatJob.event,heartbeatJob.event,heartbeatJob.id,randomUUID(),fakeWorker,2]]) {
      await assert.rejects(worker.query("select makeborne_private.lease_queued_generation_job($1,$2,$3,$4,$5,$6)",values),error=>error.code==="42501");
    }
    let entered,abortCode;
    await start(async(lease,signal)=>{entered=lease;await new Promise((_,reject)=>signal.addEventListener("abort",()=>{abortCode=signal.reason.code;reject(signal.reason);},{once:true}));});
    const lease=await until(()=>entered);
    assert.equal(lease.approvedInput.sourceMaterial[0].text,"Exact approved worker material.");
    assert(Object.isFrozen(lease.approvedInput.proposal.input));
    await until(async()=>Number((await jobRow(heartbeatJob.id)).run_revision)>=3);
    assert.equal((await jobRow(heartbeatJob.id)).fence,lease.fence);
    await stopConsumer();assert.equal(abortCode,"WORKER_SHUTTING_DOWN");
    assert.equal((await jobRow(heartbeatJob.id)).status,"queued");assert.equal((await jobRow(heartbeatJob.id)).lease_owner,null);
    assert.equal((await operator.query("select count(*)::int as n from makeborne_private.generation_dispatches where reservation_id=$1",[heartbeatJob.reservation_id])).rows[0].n,0);
    await cancel(heartbeatJob.id);
    console.log("PASS forged queue/scope denied; actual consumer renews its lease; shutdown aborts executor, fences unused work and creates a durable retry without a dispatch");
    stage="cancellation";const cancelledJob=await createJob();let cancellationCode,cancelEntered=false;
    await start(async(_,signal)=>{cancelEntered=true;await new Promise((_,reject)=>signal.addEventListener("abort",()=>{cancellationCode=signal.reason.code;reject(signal.reason);},{once:true}));});
    await until(()=>cancelEntered);await cancel(cancelledJob.id);
    await until(()=>cancellationCode==="WORKER_LEASE_LOST");await stopConsumer();
    await until(async()=>(await queueRow(cancelledJob.event)).state==="completed");
    console.log("PASS current cancellation invalidates worker heartbeat and aborts running execution; terminal message completes without another attempt");
    stage="deadline";const deadlineJob=await createJob();let deadlineCode;
    await start(async(_,signal)=>new Promise((_,reject)=>signal.addEventListener("abort",()=>{deadlineCode=signal.reason.code;reject(signal.reason);},{once:true})),{maxRuntimeMs:200});
    await until(()=>deadlineCode==="WORKER_DEADLINE_EXCEEDED");await stopConsumer();await cancel(deadlineJob.id);
    console.log("PASS independent bounded execution deadline aborts unused work without provider cost or customer debit");
    stage="process death recovery";const recoveryJob=await createJob();
    const oldLease=await crashAfterEntry(recoveryJob);
    stage="replacement consumer delivery";
    let recovered;
    await start(async newLease=>{if(newLease.jobId===recoveryJob.id){recovered=newLease;await cancel(recoveryJob.id);}});
    await until(()=>recovered);assert(BigInt(recovered.fence)>BigInt(oldLease.fence));
    assert.equal((await worker.query("select makeborne_private.renew_generation_job_lease($1,$2,$3,2) as renewed",[recoveryJob.id,randomUUID(),oldLease.fence])).rows[0].renewed,false);
    await stopConsumer();
    console.log("PASS killed actual worker process is recovered through pg-boss expiry/retry and a new DB fence; stale heartbeat denied");
    stage="unknown dispatch hold";
    baseline=(await operator.query("select * from makeborne_private.generation_execution_caps where scope in ('global','anthropic') order by scope")).rows;
    assert(baseline.every(cap=>!cap.enabled&&cap.vendor_reserved==="0"&&cap.active_dispatches===0&&cap.vendor_spent==="0"));
    await operator.query("update makeborne_private.generation_execution_caps set enabled=true,emergency_stop=false,vendor_limit=120,concurrency_limit=10 where scope in ('global','anthropic')");
    const unknownJob=await createJob();let dispatched;
    await start(async(lease,signal)=>{
      dispatched=(await worker.query("select makeborne_private.claim_capped_generation_dispatch($1,$2,$3,$4) as claim",[lease.jobId,lease.workerId,lease.fence,randomUUID()])).rows[0].claim;
      assert.equal(dispatched.claimed,true);
      await new Promise((_,reject)=>signal.addEventListener("abort",()=>reject(signal.reason),{once:true}));
    });
    await until(()=>dispatched?.claimed===true);await stopConsumer();
    assert.equal((await jobRow(unknownJob.id)).status,"awaiting_reconciliation");
    const held=(await operator.query("select vendor_reserved,active_dispatches from makeborne_private.generation_execution_caps where scope in ('global','anthropic')")).rows;
    assert(held.every(cap=>cap.vendor_reserved==="12"&&cap.active_dispatches===1));
    let forbiddenCalls=0;await operator.query(`update "${schema}".job set state='created',start_after=clock_timestamp() where id=$1`,[unknownJob.event]);
    await start(async()=>{forbiddenCalls++;});await until(async()=>(await queueRow(unknownJob.event)).state==="completed");await stopConsumer();assert.equal(forbiddenCalls,0);
    console.log("PASS shutdown after capped intent retains workspace/global/provider holds; actual duplicate delivery cannot redispatch an unknown outcome");
    stage="normal confirmed completion";const normalJob=await createJob();
    await start(lease=>confirmLocalZeroCost(worker,lease));
    await until(async()=>(await queueRow(normalJob.event)).state==="completed");await stopConsumer();
    assert.equal((await jobRow(normalJob.id)).stage,"attempt_failed");assert.equal((await jobRow(normalJob.id)).lease_owner,null);
    console.log("PASS normal confirmed synthetic outcome releases its worker fence and queue message while preserving the separate review/credit authority");
    stage="confirmed outcome crash replay";const confirmedJob=await createJob();let calls=0;
    await crashAfterEntry(confirmedJob,"confirmed");
    assert.equal((await jobRow(confirmedJob.id)).stage,"attempt_failed");
    await start(async()=>{calls++;});
    await until(async()=>(await queueRow(confirmedJob.event)).state==="completed");await stopConsumer();
    assert.equal(calls,0);assert.equal((await jobRow(confirmedJob.id)).stage,"attempt_failed");
    await operator.query(`update "${schema}".job set state='created',start_after=clock_timestamp() where id=$1`,[confirmedJob.event]);
    await start(async()=>{calls++;});await until(async()=>(await queueRow(confirmedJob.event)).state==="completed");await stopConsumer();assert.equal(calls,0);
    assert.equal((await jobRow(confirmedJob.id)).status,"running");
    console.log("PASS actual child death after confirmed synthetic zero-cost receipt but before queue acknowledgment recovers without a second handler call or losing its review stage; duplicate delivery is safe and worker cannot settle credits");
    stage="source/session authority serialization";
    for (const kind of ["source","session"]) {
      const scopedJob=await createJob(),reader=await worker.connect(),revoker=await operator.connect();let pending;
      try {
        const receipt=(await reader.query("select makeborne_private.lease_queued_generation_job($1,$1,$2,$3,$4,120) as lease",[scopedJob.event,scopedJob.id,workspace,randomUUID()])).rows[0].lease;
        await reader.query("begin");
        await reader.query("select makeborne_private.load_generation_worker_input($1,$2,$3)",[scopedJob.id,receipt.workerId,receipt.fence]);
        const application=`authority-revoker-${randomUUID()}`;
        await revoker.query("select set_config('application_name',$1,false)",[application]);await revoker.query("begin");
        pending=(kind==="source"
          ? revoker.query("update public.sources set content='New source after approval' where id=$1",[sourceId])
          : revoker.query("delete from auth.sessions where id=$1",[session])).then(()=>({ok:true}),error=>({code:error.code}));
        await until(async()=>(await operator.query("select count(*)::int as n from pg_stat_activity where application_name=$1 and wait_event_type='Lock'",[application])).rows[0].n===1,1500);
        await reader.query("commit");assert.equal((await pending).ok,true);pending=null;await revoker.query("commit");
        await assert.rejects(worker.query("select makeborne_private.claim_capped_generation_dispatch($1,$2,$3,$4)",[scopedJob.id,receipt.workerId,receipt.fence,randomUUID()]),error=>error.code===(kind==="source"?"PT409":"42501"));
        assert.equal((await operator.query("select count(*)::int as n from makeborne_private.generation_execution_holds where job_id=$1",[scopedJob.id])).rows[0].n,0);
      } finally {
        await reader.query("rollback").catch(()=>{});if(pending)await pending;await revoker.query("rollback").catch(()=>{});reader.release();revoker.release();
      }
    }
    console.log("PASS actual restricted LOGIN source load serializes with source edits and session deletion; after either commits, dispatch is denied without allocating a cap hold");
    console.log(`LOCAL WORKER QUALIFICATION PASSED: ${workspace}. No external provider calls or production readiness claimed.`);
  }
  try {await main();} catch(error){console.error(`LOCAL WORKER CHECK FAILED at ${stage}; code ${typeof error?.code==="string"?error.code:"ASSERTION_OR_RUNTIME"}; config and driver details omitted.`);if(/^permission denied for (table|schema|function) [a-zA-Z0-9_]+$/.test(error?.message??""))console.error(error.message);process.exitCode=1;}
  finally {
    if(child){child.kill("SIGKILL");await new Promise(resolve=>child.once("exit",resolve));}
    await consumer?.stop().catch(()=>{process.exitCode=1;});
    for(const boss of [workBoss,pubBoss,adminBoss])await boss?.stop({graceful:false}).catch(()=>{process.exitCode=1;});
    if(operator) {
      try {
        if(created) {
          // Every dispatched fixture has known zero external cost because this
          // file imports no provider and makes no external call. Keep immutable
          // receipts; this is not a policy for real missing provider responses.
          for(const id of jobs) {
            const hold=(await operator.query("select * from makeborne_private.generation_execution_holds where job_id=$1",[id])).rows[0];
            if(hold) {
              const prior=(await operator.query("select id from makeborne_private.generation_provider_outcomes where job_id=$1",[id])).rows[0];
              if(!prior)await operator.query("select makeborne_private.record_generation_outcome_core($1,$2,false,0,$3,$4,$5,$6,$7,null)",[id,hold.dispatch_id,hold.provider,hold.model,hold.tariff_version,`local-operator-${id}`,"d".repeat(64)]);
              const row=await jobRow(id);await operator.query("select makeborne_private.settle_generation_job($1,$2,$3,false,$4)",[id,owner,row.run_revision,"f".repeat(64)]);
            } else await cancel(id);
          }
          await operator.query("update makeborne_private.generation_budgets set spending_enabled=false,emergency_stop=true where workspace_id=$1",[workspace]);
        }
        if(created){
          await operator.query("delete from makeborne_private.account_privileges where user_id=$1 and reason='Disposable worker authorization fixture'",[owner]);
          await operator.query("delete from auth.sessions where id=$1",[session]);
        }
        if(baseline)for(const cap of baseline){
          const row=(await operator.query("select vendor_reserved,vendor_spent,active_dispatches from makeborne_private.generation_execution_caps where scope=$1",[cap.scope])).rows[0];
          assert.equal(row.vendor_reserved,cap.vendor_reserved);assert.equal(row.vendor_spent,cap.vendor_spent);assert.equal(row.active_dispatches,cap.active_dispatches);
          await operator.query("update makeborne_private.generation_execution_caps set enabled=$2,emergency_stop=$3,vendor_limit=$4,concurrency_limit=$5 where scope=$1",[cap.scope,cap.enabled,cap.emergency_stop,cap.vendor_limit,cap.concurrency_limit]);
        }
        if(queueCreated){assert.match(schema,/^makeborne_queue_probe_[a-f0-9]{12}$/);await operator.query(`drop schema if exists "${schema}" cascade`);}
        console.log("PASS owned child stopped, probe schema/queue grants removed, fixture budgets stopped and known-zero cap receipts settled; original disabled cap policies restored");
      } catch{console.error("LOCAL WORKER CLEANUP UNCONFIRMED");process.exitCode=1;}
    }
    for(const pool of [worker,publisher])await pool?.end();
    if(operator)for(const name of createdLogins){try{assert.match(name,/^makeborne_(?:publisher|worker)_probe_[a-f0-9]{12}$/);await operator.query(`drop role "${name}"`);}catch{console.error("LOCAL TEMPORARY LOGIN REMOVAL UNCONFIRMED");process.exitCode=1;}}
    await operator?.end();
  }
}
