"use client";
import {useEffect,useState} from "react";
import type {GenerationConsent} from "@/lib/generation/submission-contract";
import "@/app/generation-permissions.css";

/** Account-bound declarations; changing accounts never carries another account's consent. */
export function useGenerationConsent(accountId:string|null,initial:GenerationConsent|null=null) {
  const [access,setAccess]=useState<{accountId:string;enabled:boolean}|null>(null);
  const [permissions,setPermissions]=useState(()=>({accountId,processing:initial?.processingConsent===true,
    external:initial?.externalProcessingConsent??false,rights:initial?.sourceRightsConfirmed===true}));
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
  const processing=permissions.accountId===accountId&&permissions.processing;
  const rights=permissions.accountId===accountId&&permissions.rights;
  function update(field:"processing"|"rights",value:boolean) {
    setPermissions(previous=>({...(previous.accountId===accountId?previous:{accountId,processing:false,external:false,rights:false}),
      [field]:value,...(field==="processing"?{external:value}:{})}));
  }
  const consent:GenerationConsent|null=accountId&&processing&&rights?{processingConsent:true,externalProcessingConsent:permissions.external,sourceRightsConfirmed:true}:null;
  return {ready:!accountId||access?.accountId===accountId,enabled:!!accountId&&access?.accountId===accountId&&access.enabled,
    processing,rights,consent,setProcessing:(value:boolean)=>update("processing",value),setRights:(value:boolean)=>update("rights",value)};
}

export default function GenerationPermissions({value,disabled=false}:{value:ReturnType<typeof useGenerationConsent>;disabled?:boolean}) {
  return <div className="generation-permissions" role="group" aria-label="Creation permissions">
    <label className="generation-permission"><input type="checkbox" checked={value.processing} disabled={disabled} onChange={event=>value.setProcessing(event.target.checked)}/>Allow our AI service providers to process this brief.</label>
    <label className="generation-permission"><input type="checkbox" checked={value.rights} disabled={disabled} onChange={event=>value.setRights(event.target.checked)}/>I have permission to use the supplied content and artwork.</label>
    <p>Creating uses credits. Attached files stay on this device until separately approved for AI processing.</p>
  </div>;
}
