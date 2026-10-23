import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { cloudBody, cloudContext, cloudError, cloudJson, databaseError, validId } from "@/lib/cloud/server";
import { RequestError } from "@/lib/server/http";
import { mapProject } from "@/lib/cloud/mappers";
import { ArtifactContentSchema } from "@/lib/domain";
import { StoredPlanSchema } from "@/lib/builder/plan";
import { aiCostUsdPerCredit } from "@/lib/builder/pricing";
import { requireProviderCapacity } from "@/lib/ai/live-run";
import type { AnthropicLike } from "@/lib/ai/anthropic-call";
import { resolveAgencyScope } from "@/lib/builder/operation-server";
import { reviewWebsiteHtml } from "@/lib/client-review/server";
import { dataUrls, loadDocumentImages } from "@/lib/documents/export-server";
import { agencyTasksEnabled } from "@/lib/agency/run";
import { AgencyError, resolveAgencyTask } from "@/lib/agency/task";
import { anthropicModelPort } from "@/lib/agency/model-port";
import { inputReader } from "@/lib/agency/inputs";
import { RoutePath, contentSha, type ReviewSubject } from "@/lib/review/contract";
import { NO_APPROVED_FACTS, reviewBrief } from "@/lib/review/brief";
import { defaultClaimsCheck } from "@/lib/review/claims";
import { bookDiagnostics, deckDiagnostics, deterministicFindings, websiteDiagnostics } from "@/lib/review/deterministic";
import { assembleRequest } from "@/lib/review/assemble";
import { captureBook, captureDeck, captureWebsite } from "@/lib/review/capture-server";
import { deterministicOnly, independentReviewEnabled, readIndependentReview, runIndependentReview } from "@/lib/review/operation";
import { assertReviewCurrent, repairInstructions } from "@/lib/review/loop";
import { repairable } from "@/lib/review/validate";

export const runtime = "nodejs";
export const maxDuration = 120;
type Context = { params: Promise<{ workspaceId: string; artifactId: string }> };
let active = 0;

/**
 * Independent review of the CURRENT version (agency stage 6). Behind the
 * server-side flag MAKEBORNE_INDEPENDENT_REVIEW=on (off by default); 404 when
 * off. GET ?subject=1 returns the exact revision to review; POST reviews it
 * (deterministic checks always; the fresh-context reviewer only when agency
 * tasks are enabled and a setting is qualified, which none is yet); GET
 * ?operation=<id> reads a recorded review (flagged stale after any edit), and
 * &repair=1 returns repair instructions for the existing builder, refused
 * for a stale review. The existing in-build review is unchanged.
 */
const ReviewStartSchema = z.object({
  actionKey: z.string().uuid(), stepKey: z.string().uuid(),
  expectedRevision: z.number().int().positive(), contentSha: z.string().regex(/^[a-f0-9]{64}$/),
  settings: z.string().regex(/^[a-z][a-z0-9_-]{1,31}$/).default("standard"),
  ceilingCredits: z.number().int().min(1).max(60).default(20),
  /** Websites: the browser's static snapshot per route (the same snapshot the client review copy uses). */
  routes: z.array(z.object({ path: RoutePath, snapshot: z.string().max(4_000_000) }).strict()).max(4).default([]),
  /** Errors the preview reported; they can only add findings. */
  runtimeErrors: z.array(z.string().trim().min(1).max(600)).max(12).default([]),
}).strict();

function enabled() { if (!independentReviewEnabled()) throw new RequestError("NOT_AVAILABLE", "Independent review is not available.", 404); }

async function current(context: Context, write: boolean) {
  const { workspaceId, artifactId } = await context.params;
  validId(artifactId);
  const auth = await cloudContext(workspaceId, write);
  if (write && auth.workspace?.role === "reviewer") throw new RequestError("ACCESS_DENIED", "Reviewers cannot start a review.", 403);
  const { data: artifact, error } = await auth.client.from("artifacts").select("id,project_id,kind,current_version").eq("workspace_id", workspaceId).eq("id", artifactId).maybeSingle();
  databaseError(error);
  if (!artifact || !["website", "book", "presentation"].includes(artifact.kind)) throw new RequestError("NOT_FOUND", "This project is unavailable.", 404);
  const { data: version, error: versionError } = await auth.client.from("artifact_versions").select("id,version_number,content").eq("workspace_id", workspaceId).eq("artifact_id", artifactId).eq("version_number", artifact.current_version).maybeSingle();
  databaseError(versionError);
  if (!version) throw new RequestError("NOTHING_TO_REVIEW", "Save this project before reviewing it.", 409);
  const subject: ReviewSubject = { artifactId, version: version.version_number, contentSha: contentSha(version.content) };
  return { ...auth, workspaceId, artifact, version, subject };
}

export async function GET(request: Request, context: Context) {
  try {
    enabled();
    const { user, workspaceId, subject } = await current(context, false);
    const url = new URL(request.url);
    const id = url.searchParams.get("operation");
    if (!id) return cloudJson({ subject });
    validId(id);
    const read = await readIndependentReview({ actor: user.id, workspaceId, artifactId: subject.artifactId, id }, subject);
    if (!read.result) return cloudJson({ subject, message: read.message, result: null, stale: false });
    if (url.searchParams.get("repair") === "1") {
      try { assertReviewCurrent(read.result, subject); } catch { throw new RequestError("REVIEW_STALE", "The project changed after this review. Review the current version before applying fixes.", 409); }
      const findings = read.result.findings.filter(repairable);
      return cloudJson({ subject, findings, instructions: findings.length ? repairInstructions(findings) : null });
    }
    return cloudJson({ subject, message: read.message, result: read.result, stale: read.stale });
  } catch (error) { return cloudError(error); }
}

