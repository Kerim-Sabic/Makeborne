import { verifyWhopEvent } from "@/lib/billing/webhook";
import { SUPPORT } from "@/lib/billing/config";
import { apiError, RequestError } from "@/lib/server/http";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Connected endpoint for the new Whop contract. Do not acknowledge financial
 * events as fulfilled until the recurring entitlement adapter is deployed. */
export async function POST(request: Request) {
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new RequestError("EMPTY_WEBHOOK", "Webhook body is missing.", 400);
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 512_000) {
          await reader.cancel();
          throw new RequestError("REQUEST_TOO_LARGE", "Webhook exceeds the allowed size.", 413);
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const event = verifyWhopEvent(Buffer.concat(chunks).toString("utf8"), request.headers);
    if (event.account_id !== SUPPORT.companyId) throw new RequestError("WRONG_MERCHANT", "Wrong merchant.", 403);
    // A support membership never grants creation credits or app access.
    // Unknown or incomplete notifications must retry instead of being lost.
    if (event.data.plan_id === SUPPORT.planId) return Response.json({ received: true, creationAccess: false }, { headers: { "Cache-Control": "no-store" } });
    throw new RequestError("FULFILLMENT_NOT_ACTIVE", "Creation billing is closed until recurring fulfillment is verified.", 503);
  } catch (error) { return apiError(error); }
}
