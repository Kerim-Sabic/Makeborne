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
import { BUILDER_EFFORT, aiCostUsdPerCredit } from "@/lib/builder/pricing";
import { builderEstimates } from "@/lib/builder/credit-estimate";
import { ReviewInputSchema, reviewAttachments, reviewRequest } from "@/lib/builder/review";
import { REVIEW_MAX_TURNS, reviewCreditCeiling } from "@/lib/builder/review-policy";
import { OperationRequestSchema } from "@/lib/builder/operation-contract";
import { beginOperation, createOperationSpend, finishOperation, operationApiError, operationReplayResponse, type OperationRun } from "@/lib/builder/operation-server";
import { documentBuildResponse } from "@/lib/builder/docs-run";
import { websiteBuildResponse } from "@/lib/builder/website-run";
import { requireProviderCapacity } from "@/lib/ai/live-run";
import { requirePricedModel } from "@/lib/ai/model-check";
import { SitePlanSchema, planToBrief } from "@/lib/builder/plan";
import { websiteBrandBlock } from "@/lib/brand/kit";
import { ensureBrandLogo, projectBrandKit } from "@/lib/brand/server";
import { importTheirPhotos, photosContext } from "@/lib/leads/redesign-server";
import { CONTENT_CONTRACT } from "@/lib/builder/content-prompt";
import { MANIFEST_PATH } from "@/lib/portal/content-model";

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
  /** "review": look at client-captured screenshots of the current version and fix visual problems. */
  mode: z.enum(["build", "review"]).default("build"),
  review: ReviewInputSchema.optional(),
  operation: OperationRequestSchema.optional(),
}).strict().refine(body => body.mode === "review" ? Boolean(body.review) && !body.attachments.length && !body.plan : !body.review);

const builderEnabled = () => process.env.MAKEBORNE_LIVE_BUILDER_ENABLED !== "false" && Boolean(process.env.ANTHROPIC_API_KEY);

export async function GET() {
  // Measured credit ranges for the composer's estimate, in credits at the live rate (no provider call).
  return Response.json({ available: builderEnabled(), estimates: builderEstimates(aiCostUsdPerCredit()) }, { headers: { "Cache-Control": "no-store" } });
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
    // Unknown pricing fails closed before anything is reserved or sent.
    requirePricedModel(builderModel());
    // Paused or exhausted provider spending: a retryable 503 before any credit hold exists.
    await requireProviderCapacity("anthropic");
    const { operation: envelope, ...requestBody } = body;
    // SQL binds the stage to its original authorization and creates its hold atomically.
    const admitted = await beginOperation({ actor: user.id, workspaceId: body.workspaceId, artifactId: body.artifactId,
      expectedVersion: body.expectedVersion, effort: body.effort, kind: reviewing ? "review" : "build", ceiling,
      envelope, request: requestBody });
    if (!admitted.run) return operationReplayResponse(admitted.status);
    const operation = admitted.run, hold = operation.hold;
    reserved = operation;

    const files = new ProjectFiles(current.content.websiteSource);
    // The project's brand kit (the client's, or the workspace's own for projects without a client).
    const brand = await projectBrandKit(client, body.workspaceId, project);
    const scope = { workspaceId: body.workspaceId, projectId: artifact.project_id };
    const logo = brand && artifact.kind === "website" ? await ensureBrandLogo(client, scope, brand, files) : null;
    // A redesign brief lists the client's own photos; they are downloaded once (no AI) and stored as project images.
    const photos = artifact.kind === "website" && !reviewing ? await importTheirPhotos(client, scope, project.brief, files).catch(() => []) : [];
    const outline = current.content.websiteSource ? "" : current.content.sections.map(section => [section.title, ...section.blocks.map(block => block.text)].filter(Boolean).join("\n")).join("\n\n").slice(0, 20_000);
    const history = versions.filter(version => version.number <= artifact.current_version).slice(0, 6).reverse()
      .map(version => `v${version.number}: ${version.changeSummary}`).join("\n");
    const approvedPlan = body.plan ?? operation.originalPlan;
    const context = [
      `<project title="${artifact.title.replace(/"/g, "'")}">`,
      `Brief: ${project.brief || "(none)"}`,
      project.audience ? `Audience: ${project.audience}` : "", project.purpose ? `Purpose: ${project.purpose}` : "",
      `Visual direction: ${styleDirection(project.styleId, current.style) || "No preset — choose the best direction for this business."}`,
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

    // Books and presentations: structured document builder (same credits, versions and SSE contract).
    if (artifact.kind === "book" || artifact.kind === "presentation") {
      const response = documentBuildResponse({ client, hold, spend, operation, workspaceId: body.workspaceId, artifact, project, current, versions, brand,
        message: body.message, effort: body.effort, attachments, maxDuration });
      reserved = null;
      return response;
    }

    const response = websiteBuildResponse({ client, hold, spend, operation, workspaceId: body.workspaceId, artifact, current, files, reviewing: Boolean(reviewing),
      message: body.message, effort: body.effort, request: reviewing ? reviewRequest(reviewing) : body.message, context, attachments,
      limits: reviewing ? { maxTurns: Math.min(REVIEW_MAX_TURNS, policy.maxTurns), maxImages: 0 } : undefined, maxDuration });
    reserved = null;
    return response;
  } catch (error) {
    if (reserved) await finishOperation(reserved, 0, "failed", { code: "REQUEST_FAILED", message: "This step could not start. Your previous saved work is safe." }).catch(() => undefined);
    return operationApiError(error);
  }
}
