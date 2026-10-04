import { CloudClientCreateSchema } from "@/lib/cloud/contracts";
import { cloudBody, cloudContext, cloudError, cloudJson, databaseError, requestKey } from "@/lib/cloud/server";
import { mapClient, mapClientSummary } from "@/lib/cloud/mappers";
import { z } from "zod";
import { outreachStages } from "@/lib/client-outreach";
import { RequestError } from "@/lib/server/http";

const directoryQuery = z.object({
  search: z.string().max(200).default(""), stage: z.enum(["All stages", ...outreachStages]).default("All stages"),
  followUp: z.enum(["all", "overdue", "today", "upcoming", "unscheduled"]).default("all"),
  day: z.iso.date(), offset: z.coerce.number().int().min(0).max(100000).default(0),
});
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await context.params;
    const { client } = await cloudContext(workspaceId);
    const parsed = directoryQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new RequestError("INVALID_FILTERS", "Choose valid client filters and a calendar date.");
    const query = parsed.data;
    const { data, error } = await client.rpc("makeborne_client_directory", { p_workspace_id: workspaceId, p_search: query.search, p_stage: query.stage, p_follow_up: query.followUp, p_day: query.day, p_offset: query.offset });
    databaseError(error);
    return cloudJson({ ...data, clients: data.clients.map(mapClientSummary) });
  } catch (error) { return cloudError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await context.params;
    const { client } = await cloudContext(workspaceId, true);
    const body = await cloudBody(request, CloudClientCreateSchema);
    const key = requestKey(request);
    const { data, error } = await client.rpc("makeborne_create_record", { p_workspace_id: workspaceId, p_request_key: key, p_operation: "create_client", p_payload: body });
    databaseError(error);
    return cloudJson({ client: mapClient(data.record), mutation: { idempotencyKey: key, replayed: data.replayed } }, 201);
  } catch (error) { return cloudError(error); }
}
