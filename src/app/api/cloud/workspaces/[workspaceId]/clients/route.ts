import { CloudClientCreateSchema } from "@/lib/cloud/contracts";
import { cloudBody, cloudContext, cloudError, cloudJson, databaseError, requestKey } from "@/lib/cloud/server";
import { mapClient } from "@/lib/cloud/mappers";

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
