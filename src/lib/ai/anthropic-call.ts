import { createHash } from "node:crypto";
import { UnsupportedConfigurationError, assertSupportedTextRequest, cachedInputTokenMicrousd, maxInputTokenMicrousd, maxOutputTokenMicrousd, serverToolBoundMicrousd, textCallBoundMicrousd, textCallTierMultiplier, textTokenUsage, textUsageMicrousd, utf8Bytes, type TextUsageLike, type TokenUsage } from "./prices";
import { SpendError, type RunSpend } from "./run-spend";

/**
 * Budgeted Anthropic streaming calls for the live builder.
 * - No hidden retries: the SDK runs with maxRetries 0; retries happen here, and
 *   each attempt reserves its own bound from the run's remaining budget.
 * - No server-side fallback: Anthropic's "default" fallback targets are not
 *   published, so their price cannot be bounded. Optional explicit fallback
 *   models (priced in prices.ts) are tried here, from the same budget.
 * - Each call's max_tokens is shrunk to what the remaining budget can pay for.
 * - A call that continues a cached conversation reserves the cached prefix at
 *   the cache-read price; its worst case without the cache is reserved at the
 *   database gate (see run-spend.ts).
 * - Usage that cannot be confirmed counts at the call's full worst case.
 * - Every attempt's reported tokens are recorded with it.
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

/** A cache entry lives 5 minutes from the start of the request that wrote or last read it; a reservation relies on it for 4. */
export const CACHE_FRESH_MS = 240_000;
/** A cache breakpoint looks back at most 20 positions for an earlier entry; a reservation relies on it for 18. */
export const CACHE_LOOKBACK_POSITIONS = 18;

/** Positions appended messages take in the cache lookback: one per block, a run of tool_use or of tool_result blocks counting once. */
export function cachePositions(messages: unknown[]) {
  let positions = 0;
  for (const message of messages) {
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) { positions++; continue; }
    let previous: unknown = null;
    for (const block of content) {
      const type = (block as { type?: unknown })?.type;
      if (!(type === previous && (type === "tool_use" || type === "tool_result"))) positions++;
      previous = type;
    }
  }
  return positions;
}

/** What a request is cached under besides its messages: model, system, tools, thinking, effort, betas, cache settings. */
export function cacheKey(request: Record<string, unknown>) {
  const rest = { ...request };
  delete rest.messages;
  delete rest.max_tokens;
  return JSON.stringify(rest);
}
const fingerprint = (messages: unknown[]) => createHash("sha256").update(JSON.stringify(messages)).digest("hex");
const tokenCount = (value: number | null | undefined) => Number.isSafeInteger(value) && value! > 0 ? value! : 0;

/**
 * Upper bound on a request's input tokens. The first request is counted with
 * the (free) token-counting endpoint; afterwards the known input and output of
 * the last reply, with 5% headroom, plus the UTF-8 bytes of every message
 * appended since (a token covers at least one byte). Counting failure fails closed.
 * It also remembers what the last successful call read from and wrote to the
 * prompt cache: the prefix the next request can expect to read.
 */
export class ContextMeter {
  private base = 0;
  private baseLength = 0;
  private counted = false;
  private cache: { key: string; tokens: number; startedAt: number; length: number; prefix: string } | null = null;
  constructor(private readonly count: (messages: unknown[]) => Promise<number>) {}

  /** Input tokens the next request can expect from the cache: none unless it has the previous call's model and settings
   * (`key`), starts within CACHE_FRESH_MS of that call's start, keeps its messages unchanged and appends no more than
   * CACHE_LOOKBACK_POSITIONS. */
  cachedTokens(key: string, messages: unknown[], now: number) {
    const cache = this.cache;
    if (!cache || cache.key !== key || now - cache.startedAt >= CACHE_FRESH_MS || messages.length < cache.length) return 0;
    if (cachePositions(messages.slice(cache.length)) > CACHE_LOOKBACK_POSITIONS || fingerprint(messages.slice(0, cache.length)) !== cache.prefix) return 0;
    return cache.tokens;
  }

