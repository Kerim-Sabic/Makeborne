"use client";

import {useCallback, useEffect, useRef, useState} from "react";
import {ArrowUpRight, Globe2, LoaderCircle, RefreshCw} from "lucide-react";
import {cloudAccountGuard} from "./cloud-api";
import WebsiteEnquiries from "./website-enquiries";
import ClientReadyCheck from "./client-ready-check";
import type {ClientReadyInput} from "@/lib/builder/client-ready";
import {HOSTING, SITE_ADDRESS_PARTS, siteAddress, validSiteSlug, type HostedSite} from "@/lib/hosting/config";
import {PublicationPreparationSchema, type PublicationPreparation} from "@/lib/projects/publication-contract";
import type {PublicationAddressPolicy} from "@/lib/hosting/namespace-server";

type Props = {accountId:string;workspaceId:string;artifactId:string;title:string;version:number;dirty:boolean;disabled:boolean;owner:boolean;source?:ClientReadyInput};
type Pending = {key:string;body:string};
const previewPolicy = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'";
function previewDocument(html:string) {
  return html.replace(/<head>/i, `<head><meta http-equiv="Content-Security-Policy" content="${previewPolicy}">`);
}

/** Mounted with an account/artifact key by the parent. Preparation only queues a
 * trusted worker; publishing requires review of that worker's retained output. */
