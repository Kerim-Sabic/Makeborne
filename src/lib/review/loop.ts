import type { RunSpend } from "../ai/run-spend";
import { childSpend } from "../agency/specialist";
import { sameSubject, type Finding, type ReviewResult, type ReviewSubject } from "./contract";
import type { GuardResult } from "./guard";
import { repairable } from "./validate";

/**
 * Bounded review → repair → targeted re-verification.
 * - Acceptable work is left alone: no blocker/major (measured or grounded) →
 *   complete, and the repair path is never called (nits never trigger it).
 * - The repair (the lead builder's existing repair path) receives only the
 *   repairable findings, with instructions to change nothing else.
 * - A diff guard checks that the repair touched only those locations and kept
 *   the brand identity; otherwise the round is rejected.
 * - Re-verification checks exactly those findings on the new revision; new
 *   observations there cannot start another repair (no redesign spiral).
 * - Default 1 repair round, at most 2. Every review and re-verification
 *   spends through a child of the step's RunSpend (stage 1 specialist
 *   allowance), so the loop cannot exceed what the operation has left.
 * - A review is applied only to the revision it reviewed: if the project
 *   changed, the review is stale and refused.
 * - It never reports complete with a known unresolved blocker or major:
 *   the outcome is incomplete with the findings attached.
 */
export type Verification = Readonly<{ id: string; status: "resolved" | "unresolved" | "not_checked"; measured: string }>;
export type LoopPorts = Readonly<{
  review(subject: ReviewSubject, spend: RunSpend | null): Promise<ReviewResult>;
  repair(input: { subject: ReviewSubject; findings: readonly Finding[]; instructions: string }): Promise<{ ok: true; subject: ReviewSubject } | { ok: false; code: string }>;
  reverify(input: { subject: ReviewSubject; findings: readonly Finding[]; spend: RunSpend | null }): Promise<readonly Verification[]>;
  guard(input: { before: ReviewSubject; after: ReviewSubject; findings: readonly Finding[] }): Promise<GuardResult>;
  /** The artifact's current revision, read fresh each time. */
  current(): Promise<ReviewSubject>;
}>;
export type LoopOptions = Readonly<{ subject: ReviewSubject; maxRepairRounds?: number; spend?: RunSpend; roundCapMicrousd?: number; minRoundMicrousd?: number }>;
export type StoppedBy = "acceptable" | "verified" | "max_rounds" | "allowance" | "stale" | "repair_failed" | "guard" | "unavailable";
export type RoundRecord = { round: number; repaired: string[]; before: ReviewSubject; after: ReviewSubject | null; guard: GuardResult | null; verification: Verification[] };
export type LoopResult = Readonly<{
  outcome: "complete" | "incomplete" | "review_unavailable"; stoppedBy: StoppedBy; code?: string;
  review: ReviewResult; rounds: RoundRecord[]; unresolved: Finding[]; subject: ReviewSubject; message: string;
}>;

export class ReviewStaleError extends Error {
  readonly code = "REVIEW_STALE";
  constructor() { super("The project changed after this review. Review the current version before applying fixes."); }
}
/** Refuses to apply a review to any revision other than the one it reviewed. */
export function assertReviewCurrent(result: Pick<ReviewResult, "subject">, current: ReviewSubject) {
  if (!sameSubject(result.subject, current)) throw new ReviewStaleError();
}

export const MAX_REPAIR_ROUNDS = 2;
export function repairInstructions(findings: readonly Finding[]): string {
  return [
    "Fix only these reviewed problems. Change nothing outside the named locations: keep the palette, typefaces, logo, structure and all other copy exactly as they are. Do not redesign.",
    ...findings.map((finding, index) => `${index + 1}. [${finding.severity}] ${describeLocation(finding)}: ${finding.evidence.type === "measured" ? finding.evidence.value : finding.evidence.type === "quote" ? `"${finding.evidence.text}"` : `see image ${finding.evidence.imageId}`}. Repair: ${finding.proposedRepair}`),
  ].join("\n");
}
export function describeLocation(finding: Pick<Finding, "location">): string {
  const location = finding.location;
  if (location.kind === "route") return `${location.route} (${location.viewport})${location.selector ? ` ${location.selector}` : ""}`;
  if (location.kind === "page") return `page ${location.page}${location.chapterId ? ` (chapter ${location.chapterId})` : ""}`;
  if (location.kind === "slide") return `slide ${location.slide}`;
  return "the whole document";
}

