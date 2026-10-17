import { cloudBody, cloudError, cloudJson, validId } from "@/lib/cloud/server";
import { SiteSettingsSchema } from "@/lib/portal/contracts";
import { agencyContext, agencyDatabaseError } from "@/lib/portal/agency";
import { UNAVAILABLE_SETTINGS, mapSettings } from "@/lib/portal/mappers";
import { missingPortal } from "@/lib/portal/server";

type Context = { params: Promise<{ workspaceId: string; artifactId: string }> };

/** Client-editing settings and pending client changes for one website (SitePortalSettings). */
export async function GET(_request: Request, context: Context) {
  try {
    const { workspaceId, artifactId } = await context.params;
    validId(artifactId);
    const { client } = await agencyContext(workspaceId, false);
    const { data, error } = await client.rpc("makeborne_portal_site_settings", { p_workspace: workspaceId, p_artifact: artifactId });
    if (missingPortal(error)) return cloudJson(UNAVAILABLE_SETTINGS);
    agencyDatabaseError(error);
    return cloudJson(mapSettings(data));
  } catch (error) { return cloudError(error); }
}

/** Turns client editing on or off and limits which collections the client may edit (null: all declared). */
export async function PUT(request: Request, context: Context) {
  try {
    const { workspaceId, artifactId } = await context.params;
    validId(artifactId);
    const { client } = await agencyContext(workspaceId, true);
    const body = await cloudBody(request, SiteSettingsSchema, 4_096);
    const { data, error } = await client.rpc("makeborne_set_portal_site", { p_workspace: workspaceId, p_artifact: artifactId, p_enabled: body.enabled, p_collections: body.collections });
    agencyDatabaseError(error);
    return cloudJson(mapSettings(data));
  } catch (error) { return cloudError(error); }
}
