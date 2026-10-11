import { cloudContext, cloudError, cloudJson, databaseError, validId } from "@/lib/cloud/server";
import { sameOrigin } from "@/lib/server/http";
import { mapReviewLink } from "@/lib/client-review/mappers";

type Context = { params: Promise<{ workspaceId: string; artifactId: string; linkId: string }> };

/** Revokes a review link immediately. Revoking never needs an active plan. */
export async function DELETE(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const { workspaceId, artifactId, linkId } = await context.params;
    validId(artifactId); validId(linkId);
    const { client } = await cloudContext(workspaceId);
    const { data, error } = await client.rpc("makeborne_revoke_client_review_link", { p_workspace: workspaceId, p_link: linkId });
    databaseError(error);
    return cloudJson({ link: mapReviewLink(data) });
  } catch (error) { return cloudError(error); }
}
