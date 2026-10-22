import type { DocBuilderResult } from "./docs-agent";
import type { DocumentEditor } from "../documents/editor";
import type { DocumentSource } from "../documents/schema";
import { runRouted, type ModelRoute, type RouteEvent } from "../ai/model-routing";
import type { RunSpend } from "../ai/run-spend";

/**
 * One book or deck stage on its routed model, with at most one escalation to the builder model
 * (../ai/model-routing.ts). A document stage is one pass: a routed attempt that does not finish (or is refused)
 * is retried once from the saved document, and the client's preview is reset first.
 * Shared by the build route (docs-run.ts) and the eval harness, so both run exactly this logic.
 */
export function routedDocumentStage(input: {
  route: ModelRoute; editor: DocumentEditor; spend: RunSpend; deadline: number; signal: AbortSignal;
  emit: (event: RouteEvent | { type: "status"; message: string } | { type: "document"; document: DocumentSource }) => void;
  attempt: (model: string, deadline: number) => Promise<DocBuilderResult>;
}) {
  const { editor, emit } = input;
  const saved = structuredClone(editor.doc);
  return runRouted({ route: input.route, stage: "document", spend: input.spend, deadline: input.deadline, singlePass: true, signal: input.signal, emit, attempt: input.attempt,
    failed: attempted => attempted.finished ? null : attempted.stopped ? `stopped (${attempted.stopped}) before finishing` : "did not pass the finish checks",
    reset: () => { editor.restore(saved); emit({ type: "document", document: editor.doc }); } });
}
