import { z } from "zod";
import { FACT_KINDS, FACT_STATUSES } from "./types";

/**
 * Retrieval: ordinary text match in Postgres (full-text 'simple' config over
 * key, label and value) on approved facts, plus optionally clearly labelled
 * unapproved observations that are not business truth. Embeddings are NOT used:
 * there is no retrieval evaluation showing they help. The seam for adding them
 * later is KnowledgeRetriever: a hybrid retriever can fuse a vector ranking
 * with the lexical candidates; every result still passes the database's
 * eligibility rules, the per-task bound and the snapshot check unchanged.
 */
const nullableString = z.string().nullable().optional();
export const RetrievedEvidenceSchema = z.object({
  id: z.string().uuid(), kind: z.string(), refId: z.string().uuid().nullable().optional(), projectId: z.string().uuid().nullable().optional(),
  sha256: nullableString, extractionVersion: nullableString, locator: z.record(z.string(), z.unknown()).default({}),
  quote: nullableString, url: nullableString, fetchedAt: nullableString, title: nullableString,
});
export const RetrievedFactSchema = z.object({
  id: z.string().uuid(), clientId: z.string().uuid(), kind: z.enum(FACT_KINDS), key: z.string(), label: z.string().default(""),
  value: z.unknown().optional(), valueText: z.string(), unit: nullableString, currency: nullableString,
  validFrom: nullableString, validTo: nullableString, observedAt: nullableString, status: z.enum(FACT_STATUSES),
  supersedesId: nullableString, conflictGroup: nullableString, uncertainty: nullableString, evidenceState: z.string(),
  revision: z.number().int().positive(), trust: z.enum(["approved", "unapproved"]), rank: z.number().default(0),
  pending: z.array(z.object({ id: z.string().uuid(), valueText: z.string(), observedAt: nullableString, replaces: z.boolean().nullable().optional() })).default([]),
  evidence: z.array(RetrievedEvidenceSchema).default([]),
}).passthrough();
export type RetrievedFact = z.infer<typeof RetrievedFactSchema>;
export const RetrievalResultSchema = z.object({ epoch: z.number().int().nonnegative(), asOf: z.string(), items: z.array(RetrievedFactSchema) });
export type RetrievalResult = z.infer<typeof RetrievalResultSchema>;

export type RetrievalRequest = Readonly<{
  actorId: string; workspaceId: string; clientId: string; query: string; asOf: string; limit: number; includeProposed: boolean;
}>;
export interface KnowledgeRetriever { retrieve(request: RetrievalRequest): Promise<RetrievalResult>; }

const STOP = new Set(["the", "and", "for", "with", "our", "your", "you", "are", "was", "this", "that", "from", "into", "about", "make", "build", "create", "website",
  "site", "page", "pages", "deck", "book", "slide", "slides", "please", "client", "their", "them", "they", "use", "using", "new", "all", "any", "can", "will",
  "should", "would", "what", "when", "where", "which", "who", "how", "not", "but", "have", "has", "had", "its", "it's", "a", "an", "of", "to", "in", "on", "at", "by", "is", "be", "or"]);
export const MAX_TERMS = 24;
/** Words of a task objective as safe prefix terms ([a-z0-9]{2,32}), lightly stemmed, at most 24. */
export function queryTerms(text: string): string[] {
  const words = text.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().split(/[^a-z0-9]+/);
  const out: string[] = [];
  for (const word of words) {
    if (word.length < 2 || word.length > 32 || STOP.has(word)) continue;
    // Terms are prefix matches, so "bakeries" -> "baker" finds "bakery" and "prices" -> "price" finds "price".
    const term = word.length > 4 && word.endsWith("ies") ? word.slice(0, -3) : word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
    if (term.length >= 2 && !out.includes(term)) out.push(term);
    if (out.length === MAX_TERMS) break;
  }
  return out;
}

/** The production retriever: one database call, all eligibility rules in SQL. */
export function lexicalRetriever(rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>,
  onError: (error: { code?: string; message?: string }) => never): KnowledgeRetriever {
  return {
    async retrieve(request) {
      const { data, error } = await rpc("makeborne_knowledge_retrieve", { p_actor: request.actorId, p_workspace: request.workspaceId, p_client: request.clientId,
        p_terms: queryTerms(request.query), p_as_of: request.asOf, p_limit: request.limit, p_include_proposed: request.includeProposed });
      if (error) onError(error);
      return RetrievalResultSchema.parse(data);
    },
  };
}

/**
 * A cache of derived knowledge (built contexts, summaries) keyed by the
 * client's knowledge epoch. Any change that can affect retrieval (a proposal,
 * approval, correction, or a source changed, revoked or deleted) moves the
 * epoch in the database, so an entry built at an older epoch is never served.
 */
export class EpochCache<T> {
  private entries = new Map<string, { epoch: number; value: T }>();
  constructor(private readonly limit = 200) {}
  get(key: string, epoch: number): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.epoch !== epoch) { this.entries.delete(key); return undefined; }
    return entry.value;
  }
  set(key: string, epoch: number, value: T) {
    this.entries.delete(key);
    this.entries.set(key, { epoch, value });
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value as string);
  }
  /** Drops every entry for a client (used when a revocation is observed directly). */
  invalidate(prefix: string) { for (const key of [...this.entries.keys()]) if (key.startsWith(prefix)) this.entries.delete(key); }
  get size() { return this.entries.size; }
}
