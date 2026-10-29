import "server-only";
import { billingDatabase } from "@/lib/billing/database";

/** Below this, the launch screen shows no count at all. Never seeded, never faked. */
export const WAITLIST_PROOF_MIN = 50;
const CACHE_MS = 60_000;
const WAIT_MS = 400;
let cached: { at: number; value: number | null } | null = null;

/** The real count, rounded down to tens; null when unknown or below the minimum. Pure, for tests. */
export function waitlistProof(count: unknown): number | null {
  if (typeof count !== "number" || !Number.isFinite(count) || count < WAITLIST_PROOF_MIN) return null;
  return Math.floor(count / 10) * 10;
}

/**
 * "Join N others on the waitlist": one database count per server instance per minute, and never more than 400 ms of
 * the page's render. A slow or failing database simply shows no count.
 */
export async function waitlistProofCount(now = Date.now()): Promise<number | null> {
  if (cached && now - cached.at < CACHE_MS) return cached.value;
  const lookup = (async () => {
    try {
      const { data, error } = await billingDatabase().rpc("makeborne_launch_waitlist_count");
      return error ? null : waitlistProof(data);
    } catch { return null; }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const value = await Promise.race([lookup, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), WAIT_MS); })]);
  clearTimeout(timer);
  cached = { at: now, value };
  // A late answer still refreshes the cache for the next visitor.
  if (value === null) void lookup.then(late => { if (late !== null) cached = { at: Date.now(), value: late }; });
  return value;
}
