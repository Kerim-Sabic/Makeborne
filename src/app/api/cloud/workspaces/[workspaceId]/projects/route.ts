import { CloudProjectCreateSchema } from "@/lib/cloud/contracts";
import { cloudBody, cloudContext, cloudError, cloudJson, databaseError, requestKey } from "@/lib/cloud/server";
import { mapProject } from "@/lib/cloud/mappers";

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await context.params;
    const { client } = await cloudContext(workspaceId, true);
    const { clientId, styleId, ...body } = await cloudBody(request, CloudProjectCreateSchema);
    const key = requestKey(request);
    const { data, error } = await client.rpc("makeborne_create_record", { p_workspace_id: workspaceId, p_request_key: key, p_operation: "create_project", p_payload: { ...body, client_id: clientId, style_id: styleId } });
    databaseError(error);
    return cloudJson({ project: mapProject(data.record), mutation: { idempotencyKey: key, replayed: data.replayed } }, 201);
  } catch (error) { return cloudError(error); }
}
