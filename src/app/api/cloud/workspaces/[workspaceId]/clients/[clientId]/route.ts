import { ClientUpdateSchema } from "@/lib/cloud/contracts";
import { cloudBody, cloudContext, cloudError, cloudJson, databaseError, validId } from "@/lib/cloud/server";
import { mapClient } from "@/lib/cloud/mappers";
import { RequestError } from "@/lib/server/http";

export async function PATCH(request: Request, context: { params: Promise<{ workspaceId: string; clientId: string }> }) {
  try {
    const { workspaceId, clientId } = await context.params;
    validId(clientId);
    const { client } = await cloudContext(workspaceId, true);
    const { expectedUpdatedAt, ...fields } = await cloudBody(request, ClientUpdateSchema, 1_000_000);
    if (!Object.keys(fields).length) throw new RequestError("EMPTY_CHANGE", "Choose a field to change.");
    const { data, error } = await client.from("clients").update(fields).eq("id", clientId).eq("workspace_id", workspaceId).eq("updated_at", expectedUpdatedAt).select("*").maybeSingle();
    databaseError(error);
    if (!data) throw new RequestError("REVISION_CONFLICT", "The client changed or is unavailable. Reload before saving.", 409);
    return cloudJson({ client: mapClient(data) });
  } catch (error) { return cloudError(error); }
}
