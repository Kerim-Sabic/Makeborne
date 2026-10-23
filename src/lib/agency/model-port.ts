import { ContextMeter, budgetedStream, type AnthropicLike } from "../ai/anthropic-call";
import type { ModelBlock, ModelPort } from "./loop";
import type { QualifiedSetting } from "./task";

/**
 * The lead/specialist model turn on the existing budgeted stream:
 * - the request shape is checked against the price card before anything is
 *   counted (unknown parameters, tools or models fail closed);
 * - each attempt reserves its worst case through the RunSpend first;
 * - retries are OFF: an attempt that failed or timed out after it may have
 *   executed is recorded (uncertain at its bound) and ends the step instead
 *   of being repeated; the customer is charged only confirmed usage;
 * - no fallback models: the qualified setting names exactly one.
 */
export function anthropicModelPort(client: AnthropicLike, setting: QualifiedSetting): ModelPort {
  // One meter per conversation (the loop reuses its messages array across turns).
  const meters = new WeakMap<unknown[], ContextMeter>();
  return async request => {
    let meter = meters.get(request.messages);
    if (!meter) {
      meter = new ContextMeter(async messages => (await client.beta.messages.countTokens({ model: setting.model, system: request.system, tools: request.tools, messages },
        { signal: request.signal, maxRetries: 0, timeout: Math.max(1, Math.min(30_000, request.spend.timeLeftMs())) })).input_tokens);
      meters.set(request.messages, meter);
    }
    const { message } = await budgetedStream({ client, spend: request.spend, meter, models: [setting.model], retries: 0, signal: request.signal,
      maxTokens: Math.min(request.maxOutputTokens, setting.maxOutputTokens), minTokens: 256,
      params: { system: request.system, messages: request.messages, tools: request.tools, output_config: { effort: setting.intensity } } });
    // The loop appends this reply next; the meter's base covers it.
    meter.afterReply(message.usage, [...request.messages, null]);
    const content: ModelBlock[] = [];
    for (const block of message.content as Array<Record<string, unknown>>) {
      if (block?.type === "text" && typeof block.text === "string") content.push({ type: "text", text: block.text });
      else if (block?.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") content.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });
    }
    return { content, stopReason: message.stop_reason };
  };
}
