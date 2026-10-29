import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { downloadProjectAsset } from "../cloud/asset-storage";
import { COMP_PREVIEW_EDGE, imagePreview } from "./image-variants";
import { compsFromSource } from "./concept";

/**
 * The design comps a first build was made from, as labelled image blocks for the review round (the fidelity check:
 * built section beside its comp). The comps are registered project assets that are never part of the website
 * source; their ids are read from the concept comment of src/App.tsx and each is read through the caller's own
 * RLS-bound client (downloadProjectAsset), so a member only ever sees comps of a project they can open.
 * Best effort: a comp that cannot be read is left out.
 */
export async function designCompBlocks(client: SupabaseClient, scope: { workspaceId: string; projectId: string }, app: string | undefined,
  read: typeof downloadProjectAsset = downloadProjectAsset): Promise<BetaContentBlockParam[]> {
  const comps = compsFromSource(app);
  const blocks: BetaContentBlockParam[] = [];
  for (const comp of comps) {
    try {
      const row = await client.from("assets").select("object_path,provenance").eq("workspace_id", scope.workspaceId).eq("project_id", scope.projectId).eq("id", comp.asset).maybeSingle();
      const objectPath = (row.data as { object_path?: unknown } | null)?.object_path;
      const kind = ((row.data as { provenance?: { kind?: unknown } } | null)?.provenance)?.kind;
      if (row.error || typeof objectPath !== "string" || kind !== "design-comp") continue;
      const download = await read(client, scope, objectPath);
      if (!download.data) continue;
      const preview = await imagePreview(Buffer.from(await download.data.arrayBuffer()), { maxEdge: COMP_PREVIEW_EDGE });
      blocks.push({ type: "text", text: `Design comp for the "${comp.section}" section (${comp.viewport}): the target this section was built to match. A reference only: it is not on the page.` },
        { type: "image", source: { type: "base64", media_type: preview.mediaType, data: preview.data } });
    } catch { /* left out */ }
  }
  return blocks;
}
