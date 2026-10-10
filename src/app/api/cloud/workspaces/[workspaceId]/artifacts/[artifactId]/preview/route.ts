import {readSavedWebsiteGeneration} from "@/lib/projects/preview-session-server";
import {cloudJson,cloudError} from "@/lib/cloud/server";
export const runtime="nodejs";
type Context={params:Promise<{workspaceId:string;artifactId:string}>};
export async function GET(request:Request,context:Context) {
  try {
    const {workspaceId,artifactId}=await context.params;
    return cloudJson({job:await readSavedWebsiteGeneration(request,workspaceId,artifactId)});
  } catch(error){return cloudError(error);}
}
