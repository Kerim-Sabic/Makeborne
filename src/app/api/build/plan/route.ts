import { z } from "zod";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cloudContext, databaseError, validId } from "@/lib/cloud/server";
import { mapProject, mapVersion } from "@/lib/cloud/mappers";
import { apiError, boundedJson, RequestError, sameOrigin } from "@/lib/server/http";
import { EffortLevelSchema } from "@/lib/routing/effort";
import { ProjectFiles } from "@/lib/builder/files";
import { newRunId } from "@/lib/builder/agent";
import { styleDirection } from "@/lib/builder/prompt";
import { MINIMUM_RUN_CREDITS } from "@/lib/builder/pricing";
import { PLAN_CEILING_CREDITS, SitePlanSchema, StoredPlanSchema, estimatePlanCredits, recommendedEffort, type StoredPlan } from "@/lib/builder/plan";
import { runPlanner, type PlannerEvent } from "@/lib/builder/planner";
import { getCreditBalance, releaseCredits, reserveCredits, settleCredits } from "@/lib/credits/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const Attachment = z.object({
  name: z.string().min(1).max(200),
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf", "text/plain", "text/markdown"]),
  data: z.string().max(8_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict();
const PlanRequest = z.object({
  workspaceId: z.string().uuid(),
  artifactId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  message: z.string().trim().min(1).max(8000),
  effort: EffortLevelSchema.default("medium"),
  attachments: z.array(Attachment).max(5).default([]),
  /** The plan being revised; the message is feedback on it. */
  previousPlan: SitePlanSchema.optional(),
}).strict();
const SavePlan = z.object({
  workspaceId: z.string().uuid(),
  artifactId: z.string().uuid(),
  plan: SitePlanSchema,
  status: z.enum(["draft", "built"]).default("draft"),
}).strict();

type PlanStreamEvent = PlannerEvent
  | { type: "plan"; stored: StoredPlan; estimate: ReturnType<typeof estimatePlanCredits>; recommended: string; persisted: boolean }
  | { type: "done"; charged: number }
  | { type: "error"; code: string; message: string };

const builderEnabled = () => process.env.MAKEBORNE_LIVE_BUILDER_ENABLED !== "false" && Boolean(process.env.ANTHROPIC_API_KEY);
const noStore = { "Cache-Control": "no-store" };
// The plan table ships in its own migration; before it is applied, plans still
// work for the session but are not kept across reloads.
const missingTable = (code?: string) => code === "42P01" || code === "PGRST205" || code === "PGRST204";

async function readPlan(client: SupabaseClient, workspaceId: string, artifactId: string): Promise<StoredPlan | null> {
  const { data, error } = await client.from("artifact_plans").select("plan").eq("workspace_id", workspaceId).eq("artifact_id", artifactId).maybeSingle();
  if (error) { if (missingTable(error.code)) return null; databaseError(error); }
  const parsed = StoredPlanSchema.safeParse(data?.plan);
  return parsed.success ? parsed.data : null;
}

async function writePlan(client: SupabaseClient, workspaceId: string, artifactId: string, userId: string, stored: StoredPlan): Promise<boolean> {
  const { error } = await client.from("artifact_plans").upsert({ artifact_id: artifactId, workspace_id: workspaceId, plan: stored, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "artifact_id" });
  if (error) { if (missingTable(error.code)) return false; databaseError(error); }
  return true;
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
    const stored: StoredPlan = { plan: body.plan, status: body.status, basedOnVersion: existing?.basedOnVersion ?? artifact.current_version,
      revision: existing?.revision ?? 1, charged: existing?.charged ?? 0 };
    const persisted = await writePlan(client, body.workspaceId, body.artifactId, user.id, stored);
    return Response.json({ ...view(stored), persisted }, { headers: noStore });
  } catch (error) { return apiError(error); }
}

/** Runs one planning call (SSE). Reserves at most PLAN_CEILING_CREDITS and
 * charges only when a valid plan is produced. */
