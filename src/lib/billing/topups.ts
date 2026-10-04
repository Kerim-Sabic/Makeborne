import "server-only";
import { billingUser, verifyCreationAccess } from "./access";
import type { CreditTopupAvailability } from "./topups-catalog";

export const CREDIT_TOPUPS_NOT_OPEN = "Credit packs are being prepared. Checkout opens when automatic credit delivery is ready.";

/** No environment variable may activate a ledger/fulfillment adapter that does not exist. */
export async function creditTopupAvailability(): Promise<CreditTopupAvailability> {
  const user = await billingUser();
  let eligible = false;
  if (user) {
    try { eligible = await verifyCreationAccess(user); }
    catch { return { available: false, authenticated: true, eligible: false, reason: "We could not confirm your membership. Please try again shortly." }; }
  }
  return { available: false, reason: CREDIT_TOPUPS_NOT_OPEN, authenticated: Boolean(user), eligible };
}
