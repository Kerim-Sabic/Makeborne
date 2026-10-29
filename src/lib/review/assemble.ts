import {
  REVIEW_SCHEMA, ReviewRequestSchema,
  type ApprovedFacts, type Brief, type Coverage, type Diagnostic, type Finding, type ModelReview, type RenderedEvidence, type ReviewRequest, type ReviewSubject,
} from "./contract";
import type { Verification } from "./loop";

/**
 * Assembles and validates a review request. It takes ONLY the subject, the
 * approved brief and facts, the rendered evidence, diagnostics and coverage:
 * there is no argument for builder notes, summaries or self-assessment, and
 * the strict schema refuses any extra field.
 */
export class ReviewInputError extends Error { readonly code = "REVIEW_INPUT_INVALID"; }

export function assembleRequest(input: { subject: ReviewSubject; brief: Brief; facts: ApprovedFacts; evidence: RenderedEvidence; diagnostics: readonly Diagnostic[]; coverage: Coverage }): ReviewRequest {
  // Checks that could not run are coverage limits too.
  const skipped = input.diagnostics.filter(item => item.status === "not_checked").map(item => ({ what: `${item.check} at ${item.id.slice(item.check.length + 1) || "the artifact"}`.slice(0, 200), reason: (item.reason ?? "not checked").slice(0, 200) }));
  const notInspected = [...input.coverage.notInspected, ...skipped].filter((item, index, all) => all.findIndex(other => other.what === item.what) === index).slice(0, 40);
  const parsed = ReviewRequestSchema.safeParse({ schema: REVIEW_SCHEMA, subject: input.subject, brief: input.brief, facts: input.facts, evidence: input.evidence,
    diagnostics: input.diagnostics.slice(0, 400), coverage: { inspected: input.coverage.inspected, notInspected } });
  if (!parsed.success) throw new ReviewInputError(parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; "));
  return parsed.data;
}

const routeKey = (item: { location: Diagnostic["location"] }) => {
  const location = item.location;
  return location.kind === "route" ? `route:${location.route}:${location.viewport}` : location.kind === "page" ? `page:${location.page}` : location.kind === "slide" ? `slide:${location.slide}` : "artifact";
};

/**
 * Targeted re-verification of exactly these findings on a new revision:
 * - measured findings: the same check at the same place no longer fails, and
 *   the check did run there (otherwise not_checked, never resolved);
 * - model findings: a targeted re-check (same reviewer contract, restricted to
 *   these findings) no longer reports them; without one they stay not_checked.
 */
export function reverifyFindings(findings: readonly Finding[], diagnostics: readonly Diagnostic[], recheck: ModelReview | null): Verification[] {
  return findings.map((finding): Verification => {
    if (finding.verificationMethod.type === "deterministic" && finding.source === "deterministic") {
      const check = finding.verificationMethod.checkId, place = routeKey(finding);
      const selector = finding.location.kind === "route" ? finding.location.selector : null;
      const ran = diagnostics.filter(item => item.check === check && (place === "artifact" || routeKey(item) === place || (finding.location.kind === "page" && item.location.kind === "artifact")));
      if (!ran.length || ran.every(item => item.status === "not_checked")) return { id: finding.id, status: "not_checked", measured: `${check} did not run at ${place}` };
      const still = ran.find(item => item.status === "failed" && (place === "artifact" || finding.location.kind !== "route" || !selector || (item.location.kind === "route" && item.location.selector === selector)
        || (finding.evidence.type === "measured" && item.measured === finding.evidence.value)));
      return still ? { id: finding.id, status: "unresolved", measured: still.measured } : { id: finding.id, status: "resolved", measured: ran.find(item => item.status === "passed")?.measured ?? `${check} passes` };
    }
    if (!recheck) return { id: finding.id, status: "not_checked", measured: "no visual re-check was available" };
    const again = recheck.findings.find(item => item.id === finding.id || (JSON.stringify(item.location) === JSON.stringify(finding.location) && item.category === finding.category));
    return again ? { id: finding.id, status: "unresolved", measured: `still reported: ${again.proposedRepair.slice(0, 200)}` } : { id: finding.id, status: "resolved", measured: "not reported by the targeted re-check" };
  });
}
