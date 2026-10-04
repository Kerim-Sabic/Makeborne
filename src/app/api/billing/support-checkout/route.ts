import { billingUser, requireBillingUser } from "@/lib/billing/access";
import { SUPPORT } from "@/lib/billing/config";
import { apiError, sameOrigin } from "@/lib/server/http";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET() {
  return Response.json({ available: true, authenticated: Boolean(await billingUser()) }, { headers });
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    await requireBillingUser();
    // This fixed, verified public product is support only. A success redirect,
    // email match, or coffee receipt must never become an app entitlement.
    return Response.json({ url: SUPPORT.url }, { headers });
  } catch (error) { return apiError(error); }
}