  /** After a successful call that started at `startedAt`: what it read from and wrote to the cache is the next request's cached prefix. */
  noteCache(key: string, messages: unknown[], usage: TextUsageLike, startedAt: number) {
    const tokens = tokenCount(usage.cache_read_input_tokens) + tokenCount(usage.cache_creation_input_tokens);
    this.cache = tokens > 0 ? { key, tokens, startedAt, length: messages.length, prefix: fingerprint(messages) } : null;
  }

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
    return this.base + messages.slice(this.baseLength).reduce<number>((total, message) => total + messageTokenBound(message), 0);
  }

  /** Call right after appending the assistant reply: everything so far is covered by this usage. */
  afterReply(usage: TextUsageLike, messages: unknown[]) {
    const input = usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
    this.base = Math.ceil((input + usage.output_tokens) * 1.05) + 512;
    this.baseLength = messages.length;
    this.counted = true;
  }
}

/** Per-image reservation for callers that plan ahead (docs-agent checkReserve). Images sent to the model are at most
 * 1280 × 720, which messageTokenBound counts at about 1,414 tokens; 4,800 also covers models that read images at higher
 * resolution. The meter itself counts each image by its pixel size (imageTokenBound). */
export const IMAGE_BLOCK_TOKEN_BOUND = 4_800;

/** Worst case for one image whose pixel size is unknown: the high-resolution vision tier
 * (2576 px long edge, ~3.75 MP) costs up to 4,784 tokens per image; with headroom. */
export const IMAGE_TOKENS_UNKNOWN = 6_000;

/** Pixel size of a base64 PNG, JPEG, GIF or WebP from its header, or null. */
export function base64ImageSize(data: string): { width: number; height: number } | null {
  let bytes: Buffer;
  try { bytes = Buffer.from(data, "base64"); } catch { return null; }
  const u16be = (at: number) => bytes.readUInt16BE(at), u16le = (at: number) => bytes.readUInt16LE(at), u24le = (at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
  try {
    if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    if (bytes.length >= 10 && bytes.toString("latin1", 0, 3) === "GIF") return { width: u16le(6), height: u16le(8) };
    if (bytes.length >= 30 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") {
      const chunk = bytes.toString("latin1", 12, 16);
      if (chunk === "VP8X") return { width: u24le(24) + 1, height: u24le(27) + 1 };
      if (chunk === "VP8L") { const bits = bytes.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }; }
      if (chunk === "VP8 ") return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
      return null;
    }
    if (bytes.length >= 4 && u16be(0) === 0xffd8) {
      // Walk the JPEG segments to the first start-of-frame marker.
      let at = 2;
      while (at + 9 < bytes.length) {
        if (bytes[at] !== 0xff) return null;
        const marker = bytes[at + 1];
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) { at += marker === 0xff ? 1 : 2; continue; }
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: u16be(at + 7), height: u16be(at + 5) };
        at += 2 + u16be(at + 2);
      }
    }
  } catch { return null; }
  return null;
}

/**
 * Upper bound on an image block's input tokens. Claude bills about width × height / 750
 * tokens per image and never upscales; the bound pads each edge by one 28 px patch and
 * divides by 700. An image whose size cannot be read counts at IMAGE_TOKENS_UNKNOWN.
 */
export function imageTokenBound(source: unknown): number {
  const data = (source as { type?: unknown; data?: unknown } | null)?.type === "base64" ? (source as { data?: unknown }).data : null;
  const size = typeof data === "string" ? base64ImageSize(data) : null;
  if (!size || size.width < 1 || size.height < 1) return IMAGE_TOKENS_UNKNOWN;
  return Math.min(IMAGE_TOKENS_UNKNOWN, Math.ceil((size.width + 28) * (size.height + 28) / 700)) + 16;
}

/**
 * Upper bound on a message's input tokens: one token per UTF-8 byte of its JSON (a token
 * covers at least one byte of text), except that image blocks count by their pixel size
 * (their base64 bytes say nothing about the tokens they cost, in either direction).
 */
