"use client";
import {useEffect,useEffectEvent,useId,useRef,useState} from "react";
import {Monitor,Smartphone,RefreshCw,X,Eye,Maximize,Minimize} from "lucide-react";
import {requestPrivatePreview,submitPreviewHandoff} from "@/lib/projects/browser-preview";
import {PREVIEW_SESSION_MAX_MS} from "@/lib/projects/preview-session-contract";
import {PRIVATE_PREVIEW_SANDBOX} from "@/lib/projects/preview-sandbox";

/** Parent keys this component by account/job/version so changing any boundary
 * unmounts the old browsing context and aborts its outstanding issuer request. */
export default function PrivateWebsitePreview({accountId,jobId}:{accountId:string;jobId:string}) {
  const [phase,setPhase]=useState<"closed"|"opening"|"visible"|"expired"|"error">("closed");
  const [device,setDevice]=useState<"desktop"|"mobile">("desktop"),[message,setMessage]=useState(""),[expires,setExpires]=useState<number|null>(null);
  const frame=useRef<HTMLIFrameElement>(null),pending=useRef<AbortController|null>(null),submitted=useRef(false);
  const panel=useRef<HTMLDivElement>(null),[fullscreen,setFullscreen]=useState(false);
  const name=`makeborne-preview-${useId().replaceAll(":","")}`;
  const automaticallyOpen=useEffectEvent(()=>void open());
  useEffect(()=>{let current=true;queueMicrotask(()=>{if(current)automaticallyOpen();});return()=>{current=false;pending.current?.abort();};},[]);
  useEffect(()=>{const sync=()=>setFullscreen(document.fullscreenElement===panel.current);document.addEventListener("fullscreenchange",sync);return()=>document.removeEventListener("fullscreenchange",sync);},[]);
  useEffect(()=>{
    if(expires===null)return;
    const timer=setTimeout(()=>{pending.current?.abort();submitted.current=false;setExpires(null);setPhase("expired");setMessage("Preview session ended. Open it again to continue reviewing.");},Math.max(0,expires-Date.now()));
    return()=>clearTimeout(timer);
  },[expires]);
  async function open() {
    if(pending.current&&!pending.current.signal.aborted)return;
    const controller=new AbortController();pending.current=controller;submitted.current=false;
    setMessage("");setPhase("opening");setExpires(null);
    try {
      const launch=await requestPrivatePreview(accountId,jobId,AbortSignal.any([controller.signal,AbortSignal.timeout(20_000)]),window.location.origin);
      if(controller.signal.aborted)return;
      if(!frame.current)throw Error("The preview was closed. Open it again.");
      submitted.current=true;submitPreviewHandoff(launch,frame.current);setExpires(Math.min(Date.parse(launch.expiresAt),Date.now()+PREVIEW_SESSION_MAX_MS));
    }catch(error){if(!controller.signal.aborted){setPhase("error");setMessage(error instanceof Error&&!(error instanceof TypeError)?error.message:"The preview could not be opened. Try again from this project.");}}
    finally{if(pending.current===controller)pending.current=null;}
  }
  function close(){pending.current?.abort();pending.current=null;submitted.current=false;setExpires(null);setPhase("closed");setMessage("");}
  async function expand(){try{if(document.fullscreenElement===panel.current)await document.exitFullscreen();else await panel.current?.requestFullscreen();}catch{setMessage("Full screen isn't available here. You can still review the website below.");}}
  const active=phase==="opening"||phase==="visible";
  useEffect(()=>{if(!active&&document.fullscreenElement===panel.current)void document.exitFullscreen().catch(()=>{});},[active]);
  useEffect(()=>{
    if(phase!=="opening")return;
    const timer=setTimeout(()=>{pending.current?.abort();submitted.current=false;setExpires(null);setPhase("error");setMessage("The preview is taking too long to load. Try opening it again.");},30_000);
    return()=>clearTimeout(timer);
  },[phase]);
  return <div className="private-website-preview" ref={panel}>
    {!active?<button type="button" className="button secondary small" onClick={()=>void open()}><Eye size={14}/>{phase==="closed"?"Preview website":"Reopen preview"}</button>:<>
      <div className="private-preview-toolbar">
        <div className="private-preview-label"><span aria-hidden="true"/>Private preview</div>
        <div className="private-preview-devices" role="group" aria-label="Preview size">
          <button type="button" aria-label="Desktop preview" aria-pressed={device==="desktop"} onClick={()=>setDevice("desktop")}><Monitor size={16}/></button>
          <button type="button" aria-label="Mobile preview" aria-pressed={device==="mobile"} onClick={()=>setDevice("mobile")}><Smartphone size={16}/></button>
        </div>
        <div className="private-preview-tools">
          <button type="button" aria-label={fullscreen?"Exit full screen":"Expand preview"} onClick={()=>void expand()}>{fullscreen?<Minimize size={15}/>:<Maximize size={15}/>}</button>
          <button type="button" aria-label="Refresh preview" disabled={phase==="opening"} onClick={()=>void open()}><RefreshCw size={15}/></button>
          <button type="button" aria-label="Close preview" onClick={close}><X size={16}/></button>
        </div>
      </div>
      <div className={`private-preview-canvas private-preview-${device}`} aria-busy={phase==="opening"}>
        {phase==="opening"&&<p className="private-preview-loading" role="status">Opening your website…</p>}
        <iframe ref={frame} name={name} title="Website preview" sandbox={PRIVATE_PREVIEW_SANDBOX} referrerPolicy="no-referrer"
          onLoad={()=>{if(submitted.current)setPhase("visible");}}/>
      </div>
    </>}
    {message&&<p className="small-note" role="status">{message}</p>}
  </div>;
}
