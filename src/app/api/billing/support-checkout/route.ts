import { billingUser, requireBillingUser } from "@/lib/billing/access";
import { SUPPORT } from "@/lib/billing/config";
import { apiError, sameOrigin, RequestError } from "@/lib/server/http";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const available = () => process.env.MAKEBORNE_SUPPORT_CHECKOUT_ENABLED !== "false";

export async function GET() {
  return Response.json({ available: available(), authenticated: Boolean(await billingUser()) }, { headers });
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (!available()) throw new RequestError("SUPPORT_DISABLED", "Support checkout is unavailable in this environment.", 503);
    await requireBillingUser();
    // This fixed, verified public product is support only. A success redirect,
    // email match, or coffee receipt must never become an app entitlement.
    return Response.json({ url: SUPPORT.url }, { headers });
  } catch (error) { return apiError(error); }
}
