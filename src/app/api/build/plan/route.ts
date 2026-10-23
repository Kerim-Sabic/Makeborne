import { z } from "zod";
import { MAX_BUILDER_REQUEST_BYTES } from "@/lib/builder/attachments";
import { BuilderSourcesSchema, OmittedSourcesSchema } from "@/lib/ingest/request";
import { prepareBuilderSources } from "@/lib/ingest/builder-sources";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cloudContext, databaseError, validId } from "@/lib/cloud/server";
import { mapProject, mapVersion } from "@/lib/cloud/mappers";
import { apiError, boundedJson, RequestError, sameOrigin } from "@/lib/server/http";
import { EffortLevelSchema } from "@/lib/routing/effort";
import { ProjectFiles } from "@/lib/builder/files";
import { blankVersion } from "@/lib/builder/blank-version";
import { builderModel } from "@/lib/builder/agent";
import { styleDirection } from "@/lib/builder/prompt";
import { designSeedBlock } from "@/lib/builder/design-seed";
import { imageConfiguration } from "@/lib/builder/images";
import { BRAND_LOGO_URL, websiteBrandBlock } from "@/lib/brand/kit";
import { projectBrandKit } from "@/lib/brand/server";
import { briefPhotos } from "@/lib/leads/redesign";
import { PLAN_CEILING_CREDITS, SitePlanSchema, StoredPlanSchema, estimatePlanCredits, recommendedEffort, type StoredPlan } from "@/lib/builder/plan";
import { planStreamResponse } from "@/lib/builder/plan-run";
import { OperationRequestSchema } from "@/lib/builder/operation-contract";
import { OperationError, beginOperation, brandKitFingerprint, createOperationSpend, finishOperation, operationApiError, operationReplayResponse, type OperationRun } from "@/lib/builder/operation-server";
import { approvedMaximumIssue, staleBaseMessage } from "@/lib/builder/edit-intent";
import { requireProviderCapacity } from "@/lib/ai/live-run";
import { requirePricedModel } from "@/lib/ai/model-check";
import { AdvisorProvenanceSchema } from "@/lib/experts/advisor-brief";

export const runtime = "nodejs";
export const maxDuration = 300;

const PlanRequest = z.object({
  workspaceId: z.string().uuid(),
  artifactId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  expectedRevision: z.number().int().nonnegative(),
  message: z.string().trim().min(1).max(8000),
  effort: EffortLevelSchema.default("medium"),
  attachments: BuilderSourcesSchema.default([]),
  /** Attached files the user explicitly chose to continue without (named to the model; never automatic).
   * Optional rather than defaulted so requests without it keep their exact input hash. */
  omittedSources: OmittedSourcesSchema.optional(),
  /** The plan being revised; the message is feedback on it. */
  previousPlan: SitePlanSchema.optional(),
  operation: OperationRequestSchema.optional(),
  /** The planning maximum the customer saw before sending; must equal the server ceiling. */
  approvedMaximum: z.number().int().positive().optional(),
  /** Which advisor conversation and brief revision this plan request came from (ids only; recorded with the operation). */
  provenance: AdvisorProvenanceSchema.optional(),
}).strict();
const SavePlan = z.object({
  workspaceId: z.string().uuid(),
  artifactId: z.string().uuid(),
  plan: SitePlanSchema,
  expectedRevision: z.number().int().nonnegative(),
  status: z.enum(["draft", "built"]).default("draft"),
}).strict();

const builderEnabled = () => process.env.MAKEBORNE_LIVE_BUILDER_ENABLED !== "false" && Boolean(process.env.ANTHROPIC_API_KEY);
const noStore = { "Cache-Control": "no-store" };
// Older read-only deployments may lack the plan table. Paid operation writes
// require the complete migration chain and fail closed if unavailable.
const missingTable = (code?: string) => code === "42P01" || code === "PGRST205" || code === "PGRST204";

