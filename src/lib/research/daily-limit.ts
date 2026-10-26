import { RequestError } from "../server/http";
import type { Rpc } from "./cache";

/**
 * Per-person daily limits (a rolling 24 hours), counted in SQL so they hold across server instances
 * (makeborne_research_daily_take, migration 20261026120100). SQL is the authority; these numbers are
 * the same ones, for messages and tests. A use is taken just before the work starts, after the
 * route's own checks, so a refused or replayed request does not use one.
 */
export const DAILY_LIMITS = Object.freeze({ site_check: 100, client_research: 30 });
export type DailyLimitKind = keyof typeof DAILY_LIMITS;
const WHAT: Record<DailyLimitKind, string> = { site_check: "website checks", client_research: "client research runs" };

/** Takes one use for this person, or refuses with 429. Fails closed (503) when the limit cannot be read. */
export async function takeDailyUse(rpc: Rpc, input: { actorId: string; workspaceId: string; kind: DailyLimitKind }) {
  const { data, error } = await rpc("makeborne_research_daily_take", { p_actor: input.actorId, p_workspace: input.workspaceId, p_kind: input.kind });
  if (error || !data || typeof data !== "object") throw new RequestError("DAILY_LIMIT_UNAVAILABLE", "This isn't available right now. Try again in a moment.", 503);
  const result = data as { allowed?: unknown; limit?: unknown };
  if (result.allowed === true) return;
  const limit = typeof result.limit === "number" ? result.limit : DAILY_LIMITS[input.kind];
  throw new RequestError("DAILY_LIMIT", `You've reached the limit of ${limit} ${WHAT[input.kind]} in 24 hours. Try again later.`, 429);
}
