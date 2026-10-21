import { z } from "zod";
import { cloudContext, cloudError, cloudJson, databaseError } from "@/lib/cloud/server";
import { RequestError } from "@/lib/server/http";
import { CARD_META_MAX, publicationState, type CardMetaItem } from "@/lib/projects/library-card-meta";

/**
 * Read-only library card facts for up to 50 artifacts in one workspace:
 * publication state (the same hosted-site row the Publish panel reads) and
 * the linked client's name. Every read uses the caller's own session, so RLS
 * and workspace membership decide what exists; unknown, deleted or
 * inaccessible ids are simply absent. Private, no-store.
 */
const Ids = z.array(z.string().uuid()).min(1).max(CARD_META_MAX);

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await context.params;
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => key !== "ids") || query.getAll("ids").length !== 1) throw new RequestError("INVALID_IDS", "Choose up to 50 projects.");
    const parsed = Ids.safeParse((query.get("ids") ?? "").split(","));
    if (!parsed.success) throw new RequestError("INVALID_IDS", "Choose up to 50 projects.");
    const ids = [...new Set(parsed.data)];
    const { client } = await cloudContext(workspaceId);
    const { data: artifacts, error } = await client.from("artifacts").select("id,project_id,current_version").eq("workspace_id", workspaceId).in("id", ids);
    databaseError(error);
    const projectIds = [...new Set((artifacts ?? []).map(row => row.project_id as string))];
    const [projects, sites] = await Promise.all([
      projectIds.length ? client.from("projects").select("id,client_id").eq("workspace_id", workspaceId).in("id", projectIds) : Promise.resolve({ data: [], error: null }),
      client.from("hosted_sites").select("artifact_id,live,version_number").eq("workspace_id", workspaceId).in("artifact_id", ids),
    ]);
    databaseError(projects.error); databaseError(sites.error);
    const clientOf = new Map((projects.data ?? []).map(row => [row.id as string, row.client_id as string | null]));
    const clientIds = [...new Set([...clientOf.values()].filter((value): value is string => !!value))];
    const clients = clientIds.length ? await client.from("clients").select("id,name").eq("workspace_id", workspaceId).in("id", clientIds) : { data: [], error: null };
    databaseError(clients.error);
    const clientName = new Map((clients.data ?? []).map(row => [row.id as string, row.name as string]));
    const siteOf = new Map((sites.data ?? []).map(row => [row.artifact_id as string, row as { live: boolean; version_number: number }]));
    const items: CardMetaItem[] = (artifacts ?? []).map(row => {
      const clientId = clientOf.get(row.project_id) ?? null, name = clientId ? clientName.get(clientId) : undefined, site = siteOf.get(row.id);
      const state = publicationState(row.current_version, site);
      return { artifactId: row.id, currentVersion: row.current_version, client: clientId && name ? { id: clientId, name } : null,
        publication: { state, liveVersion: state === "draft" ? null : site!.version_number } };
    });
    return cloudJson({ workspaceId, items });
  } catch (error) { return cloudError(error); }
}
