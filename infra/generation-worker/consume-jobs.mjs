import {randomUUID} from "node:crypto";
import {GENERATION_QUEUE} from "./publish-outbox.mjs";
import {assertGenerationRole} from "./queue-runtime.mjs";
import {approvedGenerationInput} from "./approved-input.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const workerError = code => Object.assign(new Error(code), {code});
function boundedInteger(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) throw workerError(`INVALID_${name}`);
}
function messageIdentity(job) {
  const data = job?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)
    || Object.keys(data).sort().join(",") !== "eventId,jobId,workspaceId"
    || ![job.id, data.eventId, data.jobId, data.workspaceId].every(value => typeof value === "string" && uuid.test(value))
    || job.id !== data.eventId) throw workerError("INVALID_QUEUE_IDENTITY");
  return data;
}

/** Separate consumer, never imported into the app server. The caller owns an
 * already provisioned restricted-role pool/boss and their eventual closure.
 * execute must attest a confirmed outcome through capped DB functions; a return
 * value alone cannot finish a job. No provider is installed/enabled by default. */
export async function startGenerationWorker({boss, pool, execute, workerId = randomUUID(), leaseSeconds = 30,
  heartbeatMs = 5000, maxRuntimeMs = 90000, shutdownTimeoutMs = 10000}) {
  if (typeof execute !== "function" || !uuid.test(workerId)) throw workerError("WORKER_CONFIGURATION_REQUIRED");
  boundedInteger(leaseSeconds, 1, 120, "LEASE");
  boundedInteger(heartbeatMs, 100, Math.floor(leaseSeconds * 1000 / 3), "HEARTBEAT");
  boundedInteger(maxRuntimeMs, 100, 90000, "RUNTIME");
  boundedInteger(shutdownTimeoutMs, 100, 30000, "SHUTDOWN");
  await assertGenerationRole(pool, "makeborne_generation_worker");
  const controllers = new Set(), active = new Set();
  let stopping = false, stoppingPromise;

  async function consume(job) {
    if (stopping) throw workerError("WORKER_SHUTTING_DOWN");
    const data = messageIdentity(job);
    const result = await pool.query("select makeborne_private.lease_queued_generation_job($1,$2,$3,$4,$5,$6) as lease",
      [data.eventId, job.id, data.jobId, data.workspaceId, workerId, leaseSeconds]);
    const lease = result.rows[0]?.lease;
    if (lease?.state === "terminal" || lease?.state === "review") return {state: lease.state};
    if (lease?.state === "busy") throw workerError("JOB_LEASE_BUSY");
    if (lease?.state !== "leased" || lease.jobId !== data.jobId || lease.workspaceId !== data.workspaceId
      || lease.workerId !== workerId || !/^[1-9][0-9]{0,15}$/.test(lease.fence)
      || BigInt(lease.fence) > 9007199254740991n || !Number.isFinite(Date.parse(lease.deadlineAt))) {
      throw workerError("INVALID_LEASE_RECEIPT");
    }
    const controller = new AbortController(); controllers.add(controller);
    const remaining = Math.min(maxRuntimeMs, Date.parse(lease.deadlineAt) - Date.now());
    const abort = code => {if (!controller.signal.aborted) controller.abort(workerError(code));};
    let heartbeatTimer, heartbeatPending, finished = false, deadlineTimer, abortListener;
    const heartbeat = async () => {
      if (finished || controller.signal.aborted) return;
      try {
        const renewed = await pool.query("select makeborne_private.renew_generation_job_lease($1,$2,$3,$4) as renewed",
          [data.jobId, workerId, lease.fence, leaseSeconds]);
        if (renewed.rows[0]?.renewed !== true) abort("WORKER_LEASE_LOST");
      } catch {abort("WORKER_HEARTBEAT_UNCONFIRMED");}
      if (!finished && !controller.signal.aborted) heartbeatTimer = setTimeout(startHeartbeat, heartbeatMs);
    };
    function startHeartbeat() {heartbeatPending = heartbeat();}
    const aborted = new Promise((_, reject) => {
      abortListener = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", abortListener, {once: true});
    });
    let failure, released;
    try {
      if (stopping) abort("WORKER_SHUTTING_DOWN");
      if (remaining <= 0) abort("WORKER_DEADLINE_EXCEEDED");
      else deadlineTimer = setTimeout(() => abort("WORKER_DEADLINE_EXCEEDED"), remaining);
      heartbeatTimer = setTimeout(startHeartbeat, heartbeatMs);
      // Check abort before invoking an executor, including shutdown during the
      // initial database roundtrip. Never begin paid work on a lost lease.
      await Promise.race([aborted, Promise.resolve().then(async () => {
        controller.signal.throwIfAborted();
        // Read only this job's exact approved input, under its live fence. The
        // capped dispatch function independently repeats the database authority
        // check; loading a prompt is never a permission receipt for later spend.
        const approvedInput = (await pool.query("select makeborne_private.load_generation_worker_input($1,$2,$3) as input",
          [data.jobId, workerId, lease.fence])).rows[0]?.input;
        controller.signal.throwIfAborted();
        if (!approvedInput || typeof approvedInput !== "object") throw workerError("WORKER_INPUT_UNCONFIRMED");
        return execute(Object.freeze({...lease, approvedInput: approvedGenerationInput(lease, approvedInput)}), controller.signal);
      })]);
    } catch {failure = workerError(controller.signal.aborted ? controller.signal.reason.code : "WORKER_EXECUTION_UNCONFIRMED");}
    finally {
      finished = true; clearTimeout(heartbeatTimer); clearTimeout(deadlineTimer);
      await heartbeatPending;
      controller.signal.removeEventListener("abort", abortListener);
      controllers.delete(controller);
      try {
        released = (await pool.query("select makeborne_private.yield_generation_job_lease($1,$2,$3) as state",
          [data.jobId, workerId, lease.fence])).rows[0]?.state;
      } catch {throw workerError("WORKER_RELEASE_UNCONFIRMED");}
    }
    if (released === "review" || released === "terminal" || released === "reconciliation") return {state: released};
    if (failure) throw failure;
    throw workerError(released === "stale" ? "WORKER_LEASE_LOST" : "WORKER_RESULT_NOT_CONFIRMED");
  }

  const consumerId = await boss.work(GENERATION_QUEUE, {batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 0.5}, jobs => {
    if (jobs.length !== 1) throw workerError("INVALID_QUEUE_BATCH");
    const run = consume(jobs[0]); active.add(run);
    run.then(() => active.delete(run), () => active.delete(run));
    return run;
  });
  return Object.freeze({workerId, consumerId, async stop() {
    if (stoppingPromise) return stoppingPromise;
    stopping = true;
    stoppingPromise = (async () => {
      // Stop fetching first; abort any current operation, then wait within a
      // bound. The owner must terminate an uncooperative executor process.
      const off = boss.offWork(GENERATION_QUEUE, {id: consumerId, wait: false});
      for (const controller of controllers) controller.abort(workerError("WORKER_SHUTTING_DOWN"));
      let timer;
      try {
        await Promise.race([Promise.all([...active].map(run => run.catch(() => {})).concat(off)), new Promise((_, reject) => {
          timer = setTimeout(() => reject(workerError("WORKER_SHUTDOWN_UNCONFIRMED")), shutdownTimeoutMs);
        })]);
      } catch {throw workerError("WORKER_SHUTDOWN_UNCONFIRMED");}
      finally {clearTimeout(timer);}
    })();
    return stoppingPromise;
  }});
}
