"use client";
import "./website-publish.css";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Copy, Globe2, LoaderCircle } from "lucide-react";
import { cloudAccountGuard } from "./cloud-api";
import { siteAddress, validSiteSlug, type HostedSite } from "@/lib/hosting/config";

export default function WebsitePublish({ accountId, workspaceId, artifactId, title, version, dirty, disabled, owner, capture }: {
  accountId:string; workspaceId:string; artifactId:string; title:string; version:number; dirty:boolean; disabled:boolean; owner:boolean;
  /** React projects: render the saved site and return static HTML to publish. */
  capture?: () => Promise<string>;
}) {
  const [site,setSite]=useState<HostedSite|null>(null);
  const [slug,setSlug]=useState(`${title.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,30)||"website"}-${artifactId.slice(0,8)}`);
  const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[agreed,setAgreed]=useState(false),[message,setMessage]=useState("");
  const [confirmOffline,setConfirmOffline]=useState(false);
  const [pending,setPending]=useState<{key:string;body:string}|null>(null);
  const path=`/api/cloud/workspaces/${workspaceId}/artifacts/${artifactId}/publication`;
  const reload=useCallback(async(signal?:AbortSignal)=>{
    const assertAccount=cloudAccountGuard(accountId);
    assertAccount();
    const response=await fetch(path,{signal,cache:"no-store",headers:{"X-Makeborne-Account":accountId}});
    const result=await response.json(); assertAccount();
    if(!response.ok) throw new Error(result.error?.message||"Publishing status is unavailable.");
    setSite(result.site); if(result.site) setSlug(result.site.slug); setReady(true); return result.site as HostedSite|null;
  },[accountId,path]);
  useEffect(()=>{const abort=new AbortController(); queueMicrotask(()=>{if(!abort.signal.aborted)void reload(abort.signal).catch(error=>{if(!abort.signal.aborted)setMessage(error instanceof Error?error.message:"Could not load publishing.");});});return()=>abort.abort();},[reload]);
  async function publish(live:boolean) {
    if(busy || !owner) return;
    setBusy(true);setMessage("");
    try {
      const assertAccount=cloudAccountGuard(accountId); assertAccount();
      const snapshot=!pending&&live&&capture?await capture():undefined;
      const operation=pending??{key:crypto.randomUUID(),body:JSON.stringify({live,slug,version,revision:site?.revision??0,acknowledged:true,...(snapshot?{snapshot}:{})})};
      setPending(operation);
      const response=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":operation.key,"X-Makeborne-Account":accountId},body:operation.body,signal:AbortSignal.timeout(60_000)});
      const result=await response.json(); assertAccount();
      if(!response.ok){if(response.status<500)setPending(null);throw new Error(result.error?.message||"Publishing could not finish. Retry to confirm the result.");}
      setPending(null);setSite(result.site);setSlug(result.site.slug);setConfirmOffline(false);setAgreed(false);
      setMessage(result.site.live?"Your saved website is live. Future edits stay private until you publish again.":"Your website is offline. Its address stays reserved for you.");
    } catch(error){setMessage(error instanceof Error?error.message:"Publishing could not finish. Retry to confirm the result.");}
    finally{setBusy(false);}
  }
  return <section className="website-publish" aria-labelledby={`publish-${artifactId}`}>
    <div className="website-publish-heading"><span className="website-publish-icon"><Globe2 size={18}/></span><div><h3 id={`publish-${artifactId}`}>Publish website</h3><p>{site?.live?`Live · version ${site.version_number}`:"A home for your website"}</p></div>{site?.live&&<span className="website-publish-live">Live</span>}</div>
    <p className="website-publish-detail">Share a public, static website with a Makeborne address. Up to 5 live sites per workspace.</p>
    <label className="website-publish-label">Website address<span className="website-publish-address"><span>sites.makeborne.com/</span><input aria-label="Website address" value={slug} maxLength={48} disabled={!owner||!!site||busy||!!pending} onChange={e=>{setSlug(e.target.value.toLowerCase());setAgreed(false);}} autoCapitalize="none" spellCheck={false}/></span></label>
    {site?.live&&<div className="website-publish-links"><a href={siteAddress(site.slug)} target="_blank" rel="noopener noreferrer">Open website<ArrowUpRight size={14}/></a><button type="button" onClick={()=>void navigator.clipboard.writeText(siteAddress(site.slug)).then(()=>setMessage("Website address copied.")).catch(()=>setMessage("Copy the address from the link above."))}><Copy size={13}/>Copy link</button></div>}
    {dirty&&<p className="website-publish-detail">Save your changes before publishing a new version.</p>}
    {!owner?<p className="website-publish-detail">Only the workspace owner can publish this website.</p>:<>
      <label className="website-publish-consent"><input type="checkbox" checked={agreed} disabled={busy||!!pending} onChange={e=>setAgreed(e.target.checked)}/><span>I’ve reviewed this version and have permission to make its text and images public.</span></label>
      <button type="button" className="button primary" disabled={busy||!ready||disabled||(!pending&&(dirty||!agreed||!validSiteSlug(slug)||version<1))} onClick={()=>void publish(true)}>{busy?<LoaderCircle size={15} className="auth-spinner"/>:<Globe2 size={15}/>} {busy?"Publishing…":pending?"Retry publishing request":site?.live?"Publish saved changes":"Publish website"}</button>
      {site?.live&&!pending&&(confirmOffline?<div className="website-publish-offline"><p>Take this website offline? Visitors will no longer see it.</p><button type="button" className="button secondary small" disabled={busy} onClick={()=>void publish(false)}>Take offline</button><button type="button" className="button secondary small" disabled={busy} onClick={()=>setConfirmOffline(false)}>Cancel</button></div>:<button type="button" className="website-publish-text-button" disabled={busy} onClick={()=>setConfirmOffline(true)}>Take website offline</button>)}
    </>}
    {message&&<p className="website-publish-message" role="status">{message}</p>}
    {!ready&&<button type="button" className="website-publish-text-button" onClick={()=>void reload().catch(()=>setMessage("Publishing is temporarily unavailable."))}>Refresh publishing status</button>}
    <p className="website-publish-note">Publishes the saved content and artwork. {capture?"The live site is a static version of your design: interactive scripts, checkout and form submissions aren’t included yet.":"Custom code, checkout, forms, and customer domains aren’t included in this release."}</p>
  </section>;
}
