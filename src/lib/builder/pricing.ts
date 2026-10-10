import { z } from "zod";
import type { EffortLevel } from "../routing/effort";

/** Provider list prices in USD per million tokens. Keep in sync with the
 * provider's published price card; unknown models fail closed in `usageCost`. */
const TEXT_PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
};
/** Conservative per-image estimate for one gpt-image generation at the sizes we request. */
export const IMAGE_COST_USD = 0.08;

export type TokenUsage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };

/** Unknown or fallback models are charged at a conservative rate. */
const FALLBACK_PRICE = { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 };

export function usageCost(model: string, usage: TokenUsage): number {
  const price = TEXT_PRICES[model] ?? FALLBACK_PRICE;
  return (usage.input_tokens * price.input + usage.output_tokens * price.output
    + (usage.cache_read_input_tokens ?? 0) * price.cacheRead
    + (usage.cache_creation_input_tokens ?? 0) * price.cacheWrite) / 1_000_000;
}

/** USD of provider cost represented by one credit. Plan credit allowances are
 * priced against this value, so change both together. */
export function usdPerCredit(): number {
  const parsed = z.coerce.number().positive().max(10).safeParse(process.env.MAKEBORNE_USD_PER_CREDIT ?? "0.01");
  return parsed.success ? parsed.data : 0.01;
}
export const creditsForUsd = (usd: number) => Math.max(0, Math.ceil(usd / usdPerCredit() - 1e-9));

/** Builder behavior per effort level. The credit ceiling is the most a single
 * request may charge; the run stops gracefully before exceeding it. */
export const BUILDER_EFFORT: Record<EffortLevel, { intensity: "low" | "medium" | "high" | "xhigh" | "max"; maxTurns: number; maxImages: number; ceilingCredits: number; maxTokens: number }> = {
  light: { intensity: "low", maxTurns: 8, maxImages: 1, ceilingCredits: 60, maxTokens: 32000 },
  medium: { intensity: "medium", maxTurns: 12, maxImages: 3, ceilingCredits: 150, maxTokens: 64000 },
  high: { intensity: "high", maxTurns: 16, maxImages: 4, ceilingCredits: 250, maxTokens: 64000 },
  super_high: { intensity: "xhigh", maxTurns: 20, maxImages: 6, ceilingCredits: 400, maxTokens: 96000 },
  ultra: { intensity: "max", maxTurns: 28, maxImages: 8, ceilingCredits: 700, maxTokens: 128000 },
};
/** Smallest balance worth starting a run with. */
export const MINIMUM_RUN_CREDITS = 5;