const MESSAGES: Record<StoppedBy, string> = {
  acceptable: "Reviewed. No material problems were found, so nothing was changed.",
  verified: "Reviewed and repaired. Each reported problem was checked again and is fixed.",
  max_rounds: "Some reported problems are still present after the allowed repair attempts. They are listed for you to review.",
  allowance: "The review reached this task's credit limit before every problem was fixed. The remaining problems are listed.",
  stale: "The project changed after this review, so its fixes were not applied. Review the current version.",
  repair_failed: "The repair could not be completed. The reported problems are still listed.",
  guard: "A repair changed more than the reported problems, so it was not accepted. The problems are still listed.",
  unavailable: "The visual review was not available, so this work is not marked as reviewed. Automatic check results are listed.",
};

export async function runReviewRepairLoop(ports: LoopPorts, options: LoopOptions): Promise<LoopResult> {
  const maxRounds = Math.max(0, Math.min(MAX_REPAIR_ROUNDS, Math.floor(options.maxRepairRounds ?? 1)));
  const minRound = options.minRoundMicrousd ?? 1;
  const child = () => {
    if (!options.spend) return null;
    return childSpend(options.spend, Math.min(options.roundCapMicrousd ?? options.spend.remainingMicrousd, options.spend.remainingMicrousd));
  };
  const finish = (outcome: LoopResult["outcome"], stoppedBy: StoppedBy, rest: Omit<LoopResult, "outcome" | "stoppedBy" | "message">): LoopResult =>
    Object.freeze({ outcome, stoppedBy, message: MESSAGES[stoppedBy], ...rest });

  const review = await ports.review(options.subject, child());
  if (!sameSubject(review.subject, options.subject)) throw new Error("The review is not bound to the requested revision.");
  if (review.status === "review_unavailable") return finish("review_unavailable", "unavailable", { review, rounds: [], unresolved: review.findings.filter(repairable), subject: options.subject });
  let targets = review.findings.filter(repairable);
  if (!targets.length) return finish("complete", "acceptable", { review, rounds: [], unresolved: [], subject: options.subject });

  const rounds: RoundRecord[] = [];
  let subject = options.subject;
  for (let round = 1; round <= maxRounds; round++) {
    if (options.spend && options.spend.remainingMicrousd < minRound) return finish("incomplete", "allowance", { review, rounds, unresolved: targets, subject });
    const current = await ports.current();
    if (!sameSubject(current, subject)) return finish("incomplete", "stale", { code: "REVIEW_STALE", review, rounds, unresolved: targets, subject });
    const record: RoundRecord = { round, repaired: targets.map(item => item.id), before: subject, after: null, guard: null, verification: [] };
    rounds.push(record);
    const repaired = await ports.repair({ subject, findings: targets, instructions: repairInstructions(targets) });
    if (!repaired.ok) return finish("incomplete", "repair_failed", { code: repaired.code, review, rounds, unresolved: targets, subject });
    record.after = repaired.subject;
    record.guard = await ports.guard({ before: subject, after: repaired.subject, findings: targets });
    if (!record.guard.ok) return finish("incomplete", "guard", { code: "REPAIR_OUT_OF_SCOPE", review, rounds, unresolved: targets, subject: repaired.subject });
    subject = repaired.subject;
    if (options.spend && options.spend.remainingMicrousd < minRound) return finish("incomplete", "allowance", { review, rounds, unresolved: targets, subject });
    const checked = await ports.reverify({ subject, findings: targets, spend: child() });
    // Only the targeted findings count; anything else the check returns is ignored here.
    record.verification = targets.map(target => checked.find(item => item.id === target.id) ?? { id: target.id, status: "not_checked" as const, measured: "the re-check returned no result for this finding" });
    targets = targets.filter(target => record.verification.find(item => item.id === target.id)!.status !== "resolved");
    if (!targets.length) return finish("complete", "verified", { review, rounds, unresolved: [], subject });
  }
  return finish("incomplete", "max_rounds", { review, rounds, unresolved: targets, subject });
}
