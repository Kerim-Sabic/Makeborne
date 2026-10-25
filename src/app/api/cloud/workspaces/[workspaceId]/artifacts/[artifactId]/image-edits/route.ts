import { z } from "zod";
import { cloudBody, cloudError, cloudJson } from "@/lib/cloud/server";
import { operationApiError, OperationError } from "@/lib/builder/operation-server";
import { AgencyError } from "@/lib/agency/task";
import { imageEditingEnabled } from "@/lib/images/edit/contract";
import { runImageEdit } from "@/lib/images/edit/run";
import { editContext, sameArtifact } from "./shared";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Whether "Edit image" is offered (server-side flag only). */
export async function GET() {
  return cloudJson({ available: imageEditingEnabled() });
}

/** Generate ONE edited candidate for an explicit user action. Resubmitting the same keys replays it without a new call. */
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; artifactId: string }> }) {
  try {
    const edit = await editContext(context.params, true);
    const body = await cloudBody(request, z.unknown(), 6_000_000);
    sameArtifact(body, edit.artifactId);
    return cloudJson({ edit: await runImageEdit(edit.user.id, body, edit.deps()) });
  } catch (error) {
    return error instanceof OperationError || error instanceof AgencyError ? operationApiError(error) : cloudError(error);
  }
}
