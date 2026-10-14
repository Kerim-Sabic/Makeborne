import { cloudContext, cloudError, cloudJson, databaseError, validId } from "@/lib/cloud/server";
import { COMMENT_COLUMNS, LINK_COLUMNS, mapReviewComment, mapReviewLink } from "@/lib/client-review/mappers";

type Context = { params: Promise<{ workspaceId: string; clientId: string }> };

/** Every review link and client comment across one client's projects. */
export async function GET(_request: Request, context: Context) {
  try {
    const { workspaceId, clientId } = await context.params;
    validId(clientId);
    const { client } = await cloudContext(workspaceId);
    const { data: projects, error } = await client.from("projects").select("id").eq("workspace_id", workspaceId).eq("client_id", clientId).limit(200);
    databaseError(error);
    const projectIds = (projects ?? []).map(project => project.id as string);
    if (!projectIds.length) return cloudJson({ items: [] });
    const { data: links, error: linkError } = await client.from("client_review_links").select(LINK_COLUMNS).eq("workspace_id", workspaceId).in("project_id", projectIds).order("created_at", { ascending: false }).limit(50);
    databaseError(linkError);
    const linkIds = (links ?? []).map(link => link.id as string);
    const artifactIds = [...new Set((links ?? []).map(link => link.artifact_id as string))];
    const [comments, artifacts] = await Promise.all([
      linkIds.length ? client.from("client_review_comments").select(COMMENT_COLUMNS).eq("workspace_id", workspaceId).in("link_id", linkIds).order("created_at", { ascending: true }).limit(1000) : Promise.resolve({ data: [], error: null }),
      artifactIds.length ? client.from("artifacts").select("id,kind,title,current_version").eq("workspace_id", workspaceId).in("id", artifactIds) : Promise.resolve({ data: [], error: null }),
    ]);
    databaseError(comments.error); databaseError(artifacts.error);
    const byArtifact = new Map((artifacts.data ?? []).map(artifact => [artifact.id as string, artifact]));
    const mapped = (comments.data ?? []).map(mapReviewComment);
    return cloudJson({
      items: (links ?? []).map(row => {
        const link = mapReviewLink(row);
        const artifact = byArtifact.get(link.artifactId);
        return { link, artifact: artifact ? { id: link.artifactId, kind: artifact.kind as string, title: artifact.title as string, currentVersion: Number(artifact.current_version) } : null, comments: mapped.filter(comment => comment.linkId === link.id) };
      }),
    });
  } catch (error) { return cloudError(error); }
}
