import { cloudBody, cloudError, cloudJson, validId } from "@/lib/cloud/server";
import { CarePlanResponseSchema, CarePlanUpdateSchema, type CarePlanResponse } from "@/lib/portal/care";
import { agencyContext, agencyDatabaseError } from "@/lib/portal/agency";
import { missingPortal } from "@/lib/portal/server";
import { RequestError } from "@/lib/server/http";

type Context = { params: Promise<{ workspaceId: string; clientId: string }> };
const UNAVAILABLE = "Care plans are being set up. Please try again later.";

/** The client's care plan (null when none) and its latest payments. Owners and editors only. */
export async function GET(_request: Request, context: Context) {
  try {
    const { workspaceId, clientId } = await context.params;
    validId(clientId);
    const { client } = await agencyContext(workspaceId, false);
    const { data, error } = await client.rpc("makeborne_care_plan", { p_workspace: workspaceId, p_client: clientId });
    if (missingPortal(error)) return cloudJson({ available: false, plan: null, payments: [] });
    agencyDatabaseError(error);
    const result: CarePlanResponse = CarePlanResponseSchema.parse(data);
    return cloudJson({ available: true, ...result });
  } catch (error) { return cloudError(error); }
}

/** Creates or updates the plan: name, price, billing period, the agency's own payment link, paid-until date, on/off. */
export async function PUT(request: Request, context: Context) {
  try {
    const { workspaceId, clientId } = await context.params;
    validId(clientId);
    const body = await cloudBody(request, CarePlanUpdateSchema, 4_096);
    const { client } = await agencyContext(workspaceId, true);
    const { data, error } = await client.rpc("makeborne_set_care_plan", { p_workspace: workspaceId, p_client: clientId, p_label: body.label,
      p_amount_cents: body.amountCents, p_currency: body.currency, p_interval: body.interval, p_payment_url: body.paymentUrl,
      p_paid_through: body.paidThrough, p_active: body.active });
    if (missingPortal(error)) throw new RequestError("PORTAL_SETUP", UNAVAILABLE, 503);
    agencyDatabaseError(error);
    return cloudJson({ available: true, ...CarePlanResponseSchema.parse(data) });
  } catch (error) { return cloudError(error); }
}
