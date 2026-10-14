import {randomUUID} from "node:crypto";
import {assertGenerationRole} from "./queue-runtime.mjs";
const failure = code => Object.assign(new Error(code), {code});

/** Separate restricted builder process. project_builds is its transactional work
 * queue; heartbeat failure never triggers a model call or customer settlement.
 * The operator owns pool closure and must terminate uncooperative executors. */
export async function startProjectBuildWorker({pool, execute, workerId = randomUUID(), leaseSeconds = 30,
  heartbeatMs = 5000, pollingMs = 1000, shutdownTimeoutMs = 10000, report = () => {}}) {
  if (typeof execute !== "function" || !/^[0-9a-f-]{36}$/.test(workerId)
    || !Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 120
    || !Number.isInteger(heartbeatMs) || heartbeatMs < 100 || heartbeatMs > leaseSeconds * 1000 / 3
    || !Number.isInteger(pollingMs) || pollingMs < 100 || pollingMs > 10000
    || !Number.isInteger(shutdownTimeoutMs) || shutdownTimeoutMs < 100 || shutdownTimeoutMs > 30000) throw failure("BUILD_WORKER_CONFIGURATION_INVALID");
  await assertGenerationRole(pool, "makeborne_project_builder");
  let stopping = false, timer, current, controller, stopPromise;
  async function run() {
    let heartbeatTimer, heartbeatPending, deadlineTimer, finished = false;
    try {
      const id = (await pool.query("select makeborne_private.next_project_build() as id")).rows[0]?.id;
      if (!id || stopping) return;
      const lease = (await pool.query("select makeborne_private.lease_project_build($1,$2,$3) as lease", [id,workerId,leaseSeconds])).rows[0]?.lease;
      if (lease?.state === "terminal" || lease?.state === "busy") return;
      if (lease?.state !== "leased" || lease.jobId !== id || lease.workerId !== workerId
        || !/^[1-9][0-9]{0,15}$/.test(lease.fence) || !Number.isFinite(Date.parse(lease.deadlineAt))) throw failure("BUILD_LEASE_UNCONFIRMED");
      controller = new AbortController();
      const abort = code => {if (!controller.signal.aborted) controller.abort(failure(code));};
      const heartbeat = async () => {
        if (finished || controller.signal.aborted) return;
        try {
          const renewed = (await pool.query("select makeborne_private.renew_project_build($1,$2,$3,$4) as renewed", [id,workerId,lease.fence,leaseSeconds])).rows[0]?.renewed;
          if (renewed !== true) abort("BUILD_LEASE_LOST");
        } catch {abort("BUILD_HEARTBEAT_UNCONFIRMED");}
        if (!finished && !controller.signal.aborted) heartbeatTimer = setTimeout(() => {heartbeatPending = heartbeat();}, heartbeatMs);
      };
      if (stopping) abort("BUILD_WORKER_SHUTTING_DOWN");
      const remaining = Math.min(90000, Date.parse(lease.deadlineAt) - Date.now());
      if (remaining <= 0) abort("BUILD_DEADLINE_EXCEEDED");
      else deadlineTimer = setTimeout(() => abort("BUILD_DEADLINE_EXCEEDED"), remaining);
      heartbeatTimer = setTimeout(() => {heartbeatPending = heartbeat();}, heartbeatMs);
      controller.signal.throwIfAborted();
      // Await actual cleanup, not merely an abort race: output must not be left
      // running while a new build is claimed. Operator stop has its own bound.
      await execute(Object.freeze(lease), controller.signal);
    } catch {report({code: "BUILD_EXECUTION_UNCONFIRMED"});}
    finally {
      finished = true; clearTimeout(heartbeatTimer); clearTimeout(deadlineTimer);
      await heartbeatPending; controller = undefined;
      if (!stopping) timer = setTimeout(tick, pollingMs);
    }
  }
  function tick() {current = run();}
  tick();
  return Object.freeze({workerId, async stop() {
    if (stopPromise) return stopPromise;
    stopping = true; clearTimeout(timer); controller?.abort(failure("BUILD_WORKER_SHUTTING_DOWN"));
    stopPromise = (async () => {
      let timeout;
      try {await Promise.race([current, new Promise((_, reject) => {timeout = setTimeout(() => reject(failure("BUILD_SHUTDOWN_UNCONFIRMED")), shutdownTimeoutMs);})]);}
      finally {clearTimeout(timeout);}
    })();
    return stopPromise;
  }});
}
