import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { cloudBody, cloudContext, cloudError, cloudJson, databaseError, validId } from "@/lib/cloud/server";
import { mapVersion } from "@/lib/cloud/mappers";
import { RequestError } from "@/lib/server/http";
import { aiCostUsdPerCredit } from "@/lib/builder/pricing";
import { requireProviderCapacity } from "@/lib/ai/live-run";
import type { AnthropicLike } from "@/lib/ai/anthropic-call";
import { resolveAgencyScope } from "@/lib/builder/operation-server";
import { clientKnowledgeEnabled, knowledgeForAgencyTask } from "@/lib/knowledge/server";
import { AgencyError, agencyKindEnabled, resolveAgencyTask } from "@/lib/agency/task";
import { anthropicModelPort } from "@/lib/agency/model-port";
import { inputReader } from "@/lib/agency/inputs";
import { documentPdf, documentPptx, loadDocumentImages } from "@/lib/documents/export-server";
import { dataReportsEnabled, GenerateRequestSchema, prepareReport, previewView, ReportRequestSchema } from "@/lib/data/report";
import { TEMPLATES, TEMPLATE_IDS, plainNarrative } from "@/lib/data/templates";
import { checkNarrative, narrativeRefusal, renderNarrative, type Narrative } from "@/lib/data/narrative";
import { aiNarrative } from "@/lib/data/narrative-ai";
import { persistDataReport } from "@/lib/data/persist";
import { listSpreadsheetSources, loadSpreadsheet } from "@/lib/data/server";
import { DataError } from "@/lib/data/dataset";

export const runtime = "nodejs";
export const maxDuration = 120;
type Context = { params: Promise<{ workspaceId: string; artifactId: string }> };
let active = 0;

/**
 * Data-to-deliverable reports (agency stage 7) for a book or presentation.
 * Behind the server-side flag MAKEBORNE_DATA_REPORTS=on (off by default; 404
 * when off). GET lists the tasks and the project's stored spreadsheets. POST
 * {action:"preview"} recomputes the figures from the stored file and returns
 * them with their cells, missing values and warnings (nothing stored, no AI).
 * POST {action:"generate"} recomputes them again, refuses if they differ from
 * the preview the person saw, writes the summary from the numbers (an
 * AI-written summary is refused until that task kind is qualified), and saves
 * ONE new version with the facts sheet, chart data and final files stored in
 * the project. Downloads use the existing document-export route and its
 * existing access rules. Editors and owners only; reviewers can download.
 */
const BodySchema = z.discriminatedUnion("action", [
  ReportRequestSchema.extend({ action: z.literal("preview") }),
  GenerateRequestSchema.extend({ action: z.literal("generate") }),
]);

function enabled() { if (!dataReportsEnabled()) throw new RequestError("NOT_AVAILABLE", "Data reports are not available.", 404); }

async function current(context: Context, write: boolean) {
  const { workspaceId, artifactId } = await context.params;
  validId(artifactId);
  const auth = await cloudContext(workspaceId, write);
  const { data: artifact, error } = await auth.client.from("artifacts").select("id,project_id,kind,current_version").eq("workspace_id", workspaceId).eq("id", artifactId).maybeSingle();
  databaseError(error);
  if (!artifact || (artifact.kind !== "book" && artifact.kind !== "presentation")) throw new RequestError("NOT_FOUND", "This document is unavailable.", 404);
  return { ...auth, workspaceId, artifact: artifact as { id: string; project_id: string; kind: "book" | "presentation"; current_version: number }, scope: { workspaceId, projectId: artifact.project_id as string } };
}

export async function GET(_request: Request, context: Context) {
  try {
    enabled();
    const { client, workspace, artifact, scope } = await current(context, false);
    const templates = TEMPLATE_IDS.map(id => TEMPLATES[id]).filter(template => template.artifact === artifact.kind)
      .map(template => ({ id: template.id, label: template.label, description: template.description, roles: template.roles.map(role => ({ role: role.role, label: role.label, required: role.required, multiple: Boolean(role.multiple), kinds: role.kinds })) }));
    return cloudJson({ available: true, canGenerate: workspace?.role !== "reviewer", currentVersion: artifact.current_version, templates,
      sources: await listSpreadsheetSources(client, scope), writtenSummary: { plain: true, ai: false } });
  } catch (error) { return cloudError(error instanceof DataError ? new RequestError(error.code, error.message, error.status) : error); }
}

