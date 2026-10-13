import {reconcileVercelPublicationSandbox} from './vercel-publication-executor.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const required=['preparationId','workerId','fence','leaseUntil','name','kind','image','evidenceSha256','runtimeIdentity','latestExpectedExpiry','state'];
const optional=['sessionId','providerExpiresAt'];
const dates=new Set(['leaseUntil','latestExpectedExpiry','providerExpiresAt']);
const fail=()=>{throw Error('PUBLICATION_JOURNAL_INVALID');};
const positive=value=>typeof value==='string'&&/^[1-9][0-9]{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n;
// PostgreSQL retains microseconds; JS Date alone silently truncates them.
function instant(value){
  if(typeof value!=='string')fail();
  const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if(!match)fail();const ms=Date.parse(match[1]+match[3]);if(!Number.isFinite(ms))fail();
  return BigInt(ms)*1000n+BigInt((match[2]??'').padEnd(6,'0'));
}
function record(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||required.some(key=>!Object.hasOwn(value,key))
    ||Object.keys(value).some(key=>!required.includes(key)&&!optional.includes(key))
    ||Object.values(value).some(item=>typeof item!=='string')||Buffer.byteLength(JSON.stringify(value))>4096)fail();
  if(!UUID.test(value.preparationId)||!UUID.test(value.workerId)||!positive(value.fence)
    ||!['compiler','renderer'].includes(value.kind)||!new RegExp('^mbpub-'+value.kind+'-'+UUID.source.slice(1,-1)+'$').test(value.name)
    ||!/^(?:vcr\.vercel\.com\/)?[a-z0-9][a-z0-9_/-]*@sha256:[a-f0-9]{64}$/.test(value.image)
    ||!/^[a-f0-9]{64}$/.test(value.evidenceSha256)
    ||!(value.kind==='compiler'?/^sha256:[a-f0-9]{64}$/:/^chromium-[0-9.]+-controller-[a-f0-9]{64}$/).test(value.runtimeIdentity)
    ||!['creating','running','stopped','cleanup_unconfirmed'].includes(value.state))fail();
  if(Object.hasOwn(value,'sessionId')!==Object.hasOwn(value,'providerExpiresAt')
    ||(value.sessionId!==undefined&&(!value.sessionId||value.sessionId.length>128||/[\x00-\x1f\x7f]/.test(value.sessionId)))
    ||(value.state==='running'&&!value.sessionId))fail();
  const deadline=instant(value.leaseUntil),expiry=instant(value.latestExpectedExpiry);
  if(expiry>deadline-5_000_000n||(value.providerExpiresAt&&instant(value.providerExpiresAt)>expiry))fail();
  return structuredClone(value);
}
function sameRecord(expected,actual){
  const parsed=record(actual);
  if(Object.keys(expected).length!==Object.keys(parsed).length||Object.keys(expected).some(key=>
    dates.has(key)?instant(expected[key])!==instant(parsed[key]):expected[key]!==parsed[key]))fail();
  return parsed;
}

/** Host-only persistence. Cleanup uses its own short signal, independent of a
 * cancelled build. Database acknowledgement must match before provisioning. */
export function publicationLifecycleJournal(rpc){
  return async value=>{
    const submitted=record(value);
    const saved=await rpc('makeborne_publication_worker_sandbox_event',{p_record:submitted},AbortSignal.timeout(5000));
    return sameRecord(submitted,saved);
  };
}

/** One cleanup claim at a time fits the 30-second SQL cleanup lease. An unresolved
 * resource pauses new work even when another process owns it or backoff is due.
 * Valid active executions elsewhere are excluded by the database, not guessed here. */
export function publicationCleanupGate({rpc,transport,now=Date.now,maxPerPass=25}){
  if(typeof rpc!=='function'||typeof transport?.get!=='function'||!Number.isInteger(maxPerPass)||maxPerPass<1||maxPerPass>25)fail();
  return async (workerId,signal)=>{
    if(!UUID.test(workerId))fail();
    for(let index=0;index<=maxPerPass;index++){
      signal.throwIfAborted();
      // The final observation cannot acquire work we will not attempt.
      if(index===maxPerPass)throw Error('PUBLICATION_CLEANUP_PENDING');
      const result=await rpc('makeborne_publication_worker_sandbox_cleanup_claim',{p_worker:workerId,p_limit:1},signal);
      signal.throwIfAborted();
      if(!result||Object.keys(result).length!==2||!Array.isArray(result.records)||result.records.length>1
        ||!Number.isSafeInteger(result.pending)||result.pending<result.records.length)fail();
      if(result.pending===0){if(result.records.length)fail();return;}
      if(!result.records.length)throw Error('PUBLICATION_CLEANUP_PENDING');
      const claimed=result.records[0];
      if(!claimed||Object.keys(claimed).length!==3||!positive(claimed.cleanupFence))fail();
      const original=record(claimed.record),deadline=instant(claimed.cleanupLeaseUntil);
      if(original.state!=='cleanup_unconfirmed'||deadline<BigInt(now()+10_000)*1000n||deadline>BigInt(now()+31_000)*1000n)fail();
      await reconcileVercelPublicationSandbox({transport,record:original,onLifecycle:async value=>{
        const proposed=sameRecord({...original,state:value.state},value);
        if(!['stopped','cleanup_unconfirmed'].includes(proposed.state))fail();
        const saved=await rpc('makeborne_publication_worker_sandbox_cleanup_finish',{
          p_name:original.name,p_worker:workerId,p_cleanup_fence:claimed.cleanupFence,p_state:proposed.state,
        },AbortSignal.timeout(5000));
        sameRecord(proposed,saved);
      }});
    }
  };
}
