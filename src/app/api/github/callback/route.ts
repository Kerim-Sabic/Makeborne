import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { cloudContext,databaseError } from "@/lib/cloud/server";
import { billingDatabase } from "@/lib/billing/database";
import { GITHUB_CALLBACK,githubConfig,githubRequest,sealToken } from "@/lib/github/server";
import { parseTokenGrant,tokenColumns } from "@/lib/github/connection";
export async function GET(request:Request) {
  let destination="/studio?tab=projects";
  const jar=await cookies();
  const stored=jar.get("makeborne_github_oauth")?.value;
  jar.delete("makeborne_github_oauth");
  try {
    const flow=z.object({state:z.string().length(43),verifier:z.string().length(43),userId:z.string().uuid(),workspaceId:z.string().uuid(),artifactId:z.string().uuid()}).parse(JSON.parse(stored??"{}"));
    const params=new URL(request.url).searchParams;
    if(params.get("state")!==flow.state||!params.get("code")||params.get("code")!.length>300)throw new Error("Invalid state");
    const {user}=await cloudContext(flow.workspaceId,true);
    if(user.id!==flow.userId)throw new Error("Account changed");
    destination+=`&workspace=${flow.workspaceId}&artifact=${flow.artifactId}`;
    const config=githubConfig();
    const response=await fetch("https://github.com/login/oauth/access_token",{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify({client_id:config.clientId,client_secret:config.secret,code:params.get("code"),redirect_uri:GITHUB_CALLBACK,code_verifier:flow.verifier}),cache:"no-store",redirect:"error",signal:AbortSignal.timeout(20_000)});
    // The refresh token (when GitHub issues one) is sealed like the access token so the connection can renew itself.
    const token=parseTokenGrant(await response.json());
    if(!response.ok)throw new Error("Authorization failed");
    const identity=await githubRequest<{id:number;login:string}>(token.access_token,"/user");
    if(!identity)throw new Error("No identity");
    const {error}=await billingDatabase().from("github_connections").upsert({user_id:user.id,github_user_id:identity.id,login:identity.login,...tokenColumns(token,value=>sealToken(value,user.id)),updated_at:new Date().toISOString()});
    databaseError(error);
    return NextResponse.redirect(new URL(`${destination}&github=connected`,"https://makeborne.com"),{headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
  }catch {
    return NextResponse.redirect(new URL(`${destination}&github=retry`,"https://makeborne.com"),{headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
  }
}
