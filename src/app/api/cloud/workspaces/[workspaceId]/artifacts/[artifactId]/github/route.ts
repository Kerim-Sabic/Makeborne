import { z } from "zod";
import { cloudBody,cloudContext,cloudError,cloudJson,databaseError,validId } from "@/lib/cloud/server";
import { mapVersion } from "@/lib/cloud/mappers";
import { billingDatabase } from "@/lib/billing/database";
import { githubClient } from "@/lib/github/api";
import { githubConnection,githubRepositories } from "@/lib/github/server";
import { githubLinkUrls,githubSourceSnapshot,pushWebsiteSnapshot,pushWebsiteSource,websiteBranch } from "@/lib/github/website-sync";
import { resolveWebsiteSourceAssets } from "@/lib/projects/source-assets";
import { RequestError } from "@/lib/server/http";
export const runtime="nodejs";
// A full-source push can upload up to 100 verified images to GitHub.
export const maxDuration=300;
type Context={params:Promise<{workspaceId:string;artifactId:string}>};
const columns="repository_id,repository_name,branch,commit_sha,version_number,updated_at";
type Link={repository_id:number;repository_name:string;branch:string;commit_sha:string|null;version_number:number|null;updated_at:string};
const linkJson=(link:Link|null,extra:Record<string,unknown>={})=>cloudJson({link,...githubLinkUrls(link),...extra});
export async function GET(_request:Request,context:Context) {
  try {
    const {workspaceId,artifactId}=await context.params;validId(artifactId);
    const {user,workspace}=await cloudContext(workspaceId);
    if(workspace?.role!=="owner")throw new RequestError("OWNER_REQUIRED","Only the workspace owner can connect website code.",403);
    const {data,error}=await billingDatabase().from("github_website_links").select(columns).eq("workspace_id",workspaceId).eq("artifact_id",artifactId).eq("user_id",user.id).maybeSingle();databaseError(error);
    return linkJson(data as Link|null);
  }catch(error){return cloudError(error);}
}
export async function POST(request:Request,context:Context) {
  try {
    const body=await cloudBody(request,z.object({repositoryId:z.number().int().positive().safe(),version:z.number().int().positive(),acknowledged:z.literal(true)}).strict(),1000);
    const {workspaceId,artifactId}=await context.params;validId(artifactId);
    const {user,workspace,client}=await cloudContext(workspaceId,true);
    if(workspace?.role!=="owner")throw new RequestError("OWNER_REQUIRED","Only the workspace owner can sync website code.",403);
    // React source projects push the saved version's complete project; static
    // websites keep pushing their published HTML snapshot.
    const {data:row,error:versionError}=await client.from("artifact_versions").select("*").eq("workspace_id",workspaceId).eq("artifact_id",artifactId).eq("version_number",body.version).maybeSingle();databaseError(versionError);
    const sourceRow=!!(row?.content&&typeof row.content==="object"&&"websiteSource" in row.content&&row.content.websiteSource);
    let snapshot:ReturnType<typeof githubSourceSnapshot>|null=null,html:string|null=null;
    if(sourceRow){
      const version=mapVersion(row!);
      if(version.artifactId!==artifactId||version.number!==body.version||version.content.kind!=="website"||!version.content.websiteSource)throw new RequestError("SOURCE_UNAVAILABLE","The saved website version could not be verified.",503);
      const {data:artifact,error:artifactError}=await client.from("artifacts").select("project_id").eq("workspace_id",workspaceId).eq("id",artifactId).maybeSingle();databaseError(artifactError);
      if(!artifact)throw new RequestError("NOT_FOUND","This source project is unavailable.",404);
      const artwork=await resolveWebsiteSourceAssets(client,{workspaceId,projectId:artifact.project_id},version.content.websiteSource);
      // Fully materialised, validated and size-checked before anything reaches GitHub.
      snapshot=githubSourceSnapshot(version,artwork,artifactId);
    }else{
      const {data:site,error:siteError}=await client.from("hosted_sites").select("html,version_number,live").eq("workspace_id",workspaceId).eq("artifact_id",artifactId).maybeSingle();databaseError(siteError);
      if(!site?.live||site.version_number!==body.version)throw new RequestError("PUBLISH_FIRST","Publish this saved version before syncing its public website code.",409);
      html=site.html as string;
    }
    const {token}=await githubConnection(user.id);
    const repository=(await githubRepositories(token)).find(r=>r.id===body.repositoryId);
    if(!repository||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository.full_name))throw new RequestError("REPOSITORY_ACCESS","Choose a writable repository enabled in your GitHub connection.",403);
    const db=billingDatabase(),branch=websiteBranch(artifactId);
    const {data:existing,error:readError}=await db.from("github_website_links").select("*").eq("artifact_id",artifactId).maybeSingle();databaseError(readError);
    if(existing&&(existing.user_id!==user.id||existing.workspace_id!==workspaceId||existing.repository_id!==repository.id))throw new RequestError("REPOSITORY_LOCKED","This website is already linked to another repository or owner.",409);
    if(!existing){const {error}=await db.from("github_website_links").insert({artifact_id:artifactId,workspace_id:workspaceId,user_id:user.id,repository_id:repository.id,repository_name:repository.full_name,branch});databaseError(error);}
    const github=githubClient(token),recordedCommitSha=(existing?.commit_sha as string|null|undefined)??null;
    const result=snapshot
      ?await pushWebsiteSource(github,{repository:repository.full_name,artifactId,recordedCommitSha,snapshot})
      :await pushWebsiteSnapshot(github,{repository:repository.full_name,artifactId,version:body.version,html:html!,recordedCommitSha});
    let update=db.from("github_website_links").update({commit_sha:result.commitSha,version_number:body.version,repository_name:repository.full_name,updated_at:new Date().toISOString()}).eq("artifact_id",artifactId).eq("user_id",user.id);
    update=recordedCommitSha?update.eq("commit_sha",recordedCommitSha):update.is("commit_sha",null);
    const {data:link,error}=await update.select(columns).maybeSingle();databaseError(error);
    if(!link)throw new RequestError("SYNC_STATUS_CHANGED","The sync status changed. Refresh to see the latest result.",409);
    return linkJson(link as Link,{kind:snapshot?"source":"snapshot",alreadySynced:result.alreadySynced,...(snapshot?{files:snapshot.files.length}:{})});
  }catch(error){return cloudError(error);}
}
