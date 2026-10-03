import { cloudContext, cloudError, cloudJson, databaseError } from "@/lib/cloud/server";
import { mapArtifact, mapClient, mapProject } from "@/lib/cloud/mappers";
import { RequestError } from "@/lib/server/http";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await context.params;
    const { client, workspace } = await cloudContext(workspaceId);
    const search = new URL(request.url).searchParams;
    const offsets = ["clientsOffset", "projectsOffset", "artifactsOffset"].map((key) => Number(search.get(key) ?? 0));
    if (offsets.some((offset) => !Number.isInteger(offset) || offset < 0 || offset > 100000)) throw new RequestError("INVALID_PAGE", "Choose a valid workspace page.");
    const results = await Promise.all([
      client.from("clients").select("*", { count: "exact" }).eq("workspace_id", workspaceId).order("created_at", { ascending: false }).order("id").range(offsets[0], offsets[0]+199),
      client.from("projects").select("*", { count: "exact" }).eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).order("id").range(offsets[1], offsets[1]+199),
      client.from("artifacts").select("*", { count: "exact" }).eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).order("id").range(offsets[2], offsets[2]+199),
    ]);
    results.forEach((result) => databaseError(result.error));
    const page = (index: number) => ({ offset: offsets[index], total: results[index].count, nextOffset: results[index].count !== null && offsets[index]+200 < results[index].count! ? offsets[index]+200 : null });
    return cloudJson({ workspace, clients: (results[0].data ?? []).map(mapClient), projects: (results[1].data ?? []).map(mapProject), artifacts: (results[2].data ?? []).map(mapArtifact), pagination: { clients: page(0), projects: page(1), artifacts: page(2) } });
  } catch (error) { return cloudError(error); }
}
