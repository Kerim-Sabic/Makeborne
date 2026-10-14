import { billingUser } from "@/lib/billing/access";
import { billingConfig } from "@/lib/billing/config";
import { billingDatabase } from "@/lib/billing/database";
import { configuredCreationOffers, verifiedCreationOffer } from "@/lib/billing/creation-offers";
import { apiError, RequestError } from "@/lib/server/http";

export const runtime = "nodejs";
export async function GET() {
  try {
    const user = await billingUser();
    let existingMember = false;
    if (user && billingConfig().configured) {
      const { data, error } = await billingDatabase().from("billing_memberships").select("membership_id")
        .eq("user_id", user.id).not("status", "in", "(canceled,expired,completed)").limit(1);
      if (error) throw new RequestError("AVAILABILITY_UNAVAILABLE", "Plan availability could not be confirmed. Please try again.", 503);
      existingMember = Boolean(data?.length);
    }
    const verified = existingMember ? [] : await Promise.all(configuredCreationOffers().map(offer => verifiedCreationOffer(offer).catch(() => null)));
    // Provider IDs, account IDs and configuration diagnostics never leave the server.
    const offers = verified.flatMap(offer => offer ? [{ tier: offer.tier, interval: offer.interval, totalCents: offer.totalCents, monthlyCredits: offer.monthlyCredits }] : []);
    return Response.json({ authenticated: Boolean(user), existingMember, offers }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  } catch (error) { return apiError(error); }
}
