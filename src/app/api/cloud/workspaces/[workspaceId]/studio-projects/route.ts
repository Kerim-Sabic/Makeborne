import { StudioProjectCreateSchema } from "@/lib/cloud/contracts";
import { cloudBody, cloudContext, cloudError, cloudJson, databaseError, requestKey } from "@/lib/cloud/server";
import { mapProject, mapArtifact, mapVersion } from "@/lib/cloud/mappers";

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await context.params;
    const { client } = await cloudContext(workspaceId, true);
    const { project: { clientId, styleId, ...project }, content, style } = await cloudBody(request, StudioProjectCreateSchema, 2_500_000);
    const key = requestKey(request);
    const { data, error } = await client.rpc("makeborne_create_studio_project", {
      p_workspace_id: workspaceId, p_request_key: key,
      p_project: { ...project, client_id: clientId, style_id: styleId }, p_content: content, p_style: style,
    });
    databaseError(error);
    return cloudJson({ project: mapProject(data.project), artifact: mapArtifact(data.artifact), version: mapVersion(data.version), mutation: { idempotencyKey: key, replayed: data.replayed } }, 201);
  } catch (error) { return cloudError(error); }
}
