import { cloudError, cloudJson, validId } from "@/lib/cloud/server";
import { editableUses } from "@/lib/images/edit/accept";
import { editContext } from "../shared";

export const runtime = "nodejs";

/** Where an image is used in the current version, so the customer chooses what an accepted edit replaces. */
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string; artifactId: string }> }) {
  try {
    const edit = await editContext(context.params, false);
    const assetId = validId(new URL(request.url).searchParams.get("assetId") ?? "");
    return cloudJson(await editableUses(edit.client, { workspaceId: edit.workspaceId, actor: edit.user.id }, edit.artifactId, assetId.toLowerCase()));
  } catch (error) { return cloudError(error); }
}
