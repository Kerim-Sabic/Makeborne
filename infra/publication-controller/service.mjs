import {randomUUID} from 'node:crypto';
import {attestController} from './attestation.mjs';
import {scopedPublicationControl} from './scope.mjs';
const types=new Set(['started','stopped','attempt_started','completed','not_claimed','attempt_failed','control_unavailable','startup_verified','shutdown_requested','shutdown_timeout','pool_close_timeout','fatal']);
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function safeEvent(event){
 const out={type:types.has(event?.type)?event.type:'fatal'};
 for(const k of ['workerId','preparationId'])if(typeof event?.[k]==='string'&&uuid.test(event[k]))out[k]=event[k];
 if(typeof event?.code==='string'&&/^PUBLICATION_[A-Z_]{1,100}$/.test(event.code))out.code=event.code;
 if(Number.isInteger(event?.retryInMs)&&event.retryInMs>=0&&event.retryInMs<=60000)out.retryInMs=event.retryInMs;
 return out;
}
const timeout=(ms,fn)=>{const timer=setTimeout(fn,ms);return()=>clearTimeout(timer);};
/** All credentials remain in trusted host adapters. Tests inject transports;
 * the executable only supplies the fixed production implementations. */
export async function runService(config,deps,parent,{emit=()=>{},shutdownMs=20000,closeMs=5000}={}){
 parent.throwIfAborted();const local=new AbortController(),signal=AbortSignal.any([parent,local.signal]);
 const log=event=>{try{emit(safeEvent(event));}catch{/* Logging cannot interrupt cleanup. */}};
 const pool=new deps.Pool(config.database);const poolError=()=>local.abort(Error('PUBLICATION_DATABASE_UNAVAILABLE'));pool.on('error',poolError);
 let cancelDeadline=()=>{},timedOut=false,stoppedCleanup;
 const stopped=new Promise((_,reject)=>{const onAbort=()=>{log({type:'shutdown_requested'});cancelDeadline=timeout(shutdownMs,()=>{timedOut=true;log({type:'shutdown_timeout'});reject(Error('PUBLICATION_CONTROLLER_SHUTDOWN_TIMEOUT'));});};
  signal.addEventListener('abort',onAbort,{once:true});stoppedCleanup=()=>signal.removeEventListener('abort',onAbort);});
 try{
  await attestController(pool,config,signal);signal.throwIfAborted();log({type:'startup_verified'});
  const rpc=scopedPublicationControl(deps.publicationControl(pool),config),transport=deps.vercelSandboxTransport(deps.Sandbox,config.vercel);
  const store=deps.createR2S3OutputStore(config.output),download=deps.publicationSourceDownloader(config.broker);
  const resolveArtwork=deps.publicationArtworkResolver({rpc,download});signal.throwIfAborted();
  await Promise.race([deps.runPublicationController({pool,rpc,transport,approved:config.approved,store,resolveArtwork,
   runPreparation:deps.runPublicationPreparation,sitesDomain:config.sitesDomain,workerId:randomUUID(),signal,emit:log}),stopped]);
 }finally{
  cancelDeadline();stoppedCleanup?.();
  let cancelClose;const closeTimeout=new Promise((_,reject)=>cancelClose=timeout(closeMs,()=>{log({type:'pool_close_timeout'});reject(Error('PUBLICATION_CONTROLLER_POOL_CLOSE_TIMEOUT'));}));
  try{await Promise.race([Promise.resolve().then(()=>pool.end()).catch(()=>{throw Error('PUBLICATION_CONTROLLER_POOL_CLOSE_FAILED');}),closeTimeout]);}finally{cancelClose?.();pool.removeListener('error',poolError);}
 }
 if(timedOut)throw Error('PUBLICATION_CONTROLLER_SHUTDOWN_TIMEOUT');
 if(local.signal.aborted)throw Error('PUBLICATION_DATABASE_UNAVAILABLE');
}
