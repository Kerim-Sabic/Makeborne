import { citationId, type KnowledgeContext } from "../knowledge/context";
import { judgeCopyClaims, type ClaimFact, type JudgedClaim } from "../knowledge/claims";
import type { ApprovedFacts, Brief, ClaimCheckResult, ClaimKind, ClaimsCheck } from "./contract";
import { NO_APPROVED_FACTS } from "./brief";

/**
 * The reviewer's "approved facts + claims check", backed by the real client
 * knowledge module (stage 3):
 * - approved facts are the client's APPROVED, non-inference facts from one
 *   bounded knowledge context (the same context whose snapshot is recorded with
 *   the review's operation), each identified by its stable citation id
 *   [K-<8 hex>-r<revision>] so findings can cite them;
 * - the claims check is knowledge/claims.ts (prices, times, figures, phones,
 *   emails, status words), with the approved brief as the only other support.
 *   Unapproved and unsupported values are not supported; a disputed approved
 *   value is supported (the approved value stands until someone reviews it).
 * Without knowledge (switch off or a project with no client) the review keeps
 * NO_APPROVED_FACTS and claims are reported as not checked.
 */
export type ReviewKnowledge = Readonly<{ facts: ApprovedFacts; claimFacts: readonly ClaimFact[]; contextSha256: string | null }>;

const SNAPSHOT_ID = /^[A-Za-z0-9:_-]{1,64}$/;
export function reviewKnowledge(knowledge: { context: KnowledgeContext; snapshotId: string | null } | null): ReviewKnowledge | null {
  if (!knowledge) return null;
  const used = knowledge.context.used.filter(fact => fact.trust === "approved" && fact.kind !== "inference");
  // A recorded snapshot names itself; a planning read (snapshot recorded later, with the operation) is named by its context digest.
  const snapshotId = knowledge.snapshotId && SNAPSHOT_ID.test(knowledge.snapshotId) ? knowledge.snapshotId
    : knowledge.context.used.length ? `ctx-${knowledge.context.sha256.slice(0, 40)}` : "knowledge-none";
  const facts: ApprovedFacts = {
    snapshotId,
    facts: used.slice(0, 200).map(fact => {
      const source = fact.evidence[0];
      const value = fact.valueText.trim().slice(0, 120);
      return {
        id: citationId(fact), statement: `${(fact.label || fact.key.replace(/[._]/g, " ")).trim()}: ${fact.valueText}${fact.currency && !fact.valueText.includes(fact.currency) ? ` ${fact.currency}` : ""}`.slice(0, 500),
        ...(value ? { value } : {}),
        ...(source ? { source: [source.title, source.kind].filter(Boolean).join(" · ").slice(0, 200) } : {}),
      };
    }),
  };
  const claimFacts: ClaimFact[] = used.map(fact => ({ id: citationId(fact), key: fact.key, kind: fact.kind, trust: fact.trust, valueText: fact.valueText, label: fact.label,
    currency: fact.currency ?? null, pending: fact.pending }));
  return Object.freeze({ facts, claimFacts: Object.freeze(claimFacts), contextSha256: knowledge.context.used.length ? knowledge.context.sha256 : null });
}

/** The brief as support text: the summary and every approved requirement. */
export const briefSupport = (brief: Brief) => [brief.summary, ...brief.requirements.map(item => item.text)].join("\n");

function kindOf(claim: JudgedClaim): ClaimKind {
  if (claim.type === "figure") return /%/.test(claim.text) ? "percentage" : /^(19|20)\d{2}$/.test(claim.text.trim()) ? "year" : "quantity";
  return claim.type;
}

/**
 * A ClaimsCheck over the knowledge module's checker. Only facts that are in the
 * review's own ApprovedFacts count (a finding cannot be supported by a fact the
 * reviewer was not given).
 */
export function knowledgeClaimsCheck(knowledge: ReviewKnowledge, brief: Brief): ClaimsCheck {
  const support = briefSupport(brief);
  return (text: string, facts: ApprovedFacts): readonly ClaimCheckResult[] => {
    const allowed = new Set(facts.facts.map(fact => fact.id));
    const usable = knowledge.claimFacts.filter(fact => allowed.has(fact.id));
    return judgeCopyClaims(text, usable, support).map(claim => Object.freeze({
      text: claim.text.slice(0, 200), kind: kindOf(claim),
      supported: claim.status === "supported" || claim.status === "disputed",
      factId: claim.status === "supported" || claim.status === "disputed" ? claim.factIds[0] ?? null : null,
    }));
  };
}

/** Facts and checker for a review request: the knowledge-backed pair, or no facts (claims not checked) without knowledge. */
export function reviewFactsAndClaims(knowledge: ReviewKnowledge | null, brief: Brief, fallback: ClaimsCheck): { facts: ApprovedFacts; factsForChecks: ApprovedFacts | null; claims: ClaimsCheck } {
  if (!knowledge) return { facts: NO_APPROVED_FACTS, factsForChecks: null, claims: fallback };
  return { facts: knowledge.facts, factsForChecks: knowledge.facts, claims: knowledgeClaimsCheck(knowledge, brief) };
}
