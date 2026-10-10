import { cloudContext,cloudError,cloudJson,databaseError } from "@/lib/cloud/server";
import { billingDatabase } from "@/lib/billing/database";
import { sameOrigin } from "@/lib/server/http";
import { githubConfigured,githubConfig,githubConnection,githubRepositories } from "@/lib/github/server";
export async function GET() {
  try {
    const {user}=await cloudContext();
    if(!githubConfigured())return cloudJson({configured:false});
    const {data,error}=await billingDatabase().from("github_connections").select("login,expires_at").eq("user_id",user.id).maybeSingle();databaseError(error);
    const installUrl=`https://github.com/apps/${encodeURIComponent(githubConfig().slug)}/installations/new`;
    if(!data||Date.parse(data.expires_at)<Date.now()+60_000)return cloudJson({configured:true,connected:false,installUrl});
    const {token,login}=await githubConnection(user.id);
    const repositories=await githubRepositories(token);
    return cloudJson({configured:true,connected:true,login,installUrl,expiresAt:data.expires_at,repositories:repositories.map(r=>({id:r.id,name:r.full_name,private:r.private}))});
  }catch(error){return cloudError(error);}
}
export async function DELETE(request:Request) {
  try {
    sameOrigin(request);
    const {user}=await cloudContext();
    const {error}=await billingDatabase().from("github_connections").delete().eq("user_id",user.id);databaseError(error);
    return cloudJson({disconnected:true});
  }catch(error){return cloudError(error);}
}
