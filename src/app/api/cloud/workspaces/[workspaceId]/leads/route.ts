import { z } from "zod";
import { cloudContext, cloudError, cloudJson, databaseError } from "@/lib/cloud/server";
import { RequestError } from "@/lib/server/http";
import { leadFromRow } from "@/lib/leads";

type Context = { params: Promise<{ workspaceId: string }> };
const columns = "id,tags,deal_value,deal_currency,lead_source,lead_profile";

/**
 * Lead details for the clients on screen (`?ids=`), every tag in use (`?tags=1`),
 * or the clients carrying one tag (`?tag=`), with their list summaries.
 */
export async function GET(request: Request, context: Context) {
  try {
    const { workspaceId } = await context.params;
    const { client } = await cloudContext(workspaceId);
    const search = new URL(request.url).searchParams;
    if (search.get("tags") === "1") {
      const { data, error } = await client.from("clients").select("tags").eq("workspace_id", workspaceId).not("tags", "eq", "{}").limit(5000);
      databaseError(error);
      const counts = new Map<string, number>();
      for (const row of data ?? []) for (const tag of row.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      return cloudJson({ tags: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag, count]) => ({ tag, count })) });
    }
    const tag = search.get("tag");
    if (tag) {
      const { data, error } = await client.from("clients").select(`${columns},name,company,email,website,notes,outreach,created_at,updated_at`).eq("workspace_id", workspaceId)
        .contains("tags", [tag.slice(0, 30)]).order("updated_at", { ascending: false }).limit(200);
      databaseError(error);
      return cloudJson({ clients: (data ?? []).map(row => ({ id: row.id, name: row.name, company: row.company, email: row.email, website: row.website, notes: row.notes,
        createdAt: row.created_at, updatedAt: row.updated_at, outreachSummary: row.outreach ? { stage: (row.outreach as { stage: string }).stage, nextFollowUp: (row.outreach as { nextFollowUp: string | null }).nextFollowUp } : undefined,
        lead: leadFromRow(row) })) });
    }
    const ids = z.array(z.string().uuid()).max(300).safeParse((search.get("ids") ?? "").split(",").filter(Boolean));
    if (!ids.success) throw new RequestError("INVALID_REQUEST", "Choose up to 300 clients.");
    if (!ids.data.length) return cloudJson({ leads: {} });
    const { data, error } = await client.from("clients").select(columns).eq("workspace_id", workspaceId).in("id", ids.data);
    databaseError(error);
    return cloudJson({ leads: Object.fromEntries((data ?? []).map(row => [row.id, leadFromRow(row)])) });
  } catch (error) { return cloudError(error); }
}
