import { createHash } from "node:crypto";
import { canonicalSourceJson } from "../projects/canonical-json";
import type { KnowledgeContext } from "../knowledge/context";
import { runAgencyTask, type AgencyRunDeps, type AgencyRunOutcome } from "../agency/run";
import type { AgencyTask } from "../agency/task";
import { ModelBriefSchema, ResearchBriefSchema, type ParsedModelBrief, type ResearchBrief, type ResearchRequest } from "./contract";
import type { ResearchCache } from "./cache";
import { deterministicBrief } from "./deterministic";
import { RESEARCH_SYSTEM, buildMaterial, modelContent, type Material, type SuppliedDocument } from "./material";
import { researchSearch } from "./search";
import { boundedLimits, normalizeUrl, readClientSite, type FetchDeps, type ResearchLimits } from "./site";
import { groundBrief } from "./validate";

/**
 * One "Understand this client" request:
 * 1. a repeated action key returns the stored brief (no reads, no call, no charge);
 * 2. read first: approved knowledge for this client (bounded, snapshotted) and the
 *    supplied documents and notes;
 * 3. read the client's own site only as far as needed (the home page always —
 *    strengths and shortcomings change — more pages only when saved knowledge and
 *    documents don't already describe the offering) and the competitor links the
 *    person supplied, inside the page/byte/time budget, through the tenant cache;
 * 4. search is asked for nothing it can't give: the seam is refused (see search.ts);
 * 5. write the brief: with an assisted (qualified) setting, one bounded lead step on
 *    the stage 1 operation with the material as untrusted content and no tools;
 *    otherwise deterministically. Either way the server grounds it (validate.ts);
 * 6. store it under the action key. Nothing is proposed, planned or sent here.
 */
export type KnowledgeRead = { context: KnowledgeContext; snapshotId: string | null } | null;
export type StoredBriefRow = { id: string; brief: ResearchBrief; method: ResearchBrief["method"]; operationId: string | null; artifactId: string | null; replayed: boolean; createdAt: string };
export type BriefStore = {
  read(actionKey: string): Promise<(StoredBriefRow & { requestSha256?: string }) | null>;
  save(row: { actionKey: string; artifactId: string | null; operationId: string | null; requestSha256: string; method: ResearchBrief["method"]; brief: ResearchBrief }): Promise<StoredBriefRow>;
};
export type ResearchDeps = Readonly<{
  cache: ResearchCache; fetch?: FetchDeps; limits?: Partial<ResearchLimits>; now?: () => number;
  /** Approved knowledge, read before anything is fetched (null when knowledge is off or the client has none). */
  knowledge: (objective: string, operationId: string | null) => Promise<KnowledgeRead>;
  /** Supplied documents, extracted by the ingestion pipeline (unreadable ones are reported, never guessed). */
  documents: () => Promise<{ documents: SuppliedDocument[]; unreadable: { name: string; detail: string }[] }>;
  briefs: BriefStore;
  /** Present only when an assisted setting is qualified for research and agency tasks are on. */
  assisted: null | Readonly<{ task: AgencyTask; deps: Omit<AgencyRunDeps, "specialists" | "tools"> }>;
}>;
export type ResearchOutcome = Readonly<{ row: StoredBriefRow; run: AgencyRunOutcome | null; fetches: number }>;
export class ResearchError extends Error { constructor(readonly code: string, message: string, readonly status = 409) { super(message); } }

export function requestDigest(request: ResearchRequest, client: { id: string }) {
  return createHash("sha256").update(canonicalSourceJson({ client: client.id, url: normalizeUrl(request.url), artifactId: request.artifactId,
    competitors: request.competitorUrls.map(url => { try { return normalizeUrl(url); } catch { return url; } }),
    documents: request.documents.map(item => ({ assetId: item.reference.assetId, sha256: item.reference.sha256 })),
    notes: createHash("sha256").update(request.notes.trim()).digest("hex"), settings: request.settings, ceiling: request.ceilingCredits })).digest("hex");
}

const OFFERING_KEY = /^(offering|services?|products?|menu)([._]|$)/;
export function researchObjective(client: { name: string; company: string }, url: string) {
  return `Understand ${client.company || client.name} (${url}) for agency work: what they offer and to whom (evidence only), how they present themselves, their website's strengths and shortcomings, competitors from the supplied links, open questions, and the best first deliverable with a business reason.`;
}

