import { z } from "zod";
import { BuilderAttachmentsSchema, builderAttachmentBlocks, MAX_BUILDER_REQUEST_BYTES } from "@/lib/builder/attachments";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { cloudContext, databaseError, validId } from "@/lib/cloud/server";
import { mapProject, mapVersion } from "@/lib/cloud/mappers";
import { blankVersion } from "@/lib/builder/blank-version";
import { boundedJson, RequestError, sameOrigin } from "@/lib/server/http";
import { EffortLevelSchema } from "@/lib/routing/effort";
import { ProjectFiles } from "@/lib/builder/files";
import { builderModel } from "@/lib/builder/agent";
import { styleDirection } from "@/lib/builder/prompt";
import { designSeedBlock, seedApplies } from "@/lib/builder/design-seed";
import { renderedContrastCheck } from "@/lib/builder/contrast-gate";
import { BuildBriefSchema, DesignAnswersSchema, briefTone, designAnswersBlock, enhancedBriefBlock, requiredSections } from "@/lib/builder/enhanced-brief";
import { imageConfiguration } from "@/lib/builder/images";
import { BUILDER_EFFORT, aiCostUsdPerCredit } from "@/lib/builder/pricing";
import { builderEstimates } from "@/lib/builder/credit-estimate";
import { ReviewInputSchema, reviewAttachments, reviewRequest } from "@/lib/builder/review";
import { REVIEW_MAX_TURNS, reviewCreditCeiling } from "@/lib/builder/review-policy";
import { OperationRequestSchema } from "@/lib/builder/operation-contract";
import { OperationError, beginOperation, brandKitFingerprint, createOperationSpend, finishOperation, operationApiError, operationReplayResponse, type OperationRun } from "@/lib/builder/operation-server";
import { documentBuildResponse } from "@/lib/builder/docs-run";
import { websiteBuildResponse } from "@/lib/builder/website-run";
import { providerCapacity, requireProviderCapacity } from "@/lib/ai/live-run";
import { builderAvailability } from "@/lib/builder/availability";
import { requirePricedModel } from "@/lib/ai/model-check";
import { routeIssue, routeModels, routeStage, type RouteInput } from "@/lib/ai/model-routing";
import { buildTaskContract } from "@/lib/builder/task-contract";
import { SitePlanSchema, StoredPlanSchema, planToBrief } from "@/lib/builder/plan";
import { approvedMaximumIssue, approvedPlanIssue, staleBaseMessage } from "@/lib/builder/edit-intent";
import { websiteBrandBlock } from "@/lib/brand/kit";
import { ensureBrandLogo, projectBrandKit } from "@/lib/brand/server";
import { importTheirPhotos, photosContext } from "@/lib/leads/redesign-server";
import { CONTENT_CONTRACT } from "@/lib/builder/content-prompt";
import { MANIFEST_PATH } from "@/lib/portal/content-model";
import { AdvisorProvenanceSchema } from "@/lib/experts/advisor-brief";

export const runtime = "nodejs";
// Vercel Hobby allows 300s; raise to 800 on Pro for long Ultra runs.
export const maxDuration = 300;

