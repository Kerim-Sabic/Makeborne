import "server-only";
import {createHash} from "node:crypto";
import type {R2Bucket} from "@cloudflare/workers-types";
import type {CompiledOutputStore} from "./compiled-output";

import {MAX_OUTPUT_BYTES,validateOutputKey,validateOutputLimit,readExactOutputStream} from "./private-output-object";
const fail=(code:string):never=>{throw Object.assign(Error(code),{code});};

/** Private R2 binding only: no public bucket URL, browser token or read cache.
 * Conditional creation is atomic; existing bytes can never be overwritten.
 * The shared retention layer verifies exact bytes and publishes the receipt
 * marker last. This adapter grants neither preview nor publishing authority. */
export function createR2OutputStore(bucket:Pick<R2Bucket,"put"|"get">):CompiledOutputStore {
  return Object.freeze({
    async putIfAbsent(key:string,bytes:Uint8Array,signal:AbortSignal){
      signal.throwIfAborted();validateOutputKey(key);
      if(!(bytes instanceof Uint8Array)||bytes.byteLength>MAX_OUTPUT_BYTES)fail("OUTPUT_WRITE_LIMIT");
      // R2 cannot cancel an in-flight binding call. Snapshot caller-owned bytes,
      // discard late results, and never confirm build completion after abort.
      const snapshot=new Uint8Array(bytes);
      await bucket.put(key,snapshot,{onlyIf:{etagDoesNotMatch:"*"},
        sha256:createHash("sha256").update(snapshot).digest("hex"),
        httpMetadata:{contentType:"application/octet-stream",cacheControl:"private, no-store"}});
      signal.throwIfAborted();
    },
    async get(key:string,maxBytes:number,signal:AbortSignal){
      signal.throwIfAborted();validateOutputKey(key);validateOutputLimit(maxBytes);
      const object=await bucket.get(key);
      if(!object){signal.throwIfAborted();return null;}
      return readExactOutputStream(object.size,object.body,maxBytes,signal);
    },
  });
}