export async function POST(request: Request) {
  let reserved: { userId: string; runId: string } | null = null;
  try {
    sameOrigin(request);
    if (!builderEnabled()) throw new RequestError("BUILDER_UNAVAILABLE", "The builder is not connected in this environment.", 503);
    const parsed = PlanRequest.safeParse(await boundedJson(request, 14_000_000));
    if (!parsed.success) throw new RequestError("INVALID_PLAN_REQUEST", "Describe what to plan (up to 8,000 characters) and attach at most five files under 6 MB each.");
    const body = parsed.data;
    const { client, user } = await cloudContext(body.workspaceId, true);
    const artifact = await websiteArtifact(client, body.workspaceId, body.artifactId);
    if (artifact.current_version !== body.expectedVersion) throw new RequestError("REVISION_CONFLICT", "This project changed. Reload the latest version before planning.", 409);
    const [projectResult, versionsResult, existing] = await Promise.all([
      client.from("projects").select("*").eq("workspace_id", body.workspaceId).eq("id", artifact.project_id).maybeSingle(),
      client.from("artifact_versions").select("*").eq("workspace_id", body.workspaceId).eq("artifact_id", artifact.id).order("version_number", { ascending: false }).limit(6),
      readPlan(client, body.workspaceId, body.artifactId),
    ]);
    databaseError(projectResult.error); databaseError(versionsResult.error);
    if (!projectResult.data) throw new RequestError("NOT_FOUND", "This project is unavailable.", 404);
    const project = mapProject(projectResult.data);
    const versions = (versionsResult.data ?? []).map(mapVersion);
    const current = versions.find(version => version.number === artifact.current_version);
    if (!current) throw new RequestError("NOT_FOUND", "The current website revision is unavailable.", 404);

    const balance = await getCreditBalance(user.id);
    const budget = balance.unlimited ? PLAN_CEILING_CREDITS : Math.min(PLAN_CEILING_CREDITS, balance.available);
    if (budget < MINIMUM_RUN_CREDITS) throw new RequestError("INSUFFICIENT_CREDITS", "You're out of credits. Upgrade your plan or add credits to keep planning.", 402);
    const runId = `plan:${newRunId()}`;
    await reserveCredits(user.id, budget, runId);
    reserved = { userId: user.id, runId };

    const files = new ProjectFiles(current.content.websiteSource);
    const snapshot = files.files.size ? files.snapshot() : "";
    const outline = current.content.websiteSource ? "" : current.content.sections.map(section => [section.title, ...section.blocks.map(block => block.text)].filter(Boolean).join("\n")).join("\n\n").slice(0, 12_000);
    const history = versions.filter(version => version.number <= artifact.current_version).reverse().map(version => `v${version.number}: ${version.changeSummary}`).join("\n");
    const context = [
      `<project title="${artifact.title.replace(/"/g, "'")}">`,
      `Brief: ${project.brief || "(none)"}`,
      project.audience ? `Audience: ${project.audience}` : "", project.purpose ? `Purpose: ${project.purpose}` : "",
      `Visual direction: ${styleDirection(project.styleId, current.style) || "No preset — choose the best direction for this business."}`,
      outline ? `Existing outline content:\n${outline}` : "",
      history ? `Recent revisions:\n${history}` : "",
      "</project>",
      // Planning reads the code to ground the plan; very large projects are capped.
      snapshot ? `<current_files>\n${snapshot.length > 160_000 ? `${snapshot.slice(0, 160_000)}\n…(remaining files omitted for planning)` : snapshot}\n</current_files>` : "<current_files>(empty — no website yet: plan a new site)</current_files>",
    ].filter(Boolean).join("\n");
    const attachments: BetaContentBlockParam[] = body.attachments.map(file => file.mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.data }, title: file.name }
      : file.mediaType.startsWith("text/")
        ? { type: "document", source: { type: "text", media_type: "text/plain", data: Buffer.from(file.data, "base64").toString("utf8").slice(0, 200_000) }, title: file.name }
        : { type: "image", source: { type: "base64", media_type: file.mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data: file.data } });

    const encoder = new TextEncoder();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (maxDuration - 20) * 1000);
    const stream = new ReadableStream<Uint8Array>({
      async start(output) {
        let open = true;
        const emit = (event: PlanStreamEvent) => {
          if (!open) return;
          try { output.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { open = false; }
        };
        const heartbeat = setInterval(() => { if (open) try { output.enqueue(encoder.encode(": keep-alive\n\n")); } catch { open = false; } }, 15_000);
        try {
          emit({ type: "status", message: snapshot ? "Reading your project…" : "Studying your brief…" });
          const result = await runPlanner({ context, request: body.message, previousPlan: body.previousPlan ?? null, attachments,
            effort: body.effort, creditBudget: budget, emit, signal: controller.signal });
          if (!result.plan) {
            await releaseCredits(user.id, runId);
            emit({ type: "error", code: "PLAN_INCOMPLETE", message: "I couldn't finish a complete plan. Nothing was charged — try again or add a little more detail." });
            return;
          }
          const charged = (await settleCredits(user.id, runId, Math.min(result.credits, budget))).charged;
          const stored: StoredPlan = { plan: result.plan, status: "draft", basedOnVersion: artifact.current_version,
            revision: (existing?.revision ?? 0) + 1, charged };
          // A storage failure must not lose a paid plan: the browser still shows it.
          const persisted = await writePlan(client, body.workspaceId, body.artifactId, user.id, stored).catch(() => false);
          emit({ type: "plan", stored, estimate: estimatePlanCredits(result.plan), recommended: recommendedEffort(result.plan), persisted });
          emit({ type: "done", charged });
        } catch (error) {
          await releaseCredits(user.id, runId).catch(() => undefined);
          const message = (error as { code?: string }).code === "REFUSED" ? "This request can't be planned. Try rephrasing it." : "Planning hit a problem and stopped. No credits were charged.";
          emit({ type: "error", code: "PLAN_FAILED", message });
        } finally {
          clearTimeout(timeout); clearInterval(heartbeat);
          if (open) try { output.close(); } catch { /* client already gone */ }
        }
      },
    });
    reserved = null;
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
  } catch (error) {
    if (reserved) await releaseCredits(reserved.userId, reserved.runId).catch(() => undefined);
    return apiError(error);
  }
}
