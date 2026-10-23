import Anthropic from "@anthropic-ai/sdk";
import { cloudBody, cloudContext, cloudError, cloudJson, databaseError, validId } from "@/lib/cloud/server";
import { RequestError } from "@/lib/server/http";
import { aiCostUsdPerCredit } from "@/lib/builder/pricing";
import { requireProviderCapacity } from "@/lib/ai/live-run";
import type { AnthropicLike } from "@/lib/ai/anthropic-call";
import { resolveAgencyScope } from "@/lib/builder/operation-server";
import { agencyTasksEnabled } from "@/lib/agency/run";
import { AgencyError, resolveAgencyTask } from "@/lib/agency/task";
import { anthropicModelPort } from "@/lib/agency/model-port";
import { inputReader } from "@/lib/agency/inputs";
import { sourceIngestionEnabled } from "@/lib/ingest/builder-sources";
import { clientKnowledgeEnabled } from "@/lib/knowledge/server";
import { ResearchRequestSchema } from "@/lib/research/contract";
import { ResearchError, researchObjective, runClientResearch, type ResearchDeps } from "@/lib/research/research";
import { SEARCH_REFUSED_REASON } from "@/lib/research/search";
import { normalizeUrl } from "@/lib/research/site";
import { briefStore, clientAnchors, documentReader, knowledgeReader, readBrief, requireClientResearch, researchCache } from "@/lib/research/server";

export const runtime = "nodejs";
export const maxDuration = 120;
type Context = { params: Promise<{ workspaceId: string; clientId: string }> };
let active = 0;

/**
 * "Understand this client" (agency stage 4). Off unless MAKEBORNE_CLIENT_RESEARCH=on (404).
 * GET: what the panel needs (client, its projects, which inputs are available) or, with
 * ?brief=<id>, one stored brief. POST: research once per action key (a repeat returns the
 * stored brief). Assisted writing runs only when agency tasks are on and a setting is
 * qualified for research (none is yet), otherwise the brief is written from the sources
 * without AI. Web search is never used (see lib/research/search.ts).
 */
async function clientRow(context: Context, write: boolean) {
  const { workspaceId, clientId } = await context.params;
  validId(clientId);
  const auth = await cloudContext(workspaceId, write);
  const { data, error } = await auth.client.from("clients").select("id,name,company,website").eq("workspace_id", workspaceId).eq("id", clientId).maybeSingle();
  databaseError(error);
  if (!data) throw new RequestError("NOT_FOUND", "This client is unavailable in this workspace.", 404);
  return { ...auth, workspaceId, clientId, row: data as { id: string; name: string; company: string | null; website: string | null } };
}

export async function GET(request: Request, context: Context) {
  try {
    requireClientResearch();
    const { client, user, workspace, workspaceId, clientId, row } = await clientRow(context, false);
    const briefId = new URL(request.url).searchParams.get("brief");
    if (briefId) { validId(briefId); return cloudJson({ brief: await readBrief({ actorId: user.id, workspaceId, clientId }, briefId) }); }
    const [anchors, recent] = await Promise.all([
      clientAnchors(client, workspaceId, clientId),
      client.from("client_research_briefs").select("id,created_at,method").eq("workspace_id", workspaceId).eq("client_id", clientId).order("created_at", { ascending: false }).limit(5),
    ]);
    return cloudJson({ enabled: true, canEdit: workspace?.role !== "reviewer",
      client: { name: row.name, company: row.company ?? "", website: row.website ?? "" }, anchors,
      documents: sourceIngestionEnabled() && anchors.length > 0, knowledge: clientKnowledgeEnabled(),
      search: { available: false, reason: SEARCH_REFUSED_REASON },
      recent: (recent.data ?? []).map(item => ({ id: item.id, createdAt: item.created_at, method: item.method })) });
  } catch (error) { return cloudError(error); }
}

export async function POST(request: Request, context: Context) {
  let reserved = false;
  try {
    requireClientResearch();
    const body = await cloudBody(request, ResearchRequestSchema, 96_000);
    const { client, user, workspaceId, clientId, row } = await clientRow(context, true);
    const anchors = await clientAnchors(client, workspaceId, clientId);
    const anchor = body.artifactId ? anchors.find(item => item.artifactId === body.artifactId) : undefined;
    if (body.artifactId && !anchor) throw new RequestError("NOT_FOUND", "Choose one of this client's projects.", 404);
    if (active >= 2) throw new RequestError("RESEARCH_BUSY", "Two research requests are already running. Try again shortly.", 429);
    active++; reserved = true;
    const scope = { actorId: user.id, workspaceId, clientId };
    let url: string;
    try { url = normalizeUrl(body.url); } catch { throw new RequestError("RESEARCH_URL_INVALID", "Enter the client's website address, for example https://example.com."); }
    const profile = { id: clientId, name: row.name, company: row.company ?? "", url };

    let assisted: ResearchDeps["assisted"] = null;
    if (agencyTasksEnabled() && anchor) {
      try {
        const task = await resolveAgencyTask(user.id, { artifactId: anchor.artifactId, actionKey: body.actionKey, stepKey: body.stepKey, kind: "research",
          objective: researchObjective(profile, url), inputs: body.documents.map(item => ({ kind: "asset", id: item.reference.assetId, sha256: item.reference.sha256 })),
          permittedTools: [], settings: body.settings, ceilingCredits: body.ceilingCredits, expectedRevision: anchor.currentVersion },
          { scope: resolveAgencyScope, rateMicrousd: Math.round(aiCostUsdPerCredit() * 1_000_000) });
        if (task.clientId !== clientId) throw new RequestError("NOT_FOUND", "Choose one of this client's projects.", 404);
        await requireProviderCapacity("anthropic");
        const anthropic = new Anthropic({ maxRetries: 0, timeout: 90_000 }) as unknown as AnthropicLike;
        assisted = { task, deps: { model: anthropicModelPort(anthropic, task.settings), readInput: inputReader(task), platformDeadline: Date.now() + (maxDuration - 15) * 1000 } };
      } catch (error) {
        // Nothing is qualified for research yet: write the brief from the sources without AI.
        if (!(error instanceof AgencyError && error.code === "AGENCY_SETTINGS_UNQUALIFIED")) throw error;
      }
    }
    const outcome = await runClientResearch({ request: body, client: profile }, {
      cache: researchCache(scope), knowledge: knowledgeReader(scope, anchor?.artifactId ?? null),
      documents: documentReader(client, { workspaceId, projectId: anchor?.projectId ?? null }, body.documents, request.signal),
      briefs: briefStore(scope), assisted,
    });
    const run = outcome.run;
    return cloudJson({ brief: outcome.row, operation: run?.status ? { id: run.status.operation.id, outcome: run.outcome, charged: run.charged, message: run.message } : null },
      outcome.row.replayed ? 200 : 201);
  } catch (error) {
    if (error instanceof ResearchError) return cloudError(new RequestError(error.code, error.message, error.status));
    return cloudError(error);
  } finally {
    if (reserved) active--;
  }
}
