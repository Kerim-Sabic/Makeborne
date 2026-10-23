import {
  ModelReviewSchema, REVIEW_SCHEMA, repairs, reviewRequestDigest,
  type ClaimsCheck, type Diagnostic, type Finding, type ModelFinding, type ModelReview, type ReviewRequest, type ReviewResult, type UnavailableReason,
} from "./contract";

/**
 * Server-side validation of the reviewer's answer.
 * - Refusal, truncation, a missing or malformed answer → review_unavailable
 *   (never "acceptable"); deterministic findings are still reported.
 * - A schema-valid answer is not a correct one: every model finding's evidence
 *   must resolve against what the reviewer was actually given, and every claim
 *   about the brief or facts must cite them exactly. Otherwise the finding is
 *   kept but marked "unverified": it is shown, never repaired, and never
 *   changes the status.
 * - Acceptable work stays acceptable: a whole-artifact model finding without a
 *   specific location is capped at minor (no redesign of work that passes).
 */
export type ReviewerReply = Readonly<{ stopReason: string | null; submitted?: unknown; text?: string }>;
export type Interpreted = { ok: true; review: ModelReview } | { ok: false; reason: UnavailableReason; detail: string };

export function interpretReply(reply: ReviewerReply): Interpreted {
  if (reply.stopReason === "refusal") return { ok: false, reason: "refusal", detail: "The reviewer declined to review this content." };
  if (reply.stopReason === "max_tokens" || reply.stopReason === "model_context_window_exceeded") return { ok: false, reason: "truncated", detail: "The review was cut off before it finished." };
  if (reply.submitted === undefined) return { ok: false, reason: "no_result", detail: "The reviewer did not return findings." };
  const parsed = ModelReviewSchema.safeParse(reply.submitted);
  if (!parsed.success) return { ok: false, reason: "malformed", detail: parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ").slice(0, 300) };
  return { ok: true, review: parsed.data };
}

const norm = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

/** Everything the reviewer could quote from the rendered output. */
export function artifactCorpus(request: ReviewRequest): string {
  const evidence = request.evidence;
  if (evidence.kind === "website") return norm(evidence.routes.map(route => route.text).join("\n"));
  if (evidence.kind === "book") return norm(evidence.chapters.map(chapter => `${chapter.title}\n${chapter.text}`).join("\n"));
  return norm(evidence.slides.map(slide => `${slide.title}\n${slide.text}\n${slide.notes ?? ""}`).join("\n"));
}

function locationIssue(finding: ModelFinding, request: ReviewRequest): string | null {
  const location = finding.location, evidence = request.evidence;
  if (location.kind === "artifact") return null;
  if (location.kind === "route") return evidence.kind === "website" && evidence.routes.some(route => route.path === location.route) ? null : `route ${location.route} was not reviewed`;
  if (location.kind === "page") return evidence.kind === "book" && evidence.pdf && location.page <= evidence.pdf.pageCount ? null : `page ${location.page} is not in the exported PDF`;
  return evidence.kind === "deck" && location.slide <= evidence.slides.length ? null : `slide ${location.slide} does not exist`;
}

function evidenceIssue(finding: ModelFinding, request: ReviewRequest, corpus: string): string | null {
  const evidence = finding.evidence;
  if (evidence.type === "measured") return request.diagnostics.some(item => item.id === evidence.diagnosticId) ? null : `no measurement ${evidence.diagnosticId} was supplied`;
  if (evidence.type === "crop") {
    const image = request.evidence.images.find(item => item.id === evidence.imageId);
    if (!image) return `image ${evidence.imageId} was not supplied`;
    return evidence.box.x + evidence.box.w <= image.width && evidence.box.y + evidence.box.h <= image.height ? null : "the crop lies outside the image";
  }
  const quote = norm(evidence.text);
  if (evidence.from === "artifact") return quoted(corpus, quote) ? null : "the quoted text does not appear in the reviewed output";
  if (evidence.from === "brief") return quoted(norm(`${request.brief.summary}\n${request.brief.requirements.map(item => item.text).join("\n")}`), quote) ? null : "the quote is not in the approved brief";
  return quoted(norm(request.facts.facts.map(fact => `${fact.statement} ${fact.value ?? ""}`).join("\n")), quote) ? null : "the quote is not in the approved facts";
}

/** Exact, or elided ("…" / "..."): every part (8+ characters) appears in the source, in order. */
function quoted(source: string, quote: string) {
  if (source.includes(quote)) return true;
  const parts = quote.split(/\s*(?:\.\.\.|…)\s*/).map(part => part.trim()).filter(Boolean);
  if (parts.length < 2 || parts.some(part => part.length < 8)) return false;
  let from = 0;
  for (const part of parts) { const at = source.indexOf(part, from); if (at < 0) return false; from = at + part.length; }
  return true;
}

/** Grounds each model finding against the request; never trusts the model's own claims about sources. */
export function groundFindings(review: ModelReview, request: ReviewRequest, claims: ClaimsCheck): Finding[] {
  const corpus = artifactCorpus(request);
  const seen = new Set<string>();
  return review.findings.map((finding): Finding => {
    const issues: string[] = [];
    const id = seen.has(finding.id) ? `${finding.id}-${seen.size}` : finding.id;
    seen.add(id);
    const location = locationIssue(finding, request);
    if (location) issues.push(location);
    const evidence = evidenceIssue(finding, request, corpus);
    if (evidence) issues.push(evidence);
    if (finding.briefRequirement) {
      const requirement = request.brief.requirements.find(item => item.id === finding.briefRequirement!.ref);
      if (!requirement) issues.push(`brief requirement ${finding.briefRequirement.ref} does not exist`);
      else if (!norm(requirement.text).includes(norm(finding.briefRequirement.quote))) issues.push("the brief quote does not match the requirement");
    }
    const unknownFacts = finding.factRefs.filter(ref => !request.facts.facts.some(fact => fact.id === ref));
    if (unknownFacts.length) issues.push(`unknown fact(s): ${unknownFacts.join(", ")}`);
    if (finding.category === "factual") {
      // A factual finding must cite the brief or approved facts, or be confirmed by the claims check on the quoted output.
      const quoted = finding.evidence.type === "quote" && finding.evidence.from === "artifact" ? finding.evidence.text : null;
      const checked = quoted ? claims(quoted, request.facts) : [];
      // Each claim in the quote is judged on its own: only the claims this finding disputes can make it unverified.
      // Disputed = the claims its repair names; otherwise, when it cites only the facts that support the quote's claims
      // (or cites nothing), every claim in the quote. A supported €49 beside a disputed "Sundays" is not disputed.
      const repair = norm(finding.proposedRepair);
      const named = checked.filter(result => repair.includes(norm(result.text)));
      const supporting = new Set(checked.flatMap(result => result.supported && result.factId ? [result.factId] : []));
      const cited = finding.factRefs.length > 0 || Boolean(finding.briefRequirement);
      const citesOnlySupporting = finding.factRefs.length > 0 && finding.factRefs.every(ref => supporting.has(ref));
      const disputed = named.length ? named : citesOnlySupporting || !cited ? checked : [];
      if (disputed.length && disputed.every(result => result.supported)) issues.push("the approved facts support this value");
      else if (!checked.some(result => !result.supported) && !cited) issues.push("a factual finding must cite approved facts or the brief");
    }
    let severity = finding.severity, note: string | undefined;
    if (finding.location.kind === "artifact" && !["export", "completeness", "factual"].includes(finding.category) && repairs(severity)) {
      severity = "minor"; note = "Not tied to a specific place: kept as a suggestion, not a repair.";
    }
    return { ...finding, id, severity, source: "model", grounding: issues.length ? "unverified" : "grounded", ...(issues.length ? { note: issues.join("; ").slice(0, 300) } : note ? { note } : {}) };
  });
}

/** Repairs only act on these: blocker/major, measured or grounded. */
export const repairable = (finding: Finding) => repairs(finding.severity) && finding.grounding !== "unverified";

const sameSpot = (a: Finding, b: Finding) => JSON.stringify(a.location) === JSON.stringify(b.location) && a.category === b.category;
/** The distinctive text of a measured finding: the values it quotes ("€59") and the files it names (/assets/missing.png). */
function signatures(measured: Finding): string[] {
  const value = measured.evidence.type === "measured" ? measured.evidence.value : measured.evidence.type === "quote" ? measured.evidence.text : "";
  return [...[...value.matchAll(/"([^"]{2,160})"/g)].map(match => match[1]), ...(value.match(/\/[\w./-]+\.[a-z0-9]{2,5}/gi) ?? [])].map(norm).filter(item => item.length >= 2);
}
/** Same place, same kind AND the same defect: the same measurement, or the model's quote or repair names what was measured. */
export function sameDefect(measured: Finding, finding: Finding) {
  if (!sameSpot(measured, finding)) return false;
  if (finding.evidence.type === "measured") return measured.evidence.type === "measured" && measured.evidence.diagnosticId === finding.evidence.diagnosticId;
  const text = norm(`${finding.evidence.type === "quote" ? finding.evidence.text : ""} ${finding.proposedRepair}`);
  return signatures(measured).some(signature => text.includes(signature));
}

export function buildResult(input: {
  request: ReviewRequest; deterministic: readonly Finding[]; model: Interpreted | { ok: false; reason: UnavailableReason; detail: string }; claims: ClaimsCheck;
}): ReviewResult {
  const { request } = input;
  const modelFindings = input.model.ok ? groundFindings(input.model.review, request, input.claims)
    // A model finding that describes the SAME defect as a measured one adds nothing; a different defect at that place stays.
    .filter(finding => !input.deterministic.some(measured => sameDefect(measured, finding))) : [];
  const findings = [...input.deterministic, ...modelFindings];
  const count = (status: Diagnostic["status"]) => request.diagnostics.filter(item => item.status === status).length;
  const status: ReviewResult["status"] = !input.model.ok ? "review_unavailable" : findings.some(repairable) ? "changes_needed" : "acceptable";
  return {
    schema: REVIEW_SCHEMA, subject: request.subject, requestDigest: reviewRequestDigest(request), status,
    ...(!input.model.ok ? { unavailableReason: input.model.reason } : {}),
    reviewer: input.model.ok ? "fresh_context" : "deterministic_only",
    findings, checks: { passed: count("passed"), failed: count("failed"), notChecked: count("not_checked") },
    coverage: request.coverage, coverageNotes: input.model.ok ? input.model.review.coverageNotes : [],
  };
}
