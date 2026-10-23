import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { billingDatabase } from "../billing/database";
import { RequestError } from "../server/http";
import { resolveSourceReference } from "../ingest/storage";
import { sourceIngestionEnabled } from "../ingest/builder-sources";
import { IngestBusyError, IngestCancelledError, extractSource } from "../ingest/worker-host";
import { clientKnowledgeEnabled, knowledgeForAgencyTask } from "../knowledge/server";
import { StoredPlanSchema } from "../builder/plan";
import { ResearchBriefSchema, type ResearchDocument } from "./contract";
import { rpcCache, type Rpc } from "./cache";
import type { SuppliedDocument } from "./material";
import type { BriefStore, KnowledgeRead, StoredBriefRow } from "./research";

/**
 * Server side of client research. Flag: MAKEBORNE_CLIENT_RESEARCH=on (off by
 * default; checked on every route). The cache and briefs are written through
 * service entry points with the authenticated account as actor; the database
 * re-checks that account's current role on every call.
 */
export function clientResearchEnabled(env: Record<string, string | undefined> = process.env) { return env.MAKEBORNE_CLIENT_RESEARCH === "on"; }
export function requireClientResearch() {
  if (!clientResearchEnabled()) throw new RequestError("RESEARCH_DISABLED", "Client research is not available yet.", 404);
}

export function researchError(error: { code?: string; message?: string }): never {
  if (error.code === "42501") throw new RequestError("ACCESS_DENIED", "You do not have permission to research this client.", 403);
  if (error.code === "P0002") throw new RequestError("NOT_FOUND", "This client is unavailable in this workspace.", 404);
  if (error.code === "PT409") throw new RequestError("RESEARCH_KEY_REUSED", "This research request was already used for different details. Start a new one.", 409);
  if (error.code === "42P01" || error.code === "PGRST202" || error.code === "PGRST205") throw new RequestError("RESEARCH_UNAVAILABLE", "Client research is being set up. Try again soon.", 503);
  throw new RequestError("RESEARCH_OUTCOME_UNKNOWN", "This research could not be confirmed. Reload before trying again.", 503);
}

export function serviceRpc(): Rpc {
  const db = billingDatabase();
  return async (name, args) => { const { data, error } = await db.rpc(name, args); return { data, error }; };
}
type Scope = { actorId: string; workspaceId: string; clientId: string };
export const researchCache = (scope: Scope, rpc: Rpc = serviceRpc()) => rpcCache(rpc, scope);

const RowSchema = z.object({ id: z.string().uuid(), artifactId: z.string().uuid().nullable(), operationId: z.string().uuid().nullable(), method: z.enum(["deterministic", "assisted"]),
  brief: ResearchBriefSchema, createdAt: z.string(), replayed: z.boolean() }).passthrough();
const toRow = (data: unknown): StoredBriefRow => {
  const parsed = RowSchema.safeParse(data);
  if (!parsed.success) throw new RequestError("RESEARCH_OUTCOME_UNKNOWN", "This research could not be read back. Reload before trying again.", 503);
  return { id: parsed.data.id, artifactId: parsed.data.artifactId, operationId: parsed.data.operationId, method: parsed.data.method, brief: parsed.data.brief, createdAt: parsed.data.createdAt, replayed: parsed.data.replayed };
};
export function briefStore(scope: Scope, rpc: Rpc = serviceRpc()): BriefStore {
  return {
    async read(actionKey) {
      const { data, error } = await rpc("makeborne_research_brief_read", { p_actor: scope.actorId, p_workspace: scope.workspaceId, p_client: scope.clientId, p_brief: null, p_action: actionKey });
      if (error) researchError(error);
      return data ? toRow(data) : null;
    },
    async save(row) {
      const { data, error } = await rpc("makeborne_research_brief_save", { p_actor: scope.actorId, p_workspace: scope.workspaceId, p_client: scope.clientId, p_artifact: row.artifactId,
        p_action: row.actionKey, p_operation: row.operationId, p_request_sha256: row.requestSha256, p_method: row.method, p_brief: row.brief });
      if (error) researchError(error);
      return toRow(data);
    },
  };
}
export async function readBrief(scope: Scope, briefId: string, rpc: Rpc = serviceRpc()): Promise<StoredBriefRow> {
  const { data, error } = await rpc("makeborne_research_brief_read", { p_actor: scope.actorId, p_workspace: scope.workspaceId, p_client: scope.clientId, p_brief: briefId, p_action: null });
  if (error) researchError(error);
  if (!data) throw new RequestError("NOT_FOUND", "This research brief is unavailable.", 404);
  return toRow(data);
}

