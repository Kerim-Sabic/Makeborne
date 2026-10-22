import "server-only";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArtifactVersion } from "../domain";
import type { EffortLevel } from "../routing/effort";
import { holdIsActive, releaseRun, settleRun, type CreditHold } from "../credits/server";
import { watchOperationCancellation, finishOperation, operationFailure, operationTerminal, type OperationRun, type OperationCandidate } from "./operation-server";
import type { RunSpend } from "../ai/run-spend";
import type { AnthropicLike } from "../ai/anthropic-call";
import type { ImageClientLike } from "../ai/image-call";
import { aiCostUsdPerCredit } from "./pricing";
import { logAiStop } from "./website-run";
import { aiStop } from "../ai/failure";
import { DocumentEditor, emptyDocument } from "../documents/editor";
import { bookImagePlanFromBrief, deckModeFromBrief } from "../documents/creation-options";
import { projectDocument, documentAssetIds } from "../documents/project";
import { wordCount } from "../documents/book-markup";
import { runDocumentBuilder, type DocBuilderEvent, type DocBuilderRun } from "./docs-agent";
import { documentStyleDirection } from "./docs-style";
import { documentBrandBlock, type BrandKit } from "../brand/kit";
import { builtTitle } from "../projects/project-title";

export type DocumentBuildInput = {
  client: SupabaseClient;
  hold: CreditHold;
  operation?: OperationRun;
  spend: RunSpend;
  workspaceId: string;
  artifact: { id: string; project_id: string; kind: "book" | "presentation"; title: string; current_version: number };
  project: { brief: string; styleId: string; audience?: string; purpose?: string };
  current: ArtifactVersion;
  versions: ArtifactVersion[];
  message: string;
  effort: EffortLevel;
  /** The project's brand kit, if it has one. */
  brand?: BrandKit | null;
  attachments: BetaContentBlockParam[];
  maxDuration: number;
  /** Injected providers (tests). */
  anthropic?: AnthropicLike;
  imageClient?: ImageClientLike;
  storeImage?: DocBuilderRun["storeImage"];
};

/** Model-facing context: brief, style, history, and the current document. */
export function documentContext(input: Pick<DocumentBuildInput, "artifact" | "project" | "current" | "versions" | "brand">, editor: DocumentEditor, fresh: boolean) {
  const { artifact, project, current, versions } = input;
  const label = artifact.kind === "book" ? "book" : "presentation";
  const outline = fresh ? current.content.sections.map(section => [section.title, ...section.blocks.map(block => block.text)].filter(Boolean).join("\n")).join("\n\n").trim().slice(0, 20_000) : "";
  const history = versions.filter(version => version.number <= artifact.current_version).slice(0, 6).reverse().map(version => `v${version.number}: ${version.changeSummary}`).join("\n");
  const doc = editor.doc;
  const summary = doc.kind === "deck"
    ? doc.slides.map((slide, index) => `${index + 1}. [${slide.id}] ${slide.layout}: ${slide.title}`).join("\n")
    : doc.chapters.map((chapter, index) => `${index + 1}. [${chapter.id}] ${chapter.title} (${wordCount(chapter.text)} words)`).join("\n");
  return [
    `<project kind="${label}" title="${artifact.title.replace(/"/g, "'")}">`,
    `Brief: ${project.brief || "(none)"}`,
    project.audience ? `Audience: ${project.audience}` : "", project.purpose ? `Purpose: ${project.purpose}` : "",
    `Visual direction: ${documentStyleDirection(artifact.kind, project.styleId, current.style)}`,
    input.brand ? documentBrandBlock(input.brand, artifact.kind === "book" ? "book" : "presentation") : "",
    outline && outline !== artifact.title ? `Existing outline content to use:\n${outline}` : "",
    history ? `Recent revisions:\n${history}` : "",
    "</project>",
    fresh
      ? `<current_document>(empty — create the complete ${label} from scratch; the default theme below is only a placeholder)\n${JSON.stringify({ theme: doc.theme })}</current_document>`
      : `<current_document>\nOrder:\n${summary || "(no items yet)"}\n\nFull source:\n${editor.snapshot()}\n</current_document>`,
  ].filter(Boolean).join("\n");
}

/** SSE response for a book or presentation run. Mirrors the website flow:
 * credits are already reserved; this settles or releases them exactly once. */