const BuildRequest = z.object({
  workspaceId: z.string().uuid(),
  artifactId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  message: z.string().trim().min(1).max(8000),
  effort: EffortLevelSchema.default("medium"),
  attachments: BuilderAttachmentsSchema.default([]),
  /** An approved Plan mode plan the build must follow. */
  plan: SitePlanSchema.optional(),
  /** The saved plan revision the customer approved; required with `plan`. */
  planRevision: z.number().int().positive().optional(),
  /** "review": look at client-captured screenshots of the current version and fix visual problems. */
  mode: z.enum(["build", "review"]).default("build"),
  review: ReviewInputSchema.optional(),
  operation: OperationRequestSchema.optional(),
  /** The maximum the customer saw before approving a new request; must equal the server-derived ceiling. */
  approvedMaximum: z.number().int().positive().optional(),
  /** Which advisor conversation and brief revision a new request came from (ids only; recorded with the operation). */
  provenance: AdvisorProvenanceSchema.optional(),
  /** The enhanced brief the client approved before a first build (as returned, or edited by them). */
  brief: BuildBriefSchema.optional(),
  /** The client's one-click design answers (theme, vibe, imagery, action, sections, colour). */
  design: DesignAnswersSchema.optional(),
}).strict().refine(body => body.mode === "review" ? Boolean(body.review) && !body.attachments.length && !body.plan : !body.review)
  .refine(body => body.planRevision === undefined || Boolean(body.plan))
  // Provenance belongs to the request that starts an operation, never to an automatic stage or review.
  .refine(body => !body.provenance || (body.mode === "build" && (!body.operation || "actionKey" in body.operation)))
  // Like provenance, the approved brief and answers start an operation; its later stages read them back from it.
  // An enhanced or analysed brief starts a Create build only; the client's design answers start a Create build or an approved plan's build.
  .refine(body => !body.brief || (body.mode === "build" && !body.plan && (!body.operation || "actionKey" in body.operation)))
  .refine(body => !body.design || (body.mode === "build" && (!body.operation || "actionKey" in body.operation)));

const builderEnabled = () => process.env.MAKEBORNE_LIVE_BUILDER_ENABLED !== "false" && Boolean(process.env.ANTHROPIC_API_KEY);

