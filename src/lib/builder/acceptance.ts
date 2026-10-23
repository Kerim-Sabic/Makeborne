/**
 * The acceptance contract (docs/release-review/acceptance-contracts-20261022.md on feature/editor-quality, contract
 * version acceptance-v1) as the routing policy uses it: which check ids a stage must pass, and what the builder loop
 * can actually establish for them before a version is saved. Pure and client-safe.
 *
 * Rules from the contract: results are passed, failed or not_checked; no single score; a design or preference result
 * never offsets a failed hard check; a missing capture or an unrun check is not a pass. The in-loop evidence below is
 * deliberately narrow (it is what runBuilder's finish gates verify); full coverage of each id needs the site verifier,
 * the eval instruments or a person, and is recorded as such ("coverage").
 */
export const ACCEPTANCE_CONTRACT = "acceptance-v1";
export type CheckId = "W-H1" | "W-H2" | "W-H3" | "W-H4" | "W-H5" | "W-H6" | "W-H7" | "W-H8" | "W-D1" | "W-D2" | "W-D3" | "W-D4" | "W-O1"
  | "B-H1" | "B-H2" | "B-H3" | "B-H4" | "B-D1" | "B-D2" | "S-H1" | "S-H2" | "S-H3" | "S-H4" | "S-H5" | "S-D1" | "S-D2" | "S-D3" | "O1" | "O2" | "O3" | "O4" | "O5";
export type CheckStatus = "passed" | "failed" | "not_checked";
export type CheckResult = { id: CheckId; status: CheckStatus; coverage: string };
export type RequiredChecks = { contract: typeof ACCEPTANCE_CONTRACT; ids: CheckId[] };
export const isHard = (id: CheckId) => /-H\d$/.test(id);

/** Checks a website stage must pass before the router may accept it (the ones the builder loop can establish). */
export const WEBSITE_STAGE_CHECKS: readonly CheckId[] = Object.freeze(["W-H1", "W-H4", "W-H5", "W-H6", "W-D1", "W-D2"]);
export const DOCUMENT_STAGE_CHECKS: Readonly<Record<"book" | "deck", readonly CheckId[]>> = Object.freeze({ book: ["B-H1"], deck: ["S-H1", "S-H4"] });
export const required = (ids: readonly CheckId[]): RequiredChecks => ({ contract: ACCEPTANCE_CONTRACT, ids: [...ids] });
/** The required checks the builder loop itself can establish (the rest are recorded as deferred, never as passed). */
export function inLoop(ids: readonly string[]): CheckId[] {
  const establishable = new Set<string>([...WEBSITE_STAGE_CHECKS, ...DOCUMENT_STAGE_CHECKS.book, ...DOCUMENT_STAGE_CHECKS.deck]);
  return ids.filter((id): id is CheckId => establishable.has(id));
}

/** Which check a finish-gate message is evidence against (heuristic, by the gate's own wording). */
export function checkForProblem(problem: string): CheckId {
  if (/does not compile|compile|syntax|cannot find module|import/i.test(problem)) return "W-H1";
  if (/contrast/i.test(problem)) return "W-D2";
  if (/cut off|overflow|sideways|360/i.test(problem)) return "W-D1";
  if (/missing (?:a |the )?section|brief lists|must-have|required section/i.test(problem)) return "W-H6";
  if (/tool call.* failed|not applied/i.test(problem)) return "W-H4";
  return "W-H5";
}

/** In-loop evidence for a website stage from the builder's result and the finish-gate problems it saw. */
export function websiteEvidence(input: { finished: boolean; build: "passed" | "unverified" | null; contrast: "passed" | "failed" | "not_checked" | null; problems: readonly string[]; waived?: readonly string[] }, ids: readonly CheckId[] = WEBSITE_STAGE_CHECKS): CheckResult[] {
  const failed = new Set<CheckId>(input.finished ? (input.waived ?? []).map(checkForProblem) : input.problems.map(checkForProblem));
  // A contrast failure accepted on repeat (the gate blocks each pair once) is still a failed check.
  if (input.contrast === "failed") failed.add("W-D2");
  return ids.map(id => {
    if (failed.has(id)) return { id, status: "failed", coverage: "finish gates" };
    if (!input.finished) return { id, status: "not_checked", coverage: "the stage ended before its finish checks passed" };
    if (id === "W-H1") return input.build === "passed" ? { id, status: "passed", coverage: "compile and static project checks only" } : { id, status: "not_checked", coverage: "the build check could not run" };
    if (id === "W-D2") return input.contrast === "passed" ? { id, status: "passed", coverage: "rendered text contrast at finish" } : { id, status: "not_checked", coverage: "no browser for the contrast check" };
    // Only what the finish gates establish counts; anything else is the site verifier's to check.
    if (!WEBSITE_STAGE_CHECKS.includes(id)) return { id, status: "not_checked", coverage: "not established in the builder loop (site verifier)" };
    return { id, status: "passed", coverage: "finish gates" };
  });
}
/** In-loop evidence for a document stage: the editor's own validation at finish. */
export function documentEvidence(finished: boolean, ids: readonly CheckId[]): CheckResult[] {
  return ids.map(id => finished ? { id, status: "passed", coverage: "document editor validation at finish" } : { id, status: "failed", coverage: "the stage did not pass its finish checks" });
}

/** Accepted only when every required check passed. A failed hard check is never offset; not_checked is not a pass. */
export function accepted(results: readonly CheckResult[]): boolean {
  return results.length > 0 && results.every(result => result.status === "passed");
}
export const failedIds = (results: readonly CheckResult[]) => results.filter(result => result.status === "failed").map(result => result.id);
export const uncheckedIds = (results: readonly CheckResult[]) => results.filter(result => result.status === "not_checked").map(result => result.id);
