import { SiteRowSchema, mapSite } from "@/lib/portal/mappers";
import { portalContext, portalDatabaseError, portalFail, portalJson, validUuid } from "@/lib/portal/server";

type Context = { params: Promise<{ artifactId: string }> };

/** One site's editable collections, images and open change (PortalSite). No source code reaches the client. */
export async function GET(request: Request, context: Context) {
  try {
    const artifactId = validUuid((await context.params).artifactId, "site");
    const { trusted, db } = await portalContext(request);
    const { data, error } = await db.rpc("makeborne_portal_read_site", { ...trusted, p_artifact: artifactId });
    portalDatabaseError(error);
    return portalJson(mapSite(SiteRowSchema.parse(data)));
  } catch (error) { return portalFail(error); }
}
