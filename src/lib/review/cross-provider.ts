import type { ModelReview, ReviewRequest } from "./contract";

/**
 * Optional cross-provider reviewer: OFF by default and refused until a blind
 * comparison qualifies it (docs/release-review/independent-review-qualification-20261023.md).
 * Only the interface exists; no provider call is implemented here.
 *
 * Flag: MAKEBORNE_CROSS_PROVIDER_REVIEW (default "off"). Even "on" is refused
 * while the registry entry below is unqualified, so setting the flag alone
 * cannot charge anyone for an unqualified second opinion.
 */
export type CrossProviderReviewer = Readonly<{
  id: string;
  /** Same contract as the default reviewer: the request in, a ModelReview (validated server-side) out. */
  review(request: ReviewRequest, signal: AbortSignal): Promise<{ stopReason: string | null; submitted?: unknown }>;
}>;
export type ReviewerEntry = Readonly<{ id: string; label: string; crossProvider: boolean; defaultOn: boolean; qualified: boolean; evidence: string }>;

export const REVIEWER_REGISTRY: readonly ReviewerEntry[] = Object.freeze([
  Object.freeze({ id: "fresh_context", label: "Independent review", crossProvider: false, defaultOn: true, qualified: false,
    evidence: "Contract and fixtures verified offline (src/lib/review/check-review.cjs). Live qualification outstanding: no approved budget on 2026-10-23." }),
  Object.freeze({ id: "cross_provider", label: "Second-opinion review", crossProvider: true, defaultOn: false, qualified: false,
    evidence: "Not qualified: needs the blind comparison in the qualification plan before any customer is charged for it." }),
]);

export function crossProviderFlag(env: Record<string, string | undefined> = process.env): "on" | "off" {
  return env.MAKEBORNE_CROSS_PROVIDER_REVIEW === "on" ? "on" : "off";
}

export class ReviewerRefused extends Error { constructor(readonly code: "REVIEWER_DISABLED" | "REVIEWER_NOT_QUALIFIED", message: string) { super(message); } }

/** The only way to obtain the cross-provider reviewer. Refused unless flagged on AND qualified in the registry. */
export function resolveCrossProviderReviewer(implementation: CrossProviderReviewer | null, options: { env?: Record<string, string | undefined>; registry?: readonly ReviewerEntry[] } = {}): CrossProviderReviewer {
  if (crossProviderFlag(options.env) !== "on") throw new ReviewerRefused("REVIEWER_DISABLED", "The second-opinion review is not available.");
  const entry = (options.registry ?? REVIEWER_REGISTRY).find(item => item.id === "cross_provider");
  if (!entry?.qualified) throw new ReviewerRefused("REVIEWER_NOT_QUALIFIED", "The second-opinion review is not available yet.");
  if (!implementation) throw new ReviewerRefused("REVIEWER_DISABLED", "The second-opinion review is not available.");
  return implementation;
}

/** A second opinion never replaces the default review; its findings are grounded exactly like the default reviewer's. */
export type SecondOpinion = Readonly<{ reviewer: string; review: ModelReview | null; unavailable: string | null }>;
