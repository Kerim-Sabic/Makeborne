import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { billingDatabase } from "@/lib/billing/database";
import { databaseError } from "@/lib/cloud/server";
import { RequestError } from "@/lib/server/http";

export const GITHUB_CALLBACK = "https://makeborne.com/api/github/callback";
export function githubConfigured() {
  return !!(process.env.MAKEBORNE_GITHUB_CLIENT_ID && process.env.MAKEBORNE_GITHUB_CLIENT_SECRET && process.env.MAKEBORNE_GITHUB_APP_SLUG && /^[a-f0-9]{64}$/i.test(process.env.MAKEBORNE_GITHUB_ENCRYPTION_KEY ?? ""));
}
export function githubConfig() {
  if (!githubConfigured()) throw new RequestError("GITHUB_UNAVAILABLE", "GitHub connections are being set up. Your website remains saved in Makeborne.",503);
  return { clientId: process.env.MAKEBORNE_GITHUB_CLIENT_ID!, secret: process.env.MAKEBORNE_GITHUB_CLIENT_SECRET!, slug: process.env.MAKEBORNE_GITHUB_APP_SLUG! };
}
export function sealToken(token: string, userId: string) {
  githubConfig();
  const iv=randomBytes(12), cipher=createCipheriv("aes-256-gcm",Buffer.from(process.env.MAKEBORNE_GITHUB_ENCRYPTION_KEY!,"hex"),iv);
  cipher.setAAD(Buffer.from(userId));
  const ciphertext=Buffer.concat([cipher.update(token,"utf8"),cipher.final()]);
  return [iv,cipher.getAuthTag(),ciphertext].map(b=>b.toString("base64url")).join(".");
}
function openToken(value:string,userId:string) {
  githubConfig();
  const [iv,tag,data]=value.split(".").map(v=>Buffer.from(v,"base64url"));
  const cipher=createDecipheriv("aes-256-gcm",Buffer.from(process.env.MAKEBORNE_GITHUB_ENCRYPTION_KEY!,"hex"),iv);
  cipher.setAAD(Buffer.from(userId));cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data),cipher.final()]).toString("utf8");
}
export async function githubRequest<T>(token:string,path:string,method="GET",body?:unknown,allow404=false):Promise<T|null> {
  if(!path.startsWith("/") || path.startsWith("//")) throw new Error("Invalid GitHub path");
  const response=await fetch(`https://api.github.com${path}`,{method,headers:{Authorization:`Bearer ${token}`,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2026-03-10","Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),cache:"no-store",redirect:"error",signal:AbortSignal.timeout(20_000)});
  if(allow404&&response.status===404)return null;
  if(!response.ok)throw new RequestError("GITHUB_REQUEST_FAILED",[401,403].includes(response.status)?"Reconnect GitHub and check the selected repository permissions.":response.status===409||response.status===422?"The repository changed. Refresh its status before syncing again.":"GitHub could not finish this request. Your saved website is unchanged.",response.status===429?429:409);
  return response.status===204?null:await response.json() as T;
}
export async function githubConnection(userId:string) {
  githubConfig();
  const {data,error}=await billingDatabase().from("github_connections").select("*").eq("user_id",userId).maybeSingle();
  databaseError(error);
  if(!data||Date.parse(data.expires_at)<Date.now()+60_000)throw new RequestError("GITHUB_RECONNECT","Connect GitHub to choose a repository. Connections expire after eight hours; reconnect to continue syncing.",401);
  const token=openToken(data.token_ciphertext,userId);
  const identity=await githubRequest<{id:number}>(token,"/user");
  if(identity?.id!==data.github_user_id)throw new RequestError("GITHUB_IDENTITY","Reconnect the correct GitHub account.",403);
  return {token,login:data.login as string};
}
export type GitHubRepository={id:number;full_name:string;private:boolean;archived:boolean;disabled:boolean;permissions?:{push?:boolean};default_branch:string};
export async function githubRepositories(token:string) {
  const results:GitHubRepository[]=[];
  // Only repositories accessible to BOTH this user and the installed GitHub App.
  for(let page=1;page<=10;page++) {
    const group=await githubRequest<{installations:{id:number}[]}>(token,`/user/installations?per_page=100&page=${page}`);
    for(const installation of group?.installations??[]) {
      for(let p=1;p<=10;p++) {
        const repos=await githubRequest<{repositories:GitHubRepository[]}>(token,`/user/installations/${installation.id}/repositories?per_page=100&page=${p}`);
        results.push(...(repos?.repositories??[]).filter(r=>r.permissions?.push&&!r.archived&&!r.disabled));
        if((repos?.repositories.length??0)<100)break;
      }
    }
    if((group?.installations.length??0)<100)break;
  }
  return [...new Map(results.map(r=>[r.id,r])).values()];
}
