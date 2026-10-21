import "server-only";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { unavailableBilling, type BillingViewModel } from "./view";
import { decodeUsageCursor, USAGE_PAGE_SIZE, usageHistoryView, usagePeriod } from "./usage-history";

/**
 * Itemized usage for the signed-in account. The read runs as the user's own
 * session: the database scopes it to auth.uid() and accepts no account ID, so
 * query parameters choose only the month and page. Any failure keeps the
 * history "unavailable" rather than showing an empty one.
 */
export async function loadUsageHistory(user: User, params: { usage?: unknown; usageBefore?: unknown }): Promise<BillingViewModel> {
  try {
    const period = usagePeriod(params.usage);
    const cursor = decodeUsageCursor(params.usageBefore);
    const client = await createClient();
    const { data: claims, error: claimsError } = await client.auth.getClaims();
    if (claimsError || claims?.claims?.sub !== user.id) return { ...unavailableBilling, entries: [] };
    const { data, error } = await client.rpc("makeborne_usage_history_v2", {
      p_period_start: period.start, p_period_end: period.end,
      p_before_at: cursor?.at ?? null, p_before_id: cursor?.id ?? null, p_limit: USAGE_PAGE_SIZE,
    });
    if (error) {
      console.error(JSON.stringify({ event: "usage_history_unavailable", reason: "read_failed", code: error.code ?? null }));
      return { ...unavailableBilling, entries: [] };
    }
    return usageHistoryView(data, period, cursor);
  } catch {
    return { ...unavailableBilling, entries: [] };
  }
}
