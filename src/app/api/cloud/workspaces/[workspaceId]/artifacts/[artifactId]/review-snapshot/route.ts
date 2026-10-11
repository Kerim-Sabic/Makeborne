import { cloudBody, cloudContext, cloudError, cloudJson, databaseError, validId } from "@/lib/cloud/server";
import { billingDatabase } from "@/lib/billing/database";
import { RequestError } from "@/lib/server/http";
import { ReviewSnapshotSchema } from "@/lib/client-review/contracts";
import { reviewWebsiteHtml } from "@/lib/client-review/server";

export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ workspaceId: string; artifactId: string }> };

/** Refreshes the website review copy so "latest" links show the newest save. */
export async function POST(request: Request, context: Context) {
  try {
    const body = await cloudBody(request, ReviewSnapshotSchema, 4_200_000);
    const { workspaceId, artifactId } = await context.params;
    validId(artifactId);
    const { client, user } = await cloudContext(workspaceId, true);
    const { data: version, error } = await client.from("artifact_versions").select("content").eq("workspace_id", workspaceId).eq("artifact_id", artifactId).eq("version_number", body.version).maybeSingle();
    databaseError(error);
    if (!version) throw new RequestError("NOT_FOUND", "Save this website before updating the review copy.", 404);
    let html: string | null;
    try { html = reviewWebsiteHtml(version.content, body.snapshot, new URL(request.url).origin); }
    catch (cause) { throw cause instanceof RequestError ? cause : new RequestError("SITE_NOT_READY", cause instanceof Error ? cause.message : "This website can’t be shared yet."); }
    if (!html) throw new RequestError("NOT_NEEDED", "This project updates its review automatically.");
    const { data, error: saveError } = await billingDatabase().rpc("makeborne_save_client_review_snapshot", { p_actor: user.id, p_workspace: workspaceId, p_artifact: artifactId, p_version: body.version, p_html: html });
    databaseError(saveError);
    return cloudJson({ snapshot: data });
  } catch (error) { return cloudError(error); }
}
