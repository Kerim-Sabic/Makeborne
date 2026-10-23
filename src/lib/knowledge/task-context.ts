import { buildKnowledgeContext, snapshotItems, DEFAULT_BUDGET, type ContextBudget, type KnowledgeContext } from "./context";
import type { KnowledgeRetriever } from "./retrieval";
import { canonicalProposal, factPayload, type FactProposal } from "./types";
import type { ClaimFact } from "./claims";

/**
 * Knowledge for one task step: retrieve (bounded) -> build the context ->
 * record a snapshot of exactly what was used, with the operation. If anything
 * used changed between retrieval and snapshot (a new revision, a revoked
 * source), the database refuses the snapshot and this retrieves once more; a
 * second change ends with an error rather than a context nobody can explain.
 *
 * Integration: runAgencyTask (agency/run.ts) calls its `knowledge` dependency
 * once the step's run exists, for kinds whose policy needs facts, with the
 * task's actor, workspace and client (from the server-verified task scope,
 * never the browser) and the operation id; the context is added to the lead
 * prompt (or the lead's content) and `snapshotId` is stored in the step
 * detail. Builders that generate client copy call checkCopyClaims with
 * `claimFacts(context)` and the brief before saving (not wired into the
 * builder prompts yet; see the agency handoff).
 */
export type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
export type KnowledgeTaskInput = Readonly<{
  actorId: string; workspaceId: string; clientId: string | null; objective: string; purpose: string;
  operationId?: string | null; artifactId?: string | null; asOf?: string; includeProposed?: boolean; budget?: ContextBudget;
  /** false: a planning read only (nothing is given to a model from it), so no snapshot is recorded. The step that uses
   * the knowledge reads again with its operation id and records that snapshot. Default true. */
  record?: boolean;
}>;
export type KnowledgeForTask = Readonly<{ context: KnowledgeContext; snapshotId: string | null; epoch: number; asOf: string }>;
export class KnowledgeChanged extends Error { constructor() { super("Client knowledge changed while this task was preparing."); } }

const today = () => new Date().toISOString().slice(0, 10);
const empty = (asOf: string): KnowledgeForTask => Object.freeze({ context: buildKnowledgeContext([]), snapshotId: null, epoch: 0, asOf });

export async function knowledgeForTask(input: KnowledgeTaskInput, deps: { retriever: KnowledgeRetriever; rpc: Rpc; onError: (error: { code?: string; message?: string }) => never }): Promise<KnowledgeForTask> {
  const asOf = input.asOf ?? today();
  if (!input.clientId) return empty(asOf);
  const budget = input.budget ?? DEFAULT_BUDGET;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await deps.retriever.retrieve({ actorId: input.actorId, workspaceId: input.workspaceId, clientId: input.clientId, query: input.objective,
      asOf, limit: Math.min(100, Math.max(1, budget.maxItems * 2)), includeProposed: input.includeProposed ?? false });
    const context = buildKnowledgeContext(result.items, budget);
    if (!context.used.length || input.record === false) return Object.freeze({ context, snapshotId: null, epoch: result.epoch, asOf });
    const { data, error } = await deps.rpc("makeborne_knowledge_snapshot", { p_actor: input.actorId, p_workspace: input.workspaceId, p_client: input.clientId,
      p_operation: input.operationId ?? null, p_artifact: input.artifactId ?? null, p_purpose: input.purpose, p_query: input.objective.slice(0, 1000),
      p_as_of: asOf, p_items: snapshotItems(context), p_context_sha256: context.sha256 });
    if (error?.code === "PT409") continue;
    if (error) deps.onError(error);
    const snapshot = data as { id?: unknown; epoch?: unknown };
    if (typeof snapshot?.id !== "string") throw new KnowledgeChanged();
    return Object.freeze({ context, snapshotId: snapshot.id, epoch: typeof snapshot.epoch === "number" ? snapshot.epoch : result.epoch, asOf });
  }
  throw new KnowledgeChanged();
}

/** The facts a claims check may consult: exactly those the task was given. */
export function claimFacts(context: KnowledgeContext): ClaimFact[] {
  return context.used.map(fact => ({ id: fact.id, key: fact.key, kind: fact.kind, trust: fact.trust, valueText: fact.valueText, label: fact.label, currency: fact.currency ?? null, pending: fact.pending }));
}

export type ProposalOutcome = Readonly<{ proposed: number; deduplicated: number; invalid: number; stopped: string | null; ids: readonly string[] }>;
/**
 * Stores a task's suggestions as PROPOSALS bound to its operation. The actor's
 * role is re-checked by the database on every call: if they were demoted or
 * removed during the run, the first refusal stops the rest (nothing partial is
 * retried under someone else's authority). Invalid suggestions are skipped.
 */
export async function proposeFromTask(input: { actorId: string; workspaceId: string; clientId: string; operationId: string; suggestions: readonly FactProposal[] }, rpc: Rpc, max = 200): Promise<ProposalOutcome> {
  let proposed = 0, deduplicated = 0, invalid = 0, stopped: string | null = null;
  const ids: string[] = [];
  for (const suggestion of input.suggestions.slice(0, max)) {
    let payload;
    try {
      const canonical = canonicalProposal(suggestion);
      if (canonical.kind === "user_decision" || canonical.evidence.some(item => item.kind === "user")) { invalid++; continue; }
      payload = factPayload(canonical);
    } catch { invalid++; continue; }
    const { data, error } = await rpc("makeborne_knowledge_propose", { p_actor: input.actorId, p_workspace: input.workspaceId, p_client: input.clientId,
      p_fact: payload.fact, p_evidence: payload.evidence, p_operation: input.operationId });
    if (error) {
      if (error.code === "42501" || error.code === "P0002") { stopped = error.code === "42501" ? "PERMISSION_CHANGED" : "CLIENT_UNAVAILABLE"; break; }
      invalid++; continue;
    }
    const fact = data as { id: string; deduplicated?: boolean };
    ids.push(fact.id);
    if (fact.deduplicated) deduplicated++; else proposed++;
  }
  return Object.freeze({ proposed, deduplicated, invalid, stopped, ids: Object.freeze(ids) });
}
