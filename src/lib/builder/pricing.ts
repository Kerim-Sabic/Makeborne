import { z } from "zod";
import type { EffortLevel } from "../routing/effort";
import { MARGIN_POLICY, creditOffers, maxAiCostUsdPerCredit } from "../billing/margins";

/** Provider prices live in ../ai/prices.ts (verified price card; unknown models
 * fail closed). Live builder calls are bounded and metered by ../ai/run-spend.ts. */

/** Internal AI provider cost (USD) that one credit represents: usage is
 * converted to credits at this rate. It is NOT what customers pay per credit
 * (plans and top-ups sell credits at $0.05–0.12; see src/lib/billing/margins.ts).
 * At $0.03 a chat edit is ~5–7 credits and a full first build ~25–50. */
export const DEFAULT_AI_COST_USD_PER_CREDIT = 0.03;
/** A higher value gives customers more AI per credit; above this ceiling some
 * live offer would drop below MARGIN_POLICY.enforcedMinAiMargin. */
export const MAX_AI_COST_USD_PER_CREDIT = maxAiCostUsdPerCredit(creditOffers(), MARGIN_POLICY.enforcedMinAiMargin);

let warned = false;
/** Reads MAKEBORNE_AI_COST_USD_PER_CREDIT, falling back to the legacy
 * MAKEBORNE_USD_PER_CREDIT that existing deployments set. Invalid values, and
 * values that would break the enforced margin floor, use the default. */
export function aiCostUsdPerCredit(env: Record<string, string | undefined> = process.env): number {
  const raw = [env.MAKEBORNE_AI_COST_USD_PER_CREDIT, env.MAKEBORNE_USD_PER_CREDIT].find(value => value !== undefined && value.trim() !== "");
  if (raw === undefined) return DEFAULT_AI_COST_USD_PER_CREDIT;
  const parsed = z.coerce.number().positive().safeParse(raw.trim());
  if (parsed.success && parsed.data <= MAX_AI_COST_USD_PER_CREDIT) return parsed.data;
  if (!warned) {
    warned = true;
    console.error(`Ignoring AI cost per credit "${raw}": it must be a positive number no higher than ${MAX_AI_COST_USD_PER_CREDIT.toFixed(4)} to keep the enforced margin floor. Using ${DEFAULT_AI_COST_USD_PER_CREDIT}.`);
  }
  return DEFAULT_AI_COST_USD_PER_CREDIT;
}
export const creditsForUsd = (usd: number) => Math.max(0, Math.ceil(usd / aiCostUsdPerCredit() - 1e-9));

/** Builder behavior per effort level. The credit ceiling is the most a single
 * request may charge; the run stops gracefully before exceeding it. */
export const BUILDER_EFFORT: Record<EffortLevel, { intensity: "low" | "medium" | "high" | "xhigh" | "max"; maxTurns: number; maxImages: number; ceilingCredits: number; maxTokens: number }> = {
  light: { intensity: "low", maxTurns: 8, maxImages: 1, ceilingCredits: 20, maxTokens: 32000 },
  medium: { intensity: "medium", maxTurns: 12, maxImages: 3, ceilingCredits: 50, maxTokens: 64000 },
  high: { intensity: "high", maxTurns: 16, maxImages: 4, ceilingCredits: 90, maxTokens: 64000 },
  super_high: { intensity: "xhigh", maxTurns: 20, maxImages: 6, ceilingCredits: 140, maxTokens: 96000 },
  ultra: { intensity: "max", maxTurns: 28, maxImages: 8, ceilingCredits: 240, maxTokens: 128000 },
};
/** Smallest balance worth starting a run with. */
export const MINIMUM_RUN_CREDITS = 2;
