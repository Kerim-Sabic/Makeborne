"use client";
import {useEffect,useState} from "react";
import type {GenerationConsent} from "@/lib/generation/submission-contract";
import "@/app/generation-permissions.css";

/** Creating explicitly authorizes this request; mounting or restoring a draft does not. */
export function useGenerationConsent(accountId:string|null) {
  const [access,setAccess]=useState<{accountId:string;enabled:boolean}|null>(null);
  useEffect(()=>{
    if(!accountId)return;
    const controller=new AbortController();
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(15_000)]);
    const read=(path:string)=>fetch(path,{cache:"no-store",headers:{"X-Makeborne-Account":accountId},signal}).then(response=>response.ok?response.json():null).catch(()=>null);
    // The live builder (streaming) or the operator worker path can start a website from the prompt.
    void Promise.all([read("/api/generate"),read("/api/build")]).then(([worker,builder])=>{
      if(!controller.signal.aborted)setAccess({accountId,enabled:worker?.operatorSubmissionEnabled===true||builder?.available===true});
    });
    return()=>controller.abort();
  },[accountId]);
  const ready=!accountId||access?.accountId===accountId;
  function authorizeSubmission():GenerationConsent {
    if(!accountId||!ready)throw new Error("Wait for your account to finish loading before creating.");
    return {processingConsent:true,externalProcessingConsent:true,sourceRightsConfirmed:true};
  }
  return {ready,enabled:!!accountId&&access?.accountId===accountId&&access.enabled,authorizeSubmission};
}

export default function GenerationPermissions() {
  return <p className="generation-permissions">By creating, you agree to our <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a> and <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</p>;
}
