import { z } from "zod";
import { cloudContext, cloudError, cloudJson, databaseError } from "@/lib/cloud/server";
import { RequestError } from "@/lib/server/http";
import { CARD_META_MAX, RENAME_VERIFY_MAX, publicationState, sameExceptTitle, type CardMetaItem } from "@/lib/projects/library-card-meta";
import { isRenameSummary } from "@/lib/projects/library-rename";

/**
 * Read-only library card facts for up to 50 artifacts in one workspace:
 * publication state (the same hosted-site row the Publish panel reads) and
 * the linked client's name. Every read uses the caller's own session, so RLS
 * and workspace membership decide what exists; unknown, deleted or
 * inaccessible ids are simply absent. Private, no-store.
 *
 * A live site whose later versions only renamed the project stays Live: the
 * versions say they are renames, and the live and current saved content are
 * compared (everything except `content.title`) before that is believed.
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
    const renamedOnly = await renameOnlyArtifacts(client, workspaceId, (artifacts ?? []).flatMap(row => {
      const site = siteOf.get(row.id);
      return site?.live && row.current_version > site.version_number ? [{ id: row.id as string, live: site.version_number, current: row.current_version as number }] : [];
    }));
    const items: CardMetaItem[] = (artifacts ?? []).map(row => {
      const clientId = clientOf.get(row.project_id) ?? null, name = clientId ? clientName.get(clientId) : undefined, site = siteOf.get(row.id);
      const state = publicationState(row.current_version, site, renamedOnly.has(row.id));
      return { artifactId: row.id, currentVersion: row.current_version, client: clientId && name ? { id: clientId, name } : null,
        publication: { state, liveVersion: state === "draft" ? null : site!.version_number } };
    });
    return cloudJson({ workspaceId, items });
  } catch (error) { return cloudError(error); }
}

type Behind = { id: string; live: number; current: number };
/** Live projects (at most RENAME_VERIFY_MAX) whose every version after the live one is a rename and whose content matches the live version apart from its title. */
async function renameOnlyArtifacts(client: Awaited<ReturnType<typeof cloudContext>>["client"], workspaceId: string, behind: Behind[]): Promise<Set<string>> {
  const found = new Set<string>();
  if (!behind.length) return found;
  const { data: later, error } = await client.from("artifact_versions").select("artifact_id,version_number,change_summary").eq("workspace_id", workspaceId)
    .in("artifact_id", behind.map(item => item.id)).gt("version_number", Math.min(...behind.map(item => item.live))).limit(1000);
  databaseError(error);
  // A hint only, and only when every version after the live one was read and says it is a rename.
  const hinted = behind.filter(item => {
    const rows = (later ?? []).filter(row => row.artifact_id === item.id && row.version_number > item.live && row.version_number <= item.current);
    return rows.length === item.current - item.live && rows.every(row => isRenameSummary(row.change_summary as string));
  }).slice(0, RENAME_VERIFY_MAX);
  await Promise.all(hinted.map(async item => {
    const { data, error: readError } = await client.from("artifact_versions").select("version_number,content,style_snapshot,asset_manifest").eq("workspace_id", workspaceId)
      .eq("artifact_id", item.id).in("version_number", [item.live, item.current]);
    databaseError(readError);
    const live = data?.find(row => row.version_number === item.live), current = data?.find(row => row.version_number === item.current);
    if (live && current && sameExceptTitle(live, current)) found.add(item.id);
  }));
  return found;
}
