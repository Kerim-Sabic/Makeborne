import { cloudError, cloudJson, validId } from "@/lib/cloud/server";
import { operationApiError, OperationError } from "@/lib/builder/operation-server";
import { readImageEdit } from "@/lib/images/edit/run";
import { editContext } from "../shared";

export const runtime = "nodejs";

/** Recorded state of an edit (refresh/reconnect); never starts or repeats a step. */
export async function GET(_request: Request, context: { params: Promise<{ workspaceId: string; artifactId: string; operationId: string }> }) {
  try {
    const params = await context.params;
    const id = validId(params.operationId);
    const edit = await editContext(Promise.resolve(params), false);
    return cloudJson({ edit: await readImageEdit({ actor: edit.user.id, workspaceId: edit.workspaceId, artifactId: edit.artifactId, id }) });
  } catch (error) { return error instanceof OperationError ? operationApiError(error) : cloudError(error); }
}
