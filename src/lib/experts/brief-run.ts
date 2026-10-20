import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { budgetedStream, ContextMeter, type AnthropicLike } from "../ai/anthropic-call";
import type { RunSpend } from "../ai/run-spend";
import { releaseRun, settleRun, type CreditHold } from "../credits/server";
import { logAiStop } from "../builder/website-run";
import { RequestError } from "../server/http";
import type { ExpertId } from "../expert-personas";
import { briefPrompt, parseAdvisorBrief, type AdvisorBriefFields } from "./advisor-brief";
import { CHAT_ROUTES, chatCreditRate, type ChatTurn } from "./chat-run";

/** Drafting a brief is a Standard advisor action: the same model, rate and hold, at low effort. */
export const BRIEF_ROUTE = { model: CHAT_ROUTES.standard.model, effort: "low" as const, maxTokens: 1_500, minTokens: 600, maxInputTokens: CHAT_ROUTES.standard.maxInputTokens };

export type BriefRunInput = {
  hold: CreditHold; spend: RunSpend; expert: ExpertId; turns: ChatTurn[];
  signal?: AbortSignal; anthropic?: AnthropicLike;
};

/**
 * One capped call that turns the conversation into a structured brief. Advice
 * only: no tools, nothing read or written beyond the conversation sent. A valid
 * brief is charged by confirmed usage (Standard rate, never above the hold);
 * any unusable, refused or failed reply releases the hold and charges nothing.
 */
export async function runAdvisorBrief(input: BriefRunInput): Promise<{ brief: AdvisorBriefFields; charged: number }> {
  const { hold, spend } = input;
  const rate = chatCreditRate("standard");
  const detail = () => ({ kind: "advisor_brief", expert: input.expert, calls: spend.calls.length, providerMicrousd: spend.providerMicrousd, uncertainMicrousd: spend.uncertainMicrousd });
  const controller = new AbortController();
  input.signal?.addEventListener("abort", () => controller.abort(), { once: true });
  let brief: AdvisorBriefFields | null = null, stop: string | null = null;
  try {
    const client = input.anthropic ?? (new Anthropic({ maxRetries: 0, timeout: 120_000 }) as unknown as AnthropicLike);
    const system = [{ type: "text", text: "You turn an advisor conversation into a clear, honest project brief. You never invent facts. Reply with JSON only." }];
    const messages = [{ role: "user", content: briefPrompt(input.expert, input.turns) }];
    const meter = new ContextMeter(async counted => (await client.beta.messages.countTokens({ model: BRIEF_ROUTE.model, system, messages: counted },
      { signal: controller.signal, maxRetries: 0, timeout: Math.max(1, Math.min(30_000, spend.timeLeftMs())) })).input_tokens);
    if (await meter.bound(messages) > BRIEF_ROUTE.maxInputTokens) {
      await releaseRun(hold, 0, "brief_too_long", detail());
      throw new RequestError("CHAT_TOO_LONG", "This conversation is too long to summarise. Start a new chat with the key points; nothing was charged.", 413);
    }
    const { message } = await budgetedStream({ client, spend, meter, models: [BRIEF_ROUTE.model], maxTokens: BRIEF_ROUTE.maxTokens, minTokens: BRIEF_ROUTE.minTokens, signal: controller.signal,
      params: { output_config: { effort: BRIEF_ROUTE.effort }, system, messages } });
    stop = message.stop_reason;
    const text = (message.content as Array<{ type: string; text?: string }>).filter(block => block.type === "text").map(block => block.text ?? "").join("");
    brief = stop === "refusal" ? null : parseAdvisorBrief(text);
  } catch (error) {
    if (error instanceof RequestError) throw error;
    await releaseRun(hold, spend.customerCredits(rate), "brief_failed", { ...detail(), code: (error as { code?: string })?.code ?? null }).catch(() => undefined);
    const stopped = logAiStop(hold.reference, error);
    throw new RequestError(stopped?.code ?? "BRIEF_FAILED", stopped?.message ?? "The brief couldn't be drafted just now. Nothing was charged; please try again.", 503);
  }
  if (!brief) {
    // Measured usage is recorded as absorbed: an unusable draft is not the customer's cost.
    await releaseRun(hold, spend.customerCredits(rate), stop === "refusal" ? "brief_refused" : "brief_unusable", detail());
    throw new RequestError(stop === "refusal" ? "REFUSED" : "BRIEF_UNUSABLE", stop === "refusal" ? "This conversation can't be summarised here. Nothing was charged." : "The draft brief came back incomplete. Nothing was charged; please try again.", 422);
  }
  const settled = await settleRun(hold, spend.customerCredits(rate), detail());
  return { brief, charged: settled.charged };
}
