import { createHash } from "node:crypto";
import { z } from "zod";
import { cloudBody,cloudContext,cloudError,cloudJson,databaseError,validId } from "@/lib/cloud/server";
import { billingDatabase } from "@/lib/billing/database";
import { githubConnection,githubRepositories,githubRequest } from "@/lib/github/server";
import { RequestError } from "@/lib/server/http";
export const maxDuration=60;
type Context={params:Promise<{workspaceId:string;artifactId:string}>};
const columns="repository_id,repository_name,branch,commit_sha,version_number,updated_at";
export async function GET(_request:Request,context:Context) {
  try {
    const {workspaceId,artifactId}=await context.params;validId(artifactId);
    const {user,workspace}=await cloudContext(workspaceId);
    if(workspace?.role!=="owner")throw new RequestError("OWNER_REQUIRED","Only the workspace owner can connect website code.",403);
    const {data,error}=await billingDatabase().from("github_website_links").select(columns).eq("workspace_id",workspaceId).eq("artifact_id",artifactId).eq("user_id",user.id).maybeSingle();databaseError(error);
    return cloudJson({link:data});
  }catch(error){return cloudError(error);}
}
export async function POST(request:Request,context:Context) {
  try {
    const body=await cloudBody(request,z.object({repositoryId:z.number().int().positive().safe(),version:z.number().int().positive(),acknowledged:z.literal(true)}).strict(),1000);
    const {workspaceId,artifactId}=await context.params;validId(artifactId);
    const {user,workspace,client}=await cloudContext(workspaceId,true);
    if(workspace?.role!=="owner")throw new RequestError("OWNER_REQUIRED","Only the workspace owner can sync website code.",403);
    const {data:site,error:siteError}=await client.from("hosted_sites").select("html,version_number,live").eq("workspace_id",workspaceId).eq("artifact_id",artifactId).maybeSingle();databaseError(siteError);
    if(!site?.live||site.version_number!==body.version)throw new RequestError("PUBLISH_FIRST","Publish this saved version before syncing its public website code.",409);
    const {token}=await githubConnection(user.id);
    const repository=(await githubRepositories(token)).find(r=>r.id===body.repositoryId);
    if(!repository||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository.full_name))throw new RequestError("REPOSITORY_ACCESS","Choose a writable repository enabled in your GitHub connection.",403);
    const db=billingDatabase(),branch=`makeborne/site-${artifactId}`;
    const {data:existing,error:readError}=await db.from("github_website_links").select("*").eq("artifact_id",artifactId).maybeSingle();databaseError(readError);
    if(existing&&(existing.user_id!==user.id||existing.workspace_id!==workspaceId||existing.repository_id!==repository.id))throw new RequestError("REPOSITORY_LOCKED","This website is already linked to another repository or owner.",409);
    if(!existing){const {error}=await db.from("github_website_links").insert({artifact_id:artifactId,workspace_id:workspaceId,user_id:user.id,repository_id:repository.id,repository_name:repository.full_name,branch});databaseError(error);}
    const prefix=`/repos/${repository.full_name}`;
    const head=await githubRequest<{object:{sha:string}}>(token,`${prefix}/git/ref/heads/${branch}`,"GET",undefined,true);
    const digest=createHash("sha256").update(site.html).digest("hex");
    const marker=`Makeborne website ${artifactId} version ${body.version}\n\nSnapshot: ${digest}`;
    let commitSha=head?.object.sha??null,alreadySynced=false;
    if(head){
      const commit=await githubRequest<{message:string}>(token,`${prefix}/git/commits/${head.object.sha}`);
      alreadySynced=commit?.message===marker;
      if(!alreadySynced&&head.object.sha!==existing?.commit_sha)throw new RequestError("BRANCH_CHANGED","This GitHub branch has external changes. Your code was not overwritten. Review the branch in GitHub before syncing.",409);
    }else if(existing?.commit_sha)throw new RequestError("BRANCH_MISSING","The linked branch was removed. Restore it in GitHub before syncing.",409);
    if(!alreadySynced){
      const tree=await githubRequest<{sha:string}>(token,`${prefix}/git/trees`,"POST",{tree:[{path:"index.html",mode:"100644",type:"blob",content:site.html},{path:"README.md",mode:"100644",type:"blob",content:`# Website exported from Makeborne\n\nPublished version ${body.version}. Open index.html or deploy this branch as a static site.\n\nThis branch is managed by Makeborne. Copy it to another branch before editing externally. Sync is one-way; external edits are not imported. No backend, credentials, or private project sources are included.\n`}]});
      const commit=await githubRequest<{sha:string}>(token,`${prefix}/git/commits`,"POST",{message:marker,tree:tree!.sha,parents:head?[head.object.sha]:[]});
      commitSha=commit!.sha;
      if(head)await githubRequest(token,`${prefix}/git/refs/heads/${branch}`,"PATCH",{sha:commitSha,force:false});
      else await githubRequest(token,`${prefix}/git/refs`,"POST",{ref:`refs/heads/${branch}`,sha:commitSha});
    }
    let update=db.from("github_website_links").update({commit_sha:commitSha,version_number:body.version,repository_name:repository.full_name,updated_at:new Date().toISOString()}).eq("artifact_id",artifactId).eq("user_id",user.id);
    update=existing?.commit_sha?update.eq("commit_sha",existing.commit_sha):update.is("commit_sha",null);
    const {data:link,error}=await update.select(columns).maybeSingle();databaseError(error);
    if(!link)throw new RequestError("SYNC_STATUS_CHANGED","The sync status changed. Refresh to see the latest result.",409);
    return cloudJson({link});
  }catch(error){return cloudError(error);}
}
