"use client";
import {useEffect,useState} from "react";
import {readSavedWebsitePreview} from "@/lib/projects/browser-preview";
import type {GenerationProgress} from "@/lib/generation/submission-contract";
import PrivateWebsitePreview from "./private-website-preview";

/** Key by account and exact revision. Saved previews never need browser-local
 * generation references and cannot submit new generation requests. */
export default function SavedWebsitePreview({accountId,workspaceId,projectId,artifactId,versionId}:{accountId:string;workspaceId:string;projectId:string;artifactId:string;versionId:string}) {
  const [job,setJob]=useState<GenerationProgress|null>(null),[message,setMessage]=useState("Checking saved website…"),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    async function read(){
      try {
        const result=await readSavedWebsitePreview(accountId,{workspaceId,projectId,artifactId},versionId,AbortSignal.any([controller.signal,AbortSignal.timeout(15_000)]));
        if(controller.signal.aborted)return;
        setJob(result);
        setMessage(!result?"This saved revision needs a build before it can be previewed.":["awaiting_review","ready"].includes(result.state)?"":
          ["queued","working","building","cancelling"].includes(result.state)?"Preparing this saved website…":"This revision has no completed preview. Your saved source is unchanged.");
        if(result&&["queued","working","building","cancelling"].includes(result.state))timer=setTimeout(()=>void read(),4000);
      }catch(error){if(!controller.signal.aborted){setJob(null);setMessage(error instanceof Error&&!(error instanceof TypeError)?error.message:"The saved website could not be checked. Try again.");}}
    }
    void read();return()=>{controller.abort();clearTimeout(timer);};
  },[accountId,workspaceId,projectId,artifactId,versionId,attempt]);
  return <section className="saved-website-preview" aria-label="Saved website">
    {job&&["awaiting_review","ready"].includes(job.state)?<PrivateWebsitePreview key={`${accountId}:${job.id}:${versionId}`} accountId={accountId} jobId={job.id}/>:<>
      <p className="small-note" role="status">{message}</p>
      <button type="button" className="button secondary small" onClick={()=>setAttempt(value=>value+1)}>Check saved build</button>
    </>}
  </section>;
}