// Configured is not runnable: paused or exhausted provider spending is reported before work is offered.
export async function GET() {
  const availability = await builderAvailability({ configured: builderEnabled(), priced: () => requirePricedModel(builderModel()), capacity: () => providerCapacity("anthropic") });
  // Measured credit ranges for the composer's estimate, in credits at the live rate (no provider call).
  return Response.json({ ...availability, estimates: builderEstimates(aiCostUsdPerCredit()) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  let reserved: OperationRun | null = null;
  try {
    sameOrigin(request);
    if (!builderEnabled()) throw new RequestError("BUILDER_UNAVAILABLE", "The builder is not connected in this environment.", 503);
    const parsed = BuildRequest.safeParse(await boundedJson(request, MAX_BUILDER_REQUEST_BYTES));
    if (!parsed.success) throw new RequestError("INVALID_BUILD", "Describe what to build (up to 8,000 characters) and attach up to five supported source files (3 MB combined).");
    const body = parsed.data;
    if (!body.operation) throw new RequestError("OPERATION_REQUIRED", "Reload the builder to use the request's shared credit limit.", 409);
    const reviewing = body.mode === "review" ? body.review! : null;
    validId(body.artifactId);
    const { client, user } = await cloudContext(body.workspaceId, true);

    const artifactResult = await client.from("artifacts").select("id,project_id,kind,title,current_version").eq("workspace_id", body.workspaceId).eq("id", body.artifactId).maybeSingle();
    databaseError(artifactResult.error);
    const artifact = artifactResult.data;
    if (!artifact || !["website", "book", "presentation"].includes(artifact.kind)) throw new RequestError("NOT_FOUND", "This project is unavailable.", 404);
    const [projectResult, versionsResult] = await Promise.all([
      client.from("projects").select("*").eq("workspace_id", body.workspaceId).eq("id", artifact.project_id).maybeSingle(),
      client.from("artifact_versions").select("*").eq("workspace_id", body.workspaceId).eq("artifact_id", artifact.id).order("version_number", { ascending: false }).limit(8),
    ]);
    databaseError(projectResult.error); databaseError(versionsResult.error);
    if (!projectResult.data) throw new RequestError("NOT_FOUND", "This project is unavailable.", 404);
    const project = mapProject(projectResult.data);
    const versions = (versionsResult.data ?? []).map(mapVersion);
    // Projects created empty start at version 0 with no saved revision: build
    // from a blank document and the default style, as the studio editor does.
    const current = versions.find(version => version.number === artifact.current_version)
      ?? (artifact.current_version === 0 ? blankVersion(artifact.id, artifact.kind, artifact.title, user.id) : undefined);
    if (!current) throw new RequestError("NOT_FOUND", "The current revision is unavailable.", 404);
    if (reviewing && !current.content.websiteSource?.files.length) throw new RequestError("NOTHING_TO_REVIEW", "Build the website before reviewing its design.", 409);

    const policy = BUILDER_EFFORT[body.effort];
    // A review round is a focused pass with its own, smaller ceiling.
    const ceiling = reviewing ? reviewCreditCeiling(policy.ceilingCredits) : policy.ceilingCredits;
    // A new billable request is bound to the maximum shown at approval; any difference is a new quote.
    const quoteIssue = approvedMaximumIssue(body.operation, body.approvedMaximum, ceiling);
    if (quoteIssue) throw new RequestError("QUOTE_CHANGED", quoteIssue, 409);
    // Unknown pricing fails closed before anything is reserved or sent.
    requirePricedModel(builderModel());
    // The stage's routing decision (MAKEBORNE_MODEL_ROUTING off by default = today's behaviour). Every model it may call
    // must be priced and support the stage before any hold exists; the decision is re-taken below with the operation's state.
    const routeInput = (extra: Partial<RouteInput> = {}): RouteInput => artifact.kind === "website"
      ? { stage: reviewing ? "review" : body.operation && "kind" in body.operation && body.operation.kind === "continuation" ? "continuation" : "build", artifact: "website",
        request: body.message, files: current.content.websiteSource?.files.length ?? 0, projectBytes: (current.content.websiteSource?.files ?? []).reduce((sum, file) => sum + file.content.length, 0),
        effort: body.effort, attachments: body.attachments.length, plan: Boolean(body.plan),
        verification: { compile: true, contrast: process.env.MAKEBORNE_CONTRAST_GATE !== "off" }, ...extra }
      : { stage: "document", artifact: artifact.kind === "book" ? "book" : "deck", emptyDocument: !current.content.document, effort: body.effort, ...extra };
    for (const model of routeModels(routeStage(routeInput()))) requirePricedModel(model);
    const routeProblem = routeIssue(routeStage(routeInput()));
    if (routeProblem) throw new RequestError("MODEL_UNSUPPORTED", "The configured AI model cannot run this step, so the builder is unavailable.", 503);
    // Paused or exhausted provider spending: a retryable 503 before any credit hold exists.
    await requireProviderCapacity("anthropic");
    // An approved plan is bound to the exact saved revision the customer reviewed,
    // checked before any operation or credit hold exists.
    if (body.plan) {
      const saved = await client.from("artifact_plans").select("plan").eq("workspace_id", body.workspaceId).eq("artifact_id", artifact.id).maybeSingle();
      databaseError(saved.error);
      const stored = StoredPlanSchema.safeParse(saved.data?.plan);
      const issue = approvedPlanIssue(stored.success ? stored.data : null, { plan: body.plan, revision: body.planRevision });
      if (issue) throw new RequestError("PLAN_REVISION_CONFLICT", issue, 409);
    }
    // The brand kit is resolved before admission and fingerprinted into the request, so a
    // kit edited mid-request cannot silently change a started operation.
    const brand = await projectBrandKit(client, body.workspaceId, project);
    const { operation: envelope, ...requestBody } = body;
    // SQL binds the stage to its original authorization and creates its hold atomically.
    const admitted = await beginOperation({ actor: user.id, workspaceId: body.workspaceId, artifactId: body.artifactId,
      expectedVersion: body.expectedVersion, effort: body.effort, kind: reviewing ? "review" : "build", ceiling,
      envelope, request: { ...requestBody, brandKit: brandKitFingerprint(brand) } }).catch(error => {
      // SQL refuses a stale base version without saying so; name the versions instead.
      if (error instanceof OperationError && error.code === "OPERATION_CONFLICT" && body.expectedVersion !== artifact.current_version)
        throw new RequestError("VERSION_CONFLICT", staleBaseMessage(body.expectedVersion, artifact.current_version), 409);
      throw error;
    });
    if (!admitted.run) return operationReplayResponse(admitted.status);
    const operation = admitted.run, hold = operation.hold;
    reserved = operation;

    const files = new ProjectFiles(current.content.websiteSource);
    const scope = { workspaceId: body.workspaceId, projectId: artifact.project_id };
    const logo = brand && artifact.kind === "website" ? await ensureBrandLogo(client, scope, brand, files) : null;
    // A redesign brief lists the client's own photos; they are downloaded once (no AI) and stored as project images.
    const photos = artifact.kind === "website" && !reviewing ? await importTheirPhotos(client, scope, project.brief, files).catch(() => []) : [];
    const outline = current.content.websiteSource ? "" : current.content.sections.map(section => [section.title, ...section.blocks.map(block => block.text)].filter(Boolean).join("\n")).join("\n\n").slice(0, 20_000);
    const history = versions.filter(version => version.number <= artifact.current_version).slice(0, 6).reverse()
      .map(version => `v${version.number}: ${version.changeSummary}`).join("\n");
    const approvedPlan = body.plan ?? operation.originalPlan;
    // Bound to the operation: a continuation uses exactly the brief and answers the request was authorized with.
    const approvedBrief = reviewing ? undefined : body.brief ?? operation.originalBrief;
    const design = reviewing ? undefined : body.design ?? operation.originalDesign;
    const direction = styleDirection(project.styleId, current.style);
    // First builds without a preset (the default "automatic" style is none), plan or prior design get per-project
    // art-direction starting points and the concept step.
    const seed = seedApplies({ kind: artifact.kind, reviewing: Boolean(reviewing), plan: Boolean(approvedPlan), styleId: project.styleId, files: files.files.size, staticDesign: Boolean(current.content.website) })
      ? designSeedBlock({ seed: artifact.project_id, brief: [project.brief, project.audience, project.purpose, artifact.title, operation.originalMessage ?? body.message, approvedBrief?.text].filter(Boolean).join("\n"),
        images: BUILDER_EFFORT[body.effort].maxImages > 0 && Boolean(imageConfiguration().model) && design?.imagery !== "type", brand: Boolean(brand), design,
        tone: briefTone(approvedBrief?.text) })
      : "";
    const context = [
      `<project title="${artifact.title.replace(/"/g, "'")}">`,
      `Brief: ${project.brief || "(none)"}`,
      project.audience ? `Audience: ${project.audience}` : "", project.purpose ? `Purpose: ${project.purpose}` : "",
      designAnswersBlock(design),
      approvedBrief ? enhancedBriefBlock(approvedBrief) : "",
      `Visual direction: ${direction || "No preset — choose the best direction for this business."}`,
      seed,
      brand ? websiteBrandBlock(brand, logo) : "",
      photosContext(photos),
      // Client sites get client-editable content (owner default); sites that already declare content keep the contract.
      artifact.kind === "website" && (project.clientId || files.files.has(MANIFEST_PATH)) ? CONTENT_CONTRACT : "",
      outline ? `Existing outline content to use:\n${outline}` : "",
      current.content.website ? `Existing static design to convert into the React project (keep its look and copy unless asked otherwise):\n<html>${current.content.website.html.slice(0, 40_000)}</html>\n<css>${current.content.website.css.slice(0, 30_000)}</css>` : "",
      history ? `Recent revisions:\n${history}` : "",
      operation.originalMessage ? `Original authorized request: ${operation.originalMessage}` : "",
      "</project>",
      approvedPlan ? `<approved_plan>\nThe client reviewed and approved this plan. Build exactly this: the same pages and section order, content, type pairing, palette hex values, layout ideas, imagery and signature interaction. Do not add or drop pages or sections unless the request says so. Where the plan names fonts the toolchain cannot load, use the closest permitted stack.\n\n${planToBrief(approvedPlan)}\n</approved_plan>` : "",
      files.files.size
        ? `<current_files>\n${files.snapshot()}\n</current_files>\nExisting images: ${[...files.assets.values()].map(asset => `/${asset.path.slice(7)}`).join(", ") || "none"}`
        : "<current_files>(empty — build the complete website from scratch)</current_files>",
    ].filter(Boolean).join("\n");
    const attachments: BetaContentBlockParam[] = reviewing ? reviewAttachments(reviewing) : builderAttachmentBlocks(body.attachments);

    // Provider dollars: the effort ceiling, independent of the customer's credits (admins included).
    const spend = createOperationSpend(operation, Date.now() + (maxDuration - 20) * 1000);
    // The decision with the operation's durable state: parent ids, input revision, earlier runs' repair/escalation counts.
    // The task contract (scope and acceptance checks are router inputs; its limits can only lower the router's).
    const picked = /([\w./-]+\.(?:tsx|ts|css|html|json|svg|md)) \(line (\d+)\)/.exec(body.message);
    const contract = buildTaskContract({ artifact: artifact.kind === "website" ? "website" : artifact.kind === "book" ? "book" : "presentation",
      objective: reviewing ? "refine" : files.files.size || current.content.document ? "edit" : "create", message: body.message,
      plan: approvedPlan ? planToBrief(approvedPlan) : null, brief: approvedBrief ? { text: approvedBrief.text } : null, design: design ?? null,
      revision: { expectedVersion: body.expectedVersion }, target: picked ? { file: picked[1], line: Number(picked[2]), label: "" } : null,
      limits: { capCredits: ceiling, repairs: 1, escalations: 1 } });
    const route = routeStage(routeInput({ operation: { id: operation.operation.id, runId: operation.id, revision: body.expectedVersion }, previous: operation.priorRoute ?? null,
      allowanceMicrousd: spend.allowanceMicrousd, deadlineMs: spend.timeLeftMs(), contract }));

    // Books and presentations: structured document builder (same credits, versions and SSE contract).
    if (artifact.kind === "book" || artifact.kind === "presentation") {
      const response = documentBuildResponse({ client, hold, spend, operation, workspaceId: body.workspaceId, artifact, project, current, versions, brand,
        message: body.message, effort: body.effort, attachments, maxDuration, route });
      reserved = null;
      return response;
    }

    const response = websiteBuildResponse({ client, hold, spend, operation, route, workspaceId: body.workspaceId, artifact, current, files, reviewing: Boolean(reviewing), projectBrief: project.brief,
      message: body.message, effort: body.effort, request: reviewing ? reviewRequest(reviewing) : body.message, context, attachments,
      limits: reviewing ? { maxTurns: Math.min(REVIEW_MAX_TURNS, policy.maxTurns), maxImages: 0 } : design?.imagery === "type" ? { maxImages: 0 } : undefined, maxDuration,
      // First build: the concept step (2-3 concepts scored on the rubric, the strongest built) inside this run.
      concept: Boolean(seed),
      // Rendered contrast at finish, measured in the export pipeline's Chromium on this app's origin (fail open without a browser).
      contrastCheck: process.env.MAKEBORNE_CONTRAST_GATE === "off" ? undefined : renderedContrastCheck({ origin: new URL(request.url).origin, launch: async () => {
        const [{ chromium }, { chromiumLaunchOptions }] = await Promise.all([import("playwright"), import("@/lib/server/export")]);
        return chromium.launch({ headless: true, ...(await chromiumLaunchOptions()) });
      } }),
      // Completeness gate: every section the approved brief lists, and every must-have the client chose.
      required: reviewing ? undefined : { sections: approvedBrief ? requiredSections(approvedBrief.text) : [], design, brief: [project.brief, operation.originalMessage ?? body.message].filter(Boolean).join("\n") } });
    reserved = null;
    return response;
  } catch (error) {
    if (reserved) await finishOperation(reserved, 0, "failed", { code: "REQUEST_FAILED", message: "This step could not start. Your previous saved work is safe." }).catch(() => undefined);
    return operationApiError(error);
  }
}
