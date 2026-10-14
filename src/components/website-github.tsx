"use client";
import {useCallback,useEffect,useState} from "react";
import {GitBranch,ArrowUpRight,LoaderCircle} from "lucide-react";
import {cloudAccountGuard} from "./cloud-api";
import "./website-publish.css";
type Connection={configured:boolean;connected?:boolean;login?:string;installUrl?:string;repositories?:{id:number;name:string;private:boolean}[]};
type Link={repository_id:number;repository_name:string;branch:string;version_number:number|null;commit_sha:string|null};
export default function WebsiteGithub({accountId,workspaceId,artifactId,version,dirty,owner}:{accountId:string;workspaceId:string;artifactId:string;version:number;dirty:boolean;owner:boolean}) {
  const [connection,setConnection]=useState<Connection|null>(null),[link,setLink]=useState<Link|null>(null),[repository,setRepository]=useState(0),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[agreed,setAgreed]=useState(false);
  const path=`/api/cloud/workspaces/${workspaceId}/artifacts/${artifactId}/github`;
  const call=useCallback(async(url:string,options?:RequestInit)=>{
    const check=cloudAccountGuard(accountId);check();
    const response=await fetch(url,{...options,cache:"no-store",headers:{"Content-Type":"application/json","X-Makeborne-Account":accountId,...options?.headers}});
    const data=await response.json();check();if(!response.ok)throw new Error(data.error?.message||"Could not finish the GitHub request.");return data;
  },[accountId]);
  const refresh=useCallback(async()=>{const status=await call("/api/github/connection");setConnection(status);if(status.configured){const data=await call(path);setLink(data.link);if(data.link)setRepository(data.link.repository_id);}},[call,path]);
  useEffect(()=>{let active=true;queueMicrotask(()=>{if(active&&owner)void refresh().catch(e=>{if(active)setMessage(e.message);});});return()=>{active=false;};},[refresh,owner]);
  async function act(action:"connect"|"sync"|"disconnect"|"refresh") {
    if(busy)return;setBusy(true);setMessage("");
    try {
      if(action==="connect"){const data=await call("/api/github/connect",{method:"POST",body:JSON.stringify({workspaceId,artifactId})});window.location.assign(data.url);return;}
      if(action==="sync"){const data=await call(path,{method:"POST",body:JSON.stringify({repositoryId:repository,version,acknowledged:true})});setLink(data.link);setAgreed(false);setMessage(`Version ${data.link.version_number} synced to GitHub.`);}
      if(action==="disconnect"){await call("/api/github/connection",{method:"DELETE"});setConnection(null);setMessage("Disconnected. Your repository and exported code stay in GitHub.");}
      if(action!=="sync")await refresh();
    }catch(error){setMessage(error instanceof Error?error.message:"GitHub is unavailable.");}finally{setBusy(false);}
  }
  if(!owner)return null;
  return <section className="website-publish" aria-labelledby={`github-${artifactId}`}>
    <div className="website-publish-heading"><span className="website-publish-icon"><GitBranch size={18}/></span><div><h3 id={`github-${artifactId}`}>Your code, on GitHub</h3><p>{connection?.connected?`Connected as ${connection.login}`:"Keep a copy in your repository"}</p></div></div>
    {connection?.configured===false?<p className="website-publish-detail">Repository connections are being set up. Your work is saved here.</p>:<>
      <p className="website-publish-detail">Sync your published website to its own branch. Your default branch stays untouched.</p>
      {!connection?.connected?<button className="button secondary" type="button" disabled={busy} onClick={()=>void act("connect")}>Connect GitHub</button>:<>
        <label className="website-publish-label">Repository<select aria-label="GitHub repository" value={repository||""} disabled={!!link||busy} onChange={e=>{setRepository(Number(e.target.value));setAgreed(false);}}><option value="" disabled>Choose a repository</option>{connection.repositories?.map(r=><option key={r.id} value={r.id}>{r.name} · {r.private?"Private":"Public"}</option>)}</select></label>
        {connection.installUrl&&<a className="website-publish-text-button" href={connection.installUrl} target="_blank" rel="noopener noreferrer">Choose repositories in GitHub <ArrowUpRight size={13}/></a>}
        <button className="website-publish-text-button" type="button" disabled={busy} onClick={()=>void act("refresh")}>Refresh repositories</button>
        <label className="website-publish-consent"><input type="checkbox" checked={agreed} disabled={busy} onChange={e=>setAgreed(e.target.checked)}/><span>Send this published version to the selected repository. Public repositories are visible to everyone.</span></label>
        <button className="button primary" type="button" disabled={busy||dirty||!repository||!agreed} onClick={()=>void act("sync")}>{busy?<LoaderCircle size={14} className="auth-spinner"/>:<GitBranch size={14}/>} Sync published version</button>
        <button className="website-publish-text-button" type="button" disabled={busy} onClick={()=>void act("disconnect")}>Disconnect GitHub</button>
      </>}
      {link?.commit_sha&&<a className="website-publish-text-button" href={`https://github.com/${link.repository_name}/tree/${link.branch}`} target="_blank" rel="noopener noreferrer">View version {link.version_number} on GitHub <ArrowUpRight size={13}/></a>}
      <p className="website-publish-note">One-way export of the published HTML, styles, and images. External edits aren’t imported. Reconnect after eight hours to continue syncing.</p>
    </>}
    {message&&<p className="website-publish-message" role="status">{message}</p>}
  </section>;
}
