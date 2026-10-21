import { cloudContext, cloudError, cloudJson, databaseError } from "@/lib/cloud/server";
import { mapArtifact, mapClientSummary, mapProject } from "@/lib/cloud/mappers";
import { RequestError } from "@/lib/server/http";
import { CLIENT_LIST_SELECTION } from "@/lib/cloud/client-selection";
import { parseLibraryScope } from "@/lib/projects/library-card-meta";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await context.params;
    const { client, workspace } = await cloudContext(workspaceId);
    const search = new URL(request.url).searchParams;
    const offsets = ["clientsOffset", "projectsOffset", "artifactsOffset"].map((key) => Number(search.get(key) ?? 0));
    if (offsets.some((offset) => !Number.isInteger(offset) || offset < 0 || offset > 100000)) throw new RequestError("INVALID_PAGE", "Choose a valid workspace page.");
    // Library scope (audit M06): sort and client filter apply to the whole workspace, not only loaded cards.
    let scope: ReturnType<typeof parseLibraryScope>;
    try { scope = parseLibraryScope(search); } catch { throw new RequestError("INVALID_PAGE", "Choose a valid sort and client."); }
    const order = scope.sort === "title" ? { column: "title", ascending: true } : { column: scope.sort === "created" ? "created_at" : "updated_at", ascending: false };
    let artifacts = client.from("artifacts").select((scope.client === "all" ? "*" : "*, projects!inner(client_id)") as "*", { count: "exact" }).eq("workspace_id", workspaceId);
    if (scope.client === "none") artifacts = artifacts.is("projects.client_id", null);
    else if (scope.client !== "all") artifacts = artifacts.eq("projects.client_id", scope.client);
    const results = await Promise.all([
      client.from("clients").select(CLIENT_LIST_SELECTION, { count: "exact" }).eq("workspace_id", workspaceId).order("created_at", { ascending: false }).order("id").range(offsets[0], offsets[0]+199),
      client.from("projects").select("*", { count: "exact" }).eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).order("id").range(offsets[1], offsets[1]+199),
      artifacts.order(order.column, { ascending: order.ascending }).order("id").range(offsets[2], offsets[2]+199),
    ]);
    results.forEach((result) => databaseError(result.error));
    const page = (index: number) => ({ offset: offsets[index], total: results[index].count, nextOffset: results[index].count !== null && offsets[index]+200 < results[index].count! ? offsets[index]+200 : null });
    return cloudJson({ workspace, clients: (results[0].data ?? []).map(mapClientSummary), projects: (results[1].data ?? []).map(mapProject), artifacts: (results[2].data ?? []).map(mapArtifact), pagination: { clients: page(0), projects: page(1), artifacts: page(2) } });
  } catch (error) { return cloudError(error); }
}
