"use client";
import {useCallback,useEffect,useState} from "react";
import {Check,UserPlus} from "lucide-react";
import {cloudAccountGuard} from "./cloud-api";
import {addEnquiriesToClients,resultMessage} from "./enquiry-leads";
type Enquiry={id:string;name:string;email:string;message:string;created_at:string;read_at:string|null;clientId?:string|null};
type Inbox={items:Enquiry[];enabled:boolean;available:boolean};
export default function WebsiteEnquiries({accountId,workspaceId,artifactId}:{accountId:string;workspaceId:string;artifactId:string}){
 const [items,setItems]=useState<Enquiry[]>([]),[enabled,setEnabled]=useState(false),[available,setAvailable]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[note,setNote]=useState("");
 const path=`/api/cloud/workspaces/${workspaceId}/artifacts/${artifactId}/enquiries`;
 const load=useCallback(async()=>{const guard=cloudAccountGuard(accountId);guard();const response=await fetch(path,{headers:{"X-Makeborne-Account":accountId},cache:"no-store"});const result=await response.json();guard();if(!response.ok)throw Error(result.error?.message??"Enquiries unavailable.");return result as Inbox;},[path,accountId]);
 const apply=useCallback((result:Inbox)=>{setItems(result.items);setEnabled(result.enabled);setAvailable(result.available);setError("");},[]);
 const refresh=()=>load().then(apply);
 // Parent keys this component by account and artifact, resetting private state.
 useEffect(()=>{let active=true;void load().then(result=>{if(active)apply(result);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[load,apply]);
 async function update(body:{enabled:boolean}|{readId:string}){setBusy(true);setError("");try{const guard=cloudAccountGuard(accountId);guard();const response=await fetch(path,{method:"PATCH",headers:{"Content-Type":"application/json","X-Makeborne-Account":accountId},body:JSON.stringify(body)});guard();if(!response.ok)throw Error((await response.json()).error?.message??"Could not save.");await refresh();}catch(e){setError(e instanceof Error?e.message:"Could not save.");}finally{setBusy(false);}}
 // Website enquiries become leads in Clients (follow-up today, message saved as a note).
 async function addToClients(ids:string[]){setBusy(true);setError("");setNote("");try{const results=await addEnquiriesToClients(accountId,workspaceId,ids);setNote(resultMessage(results));const failed=results.find(item=>item.status==="failed");if(failed)setError(failed.message??"Some enquiries couldn't be added.");await refresh();}catch(e){setError(e instanceof Error?e.message:"Could not add to clients.");}finally{setBusy(false);}}
 const notInClients=items.filter(item=>!item.clientId);
 return <section className="website-publish" aria-label="Website enquiries">
  <h3>Enquiries <small>{items.filter(item=>!item.read_at).length} new</small></h3>
  <p>Messages submitted through your published website appear here. Add them to Clients to follow up. Email forwarding is not enabled.</p>
  <label className="website-publish-toggle"><input type="checkbox" checked={enabled} disabled={!available||busy} onChange={event=>void update({enabled:event.target.checked})}/><span>Accept website enquiries<small>Requires interactive hosting and a connected form. Publish a privacy notice before collecting visitor details.</small></span></label>
  <div className="button-row">
   <button type="button" className="website-publish-text-button" disabled={busy} onClick={()=>void refresh().catch(e=>setError(e.message))}>Refresh inbox</button>
   {notInClients.length>1&&<button type="button" className="button secondary small" disabled={busy} onClick={()=>void addToClients(notInClients.slice(0,25).map(item=>item.id))}><UserPlus size={14}/>Add all new to clients ({Math.min(25,notInClients.length)})</button>}
  </div>
  {note&&<p role="status">{note}</p>}
  {error&&<p role="alert">{error}</p>}
  {!items.length?<p>No enquiries yet.</p>:items.map(item=><article key={item.id} style={{padding:"16px 0",borderTop:"1px solid var(--border, #ddd)"}}>
   <strong>{item.name}</strong> · <a href={`mailto:${encodeURIComponent(item.email)}`}>{item.email}</a>
   <p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{item.message}</p>
   <small>{new Date(item.created_at).toLocaleString()}</small>
   <div className="button-row">
    {item.clientId?<span className="small-note" style={{display:"inline-flex",alignItems:"center",gap:4}}><Check size={13}/>In Clients</span>
     :<button type="button" className="button secondary small" disabled={busy} onClick={()=>void addToClients([item.id])}><UserPlus size={14}/>Add to clients</button>}
    {!item.read_at&&<button type="button" className="website-publish-text-button" disabled={busy} onClick={()=>void update({readId:item.id})}>Mark read</button>}
   </div>
  </article>)}
 </section>;
}
