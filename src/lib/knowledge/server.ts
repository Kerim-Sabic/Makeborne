import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { billingDatabase } from "../billing/database";
import { RequestError } from "../server/http";
import { lexicalRetriever, type KnowledgeRetriever } from "./retrieval";
import { knowledgeForTask, proposeFromTask, type KnowledgeTaskInput, type Rpc } from "./task-context";
import { canonicalProposal, factPayload, type FactProposal } from "./types";
import { EVIDENCE_COLUMNS, FACT_COLUMNS, conflictMap, factView, type EvidenceRow, type FactRow, type KnowledgeList, type KnowledgeProvenance, type RevisionView } from "./views";

/**
 * Server side of client knowledge. Flag: MAKEBORNE_CLIENT_KNOWLEDGE=on (off by
 * default; checked on the server for every route). Reads use the signed-in
 * account's own database client, so row-level security decides what is
 * visible. Writes go through the service entry points with the authenticated
 * account as actor; the database checks that account's current role each time.
 */
export function clientKnowledgeEnabled(env: Record<string, string | undefined> = process.env) { return env.MAKEBORNE_CLIENT_KNOWLEDGE === "on"; }
export function requireClientKnowledge() {
  if (!clientKnowledgeEnabled()) throw new RequestError("KNOWLEDGE_DISABLED", "Client knowledge is not available yet.", 404);
}

/** Database messages that are safe to show as-is (written for customers in the migration). */
const SAFE_MESSAGES = new Set(["An observed fact needs a source", "A decision needs the person's statement", "A brand preference needs a source or a statement",
  "A generated artifact can only support an inference", "Only an approved fact with the same key can be replaced", "This fact's source was deleted",
  "This fact's source changed or was removed; review the source first", "An observed fact needs a live source", "Quote too long", "Invalid fact key"]);
export function knowledgeError(error: { code?: string; message?: string }): never {
  if (error.code === "KN409") throw new RequestError("KNOWLEDGE_CONFLICT", "Another approved fact says something different. Replace it or reject it first.", 409);
  if (error.code === "PT409") throw new RequestError("KNOWLEDGE_CHANGED", "This fact or its source changed. Reload it and review the latest version.", 409);
  if (error.code === "42501") throw new RequestError("ACCESS_DENIED", "You do not have permission to change this client's knowledge.", 403);
  if (error.code === "P0002") throw new RequestError("NOT_FOUND", "This record is unavailable in this workspace.", 404);
  if (error.code === "22023" || error.code === "22P02" || error.code === "23514") {
    const message = error.message && SAFE_MESSAGES.has(error.message) ? `${error.message}.` : "Some fields are missing or not valid for this client.";
    throw new RequestError("INVALID_KNOWLEDGE", message, 400);
  }
  if (error.code === "42P01" || error.code === "PGRST202" || error.code === "PGRST205") throw new RequestError("KNOWLEDGE_UNAVAILABLE", "Client knowledge is being set up. Try again soon.", 503);
  throw new RequestError("KNOWLEDGE_OUTCOME_UNKNOWN", "This change could not be confirmed. Reload before trying again.", 503);
}

function serviceRpc(): Rpc {
  const db = billingDatabase();
  return async (name, args) => { const { data, error } = await db.rpc(name, args); return { data, error }; };
}
export function knowledgeRetriever(rpc: Rpc = serviceRpc()): KnowledgeRetriever { return lexicalRetriever(rpc, knowledgeError); }

/** For agency tasks: bounded, cited, snapshotted knowledge (see task-context.ts for integration). */
export async function knowledgeForAgencyTask(input: KnowledgeTaskInput) {
  const rpc = serviceRpc();
  return knowledgeForTask(input, { retriever: knowledgeRetriever(rpc), rpc, onError: knowledgeError });
}
export async function proposeForAgencyTask(input: { actorId: string; workspaceId: string; clientId: string; operationId: string; suggestions: readonly FactProposal[] }) {
  return proposeFromTask(input, serviceRpc());
}

type Account = { client: SupabaseClient; userId: string; workspaceId: string; canEdit: boolean };

