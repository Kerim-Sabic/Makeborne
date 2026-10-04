import { cloudContext, cloudError, cloudJson, databaseError, validId } from "@/lib/cloud/server";
import { ClientProjectItemSchema } from "@/lib/cloud/contracts";
import { RequestError } from "@/lib/server/http";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string; clientId: string }> }) {
  try {
    const { workspaceId, clientId } = await context.params;
    validId(clientId);
    const { client } = await cloudContext(workspaceId);
    const offset = Number(new URL(request.url).searchParams.get("offset") ?? 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000) throw new RequestError("INVALID_PAGE", "Choose a valid client project page.");
    const { data, error } = await client.rpc("makeborne_client_projects", { p_workspace_id: workspaceId, p_client_id: clientId, p_offset: offset });
    databaseError(error);
    return cloudJson({ ...data, items: data.items.map((item: Record<string, unknown>) => ClientProjectItemSchema.parse({ ...item, updatedAt: new Date(String(item.updatedAt)).toISOString() })) });
  } catch (error) { return cloudError(error); }
}
