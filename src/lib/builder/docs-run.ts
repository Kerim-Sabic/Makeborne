import "server-only";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArtifactVersion } from "../domain";
import type { EffortLevel } from "../routing/effort";
import { releaseCredits, settleCredits } from "../credits/server";
import { DocumentEditor, emptyDocument } from "../documents/editor";
import { projectDocument, documentAssetIds } from "../documents/project";
import { wordCount } from "../documents/book-markup";
import { runDocumentBuilder, type DocBuilderEvent } from "./docs-agent";
import { styleDirection } from "./prompt";

export type DocumentBuildInput = {
  client: SupabaseClient;
  userId: string;
  runId: string;
  budget: number;
  workspaceId: string;
  artifact: { id: string; project_id: string; kind: "book" | "presentation"; title: string; current_version: number };
  project: { brief: string; styleId: string; audience?: string; purpose?: string };
  current: ArtifactVersion;
  versions: ArtifactVersion[];
  message: string;
  effort: EffortLevel;
  attachments: BetaContentBlockParam[];
  maxDuration: number;
};

/** Model-facing context: brief, style, history, and the current document. */
export function documentContext(input: Pick<DocumentBuildInput, "artifact" | "project" | "current" | "versions">, editor: DocumentEditor, fresh: boolean) {
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
    `Visual direction: ${styleDirection(project.styleId, current.style) || "No preset — choose the best direction for this subject."}`,
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
  const { client, userId, runId, budget, artifact, current } = input;
  const fresh = !current.content.document;
  const editor = new DocumentEditor(current.content.document ?? emptyDocument(artifact.kind === "book" ? "book" : "deck", current.content.title || artifact.title, input.project.styleId));
  const context = documentContext(input, editor, fresh);
  const encoder = new TextEncoder();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), (input.maxDuration - 20) * 1000);
  const stream = new ReadableStream<Uint8Array>({
    async start(output) {
      let open = true;
      const emit = (event: DocBuilderEvent) => {
        if (!open) return;
        try { output.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { open = false; }
      };
      const heartbeat = setInterval(() => { if (open) try { output.enqueue(encoder.encode(": keep-alive\n\n")); } catch { open = false; } }, 15_000);
      try {
        emit({ type: "status", message: fresh ? `Planning your ${artifact.kind}…` : `Reading your ${artifact.kind}…` });
        let result, spent = 0;
        const track = (event: DocBuilderEvent) => { if (event.type === "usage") spent = event.credits; emit(event); };
        try {
          result = await runDocumentBuilder({ client, scope: { workspaceId: input.workspaceId, projectId: artifact.project_id }, editor, effort: input.effort,
            creditBudget: budget, request: input.message, context, attachments: input.attachments, emit: track, signal: controller.signal, deadline: Date.now() + (input.maxDuration - 20) * 1000 });
        } catch (error) {
          if (!editor.changed || (error as { code?: string }).code === "REFUSED") throw error;
          emit({ type: "status", message: "Saving the work finished so far…" });
          result = { summary: "Saved the progress made so far. Ask me to continue to finish the remaining parts.", credits: spent, usd: 0, finished: false };
        }
        const charge = Math.min(result.credits, budget);
        if (!editor.changed) {
          await settleCredits(userId, runId, charge);
          emit({ type: "error", code: "BUILD_INCOMPLETE", message: result.finished ? "Nothing changed." : "The builder ran out of room before finishing. Your document is unchanged — try a more focused request or a higher effort level." });
          return;
        }
        const doc = editor.doc;
        const summary = result.summary || (result.finished ? `Updated the ${artifact.kind}.` : "Saved the progress made so far. Ask me to continue to finish the remaining parts.");
        const saved = await client.rpc("makeborne_save_artifact_version", {
          p_workspace_id: input.workspaceId, p_artifact_id: artifact.id, p_expected_version: artifact.current_version,
          p_content: { schemaVersion: 1, kind: artifact.kind, title: doc.title.slice(0, 200), sections: projectDocument(doc), document: doc },
          p_style: current.style, p_asset_ids: [...new Set([...current.assetIds, ...documentAssetIds(doc)])],
          p_change_summary: `${input.message.slice(0, 600)} → ${summary}`.slice(0, 2000), p_request_key: runId,
        });
        if (saved.error || !saved.data?.version) {
          await releaseCredits(userId, runId);
          emit({ type: "error", code: saved.error?.code === "PT409" ? "REVISION_CONFLICT" : "SAVE_FAILED", message: saved.error?.code === "PT409" ? "The project changed while building. Reload and try again — no credits were charged." : `The ${artifact.kind} was built but could not be saved. No credits were charged; please try again.` });
          return;
        }
        const charged = (await settleCredits(userId, runId, charge)).charged;
        emit({ type: "done", version: saved.data.version.version_number ?? artifact.current_version + 1, summary, charged });
      } catch (error) {
        await releaseCredits(userId, runId).catch(() => undefined);
        const message = (error as { code?: string }).code === "REFUSED" ? "This request can't be built. Try rephrasing it." : "The builder hit a problem and stopped. Your document is unchanged and no credits were charged.";
        console.error("document build failed", error instanceof Error ? error.message : error);
        emit({ type: "error", code: "BUILD_FAILED", message });
      } finally {
        clearTimeout(timeout); clearInterval(heartbeat);
        if (open) try { output.close(); } catch { /* client already gone */ }
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}
