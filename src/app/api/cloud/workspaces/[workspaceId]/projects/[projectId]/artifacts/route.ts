import { ArtifactCreateSchema } from "@/lib/cloud/contracts";
import { cloudBody, cloudContext, cloudError, cloudJson, databaseError, validId, requestKey } from "@/lib/cloud/server";
import { mapArtifact } from "@/lib/cloud/mappers";
import { RequestError } from "@/lib/server/http";

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; projectId: string }> }) {
  try {
    const { workspaceId, projectId } = await context.params;
    validId(projectId);
    const { client } = await cloudContext(workspaceId, true);
    const body = await cloudBody(request, ArtifactCreateSchema);
    const { data: project, error: projectError } = await client.from("projects").select("kind").eq("id", projectId).eq("workspace_id", workspaceId).maybeSingle();
    databaseError(projectError);
    if (!project) throw new RequestError("NOT_FOUND", "This project is unavailable.", 404);
    if (project.kind !== body.kind) throw new RequestError("FORMAT_MISMATCH", "The artifact format must match its project.");
    const key = requestKey(request);
    const { data, error } = await client.rpc("makeborne_create_record", { p_workspace_id: workspaceId, p_request_key: key, p_operation: "create_artifact", p_payload: { ...body, project_id: projectId } });
    databaseError(error);
    return cloudJson({ artifact: mapArtifact(data.record), mutation: { idempotencyKey: key, replayed: data.replayed } }, 201);
  } catch (error) { return cloudError(error); }
}
