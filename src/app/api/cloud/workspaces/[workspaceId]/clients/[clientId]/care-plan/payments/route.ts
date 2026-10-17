import { z } from "zod";
import { cloudBody, cloudError, cloudJson, validId } from "@/lib/cloud/server";
import { CarePaymentCreateSchema, CarePlanResponseSchema } from "@/lib/portal/care";
import { agencyContext, agencyDatabaseError } from "@/lib/portal/agency";
import { missingPortal } from "@/lib/portal/server";
import { RequestError } from "@/lib/server/http";

type Context = { params: Promise<{ workspaceId: string; clientId: string }> };

/**
 * Records a payment the agency received (Makeborne never handles the money): paid-through moves
 * one billing period on. The Idempotency-Key header makes a double click record it once.
 */
export async function POST(request: Request, context: Context) {
  try {
    const { workspaceId, clientId } = await context.params;
    validId(clientId);
    const key = z.string().uuid().safeParse(request.headers.get("Idempotency-Key"));
    if (!key.success) throw new RequestError("REQUEST_KEY_REQUIRED", "Provide a stable UUID Idempotency-Key for this payment.");
    const body = await cloudBody(request, CarePaymentCreateSchema, 2_048);
    const { client } = await agencyContext(workspaceId, true);
    const { data, error } = await client.rpc("makeborne_record_care_payment", { p_workspace: workspaceId, p_client: clientId, p_request: key.data, p_note: body.note });
    if (missingPortal(error)) throw new RequestError("PORTAL_SETUP", "Care plans are being set up. Please try again later.", 503);
    agencyDatabaseError(error);
    return cloudJson({ available: true, ...CarePlanResponseSchema.parse(data) }, 201);
  } catch (error) { return cloudError(error); }
}