export async function runClientResearch(input: { request: ResearchRequest; client: Material["client"] }, deps: ResearchDeps): Promise<ResearchOutcome> {
  const { request } = input;
  const requestSha256 = requestDigest(request, input.client);
  const existing = await deps.briefs.read(request.actionKey);
  if (existing) {
    if (existing.requestSha256 && existing.requestSha256 !== requestSha256) throw new ResearchError("RESEARCH_KEY_REUSED", "This research request was already used for different details. Start a new one.");
    return { row: { ...existing, replayed: true }, run: null, fetches: 0 };
  }
  const now = deps.now ?? Date.now;
  const started = now();
  let url: string;
  try { url = normalizeUrl(request.url); } catch { throw new ResearchError("RESEARCH_URL_INVALID", "Enter the client's website address, for example https://example.com.", 400); }
  const client = { ...input.client, url };
  const objective = researchObjective(client, url);

  // 1. Read first: what is already known and what the person supplied.
  const knowledge = await deps.knowledge(objective, null);
  const { documents, unreadable } = await deps.documents();
  const notesWords = request.notes.trim() ? request.notes.trim().split(/\s+/).length : 0;
  const documentWords = documents.reduce((sum, item) => sum + item.record.text.split(/\s+/).length, 0);
  const offeringKnown = (knowledge?.context.used ?? []).some(fact => fact.trust === "approved" && OFFERING_KEY.test(fact.key));
  const readSubpages = !(offeringKnown && documentWords + notesWords >= 300);
  const limits = boundedLimits(deps.limits);
  const search = researchSearch({ purpose: "competitors", query: `${client.company || client.name} competitors`, maxUses: 1 });
  const plan = [
    knowledge?.context.used.length ? `Read first: ${knowledge.context.used.length} saved fact${knowledge.context.used.length === 1 ? "" : "s"} about this client.` : "Read first: no approved facts are saved for this client yet.",
    documents.length || notesWords ? `Read first: ${documents.length} supplied document${documents.length === 1 ? "" : "s"}${notesWords ? " and your notes" : ""}.` : "No documents or notes were supplied.",
    "Read their home page: website strengths and shortcomings change over time.",
    readSubpages ? `Read up to ${Math.max(0, limits.maxPages - 1 - request.competitorUrls.length)} more pages of their own site to find what they offer.` : "Did not read more of their site: saved facts and your documents already describe what they offer.",
    request.competitorUrls.length ? `Competitors: read the ${request.competitorUrls.length} link${request.competitorUrls.length === 1 ? "" : "s"} you supplied (home page only).` : "Competitors: none supplied.",
    search.reason,
    `Limits for this request: ${limits.maxPages} pages, ${Math.round(limits.maxBytes / 1000)} KB, ${Math.round(limits.timeMs / 1000)} seconds.`,
  ];

  // 2. The client's own site and the supplied competitor pages, bounded and cached.
  const site = await readClientSite({ url, competitors: request.competitorUrls, readSubpages, limits, cache: deps.cache, deps: deps.fetch, now });
  const material = buildMaterial({ client, site, documents, unreadable, notes: request.notes, knowledge, plan });
  const meta = () => ({ generatedAt: new Date(now()).toISOString(), limits: { pages: limits.maxPages, bytes: limits.maxBytes, ms: limits.timeMs, pagesRead: site.pagesRead, bytesRead: site.bytesRead, elapsedMs: now() - started } });

  // 3. Write and ground the brief.
  let brief: ResearchBrief, run: AgencyRunOutcome | null = null, operationId: string | null = null;
  if (deps.assisted) {
    const { task } = deps.assisted;
    run = await runAgencyTask<ParsedModelBrief>(task, {
      system: RESEARCH_SYSTEM, result: ModelBriefSchema,
      resultDescription: "Submit the research brief. Facts cite source ids with word-for-word quotes; everything else is an inference or a question.",
      content: modelContent(material),
      // Stored on the run: the grounded brief, never the raw answer.
      finalize: answer => groundBrief(answer, material, { method: "assisted", ...meta() }),
    }, { ...deps.assisted.deps, tools: {}, specialists: [] });
    operationId = run.status?.operation.id ?? null;
    const stored = run.outcome === "result" ? ResearchBriefSchema.safeParse(run.status?.result?.data) : null;
    if (!stored?.success) throw new ResearchError(run.code === "AGENCY_SETTINGS_UNQUALIFIED" ? "RESEARCH_UNAVAILABLE" : "RESEARCH_INCOMPLETE",
      run.outcome === "result" ? "The research result couldn't be checked. You were not charged for it." : run.message, run.outcome === "failed" ? 502 : 409);
    brief = stored.data;
  } else {
    brief = groundBrief(deterministicBrief(material), material, { method: "deterministic", ...meta() });
  }
  const row = await deps.briefs.save({ actionKey: request.actionKey, artifactId: request.artifactId, operationId, requestSha256, method: brief.method, brief });
  return { row, run, fetches: site.fetches };
}
