/** Operator-only adapter for @vercel/sandbox 3.7.0. No request handlers import this.
 * SDK credentials remain in the transport closure; only workload bytes cross the VM boundary.
 * No image is qualified by this module: deployment must supply independently reviewed mappings. */
import {randomUUID} from 'node:crypto';
import {SDK_VERSION,LIMITS,sha,fail,exactKeys,encodeWorkload,validateReceipt,encodeRender} from './vercel-publication-protocol.mjs';

export {SDK_VERSION};
const HASH=/^[a-f0-9]{64}$/;
const IMAGE=/^(?:vcr\.vercel\.com\/)?[a-z0-9][a-z0-9_/-]*@sha256:[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const RESERVE=5000, CREATE_BUDGET=10000, CLEANUP_BUDGET=4000;
const READY_SCRIPT="const fs=require('node:fs');const end=Date.now()+Number(process.argv[1]);const check=()=>{if(fs.existsSync('/tmp/build-complete'))process.exit(0);if(Date.now()>end)process.exit(124);setTimeout(check,100)};check()";

/** Supply the actual Sandbox class from the EXACT pinned SDK. No SDK dependency
 * is auto-installed/imported and no credentials are accepted from workload input. */
export function vercelSandboxTransport(Sandbox,credentials) {
  if(typeof Sandbox?.create!=='function'||typeof Sandbox?.get!=='function')fail('SDK_INVALID');
  if(credentials!==undefined&&(!exactKeys(credentials,['token','teamId','projectId'])
    ||Object.values(credentials).some(value=>typeof value!=='string'||!value)))fail('SDK_CREDENTIALS_INVALID');
  const auth=credentials?{...credentials}:{};
  return Object.freeze({
    create:params=>Sandbox.create({...auth,...params}),
    get:params=>Sandbox.get({...auth,...params}),
  });
}

/** Race even transports that fail to honor AbortSignal, while consuming late
 * rejections. Cloud TTL and finally cleanup remain the actual process boundary. */
async function bounded(start,signal) {
  signal.throwIfAborted();
  // Attach race handlers before invoking the SDK; an abort between stages must
  // neither start another mutation nor leave its rejection unobserved.
  const promise=Promise.resolve().then(()=>{signal.throwIfAborted();return start();});
  let abort;
  try{return await Promise.race([promise,new Promise((_,reject)=>{
    abort=()=>reject(Error('PUBLICATION_EXECUTION_CANCELLED'));signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted)abort();
  })]);}finally{if(abort)signal.removeEventListener('abort',abort);}
}
function deadlineSignal(signal,milliseconds) {
  return AbortSignal.any([signal,AbortSignal.timeout(Math.max(1,Math.floor(milliseconds)))]);
}
export async function readRemoteBounded(sandbox,path,maxBytes,signal,{optional=false}={}) {
  signal.throwIfAborted();
  const stream=await bounded(()=>sandbox.readFile({path},{signal}),signal);
  if(!stream){if(optional)return null;fail('OUTPUT_MISSING');}
  // SDK 3.7.0 returns a Node Readable, not a Web ReadableStream.
  if(typeof stream[Symbol.asyncIterator]!=='function'||typeof stream.destroy!=='function')fail('SDK_STREAM_INVALID');
  let total=0;const chunks=[];
  const abort=()=>stream.destroy(Error('PUBLICATION_EXECUTION_CANCELLED'));
  signal.addEventListener('abort',abort,{once:true});
  try {
    const iterator=stream[Symbol.asyncIterator]();
    while(true) {
      const item=await bounded(()=>iterator.next(),signal);if(item.done)break;
      if(!(item.value instanceof Uint8Array))fail('OUTPUT_INVALID');
      total+=item.value.byteLength;if(total>maxBytes)fail('OUTPUT_LIMIT');
      chunks.push(Buffer.from(item.value));
    }
    signal.throwIfAborted();return Buffer.concat(chunks,total);
  } finally {signal.removeEventListener('abort',abort);stream.destroy();}
}
function approvedMapping(config) {
  const clone=structuredClone(config);
  if(!exactKeys(clone,['compiler','renderer'])||!exactKeys(clone.compiler,['image','runtimeImageId','evidenceSha256'])
    ||!exactKeys(clone.renderer,['image','rendererId','evidenceSha256'])
    ||!IMAGE.test(clone.compiler.image)||!IMAGE.test(clone.renderer.image)
    ||!/^sha256:[a-f0-9]{64}$/.test(clone.compiler.runtimeImageId)
    ||!/^chromium-[0-9.]+-controller-[a-f0-9]{64}$/.test(clone.renderer.rendererId)
    ||!HASH.test(clone.compiler.evidenceSha256)||!HASH.test(clone.renderer.evidenceSha256))fail('EXECUTOR_UNQUALIFIED');
  // runtimeImageId may be a Docker config ID, whereas image pins a registry
  // manifest. evidenceSha256 binds the operator's explicit reviewed mapping.
  return Object.freeze({compiler:Object.freeze(clone.compiler),renderer:Object.freeze(clone.renderer)});
}
async function stopConfirmed(sandbox,name,signal,expectedSessionId) {
  if(sandbox.name!==name)fail('CLEANUP_RECORD_INVALID');
  const sessionId=sandbox.currentSession()?.sessionId;
  if(typeof sessionId!=='string'||!sessionId)fail('CLEANUP_UNCONFIRMED');
  if(expectedSessionId!==undefined&&sessionId!==expectedSessionId)fail('CLEANUP_UNCONFIRMED');
  const result=await bounded(()=>sandbox.stop({signal}),signal);
  if(result?.id!==sessionId||!['stopped','failed','aborted'].includes(result.status))fail('CLEANUP_UNCONFIRMED');
}

