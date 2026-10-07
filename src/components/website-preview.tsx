"use client";
import { useMemo, useState, useRef } from 'react';
import { Monitor, Smartphone, Download, Maximize2 } from 'lucide-react';
import type { WebsiteDesign } from '@/lib/generation/website-contract';
import { websiteDocument } from '@/lib/generation/website-document';

export default function WebsitePreview({title,website,dirty}:{title:string;website:WebsiteDesign;dirty:boolean}) {
 const [mobile,setMobile]=useState(false);
 const frame=useRef<HTMLIFrameElement>(null);
 const [expandError,setExpandError]=useState('');
 const previewDocument=useMemo(()=>{try{return websiteDocument(title,website,true);}catch{return null;}},[title,website]);
 const document=useMemo(()=>{try{return websiteDocument(title,website);}catch{return null;}},[title,website]);
 function download(){if(!document)return;const url=URL.createObjectURL(new Blob([document],{type:'text/html'}));const a=window.document.createElement('a');a.href=url;a.download='website.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <section className="account-preview" aria-label="Generated website preview">
  <header className="ap-toolbar"><div><strong>Website</strong><small>{dirty?'Saving design…':'Saved design'}</small></div><div className="ap-devices"><button type="button" aria-label="Desktop preview" aria-pressed={!mobile} onClick={()=>setMobile(false)}><Monitor size={16}/></button><button type="button" aria-label="Mobile preview" aria-pressed={mobile} onClick={()=>setMobile(true)}><Smartphone size={16}/></button><button type="button" aria-label="Expand website preview" onClick={()=>{if(frame.current?.requestFullscreen)void frame.current.requestFullscreen().catch(()=>setExpandError("Full-screen preview is unavailable in this browser."));else setExpandError("Full-screen preview is unavailable in this browser.");}}><Maximize2 size={16}/></button><button type="button" aria-label="Download website HTML" disabled={!document} onClick={download}><Download size={16}/></button></div></header>
  <div style={{padding:mobile?16:0,background:'#eeede9',display:'flex',justifyContent:'center'}}>{document?<iframe ref={frame} title={`${title} website`} sandbox="" referrerPolicy="no-referrer" srcDoc={previewDocument ?? undefined} style={{display:'block',border:0,width:mobile?390:'100%',maxWidth:'100%',height:'min(80vh, 940px)',minHeight:560,background:'white'}}/>:<p role="alert">This design could not be displayed safely.</p>}</div>
  {expandError && <p role="status">{expandError}</p>}
  <details style={{padding:'12px 16px',fontSize:12,color:'#5c616d'}}><summary>About this design</summary><p>{website.designNotes}</p><p>Static website preview. Navigation and CSS motion work. Payments, forms and backend services require connections. Text outline edits do not change this design yet; the downloaded HTML contains the complete design.</p></details>
 </section>;
}
