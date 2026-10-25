import type { EffortLevel } from "../routing/effort";

/** Visual self-review: shared limits and policy (safe for client and server).
 * The browser renders each viewport in a sandboxed frame, rasterises the page
 * and slices it into viewport-sized tiles; the server validates the same limits. */

export type ReviewViewport = "desktop" | "mobile";
export const REVIEW_VIEWPORTS: readonly { id: ReviewViewport; label: string; width: number; height: number; scale: number; maxTiles: number }[] = [
  // ~1080×675 tiles (~1k image tokens each): enough to judge type, spacing and alignment.
  { id: "desktop", label: "Desktop", width: 1440, height: 900, scale: 0.75, maxTiles: 6 },
  // ~390×844 tiles (~450 tokens each); mobile pages run longer, so allow more of them.
  // Together about 9k image tokens (~$0.04) covers most of a typical landing page.
  { id: "mobile", label: "Mobile", width: 390, height: 844, scale: 1, maxTiles: 8 },
];

export const REVIEW_LIMITS = Object.freeze({
  maxShots: REVIEW_VIEWPORTS.reduce((total, viewport) => total + viewport.maxTiles, 0),
  /** Base64 characters per screenshot (~520 KB of JPEG). */
  maxShotBase64: 700_000,
  /** Longest edge of a screenshot in pixels (Claude downsizes beyond ~1568). */
  maxShotEdge: 1568,
  /** Smallest trailing tile worth sending, in source pixels. */
  minTileHeight: 120,
  maxErrors: 12,
  maxErrorChars: 600,
});

/** A partial capture must not become a paid 'passed design review'. Runtime
 * errors without images may still be repaired, but cannot prove visual quality.
 */
export function reviewCoverageIssue(input: {
  screenshots: readonly { viewport: ReviewViewport; index: number; of: number }[];
  viewports: readonly { viewport: ReviewViewport }[];
  errors: readonly string[];
  failures?: readonly string[];
}): string | null {
  if (input.failures?.length) return "Desktop and mobile could not both be captured. Try the review again.";
  if (!input.screenshots.length) return input.errors.length ? null : "The page could not be captured.";
  for (const { id, label } of REVIEW_VIEWPORTS) {
    if (input.viewports.filter(report => report.viewport === id).length !== 1) return `${label} capture is missing or duplicated.`;
    const shots = input.screenshots.filter(shot => shot.viewport === id);
    if (!shots.length || shots.some(shot => shot.of !== shots.length)
      || new Set(shots.map(shot => shot.index)).size !== shots.length
      || shots.some(shot => shot.index < 0 || shot.index >= shots.length)) return `${label} screenshots are incomplete.`;
  }
  return null;
}

/** Automatic review rounds after a build, by effort level. Light skips the
 * review (it is the cheap, focused mode); Ultra may review its own fixes. */
export const AUTO_REVIEW_ROUNDS: Readonly<Record<EffortLevel, number>> = Object.freeze({ light: 0, medium: 1, high: 1, super_high: 1, ultra: 2 });

/** Only first builds and large changes are reviewed automatically; small
 * edits stay fast and cheap (the user can still ask for a review). */
export function autoReviewRounds(effort: EffortLevel, change: { firstBuild: boolean; filesTouched: number }): number {
  if (!change.firstBuild && change.filesTouched < 3) return 0;
  return AUTO_REVIEW_ROUNDS[effort] ?? 0;
}

/** Credit ceiling for one review round: about 30% of the effort ceiling, with
 * a floor that still affords reading the project plus a few fixes. */
export function reviewCreditCeiling(effortCeiling: number): number {
  return Math.min(effortCeiling, Math.max(12, Math.ceil(effortCeiling * 0.3)));
}
/** Tool-loop turns for one review round (look, fix, verify, finish). */
export const REVIEW_MAX_TURNS = 6;
/** Images one review round may generate: one regenerated image (an image the screenshots show
 * reads as AI-made, is badly cropped beyond CSS or shows the wrong subject), only when the site
 * already carries generated images and the client did not choose a type-only design. The image is
 * paid from the round's existing credit ceiling and its third-of-allowance image budget. */
export function reviewImageLimit(input: { imagery?: string | null; siteImages: number }): 0 | 1 {
  return input.imagery === "type" || input.siteImages < 1 ? 0 : 1;
}
