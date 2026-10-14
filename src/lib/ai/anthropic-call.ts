import { UnsupportedConfigurationError, assertSupportedTextRequest, maxInputTokenMicrousd, maxOutputTokenMicrousd, serverToolBoundMicrousd, textCallBoundMicrousd, textUsageMicrousd, utf8Bytes, type TextUsageLike } from "./prices";
import { SpendError, type RunSpend } from "./run-spend";

/**
 * Budgeted Anthropic streaming calls for the live builder.
 * - No hidden retries: the SDK runs with maxRetries 0; retries happen here, and
 *   each attempt reserves its own bound from the run's remaining budget.
 * - No server-side fallback: Anthropic's "default" fallback targets are not
 *   published, so their price cannot be bounded. Optional explicit fallback
 *   models (priced in prices.ts) are tried here, from the same budget.
 * - Each call's max_tokens is shrunk to what the remaining budget can pay for.
 * - Usage that cannot be confirmed counts at the call's full bound.
 */
export type MessageLike = { model: string; usage: TextUsageLike; content: unknown[]; stop_reason: string | null };
export type StreamLike = {
  on(event: "streamEvent", listener: (event: never) => void): unknown;
  finalMessage(): Promise<MessageLike>;
  readonly currentMessage?: MessageLike | undefined;
};
export type AnthropicLike = { beta: { messages: {
  stream(params: Record<string, unknown>, options: { signal?: AbortSignal; maxRetries: number; timeout: number }): StreamLike;
  countTokens(params: Record<string, unknown>, options?: { signal?: AbortSignal; maxRetries?: number; timeout?: number }): Promise<{ input_tokens: number }>;
} } };

/** Rejected before any processing: nothing is billed for these. */
const REJECTED_BEFORE_PROCESSING = new Set([400, 401, 403, 404, 413, 429, 529]);
/** Worth another attempt when no output has started. 5xx attempts still count at their bound. */
const RETRYABLE = new Set([429, 500, 502, 503, 504, 529]);

/**
 * Upper bound on a request's input tokens. The first request is counted with
 * the (free) token-counting endpoint; afterwards the known input and output of
 * the last reply, with 5% headroom, plus the UTF-8 bytes of every message
 * appended since (a token covers at least one byte). Counting failure fails closed.
 */
export class ContextMeter {
  private base = 0;
  private baseLength = 0;
  private counted = false;
  constructor(private readonly count: (messages: unknown[]) => Promise<number>) {}

  async bound(messages: unknown[]): Promise<number> {
    if (!this.counted) {
      let tokens: number;
      try { tokens = await this.count(messages); } catch (error) {
        throw Object.assign(new SpendError("SPEND_UNAVAILABLE", "The request's cost could not be estimated, so it was not sent."), { cause: error });
      }
      if (!Number.isSafeInteger(tokens) || tokens < 1) throw new SpendError("SPEND_UNAVAILABLE", "The request's cost could not be estimated, so it was not sent.");
      this.base = Math.ceil(tokens * 1.02) + 512;
      this.baseLength = messages.length;
      this.counted = true;
      return this.base;
    }
    return this.base + messages.slice(this.baseLength).reduce<number>((total, message) => total + utf8Bytes(JSON.stringify(message)) + 64, 0);
  }

  /** Call right after appending the assistant reply: everything so far is covered by this usage. */
  afterReply(usage: TextUsageLike, messages: unknown[]) {
    const input = usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
    this.base = Math.ceil((input + usage.output_tokens) * 1.05) + 512;
    this.baseLength = messages.length;
    this.counted = true;
  }
}

export type BudgetedStream = {
  client: AnthropicLike;
  spend: RunSpend;
  meter: ContextMeter;
  /** Primary model first, then explicit fallbacks. Every model must be priced. */
  models: string[];
  /** Request parameters other than model and max_tokens. */
  params: Record<string, unknown> & { messages: unknown[] };
  maxTokens: number;
  /** Smallest output allowance worth a call; below it the run's budget is used up. */
  minTokens: number;
  signal: AbortSignal;
  onEvent?: (event: never) => void;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Longest single call (default 600 s); always cut to the run's remaining time. */
  timeoutMs?: number;
};

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function retryDelay(error: unknown, attempt: number) {
  const headers = (error as { headers?: { get?: (name: string) => string | null } | Record<string, string> }).headers;
  const raw = headers && typeof (headers as { get?: unknown }).get === "function"
    ? (headers as { get: (name: string) => string | null }).get("retry-after")
    : (headers as Record<string, string> | undefined)?.["retry-after"];
  const seconds = raw ? Number(raw) : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 30_000) : Math.min(1000 * 2 ** attempt, 8000);
}

