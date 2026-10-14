import { z } from "zod";
import { requireBillingUser } from "@/lib/billing/access";
import { billingConfig } from "@/lib/billing/config";
import { billingDatabase } from "@/lib/billing/database";
import { verifiedCreationOffer } from "@/lib/billing/creation-offers";
import { checkoutUrl, whopRequest } from "@/lib/billing/whop";
import { authDestination } from "@/lib/supabase/auth-flow";
import { SITE } from "@/lib/site-metadata";
import { apiError, boundedJson, RequestError, sameOrigin } from "@/lib/server/http";

const commonInput = { requestId: z.string().uuid(), next: z.string().max(2000).optional() };
const inputSchema = z.union([
  z.object({ ...commonInput, tier: z.enum(["create", "studio", "scale"]), interval: z.enum(["monthly", "yearly"]) }).strict(),
  z.object({ ...commonInput, planId: z.string().regex(/^plan_[A-Za-z0-9]+$/) }).strict(),
]);
const checkoutSchema = z.object({ id: z.string().regex(/^ch_[A-Za-z0-9]+$/), company_id: z.string(), plan: z.object({ id: z.string() }), purchase_url: z.string() });
export const runtime = "nodejs";

type Db = ReturnType<typeof billingDatabase>;
/** The account's most recent checkout without a membership, if any (an abandoned or in-progress purchase). */
async function openCheckout(db: Db, userId: string) {
  const { data: checkouts, error } = await db.from("billing_checkouts").select("request_id,plan_id,purchase_url,status,checkout_id")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(10);
  if (error) return null;
  const ids = (checkouts ?? []).map(row => row.checkout_id).filter((id): id is string => typeof id === "string");
  const { data: memberships, error: membershipError } = ids.length
    ? await db.from("billing_memberships").select("checkout_id").in("checkout_id", ids) : { data: [], error: null };
  if (membershipError) return null;
  const bound = new Set((memberships ?? []).map(row => row.checkout_id));
  return (checkouts ?? []).find(row => !row.checkout_id || !bound.has(row.checkout_id)) ?? null;
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireBillingUser();
    const config = billingConfig();
    if (!config.enabled) throw new RequestError("CREATION_PLANS_NOT_OPEN", "Creation memberships are being prepared. The coffee contribution is support only.", 503);
    const parsed = inputSchema.safeParse(await boundedJson(request, 4096));
    if (!parsed.success) throw new RequestError("PLAN_UNAVAILABLE", "Choose an available creation membership.", 400);
    const offer = await verifiedCreationOffer(parsed.data);
    if (!offer) throw new RequestError("PLAN_UNAVAILABLE", "This plan's price and availability could not be confirmed. Please refresh and choose an available plan.", 503);
    const { planId } = offer;
    const { requestId } = parsed.data;
    const db = billingDatabase();
    const { data: databaseEnabled, error: flagError } = await db.rpc("makeborne_billing_creation_enabled", { p_plan_id: planId });
    if (flagError || databaseEnabled !== true) throw new RequestError("CREATION_PLANS_NOT_OPEN", "Creation memberships are not available for purchase yet.", 503);
    const destination = authDestination(parsed.data.next ?? "/studio");
    const next = destination.startsWith("/studio") || destination === "/chat" ? destination : "/studio";
    // Reserve a durable request before contacting Whop. Concurrent/repeated
    // requests cannot create multiple checkout configurations for the same key.
    const { error: insertError } = await db.from("billing_checkouts").insert({ request_id: requestId, user_id: user.id, plan_id: planId, return_path: next, status: "pending" });
    if (insertError) {
      if (insertError.code === "PBC01") throw new RequestError("SUBSCRIPTION_ALREADY_EXISTS", "You already have a creation subscription. Contact support to change your plan; you do not need to buy another subscription.", 409);
      if (insertError.code === "PBC02") {
        // Never a second checkout: resume the open one for the same plan (an abandoned
        // checkout must not lock the account), otherwise ask to finish it or contact support.
        const open = await openCheckout(db, user.id);
        if (open && open.status === "ready" && open.purchase_url && open.plan_id === planId)
          return Response.json({ url: checkoutUrl(open.purchase_url), resumed: true }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
        throw new RequestError("CHECKOUT_ALREADY_OPEN", open && open.status === "ready" && open.plan_id !== planId
          ? "You already have an open checkout for a different plan. Finish that checkout, or contact support to change it."
          : "You already have a checkout awaiting confirmation. Complete the existing checkout or contact support before starting another.", 409);
      }
      if (insertError.code !== "23505") throw new RequestError("CHECKOUT_UNAVAILABLE", "Checkout is temporarily unavailable. Your draft is saved.", 503);
      const { data: previous, error } = await db.from("billing_checkouts").select("plan_id,return_path,purchase_url,status,checkout_id").eq("user_id", user.id).eq("request_id", requestId).maybeSingle();
      if (error || !previous || previous.plan_id !== planId || previous.return_path !== next) throw new RequestError("CHECKOUT_CONFLICT", "This checkout request belongs to a different selection.", 409);
      if (previous.status === "ready" && previous.purchase_url && previous.checkout_id) {
        // A retained browser key may outlive the original membership. Never send
        // a completed purchase back to payment, even after cancellation/expiry.
        const { data: bound, error: boundError } = await db.from("billing_memberships").select("membership_id")
          .eq("checkout_id", previous.checkout_id).limit(1);
        if (boundError) throw new RequestError("CHECKOUT_UNAVAILABLE", "This checkout could not be confirmed. Please try again shortly.", 503);
        if (bound?.length) throw new RequestError("CHECKOUT_ALREADY_COMPLETED", "This checkout has already been used. Review your billing and contact support before starting another subscription.", 409);
        return Response.json({ url: checkoutUrl(previous.purchase_url) }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
      }
      throw new RequestError("CHECKOUT_PENDING", "This checkout is still being confirmed. Please wait before trying again.", 409);
    }
    const response = checkoutSchema.safeParse(await whopRequest("/checkout_configurations", {
      mode: "payment", plan_id: planId,
      metadata: { makeborne_request_id: requestId },
      // Whop requires HTTPS. The isolated sandbox has no public app origin;
      // return to its own home and inspect delivery locally, never production.
      redirect_url: config.sandbox ? "https://sandbox.whop.com/" : `${SITE.url}/billing/return?request=${requestId}`,
    }));
    if (!response.success || response.data.company_id !== config.companyId || response.data.plan.id !== planId) throw new RequestError("CHECKOUT_UNVERIFIED", "We could not confirm this checkout. No access has been activated.", 503);
    const url = checkoutUrl(response.data.purchase_url);
    const { error: savedError } = await db.from("billing_checkouts").update({ checkout_id: response.data.id, purchase_url: url, status: "ready" }).eq("request_id", requestId).eq("user_id", user.id);
    if (savedError) throw new RequestError("CHECKOUT_UNVERIFIED", "The checkout could not be saved. Please try again later.", 503);
    return Response.json({ url }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  } catch (error) { return apiError(error); }
}
