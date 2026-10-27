import "server-only";
import { plansOnSale } from "@/lib/billing/plans-on-sale";

/**
 * Whether creation plans are on sale right now: the same advisory database plan gate the plans page uses on this
 * branch. Advisory for the launch copy only; checkout always rechecks it.
 */
export async function salesOpenNow(): Promise<boolean> {
  return plansOnSale();
}
