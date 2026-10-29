import "server-only";
import { plansOnSale } from "@/lib/billing/plans-on-sale";

/** How long one answer is reused per server instance: the home page asks on every visit during the launch window. */
const REUSE_MS = 15_000;
let cached: { at: number; value: Promise<boolean> } | null = null;

/**
 * Whether creation plans are on sale right now: the same advisory database plan gate the plans page uses on this
 * branch, reused for 15 seconds per instance. Advisory for the launch copy only; checkout always rechecks it.
 */
export async function salesOpenNow(): Promise<boolean> {
  const now = Date.now();
  if (!cached || now - cached.at > REUSE_MS) cached = { at: now, value: plansOnSale().catch(() => false) };
  return cached.value;
}