async function titlesFor(client: SupabaseClient, evidence: readonly EvidenceRow[]) {
  const titles = new Map<string, string>();
  const ids = (kind: string) => [...new Set(evidence.filter(item => item.kind === kind && item.ref_id).map(item => item.ref_id!))].slice(0, 500);
  const [sources, assets, briefs] = await Promise.all([
    ids("source").length ? client.from("sources").select("id,title").in("id", ids("source")) : Promise.resolve({ data: [], error: null }),
    ids("asset").length ? client.from("assets").select("id,object_path").in("id", ids("asset")) : Promise.resolve({ data: [], error: null }),
    ids("brief").length ? client.from("projects").select("id,title").in("id", ids("brief")) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const row of (sources.data ?? []) as { id: string; title: string }[]) titles.set(row.id, row.title);
  for (const row of (assets.data ?? []) as { id: string; object_path: string }[]) titles.set(row.id, decodeURIComponent(row.object_path.split("/").pop() ?? "Uploaded file"));
  for (const row of (briefs.data ?? []) as { id: string; title: string }[]) titles.set(row.id, `Brief: ${row.title}`);
  return titles;
}

export async function listClientKnowledge(account: Account, clientId: string, filter: { status?: string; kind?: string; q?: string }): Promise<KnowledgeList> {
  const found = await account.client.from("clients").select("id").eq("workspace_id", account.workspaceId).eq("id", clientId).maybeSingle();
  if (found.error) knowledgeError(found.error);
  if (!found.data) throw new RequestError("NOT_FOUND", "This client is unavailable in this workspace.", 404);
  const LIMIT = 500;
  const facts = await account.client.from("client_facts").select(FACT_COLUMNS).eq("workspace_id", account.workspaceId).eq("client_id", clientId)
    .order("updated_at", { ascending: false }).limit(LIMIT + 1);
  if (facts.error) knowledgeError(facts.error);
  const rows = ((facts.data ?? []) as unknown as FactRow[]).slice(0, LIMIT);
  const evidence = rows.length ? await account.client.from("client_fact_evidence").select(EVIDENCE_COLUMNS).eq("workspace_id", account.workspaceId).in("fact_id", rows.map(row => row.id)).order("created_at").limit(2000) : { data: [], error: null };
  if (evidence.error) knowledgeError(evidence.error);
  const evidenceRows = (evidence.data ?? []) as unknown as EvidenceRow[];
  const titles = await titlesFor(account.client, evidenceRows);
  const conflicts = conflictMap(rows);
  const q = filter.q?.trim().toLowerCase();
  const views = rows.filter(row => (!filter.status || row.status === filter.status) && (!filter.kind || row.kind === filter.kind)
    && (!q || `${row.key} ${row.label} ${row.value_text}`.toLowerCase().includes(q))).map(row => factView(row, evidenceRows, titles, conflicts));
  return Object.freeze({ enabled: true as const, canEdit: account.canEdit, facts: Object.freeze(views), truncated: (facts.data ?? []).length > LIMIT });
}

export async function factProvenance(account: Account, clientId: string, factId: string): Promise<KnowledgeProvenance> {
  const fact = await account.client.from("client_facts").select(FACT_COLUMNS).eq("workspace_id", account.workspaceId).eq("client_id", clientId).eq("id", factId).maybeSingle();
  if (fact.error) knowledgeError(fact.error);
  if (!fact.data) throw new RequestError("NOT_FOUND", "This fact is unavailable.", 404);
  const row = fact.data as unknown as FactRow;
  const [evidence, revisions, related] = await Promise.all([
    account.client.from("client_fact_evidence").select(EVIDENCE_COLUMNS).eq("workspace_id", account.workspaceId).eq("fact_id", factId).order("created_at").limit(200),
    account.client.from("client_fact_revisions").select("revision,action,status,value_text,redacted_at,note,actor,created_at").eq("workspace_id", account.workspaceId).eq("fact_id", factId).order("revision").limit(200),
    account.client.from("client_facts").select(FACT_COLUMNS).eq("workspace_id", account.workspaceId).eq("client_id", clientId).eq("key", row.key).limit(100),
  ]);
  for (const result of [evidence, revisions, related]) if (result.error) knowledgeError(result.error);
  const evidenceRows = (evidence.data ?? []) as unknown as EvidenceRow[];
  const titles = await titlesFor(account.client, evidenceRows);
  return Object.freeze({
    fact: factView(row, evidenceRows, titles, conflictMap((related.data ?? []) as unknown as FactRow[])),
    revisions: Object.freeze(((revisions.data ?? []) as { revision: number; action: string; status: string; value_text: string; redacted_at: string | null; note: string | null; actor: string; created_at: string }[])
      .map((item): RevisionView => ({ revision: item.revision, action: item.action, status: item.status, valueText: item.value_text, removed: !!item.redacted_at, note: item.note, createdAt: item.created_at, byYou: item.actor === account.userId }))),
  });
}

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await serviceRpc()(name, args);
  if (error) knowledgeError(error);
  return data as T;
}
export async function proposeClientFact(account: Account, clientId: string, input: unknown) {
  let proposal;
  try { proposal = canonicalProposal(input); }
  catch (error) { throw new RequestError("INVALID_KNOWLEDGE", error instanceof Error && !error.message.startsWith("[") ? error.message : "Some fields are missing or not valid for this client.", 400); }
  const { fact, evidence } = factPayload(proposal);
  return call<{ id: string; deduplicated: boolean }>("makeborne_knowledge_propose", { p_actor: account.userId, p_workspace: account.workspaceId, p_client: clientId, p_fact: fact, p_evidence: evidence, p_operation: null });
}
export async function reviewClientFact(account: Account, factId: string, action: "approve" | "reject", expectedRevision: number, note?: string) {
  return call("makeborne_knowledge_review", { p_actor: account.userId, p_workspace: account.workspaceId, p_fact: factId, p_expected_revision: expectedRevision, p_action: action, p_note: note ?? null });
}
export async function correctClientFact(account: Account, factId: string, expectedRevision: number, patch: Record<string, unknown>, note: string, approve: boolean) {
  return call("makeborne_knowledge_correct", { p_actor: account.userId, p_workspace: account.workspaceId, p_fact: factId, p_expected_revision: expectedRevision, p_patch: patch, p_note: note, p_approve: approve });
}
export async function revokeKnowledgeSource(account: Account, kind: "source" | "asset" | "url", ref: { id?: string; url?: string }) {
  return call<{ revokedEvidence: number }>("makeborne_knowledge_revoke_source", { p_actor: account.userId, p_workspace: account.workspaceId, p_kind: kind, p_ref: ref.id ?? null, p_url: ref.url ?? null });
}
