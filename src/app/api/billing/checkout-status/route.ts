import { requireBillingUser, verifyCreationAccess } from "@/lib/billing/access";
import { billingConfig } from "@/lib/billing/config";
import { billingDatabase } from "@/lib/billing/database";
import { apiError, RequestError } from "@/lib/server/http";
import { authDestination } from "@/lib/supabase/auth-flow";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await requireBillingUser();
    if (!billingConfig().enabled) throw new RequestError("CREATION_PLANS_NOT_OPEN", "Creation memberships are not open yet.", 503);
    const requestId = new URL(request.url).searchParams.get("request");
    if (!requestId || !/^[0-9a-f-]{36}$/i.test(requestId)) throw new RequestError("INVALID_CHECKOUT", "This checkout link is not valid.");
    const db = billingDatabase();
    const { data: checkout, error } = await db.from("billing_checkouts").select("checkout_id,return_path").eq("request_id", requestId).eq("user_id", user.id).maybeSingle();
    if (error) throw new RequestError("CHECKOUT_UNAVAILABLE", "This checkout is temporarily unavailable.", 503);
    if (!checkout) throw new RequestError("CHECKOUT_NOT_FOUND", "This checkout is not linked to your signed-in account.", 404);
    const { data: membership, error: membershipError } = await db.from("billing_memberships").select("membership_id").eq("checkout_id", checkout.checkout_id ?? "").eq("user_id", user.id).maybeSingle();
    if (membershipError) throw new RequestError("MEMBERSHIP_UNAVAILABLE", "Membership confirmation is temporarily unavailable.", 503);
    const active = Boolean(membership) && await verifyCreationAccess(user);
    return Response.json({ status: active ? "active" : "pending", ...(active ? { next: authDestination(checkout.return_path) } : {}) }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  } catch (error) { return apiError(error); }
}