export function messageTokenBound(message: unknown): number {
  let images = 0;
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (!value || typeof value !== "object") return value;
    const block = value as Record<string, unknown>;
    if (block.type === "image") { images += imageTokenBound(block.source); return { type: "image" }; }
    return Object.fromEntries(Object.entries(block).map(([key, item]) => [key, strip(item)]));
  };
  return utf8Bytes(JSON.stringify(strip(message))) + 64 + images;
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
  // Unsupported tools/configuration must fail before even the free counting endpoint.
  for (const model of call.models) assertSupportedTextRequest({ ...call.params, model, max_tokens: call.maxTokens });
  const retries = call.retries ?? 2, sleep = call.sleep ?? wait, now = call.now ?? Date.now;
  const inputBound = await call.meter.bound(call.params.messages);
  let lastError: unknown = null, attempts = 0;
  for (const model of call.models) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (call.signal.aborted) throw lastError ?? new Error("The run was cancelled.");
      // Server tools (web search) add their fees and result tokens to the worst case before any output room.
      const toolBound = serverToolBoundMicrousd(model, call.params.tools);
      const tier = textCallTierMultiplier(model, inputBound);
      // The prefix the previous call cached is reserved at the read price; without the cache the call costs its worst case,
      // which must fit the run's room for a dropped cache. Output room is what both leave.
      const key = cacheKey({ ...call.params, model });
      const cached = Math.min(inputBound, call.meter.cachedTokens(key, call.params.messages, now()));
      const worstInput = Math.ceil(inputBound * maxInputTokenMicrousd(model) * tier) + toolBound + 2;
      const expectedInput = Math.ceil(((inputBound - cached) * maxInputTokenMicrousd(model) + cached * cachedInputTokenMicrousd(model)) * tier) + toolBound + 2;
      const room = Math.floor(Math.min(call.spend.remainingMicrousd - expectedInput, call.spend.worstCaseRoomMicrousd - worstInput) / (maxOutputTokenMicrousd(model) * tier));
      const maxTokens = Math.min(call.maxTokens, room);
      if (maxTokens < call.minTokens) throw new SpendError("RUN_BUDGET", "The run's remaining budget cannot pay for another step.");
      const request = { ...call.params, model, max_tokens: maxTokens };
      assertSupportedTextRequest(request);
      const ticket = await call.spend.begin("anthropic", model, textCallBoundMicrousd(model, inputBound, maxTokens, cached) + toolBound,
        { worstCaseMicrousd: textCallBoundMicrousd(model, inputBound, maxTokens) + toolBound });
      attempts++;
      const reserved = cached ? { cachedTokens: cached } : {};
      // Hard timeout: the call ends before the run's deadline (and so before the hold's settlement window).
      const timeout = Math.max(1, Math.min(call.timeoutMs ?? 600_000, call.spend.timeLeftMs()));
      const timer = AbortSignal.timeout(timeout);
      let stream: StreamLike | undefined;
      let message: MessageLike;
      const startedAt = now();
      try {
        stream = call.client.beta.messages.stream(request, { signal: AbortSignal.any([call.signal, timer]), maxRetries: 0, timeout });
        if (call.onEvent) stream.on("streamEvent", call.onEvent);
        message = await stream.finalMessage();
      } catch (error) {
        const started = stream?.currentMessage !== undefined;
        const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : undefined;
        if (!started && status !== undefined && REJECTED_BEFORE_PROCESSING.has(status)) {
          await call.spend.finish(ticket, { actualMicrousd: 0, detail: { status, attempt, model, ...reserved } });
        } else {
          // Started streams and transport failures: what was reported is confirmed, the rest stays at the worst case.
          let partial = 0, usage: TokenUsage | null = null;
          if (started) try {
            partial = textUsageMicrousd(stream!.currentMessage!.model || model, stream!.currentMessage!.usage);
            usage = textTokenUsage(stream!.currentMessage!.usage);
          } catch { partial = 0; }
          await call.spend.finish(ticket, { actualMicrousd: null, partialMicrousd: partial, usage, detail: { status: status ?? null, started, attempt, model, ...reserved } });
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
        await call.spend.finish(ticket, { actualMicrousd: null, partialMicrousd: 0, detail: { reason: "unpriced_response", model: message.model, ...reserved } });
        throw error;
      }
      await call.spend.finish(ticket, { actualMicrousd: cost, usage: textTokenUsage(message.usage), detail: { model: message.model, attempt, stop: message.stop_reason, ...reserved } });
      // A cache written by a fallback model belongs to that model, so the key uses the model that served the call.
      call.meter.noteCache(cacheKey({ ...call.params, model: message.model || model }), call.params.messages, message.usage, startedAt);
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
