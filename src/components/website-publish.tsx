"use client";
import "./website-publish.css";
import WebsiteEnquiries from "./website-enquiries";
import TrustedWebsitePublish from "./trusted-website-publish";
import ClientReadyCheck from "./client-ready-check";
import SiteClaims from "./site-claims";
import {checkedLabel} from "@/lib/hosting/checked-version";
import type { ClientReadyInput } from "@/lib/builder/client-ready";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Copy, Globe2, LoaderCircle } from "lucide-react";
import { cloudAccountGuard } from "./cloud-api";
import { HOSTING, SITE_ADDRESS_PARTS, siteAddress, validSiteSlug, type HostedSite } from "@/lib/hosting/config";

export type PublishCapture = { snapshot: string; bundle?: { js: string; css: string } };

/** source: the React website shown in the client-ready check before publishing. */
/** onPublished: called after the live state changed (published or taken offline), so the editor header can re-read it. */
type PublishProps = {accountId:string;workspaceId:string;artifactId:string;title:string;version:number;dirty:boolean;disabled:boolean;owner:boolean;capture?:()=>Promise<PublishCapture>;source?:ClientReadyInput;onPublished?:()=>void};

export default function WebsitePublish(props:PublishProps) {
  return props.capture ? <TrustedWebsitePublish key={`${props.accountId}:${props.workspaceId}:${props.artifactId}`} {...props}/> : <LegacyWebsitePublish {...props}/>;
}

