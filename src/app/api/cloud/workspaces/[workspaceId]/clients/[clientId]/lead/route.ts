import { z } from "zod";
import { cloudBody, cloudContext, cloudError, cloudJson, databaseError, validId } from "@/lib/cloud/server";
import { RequestError } from "@/lib/server/http";
import { CURRENCIES, LEAD_SOURCES, LeadInsightSchema, leadFromRow, normalizeTag } from "@/lib/leads";

type Context = { params: Promise<{ workspaceId: string; clientId: string }> };
const Change = z.object({
  tags: z.array(z.string().max(60)).max(12).optional(),
  dealValue: z.number().min(0).max(100_000_000).nullable().optional(),
  dealCurrency: z.enum(CURRENCIES).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  insight: LeadInsightSchema.omit({ at: true }).optional(),
}).strict();

/** Edit a client's lead details (tags, deal, source) or store what the AI concluded about them. */
export async function PATCH(request: Request, context: Context) {
  try {
    const { workspaceId, clientId } = await context.params;
    validId(clientId);
    const body = await cloudBody(request, Change);
    const { client, workspace } = await cloudContext(workspaceId, true);
    if (workspace?.role === "reviewer") throw new RequestError("EDITOR_REQUIRED", "Only owners and editors can change lead details.", 403);
    const fields: Record<string, unknown> = {};
    if (body.tags) fields.tags = [...new Set(body.tags.map(normalizeTag).filter(Boolean))].slice(0, 12);
    if (body.dealValue !== undefined) fields.deal_value = body.dealValue === null ? null : Math.round(body.dealValue * 100) / 100;
    if (body.dealCurrency) fields.deal_currency = body.dealCurrency;
    if (body.source !== undefined) fields.lead_source = body.source;
    if (body.insight) {
      const { data: current, error } = await client.from("clients").select("lead_profile").eq("id", clientId).eq("workspace_id", workspaceId).maybeSingle();
      databaseError(error);
      if (!current) throw new RequestError("NOT_FOUND", "This client is unavailable in this workspace.", 404);
      fields.lead_profile = { ...(current.lead_profile as object), insight: { ...body.insight, at: new Date().toISOString() } };
    }
    if (!Object.keys(fields).length) throw new RequestError("EMPTY_CHANGE", "Choose something to change.");
    const { data, error } = await client.from("clients").update(fields).eq("id", clientId).eq("workspace_id", workspaceId).select("id,tags,deal_value,deal_currency,lead_source,lead_profile,updated_at").maybeSingle();
    databaseError(error);
    if (!data) throw new RequestError("NOT_FOUND", "This client is unavailable in this workspace.", 404);
    return cloudJson({ lead: leadFromRow(data), updatedAt: data.updated_at });
  } catch (error) { return cloudError(error); }
}
