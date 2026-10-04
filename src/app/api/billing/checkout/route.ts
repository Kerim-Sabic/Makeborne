import { z } from "zod";
import { requireBillingUser } from "@/lib/billing/access";
import { billingConfig } from "@/lib/billing/config";
import { billingDatabase } from "@/lib/billing/database";
import { checkoutUrl, whopRequest } from "@/lib/billing/whop";
import { authDestination } from "@/lib/supabase/auth-flow";
import { SITE } from "@/lib/site-metadata";
import { apiError, boundedJson, RequestError, sameOrigin } from "@/lib/server/http";

const inputSchema = z.object({ planId: z.string().regex(/^plan_[A-Za-z0-9]+$/), requestId: z.string().uuid(), next: z.string().max(2000).optional() }).strict();
const checkoutSchema = z.object({ id: z.string().regex(/^ch_[A-Za-z0-9]+$/), account_id: z.string(), plan: z.object({ id: z.string() }), purchase_url: z.string() });
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireBillingUser();
    const config = billingConfig();
    if (!config.enabled) throw new RequestError("CREATION_PLANS_NOT_OPEN", "Creation memberships are being prepared. The coffee contribution is support only.", 503);
    const parsed = inputSchema.safeParse(await boundedJson(request, 4096));
    if (!parsed.success || !config.accessPlanIds.includes(parsed.data.planId)) throw new RequestError("PLAN_UNAVAILABLE", "Choose an available creation membership.", 400);
    const { planId, requestId } = parsed.data;
    const db = billingDatabase();
    const { data: databaseEnabled, error: flagError } = await db.rpc("makeborne_billing_creation_enabled", { p_plan_id: planId });
    if (flagError || databaseEnabled !== true) throw new RequestError("CREATION_PLANS_NOT_OPEN", "Creation memberships are not available for purchase yet.", 503);
    const destination = authDestination(parsed.data.next ?? "/studio");
    const next = destination.startsWith("/studio") || destination === "/chat" ? destination : "/studio";
    // Reserve a durable request before contacting Whop. Concurrent/repeated
    // requests cannot create multiple checkout configurations for the same key.
    const { error: insertError } = await db.from("billing_checkouts").insert({ request_id: requestId, user_id: user.id, plan_id: planId, return_path: next, status: "pending" });
    if (insertError) {
      if (insertError.code !== "23505") throw new RequestError("CHECKOUT_UNAVAILABLE", "Checkout is temporarily unavailable. Your draft is saved.", 503);
      const { data: previous, error } = await db.from("billing_checkouts").select("plan_id,return_path,purchase_url,status").eq("user_id", user.id).eq("request_id", requestId).maybeSingle();
      if (error || !previous || previous.plan_id !== planId || previous.return_path !== next) throw new RequestError("CHECKOUT_CONFLICT", "This checkout request belongs to a different selection.", 409);
      if (previous.status === "ready" && previous.purchase_url) return Response.json({ url: checkoutUrl(previous.purchase_url) }, { headers: { "Cache-Control": "private, no-store" } });
      throw new RequestError("CHECKOUT_PENDING", "This checkout is still being confirmed. Please wait before trying again.", 409);
    }
    const response = checkoutSchema.safeParse(await whopRequest("/checkout_configurations", {
      mode: "payment", plan_id: planId,
      metadata: { makeborne_request_id: requestId },
      redirect_url: `${SITE.url}/billing/return?request=${requestId}`,
    }));
    if (!response.success || response.data.account_id !== config.companyId || response.data.plan.id !== planId) throw new RequestError("CHECKOUT_UNVERIFIED", "We could not confirm this checkout. No access has been activated.", 503);
    const url = checkoutUrl(response.data.purchase_url);
    const { error: savedError } = await db.from("billing_checkouts").update({ checkout_id: response.data.id, purchase_url: url, status: "ready" }).eq("request_id", requestId).eq("user_id", user.id);
    if (savedError) throw new RequestError("CHECKOUT_UNVERIFIED", "The checkout could not be saved. Please try again later.", 503);
    return Response.json({ url }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  } catch (error) { return apiError(error); }
}