async function readPlan(client: SupabaseClient, workspaceId: string, artifactId: string): Promise<StoredPlan | null> {
  const { data, error } = await client.from("artifact_plans").select("plan").eq("workspace_id", workspaceId).eq("artifact_id", artifactId).maybeSingle();
  if (error) { if (missingTable(error.code)) return null; databaseError(error); }
  const parsed = StoredPlanSchema.safeParse(data?.plan);
  return parsed.success ? parsed.data : null;
}

async function writePlan(client: SupabaseClient, workspaceId: string, artifactId: string, userId: string, stored: StoredPlan): Promise<StoredPlan> {
  const row = { artifact_id: artifactId, workspace_id: workspaceId, plan: stored, updated_by: userId, updated_at: new Date().toISOString() };
  // A concurrent first save must conflict, never turn into an overwrite. The
  // database trigger compares the expected revision on every existing-row edit.
  const write = stored.revision === 0 ? client.from("artifact_plans").insert(row)
    : client.from("artifact_plans").update(row).eq("artifact_id", artifactId).eq("workspace_id", workspaceId);
  const { data, error } = await write.select("plan").single();
  if (error?.code === "PT409" || error?.code === "23505" || error?.code === "PGRST116") throw new RequestError("PLAN_REVISION_CONFLICT", "The plan changed. Reload it before saving these edits.", 409);
  databaseError(error);
  const saved = StoredPlanSchema.safeParse(data?.plan);
  if (!saved.success) throw new RequestError("PLAN_SAVE_FAILED", "The saved plan could not be confirmed. Reload it before retrying.", 503);
  return saved.data;
}

async function websiteArtifact(client: SupabaseClient, workspaceId: string, artifactId: string) {
  validId(artifactId);
  const result = await client.from("artifacts").select("id,project_id,kind,title,current_version").eq("workspace_id", workspaceId).eq("id", artifactId).maybeSingle();
  databaseError(result.error);
  if (!result.data || result.data.kind !== "website") throw new RequestError("NOT_FOUND", "This website project is unavailable.", 404);
  return result.data as { id: string; project_id: string; kind: string; title: string; current_version: number };
}

const view = (stored: StoredPlan | null) => stored ? { stored, estimate: estimatePlanCredits(stored.plan), recommended: recommendedEffort(stored.plan) } : { stored: null };

/** Latest saved plan for a website artifact. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspaceId = z.string().uuid().parse(url.searchParams.get("workspaceId"));
    const artifactId = z.string().uuid().parse(url.searchParams.get("artifactId"));
    const { client } = await cloudContext(workspaceId);
    await websiteArtifact(client, workspaceId, artifactId);
    return Response.json(view(await readPlan(client, workspaceId, artifactId)), { headers: noStore });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError(new RequestError("INVALID_PLAN_REQUEST", "Choose a website project."));
    return apiError(error);
  }
}

/** Saves the user's inline edits (or marks the plan built). Free. */
export async function PUT(request: Request) {
  try {
    sameOrigin(request);
    const parsed = SavePlan.safeParse(await boundedJson(request, 120_000));
    if (!parsed.success) throw new RequestError("INVALID_PLAN", `This plan can't be saved: ${parsed.error.issues[0]?.path.join(".") || "plan"} ${parsed.error.issues[0]?.message ?? "is invalid"}.`);
    const body = parsed.data;
    const { client, user } = await cloudContext(body.workspaceId, true);
    const artifact = await websiteArtifact(client, body.workspaceId, body.artifactId);
    const existing = await readPlan(client, body.workspaceId, body.artifactId);
    if (body.expectedRevision !== (existing?.revision ?? 0)) throw new RequestError("PLAN_REVISION_CONFLICT", "The plan changed. Reload it before saving these edits.", 409);
    const stored: StoredPlan = { plan: body.plan, status: body.status, basedOnVersion: existing?.basedOnVersion ?? artifact.current_version,
      revision: body.expectedRevision, charged: existing?.charged ?? 0 };
    const saved = await writePlan(client, body.workspaceId, body.artifactId, user.id, stored);
    return Response.json({ ...view(saved), persisted: true }, { headers: noStore });
  } catch (error) { return apiError(error); }
}

