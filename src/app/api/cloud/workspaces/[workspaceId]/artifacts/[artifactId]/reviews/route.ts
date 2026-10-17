import { cloudBody, cloudContext, cloudError, cloudJson, databaseError, validId } from "@/lib/cloud/server";
import { ProjectDeliveryStageSchema } from "@/lib/project-delivery";
import { billingDatabase } from "@/lib/billing/database";
import { RequestError } from "@/lib/server/http";
import { ReviewCreateSchema } from "@/lib/client-review/contracts";
import { COMMENT_COLUMNS, LINK_COLUMNS, mapReviewComment, mapReviewLink } from "@/lib/client-review/mappers";
import { newReviewToken, reviewUrl, reviewWebsiteHtml } from "@/lib/client-review/server";
import { loadReviewViews } from "@/lib/client-review/views";

export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ workspaceId: string; artifactId: string }> };

/** Review links, client comments and the linked client for one artifact. */
export async function GET(_request: Request, context: Context) {
  try {
    const { workspaceId, artifactId } = await context.params;
    validId(artifactId);
    const { client } = await cloudContext(workspaceId);
    const { data: artifact, error: artifactError } = await client.from("artifacts").select("id,project_id,kind,title,current_version").eq("workspace_id", workspaceId).eq("id", artifactId).maybeSingle();
    databaseError(artifactError);
    if (!artifact) throw new RequestError("NOT_FOUND", "This project is unavailable in this workspace.", 404);
    const [links, snapshots, project] = await Promise.all([
      client.from("client_review_links").select(LINK_COLUMNS).eq("workspace_id", workspaceId).eq("artifact_id", artifactId).order("created_at", { ascending: false }).limit(50),
      client.from("client_review_snapshots").select("version_number").eq("workspace_id", workspaceId).eq("artifact_id", artifactId).order("version_number", { ascending: false }).limit(20),
      client.from("projects").select("client_id,delivery_stage").eq("workspace_id", workspaceId).eq("id", artifact.project_id).maybeSingle(),
    ]);
    databaseError(links.error); databaseError(snapshots.error); databaseError(project.error);
    const ids = (links.data ?? []).map(link => link.id as string);
    const [comments, views] = await Promise.all([
      ids.length ? client.from("client_review_comments").select(COMMENT_COLUMNS).eq("workspace_id", workspaceId).in("link_id", ids).order("created_at", { ascending: true }).limit(1000) : Promise.resolve({ data: [], error: null }),
      // Who opened each link and for how long; { available: false } until its migration lands.
      loadReviewViews(client, workspaceId, ids),
    ]);
    databaseError(comments.error);
    let linkedClient = null;
    if (project.data?.client_id) {
      const { data, error } = await client.from("clients").select("id,name,email,outreach").eq("workspace_id", workspaceId).eq("id", project.data.client_id).maybeSingle();
      databaseError(error);
      if (data) linkedClient = { id: data.id as string, name: data.name as string, email: data.email as string, stage: (data.outreach as { stage?: string } | null)?.stage ?? "Lead" };
    }
    return cloudJson({
      currentVersion: artifact.current_version, kind: artifact.kind, title: artifact.title,
      links: (links.data ?? []).map(mapReviewLink), comments: (comments.data ?? []).map(mapReviewComment),
      snapshots: (snapshots.data ?? []).map(row => Number(row.version_number)), client: linkedClient,
      deliveryStage: ProjectDeliveryStageSchema.catch("active").parse(project.data?.delivery_stage),
      views,
    });
  } catch (error) { return cloudError(error); }
}

/** Creates a link. The token is returned once and never stored. */
export async function POST(request: Request, context: Context) {
  try {
    const body = await cloudBody(request, ReviewCreateSchema, 4_200_000);
    const { workspaceId, artifactId } = await context.params;
    validId(artifactId);
    const { client, user, workspace } = await cloudContext(workspaceId, true);
    if (workspace?.role === "reviewer") throw new RequestError("ACCESS_DENIED", "Reviewers cannot share projects.", 403);
    const { data: artifact, error: artifactError } = await client.from("artifacts").select("kind,current_version").eq("workspace_id", workspaceId).eq("id", artifactId).maybeSingle();
    databaseError(artifactError);
    if (!artifact) throw new RequestError("NOT_FOUND", "This project is unavailable in this workspace.", 404);
    if (body.version !== artifact.current_version) throw new RequestError("REVISION_CONFLICT", "This project changed. Reload and share the latest saved version.", 409);
    let html: string | null = null;
    if (artifact.kind === "website") {
      const { data: version, error } = await client.from("artifact_versions").select("content").eq("workspace_id", workspaceId).eq("artifact_id", artifactId).eq("version_number", body.version).single();
      databaseError(error);
      if (!version) throw new RequestError("NOT_FOUND", "Save this website before sharing it.", 404);
      try { html = reviewWebsiteHtml(version.content, body.snapshot, new URL(request.url).origin); }
      catch (cause) { throw cause instanceof RequestError ? cause : new RequestError("SITE_NOT_READY", cause instanceof Error ? cause.message : "This website can’t be shared yet."); }
      if (html && Buffer.byteLength(html) > 4_000_000) throw new RequestError("SITE_TOO_LARGE", "This website exceeds the 4 MB review limit. Use fewer or smaller images.", 413);
    }
    const { token, hash } = newReviewToken();
    const { data, error } = await billingDatabase().rpc("makeborne_create_client_review_link", {
      p_actor: user.id, p_workspace: workspaceId, p_artifact: artifactId, p_version: body.version, p_latest: body.scope === "latest",
      p_token_hash: hash, p_days: body.days, p_recipient: body.recipientName, p_message: body.message, p_html: html,
    });
    if (error?.code === "MB429") throw new RequestError("LINK_LIMIT", "You have many open review links. Revoke older links first.", 429);
    databaseError(error);
    return cloudJson({ link: mapReviewLink(data), url: reviewUrl(request, token) }, 201);
  } catch (error) { return cloudError(error); }
}
