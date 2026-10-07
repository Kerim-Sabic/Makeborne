"use client";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { PilotDraftSchema } from "@/lib/generation/pilot-contract";
import { WebsiteDesignSchema } from "@/lib/generation/website-contract";
import type { ArtifactContent } from "@/lib/domain";
export default function ClaudePilotButton({kind,brief,styleId,onStart,onDraft}:{kind:ArtifactContent['kind'];brief:string;styleId:string;onStart:()=>number;onDraft:(draft:ArtifactContent,revision:number)=>void}) {
 const [available,setAvailable]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{let current=true;fetch('/api/generate',{cache:'no-store'}).then(r=>r.json()).then(r=>{if(current)setAvailable(r.available===true);}).catch(()=>{});return()=>{current=false;};},[]);
 if(!available)return null;
 async function generate(){
  const revision=onStart();
  setBusy(true);setMessage(kind==='website'?'Designing and building your website…':'Writing your first text draft…');
  try{
   const r=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({attemptId:crypto.randomUUID(),kind,brief,styleId,mode:'improve'})});
   const value=await r.json();if(!r.ok)throw Error(value.error?.message||'Generation could not finish.');
   const parsed=PilotDraftSchema.parse({title:value.title,blocks:value.blocks?.map((b:{type:string;text:string})=>({type:b.type,text:b.text}))});
   const sections:ArtifactContent['sections']=[];
   for(const block of parsed.blocks){
    if(block.type==='heading'||!sections.length)sections.push({id:crypto.randomUUID(),title:block.type==='heading'?block.text:parsed.title,blocks:[]});
    sections[sections.length-1].blocks.push({...block,id:crypto.randomUUID(),assetId:null,locked:false,sourceIds:[]});
   }
   const website=kind==='website'?WebsiteDesignSchema.parse(value.website):undefined;
   onDraft({schemaVersion:1,...(website?{website}:{}),title:parsed.title,kind,sections},revision);setMessage(value.notice||'Text draft ready.');
  }catch(error){setMessage(error instanceof Error?error.message:'Generation could not finish.');}
  finally{setBusy(false);}
 }
 return <div style={{display:'grid',gap:10,justifyItems:'center',marginTop:16}}><button className="button primary" disabled={busy||brief.trim().length<3} onClick={()=>void generate()}><Sparkles size={15}/>{busy?'Creating…':kind==='website'?'Build website design':'Generate text draft'}</button><p className="small-note" role="status">{message||'Administrator test · uses the shared testing budget. Artwork is a separate step.'}</p></div>;
}
