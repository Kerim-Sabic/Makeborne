import "server-only";
import { billingConfig } from "@/lib/billing/config";

/**
 * Whether creation plans are on sale right now: the exact gate the checkout route uses on this branch
 * (WHOP_CREATION_ENABLED, migrations verified and a configured merchant). Advisory for the launch copy only;
 * checkout always rechecks it.
 */
export async function salesOpenNow(): Promise<boolean> {
  try { return billingConfig().enabled; } catch { return false; }
}