export async function POST(request: Request, context: Context) {
  let reserved = false;
  try {
    enabled();
    const body = await cloudBody(request, ReviewStartSchema, 16_500_000);
    const { client, user, workspaceId, artifact, version, subject } = await current(context, true);
    if (body.expectedRevision !== subject.version || body.contentSha !== subject.contentSha)
      throw new RequestError("REVIEW_STALE", "The project changed since this review was requested. Reload it and try again.", 409);
    if (active >= 2) throw new RequestError("REVIEW_BUSY", "Two reviews are already running. Please try again shortly.", 429);
    active++; reserved = true;
    const content = ArtifactContentSchema.parse(version.content);
    const [projectResult, planResult] = await Promise.all([
      client.from("projects").select("*").eq("workspace_id", workspaceId).eq("id", artifact.project_id).maybeSingle(),
      client.from("artifact_plans").select("plan").eq("workspace_id", workspaceId).eq("artifact_id", artifact.id).maybeSingle(),
    ]);
    databaseError(projectResult.error); databaseError(planResult.error);
    if (!projectResult.data) throw new RequestError("NOT_FOUND", "This project is unavailable.", 404);
    const plan = StoredPlanSchema.safeParse(planResult.data?.plan);
    const { brief, declaredRoutes } = reviewBrief({ projectId: artifact.project_id, brief: mapProject(projectResult.data).brief, plan: plan.success ? plan.data : null });
    // Approved facts come from the knowledge module once it is merged; until then claims are not checked (and the coverage says so).
    const facts = NO_APPROVED_FACTS, factsForChecks = null, claims = defaultClaimsCheck;

    let evidence, diagnostics, coverage;
    if (artifact.kind === "website") {
      if (!body.routes.length) throw new RequestError("SNAPSHOT_REQUIRED", "Open the preview so the latest render can be captured, then try again.", 409);
      const origin = new URL(request.url).origin;
      const routes = body.routes.map(route => {
        const html = reviewWebsiteHtml(content, route.snapshot, origin);
        if (!html) throw new RequestError("NOTHING_TO_REVIEW", "This website has no saved render to review.", 409);
        return { path: route.path, html };
      });
      const captured = await captureWebsite({ routes, assets: async () => "unavailable", declaredRoutes, absentSrcUnknown: true });
      evidence = captured.evidence; coverage = captured.coverage;
      diagnostics = websiteDiagnostics({ probes: captured.probes, runtimeErrors: body.runtimeErrors, facts: factsForChecks, claims });
    } else {
      const doc = content.document;
      if (!doc) throw new RequestError("NO_DOCUMENT", "This version was not made with the live builder.", 409);
      const buffers = await loadDocumentImages(client, workspaceId, artifact.project_id, doc);
      const urls = await dataUrls(buffers);
      if (doc.kind === "book") {
        const captured = await captureBook(doc, buffers, urls);
        evidence = captured.evidence; coverage = captured.coverage;
        diagnostics = bookDiagnostics({ pdf: captured.pdf, exportError: captured.exportError, chapters: captured.evidence.chapters, facts: factsForChecks, claims });
      } else {
        const captured = await captureDeck(doc, buffers, urls);
        evidence = captured.evidence; coverage = captured.coverage;
        diagnostics = deckDiagnostics({ pptx: captured.pptx, exportError: captured.exportError, probes: captured.probes, facts: factsForChecks, claims,
          slides: doc.slides.map(slide => ({ id: slide.id, title: slide.title, notes: slide.notes, hasChart: slide.layout === "chart" && Boolean(slide.chart) })) });
      }
    }
    const reviewRequest = assembleRequest({ subject, brief, facts, evidence, diagnostics, coverage });
    const deterministic = deterministicFindings(reviewRequest.diagnostics);
    if (!agencyTasksEnabled()) return cloudJson({ subject, result: deterministicOnly(reviewRequest, deterministic, "reviewer_disabled", claims), operation: null });

    const rate = Math.round(aiCostUsdPerCredit() * 1_000_000);
    let task;
    try {
      task = await resolveAgencyTask(user.id, { artifactId: subject.artifactId, actionKey: body.actionKey, stepKey: body.stepKey, kind: "independent_review",
        objective: `Independent review of version ${subject.version} against the approved brief.`, inputs: [{ kind: "artifact_version", id: version.id, version: subject.version }],
        permittedTools: [], settings: body.settings, ceilingCredits: body.ceilingCredits, expectedRevision: subject.version }, { scope: resolveAgencyScope, rateMicrousd: rate });
    } catch (error) {
      if (error instanceof AgencyError && error.code === "AGENCY_SETTINGS_UNQUALIFIED") return cloudJson({ subject, result: deterministicOnly(reviewRequest, deterministic, "reviewer_not_qualified", claims), operation: null });
      throw error;
    }
    await requireProviderCapacity("anthropic");
    const anthropic = new Anthropic({ maxRetries: 0, timeout: 100_000 }) as unknown as AnthropicLike;
    const { result, run } = await runIndependentReview({ task, request: reviewRequest, deterministic, claims, deps: {
      model: anthropicModelPort(anthropic, task.settings), tools: {}, readInput: inputReader(task), platformDeadline: Date.now() + (maxDuration - 15) * 1000,
    } });
    return cloudJson({ subject, result, operation: run.status ? { id: run.status.operation.id, outcome: run.outcome, charged: run.charged, message: run.message } : null });
  } catch (error) {
    return cloudError(error);
  } finally {
    if (reserved) active--;
  }
}
