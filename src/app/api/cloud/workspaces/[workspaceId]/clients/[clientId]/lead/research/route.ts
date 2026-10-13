import { z } from "zod";
import { cloudBody, cloudContext, cloudError, cloudJson, databaseError, validId } from "@/lib/cloud/server";
import { RequestError } from "@/lib/server/http";
import { leadFromRow } from "@/lib/leads";
import { researchLinks } from "@/lib/mail/research";
import { saveResearch } from "@/lib/mail/lead-research";

export const runtime = "nodejs";
type Context = { params: Promise<{ workspaceId: string; clientId: string }> };

/** Free research: reads the client's linked public pages (profile, website) and stores what they show. No AI, no credits. */
export async function POST(request: Request, context: Context) {
  try {
    const { workspaceId, clientId } = await context.params;
    validId(clientId);
    await cloudBody(request, z.object({}).strict());
    const { client, workspace } = await cloudContext(workspaceId, true);
    if (workspace?.role === "reviewer") throw new RequestError("EDITOR_REQUIRED", "Only owners and editors can research leads.", 403);
    const { data, error } = await client.from("clients").select("id,website,outreach").eq("id", clientId).eq("workspace_id", workspaceId).maybeSingle();
    databaseError(error);
    if (!data) throw new RequestError("NOT_FOUND", "This client is unavailable in this workspace.", 404);
    const links = [(data.outreach as { profileUrl?: string } | null)?.profileUrl ?? "", data.website ?? ""];
    if (!links.some(Boolean)) throw new RequestError("NO_LINKS", "Add their Instagram or other profile link (Outreach) or a website (Contact details) first.");
    const results = await researchLinks(links);
    const saved = await saveResearch(client, workspaceId, clientId, results);
    return cloudJson({ lead: saved ? leadFromRow(saved) : null, read: results.filter(item => item.ok).length,
      skipped: results.filter(item => !item.ok).map(item => ({ url: (item as { url: string }).url, reason: (item as { reason: string }).reason })) });
  } catch (error) { return cloudError(error); }
}
