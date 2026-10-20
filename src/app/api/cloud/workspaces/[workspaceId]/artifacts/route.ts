import { z } from "zod";
import { cloudContext, cloudError, cloudJson } from "@/lib/cloud/server";
import { mapArtifact } from "@/lib/cloud/mappers";
import { RequestError } from "@/lib/server/http";
import { encodeTitleCursor, parseTitleSearch } from "@/lib/projects/title-search";

const SearchResult = z.object({
  artifacts: z.array(z.record(z.string(), z.unknown())).max(50),
  total: z.number().int().nonnegative(),
  nextCursor: z.object({ createdAt: z.string(), id: z.string().uuid() }).nullable(),
}).strict();

/**
 * Title search across every saved project in one workspace the signed-in
 * account can read. Titles only: briefs, notes, content and other workspaces
 * are never searched. The database checks membership again (SECURITY INVOKER
 * plus row security), so this route cannot widen access.
 */
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await context.params;
    const { client } = await cloudContext(workspaceId);
    const search = parseTitleSearch(new URL(request.url).searchParams);
    if (!search) throw new RequestError("INVALID_SEARCH", "Search project titles with 1 to 200 characters and a valid project type.");
    const { data, error } = await client.rpc("makeborne_artifact_title_search", {
      p_workspace_id: workspaceId, p_query: search.query, p_kind: search.kind,
      p_after_created_at: search.after?.createdAt ?? null, p_after_id: search.after?.id ?? null,
    });
    if (error?.code === "42501") throw new RequestError("NOT_FOUND", "This workspace is unavailable.", 404);
    if (error) throw new RequestError("SEARCH_UNAVAILABLE", "Searching all saved projects is unavailable right now.", 503);
    const result = SearchResult.parse(data);
    return cloudJson({
      artifacts: result.artifacts.map(mapArtifact),
      pagination: { total: result.total, nextCursor: result.nextCursor ? encodeTitleCursor(result.nextCursor) : null },
    });
  } catch (error) { return cloudError(error); }
}
