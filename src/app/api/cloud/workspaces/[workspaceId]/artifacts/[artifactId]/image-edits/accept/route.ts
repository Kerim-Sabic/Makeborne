import { z } from "zod";
import { cloudBody, cloudError, cloudJson } from "@/lib/cloud/server";
import { acceptImageEdit } from "@/lib/images/edit/accept";
import { editContext, sameArtifact } from "../shared";

export const runtime = "nodejs";

/** Use the edited image in the chosen places: one version-checked save. Discard needs no call. */
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; artifactId: string }> }) {
  try {
    const edit = await editContext(context.params, true);
    const body = await cloudBody(request, z.unknown(), 64_000);
    sameArtifact(body, edit.artifactId);
    return cloudJson(await acceptImageEdit(edit.client, { workspaceId: edit.workspaceId, actor: edit.user.id }, body), 201);
  } catch (error) { return cloudError(error); }
}