export default function TrustedWebsitePublish({accountId,workspaceId,artifactId,title,version,dirty,disabled,owner,source}:Props) {
  const base=`/api/cloud/workspaces/${workspaceId}/artifacts/${artifactId}/publication`;
  const storageKey=`makeborne-publish-v1:${accountId}:${workspaceId}:${artifactId}`;
  const [site,setSite]=useState<HostedSite|null>(null), [preparation,setPreparation]=useState<PublicationPreparation|null>(null);
  const [slug,setSlug]=useState(`${title.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,30)||"website"}-${artifactId.slice(0,8)}`);
  const [interactive,setInteractive]=useState(HOSTING.interactiveAllowed);
  const [available,setAvailable]=useState(false), [loaded,setLoaded]=useState(false), [busy,setBusy]=useState(false);
  const [statusConfirmed,setStatusConfirmed]=useState(false);
  const [addressPolicy,setAddressPolicy]=useState<PublicationAddressPolicy>({enabled:false,allowedSlugs:[],reservedSlugs:[]});
  const [message,setMessage]=useState(""), [consent,setConsent]=useState<string|null>(null), [offline,setOffline]=useState(false);
  const [pending,setPending]=useState<Pending|null>(null);
  const [previewPath,setPreviewPath]=useState("/");
  const refreshSequence=useRef(0);
  const headers={"X-Makeborne-Account":accountId};
  const refresh=useCallback(async(signal?:AbortSignal, initial=false)=>{
    const sequence=++refreshSequence.current;
    setStatusConfirmed(false);
    try {
    const assertAccount=cloudAccountGuard(accountId); assertAccount();
    const [siteResponse,prepResponse]=await Promise.all([
      fetch(base,{cache:"no-store",headers:{"X-Makeborne-Account":accountId},signal}),
      fetch(`${base}/preparation`,{cache:"no-store",headers:{"X-Makeborne-Account":accountId},signal}),
    ]);
    const [current,progress]=await Promise.all([siteResponse.json(),prepResponse.json()]);
    assertAccount(); if(signal?.aborted||sequence!==refreshSequence.current)return;
    if(!siteResponse.ok)throw new Error(current.error?.message||"Publishing status is unavailable.");
    setSite(current.site);setLoaded(true);
    const policy:PublicationAddressPolicy=current.addressPolicy;
    if(!policy||typeof policy.enabled!=="boolean"||!Array.isArray(policy.reservedSlugs)||
      !policy.reservedSlugs.every((value:unknown)=>typeof value==="string")||
      (policy.allowedSlugs!==null&&(!Array.isArray(policy.allowedSlugs)||!policy.allowedSlugs.every((value:unknown)=>typeof value==="string"))))
      {setAddressPolicy({enabled:false,allowedSlugs:[],reservedSlugs:[]});setAvailable(false);throw new Error("Refresh the app to load its publishing options.");}
    setAddressPolicy(policy);
    if(initial&&!current.site&&policy.allowedSlugs?.length)setSlug(policy.allowedSlugs[0]);
    if(initial&&current.site){setSlug(current.site.slug);setInteractive(current.site.interactive);}
    setAvailable(current.preparationAvailable===true&&progress.available===true);
    if(!prepResponse.ok)throw new Error(progress.error?.message||"Preparation status is unavailable. Your live site is unchanged.");
    const next=progress.preparation===null?null:PublicationPreparationSchema.parse(progress.preparation);
    if(next&&(next.workspaceId!==workspaceId||next.artifactId!==artifactId))throw new Error("Preparation does not match this website.");
    setPreparation(next);
    if(initial&&next){setSlug(next.slug);setInteractive(next.interactive);}
    setStatusConfirmed(true);
    } catch(error) {
      if(sequence!==refreshSequence.current||signal?.aborted)return;
      if(!signal?.aborted){setAddressPolicy({enabled:false,allowedSlugs:[],reservedSlugs:[]});setAvailable(false);setConsent(null);}
      throw error;
    }
  },[accountId,artifactId,base,workspaceId]);

  useEffect(()=>{
    const abort=new AbortController();
    queueMicrotask(()=>{
      if(abort.signal.aborted)return;
      try {
        const saved=JSON.parse(sessionStorage.getItem(storageKey)||"null");
        if(saved&&typeof saved.key==="string"&&typeof saved.body==="string"&&saved.body.length<4096)setPending(saved);
      } catch { /* Recovery metadata is optional; server status remains available. */ }
      void refresh(abort.signal,true).catch(error=>{if(!abort.signal.aborted)setMessage(error instanceof Error?error.message:"Publishing status is unavailable.");});
    });
    return()=>abort.abort();
  },[refresh,storageKey]);
  const running=preparation?.state==="queued"||preparation?.state==="building";
  useEffect(()=>{
    if(!running)return;
    const abort=new AbortController();
    const timer=setInterval(()=>{if(document.visibilityState==="visible")void refresh(abort.signal).catch(error=>{if(!abort.signal.aborted)setMessage(error instanceof Error?error.message:"Refresh to check preparation.");});},3000);
    return()=>{clearInterval(timer);abort.abort();};
  },[running,refresh]);
  function remember(value:Pending|null) {
    setPending(value);
    try {if(value)sessionStorage.setItem(storageKey,JSON.stringify(value));else sessionStorage.removeItem(storageKey);}catch{}
  }
  function fenceStatus(confirmed:boolean) {
    refreshSequence.current++;
    setStatusConfirmed(confirmed);
  }
  async function prepare() {
    if(busy||running||!owner||!statusConfirmed)return;
    fenceStatus(false);
    setBusy(true);setConsent(null);setMessage("");
    const assertAccount=cloudAccountGuard(accountId);
    try {
      assertAccount();
      const operation=pending??{key:crypto.randomUUID(),body:JSON.stringify({version,revision:site?.revision??0,slug,interactive})};
      remember(operation);
      const response=await fetch(`${base}/preparation`,{method:"POST",headers:{...headers,"Content-Type":"application/json","Idempotency-Key":operation.key},body:operation.body,signal:AbortSignal.timeout(30_000)});
      const result=await response.json();assertAccount();
      if(!response.ok){if(response.status<500)remember(null);throw new Error(result.error?.message||"Preparation could not be confirmed. Retry the same request.");}
      const next=PublicationPreparationSchema.parse(result.preparation);
      if(next.workspaceId!==workspaceId||next.artifactId!==artifactId)throw new Error("Preparation does not match this website.");
      remember(null);setPreparation(next);setMessage("Preparing your saved website. Your current live site stays available.");
      fenceStatus(true);
    } catch(error){fenceStatus(false);setMessage(error instanceof Error?error.message:"Refresh status before retrying preparation.");}
    finally{setBusy(false);}
  }
  const matches=preparation?.version===version&&preparation.publicationRevision===(site?.revision??0)&&preparation.slug===slug&&preparation.interactive===interactive;
  const addressAllowed=addressPolicy.enabled&&validSiteSlug(slug)&&!addressPolicy.reservedSlugs.includes(slug)&&(addressPolicy.allowedSlugs===null||addressPolicy.allowedSlugs.includes(slug));
  const canPublish=preparation?.state==="ready"&&matches&&!dirty&&consent===preparation.id&&addressAllowed&&statusConfirmed;
  async function publish() {
    if(!canPublish||busy||!preparation||!owner)return;
    fenceStatus(false);
    setBusy(true);setMessage("");
    const assertAccount=cloudAccountGuard(accountId);
    try {
      assertAccount();
      const response=await fetch(base,{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify({preparationId:preparation.id,acknowledged:true}),signal:AbortSignal.timeout(30_000)});
      const result=await response.json();assertAccount();
      if(!response.ok)throw new Error(result.error?.message||"Publishing could not be confirmed. Refresh its status before retrying.");
      setSite(result.site);setConsent(null);setPreparation({...preparation,state:"published",previewHtml:null,previewRoutes:[]});
      setMessage("Your reviewed website is live. Future edits stay private until you publish again.");
      fenceStatus(true);
    } catch(error){fenceStatus(false);setMessage(error instanceof Error?error.message:"Refresh publishing status before retrying.");}
    finally{setBusy(false);}
  }
  async function takeOffline() {
    if(!site||busy||!owner)return;setBusy(true);
    fenceStatus(false);
    const assertAccount=cloudAccountGuard(accountId);
    try {
      assertAccount();
      const response=await fetch(base,{method:"POST",headers:{...headers,"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({live:false,slug:site.slug,version:site.version_number,revision:site.revision,acknowledged:true,interactive:false}),signal:AbortSignal.timeout(30_000)});
      const result=await response.json();assertAccount();
      if(!response.ok)throw new Error(result.error?.message||"Offline status is unconfirmed. Refresh before retrying.");
      setSite(result.site);setOffline(false);setConsent(null);setMessage("Your website is offline. Its address stays reserved.");
      fenceStatus(true);
    }catch(error){fenceStatus(false);setMessage(error instanceof Error?error.message:"Refresh publishing status.");}finally{setBusy(false);}
  }
  return <section className="website-publish" aria-labelledby={`publish-${artifactId}`}>
    <div className="website-publish-heading"><span className="website-publish-icon"><Globe2 size={18}/></span><div><h3 id={`publish-${artifactId}`}>Publish website</h3><p>{site?.live?`Live · version ${site.version_number}`:"Prepare, review, publish"}</p></div>{site?.live&&<span className="website-publish-live">Live</span>}</div>
    <p className="website-publish-detail">Prepare the saved version, review its final appearance, then publish it at your own address.</p>
    <label className="website-publish-label">Website address<span className="website-publish-address"><span>{SITE_ADDRESS_PARTS.before}<em>{slug||"your-site"}</em>{SITE_ADDRESS_PARTS.after}</span><input aria-label="Website address" value={slug} maxLength={48} disabled={!owner||busy||running||!!pending} onChange={e=>{setSlug(e.target.value.toLowerCase());setConsent(null);}} autoCapitalize="none" spellCheck={false}/></span></label>
    {addressPolicy.enabled&&addressPolicy.allowedSlugs!==null&&<p className="website-publish-detail">Test workspace addresses: {addressPolicy.allowedSlugs.join(" or ")}. Customer addresses are reserved for the live app.</p>}
    {addressPolicy.enabled&&validSiteSlug(slug)&&!addressAllowed&&<p className="website-publish-message">This address is reserved. Choose another website address.</p>}
    {HOSTING.interactiveAllowed&&<label className="website-publish-toggle"><input type="checkbox" checked={interactive} disabled={!owner||busy||running||!!pending} onChange={e=>{setInteractive(e.target.checked);setConsent(null);}}/><span><strong>Interactive website</strong><small>Run menus, forms and animations on your website’s separate domain.</small></span></label>}
    {site?.live&&<a className="website-publish-url" href={siteAddress(site.slug)} target="_blank" rel="noopener noreferrer">Open live website <ArrowUpRight size={13}/></a>}
    {!available&&loaded&&<p className="website-publish-detail">Verified publishing is being prepared. You can keep editing and visit any existing live website.</p>}
    {dirty&&<p className="website-publish-detail">Save your changes before preparing this version.</p>}
    {source&&<ClientReadyCheck source={source} pages={preparation?.state==="ready"&&matches?preparation.previewRoutes:undefined}/>}
    {owner?<button type="button" className="button secondary" disabled={busy||running||!loaded||!statusConfirmed||!available||disabled||dirty||version<1||!addressAllowed} onClick={()=>void prepare()}>{running||busy?<LoaderCircle size={15} className="auth-spinner"/>:<Globe2 size={15}/>} {running?"Preparing website…":pending?"Retry preparation request":"Prepare saved website"}</button>:<p className="website-publish-detail">Only the workspace owner can publish.</p>}
    {pending&&<div className="website-publish-detail"><p>Retry sends the original saved request, including its original address. To choose new options, refresh the publishing status first. Clearing this saved request does not cancel work already on the server.</p><button type="button" className="website-publish-text-button" disabled={busy||running||!statusConfirmed} onClick={()=>{if(!busy&&!running&&statusConfirmed){remember(null);setConsent(null);setMessage("Saved request cleared. Review the current status and choose your publishing options.");}}}>Clear saved preparation request</button></div>}
    {preparation?.state==="ready"&&preparation.previewHtml&&<div className="website-publication-review"><div><strong>Final appearance · version {preparation.version}</strong><p className="website-publish-detail">This shows the prepared page without running scripts here. {preparation.interactive?"Its verified build also includes interactive features.":"Visitors will see the static version."}</p></div><label className="website-publish-label">Page to review<select aria-label="Prepared page" value={preparation.previewRoutes.some(route=>route.path===previewPath)?previewPath:"/"} onChange={event=>setPreviewPath(event.target.value)}>{preparation.previewRoutes.map(route=><option key={route.path} value={route.path}>{route.path==="/"?"Home":route.path}</option>)}</select></label><iframe title="Prepared website appearance" srcDoc={previewDocument(preparation.previewRoutes.find(route=>route.path===previewPath)?.html??preparation.previewHtml)} sandbox="" referrerPolicy="no-referrer"/>{!matches&&<p className="website-publish-message">The saved version or publishing options changed. Prepare the website again.</p>}<label className="website-publish-consent"><input type="checkbox" checked={consent===preparation.id} disabled={!owner||!matches||dirty||busy} onChange={e=>setConsent(e.target.checked?preparation.id:null)}/><span>I’ve reviewed this prepared version and have permission to publish its content and artwork.</span></label><button type="button" className="button primary" disabled={!owner||!canPublish||busy||disabled} onClick={()=>void publish()}>{busy?"Publishing…":"Publish reviewed website"}</button></div>}
    {preparation?.error&&<p className="website-publish-message" role="alert">{preparation.error}</p>}
    <button type="button" className="website-publish-text-button" disabled={busy} onClick={()=>void refresh().catch(error=>setMessage(error instanceof Error?error.message:"Status unavailable."))}><RefreshCw size={12}/> Refresh publishing status</button>
    {site?.live&&owner&&(offline?<div className="website-publish-offline"><p>Take this website offline?</p><button type="button" className="button secondary small" disabled={busy} onClick={()=>void takeOffline()}>Take offline</button><button type="button" className="button secondary small" disabled={busy} onClick={()=>setOffline(false)}>Cancel</button></div>:<button type="button" className="website-publish-text-button" disabled={busy} onClick={()=>setOffline(true)}>Take website offline</button>)}
    {message&&<p className="website-publish-message" role="status">{message}</p>}
    {owner&&site?.live&&<WebsiteEnquiries key={`${accountId}:${artifactId}`} accountId={accountId} workspaceId={workspaceId} artifactId={artifactId}/>}
    <p className="website-publish-note">Preparing and publishing do not generate new AI content. Website safety limits: 50 new sites per day and 1,000 live sites per workspace. Payments and external services need their own integration.</p>
  </section>;
}