export async function budgetedStream(call: BudgetedStream): Promise<{ message: MessageLike; model: string; costMicrousd: number; attempts: number }> {
  if (!call.models.length) throw new Error("No model configured.");
  const retries = call.retries ?? 2, sleep = call.sleep ?? wait, now = call.now ?? Date.now;
  const inputBound = await call.meter.bound(call.params.messages);
  let lastError: unknown = null, attempts = 0;
  for (const model of call.models) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (call.signal.aborted) throw lastError ?? new Error("The run was cancelled.");
      // Server tools (web search) add their fees and result tokens to the worst case before any output room.
      const toolBound = serverToolBoundMicrousd(model, call.params.tools);
      const inputCost = Math.ceil(inputBound * maxInputTokenMicrousd(model)) + toolBound;
      const room = Math.floor((call.spend.remainingMicrousd - inputCost) / maxOutputTokenMicrousd(model));
      const maxTokens = Math.min(call.maxTokens, room);
      if (maxTokens < call.minTokens) throw new SpendError("RUN_BUDGET", "The run's remaining budget cannot pay for another step.");
      const request = { ...call.params, model, max_tokens: maxTokens };
      assertSupportedTextRequest(request);
      const ticket = await call.spend.begin("anthropic", model, textCallBoundMicrousd(model, inputBound, maxTokens) + toolBound);
      attempts++;
      // Hard timeout: the call ends before the run's deadline (and so before the hold's settlement window).
      const timeout = Math.max(1, Math.min(call.timeoutMs ?? 600_000, call.spend.timeLeftMs()));
      const timer = AbortSignal.timeout(timeout);
      const stream = call.client.beta.messages.stream(request, { signal: AbortSignal.any([call.signal, timer]), maxRetries: 0, timeout });
      if (call.onEvent) stream.on("streamEvent", call.onEvent);
      let message: MessageLike;
      try {
        message = await stream.finalMessage();
      } catch (error) {
        const started = stream.currentMessage !== undefined;
        const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : undefined;
        if (!started && status !== undefined && REJECTED_BEFORE_PROCESSING.has(status)) {
          await call.spend.finish(ticket, { actualMicrousd: 0, detail: { status, attempt, model } });
        } else {
          // Started streams and transport failures: what was reported is confirmed, the rest stays at the bound.
          let partial = 0;
          if (started) try { partial = textUsageMicrousd(stream.currentMessage!.model || model, stream.currentMessage!.usage); } catch { partial = 0; }
          await call.spend.finish(ticket, { actualMicrousd: null, partialMicrousd: partial, detail: { status: status ?? null, started, attempt, model } });
        }
        lastError = error;
        if (timer.aborted && !call.signal.aborted) throw Object.assign(new SpendError("HOLD_EXPIRED", "The call reached the run's time limit and was stopped."), { cause: error });
        if (started || call.signal.aborted || status === undefined || !RETRYABLE.has(status)) throw error;
        if (attempt < retries) {
          const delay = retryDelay(error, attempt);
          if (now() + delay >= call.spend.deadline) throw error;
          await sleep(delay);
          continue;
        }
        break; // retries exhausted: next model, if any
      }
      let cost: number;
      try {
        // A response from another model is only acceptable when the per-attempt record explains it.
        if (message.model && message.model !== model && !message.usage.iterations?.length) throw new UnsupportedConfigurationError(`response from model "${message.model}" for a "${model}" request`);
        cost = textUsageMicrousd(message.model || model, message.usage);
      } catch (error) {
        // The response came from a model we cannot price: record it at the bound and stop.
        await call.spend.finish(ticket, { actualMicrousd: null, partialMicrousd: 0, detail: { reason: "unpriced_response", model: message.model } });
        throw error;
      }
      await call.spend.finish(ticket, { actualMicrousd: cost, detail: { model: message.model, attempt, stop: message.stop_reason } });
      return { message, model, costMicrousd: cost, attempts };
    }
  }
  throw lastError ?? new Error("The provider call failed.");
}

/** Explicit fallback models from MAKEBORNE_BUILDER_FALLBACK_MODELS (comma-separated). Off by default. */
export function builderModels(primary: string, env: Record<string, string | undefined> = process.env) {
  const fallbacks = (env.MAKEBORNE_BUILDER_FALLBACK_MODELS ?? "").split(",").map(item => item.trim()).filter(Boolean);
  return [...new Set([primary, ...fallbacks])];
}
