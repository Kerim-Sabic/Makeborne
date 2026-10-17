import { cloudContext,cloudError,cloudJson,databaseError } from "@/lib/cloud/server";
import { billingDatabase } from "@/lib/billing/database";
import { RequestError,sameOrigin } from "@/lib/server/http";
import { githubConfigured,githubConfig,githubConnection,githubRepositories } from "@/lib/github/server";
export async function GET() {
  try {
    const {user}=await cloudContext();
    if(!githubConfigured())return cloudJson({configured:false});
    const {data,error}=await billingDatabase().from("github_connections").select("login").eq("user_id",user.id).maybeSingle();databaseError(error);
    const installUrl=`https://github.com/apps/${encodeURIComponent(githubConfig().slug)}/installations/new`;
    if(!data)return cloudJson({configured:true,connected:false,installUrl});
    // An expired eight-hour token is renewed here when a refresh token is held;
    // only a connection GitHub no longer accepts reads as disconnected.
    let session:Awaited<ReturnType<typeof githubConnection>>;
    try{session=await githubConnection(user.id);}
    catch(error){if(error instanceof RequestError&&error.code==="GITHUB_RECONNECT")return cloudJson({configured:true,connected:false,installUrl});throw error;}
    const repositories=await githubRepositories(session.token);
    return cloudJson({configured:true,connected:true,login:session.login,installUrl,repositories:repositories.map(r=>({id:r.id,name:r.full_name,private:r.private}))});
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
