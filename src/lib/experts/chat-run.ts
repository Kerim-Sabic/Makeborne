import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaRawMessageStreamEvent } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { budgetedStream, ContextMeter, type AnthropicLike } from "../ai/anthropic-call";
import type { RunSpend } from "../ai/run-spend";
import { releaseRun, settleRun, type CreditHold } from "../credits/server";
import { aiCostUsdPerCredit } from "../builder/pricing";
import { logAiStop } from "../builder/website-run";
import { expertSystemPrompt } from "../expert-persona-instructions";
import { CHAT_MODES, type ChatMode, type ExpertId } from "../expert-personas";

/** Model and limits per mode. Genius uses the strongest model with deeper reasoning. */
export const CHAT_ROUTES: Readonly<Record<ChatMode, { model: string; effort: "medium" | "high"; maxTokens: number; minTokens: number; maxInputTokens: number }>> = {
  standard: { model: "claude-haiku-5-5", effort: "medium", maxTokens: 4_000, minTokens: 600, maxInputTokens: 30_000 },
  genius: { model: "claude-opus-5-5", effort: "medium", maxTokens: 6_000, minTokens: 1_500, maxInputTokens: 18_000 },
};
/** Prompts stay far below Haiku 5.5's 100,000-token price tier; each mode's cap keeps room for an answer inside its hold. */
export const MAX_CHAT_INPUT_TOKENS = Math.max(...Object.values(CHAT_ROUTES).map(route => route.maxInputTokens));
/** Provider dollars one credit buys in chat: the builder rate divided by the chat price multiple. */
export const chatCreditRate = (mode: ChatMode) => aiCostUsdPerCredit() / CHAT_MODES[mode].priceMultiplier;

export type ChatTurn = { role: "user" | "assistant"; content: string };
export type ChatStreamEvent =
  | { type: "status"; message: string }
  | { type: "text"; delta: string }
  | { type: "done"; charged: number; mode: ChatMode; truncated: boolean }
  | { type: "error"; code: string; message: string; retryable?: boolean };

export type ChatRunInput = {
  hold: CreditHold;
  spend: RunSpend;
  expert: ExpertId;
  mode: ChatMode;
  turns: ChatTurn[];
  maxDuration: number;
  /** The browser disconnecting stops the call; confirmed usage is still settled. */
  signal?: AbortSignal;
  anthropic?: AnthropicLike;
};

/** One expert reply (SSE). Charges confirmed usage only when an answer was produced; otherwise releases the hold. */
export function expertChatResponse(input: ChatRunInput): Response {
  const { hold, spend } = input;
  const route = CHAT_ROUTES[input.mode];
  // Customer price is a multiple of the provider cost (15x by default).
  const rate = chatCreditRate(input.mode);
  const encoder = new TextEncoder();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), (input.maxDuration - 20) * 1000);
  input.signal?.addEventListener("abort", () => controller.abort(), { once: true });
  const stream = new ReadableStream<Uint8Array>({
    async start(output) {
      let open = true, answer = "";
      const emit = (event: ChatStreamEvent) => {
        if (!open) return;
        try { output.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { open = false; }
      };
      const heartbeat = setInterval(() => { if (open) try { output.enqueue(encoder.encode(": keep-alive\n\n")); } catch { open = false; } }, 15_000);
      const detail = () => ({ kind: "expert_chat", expert: input.expert, mode: input.mode, calls: spend.calls.length, providerMicrousd: spend.providerMicrousd, uncertainMicrousd: spend.uncertainMicrousd, stopped: spend.stopped });
      try {
        emit({ type: "status", message: input.mode === "genius" ? "Thinking deeply…" : "Thinking…" });
        const client = input.anthropic ?? (new Anthropic({ maxRetries: 0, timeout: 600_000 }) as unknown as AnthropicLike);
        const system = [{ type: "text", text: expertSystemPrompt(input.expert) }];
        const messages = input.turns.map(turn => ({ role: turn.role, content: turn.content }));
        const meter = new ContextMeter(async counted => (await client.beta.messages.countTokens({ model: route.model, system, messages: counted },
          { signal: controller.signal, maxRetries: 0, timeout: Math.max(1, Math.min(30_000, spend.timeLeftMs())) })).input_tokens);
        if (await meter.bound(messages) > route.maxInputTokens) {
          await releaseRun(hold, 0, "chat_too_long", detail());
          emit({ type: "error", code: "CHAT_TOO_LONG", message: "This conversation is too long to continue. Start a new conversation; nothing was charged." });
          return;
        }
        const onEvent = (event: BetaRawMessageStreamEvent) => {
          if (event.type !== "content_block_delta") return;
          if (event.delta.type === "text_delta") { answer += event.delta.text; emit({ type: "text", delta: event.delta.text }); }
        };
        let stop: string | null = null;
        try {
          const { message } = await budgetedStream({ client, spend, meter, models: [route.model], maxTokens: route.maxTokens, minTokens: route.minTokens, signal: controller.signal,
            onEvent: onEvent as (event: never) => void,
            params: { betas: ["thinking-display-updates-2026-08-18"], thinking: { type: "adaptive", display: "updates" }, output_config: { effort: route.effort },
              cache_control: { type: "ephemeral" }, system, messages } });
          stop = message.stop_reason;
        } catch (error) {
          // Stopped by the reader (or the time limit) after part of an answer: keep and bill what was confirmed.
          if (!answer.trim() || !controller.signal.aborted) throw error;
        }
        if (stop === "refusal" && !answer.trim()) {
          await releaseRun(hold, spend.customerCredits(rate), "chat_refused", detail());
          emit({ type: "error", code: "REFUSED", message: "This question can't be answered here. Nothing was charged." });
          return;
        }
        if (!answer.trim()) {
          await releaseRun(hold, spend.customerCredits(rate), "chat_empty", detail());
          emit({ type: "error", code: "NO_ANSWER", message: "No answer came back. Nothing was charged; please try again." });
          return;
        }
        const settled = await settleRun(hold, spend.customerCredits(rate), detail());
        emit({ type: "done", charged: settled.charged, mode: input.mode, truncated: stop === "max_tokens" || controller.signal.aborted });
      } catch (error) {
        await releaseRun(hold, spend.customerCredits(rate), "chat_failed", { ...detail(), code: (error as { code?: string })?.code ?? null }).catch(() => undefined);
        const stop = logAiStop(hold.reference, error);
        if (stop) emit({ type: "error", code: stop.code, message: stop.message, retryable: true });
        else emit({ type: "error", code: "CHAT_FAILED", message: "The expert couldn't answer just now. Nothing was charged; please try again.", retryable: true });
      } finally {
        clearTimeout(timeout); clearInterval(heartbeat);
        if (open) try { output.close(); } catch { /* client already gone */ }
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}
