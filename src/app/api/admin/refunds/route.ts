import { z } from "zod";
import { getAccountPrivileges } from "@/lib/account/privileges";
import { supportRefund } from "@/lib/admin/console";
import { billingUser } from "@/lib/billing/access";
import { apiError, boundedJson, RequestError, sameOrigin } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const InputSchema = z.object({ action: z.enum(["check", "begin", "cancel"]), paymentId: z.string().max(80), reason: z.string().max(500).default("") }).strict();

/**
 * Support refund workflow for administrators: check a payment's eligibility,
 * begin (withhold its unused credits while support refunds it in Whop) or
 * cancel (restore them when Whop shows no refund). The database re-checks the
 * administrator on every call.
 */
export async function POST(request: Request) {
  try {
    // A state-changing administrator action must come from this app's own page.
    if (!request.headers.get("origin")) throw new RequestError("ORIGIN_DENIED", "This request must originate from this application.", 403);
    sameOrigin(request);
    const user = await billingUser();
    if (!user) throw new RequestError("AUTH_REQUIRED", "Sign in as an administrator.", 401);
    if (!(await getAccountPrivileges(user.id)).isAdmin) throw new RequestError("ADMIN_REQUIRED", "Administrator access is required.", 403);
    const parsed = InputSchema.safeParse(await boundedJson(request, 4096));
    if (!parsed.success) throw new RequestError("INVALID_REFUND_REQUEST", "Choose an action and a payment.", 400);
    return Response.json(await supportRefund(user.id, parsed.data.action, parsed.data.paymentId, parsed.data.reason), { headers });
  } catch (error) { return apiError(error); }
}
