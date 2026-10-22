import type { DocBuilderResult } from "./docs-agent";
import type { DocumentEditor } from "../documents/editor";
import type { DocumentSource } from "../documents/schema";
import { documentEvidence, type CheckId } from "./acceptance";
import { runRouted, type AttemptRole, type RouteEvent, type RoutingDecision } from "../ai/model-routing";
import type { RunSpend } from "../ai/run-spend";

/**
 * One book or deck stage under its routing decision (../ai/model-routing.ts runRouted). A document stage is one pass:
 * an attempt that does not finish may be repaired once from the current document, then escalated once from the saved
 * document (the client's preview is reset first). Shared by the build route (docs-run.ts) and the eval harness.
 */
export function routedDocumentStage(input: {
  route: RoutingDecision; editor: DocumentEditor; spend: RunSpend; deadline: number; signal: AbortSignal;
  emit: (event: RouteEvent | { type: "status"; message: string } | { type: "document"; document: DocumentSource }) => void;
  attempt: (plan: { role: AttemptRole; model: string; deadline: number; repairNotes: string[] }) => Promise<DocBuilderResult>;
}) {
  const { editor, emit, route } = input;
  const saved = structuredClone(editor.doc);
  return runRouted({ route, stage: "document", spend: input.spend, deadline: input.deadline, signal: input.signal, emit, attempt: input.attempt,
    evaluate: attempted => {
      const checks = documentEvidence(attempted.finished, route.inLoopChecks as CheckId[]);
      return attempted.finished ? { kind: "accept" as const, checks, problems: [] } : { kind: "incomplete" as const, checks, problems: attempted.stopped ? [`stopped (${attempted.stopped}) before finishing`] : [] };
    },
    reset: () => { editor.restore(saved); emit({ type: "document", document: editor.doc }); } });
}
