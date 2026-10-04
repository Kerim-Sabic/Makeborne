import { billingUser, verifyCreationAccess } from "@/lib/billing/access";
import { billingConfig } from "@/lib/billing/config";
import { apiError } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const user = await billingUser();
    return Response.json({ authenticated: Boolean(user), creationAvailable: billingConfig().enabled, hasCreationAccess: user ? await verifyCreationAccess(user) : false }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  } catch (error) { return apiError(error); }
}
