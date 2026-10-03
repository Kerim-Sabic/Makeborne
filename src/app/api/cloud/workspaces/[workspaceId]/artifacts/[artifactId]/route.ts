import { cloudContext, cloudError, cloudJson, databaseError, validId } from "@/lib/cloud/server";
import { mapArtifact, mapVersion } from "@/lib/cloud/mappers";
import { RequestError } from "@/lib/server/http";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string; artifactId: string }> }) {
  try {
    const { workspaceId, artifactId } = await context.params;
    validId(artifactId);
    const { client } = await cloudContext(workspaceId);
    const { data, error } = await client.from("artifacts").select("*").eq("id", artifactId).eq("workspace_id", workspaceId).maybeSingle();
    databaseError(error);
    if (!data) throw new RequestError("NOT_FOUND", "This artifact is unavailable.", 404);
    const offset = Number(new URL(request.url).searchParams.get("offset") ?? 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000) throw new RequestError("INVALID_PAGE", "Choose a valid history page.");
    const { data: versions, error: versionsError, count } = await client.from("artifact_versions").select("*", { count: "exact" }).eq("artifact_id", artifactId).eq("workspace_id", workspaceId).order("version_number", { ascending: false }).range(offset, offset + 49);
    databaseError(versionsError);
    return cloudJson({ artifact: mapArtifact(data), versions: (versions ?? []).map(mapVersion), pagination: { offset, total: count, nextOffset: count !== null && offset + 50 < count ? offset + 50 : null } });
  } catch (error) { return cloudError(error); }
}