/** cleanup-only restart reconciliation. Never resumes or executes a recovered VM.
 * The durable supervisor must retain unresolved records and retry independently. */
export async function reconcileVercelPublicationSandbox({transport,record,onLifecycle}) {
  if(!record||!/^mbpub-(compiler|renderer)-[a-f0-9-]{36}$/.test(record.name)||typeof onLifecycle!=='function')fail('CLEANUP_RECORD_INVALID');
  const signal=AbortSignal.timeout(CLEANUP_BUDGET);
  try {
    const sandbox=await bounded(()=>transport.get({name:record.name,resume:false,signal}),signal);
    await stopConfirmed(sandbox,record.name,signal,record.sessionId);
    await bounded(()=>onLifecycle({...record,state:'stopped'}),signal);
  } catch {
    await bounded(()=>onLifecycle({...record,state:'cleanup_unconfirmed'}),AbortSignal.timeout(CLEANUP_BUDGET)).catch(()=>{});
    fail('CLEANUP_UNCONFIRMED');
  }
}

/** New instance per authoritative claim. onLifecycle MUST durably commit its
 * record before resolving. Missing journal is rejected, never treated as telemetry.
 * Add store/sitesDomain outside this executor; neither enters Sandbox. */
export function vercelPublicationExecutor({transport,approved,context,onLifecycle,now=Date.now}) {
  if(typeof transport?.create!=='function'||typeof transport?.get!=='function'||typeof onLifecycle!=='function')fail('EXECUTOR_CONFIG_INVALID');
  const mapping=approvedMapping(approved);
  if(!context||!UUID.test(context.preparationId)||!UUID.test(context.workerId)||!/^[1-9][0-9]*$/.test(String(context.fence))
    ||typeof context.leaseUntil!=='string'||!Number.isFinite(Date.parse(context.leaseUntil)))fail('LEASE_CONTEXT_INVALID');
  const claim=Object.freeze({preparationId:context.preparationId,workerId:context.workerId,fence:String(context.fence),leaseUntil:context.leaseUntil});
  const leaseEnd=Date.parse(claim.leaseUntil);
  let active=false;
  const run=async(kind,signal,work)=>{
    if(active)fail('EXECUTOR_CONCURRENT');
    signal.throwIfAborted();
    const remaining=leaseEnd-now()-RESERVE;
    // Leave creation and independent cleanup time before the authority expires.
    const ttl=Math.min(kind==='compiler'?75000:35000,remaining-CREATE_BUDGET-CLEANUP_BUDGET);
    if(!Number.isInteger(ttl)||ttl<5000)fail('LEASE_EXPIRED');
    active=true;
    const execution=deadlineSignal(signal,remaining-CLEANUP_BUDGET);
    const selected=mapping[kind],name='mbpub-'+kind+'-'+randomUUID();
    const record={...claim,name,kind,image:selected.image,evidenceSha256:selected.evidenceSha256,
      runtimeIdentity:kind==='compiler'?selected.runtimeImageId:selected.rendererId,
      latestExpectedExpiry:new Date(leaseEnd-RESERVE).toISOString()};
    let sandbox,createdPromise,creationStarted=false,result,error;
    const journal=state=>bounded(()=>onLifecycle({...record,state}),execution);
    try {
      await journal('creating');
      const createTtl=Math.floor(Math.min(ttl,leaseEnd-now()-RESERVE-CREATE_BUDGET-CLEANUP_BUDGET));
      if(createTtl<5000)fail('LEASE_EXPIRED');
      const createSignal=deadlineSignal(execution,CREATE_BUDGET);
      sandbox=await bounded(()=>{
        creationStarted=true;
        createdPromise=Promise.resolve(transport.create({name,image:selected.image,persistent:false,networkPolicy:'deny-all',
          ports:[],mounts:{},resources:{vcpus:1},env:{},timeout:createTtl,
          tags:{purpose:'trusted-publication',preparation:claim.preparationId,fence:claim.fence,kind},signal:createSignal}));
        return createdPromise;
      },createSignal);
      // SDK Sandbox workload helpers auto-resume stopped sessions. Pin the
      // original Session instead: its IO/commands address only this session ID.
      const session=sandbox.currentSession();
      const expires=sandbox.expiresAt?.getTime();
      const sessionExpires=(session.startedAt??session.createdAt)?.getTime()+session.timeout;
      if(sandbox.name!==name||sandbox.image!==selected.image||sandbox.persistent!==false
        ||session.status!=='running'||!Number.isInteger(session.timeout)||session.timeout<=0||session.timeout>createTtl
        ||!Number.isFinite(expires)||expires!==sessionExpires||expires>leaseEnd-RESERVE||expires<=now())fail('SANDBOX_IDENTITY_INVALID');
      record.sessionId=session.sessionId;
      if(typeof record.sessionId!=='string'||!record.sessionId||record.sessionId.length>128)fail('SANDBOX_IDENTITY_INVALID');
      record.providerExpiresAt=new Date(expires).toISOString();
      await journal('running');
      const stageBudget=Math.min(expires,leaseEnd-RESERVE)-now()-CLEANUP_BUDGET;
      if(stageBudget<100)fail('LEASE_EXPIRED');
      result=await work(session,deadlineSignal(execution,stageBudget),stageBudget);
      execution.throwIfAborted();
    } catch(caught) {error=caught;}
    finally {
      if(creationStarted) {
        // A lost create response may still have created the named VM. get does
        // not resume; stop itself never resumes. A 404 is not proof of absence.
        const cleanupSignal=AbortSignal.timeout(CLEANUP_BUDGET);
        try {
          if(!sandbox)sandbox=await bounded(()=>transport.get({name,resume:false,signal:cleanupSignal}),cleanupSignal);
          await stopConfirmed(sandbox,name,cleanupSignal,record.sessionId);
          await bounded(()=>onLifecycle({...record,state:'stopped'}),cleanupSignal);
        } catch {
          // A very late successful create handle gets a best-effort second stop;
          // the durable unknown record is retained regardless for reconciliation.
          if(createdPromise)void createdPromise.then(late=>stopConfirmed(late,name,AbortSignal.timeout(CLEANUP_BUDGET),record.sessionId)).catch(()=>{});
          await bounded(()=>onLifecycle({...record,state:'cleanup_unconfirmed'}),AbortSignal.timeout(CLEANUP_BUDGET)).catch(()=>{});
          error=Error('PUBLICATION_CLEANUP_UNCONFIRMED');
        }
      } else {
        // No SDK create was invoked (for example the journal consumed the
        // remaining lease). Close the durable intent without remote discovery.
        await bounded(()=>onLifecycle({...record,state:'stopped'}),AbortSignal.timeout(CLEANUP_BUDGET)).catch(()=>{});
      }
      active=false;
    }
    if(error)throw error;return result;
  };
  async function command(sandbox,signal,params,timeoutMs) {
    if(timeoutMs<100)fail('LEASE_EXPIRED');
    const cmd=await bounded(()=>sandbox.runCommand({...params,cwd:'/tmp',detached:true,sudo:false,timeoutMs:Math.floor(timeoutMs),signal}),signal);
    return cmd;
  }
  return Object.freeze({
    qualifiedRuntimeImageId:mapping.compiler.runtimeImageId,qualifiedRendererId:mapping.renderer.rendererId,
    async compile(workload,signal) {
      // Capture bounded request bytes before asynchronous work so caller mutation
      // cannot change which workload the receipt must match.
      const input=encodeWorkload(workload),expected=JSON.parse(input.toString('utf8'));
      return run('compiler',signal,async(sandbox,execution,budget)=>{
        await bounded(()=>sandbox.writeFiles([{path:'/input/request.json',content:input,mode:0o600}],{signal:execution}),execution);
        const ttl=Math.floor(Math.min(65000,budget));
        await command(sandbox,execution,{cmd:'node',args:['/opt/makeborne/watchdog.mjs'],
          env:{NODE_ENV:'production',HOME:'/tmp',MAKEBORNE_RUNTIME_IMAGE:mapping.compiler.runtimeImageId,MAKEBORNE_RUNTIME_TTL_MS:String(ttl)}},ttl);
        const ready=await command(sandbox,execution,{cmd:'node',args:['-e',READY_SCRIPT,String(Math.min(60000,ttl-2000))],env:{}},Math.min(60000,ttl-1000));
        const finished=await bounded(()=>ready.wait({signal:execution}),execution);
        if(finished.exitCode!==0)fail('COMPILE_FAILED');
        const raw=await readRemoteBounded(sandbox,'/tmp/result/makeborne-build.json',LIMITS.receipt,execution);
        const receipt=validateReceipt(JSON.parse(raw.toString('utf8')),expected,mapping.compiler.runtimeImageId);
        const files=new Map();
        for(const file of receipt.files) {
          const bytes=await readRemoteBounded(sandbox,'/tmp/result/'+file.path,file.bytes,execution);
          if(bytes.length!==file.bytes||sha(bytes)!==file.sha256)fail('BUILD_BYTES_MISMATCH');
          files.set(file.path,bytes);
        }
        let disposed=false;
        return {receipt,readFile:async(path,maxBytes,readSignal)=>{
          readSignal.throwIfAborted();
          const bytes=files.get(path);
          if(disposed||!bytes||bytes.length!==maxBytes)fail('BUILD_FILE_NOT_LISTED');
          return Buffer.from(bytes);
        },dispose:async()=>{disposed=true;files.clear();}};
      });
    },
    async render(input) {
      return run('renderer',input.signal,async(sandbox,execution,budget)=>{
        const timeoutMs=Math.floor(Math.min(15000,budget-2000));
        if(timeoutMs<100)fail('LEASE_EXPIRED');
        const bytes=encodeRender(input,mapping.renderer.rendererId,timeoutMs);
        await bounded(()=>sandbox.writeFiles([{path:'/vercel/sandbox/render-input.json',content:bytes,mode:0o600}],{signal:execution}),execution);
        const cmd=await command(sandbox,execution,{cmd:'node',args:['/opt/makeborne/vercel-publication-render-watchdog.mjs'],
          env:{NODE_ENV:'production',HOME:'/tmp',MAKEBORNE_RENDER_TTL_MS:String(timeoutMs+1000)}},Math.min(budget,timeoutMs+1500));
        const finished=await bounded(()=>cmd.wait({signal:execution}),execution);
        if(finished.exitCode!==0)fail('RENDER_FAILED');
        const raw=await readRemoteBounded(sandbox,'/vercel/sandbox/render-result.json',LIMITS.renderResult,execution);
        const result=JSON.parse(raw.toString('utf8'));
        if(!exactKeys(result,['html','rendererId'])||result.rendererId!==mapping.renderer.rendererId
          ||typeof result.html!=='string'||Buffer.byteLength(result.html)>LIMITS.html)fail('RENDERER_UNQUALIFIED');
        return result;
      });
    },
  });
}

