import {cloudError, cloudJson} from "@/lib/cloud/server";
import {readPublicationPreparation, requestPublicationPreparation, trustedPublicationAvailable} from "@/lib/projects/publication-server";

export const runtime = "nodejs";
type Context = {params: Promise<{workspaceId: string; artifactId: string}>};
export async function GET(request: Request, context: Context) {
  try {
    const {workspaceId, artifactId} = await context.params;
    return cloudJson({preparation: await readPublicationPreparation(request, workspaceId, artifactId), available: trustedPublicationAvailable()});
  } catch (error) {return cloudError(error);}
}
export async function POST(request: Request, context: Context) {
  try {
    const {workspaceId, artifactId} = await context.params;
    return cloudJson({preparation: await requestPublicationPreparation(request, workspaceId, artifactId)}, 202);
  } catch (error) {return cloudError(error);}
}
