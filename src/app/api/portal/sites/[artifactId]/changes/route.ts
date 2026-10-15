import { ChangeActionSchema, type PortalChangeResponse } from "@/lib/portal/contracts";
import { mapChange } from "@/lib/portal/mappers";
import { portalContext, portalDatabaseError, portalFail, portalJson, portalRequestKey, validUuid } from "@/lib/portal/server";
import { RequestError, boundedJson, sameOrigin } from "@/lib/server/http";

type Context = { params: Promise<{ artifactId: string }> };

/** Sends the draft to the agency for review, or withdraws a draft or pending change. */
export async function POST(request: Request, context: Context) {
  try {
    sameOrigin(request);
    portalRequestKey(request);
    const artifactId = validUuid((await context.params).artifactId, "site");
    const { trusted, db } = await portalContext(request);
    const parsed = ChangeActionSchema.safeParse(await boundedJson(request, 4_096));
    if (!parsed.success) throw new RequestError("INVALID", "Choose submit or withdraw.", 400);
    const { data, error } = await db.rpc("makeborne_portal_change_action", { ...trusted, p_artifact: artifactId, p_change: parsed.data.changeId, p_action: parsed.data.action });
    portalDatabaseError(error);
    const body: PortalChangeResponse = { change: mapChange(data) };
    return portalJson(body);
  } catch (error) { return portalFail(error); }
}