export function documentBuildResponse(input: DocumentBuildInput): Response {
  const { client, hold, spend, artifact, current } = input;
  const rate = input.operation ? input.operation.rateMicrousd / 1e6 : aiCostUsdPerCredit();
  const measured = () => spend.customerCredits(rate);
  const fresh = !current.content.document;
  // A new deck is full-image unless the client chose (or asked for) editable text slides; a new book follows the
  // image plan from its questions or brief (creation-options.ts). Saved documents keep what they have.
  const options = `${input.project.brief}
${input.message}`;
  const editor = new DocumentEditor(current.content.document ?? emptyDocument(artifact.kind === "book" ? "book" : "deck", current.content.title || artifact.title, input.project.styleId,
    artifact.kind === "book" ? { imagePlan: bookImagePlanFromBrief(options) } : { slideMode: deckModeFromBrief(options).mode }));
  const context = [documentContext(input, editor, fresh), input.operation?.originalMessage ? `Original authorized request: ${input.operation.originalMessage}` : ""].filter(Boolean).join("\n");
  const encoder = new TextEncoder();
  const controller = new AbortController();
  const stopWatching = watchOperationCancellation(input.operation, spend, controller);
  const timeout = setTimeout(() => controller.abort(), (input.maxDuration - 20) * 1000);
  const stream = new ReadableStream<Uint8Array>({
    async start(output) {
      let open = true;
      const emit = (event: DocBuilderEvent | Record<string, unknown>) => {
        if (!open) return;
        try { output.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { open = false; }
      };
      const heartbeat = setInterval(() => { if (open) try { output.enqueue(encoder.encode(": keep-alive\n\n")); } catch { open = false; } }, 15_000);
      try {
        if (input.operation) emit({ type: "operation", operation: input.operation.operation });
        emit({ type: "status", message: fresh ? `Planning your ${artifact.kind}…` : `Reading your ${artifact.kind}…` });
        let result;
        try {
          result = await runDocumentBuilder({ client, scope: { workspaceId: input.workspaceId, projectId: artifact.project_id }, editor, effort: input.effort,
            spend, request: input.message, context, attachments: input.attachments, emit, signal: controller.signal, deadline: Date.now() + (input.maxDuration - 20) * 1000,
            anthropic: input.anthropic, imageClient: input.imageClient, storeImage: input.storeImage });
        } catch (error) {
          if (!editor.changed || (error as { code?: string }).code === "REFUSED" || aiStop(error)) throw error;
          emit({ type: "status", message: "Saving the work finished so far…" });
          result = { summary: "Saved the progress made so far. Ask me to continue to finish the remaining parts.", credits: measured(), usd: spend.providerMicrousd / 1e6, finished: false, stopped: spend.stopped };
        }
        const detail = { calls: spend.calls.length, providerMicrousd: spend.providerMicrousd, uncertainMicrousd: spend.uncertainMicrousd, stopped: spend.stopped };
        if (!editor.changed) {
          if (input.operation) {
            // Nothing usable saved: never charged (provider cost absorbed). A finished no-change request stays chargeable.
            emit(operationTerminal(await finishOperation(input.operation, spend.confirmedMicrousd, result.finished ? "incomplete" : "failed", { ...detail, code: "BUILD_INCOMPLETE", message: result.finished ? "Nothing changed." : "The builder stopped before a usable change was ready. Your previous saved document is safe.", version: artifact.current_version, changed: false, finished: result.finished })));
            return;
          }
          if (result.finished) await settleRun(hold, measured(), { ...detail, kind: "incomplete" });
          else await releaseRun(hold, measured(), "incomplete_nothing_saved", { ...detail, kind: "incomplete" });
          emit({ type: "error", code: "BUILD_INCOMPLETE", message: result.finished ? "Nothing changed." : "The builder ran out of room before finishing. Nothing was charged. Your document is unchanged — try a more focused request or a higher effort level." });
          return;
        }
        if (input.operation) {
          const doc = editor.doc;
          const summary = result.summary || (result.finished ? `Updated the ${artifact.kind}.` : "Saved the progress made so far. Continue to finish the remaining parts.");
          emit(operationTerminal(await finishOperation(input.operation, spend.confirmedMicrousd, "saved", { ...detail, summary, changed: true, finished: result.finished }, {
            content: { schemaVersion: 1, kind: artifact.kind, title: builtTitle(current.content.title, doc.title, input.project.brief, artifact.kind).slice(0, 200), sections: projectDocument(doc), document: doc },
            style: current.style, assetIds: [...new Set([...current.assetIds, ...documentAssetIds(doc)])],
            summary: `${input.message.slice(0, 600)} → ${summary}`.slice(0, 2000), expectedVersion: artifact.current_version,
          })));
          return;
        }
        // A reclaimed hold can no longer be charged: do not save work against it.
        if (!(await holdIsActive(hold))) {
          await releaseRun(hold, measured(), "hold_expired", detail);
          emit({ type: "error", code: "HOLD_EXPIRED", message: "This run took longer than its credit hold allows, so nothing was saved or charged. Please try again." });
          return;
        }
        const doc = editor.doc;
        const summary = result.summary || (result.finished ? `Updated the ${artifact.kind}.` : "Saved the progress made so far. Ask me to continue to finish the remaining parts.");
        const saved = await client.rpc("makeborne_save_artifact_version", {
          p_workspace_id: input.workspaceId, p_artifact_id: artifact.id, p_expected_version: artifact.current_version,
          p_content: { schemaVersion: 1, kind: artifact.kind, title: builtTitle(current.content.title, doc.title, input.project.brief, artifact.kind).slice(0, 200), sections: projectDocument(doc), document: doc },
          p_style: current.style, p_asset_ids: [...new Set([...current.assetIds, ...documentAssetIds(doc)])],
          p_change_summary: `${input.message.slice(0, 600)} → ${summary}`.slice(0, 2000), p_request_key: hold.reference,
        });
        if (saved.error || !saved.data?.version) {
          await releaseRun(hold, measured(), saved.error?.code === "PT409" ? "revision_conflict" : "save_failed", detail);
          emit({ type: "error", code: saved.error?.code === "PT409" ? "REVISION_CONFLICT" : "SAVE_FAILED", message: saved.error?.code === "PT409" ? "The project changed while building. Reload and try again — no credits were charged." : `The ${artifact.kind} was built but could not be saved. No credits were charged; please try again.` });
          return;
        }
        const settled = await settleRun(hold, measured(), { ...detail, kind: "saved" });
        emit({ type: "done", version: saved.data.version.version_number ?? artifact.current_version + 1, summary, charged: settled.charged, changed: true, finished: result.finished } as Record<string, unknown>);
      } catch (error) {
        if (input.operation) {
          const stop = logAiStop(hold.reference, error);
          let candidate: OperationCandidate | undefined;
          if (editor.changed) try { candidate = { content: { schemaVersion: 1, kind: artifact.kind, title: builtTitle(current.content.title, editor.doc.title, input.project.brief, artifact.kind).slice(0, 200), sections: projectDocument(editor.doc), document: editor.doc }, style: current.style,
            assetIds: [...new Set([...current.assetIds, ...documentAssetIds(editor.doc)])], summary: "Recovered the work completed before the builder stopped.", expectedVersion: artifact.current_version }; } catch { /* An invalid partial result must not become recoverable source. */ }
          emit(await operationFailure(input.operation, spend, { code: stop?.code ?? "BUILD_FAILED", message: stop?.message ?? "The builder stopped. Check the saved result and credit charge below.", stopped: spend.stopped, finished: false }, candidate));
          return;
        }
        await releaseRun(hold, measured(), "build_failed", { code: (error as { code?: string })?.code ?? null, stopped: spend.stopped }).catch(() => undefined);
        const stop = logAiStop(hold.reference, error);
        if (!stop) console.error("document build failed", error instanceof Error ? error.message : error);
        if (stop) emit({ type: "error", code: stop.code, message: stop.message, retryable: true });
        else emit({ type: "error", code: "BUILD_FAILED", message: (error as { code?: string }).code === "REFUSED" ? "This request can't be built. Try rephrasing it."
          : "The builder hit a problem and stopped. Your document is unchanged and no credits were charged." });
      } finally {
        stopWatching(); clearTimeout(timeout); clearInterval(heartbeat);
        if (open) try { output.close(); } catch { /* client already gone */ }
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}
