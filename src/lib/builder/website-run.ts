import "server-only";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArtifactVersion } from "../domain";
import type { EffortLevel } from "../routing/effort";
import type { AnthropicLike } from "../ai/anthropic-call";
import type { ImageClientLike } from "../ai/image-call";
import type { RunSpend } from "../ai/run-spend";
import { aiStop } from "../ai/failure";
import { holdIsActive, releaseRun, settleRun, type CreditHold } from "../credits/server";
import { runBuilder, type BuilderEvent, type BuilderRun } from "./agent";
import type { ProjectFiles } from "./files";
import { compileVerdict } from "./compile";
import { aiCostUsdPerCredit } from "./pricing";
import { watchOperationCancellation, finishOperation, operationFailure, operationTerminal, type OperationRun, type OperationCandidate } from "./operation-server";
import { builtTitle } from "../projects/project-title";

export type WebsiteBuildInput = {
  client: SupabaseClient;
  hold: CreditHold;
  spend: RunSpend;
  operation?: OperationRun;
  workspaceId: string;
  artifact: { id: string; project_id: string; title: string; current_version: number };
  current: ArtifactVersion;
  files: ProjectFiles;
  /** Review rounds look at screenshots and fix visual problems. */
  reviewing: boolean;
  /** The saved project brief. The builder's site name may replace only a placeholder or the title derived from it; a chosen title is kept. */
  projectBrief?: string;
  message: string;
  effort: EffortLevel;
  request: string;
  context: string;
  attachments: BetaContentBlockParam[];
  limits?: BuilderRun["limits"];
  maxDuration: number;
  /** Injected for tests: providers and the step guard. */
  stepGuardMs?: number;
  anthropic?: AnthropicLike;
  imageClient?: ImageClientLike;
  storeImage?: BuilderRun["storeImage"];
  compile?: BuilderRun["compile"];
};

/** Logs a spending-control stop privately (operator diagnostics stay out of the response). */
export function logAiStop(reference: string, error: unknown) {
  const stop = aiStop(error);
  if (stop) console.error(JSON.stringify({ event: "ai_spend_stop", reference, stop: stop.code, cause: (error as { code?: string })?.code ?? null, detail: error instanceof Error ? error.message.slice(0, 300) : null }));
  return stop;
}

/**
 * SSE response for a website build or design review. The hold already exists;
 * this settles it (with the full measured usage: the database caps the charge
 * at the hold) or releases it exactly once, and records the outcome.
 */
