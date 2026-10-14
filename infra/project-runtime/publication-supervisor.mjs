import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** One active preparation per process. SQL fences coordinate other processes;
 * restarting this loop discovers queued work and expired leases from the DB.
 * The owner must run this as a supervised service, not a Next request callback. */
export async function supervisePublications({rpc,run,signal,workerId=randomUUID(),
  beforePoll=async()=>{},beforeRun=async()=>{},emit=()=>{},wait=(ms,abort)=>pause(ms,undefined,{signal:abort}),pollMs=5000}){
  if(!uuid.test(workerId)||!Number.isInteger(pollMs)||pollMs<1000||pollMs>60_000)throw Error('PUBLICATION_SUPERVISOR_CONFIG_INVALID');
  let failures=0;
  const event=(type,extra={})=>{try{emit({type,workerId,...extra});}catch{/* Telemetry cannot abandon an active lease. */}};
  event('started');
  while(!signal.aborted){
    try{
      await beforePoll(workerId,signal);
      signal.throwIfAborted();
      const rows=await rpc('makeborne_publication_worker_candidates',{p_limit:10},signal);
      signal.throwIfAborted();
      if(!Array.isArray(rows)||rows.length>10||rows.some(row=>!row||Object.keys(row).length!==1||!uuid.test(row.id))||new Set(rows.map(row=>row.id)).size!==rows.length)throw Error('PUBLICATION_CANDIDATES_INVALID');
      for(const {id} of rows){
        // Recovery admission is outside the per-candidate catch: an unresolved
        // resource pauses the entire process, not just one customer's attempt.
        await beforeRun(workerId,signal);
        signal.throwIfAborted();event('attempt_started',{preparationId:id});
        try{
          const result=await run(id,workerId,signal);
          if(!['completed','not_claimed'].includes(result?.state))throw Error('PUBLICATION_WORKER_RESULT_INVALID');
          event(result.state,{preparationId:id});
        }catch(error){
          if(signal.aborted)throw error;
          // Never log database errors, SQL arguments, source, URLs or credentials.
          event('attempt_failed',{preparationId:id,code:typeof error?.message==='string'&&/^PUBLICATION_[A-Z_]{1,100}$/.test(error.message)?error.message:'PUBLICATION_PREPARATION_FAILED'});
        }
      }
      failures=0;
      // Always pause, including contended/unclaimable queues: no hot retry loop.
      await wait(pollMs,signal);
    }catch{
      if(signal.aborted)break;
      failures=Math.min(failures+1,6);
      const delay=Math.min(60_000,pollMs*2**failures);
      event('control_unavailable',{retryInMs:delay});
      try{await wait(delay,signal);}catch(waitError){if(!signal.aborted)throw waitError;}
    }
  }
  event('stopped');
}
