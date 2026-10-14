/** Dedicated SQL control channel. Never pass this object or its pool to a VM. */
const methods = Object.freeze({
  makeborne_publication_worker_attest: ['makeborne_publication_worker_attest', []],
  makeborne_publication_worker_candidates: ['makeborne_publication_worker_candidates', [['p_limit','integer']]],
  makeborne_claim_publication_preparation: ['makeborne_publication_worker_claim', [['p_preparation','uuid'],['p_worker','uuid']]],
  makeborne_load_publication_preparation: ['makeborne_publication_worker_load', [['p_preparation','uuid'],['p_worker','uuid'],['p_fence','bigint']]],
  makeborne_complete_publication_preparation: ['makeborne_publication_worker_complete', [['p_preparation','uuid'],['p_worker','uuid'],['p_fence','bigint'],['p_receipt','jsonb'],['p_output','text']]],
  makeborne_fail_publication_preparation: ['makeborne_publication_worker_fail', [['p_preparation','uuid'],['p_worker','uuid'],['p_fence','bigint'],['p_error','text']]],
  makeborne_publication_preparation_asset_locator: ['makeborne_publication_worker_asset_locator', [['p_preparation','uuid'],['p_worker','uuid'],['p_fence','bigint'],['p_asset','uuid']]],
  makeborne_publication_worker_sandbox_event: ['makeborne_publication_worker_sandbox_event', [['p_record','jsonb']]],
  makeborne_publication_worker_sandbox_cleanup_claim: ['makeborne_publication_worker_sandbox_cleanup_claim', [['p_worker','uuid'],['p_limit','integer']]],
  makeborne_publication_worker_sandbox_cleanup_finish: ['makeborne_publication_worker_sandbox_cleanup_finish', [['p_name','text'],['p_worker','uuid'],['p_cleanup_fence','bigint'],['p_state','text']]],
});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const invalid=()=>{throw Error('PUBLICATION_CONTROL_ARGUMENT_INVALID');};
function parameters(args, fields){
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length!==fields.length||fields.some(([key])=>!Object.hasOwn(args,key)))invalid();
  return fields.map(([key,type])=>{
    const value=args[key];
    if(type==='uuid'&&(typeof value!=='string'||!uuid.test(value)))invalid();
    if(type==='integer'&&(!Number.isInteger(value)||value<1||value>25))invalid();
    if(type==='bigint'&&(typeof value!=='string'||!(/^[1-9][0-9]{0,18}$/).test(value)||BigInt(value)>9223372036854775807n))invalid();
    if(type==='text'&&(typeof value!=='string'||Buffer.byteLength(value)>25_000_000||value.includes('\0')))invalid();
    if(key==='p_error'&&!/^PUBLICATION_[A-Z_]{1,100}$/.test(value))invalid();
    if(key==='p_name'&&!/^mbpub-(compiler|renderer)-[a-f0-9-]{36}$/.test(value))invalid();
    if(key==='p_state'&&!['stopped','cleanup_unconfirmed'].includes(value))invalid();
    if(type==='jsonb'){
      if(!value||typeof value!=='object'||Array.isArray(value))invalid();
      const serialized=JSON.stringify(value);if(Buffer.byteLength(serialized)>(key==='p_record'?4096:1_000_000))invalid();return serialized;
    }
    return value;
  });
}

/** pool is a node-postgres Pool configured with a dedicated login, max:1,
 * connectionTimeoutMillis:5000 and verified TLS. No service-role credential. */
export function publicationControl(pool){
  return async function rpc(name,args,outerSignal){
    if(!Object.hasOwn(methods,name))throw Error('PUBLICATION_CONTROL_METHOD_FORBIDDEN');
    const [target,fields]=methods[name],values=parameters(args,fields);
    const signal=AbortSignal.any([outerSignal,AbortSignal.timeout(10_000)]);
    signal.throwIfAborted();
    let client, released=false, rejectAbort;
    const release=destroy=>{if(client&&!released){released=true;client.release(destroy);}};
    const aborted=new Promise((_,reject)=>{rejectAbort=reject;});
    const abort=()=>{release(true);rejectAbort(signal.reason);};
    signal.addEventListener('abort',abort,{once:true});
    try{
      // Release a connection that arrives after cancellation; never leak a pool slot.
      const pending=pool.connect().then(acquired=>{client=acquired;if(signal.aborted){release(true);throw signal.reason;}return acquired;});
      await Promise.race([pending,aborted]);
      const query=(text,params)=>{signal.throwIfAborted();return Promise.race([client.query(text,params),aborted]);};
      await query('BEGIN');
      await query('SET LOCAL ROLE makeborne_publication_worker');
      await query("SET LOCAL statement_timeout = '5s'");
      await query("SET LOCAL lock_timeout = '2s'");
      const result=await query(`SELECT public.${target}(${fields.map(([key,type],index)=>`${key} => $${index+1}::${type}`).join(',')}) AS result`,values);
      if(result.rows?.length!==1||!Object.hasOwn(result.rows[0],'result'))throw Error('PUBLICATION_CONTROL_RESPONSE_INVALID');
      await query('COMMIT');signal.throwIfAborted();
      release(false);return result.rows[0].result;
    }catch(error){
      // Destroy instead of pooling an aborted/ambiguous transaction. PostgreSQL
      // rolls it back on disconnect; committed outcomes remain durable/replayable.
      release(true);throw error;
    }finally{signal.removeEventListener('abort',abort);}
  };
}
