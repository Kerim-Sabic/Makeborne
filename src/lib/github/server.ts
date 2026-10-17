import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { billingDatabase } from "@/lib/billing/database";
import { databaseError } from "@/lib/cloud/server";
import { RequestError } from "@/lib/server/http";
import { githubClient } from "@/lib/github/api";
import { activeGitHubToken,type ActiveGitHubToken,type ConnectionDatabase } from "@/lib/github/connection";

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
  return githubClient(token)<T>(path,method,body,allow404);
}
// One renewal per user per server instance; other instances are serialized by the
// compare-and-swap in activeGitHubToken because GitHub refresh tokens are single-use.
const renewals=new Map<string,Promise<ActiveGitHubToken>>();
export async function githubConnection(userId:string) {
  const config=githubConfig();
  const {token,githubUserId,login}=await activeGitHubToken(userId,{db:billingDatabase() as unknown as ConnectionDatabase,config,seal:value=>sealToken(value,userId),open:value=>openToken(value,userId),dbError:databaseError,renewals});
  const identity=await githubRequest<{id:number}>(token,"/user");
  if(identity?.id!==githubUserId)throw new RequestError("GITHUB_IDENTITY","Reconnect the correct GitHub account.",403);
  return {token,login};
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
