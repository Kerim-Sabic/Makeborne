import { randomBytes,createHash } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { cloudBody,cloudContext,cloudError,cloudJson } from "@/lib/cloud/server";
import { GITHUB_CALLBACK,githubConfig } from "@/lib/github/server";
export async function POST(request:Request) {
  try {
    const {workspaceId,artifactId}=await cloudBody(request,z.object({workspaceId:z.string().uuid(),artifactId:z.string().uuid()}).strict(),500);
    const {user}=await cloudContext(workspaceId,true);
    const config=githubConfig(),state=randomBytes(32).toString("base64url"),verifier=randomBytes(32).toString("base64url");
    (await cookies()).set("makeborne_github_oauth",JSON.stringify({state,verifier,userId:user.id,workspaceId,artifactId}),{httpOnly:true,secure:true,sameSite:"lax",path:"/api/github",maxAge:600});
    const url=new URL("https://github.com/login/oauth/authorize");
    url.search=new URLSearchParams({client_id:config.clientId,redirect_uri:GITHUB_CALLBACK,state,code_challenge:createHash("sha256").update(verifier).digest("base64url"),code_challenge_method:"S256"}).toString();
    return cloudJson({url:url.href});
  }catch(error){return cloudError(error);}
}
