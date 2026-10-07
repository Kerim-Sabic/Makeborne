import "server-only";
import { createAnthropicTextAdapter, type AnthropicTextConfig, type AnthropicTextDependencies } from "../providers/anthropic-text";
import { buildDraftPrompt, DraftResponseSchema, DraftValidationError, validateDraftContext, validateGeneratedDraft } from "./draft-contract";

/** Draft-stage integration only. Does not approve, save, publish, charge, or run
 * image generation. The durable workflow owns these distinct operations. */
export function createAnthropicDraftGenerator(config: AnthropicTextConfig, dependencies: AnthropicTextDependencies) {
  const generate = createAnthropicTextAdapter(config, { name: "makeborne_draft", schema: DraftResponseSchema }, dependencies);
  return async (attemptId: string, contextInput: unknown, signal: AbortSignal) => {
    const context = validateDraftContext(contextInput);
    const prompt = buildDraftPrompt(context);
    const result = await generate({ attemptId, ...prompt }, signal);
    if (result.status !== "accepted") return result;
    try {
      return { status: "draft_ready" as const, draft: validateGeneratedDraft(context, result.value), evidence: result.evidence };
    } catch (error) {
      if (!(error instanceof DraftValidationError)) throw error;
      return { status: "draft_rejected" as const, reason: error.code, evidence: result.evidence };
    }
  };
}
