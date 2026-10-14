import "server-only";
import {createAnthropicTextAdapter, type AnthropicTextConfig, type AnthropicTextDependencies} from "../providers/anthropic-text";
import {createOpenAITextAdapter, type OpenAITextConfig, type TextDependencies, type TextOutcome} from "../providers/openai-text";
import {buildWebsiteSourcePrompt, validateGeneratedWebsiteSource, WebsiteSourceResponseSchema, WebsiteSourceValidationError} from "./website-source-contract";
import type {z} from "zod";

type Response = z.infer<typeof WebsiteSourceResponseSchema>;
type Generate = (input: unknown, signal: AbortSignal) => Promise<TextOutcome<Response>>;

/** Worker integration only. Existing dispatch/cost gates stay in the injected
 * adapter. Never save, execute, publish or charge from a provider response alone. */
function websiteGenerator(generate: Generate) {
  return async (attemptId: string, context: unknown, assets: unknown, signal: AbortSignal) => {
    const prompt = buildWebsiteSourcePrompt(context, assets);
    if (prompt.input.length > 200000) throw new WebsiteSourceValidationError("bounds");
    const result = await generate({attemptId, ...prompt}, signal);
    if (result.status !== "accepted") return result;
    try {
      return {status: "website_candidate" as const, candidate: validateGeneratedWebsiteSource(context, assets, result.value), evidence: result.evidence};
    } catch (error) {
      if (!(error instanceof WebsiteSourceValidationError)) throw error;
      return {status: "website_rejected" as const, reason: error.code, evidence: result.evidence};
    }
  };
}

export function createAnthropicWebsiteGenerator(config: AnthropicTextConfig, dependencies: AnthropicTextDependencies) {
  return websiteGenerator(createAnthropicTextAdapter(config, {name: "makeborne_website_source", schema: WebsiteSourceResponseSchema}, dependencies));
}
export function createOpenAIWebsiteGenerator(config: OpenAITextConfig, dependencies: TextDependencies) {
  return websiteGenerator(createOpenAITextAdapter(config, {name: "makeborne_website_source", schema: WebsiteSourceResponseSchema}, dependencies));
}
