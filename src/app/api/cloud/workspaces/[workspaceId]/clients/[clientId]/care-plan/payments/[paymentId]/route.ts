import { cloudError, cloudJson, validId } from "@/lib/cloud/server";
import { CarePlanResponseSchema } from "@/lib/portal/care";
import { agencyContext, agencyDatabaseError } from "@/lib/portal/agency";
import { RequestError, sameOrigin } from "@/lib/server/http";
import { missingPortal } from "@/lib/portal/server";

type Context = { params: Promise<{ workspaceId: string; clientId: string; paymentId: string }> };

/** Undoes the latest recorded payment (a mistake), restoring the paid-through date it replaced. */
export async function DELETE(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const { workspaceId, clientId, paymentId } = await context.params;
    validId(clientId); validId(paymentId);
    const { client } = await agencyContext(workspaceId, true);
    const { data, error } = await client.rpc("makeborne_undo_care_payment", { p_workspace: workspaceId, p_client: clientId, p_payment: paymentId });
    if (missingPortal(error)) throw new RequestError("PORTAL_SETUP", "Care plans are being set up. Please try again later.", 503);
    agencyDatabaseError(error);
    return cloudJson({ available: true, ...CarePlanResponseSchema.parse(data) });
  } catch (error) { return cloudError(error); }
}
