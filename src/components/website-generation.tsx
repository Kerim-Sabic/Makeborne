"use client";
import {useEffect,useEffectEvent,useRef,useState} from "react";
import {Sparkles,Square,RefreshCw} from "lucide-react";
import {continueGeneration,generationProgress,generationStorageKey,readGenerationReference,saveGenerationReference,GenerationBrowserError,type GenerationReference} from "@/lib/generation/browser-request";
import type {GenerationProgress} from "@/lib/generation/submission-contract";

const labels:Record<GenerationProgress["state"],string>={queued:"Waiting to start",working:"Creating your website",building:"Building your website",awaiting_review:"Build complete · review pending",ready:"Website ready",failed:"Creation stopped",cancelled:"Creation cancelled",cancelling:"Confirming cancellation",needs_attention:"Creation needs attention"};
const terminal=(job:GenerationProgress)=>["ready","failed","cancelled"].includes(job.state);
export default function WebsiteGeneration({accountId,workspaceId,projectId,artifactId,baseVersionId,sourceIds,canStart,onOpenLatest,onOutputVersionChange}:{
  accountId:string;workspaceId:string;projectId:string;artifactId:string;baseVersionId:string|null;sourceIds:string[];canStart:boolean;onOpenLatest:()=>void;onOutputVersionChange?:(versionId:string|null)=>void;
}) {
  const [reference,setReference]=useState<GenerationReference|null>(null),[job,setJob]=useState<GenerationProgress|null>(null);
  const [enabled,setEnabled]=useState(false),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const [processing,setProcessing]=useState(false),[rights,setRights]=useState(false);
  const lifetime=useRef<AbortController|null>(null),running=useRef(false);
  const autoStarted=useRef(false);
  const scope={workspaceId,projectId,artifactId},storageKey=generationStorageKey(accountId,scope);
  function boundary() {const controller=lifetime.current;return {fetch,current:()=>!!controller&&!controller.signal.aborted,
    signal:AbortSignal.any([controller?.signal??AbortSignal.abort(),AbortSignal.timeout(20_000)])};}
  useEffect(()=>{
    const controller=new AbortController();lifetime.current=controller;
    Promise.resolve().then(()=>{
      if(controller.signal.aborted)return;
      try {setReference(readGenerationReference(localStorage,accountId,{workspaceId,projectId,artifactId}));}
      catch(error) {setMessage(error instanceof Error?error.message:"Your saved request could not be read.");}
      setLoaded(true);
    });
    fetch("/api/generate",{cache:"no-store",signal:controller.signal,headers:{"X-Makeborne-Account":accountId}})
      .then(async response=>response.ok?response.json():null).then(value=>{if(!controller.signal.aborted){setEnabled(value?.operatorSubmissionEnabled===true);}}).catch(()=>{});
    return()=>{controller.abort();};
  },[accountId,workspaceId,projectId,artifactId]);
  useEffect(()=>{
    if(!reference?.jobId)return;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const progress=await generationProgress(reference!,{fetch,current:()=>!controller.signal.aborted,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15_000)])});
        if(controller.signal.aborted)return;
        setJob(previous=>previous?.id===progress.id&&Date.parse(previous.updatedAt)>Date.parse(progress.updatedAt)?previous:progress);setMessage("");
        if(terminal(progress))return;
      } catch(error) {
        if(!controller.signal.aborted)setMessage(error instanceof Error?error.message:"Progress could not be confirmed.");
        if(error instanceof GenerationBrowserError&&["AUTH_REQUIRED","ACCESS_DENIED","NOT_FOUND","ACCOUNT_CHANGED"].includes(error.code))return;
      }
      if(!controller.signal.aborted)timer=setTimeout(()=>void poll(),4000);
    }
    void poll();return()=>{controller.abort();clearTimeout(timer);};
  },[reference]);
  async function act(action:"continue"|"cancel"|"new") {
    if(running.current)return;running.current=true;setBusy(true);setMessage("");
    try {
      if(!navigator.locks)throw Error("This browser cannot safely coordinate creation requests. Use a current browser to continue.");
      await navigator.locks.request(storageKey,{signal:lifetime.current!.signal},async()=>{
        let saved=readGenerationReference(localStorage,accountId,scope);
        if(action==="new") {
          if(!saved?.jobId||!terminal(await generationProgress(saved,boundary())))throw Error("Confirm the existing request has stopped before starting another.");
          localStorage.removeItem(storageKey);setReference(null);setJob(null);return;
        }
        if(action==="cancel") {if(!saved)throw Error("Reopen the original request to cancel it.");setJob(await generationProgress(saved,boundary(),true));return;}
        if(!canStart)throw Error("Save or resolve your current draft before continuing creation.");
        if(!saved) {
          if(!enabled||!baseVersionId||!processing||!rights)throw Error("Save this project and confirm processing and source permissions before creating.");
          saved={version:1,accountId,requestKey:crypto.randomUUID(),prepared:null,jobId:null,
            input:{scope,baseVersionId,sourceIds,processingConsent:true,externalProcessingConsent:true,sourceRightsConfirmed:true}};
          saveGenerationReference(localStorage,saved);
        }
        setReference(saved);
        const progress=await continueGeneration(saved,localStorage,boundary());
        setReference(readGenerationReference(localStorage,accountId,scope));setJob(progress);
      });
    } catch(error) {if(!lifetime.current?.signal.aborted)setMessage(error instanceof Error?error.message:"Creation could not be confirmed. Keep this request reference.");}
    finally {running.current=false;if(!lifetime.current?.signal.aborted)setBusy(false);}
  }
  const startApprovedCreate=useEffectEvent(()=>{void act("continue");});
  useEffect(()=>{
    if(!loaded||!enabled||!canStart||!reference?.autoStart||reference.jobId||autoStarted.current)return;
    autoStarted.current=true;startApprovedCreate();
  },[loaded,enabled,canStart,reference]);
  const notifyOutput=useEffectEvent((versionId:string|null)=>onOutputVersionChange?.(versionId));
  const outputVersionId=job?.outputVersionId??null;
  useEffect(()=>{notifyOutput(outputVersionId);},[outputVersionId]);
  if(!loaded||!enabled&&!reference&&!message)return null;
  return <section className="website-generation" aria-label="Website creation" aria-busy={busy}>
    <div className="website-generation-heading"><Sparkles size={17}/><strong>{job?labels[job.state]:reference?"Continue your website":"Build from your saved brief"}</strong></div>
    {!reference&&<div className="website-generation-permissions">
      <label><input type="checkbox" checked={processing} onChange={e=>setProcessing(e.target.checked)}/>Allow our AI service providers to process this brief and its selected sources.</label>
      <label><input type="checkbox" checked={rights} onChange={e=>setRights(e.target.checked)}/>I have permission to use the supplied content and artwork.</label>
    </div>}
    <div className="website-generation-actions">
      {!job&&<button type="button" className="button primary small" disabled={busy||!canStart||!reference&&(!enabled||!baseVersionId||!processing||!rights)} onClick={()=>void act("continue")}><Sparkles size={14}/>{busy?"Confirming request…":reference?"Retry saved request":"Build website"}</button>}
      {job?.canCancel&&<button type="button" className="button secondary small" disabled={busy} onClick={()=>void act("cancel")}><Square size={12}/>Cancel creation</button>}
      {job?.outputVersionId&&<button type="button" className="button secondary small" onClick={onOpenLatest}>Open latest saved version</button>}
      {job&&terminal(job)&&<button type="button" className="button secondary small" disabled={busy} onClick={()=>void act("new")}><RefreshCw size={14}/>New request</button>}
    </div>
    <p className="small-note" role="status">{message||(!canStart?"Save or resolve your edits before creating.":job?.credits?`${job.credits.reserved} credits reserved · ${job.credits.charged} charged`:reference?"Your request reference is saved. Retrying continues the same request.":"Your saved content stays intact while a new website revision is created.")}</p>
    {job?.state==="awaiting_review"&&<p className="small-note">Compilation passed. Design review and publishing are still pending.</p>}
  </section>;
}
