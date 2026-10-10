import "server-only";

export const MAX_OUTPUT_BYTES=50_000_000;
const fail=(code:string):never=>{throw Object.assign(Error(code),{code});};
const uuid="[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const keyPattern=new RegExp(`^compiled-v1/${uuid}/${uuid}/${uuid}/[a-f0-9]{64}/(?:receipt\\.json|files/[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*)$`);
export function validateOutputKey(key:string){
  if(typeof key!=="string"||key.length>600||!keyPattern.test(key)||key.split("/").some(part=>part==="."||part===".."))fail("OUTPUT_KEY_INVALID");
}
export function validateOutputLimit(limit:number){if(!Number.isSafeInteger(limit)||limit<0||limit>MAX_OUTPUT_BYTES)fail("OUTPUT_READ_LIMIT");}


type PrivateObjectBody={
  cancel():Promise<unknown>;
  getReader():{read():Promise<{done:true;value?:unknown}|{done:false;value:Uint8Array}>;cancel():Promise<unknown>;releaseLock():void};
};
/** Shared exact-size reader for private binding and signed HTTP objects. */
export async function readExactOutputStream(size:number,body:PrivateObjectBody,maxBytes:number,signal:AbortSignal):Promise<Uint8Array>{
  validateOutputLimit(maxBytes);
  if(signal.aborted||!Number.isSafeInteger(size)||size<0||size>maxBytes){
    await body.cancel().catch(()=>{});signal.throwIfAborted();fail("OUTPUT_READ_LIMIT");
  }
  // Check metadata before allocating, then enforce it while streaming too.
  const bytes=new Uint8Array(size),reader=body.getReader();let offset=0;
  const abort=()=>{void reader.cancel().catch(()=>{});};
  signal.addEventListener("abort",abort,{once:true});
  try{
    signal.throwIfAborted();
    while(true){
      const part=await reader.read();signal.throwIfAborted();
      if(part.done)break;
      if(offset+part.value.byteLength>bytes.byteLength){await reader.cancel();fail("OUTPUT_READ_LIMIT");}
      bytes.set(part.value,offset);offset+=part.value.byteLength;
    }
    if(offset!==bytes.byteLength)fail("OUTPUT_BYTES_CHANGED");
    signal.throwIfAborted();return bytes;
  }finally{signal.removeEventListener("abort",abort);reader.releaseLock();}
}