/** Approved knowledge first (bounded, cited, snapshotted); nothing when knowledge is off. */
export function knowledgeReader(scope: Scope, artifactId: string | null) {
  return async (objective: string, operationId: string | null, options?: { record?: boolean }): Promise<KnowledgeRead> => {
    if (!clientKnowledgeEnabled()) return null;
    const result = await knowledgeForAgencyTask({ actorId: scope.actorId, workspaceId: scope.workspaceId, clientId: scope.clientId, objective, purpose: "client research",
      operationId, artifactId, record: options?.record });
    return { context: result.context, snapshotId: result.snapshotId };
  };
}

/** Supplied documents: stored uploads of the chosen client project, re-verified and extracted in the isolated worker. */
export function documentReader(client: SupabaseClient, scope: { workspaceId: string; projectId: string | null }, documents: readonly ResearchDocument[], signal?: AbortSignal) {
  return async () => {
    const out: SuppliedDocument[] = [], unreadable: { name: string; detail: string }[] = [];
    if (!documents.length) return { documents: out, unreadable };
    if (!sourceIngestionEnabled() || !scope.projectId) throw new RequestError("DOCUMENTS_UNAVAILABLE", "Documents can't be read here yet. Remove them, or add your notes as text.", 422);
    for (const document of documents) {
      try {
        const bytes = await resolveSourceReference(client, { workspaceId: scope.workspaceId, projectId: scope.projectId }, document.reference, document.mediaType, signal);
        const record = await extractSource({ bytes, name: document.name, declaredType: document.mediaType, signal });
        if (record.status === "complete") out.push({ name: document.name, assetId: document.reference.assetId, sha256: document.reference.sha256, record });
        else unreadable.push({ name: document.name, detail: record.message });
      } catch (error) {
        if (error instanceof IngestCancelledError) throw new RequestError("REQUEST_CANCELLED", "The request was cancelled while reading your documents. Nothing was charged.", 499);
        if (error instanceof IngestBusyError) throw new RequestError("SOURCES_BUSY", "Too many files are being read right now. Try again in a moment; nothing was charged.", 429);
        unreadable.push({ name: document.name, detail: error instanceof RequestError ? error.message : "The file could not be read." });
      }
    }
    return { documents: out, unreadable };
  };
}

export type Anchor = { artifactId: string; projectId: string; title: string; kind: string; currentVersion: number };
/** The client's projects' artifacts the brief can be kept with (RLS-bound reads). */
export async function clientAnchors(client: SupabaseClient, workspaceId: string, clientId: string): Promise<Anchor[]> {
  const projects = await client.from("projects").select("id,title").eq("workspace_id", workspaceId).eq("client_id", clientId).limit(50);
  if (projects.error) researchError(projects.error);
  const ids = (projects.data ?? []).map(row => row.id as string);
  if (!ids.length) return [];
  const artifacts = await client.from("artifacts").select("id,project_id,title,kind,current_version,updated_at").eq("workspace_id", workspaceId).in("project_id", ids).order("updated_at", { ascending: false }).limit(50);
  if (artifacts.error) researchError(artifacts.error);
  return (artifacts.data ?? []).map(row => ({ artifactId: row.id as string, projectId: row.project_id as string, title: row.title as string, kind: row.kind as string, currentVersion: row.current_version as number }));
}

/** Saved plans on this client's projects: "Create a plan" asks before starting another one. */
export async function existingPlans(client: SupabaseClient, workspaceId: string, anchors: readonly Anchor[]) {
  if (!anchors.length) return [];
  const { data, error } = await client.from("artifact_plans").select("artifact_id,plan").eq("workspace_id", workspaceId).in("artifact_id", anchors.map(item => item.artifactId)).limit(50);
  if (error) { if (error.code === "42P01" || error.code === "PGRST205") return []; researchError(error); }
  return (data ?? []).flatMap(row => {
    const stored = StoredPlanSchema.safeParse(row.plan);
    const anchor = anchors.find(item => item.artifactId === row.artifact_id);
    // Any saved plan counts, even one this version can't read: asking is always safe.
    return anchor ? [{ artifactId: anchor.artifactId, title: anchor.title, status: stored.success ? stored.data.status : "saved" }] : [];
  });
}
