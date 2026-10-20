"use client";
import {useCallback,useEffect,useState} from "react";
import {GitBranch,ArrowUpRight,LoaderCircle} from "lucide-react";
import {cloudAccountGuard} from "./cloud-api";
import {GITHUB_AUTHORIZATIONS_URL,GITHUB_DISCONNECT_CONFIRM,GITHUB_DISCONNECTED,GITHUB_INSTALLATIONS_URL} from "@/lib/github/disconnect-copy";
import "./website-publish.css";
type Connection={configured:boolean;connected?:boolean;login?:string;installUrl?:string;repositories?:{id:number;name:string;private:boolean}[]};
type Link={repository_id:number;repository_name:string;branch:string;version_number:number|null;commit_sha:string|null};
type Status={link:Link|null;branchUrl?:string|null;commitUrl?:string|null;alreadySynced?:boolean};
class GithubError extends Error{constructor(message:string,public code:string){super(message);}}
const reconnectCodes=new Set(["GITHUB_RECONNECT","GITHUB_IDENTITY"]);
/** One-way GitHub export. `source` projects push the saved version's complete
 * React project; static websites push their published HTML snapshot. */
export default function WebsiteGithub({accountId,workspaceId,artifactId,version,dirty,owner,source=false}:{accountId:string;workspaceId:string;artifactId:string;version:number;dirty:boolean;owner:boolean;source?:boolean}) {
  const [connection,setConnection]=useState<Connection|null>(null),[status,setStatus]=useState<Status>({link:null}),[repository,setRepository]=useState(0),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[code,setCode]=useState(""),[agreed,setAgreed]=useState(false),[disconnected,setDisconnected]=useState(false);
  const link=status.link;
  const path=`/api/cloud/workspaces/${workspaceId}/artifacts/${artifactId}/github`;
  const call=useCallback(async(url:string,options?:RequestInit)=>{
    const check=cloudAccountGuard(accountId);check();
    const response=await fetch(url,{...options,cache:"no-store",headers:{"Content-Type":"application/json","X-Makeborne-Account":accountId,...options?.headers}});
    const data=await response.json();check();if(!response.ok)throw new GithubError(data.error?.message||"Could not finish the GitHub request.",data.error?.code||"");return data;
  },[accountId]);
  const refresh=useCallback(async()=>{const next=await call("/api/github/connection");setConnection(next);if(next.configured){const data=await call(path);setStatus(data);if(data.link)setRepository(data.link.repository_id);}},[call,path]);
  useEffect(()=>{let active=true;queueMicrotask(()=>{if(active&&owner)void refresh().catch(e=>{if(active){setMessage(e.message);setCode(e instanceof GithubError?e.code:"");}});});return()=>{active=false;};},[refresh,owner]);
  async function act(action:"connect"|"sync"|"disconnect"|"refresh") {
    if(busy)return;
    if(action==="disconnect"&&!window.confirm(GITHUB_DISCONNECT_CONFIRM))return;
    setBusy(true);setMessage("");setCode("");setDisconnected(false);
    try {
      if(action==="connect"){const data=await call("/api/github/connect",{method:"POST",body:JSON.stringify({workspaceId,artifactId})});window.location.assign(data.url);return;}
      if(action==="sync"){const data=await call(path,{method:"POST",body:JSON.stringify({repositoryId:repository,version,acknowledged:true})});setStatus(data);setAgreed(false);setMessage(data.alreadySynced?`Version ${data.link.version_number} is already on GitHub.`:source?`Pushed version ${data.link.version_number} to GitHub.`:`Version ${data.link.version_number} synced to GitHub.`);}
      if(action==="disconnect"){await call("/api/github/connection",{method:"DELETE"});setConnection(null);setMessage(GITHUB_DISCONNECTED);setDisconnected(true);}
      if(action!=="sync")await refresh();
    }catch(error){
      setMessage(error instanceof Error?error.message:"GitHub is unavailable.");
      const failed=error instanceof GithubError?error.code:"";setCode(failed);
      if(reconnectCodes.has(failed))setConnection(current=>current?{...current,connected:false}:current);
    }finally{setBusy(false);}
  }
  if(!owner)return null;
  const reconnect=reconnectCodes.has(code)||(!!link&&connection?.configured&&!connection.connected);
  return <section className="website-publish" aria-labelledby={`github-${artifactId}`}>
    <div className="website-publish-heading"><span className="website-publish-icon"><GitBranch size={18}/></span><div><h3 id={`github-${artifactId}`}>Your code, on GitHub</h3><p>{connection?.connected?`Connected as ${connection.login}`:"Keep a copy in your repository"}</p></div></div>
    {connection?.configured===false?<p className="website-publish-detail">Repository connections are being set up. Your work is saved here.</p>:<>
      <p className="website-publish-detail">{source?<>Push the complete React + Vite source of saved version {version} — every file and image — as one commit on its own branch. Your default branch stays untouched.</>:"Sync your published website to its own branch. Your default branch stays untouched."}</p>
      {!connection?.connected?<button className="button secondary" type="button" disabled={busy} onClick={()=>void act("connect")}>{reconnect?"Reconnect GitHub":"Connect GitHub"}</button>:<>
        <label className="website-publish-label">Repository<select aria-label="GitHub repository" value={repository||""} disabled={!!link||busy} onChange={e=>{setRepository(Number(e.target.value));setAgreed(false);}}><option value="" disabled>Choose a repository</option>{connection.repositories?.map(r=><option key={r.id} value={r.id}>{r.name} · {r.private?"Private":"Public"}</option>)}</select></label>
        {connection.installUrl&&<a className="website-publish-text-button" href={connection.installUrl} target="_blank" rel="noopener noreferrer">Choose repositories in GitHub <ArrowUpRight size={13}/></a>}
        <button className="website-publish-text-button" type="button" disabled={busy} onClick={()=>void act("refresh")}>Refresh repositories</button>
        <label className="website-publish-consent"><input type="checkbox" checked={agreed} disabled={busy} onChange={e=>setAgreed(e.target.checked)}/><span>{source?`Send the source of saved version ${version} to the selected repository.`:"Send this published version to the selected repository."} Public repositories are visible to everyone.</span></label>
        <button className="button primary" type="button" disabled={busy||dirty||!repository||!agreed} onClick={()=>void act("sync")}>{busy?<LoaderCircle size={14} className="auth-spinner"/>:<GitBranch size={14}/>} {source?`Push version ${version} to GitHub`:"Sync published version"}</button>
        <button className="website-publish-text-button" type="button" disabled={busy} onClick={()=>void act("disconnect")}>Disconnect GitHub</button>
      </>}
      {link?.commit_sha&&<>
        <p className="website-publish-detail" role="status">{source?"Pushed":"Synced"} version {link.version_number} to <strong>{link.repository_name}</strong> on branch <code>{link.branch}</code>.</p>
        {status.commitUrl&&<a className="website-publish-text-button" href={status.commitUrl} target="_blank" rel="noopener noreferrer">View commit <ArrowUpRight size={13}/></a>}
        <a className="website-publish-text-button" href={status.branchUrl??`https://github.com/${link.repository_name}/tree/${link.branch}`} target="_blank" rel="noopener noreferrer">View branch <ArrowUpRight size={13}/></a>
      </>}
      <p className="website-publish-note">{source?"One-way export of the full source, original images and a README with run instructions. Nothing is force-pushed, and changes made in GitHub aren’t imported. Your GitHub connection renews itself; you only reconnect if GitHub asks you to.":"One-way export of the published HTML, styles, and images. External edits aren’t imported. Your GitHub connection renews itself; you only reconnect if GitHub asks you to."}</p>
    </>}
    {message&&<p className="website-publish-message" role="status">{message}</p>}
    {disconnected&&<><a className="website-publish-text-button" href={GITHUB_AUTHORIZATIONS_URL} target="_blank" rel="noopener noreferrer">Revoke the app in GitHub settings <ArrowUpRight size={13}/></a><a className="website-publish-text-button" href={GITHUB_INSTALLATIONS_URL} target="_blank" rel="noopener noreferrer">Remove its repository access <ArrowUpRight size={13}/></a></>}
    {code==="BRANCH_CHANGED"&&link&&<a className="website-publish-text-button" href={status.branchUrl??`https://github.com/${link.repository_name}/tree/${link.branch}`} target="_blank" rel="noopener noreferrer">Review the branch in GitHub <ArrowUpRight size={13}/></a>}
  </section>;
}
