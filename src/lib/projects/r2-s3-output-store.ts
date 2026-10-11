import "server-only";
import {AwsClient} from "aws4fetch";
import {createHash} from "node:crypto";
import type {CompiledOutputStore} from "./compiled-output";
import {boundedBytes} from "../server/http";
import {MAX_OUTPUT_BYTES,validateOutputKey,validateOutputLimit,readExactOutputStream} from "./private-output-object";

export type R2StorageConfiguration={accountId:string;bucket:string;accessKeyId:string;secretAccessKey:string};
const fail=(code="OUTPUT_STORAGE_UNAVAILABLE"):never=>{throw Object.assign(Error(code),{code});};
const digest=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");

/** Trusted Node builder transport. The caller supplies bucket-scoped operator
 * credentials. No endpoint override, browser URL, upload API or implicit retry.
 * A conditional conflict is verified by the existing retention readback. */
export function createR2S3OutputStore(configuration:R2StorageConfiguration,transport:typeof fetch=fetch):CompiledOutputStore{
  if(!/^[a-f0-9]{32}$/.test(configuration.accountId)||! /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(configuration.bucket)
    ||! /^[a-f0-9]{32}$/.test(configuration.accessKeyId)||! /^[a-f0-9]{64}$/.test(configuration.secretAccessKey))fail("OUTPUT_STORAGE_CONFIGURATION");
  const endpoint=`https://${configuration.accountId}.r2.cloudflarestorage.com/${configuration.bucket}/`;
  const signer=new AwsClient({accessKeyId:configuration.accessKeyId,secretAccessKey:configuration.secretAccessKey,service:"s3",region:"auto",retries:0});
  async function request(key:string,method:"GET"|"PUT",signal:AbortSignal,bytes?:Uint8Array){
    const deadline=AbortSignal.any([signal,AbortSignal.timeout(30_000)]);
    try{
      const signed=await signer.sign(endpoint+key,{method,signal:deadline,redirect:"manual",cache:"no-store",
        headers:{"Cache-Control":"private, no-store","X-Amz-Content-Sha256":digest(bytes??new Uint8Array()),
          ...(method==="PUT"?{"If-None-Match":"*","Content-Type":"application/octet-stream"}:{})},
        body:bytes?new Uint8Array(bytes):undefined,aws:{allHeaders:true}});
      deadline.throwIfAborted();
      const response=await transport(signed); // Manual redirect: credentials never follow Location.
      if(deadline.aborted){await response.body?.cancel().catch(()=>{});deadline.throwIfAborted();}
      return {response,deadline};
    }catch{signal.throwIfAborted();return fail();}
  }
  return Object.freeze({
    async putIfAbsent(key:string,bytes:Uint8Array,signal:AbortSignal){
      signal.throwIfAborted();validateOutputKey(key);
      if(!(bytes instanceof Uint8Array)||bytes.byteLength>MAX_OUTPUT_BYTES)fail("OUTPUT_WRITE_LIMIT");
      const snapshot=new Uint8Array(bytes);
      const {response,deadline}=await request(key,"PUT",signal,snapshot);
      await response.body?.cancel().catch(()=>{});deadline.throwIfAborted();
      if(![200,204,412].includes(response.status))fail();
    },
    async get(key:string,maxBytes:number,signal:AbortSignal){
      signal.throwIfAborted();validateOutputKey(key);validateOutputLimit(maxBytes);
      const {response,deadline}=await request(key,"GET",signal);
      if(response.status===404){
        try{
          const bytes=await boundedBytes(response,4096,deadline);
          const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
          if((text.match(/<Code>/g)??[]).length===1&&/<Code>\s*NoSuchKey\s*<\/Code>/.test(text)&&! /<!DOCTYPE|<!ENTITY/i.test(text))return null;
        }catch{await response.body?.cancel().catch(()=>{});signal.throwIfAborted();}
        return fail();
      }
      if(response.status!==200){await response.body?.cancel().catch(()=>{});return fail();}
      const length=response.headers.get("Content-Length");
      if(length===null||! /^(0|[1-9][0-9]*)$/.test(length)||response.headers.get("Content-Encoding")){
        await response.body?.cancel().catch(()=>{});return fail("OUTPUT_READ_LIMIT");
      }
      if(!response.body){deadline.throwIfAborted();if(length==="0")return new Uint8Array();return fail("OUTPUT_BYTES_CHANGED");}
      return readExactOutputStream(Number(length),response.body,maxBytes,deadline);
    },
  });
}
