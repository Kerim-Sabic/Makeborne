import { cloudBody, cloudError, cloudJson, validId } from "@/lib/cloud/server";
import { DecisionSchema, type PortalChangeResponse } from "@/lib/portal/contracts";
import { agencyContext, agencyDatabaseError } from "@/lib/portal/agency";
import { SettingsRowSchema, approvalSummary, mapChange, summaryLines } from "@/lib/portal/mappers";
import { validateDraft } from "@/lib/portal/server";
import { RequestError } from "@/lib/server/http";

type Context = { params: Promise<{ workspaceId: string; artifactId: string; changeId: string }> };

/**
 * Approves or rejects a client's change. Approval re-validates every file
 * against the site's CURRENT manifest, images and routes, then the database
 * re-checks each file's base sha256 against the current version (409
 * CHANGE_CONFLICT unless overwrite) and saves the next version as this user.
 */
export async function POST(request: Request, context: Context) {
  try {
    const { workspaceId, artifactId, changeId } = await context.params;
    validId(artifactId); validId(changeId);
    const { client } = await agencyContext(workspaceId, true);
    const body = await cloudBody(request, DecisionSchema, 4_096);
    let summary = "";
    if (body.decision === "approve") {
      const read = await client.rpc("makeborne_portal_site_settings", { p_workspace: workspaceId, p_artifact: artifactId });
      agencyDatabaseError(read.error);
      const settings = SettingsRowSchema.parse(read.data);
      const change = settings.pending.find(item => item.id === changeId);
      // Not pending (already decided or withdrawn): the database answers idempotently or with a conflict.
      if (change) {
        const collections = Object.entries(change.currentFiles).flatMap(([path, text]) => text === null ? [] : [{ key: path.slice("src/content/".length, -".json".length), path, text }]);
        try { validateDraft({ manifest: settings.manifest, collections, images: settings.images, routes: settings.routes }, change.files); }
        catch (error) {
          if (error instanceof RequestError) throw new RequestError("CHANGE_OUTDATED", `This change no longer fits the website’s content: ${error.message} Reject it and ask the client to edit again.`, 409);
          throw error;
        }
        const author = change.authorName || change.authorEmail.replace(/^(.).*@/, "$1***@");
        summary = approvalSummary(author, summaryLines(settings.manifest, change.files, change.currentFiles));
      }
    }
    const { data, error } = await client.rpc("makeborne_decide_portal_change", { p_workspace: workspaceId, p_artifact: artifactId, p_change: changeId,
      p_decision: body.decision, p_note: body.note, p_overwrite: body.overwrite, p_summary: summary });
    agencyDatabaseError(error);
    const result: PortalChangeResponse = { change: mapChange(data) };
    return cloudJson(result);
  } catch (error) { return cloudError(error); }
}
