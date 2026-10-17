import { SaveDraftSchema, type PortalChangeResponse } from "@/lib/portal/contracts";
import { SiteRowSchema, mapChange } from "@/lib/portal/mappers";
import { DRAFT_BODY_LIMIT, portalContext, portalDatabaseError, portalFail, portalJson, portalRequestKey, validUuid, validateDraft } from "@/lib/portal/server";
import { RequestError, boundedJson, sameOrigin } from "@/lib/server/http";

type Context = { params: Promise<{ artifactId: string }> };

/**
 * Saves the client's single open draft for this site. Every file is validated
 * with the content model against the site's current manifest, images and
 * routes, and stored normalised. A draft never creates a version; the agency
 * approves it later.
 */
export async function PUT(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const key = portalRequestKey(request);
    const artifactId = validUuid((await context.params).artifactId, "site");
    const { trusted, db } = await portalContext(request);
    const parsed = SaveDraftSchema.safeParse(await boundedJson(request, DRAFT_BODY_LIMIT));
    if (!parsed.success) throw new RequestError("INVALID_CONTENT", "Only the site’s content collections can be saved, up to 30 at a time.", 400);
    const read = await db.rpc("makeborne_portal_read_site", { ...trusted, p_artifact: artifactId });
    portalDatabaseError(read.error);
    const site = SiteRowSchema.parse(read.data);
    const draft = validateDraft({ manifest: site.manifest, collections: site.collections, images: site.images.map(image => image.path), routes: site.routes }, parsed.data.files);
    const { data, error } = await db.rpc("makeborne_portal_save_draft", { ...trusted, p_artifact: artifactId, p_base_version: parsed.data.baseVersion,
      p_files: draft.files, p_summary: parsed.data.summary || draft.lines.join("; "), p_request: key });
    portalDatabaseError(error);
    const body: PortalChangeResponse = { change: mapChange(data) };
    return portalJson(body);
  } catch (error) { return portalFail(error); }
}
