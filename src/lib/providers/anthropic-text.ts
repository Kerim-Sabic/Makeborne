import "server-only";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ConfigSchema = z.object({
  apiKey: z.string().min(1), model: z.string().min(1).max(160),
  maximumInputTokens: count.min(1).max(1_000_000),
  maximumOutputTokens: count.min(16).max(100_000),
  timeoutMs: count.min(1000).max(120_000),
}).strict();
const RequestSchema = z.object({
  attemptId: z.string().uuid(), instructions: z.string().min(1).max(30000),
  input: z.string().min(1).max(200000),
}).strict();
const UsageSchema = z.object({
  input_tokens: count, output_tokens: count,
  cache_creation_input_tokens: count.nullable().optional(),
  cache_read_input_tokens: count.nullable().optional(),
});
export type AnthropicTextConfig = z.input<typeof ConfigSchema>;
import type { TextOutcome, TextEvidence } from "./openai-text";
export type AnthropicTextDependencies = {
  spendingAllowed: () => boolean;
  /** Count the full request, including schema overhead, before reserving costs. */
  countInputTokens: (body: Readonly<MessageCreateParamsNonStreaming>) => Promise<number>;
  /** Atomically reserve the worst-case cost and claim the durable attempt.
   * False or an uncertain commit MUST NOT dispatch a billable request. */
  claimDispatch: (binding: { attemptId: string; requestHash: string }) => Promise<boolean>;
  fetch?: typeof fetch;
};

function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const safeId = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value) ? value : null;

/** One text-only Claude Messages attempt. No tools, URLs, automatic retries, prices,
 * database writes or customer charges. Output acceptance still needs product QA.
 * Not wired to any HTTP route; production routing remains unconfigured. */
export function createAnthropicTextAdapter<T>(configuration: AnthropicTextConfig, contract: { name: string; schema: z.ZodType<T> }, dependencies: AnthropicTextDependencies) {
  const config = ConfigSchema.parse(configuration);
  z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).parse(contract.name);
  const schema = z.toJSONSchema(contract.schema);
  if (schema.type !== "object" || Buffer.byteLength(JSON.stringify(schema)) > 100000) throw new Error("Use a bounded object output contract.");
  const client = new Anthropic({ apiKey: config.apiKey, baseURL: "https://api.anthropic.com", maxRetries: 0, timeout: config.timeoutMs, fetch: dependencies.fetch, fetchOptions: { redirect: "error" } });
  return async (input: unknown, signal: AbortSignal): Promise<TextOutcome<T>> => {
    if (!dependencies.spendingAllowed()) return { status: "not_dispatched", reason: "disabled" };
    const parsed = RequestSchema.safeParse(input);
    if (!parsed.success) return { status: "not_dispatched", reason: "invalid_request" };
    if (signal.aborted) return { status: "not_dispatched", reason: "cancelled" };
    const request = parsed.data;
    const body: MessageCreateParamsNonStreaming = freeze({
      model: config.model, system: request.instructions,
      messages: [{ role: "user", content: request.input }],
      max_tokens: config.maximumOutputTokens, stream: false,
      output_config: { format: zodOutputFormat(contract.schema) },
    });
    const requestHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    let tokens: number;
    try { tokens = await dependencies.countInputTokens(body); }
    catch { return { status: "not_dispatched", reason: "input_limit" }; }
    if (!count.safeParse(tokens).success || tokens > config.maximumInputTokens) return { status: "not_dispatched", reason: "input_limit" };
    if (signal.aborted) return { status: "not_dispatched", reason: "cancelled" };
    if (!dependencies.spendingAllowed()) return { status: "not_dispatched", reason: "disabled" };
    const evidence: TextEvidence = { attemptId: request.attemptId, requestHash, responseId: null, providerRequestId: null, model: null, usage: null };
    let claimed: boolean;
    try { claimed = await dependencies.claimDispatch({ attemptId: request.attemptId, requestHash }); }
    catch { return { status: "uncertain", reason: "claim", evidence }; }
    if (!claimed) return { status: "uncertain", reason: "claim", evidence };
    // Once claimed, even a pre-network cancellation retains the durable hold until
    // the worker records/reconciles the no-send outcome. Never silently release it.
    if (signal.aborted || !dependencies.spendingAllowed()) return { status: "uncertain", reason: "cancelled", evidence };
    try {
      const { data, request_id } = await client.messages.create(body, { signal, maxRetries: 0, timeout: config.timeoutMs }).withResponse();
      evidence.responseId = safeId(data.id); evidence.providerRequestId = safeId(request_id);
      evidence.model = typeof data.model === "string" ? data.model.slice(0, 160) : null;
      const usage = UsageSchema.safeParse(data.usage);
      if (usage.success) {
        const cached = usage.data.cache_read_input_tokens ?? 0;
        const written = usage.data.cache_creation_input_tokens ?? 0;
        const inputTokens = usage.data.input_tokens + cached + written;
        evidence.usage = {
          input_tokens: inputTokens, output_tokens: usage.data.output_tokens,
          total_tokens: inputTokens + usage.data.output_tokens,
          input_tokens_details: { cached_tokens: cached, cache_write_tokens: written },
          output_tokens_details: { reasoning_tokens: 0 },
        };
      }
      if (signal.aborted) return { status: "uncertain", reason: "cancelled", evidence };
      if (data.stop_reason === "refusal") return { status: "rejected", reason: "refusal", evidence };
      if (data.stop_reason !== "end_turn") return { status: "rejected", reason: "incomplete", evidence };
      if (data.model !== config.model) return { status: "rejected", reason: "model", evidence };
      if (!evidence.usage || evidence.usage.input_tokens > config.maximumInputTokens || evidence.usage.output_tokens > config.maximumOutputTokens || !evidence.responseId || !evidence.providerRequestId) return { status: "rejected", reason: "usage", evidence };
      // Opus 5.5 always returns adaptive-thinking blocks. Never render or persist
      // their contents; accept only the final text and reject tool/action blocks.
      if (data.role !== "assistant" || !Array.isArray(data.content) || data.content.some(block => !["text", "thinking", "redacted_thinking"].includes(block.type))) return { status: "rejected", reason: "output", evidence };
      const finalText = data.content.filter(block => block.type === "text");
      if (finalText.length !== 1) return { status: "rejected", reason: "output", evidence };
      const text = finalText[0].text;
      if (Buffer.byteLength(text) > 1_000_000) return { status: "rejected", reason: "output", evidence };
      let value: unknown;
      try { value = JSON.parse(text); } catch { return { status: "rejected", reason: "output", evidence }; }
      const output = contract.schema.safeParse(value);
      if (!output.success) return { status: "rejected", reason: "output", evidence };
      return { status: "accepted", value: output.data, evidence };
    } catch (error) {
      if (error instanceof Anthropic.APIError) evidence.providerRequestId = safeId(error.requestID);
      return { status: "uncertain", reason: signal.aborted ? "cancelled" : "transport", evidence };
    }
  };
}