export async function POST(request: Request, context: Context) {
  let reserved = false;
  try {
    enabled();
    const body = await cloudBody(request, BodySchema, 64_000);
    const { client, user, workspaceId, artifact, scope } = await current(context, true);
    if (active >= 2) throw new RequestError("DATA_BUSY", "Two reports are already being prepared. Please try again shortly.", 429);
    active++; reserved = true;
    const { record, name } = await loadSpreadsheet(client, scope, body.source, request.signal);
    const prepared = prepareReport(record, body, name);
    if (body.action === "preview") return cloudJson({ preview: previewView(prepared) });

    if (prepared.facts.digest !== body.expectedFactsDigest)
      throw new RequestError("REPORT_NUMBERS_CHANGED", "The figures differ from the preview you checked (the file or the settings changed). Check the preview again before generating.", 409);
    if (TEMPLATES[body.template].artifact !== artifact.kind) throw new RequestError("WRONG_DOCUMENT", `${TEMPLATES[body.template].label} needs a ${TEMPLATES[body.template].artifact === "book" ? "document" : "presentation"} project.`, 409);
    const { data: versionRow, error: versionError } = await client.from("artifact_versions").select("*").eq("workspace_id", workspaceId).eq("artifact_id", artifact.id).eq("version_number", body.expectedVersion).maybeSingle();
    databaseError(versionError);
    if (!versionRow) throw new RequestError("REPORT_STALE", "Save this project before adding a report to it.", 409);
    const currentVersion = mapVersion(versionRow);

    let narrative: Narrative;
    if (body.narrative === "ai") {
      // Paid: needs MAKEBORNE_AGENCY_TASKS=on and "data_report" in MAKEBORNE_AGENCY_TASK_KINDS.
      if (!agencyKindEnabled("data_report")) throw new RequestError("WRITTEN_SUMMARY_UNAVAILABLE", "An AI-written summary isn’t available yet. Choose the summary written from the numbers.", 409);
      const rate = Math.round(aiCostUsdPerCredit() * 1_000_000);
      let task;
      try {
        task = await resolveAgencyTask(user.id, { artifactId: artifact.id, actionKey: body.actionKey, stepKey: body.actionKey, kind: "data_report",
          objective: `Write the narrative for a ${TEMPLATES[body.template].label.toLowerCase()} from its verified facts sheet ${prepared.facts.digest.slice(0, 16)}.`,
          inputs: [{ kind: "asset", id: body.source.assetId, sha256: body.source.sha256 }], permittedTools: [], settings: "standard", ceilingCredits: 20, expectedRevision: body.expectedVersion },
          { scope: resolveAgencyScope, rateMicrousd: rate });
      } catch (error) {
        if (error instanceof AgencyError && error.code === "AGENCY_SETTINGS_UNQUALIFIED") throw new RequestError("WRITTEN_SUMMARY_UNAVAILABLE", "An AI-written summary isn’t available yet. Choose the summary written from the numbers.", 409);
        throw error;
      }
      await requireProviderCapacity("anthropic");
      const anthropic = new Anthropic({ maxRetries: 0, timeout: 60_000 }) as unknown as AnthropicLike;
      // Approved client knowledge (when on) is read inside the step and snapshotted with its operation; figures still come only from the facts sheet.
      const written = await aiNarrative({ task, facts: prepared.facts, deps: { model: anthropicModelPort(anthropic, task.settings), tools: {}, readInput: inputReader(task), platformDeadline: Date.now() + (maxDuration - 60) * 1000,
        ...(clientKnowledgeEnabled() ? { knowledge: knowledgeForAgencyTask } : {}) } });
      if (!written.narrative) throw new RequestError("NARRATIVE_UNVERIFIED", written.problems.length ? narrativeRefusal(written.problems) : `${written.run.message} Nothing was saved.`, 422);
      narrative = written.narrative;
    } else {
      const checked = checkNarrative(plainNarrative(prepared.facts), prepared.facts);
      if (!checked.ok) throw new RequestError("NARRATIVE_UNVERIFIED", narrativeRefusal(checked.problems), 500);
      narrative = checked.narrative;
    }

    const saved = await persistDataReport({ client, scope, artifact, current: currentVersion, expectedVersion: body.expectedVersion, actionKey: body.actionKey, facts: prepared.facts,
        narrative: renderNarrative(narrative, prepared.facts), narrativeSource: body.narrative, mode: body.mode, title: body.title, sourceName: name, sourceAsset: { id: body.source.assetId, sha256: body.source.sha256 } },
        { renderPdf: documentPdf, renderPptx: documentPptx, loadImages: doc => loadDocumentImages(client, workspaceId, scope.projectId, doc) });
    const base = `/api/cloud/workspaces/${workspaceId}/artifacts/${artifact.id}/document-export`;
    return cloudJson({ replayed: saved.replayed, version: saved.version,
      files: saved.files.map(file => ({ format: file.format, bytes: file.bytes, sha256: file.sha256, url: `${base}?format=${file.format}&version=${saved.version.number}&stored=1` })),
      facts: { digest: prepared.facts.digest, figures: prepared.facts.facts.length, charts: prepared.facts.charts.length } }, saved.replayed ? 200 : 201);
  } catch (error) {
    return cloudError(error instanceof DataError ? new RequestError(error.code, error.message, error.status) : error);
  } finally {
    if (reserved) active--;
  }
}