function LegacyWebsitePublish({ accountId, workspaceId, artifactId, title, version, dirty, disabled, owner, capture, source, onPublished }: {
  accountId:string; workspaceId:string; artifactId:string; title:string; version:number; dirty:boolean; disabled:boolean; owner:boolean; source?:ClientReadyInput; onPublished?:()=>void;
  /** React projects: render the saved site (static snapshot) and build its production bundle. */
  capture?: () => Promise<PublishCapture>;
}) {
  const [site,setSite]=useState<HostedSite|null>(null);
  const [slug,setSlug]=useState(`${title.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,30)||"website"}-${artifactId.slice(0,8)}`);
  const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[agreedVersion,setAgreedVersion]=useState<number|null>(null),[message,setMessage]=useState("");
  // Consent covers the version that was reviewed; a newer save needs a fresh review (audit M07).
  const agreed=agreedVersion===version&&!dirty;
  // JavaScript runs only on an explicitly configured isolated domain; otherwise sites publish static.
  const scriptable=Boolean(capture)&&HOSTING.interactiveAllowed;
  const [interactive,setInteractive]=useState(HOSTING.interactiveAllowed),[switching,setSwitching]=useState(false);
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
      const operation=pending??{key:crypto.randomUUID(),body:JSON.stringify({live,slug:live?slug:(site?.slug??slug),version,revision:site?.revision??0,acknowledged:true,interactive:scriptable?interactive:false,...(captured?{snapshot:captured.snapshot,...(scriptable&&captured.bundle?{bundle:captured.bundle}:{})}:{})})};
      setPending(operation);
      const response=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":operation.key,"X-Makeborne-Account":accountId},body:operation.body,signal:AbortSignal.timeout(90_000)});
      const result=await response.json(); assertAccount();
      if(!response.ok){if(response.status<500)setPending(null);throw new Error(result.error?.message||"Publishing could not finish. Retry to confirm the result.");}
      setPending(null);setSite(result.site);setSlug(result.site.slug);setInteractive(result.site.interactive);setConfirmOffline(false);setAgreedVersion(null);onPublished?.();
      setMessage(result.site.live?`Your saved website is live${result.site.scripted&&result.site.interactive?" with JavaScript":""}. Future edits stay private until you publish again.`:"Your website is offline. Its address stays reserved for you.");
    } catch(error){setMessage(error instanceof Error?error.message:"Publishing could not finish. Retry to confirm the result.");}
    finally{setBusy(false);}
  }
  /** Live sites switch JavaScript immediately; otherwise the choice applies on publish. */
  async function changeInteractive(next:boolean) {
    if(busy||switching||!owner) return;
    if(!site?.live||!site.scripted&&!next){setInteractive(next);return;}
    if(next&&!site.scripted){setInteractive(next);setMessage("Publish the website again to turn on JavaScript.");return;}
    const previous=interactive;
    setInteractive(next);setSwitching(true);setMessage("");
    try {
      const assertAccount=cloudAccountGuard(accountId); assertAccount();
      const response=await fetch(path,{method:"PATCH",headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID(),"X-Makeborne-Account":accountId},body:JSON.stringify({interactive:next,revision:site.revision}),signal:AbortSignal.timeout(30_000)});
      const result=await response.json(); assertAccount();
      if(!response.ok) throw new Error(result.error?.message||"The setting could not be changed. Reload and try again.");
      setSite(result.site);setInteractive(result.site.interactive);
      setMessage(result.site.interactive?"JavaScript is on: menus, tabs, forms and animations run on the live site.":"JavaScript is off: visitors see the static version of your website.");
    } catch(error){setInteractive(previous);setMessage(error instanceof Error?error.message:"The setting could not be changed.");}
    finally{setSwitching(false);}
  }
  const address=site?siteAddress(site.slug):null;
  const scriptsLive=Boolean(site?.live&&site.scripted&&site.interactive);
  return <section className="website-publish" aria-labelledby={`publish-${artifactId}`}>
    <div className="website-publish-heading"><span className="website-publish-icon"><Globe2 size={18}/></span><div><h3 id={`publish-${artifactId}`}>Publish website</h3><p>{site?.live?`Live · version ${site.version_number}${scriptable?scriptsLive?" · JavaScript on":" · static":""}`:"A home for your website"}</p></div>{site?.live&&<span className="website-publish-live">Live</span>}</div>
    <p className="website-publish-detail">{scriptable?"Your website gets its own secure address and runs its saved interactive build. Review the prepared output before publishing.":capture?"Your website is published as a fast static page of the saved version. Interactive features (JavaScript) arrive once sites move to their own domain. Publish as many websites as you like.":"Share a public, static website with its own address. Publish as many websites as you like."}</p>
    <label className="website-publish-label">Website address<span className="website-publish-address"><span>{SITE_ADDRESS_PARTS.before}<em>{slug||"your-site"}</em>{SITE_ADDRESS_PARTS.after}</span><input aria-label="Website address" value={slug} maxLength={48} disabled={!owner||busy||switching||!!pending} onChange={e=>{setSlug(e.target.value.toLowerCase());setAgreedVersion(null);}} autoCapitalize="none" spellCheck={false}/></span></label>
    {site&&slug!==site.slug&&<p className="website-publish-detail">Publish to change this website&apos;s address. Its previous link will stop working and stays reserved for this project.</p>}
    {site?.live&&address&&<div className="website-publish-links"><a href={address} target="_blank" rel="noopener noreferrer" className="website-publish-url">{address.replace(/^https?:\/\//,"").replace(/\/$/,"")}<ArrowUpRight size={14}/></a><button type="button" onClick={()=>void navigator.clipboard.writeText(address).then(()=>setMessage("Website address copied.")).catch(()=>setMessage("Copy the address from the link above."))}><Copy size={13}/>Copy link</button></div>}
    {site?.live&&scriptable&&<p className={`website-publish-runtime${scriptsLive?" on":""}`} role="note">{scriptsLive?"JavaScript enabled: interactive features work on the live site.":"Static version: scripts don’t run on the live site."}</p>}
    {scriptable&&owner&&<label className="website-publish-toggle"><input type="checkbox" role="switch" aria-checked={interactive} checked={interactive} disabled={busy||switching||!!pending} onChange={e=>void changeInteractive(e.target.checked)}/><span><strong>Interactive (JavaScript)</strong><small>Runs your site’s code (menus, tabs, carousels, forms, animations) on its own isolated domain. Turn off to publish a static version.</small></span></label>}
    {dirty&&<p className="website-publish-detail">Save your changes before publishing a new version.</p>}
    {source&&<ClientReadyCheck source={source} scope={checkedLabel({version,dirty})}/>}
    {source&&<SiteClaims source={source} scope={checkedLabel({version,dirty})}/>}
    {!owner?<p className="website-publish-detail">Only the workspace owner can publish this website.</p>:<>
      <label className="website-publish-consent"><input type="checkbox" checked={agreed} disabled={busy||!!pending||dirty||version<1} onChange={e=>setAgreedVersion(e.target.checked?version:null)}/><span>I’ve reviewed version {version} and have permission to make its text and images public.</span></label>
      <button type="button" className="button primary" disabled={busy||switching||!ready||disabled||(!pending&&(dirty||!agreed||!validSiteSlug(slug)||version<1))} onClick={()=>void publish(true)}>{busy?<LoaderCircle size={15} className="auth-spinner"/>:<Globe2 size={15}/>} {busy?"Publishing…":pending?"Retry publishing request":site&&slug!==site.slug?"Publish at new address":site?.live?"Publish saved changes":"Publish website"}</button>
      {site?.live&&!pending&&(confirmOffline?<div className="website-publish-offline"><p>Take this website offline? Visitors will no longer see it.</p><button type="button" className="button secondary small" disabled={busy} onClick={()=>void publish(false)}>Take offline</button><button type="button" className="button secondary small" disabled={busy} onClick={()=>setConfirmOffline(false)}>Cancel</button></div>:<button type="button" className="website-publish-text-button" disabled={busy} onClick={()=>setConfirmOffline(true)}>Take website offline</button>)}
    </>}
    {message&&<p className="website-publish-message" role="status">{message}</p>}
    {!ready&&<button type="button" className="website-publish-text-button" onClick={()=>void reload().catch(()=>setMessage("Publishing is temporarily unavailable."))}>Refresh publishing status</button>}
    {owner&&site?.live&&<WebsiteEnquiries key={`${accountId}:${artifactId}`} accountId={accountId} workspaceId={workspaceId} artifactId={artifactId}/>}
    <p className="website-publish-note">Publishes the saved content and artwork. {capture?"Visitors first see a fast static render, then your code takes over. Connect an enquiry form to receive messages in the inbox above. Payments and other external services need a separate integration. Hosted sites include a small Made with Makeborne link.":"This version publishes a static website. Interactive forms and custom code require a saved React website on isolated hosting."}</p>
  </section>;
}
