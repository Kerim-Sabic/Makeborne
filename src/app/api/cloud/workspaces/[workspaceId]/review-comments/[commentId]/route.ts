import { z } from "zod";
import { cloudBody, cloudContext, cloudError, cloudJson, databaseError, validId } from "@/lib/cloud/server";
import { mapReviewComment } from "@/lib/client-review/mappers";

type Context = { params: Promise<{ workspaceId: string; commentId: string }> };
const input = z.object({ resolved: z.boolean() }).strict();

/** Marks a client comment as resolved (or reopens it). */
export async function PATCH(request: Request, context: Context) {
  try {
    const body = await cloudBody(request, input, 1_000);
    const { workspaceId, commentId } = await context.params;
    validId(commentId);
    const { client } = await cloudContext(workspaceId);
    const { data, error } = await client.rpc("makeborne_resolve_client_review_comment", { p_workspace: workspaceId, p_comment: commentId, p_resolved: body.resolved });
    databaseError(error);
    return cloudJson({ comment: mapReviewComment(data) });
  } catch (error) { return cloudError(error); }
}