export function websiteBuildResponse(input: WebsiteBuildInput): Response {
  const { client, hold, spend, artifact, current, files, reviewing } = input;
  const compile = input.compile ?? compileVerdict;
  const rate = input.operation ? input.operation.rateMicrousd / 1e6 : aiCostUsdPerCredit();
  const measured = () => spend.customerCredits(rate);
  const encoder = new TextEncoder();
  // The run continues even if the browser disconnects, so paid work is saved.
  const controller = new AbortController();
  const stopWatching = watchOperationCancellation(input.operation, spend, controller);
  const timeout = setTimeout(() => controller.abort(), (input.maxDuration - 20) * 1000);
  const stream = new ReadableStream<Uint8Array>({
    async start(output) {
      let open = true;
      const emit = (event: BuilderEvent | Record<string, unknown>) => {
        if (!open) return;
        try { output.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { open = false; }
      };
      const heartbeat = setInterval(() => { if (open) try { output.enqueue(encoder.encode(": keep-alive\n\n")); } catch { open = false; } }, 15_000);
      try {
        if (input.operation) emit({ type: "operation", operation: input.operation.operation });
        emit({ type: "status", message: reviewing ? "Reviewing the design…" : files.files.size ? "Reading your project…" : "Planning your website…" });
        let result;
        try {
          result = await runBuilder({ client, scope: { workspaceId: input.workspaceId, projectId: artifact.project_id }, files, effort: input.effort, spend,
            request: input.request, context: input.context, attachments: input.attachments, emit, signal: controller.signal,
            deadline: Date.now() + (input.maxDuration - 20) * 1000, limits: input.limits,
            anthropic: input.anthropic, imageClient: input.imageClient, storeImage: input.storeImage, stepGuardMs: input.stepGuardMs, compile });
        } catch (error) {
          // A step was cut off (time limit or provider error): keep finished work if it is valid.
          if (!files.changed.size || (error as { code?: string }).code === "REFUSED" || aiStop(error)) throw error;
          try { files.toSource(); } catch { throw error; }
          emit({ type: "status", message: "Saving the work finished so far…" });
          result = { summary: "Saved the progress made so far.", title: undefined, credits: measured(), usd: spend.providerMicrousd / 1e6, finished: false, build: null, stopped: spend.stopped };
        }
        const detail = { calls: spend.calls.length, providerMicrousd: spend.providerMicrousd, uncertainMicrousd: spend.uncertainMicrousd, stopped: spend.stopped };
        if (reviewing && !files.changed.size) {
          // The review found nothing to fix (or ran out of room before editing):
          // charge for the look it took, keep the current version.
          const summary = result.finished ? result.summary || "No changes needed in the captured views." : "The review ran out of room before making changes. Your website is unchanged.";
          if (input.operation) {
            emit(operationTerminal(await finishOperation(input.operation, spend.confirmedMicrousd, "review_no_change", { ...detail, version: artifact.current_version, summary, changed: false, finished: result.finished })));
            return;
          }
          const settled = await settleRun(hold, measured(), { ...detail, kind: "review_no_change" });
          emit({ type: "done", version: artifact.current_version, summary, charged: settled.charged, changed: false });
          return;
        }
        let source;
        try { source = files.toSource(); } catch { source = null; }
        // finish compiles; progress kept without it is compiled here. A version that does not build is never saved;
        // one whose build could not be checked is saved and reported as unverified.
        let build = result.build;
        if (source && !result.finished && files.changed.size) {
          const verdict = await compile(files.files);
          if (verdict.status === "failed") source = null; else build = verdict.status;
        }
        if (!source || !files.changed.size && !result.finished) {
          if (input.operation) {
            emit(operationTerminal(await finishOperation(input.operation, spend.confirmedMicrousd, "incomplete", { ...detail, code: "BUILD_INCOMPLETE", message: "The builder stopped before a usable change was ready. Your previous saved version is safe.", version: artifact.current_version, changed: false, finished: false })));
            return;
          }
          await settleRun(hold, measured(), { ...detail, kind: "incomplete" });
          emit({ type: "error", code: "BUILD_INCOMPLETE", message: result.finished ? "Nothing changed." : "The builder ran out of room before finishing. Your project is unchanged — try a more focused request or a higher effort level." });
          return;
        }
        if (input.operation) {
          const summary = result.summary || (result.finished ? "Updated the website." : "Saved the progress made so far.");
          emit(operationTerminal(await finishOperation(input.operation, spend.confirmedMicrousd, "saved", { ...detail, summary, changed: true, finished: result.finished, build }, {
            content: { schemaVersion: 1, kind: "website", title: builtTitle(current.content.title, reviewing ? "" : result.title, input.projectBrief ?? "", "website").slice(0, 200), sections: [], websiteSource: source },
            style: current.style, assetIds: [...new Set([...current.assetIds, ...source.assets.map(asset => asset.id)])],
            summary: `${reviewing ? "Design review" : input.message.slice(0, 600)} → ${summary}`.slice(0, 2000), expectedVersion: artifact.current_version,
          })));
          return;
        }
        // A reclaimed hold can no longer be charged: do not save work against it.
        if (!(await holdIsActive(hold))) {
          await releaseRun(hold, measured(), "hold_expired", detail);
          emit({ type: "error", code: "HOLD_EXPIRED", message: "This run took longer than its credit hold allows, so nothing was saved or charged. Please try again." });
          return;
        }
        const assetIds = [...new Set([...current.assetIds, ...source.assets.map(asset => asset.id)])];
        const summary = result.summary || (result.finished ? "Updated the website." : "Saved the progress made so far.");
        const saved = await client.rpc("makeborne_save_artifact_version", {
          p_workspace_id: input.workspaceId, p_artifact_id: artifact.id, p_expected_version: artifact.current_version,
          p_content: { schemaVersion: 1, kind: "website", title: builtTitle(current.content.title, reviewing ? "" : result.title, input.projectBrief ?? "", "website").slice(0, 200), sections: [], websiteSource: source },
          p_style: current.style, p_asset_ids: assetIds,
          p_change_summary: `${reviewing ? "Design review" : input.message.slice(0, 600)} → ${summary}`.slice(0, 2000), p_request_key: hold.reference,
        });
        if (saved.error || !saved.data?.version) {
          const conflict = saved.error?.code === "PT409";
          await releaseRun(hold, measured(), conflict ? "revision_conflict" : "save_failed", detail);
          emit({ type: "error", code: conflict ? "REVISION_CONFLICT" : "SAVE_FAILED", message: conflict ? "The project changed while building. Reload and try again — no credits were charged." : "The website was built but could not be saved. No credits were charged; please try again." });
          return;
        }
        const settled = await settleRun(hold, measured(), { ...detail, kind: "saved" });
        emit({ type: "done", version: saved.data.version.version_number ?? artifact.current_version + 1, summary, charged: settled.charged, changed: true, finished: result.finished, build });
      } catch (error) {
        if (input.operation) {
          const stop = logAiStop(hold.reference, error);
          let candidate: OperationCandidate | undefined;
          if (files.changed.size) try {
            const source = files.toSource(), verdict = await compile(files.files);
            if (verdict.status === "failed") throw new Error("does not compile");
            candidate = { content: { schemaVersion: 1, kind: "website", title: current.content.title, sections: [], websiteSource: source }, style: current.style,
              assetIds: [...new Set([...current.assetIds, ...source.assets.map(asset => asset.id)])],
              summary: verdict.status === "passed" ? "Recovered the work completed before the builder stopped." : "Recovered the work completed before the builder stopped. Its build could not be checked.", expectedVersion: artifact.current_version };
          } catch { /* Only validated source that does not fail to build is offered for recovery. */ }
          emit(await operationFailure(input.operation, spend, { code: stop?.code ?? "BUILD_FAILED", message: stop?.message ?? "The builder stopped. Check the saved result and credit charge below.", stopped: spend.stopped, finished: false }, candidate));
          return;
        }
        await releaseRun(hold, measured(), "build_failed", { code: (error as { code?: string })?.code ?? null, stopped: spend.stopped }).catch(() => undefined);
        const stop = logAiStop(hold.reference, error);
        if (stop) emit({ type: "error", code: stop.code, message: stop.message, retryable: true });
        else emit({ type: "error", code: "BUILD_FAILED", message: (error as { code?: string }).code === "REFUSED" ? "This request can't be built. Try rephrasing it."
          : "The builder hit a problem and stopped. Your project is unchanged and no credits were charged." });
      } finally {
        stopWatching(); clearTimeout(timeout); clearInterval(heartbeat);
        if (open) try { output.close(); } catch { /* client already gone */ }
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}
