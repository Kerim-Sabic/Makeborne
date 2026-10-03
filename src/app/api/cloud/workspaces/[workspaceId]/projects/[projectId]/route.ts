import { ProjectUpdateSchema } from "@/lib/cloud/contracts";
import { cloudBody, cloudContext, cloudError, cloudJson, databaseError, validId } from "@/lib/cloud/server";
import { mapProject } from "@/lib/cloud/mappers";
import { RequestError } from "@/lib/server/http";

export async function PATCH(request: Request, context: { params: Promise<{ workspaceId: string; projectId: string }> }) {
  try {
    const { workspaceId, projectId } = await context.params;
    validId(projectId);
    const { client } = await cloudContext(workspaceId, true);
    const { expectedUpdatedAt, clientId, styleId, ...body } = await cloudBody(request, ProjectUpdateSchema);
    const fields = { ...body, ...(clientId !== undefined ? { client_id: clientId } : {}), ...(styleId !== undefined ? { style_id: styleId } : {}) };
    if (!Object.keys(fields).length) throw new RequestError("EMPTY_CHANGE", "Choose a field to change.");
    const { data, error } = await client.from("projects").update(fields).eq("id", projectId).eq("workspace_id", workspaceId).eq("updated_at", expectedUpdatedAt).select("*").maybeSingle();
    databaseError(error);
    if (!data) throw new RequestError("REVISION_CONFLICT", "The project changed or is unavailable. Reload before saving.", 409);
    return cloudJson({ project: mapProject(data) });
  } catch (error) { return cloudError(error); }
}