/** Runs one planning call (SSE). Reserves at most PLAN_CEILING_CREDITS and
 * charges only when a valid plan is produced. */
export async function POST(request: Request) {
  let reserved: OperationRun | null = null;
  try {
    sameOrigin(request);
    if (!builderEnabled()) throw new RequestError("BUILDER_UNAVAILABLE", "The builder is not connected in this environment.", 503);
    const parsed = PlanRequest.safeParse(await boundedJson(request, MAX_BUILDER_REQUEST_BYTES));
    if (!parsed.success) throw new RequestError("INVALID_PLAN_REQUEST", "Describe what to plan (up to 8,000 characters) and attach up to five supported source files (3 MB combined).");
    const body = parsed.data;
    if (!body.operation) throw new RequestError("OPERATION_REQUIRED", "Reload the planner to use the request's shared credit limit.", 409);
    const { client, user } = await cloudContext(body.workspaceId, true);
    // Bound to the planning maximum shown before sending; checked before any operation or hold.
    const quoteIssue = approvedMaximumIssue(body.operation, body.approvedMaximum, PLAN_CEILING_CREDITS);
    if (quoteIssue) throw new RequestError("QUOTE_CHANGED", quoteIssue, 409);
    const artifact = await websiteArtifact(client, body.workspaceId, body.artifactId);
    const [projectResult, versionsResult, existing] = await Promise.all([
      client.from("projects").select("*").eq("workspace_id", body.workspaceId).eq("id", artifact.project_id).maybeSingle(),
      client.from("artifact_versions").select("*").eq("workspace_id", body.workspaceId).eq("artifact_id", artifact.id).order("version_number", { ascending: false }).limit(6),
      readPlan(client, body.workspaceId, body.artifactId),
    ]);
    databaseError(projectResult.error); databaseError(versionsResult.error);
    if (!projectResult.data) throw new RequestError("NOT_FOUND", "This project is unavailable.", 404);
    const project = mapProject(projectResult.data);
    const versions = (versionsResult.data ?? []).map(mapVersion);
    const current = versions.find(version => version.number === artifact.current_version)
      ?? (artifact.current_version === 0 ? blankVersion(artifact.id, artifact.kind, artifact.title, user.id) : undefined);
    if (!current) throw new RequestError("NOT_FOUND", "The current website revision is unavailable.", 404);

    // Unknown pricing fails closed before anything is reserved or sent.
    requirePricedModel(builderModel());
    // Paused or exhausted provider spending: a retryable 503 before any credit hold exists.
    await requireProviderCapacity("anthropic");
    // Source files are read before admission (see /api/build): an unreadable file stops here.
    const prepared = await prepareBuilderSources(body.attachments, body.omittedSources ?? [],
      { client, scope: { workspaceId: body.workspaceId, projectId: artifact.project_id }, signal: request.signal });
    // Resolved before admission and fingerprinted into the request (see /api/build).
    const brand = await projectBrandKit(client, body.workspaceId, project);
    const { operation: envelope, ...requestBody } = body;
    const admitted = await beginOperation({ actor: user.id, workspaceId: body.workspaceId, artifactId: body.artifactId,
      expectedVersion: body.expectedVersion, effort: body.effort, kind: "plan", ceiling: PLAN_CEILING_CREDITS, envelope, request: { ...requestBody, brandKit: brandKitFingerprint(brand) },
      sources: { omitted: body.omittedSources ?? [], references: prepared.references } }).catch(error => {
      // SQL refuses a stale base version without saying so; name the versions instead.
      if (error instanceof OperationError && error.code === "OPERATION_CONFLICT" && body.expectedVersion !== artifact.current_version)
        throw new RequestError("VERSION_CONFLICT", staleBaseMessage(body.expectedVersion, artifact.current_version), 409);
      throw error;
    });
    if (!admitted.run) return operationReplayResponse(admitted.status);
    const operation = admitted.run, hold = operation.hold;
    reserved = operation;
    // Exact completed-step replay was returned above. A new paid planning step
    // must be based on the plan revision the customer actually reviewed.
    if (body.expectedRevision !== (existing?.revision ?? 0)) throw new RequestError("PLAN_REVISION_CONFLICT", "The plan changed. Reload it before requesting a new plan.", 409);

    const files = new ProjectFiles(current.content.websiteSource);
    const snapshot = files.files.size ? files.snapshot() : "";
    const outline = current.content.websiteSource ? "" : current.content.sections.map(section => [section.title, ...section.blocks.map(block => block.text)].filter(Boolean).join("\n")).join("\n\n").slice(0, 12_000);
    const history = versions.filter(version => version.number <= artifact.current_version).reverse().map(version => `v${version.number}: ${version.changeSummary}`).join("\n");
    const direction = styleDirection(project.styleId, current.style);
    // A new site without a preset gets the same per-project art-direction starting points as a direct build.
    const seed = !direction && !files.files.size && !current.content.website && !body.previousPlan
      ? designSeedBlock({ seed: artifact.project_id, brief: [project.brief, project.audience, project.purpose, artifact.title].filter(Boolean).join("\n"), images: Boolean(imageConfiguration().model), brand: Boolean(brand) })
      : "";
    const context = [
      `<project title="${artifact.title.replace(/"/g, "'")}">`,
      `Brief: ${project.brief || "(none)"}`,
      project.audience ? `Audience: ${project.audience}` : "", project.purpose ? `Purpose: ${project.purpose}` : "",
      `Visual direction: ${direction || "No preset — choose the best direction for this business."}`,
      seed,
      brand ? websiteBrandBlock(brand, brand.logo ? { url: BRAND_LOGO_URL, width: 0, height: 0 } : null) : "",
      briefPhotos(project.brief).length ? `The client's own photos listed in the brief will be uploaded as /images/photo-1.webp to /images/photo-${briefPhotos(project.brief).length}.webp when the site is built; plan the imagery around them.` : "",
      outline ? `Existing outline content:\n${outline}` : "",
      history ? `Recent revisions:\n${history}` : "",
      operation.originalMessage ? `Original authorized request: ${operation.originalMessage}` : "",
      "</project>",
      // Planning reads the code to ground the plan; very large projects are capped.
      snapshot ? `<current_files>\n${snapshot.length > 160_000 ? `${snapshot.slice(0, 160_000)}\n…(remaining files omitted for planning)` : snapshot}\n</current_files>` : "<current_files>(empty — no website yet: plan a new site)</current_files>",
    ].filter(Boolean).join("\n");
    const attachments: BetaContentBlockParam[] = prepared.blocks;

    // Provider dollars: the planning ceiling, independent of the customer's credits (admins included).
    const spend = createOperationSpend(operation, Date.now() + (maxDuration - 20) * 1000);
    const response = planStreamResponse({ hold, spend, operation, context, message: body.message, previousPlan: body.previousPlan ?? null, attachments, effort: body.effort,
      basedOnVersion: artifact.current_version, previousRevision: existing?.revision ?? 0,
      persist: async stored => { await writePlan(client, body.workspaceId, body.artifactId, user.id, stored); return true; }, maxDuration });
    reserved = null;
    return response;
  } catch (error) {
    if (reserved) await finishOperation(reserved, 0, "failed", { code: "REQUEST_FAILED", message: "This step could not start. Your previous saved work is safe." }).catch(() => undefined);
    return operationApiError(error);
  }
}
