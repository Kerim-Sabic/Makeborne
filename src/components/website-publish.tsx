"use client";
import "./website-publish.css";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Copy, Globe2, LoaderCircle } from "lucide-react";
import { cloudAccountGuard } from "./cloud-api";
import { SITE_ADDRESS_PARTS, siteAddress, validSiteSlug, type HostedSite } from "@/lib/hosting/config";

export type PublishCapture = { snapshot: string; bundle?: { js: string; css: string } };

export default function WebsitePublish({ accountId, workspaceId, artifactId, title, version, dirty, disabled, owner, capture }: {
  accountId:string; workspaceId:string; artifactId:string; title:string; version:number; dirty:boolean; disabled:boolean; owner:boolean;
  /** React projects: render the saved site (static snapshot) and build its production bundle. */
  capture?: () => Promise<PublishCapture>;
}) {
  const [site,setSite]=useState<HostedSite|null>(null);
  const [slug,setSlug]=useState(`${title.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,30)||"website"}-${artifactId.slice(0,8)}`);
  const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[agreed,setAgreed]=useState(false),[message,setMessage]=useState("");
  const [interactive,setInteractive]=useState(true);
  const [confirmOffline,setConfirmOffline]=useState(false);
  const [pending,setPending]=useState<{key:string;body:string}|null>(null);
  const path=`/api/cloud/workspaces/${workspaceId}/artifacts/${artifactId}/publication`;
  const reload=useCallback(async(signal?:AbortSignal)=>{
    const assertAccount=cloudAccountGuard(accountId);
    assertAccount();
    const response=await fetch(path,{signal,cache:"no-store",headers:{"X-Makeborne-Account":accountId}});
    const result=await response.json(); assertAccount();
    if(!response.ok) throw new Error(result.error?.message||"Publishing status is unavailable.");
    setSite(result.site); if(result.site){setSlug(result.site.slug);setInteractive(result.site.interactive);} setReady(true); return result.site as HostedSite|null;
  },[accountId,path]);
  useEffect(()=>{const abort=new AbortController(); queueMicrotask(()=>{if(!abort.signal.aborted)void reload(abort.signal).catch(error=>{if(!abort.signal.aborted)setMessage(error instanceof Error?error.message:"Could not load publishing.");});});return()=>abort.abort();},[reload]);
  async function publish(live:boolean) {
    if(busy || !owner) return;
    setBusy(true);setMessage(live&&capture&&!pending?"Rendering and building your website…":"");
    try {
      const assertAccount=cloudAccountGuard(accountId); assertAccount();
      const captured=!pending&&live&&capture?await capture():undefined;
      const operation=pending??{key:crypto.randomUUID(),body:JSON.stringify({live,slug,version,revision:site?.revision??0,acknowledged:true,interactive:capture?interactive:false,...(captured?{snapshot:captured.snapshot,...(captured.bundle?{bundle:captured.bundle}:{})}:{})})};
      setPending(operation);
      const response=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":operation.key,"X-Makeborne-Account":accountId},body:operation.body,signal:AbortSignal.timeout(90_000)});
      const result=await response.json(); assertAccount();
      if(!response.ok){if(response.status<500)setPending(null);throw new Error(result.error?.message||"Publishing could not finish. Retry to confirm the result.");}
      setPending(null);setSite(result.site);setSlug(result.site.slug);setInteractive(result.site.interactive);setConfirmOffline(false);setAgreed(false);
      setMessage(result.site.live?`Your saved website is live${result.site.scripted&&result.site.interactive?" with JavaScript":""}. Future edits stay private until you publish again.`:"Your website is offline. Its address stays reserved for you.");
    } catch(error){setMessage(error instanceof Error?error.message:"Publishing could not finish. Retry to confirm the result.");}
    finally{setBusy(false);}
  }
  /** Live sites switch JavaScript immediately; otherwise the choice applies on publish. */
  async function changeInteractive(next:boolean) {
    if(busy||!owner) return;
    if(!site?.live||!site.scripted&&!next){setInteractive(next);return;}
    if(next&&!site.scripted){setInteractive(next);setMessage("Publish the website again to turn on JavaScript.");return;}
    setBusy(true);setMessage("");
    try {
      const assertAccount=cloudAccountGuard(accountId); assertAccount();
      const response=await fetch(path,{method:"PATCH",headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID(),"X-Makeborne-Account":accountId},body:JSON.stringify({interactive:next,revision:site.revision}),signal:AbortSignal.timeout(30_000)});
      const result=await response.json(); assertAccount();
      if(!response.ok) throw new Error(result.error?.message||"The setting could not be changed. Reload and try again.");
      setSite(result.site);setInteractive(result.site.interactive);
      setMessage(result.site.interactive?"JavaScript is on: menus, tabs, forms and animations run on the live site.":"JavaScript is off: visitors see the static version of your website.");
    } catch(error){setMessage(error instanceof Error?error.message:"The setting could not be changed.");}
    finally{setBusy(false);}
  }
  const address=site?siteAddress(site.slug):null;
  const scriptsLive=Boolean(site?.live&&site.scripted&&site.interactive);
  return <section className="website-publish" aria-labelledby={`publish-${artifactId}`}>
    <div className="website-publish-heading"><span className="website-publish-icon"><Globe2 size={18}/></span><div><h3 id={`publish-${artifactId}`}>Publish website</h3><p>{site?.live?`Live · version ${site.version_number}${capture?scriptsLive?" · JavaScript on":" · static":""}`:"A home for your website"}</p></div>{site?.live&&<span className="website-publish-live">Live</span>}</div>
    <p className="website-publish-detail">{capture?"Your website gets its own secure address and runs exactly like the preview. Up to 5 live sites per workspace.":"Share a public, static website with its own address. Up to 5 live sites per workspace."}</p>
    <label className="website-publish-label">Website address<span className="website-publish-address"><span>{SITE_ADDRESS_PARTS.before}<em>{slug||"your-site"}</em>{SITE_ADDRESS_PARTS.after}</span><input aria-label="Website address" value={slug} maxLength={48} disabled={!owner||!!site||busy||!!pending} onChange={e=>{setSlug(e.target.value.toLowerCase());setAgreed(false);}} autoCapitalize="none" spellCheck={false}/></span></label>
    {site?.live&&address&&<div className="website-publish-links"><a href={address} target="_blank" rel="noopener noreferrer" className="website-publish-url">{address.replace(/^https?:\/\//,"").replace(/\/$/,"")}<ArrowUpRight size={14}/></a><button type="button" onClick={()=>void navigator.clipboard.writeText(address).then(()=>setMessage("Website address copied.")).catch(()=>setMessage("Copy the address from the link above."))}><Copy size={13}/>Copy link</button></div>}
    {site?.live&&capture&&<p className={`website-publish-runtime${scriptsLive?" on":""}`} role="note">{scriptsLive?"JavaScript enabled: interactive features work on the live site.":"Static version: scripts don’t run on the live site."}</p>}
    {capture&&owner&&<label className="website-publish-toggle"><input type="checkbox" role="switch" aria-checked={interactive} checked={interactive} disabled={busy||!!pending} onChange={e=>void changeInteractive(e.target.checked)}/><span><strong>Interactive (JavaScript)</strong><small>Runs your site’s code (menus, tabs, carousels, forms, animations) on its own isolated domain. Turn off to publish a static version.</small></span></label>}
    {dirty&&<p className="website-publish-detail">Save your changes before publishing a new version.</p>}
    {!owner?<p className="website-publish-detail">Only the workspace owner can publish this website.</p>:<>
      <label className="website-publish-consent"><input type="checkbox" checked={agreed} disabled={busy||!!pending} onChange={e=>setAgreed(e.target.checked)}/><span>I’ve reviewed this version and have permission to make its text and images public.</span></label>
      <button type="button" className="button primary" disabled={busy||!ready||disabled||(!pending&&(dirty||!agreed||!validSiteSlug(slug)||version<1))} onClick={()=>void publish(true)}>{busy?<LoaderCircle size={15} className="auth-spinner"/>:<Globe2 size={15}/>} {busy?"Publishing…":pending?"Retry publishing request":site?.live?"Publish saved changes":"Publish website"}</button>
      {site?.live&&!pending&&(confirmOffline?<div className="website-publish-offline"><p>Take this website offline? Visitors will no longer see it.</p><button type="button" className="button secondary small" disabled={busy} onClick={()=>void publish(false)}>Take offline</button><button type="button" className="button secondary small" disabled={busy} onClick={()=>setConfirmOffline(false)}>Cancel</button></div>:<button type="button" className="website-publish-text-button" disabled={busy} onClick={()=>setConfirmOffline(true)}>Take website offline</button>)}
    </>}
    {message&&<p className="website-publish-message" role="status">{message}</p>}
    {!ready&&<button type="button" className="website-publish-text-button" onClick={()=>void reload().catch(()=>setMessage("Publishing is temporarily unavailable."))}>Refresh publishing status</button>}
    <p className="website-publish-note">Publishes the saved content and artwork. {capture?"Visitors first see a fast static render, then your code takes over. Sites run on a separate domain with a strict security policy: no third-party scripts or network requests, and no access to your Makeborne account. Checkout and form submissions aren’t connected yet.":"Custom code, checkout, forms, and customer domains aren’t included in this release."}</p>
  </section>;
}
