import type { EffortLevel } from "../routing/effort";

/**
 * Measured costs behind the credit estimates shown before a build and on the
 * billing page. Nothing here is a guess: every figure is the provider cost of
 * one complete operation in the 18 October 2026 golden-brief run
 * (docs/execution/BASELINE_2026-10.md §10; per-brief cost.json files under
 * outputs/eval/runs/golden-20261018/). Conditions: Medium effort, Create mode,
 * no AI images, current builder model. A website figure covers the whole
 * request: the build, any automatic continuation and the automatic design
 * review (Saffron Table's Plan-mode planning call is excluded).
 *
 * Credits are derived on the server with the live cost-per-credit rate, the
 * same rounding the settlement uses (whole credits, rounded up), so the
 * estimate follows the rate if it changes.
 */
export const MEASURED_EFFORT: EffortLevel = "medium";
/** Which run the arrays below come from, as the pricing page names it. The deck and book sizes are
 * the two golden decks and books (BASELINE_2026-10.md). These runs predate the later caching and
 * review changes; re-measure, then update the arrays and this label together. */
export const MEASURED_RUN = Object.freeze({ id: "golden-20261018", label: "18 October 2026 test runs", presentationSlides: Object.freeze([8, 10]), bookPages: Object.freeze([13, 38]) });
export type MeasuredRun = { label: string; presentationSlides: readonly number[]; bookPages: readonly number[] };
export const MEASURED_FIRST_BUILD_USD = Object.freeze({
  website: Object.freeze([1.125621, 1.348174, 1.074213, 0.909322, 1.054121, 0.648577, 1.041343, 0.528332, 0.78035, 0.480012,
    0.991713, 0.524447, 1.302457, 0.760686, 0.890188, 0.535692, 1.065288, 1.022891, 0.941304, 0.461811]),
  presentation: Object.freeze([0.191261, 0.250849]),
  book: Object.freeze([0.417201, 0.266935]),
});
/** The automatic design-review round of each of the 20 website builds above. */
export const MEASURED_REVIEW_ROUND_USD = Object.freeze([0.315631, 0.274366, 0.278141, 0.243871, 0.259171, 0.228736, 0.273901, 0.228989, 0.258231, 0.217726,
  0.256471, 0.227106, 0.257566, 0.223411, 0.241501, 0.220376, 0.289971, 0.247786, 0.286596, 0.234455]);

export type CreditRange = { min: number; median: number; max: number; samples: number };
export type BuilderEstimates = {
  /** The effort level the measurements were taken at. */
  effort: EffortLevel;
  firstBuild: { website: CreditRange; presentation: CreditRange; book: CreditRange };
  reviewRound: CreditRange;
};

const credits = (usd: number, usdPerCredit: number) => Math.max(0, Math.ceil(usd / usdPerCredit - 1e-9));

export function creditRange(usd: readonly number[], usdPerCredit: number): CreditRange {
  if (!usd.length || !(usdPerCredit > 0)) throw new Error("A credit range needs measurements and a positive rate.");
  const sorted = usd.map(value => credits(value, usdPerCredit)).sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  return { min: sorted[0], median, max: sorted[sorted.length - 1], samples: sorted.length };
}

export function builderEstimates(usdPerCredit: number): BuilderEstimates {
  return {
    effort: MEASURED_EFFORT,
    firstBuild: {
      website: creditRange(MEASURED_FIRST_BUILD_USD.website, usdPerCredit),
      presentation: creditRange(MEASURED_FIRST_BUILD_USD.presentation, usdPerCredit),
      book: creditRange(MEASURED_FIRST_BUILD_USD.book, usdPerCredit),
    },
    reviewRound: creditRange(MEASURED_REVIEW_ROUND_USD, usdPerCredit),
  };
}

const range = (value: unknown): value is CreditRange => typeof value === "object" && value !== null
  && ["min", "median", "max", "samples"].every(key => Number.isSafeInteger((value as Record<string, unknown>)[key]) && (value as Record<string, number>)[key] >= 0)
  && (value as CreditRange).min <= (value as CreditRange).max;

/** Validates estimates received from GET /api/build; null when absent or malformed. */
export function parseBuilderEstimates(value: unknown): BuilderEstimates | null {
  if (typeof value !== "object" || value === null) return null;
  const input = value as Partial<BuilderEstimates>;
  const first = input.firstBuild as Partial<BuilderEstimates["firstBuild"]> | undefined;
  if (input.effort !== MEASURED_EFFORT || !first || !range(first.website) || !range(first.presentation) || !range(first.book) || !range(input.reviewRound)) return null;
  return { effort: input.effort, firstBuild: { website: first.website, presentation: first.presentation, book: first.book }, reviewRound: input.reviewRound };
}
