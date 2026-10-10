import { z } from "zod";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { cloudContext, databaseError, validId } from "@/lib/cloud/server";
import { mapProject, mapVersion } from "@/lib/cloud/mappers";
import { apiError, boundedJson, RequestError, sameOrigin } from "@/lib/server/http";
import { EffortLevelSchema } from "@/lib/routing/effort";
import { ProjectFiles } from "@/lib/builder/files";
import { runBuilder, newRunId, type BuilderEvent } from "@/lib/builder/agent";
import { styleDirection } from "@/lib/builder/prompt";
import { BUILDER_EFFORT, MINIMUM_RUN_CREDITS } from "@/lib/builder/pricing";
import { getCreditBalance, releaseCredits, reserveCredits, settleCredits } from "@/lib/credits/server";

export const runtime = "nodejs";
export const maxDuration = 800;

const Attachment = z.object({
  name: z.string().min(1).max(200),
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf", "text/plain", "text/markdown"]),
  data: z.string().max(8_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict();
const BuildRequest = z.object({
  workspaceId: z.string().uuid(),
  artifactId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  message: z.string().trim().min(1).max(8000),
  effort: EffortLevelSchema.default("medium"),
  attachments: z.array(Attachment).max(5).default([]),
}).strict();

const builderEnabled = () => process.env.MAKEBORNE_LIVE_BUILDER_ENABLED !== "false" && Boolean(process.env.ANTHROPIC_API_KEY);

export async function GET() {
  return Response.json({ available: builderEnabled() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  let reserved: { userId: string; runId: string } | null = null;
  try {
    sameOrigin(request);
    if (!builderEnabled()) throw new RequestError("BUILDER_UNAVAILABLE", "The builder is not connected in this environment.", 503);
    const parsed = BuildRequest.safeParse(await boundedJson(request, 14_000_000));
    if (!parsed.success) throw new RequestError("INVALID_BUILD", "Describe what to build (up to 8,000 characters) and attach at most five files under 6 MB each.");
    const body = parsed.data;
    validId(body.artifactId);
    const { client, user } = await cloudContext(body.workspaceId, true);

    const artifactResult = await client.from("artifacts").select("id,project_id,kind,title,current_version").eq("workspace_id", body.workspaceId).eq("id", body.artifactId).maybeSingle();
    databaseError(artifactResult.error);
    const artifact = artifactResult.data;
    if (!artifact || artifact.kind !== "website") throw new RequestError("NOT_FOUND", "This website project is unavailable.", 404);
    if (artifact.current_version !== body.expectedVersion) throw new RequestError("REVISION_CONFLICT", "This project changed. Reload the latest version before asking for more changes.", 409);
    const [projectResult, versionsResult] = await Promise.all([
      client.from("projects").select("*").eq("workspace_id", body.workspaceId).eq("id", artifact.project_id).maybeSingle(),
      client.from("artifact_versions").select("*").eq("workspace_id", body.workspaceId).eq("artifact_id", artifact.id).order("version_number", { ascending: false }).limit(8),
    ]);
    databaseError(projectResult.error); databaseError(versionsResult.error);
    if (!projectResult.data) throw new RequestError("NOT_FOUND", "This project is unavailable.", 404);
    const project = mapProject(projectResult.data);
    const versions = (versionsResult.data ?? []).map(mapVersion);
    const current = versions.find(version => version.number === artifact.current_version);
    if (!current) throw new RequestError("NOT_FOUND", "The current website revision is unavailable.", 404);

    const policy = BUILDER_EFFORT[body.effort];
    const balance = await getCreditBalance(user.id);
    const budget = balance.unlimited ? policy.ceilingCredits : Math.min(policy.ceilingCredits, balance.available);
    if (budget < MINIMUM_RUN_CREDITS) throw new RequestError("INSUFFICIENT_CREDITS", "You're out of credits. Upgrade your plan or add credits to keep building.", 402);
    const runId = newRunId();
    await reserveCredits(user.id, budget, runId);
    reserved = { userId: user.id, runId };

    const files = new ProjectFiles(current.content.websiteSource);
    const outline = current.content.websiteSource ? "" : current.content.sections.map(section => [section.title, ...section.blocks.map(block => block.text)].filter(Boolean).join("\n")).join("\n\n").slice(0, 20_000);
    const history = versions.filter(version => version.number <= artifact.current_version).slice(0, 6).reverse()
      .map(version => `v${version.number}: ${version.changeSummary}`).join("\n");
    const context = [
      `<project title="${artifact.title.replace(/"/g, "'")}">`,
      `Brief: ${project.brief || "(none)"}`,
      project.audience ? `Audience: ${project.audience}` : "", project.purpose ? `Purpose: ${project.purpose}` : "",
      `Visual direction: ${styleDirection(project.styleId, current.style) || "No preset — choose the best direction for this business."}`,
      outline ? `Existing outline content to use:\n${outline}` : "",
      current.content.website ? `Existing static design to convert into the React project (keep its look and copy unless asked otherwise):\n<html>${current.content.website.html.slice(0, 40_000)}</html>\n<css>${current.content.website.css.slice(0, 30_000)}</css>` : "",
      history ? `Recent revisions:\n${history}` : "",
      "</project>",
      files.files.size
        ? `<current_files>\n${files.snapshot()}\n</current_files>\nExisting images: ${[...files.assets.values()].map(asset => `/${asset.path.slice(7)}`).join(", ") || "none"}`
        : "<current_files>(empty — build the complete website from scratch)</current_files>",
    ].filter(Boolean).join("\n");
    const attachments: BetaContentBlockParam[] = body.attachments.map(file => file.mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.data }, title: file.name }
      : file.mediaType.startsWith("text/")
        ? { type: "document", source: { type: "text", media_type: "text/plain", data: Buffer.from(file.data, "base64").toString("utf8").slice(0, 200_000) }, title: file.name }
        : { type: "image", source: { type: "base64", media_type: file.mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data: file.data } });

    const encoder = new TextEncoder();
    // The run continues even if the browser disconnects, so paid work is saved.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (maxDuration - 20) * 1000);
    const stream = new ReadableStream<Uint8Array>({
      async start(output) {
        let open = true;
        const emit = (event: BuilderEvent) => {
          if (!open) return;
          try { output.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { open = false; }
        };
        const heartbeat = setInterval(() => { if (open) try { output.enqueue(encoder.encode(": keep-alive\n\n")); } catch { open = false; } }, 15_000);
        let charged = 0;
        try {
          emit({ type: "status", message: files.files.size ? "Reading your project…" : "Planning your website…" });
          const result = await runBuilder({ client, scope: { workspaceId: body.workspaceId, projectId: artifact.project_id }, files, effort: body.effort,
            creditBudget: budget, request: body.message, context, attachments, emit, signal: controller.signal });
          let source;
          try { source = files.toSource(); } catch { source = null; }
          if (!source || !files.changed.size && !result.finished) {
            charged = (await settleCredits(user.id, runId, Math.min(result.credits, budget))).charged;
            emit({ type: "error", code: "BUILD_INCOMPLETE", message: result.finished ? "Nothing changed." : "The builder ran out of room before finishing. Your project is unchanged — try a more focused request or a higher effort level." });
            return;
          }
          const assetIds = [...new Set([...current.assetIds, ...source.assets.map(asset => asset.id)])];
          const summary = result.summary || "Updated the website.";
          const saved = await client.rpc("makeborne_save_artifact_version", {
            p_workspace_id: body.workspaceId, p_artifact_id: artifact.id, p_expected_version: artifact.current_version,
            p_content: { schemaVersion: 1, kind: "website", title: (result.title || current.content.title).slice(0, 200), sections: [], websiteSource: source },
            p_style: current.style, p_asset_ids: assetIds,
            p_change_summary: `${body.message.slice(0, 600)} → ${summary}`.slice(0, 2000), p_request_key: runId,
          });
          if (saved.error || !saved.data?.version) {
            await releaseCredits(user.id, runId);
            emit({ type: "error", code: saved.error?.code === "PT409" ? "REVISION_CONFLICT" : "SAVE_FAILED", message: saved.error?.code === "PT409" ? "The project changed while building. Reload and try again — no credits were charged." : "The website was built but could not be saved. No credits were charged; please try again." });
            return;
          }
          charged = (await settleCredits(user.id, runId, Math.min(result.credits, budget))).charged;
          emit({ type: "done", version: saved.data.version.version_number ?? artifact.current_version + 1, summary, charged });
        } catch (error) {
          await releaseCredits(user.id, runId).catch(() => undefined);
          const message = (error as { code?: string }).code === "REFUSED" ? "This request can't be built. Try rephrasing it." : "The builder hit a problem and stopped. Your project is unchanged and no credits were charged.";
          emit({ type: "error", code: "BUILD_FAILED", message });
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
