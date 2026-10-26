/**
 * Provider prices for the live builder, as reviewable evidence. Amounts are
 * micro-USD per token (equal to USD per million tokens). Prices are keyed by
 * the exact API model ID, never by a display label: each record cites the page
 * that maps the label to the ID and the pages that price it. Anything not
 * listed (model, quality, size, speed, region, server tool, cache TTL, beta)
 * fails closed: no bound, no call.
 */
export type PriceEvidence = {
  provider: "anthropic" | "openai";
  /** Exact API model ID sent in requests and expected back in responses. */
  model: string;
  /** Display label on the provider pages (for the reviewer only; never used for lookup). */
  label: string;
  verifiedAt: string;
  /** Where the label-to-API-ID mapping is published. */
  idSource: string;
  /** Where each billable component is priced. */
  priceSources: string[];
  /** Every billable component, micro-USD per token. */
  components: Record<string, number>;
  notes: string[];
  /** Provider shutdown; calls are refused from this instant. */
  retiresAt?: string;
};

export const PRICE_EVIDENCE: readonly PriceEvidence[] = Object.freeze(<PriceEvidence[]>[
  {
    provider: "anthropic", model: "claude-opus-5-5", label: "Claude Opus 5.5", verifiedAt: "2026-10-25",
    idSource: "https://platform.claude.com/docs/en/about-claude/models/overview (Claude API ID column)",
    priceSources: ["https://platform.claude.com/docs/en/about-claude/pricing (Model pricing table)",
      "https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback (Billing and rate limits)"],
    components: { input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20 },
    notes: ["Cache reads are 0.05x base input on Opus 5.5.", "Full 1M context at standard pricing (no long-context tier).",
      "US-only inference (inference_geo us) is 1.1x on every category; bounds assume it.",
      "Fast mode ($8/$40) is not supported here and fails closed.", "Thinking tokens are billed as output.",
      "Tool use adds a 286-token system prompt (input); counted by the token-counting endpoint.",
      "Batch (50% off) and server tools (web search $10 per 1,000) are not used and are refused.",
      "Fallback attempts are billed per attempt in usage.iterations."],
  },
  {
    provider: "anthropic", model: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", verifiedAt: "2026-10-25",
    idSource: "https://platform.claude.com/docs/en/about-claude/models/overview (Claude API ID column)",
    priceSources: ["https://platform.claude.com/docs/en/about-claude/pricing (Model pricing table)"],
    components: { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1, output: 10 },
    notes: ["Cache reads are 0.05x base input on Sonnet 5.5.", "Same geo, fast-mode, batch and server-tool notes as Opus 5.5.",
      "Used only when configured as an explicit fallback."],
  },
  {
    provider: "anthropic", model: "claude-haiku-5-5", label: "Claude Haiku 5.5", verifiedAt: "2026-10-25",
    idSource: "https://platform.claude.com/docs/en/about-claude/models/overview (Claude API ID column)",
    priceSources: ["https://platform.claude.com/docs/en/about-claude/pricing (Model pricing table, \"Claude Haiku 5.5 (for prompts up to 100,000 tokens)\")"],
    components: { input: 0.1, cacheWrite5m: 0.125, cacheWrite1h: 0.2, cacheRead: 0.01, output: 0.5 },
    notes: ["Prices are the up-to-100,000-token tier. Prompts over 100,000 tokens cost 5x ($0.50/$2.50); bounds and usage both apply that tier.",
      "US-only inference (inference_geo us) is 1.1x on every category; bounds assume it.",
      "Thinking tokens are billed as output.", "Used for standard expert chat replies."],
  },
  {
    provider: "openai", model: "gpt-image-1", label: "GPT Image 1", verifiedAt: "2026-10-12",
    idSource: "https://developers.openai.com/api/docs/models/gpt-image-1 (model ID and only snapshot: gpt-image-1)",
    priceSources: ["https://developers.openai.com/api/docs/pricing (Image models, standard)",
      "https://developers.openai.com/api/docs/models/gpt-image-1 (token and per-image prices)",
      "https://developers.openai.com/api/docs/guides/image-generation (output tokens, models prior to gpt-image-2)"],
    components: { textInput: 5, textCachedInput: 1.25, imageInput: 10, imageCachedInput: 2.5, imageOutput: 40 },
    notes: ["Output tokens per image: low 272/408/400, medium 1056/1584/1568, high 4160/6240/6208 (square/portrait/landscape).",
      "Published per-image price for medium portrait is $0.063 (= 1,584 x $40/M).",
      "Cached input is priced at the full input rate here (conservative).",
      "Only medium quality, n=1, text-only prompts (no image input) are supported here.",
      "The 10% regional-processing uplift applies only to models released on or after 2026-03-05; bounds include 1.1x anyway.",
      "RETIRING: https://developers.openai.com/api/docs/deprecations (2026-04-22 entry) shuts gpt-image-1 down on 2026-10-23; calls are refused from that date."],
    retiresAt: "2026-10-23T00:00:00Z",
  },
  {
    provider: "openai", model: "gpt-image-2", label: "GPT Image 2", verifiedAt: "2026-10-13",
    idSource: "https://developers.openai.com/api/docs/models/gpt-image-2 (model ID gpt-image-2, snapshot gpt-image-2-2026-04-21; no deprecation note)",
    priceSources: ["https://developers.openai.com/api/docs/pricing (Image models, standard: text input $5, image input $8, image output $30 per 1M)",
      "https://developers.openai.com/api/docs/guides/image-generation (per-image cost table for gpt-image-2: low $0.006/$0.005/$0.005, medium $0.053/$0.041/$0.041, high $0.211/$0.165/$0.165 for square/portrait/landscape)"],
    components: { textInput: 5, textCachedInput: 1.25, imageInput: 8, imageCachedInput: 2, imageOutput: 30 },
    notes: ["Output tokens per image are derived from the published per-image prices: ceil((price + $0.0005) / $30 per 1M). The $0.0005 (0.05 cent) covers the prices being rounded to a tenth of a cent.",
      "Cached input pricing applies only to the Responses API image tool, not the Images API used here.",
      "Usage reporting in Images API responses for this model is not documented; without usage the bound is recorded as spent.",
      "Live-qualified once, 2026-10-20: one approved medium 1024x1024 call on an isolated local database reported 68 text-input and 1,756 output tokens ($0.05302 against a $0.061188 bound, no overrun); record: docs/release-review/openai-images-20261020.md. That is not a provider invoice, a builder integration or production activation: MAKEBORNE_IMAGE_MODEL stays unset until separately approved."],
  },
  ...(["sunburst", "flare"] as const).map(variant => ({
    provider: "openai" as const, model: `gpt-image-2.5-${variant}`, label: `GPT Image 2.5 ${variant === "sunburst" ? "Sunburst" : "Flare"}`, verifiedAt: "2026-10-20",
    idSource: `https://developers.openai.com/api/docs/models/gpt-image-2.5-${variant} (alias of snapshot gpt-image-2.5-${variant}-2026-09-08; no deprecation note)`,
    priceSources: ["https://developers.openai.com/api/docs/pricing (Image models, standard: text input $5, image input $8, image output $30 per 1M; same rates as gpt-image-2)",
      "https://developers.openai.com/api/docs/guides/image-generation (checked 2026-10-20: both 2.5 models list text input $5, image input $8, image output $30, cached text input $1.25 and cached image input $2 per 1M, plus an output-token estimator)",
      "https://developers.openai.com/api/docs/deprecations (named, with the other 2.5 model, as gpt-image-1's replacement)"],
    components: { textInput: 5, textCachedInput: 1.25, imageInput: 8, imageCachedInput: 2, imageOutput: 30 },
    notes: ["OpenAI publishes token rates for the 2.5 models and an estimator of output tokens by model, quality and size (image-generation guide, checked 2026-10-20), but no per-image price table and no guaranteed per-call maximum. An estimate is not a bound, so the cost of one image cannot be bounded from documentation alone.",
      "D8 changed 2026-10-21 (owner, Kerim): bounded by MEASURED_IMAGE_OUTPUT_TOKENS (observed output tokens per size and quality x 1.5), from the owner-approved research run of 2026-10-20 (docs/release-review/design-quality-images-20261020.md). Sizes and qualities without a measurement stay refused. A call whose output tokens exceed the bound stops routing to the model (image-health.ts) and, when it exceeds the dollar bound, trips the provider scope's emergency stop.",
      variant === "sunburst" ? "OpenAI: the most capable image generation and editing model." : "OpenAI: the fastest model for high-quality, everyday image generation."],
  })),
]);
export const PRICES_VERIFIED_AT = "2026-10-12";

function evidence(model: string) {
  const item = PRICE_EVIDENCE.find(entry => entry.model === model);
  if (!item) throw new Error(`Missing price evidence for ${model}`);
  return item;
}

/** Output tokens implied by a published per-image price at $30 per 1M output tokens,
 * with $0.0005 (0.05 cent, half of the prices' last digit) of headroom for their rounding. */
function tokensFromPrice(usd: number) { return Math.ceil((usd + 0.0005) / 30 * 1_000_000); }

export type TextPrice = { input: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number; output: number };
export const TEXT_PRICES: Readonly<Record<string, TextPrice>> = Object.freeze(Object.fromEntries(PRICE_EVIDENCE
  .filter(item => item.provider === "anthropic")
  .map(item => [item.model, item.components as TextPrice])));
/** US-only inference (`inference_geo: "us"`) costs 1.1x on every category. We
 * never request it, but bounds assume it so an account default cannot overrun. */
export const GEO_MULTIPLIER = 1.1;

/** "xhigh" exists only on the 2.5 models (image-generation guide, checked 2026-10-26); like every cell it is refused
 * until MEASURED_IMAGE_OUTPUT_TOKENS lists it. "max" and "auto" are never requested (no bound). */
export type ImageQuality = "low" | "medium" | "high" | "xhigh";
/** WIDTHxHEIGHT. The 2.5 models take custom sizes within SIZE_RULES (image-cells.ts); a size is still refused until
 * its (quality, size) cell is measured. */
export type ImageSize = `${number}x${number}`;
/** Output tokens per image by quality and size, from the cited guide table. */
export type ImagePrice = { textInput: number; imageInput: number; imageOutput: number; outputTokens: Partial<Record<ImageQuality, Partial<Record<ImageSize, number>>>> };
type OutputTokens = ImagePrice["outputTokens"];
/**
 * Observed output tokens per image for models whose provider publishes token rates but no
 * per-image counts (the 2.5 models). D8, changed by the owner on 2026-10-21: these bound a
 * call at observed x MEASURED_HEADROOM (rounded up), plus the prompt at the text rate. Evidence:
 * 15 completed calls on 2026-10-20 (outputs/eval/image-research/20261020/results.jsonl,
 * docs/release-review/design-quality-images-20261020.md): every (size, quality) cell measured on
 * both models returned the same count on both, across prompts and opaque or transparent
 * backgrounds, so a cell measured on either model applies to both. Cells not listed stay
 * refused. The image call compares usage.output_tokens with the bound after every call
 * (image-call.ts); an excess stops routing to that model until reviewed (image-health.ts).
 * Partial images (+100 output tokens each) are never requested.
 */
export const MEASURED_IMAGE_OUTPUT_TOKENS: Readonly<Record<string, { evidence: string; observed: OutputTokens }>> = Object.freeze(Object.fromEntries(
  ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare"].map(model => [model, {
    evidence: "outputs/eval/image-research/20261020/results.jsonl (owner-approved research, ledger kind openai-image-research)",
    observed: {
      low: { "1024x1024": 196, "1536x1024": 158 },
      medium: { "1024x1024": 439, "1024x1536": 343, "1536x1024": 343 },
      high: { "1536x1024": 1372 },
    },
  }])));
export const MEASURED_HEADROOM = 1.5;
/** Image models with evidence but no usable bound yet. */
export const UNBOUNDED_IMAGE_MODELS = Object.freeze(PRICE_EVIDENCE
  .filter(item => item.provider === "openai" && item.model.startsWith("gpt-image-2.5-") && !MEASURED_IMAGE_OUTPUT_TOKENS[item.model])
  .map(item => item.model));
const withHeadroom = (observed: OutputTokens): OutputTokens => Object.fromEntries(Object.entries(observed)
  .map(([quality, sizes]) => [quality, Object.fromEntries(Object.entries(sizes ?? {}).map(([size, tokens]) => [size, Math.ceil(tokens! * MEASURED_HEADROOM)]))]));
const measured = (model: string): ImagePrice => ({ textInput: evidence(model).components.textInput, imageInput: evidence(model).components.imageInput,
  imageOutput: evidence(model).components.imageOutput, outputTokens: withHeadroom(MEASURED_IMAGE_OUTPUT_TOKENS[model].observed) });
export const IMAGE_PRICES: Readonly<Record<string, ImagePrice>> = Object.freeze({
  ...Object.fromEntries(Object.keys(MEASURED_IMAGE_OUTPUT_TOKENS).map(model => [model, measured(model)])),
  "gpt-image-1": {
    textInput: evidence("gpt-image-1").components.textInput, imageInput: evidence("gpt-image-1").components.imageInput,
    imageOutput: evidence("gpt-image-1").components.imageOutput,
    outputTokens: {
      low: { "1024x1024": 272, "1024x1536": 408, "1536x1024": 400 },
      medium: { "1024x1024": 1056, "1024x1536": 1584, "1536x1024": 1568 },
      high: { "1024x1024": 4160, "1024x1536": 6240, "1536x1024": 6208 },
    },
  },
  "gpt-image-2": {
    textInput: evidence("gpt-image-2").components.textInput, imageInput: evidence("gpt-image-2").components.imageInput,
    imageOutput: evidence("gpt-image-2").components.imageOutput,
    outputTokens: {
      low: { "1024x1024": tokensFromPrice(0.006), "1024x1536": tokensFromPrice(0.005), "1536x1024": tokensFromPrice(0.005) },
      medium: { "1024x1024": tokensFromPrice(0.053), "1024x1536": tokensFromPrice(0.041), "1536x1024": tokensFromPrice(0.041) },
      high: { "1024x1024": tokensFromPrice(0.211), "1024x1536": tokensFromPrice(0.165), "1536x1024": tokensFromPrice(0.165) },
    },
  },
});

export class UnpricedModelError extends Error {
  readonly code = "UNPRICED_MODEL";
  constructor(readonly model: string) { super(`No verified price for model "${model}"; refusing to call it.`); }
}
export class UnsupportedConfigurationError extends Error {
  readonly code = "UNSUPPORTED_AI_CONFIG";
  constructor(detail: string) { super(`Unsupported AI request configuration: ${detail}. Refusing to call it.`); }
}

/**
 * Web search, the only server tool with a price card: the basic, directly-called
 * version (no dynamic filtering, so no code-execution sandbox), on models whose
 * Models API record says it is supported, with a mandatory small max_uses.
 * Historical usage is priced, but new calls are refused: max_uses bounds fees,
 * not result-token billing across the provider's internal search iterations.
 */
export const WEB_SEARCH = Object.freeze({
  type: "web_search_20250305", name: "web_search",
  /** $10 per 1,000 searches. */
  microusdPerSearch: 10_000,
  /** No documented maximum for billable result tokens across internal iterations. */
  resultTokensPerSearch: null,
  maxUses: 5,
  models: Object.freeze(["claude-haiku-5-5"]),
  verifiedAt: "2026-10-14",
  sources: Object.freeze([
    "https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool (Usage and pricing: $10 per 1,000 searches plus token costs; max_uses; web_search_20250305 basic version)",
    "Models API GET /v1/models/claude-haiku-5-5: capabilities.server_tools.web_search.supported = true (checked 2026-10-14)",
  ]),
});
const WEB_SEARCH_KEYS = new Set(["type", "name", "max_uses", "allowed_domains", "blocked_domains", "user_location", "allowed_callers"]);
function assertWebSearchTool(model: string, tool: Record<string, unknown>) {
  if (!WEB_SEARCH.models.includes(model)) throw new UnsupportedConfigurationError(`web search on "${model}"`);
  for (const key of Object.keys(tool)) if (!WEB_SEARCH_KEYS.has(key)) throw new UnsupportedConfigurationError(`web search option "${key}"`);
  if (tool.name !== WEB_SEARCH.name) throw new UnsupportedConfigurationError("web search tool name");
  const uses = tool.max_uses;
  if (!Number.isSafeInteger(uses) || (uses as number) < 1 || (uses as number) > WEB_SEARCH.maxUses) throw new UnsupportedConfigurationError(`web search without max_uses between 1 and ${WEB_SEARCH.maxUses}`);
  if (tool.allowed_callers !== undefined && JSON.stringify(tool.allowed_callers) !== JSON.stringify(["direct"])) throw new UnsupportedConfigurationError("web search callers other than direct");
  throw new UnsupportedConfigurationError("web search has no documented or provider-enforced billable result-token ceiling");
}
/** Refuse any server tool without a guaranteed bound before reserving a call. */
export function serverToolBoundMicrousd(model: string, tools: unknown) {
  for (const tool of (tools as Array<Record<string, unknown>> | undefined) ?? []) {
    if (tool?.type !== WEB_SEARCH.type) continue;
    assertWebSearchTool(model, tool);
  }
  return 0;
}
/** Models whose long prompts cost more: above the threshold, the whole call is billed at the multiple. */
export const LONG_CONTEXT_PRICING: Readonly<Record<string, { thresholdTokens: number; multiplier: number }>> = Object.freeze({
  "claude-haiku-5-5": { thresholdTokens: 100_000, multiplier: 5 },
});

/** Text request parameters the price card covers. Anything else is refused. */
const TEXT_PARAMS = new Set(["model", "max_tokens", "messages", "system", "tools", "thinking", "output_config", "cache_control", "betas"]);
const TEXT_BETAS = new Set(["thinking-display-updates-2026-08-18"]);
export function assertSupportedTextRequest(params: Record<string, unknown>) {
  for (const key of Object.keys(params)) if (!TEXT_PARAMS.has(key) && params[key] !== undefined) throw new UnsupportedConfigurationError(`parameter "${key}"`);
  textPrice(String(params.model));
  for (const beta of (params.betas as unknown[] | undefined) ?? []) if (!TEXT_BETAS.has(String(beta))) throw new UnsupportedConfigurationError(`beta "${String(beta)}"`);
  for (const tool of (params.tools as Array<Record<string, unknown>> | undefined) ?? []) {
    // Client tools, plus the one priced server tool (basic web search, capped). Everything else bills in ways we don't bound.
    if (tool.type === WEB_SEARCH.type) assertWebSearchTool(String(params.model), tool);
    else if (tool.type !== undefined && tool.type !== "custom") throw new UnsupportedConfigurationError(`tool type "${String(tool.type)}"`);
  }
  // Bounds price cache writes at the 5-minute rate, so every marker must be one.
  const markers = [params.cache_control, ...(Array.isArray(params.system) ? params.system.map(block => (block as { cache_control?: unknown }).cache_control) : [])] as Array<{ type?: string; ttl?: string } | null | undefined>;
  for (const cache of markers) if (cache && (cache.type !== "ephemeral" || (cache.ttl !== undefined && cache.ttl !== "5m"))) throw new UnsupportedConfigurationError("cache TTL other than 5 minutes");
  const output = params.output_config as Record<string, unknown> | undefined;
  if (output && Object.keys(output).some(key => key !== "effort")) throw new UnsupportedConfigurationError("output_config beyond effort");
}

/**
 * Models that return a real alpha channel for background "transparent" (with
 * output_format png or webp). Same price card: the background does not change
 * output tokens (2.5 cut-outs measured 439 tokens at medium 1024x1024, equal to
 * opaque squares). Anything not listed true is refused before a reservation.
 * - gpt-image-1: documented (image generation guide, transparency section).
 * - gpt-image-2: refused live on 2026-10-20 with 400 invalid_value
 *   "Transparent background is not supported for this model."
 * - gpt-image-2.5-sunburst / -flare: documented ("either model") and verified
 *   live on 2026-10-20 (outputs/eval/image-research/20261020/results.jsonl).
 */
export const TRANSPARENT_IMAGE_MODELS: Readonly<Record<string, boolean>> = Object.freeze({
  "gpt-image-1": true, "gpt-image-2": false, "gpt-image-2.5-sunburst": true, "gpt-image-2.5-flare": true,
});
export const supportsTransparentImages = (model: string) => TRANSPARENT_IMAGE_MODELS[model] === true;
export type ImageBackground = "opaque" | "transparent";

/** Image requests the price card covers: priced model, medium quality, n=1, listed size, text prompt only,
 * and a transparent background only on models that support it. */
export function assertSupportedImageRequest(request: { model: string; quality: string; size: string; n?: number; hasImageInput?: boolean; background?: string; allowHigh?: boolean }) {
  const price = imagePrice(request.model);
  if (request.background !== undefined && request.background !== "opaque" && request.background !== "transparent") throw new UnsupportedConfigurationError(`image background "${request.background}"`);
  if (request.background === "transparent" && !supportsTransparentImages(request.model)) throw new UnsupportedConfigurationError(`transparent background on "${request.model}"`);
  // Low and medium; high and xhigh only when the caller asks for them (small text, a chosen document quality) and the
  // cell is measured below; never max or auto (no bound).
  if (!(request.quality === "medium" || request.quality === "low" || ((request.quality === "high" || request.quality === "xhigh") && request.allowHigh))) throw new UnsupportedConfigurationError(`image quality "${request.quality}"`);
  if (!/^[1-9]\d{2,3}x[1-9]\d{2,3}$/.test(request.size)) throw new UnsupportedConfigurationError(`image size "${request.size}"`);
  if ((request.n ?? 1) !== 1) throw new UnsupportedConfigurationError("more than one image per call");
  // Image input is refused on every generation path. The only path that may send an image is the
  // separately priced and qualified edit path (image-edit-prices.ts / image-edit-call.ts).
  if (request.hasImageInput) throw new UnsupportedConfigurationError("image input");
  if (!price.outputTokens[request.quality as ImageQuality]?.[request.size as ImageSize]) throw new UnsupportedConfigurationError(`image size "${request.size}" at quality "${request.quality}"`);
}

/** Output tokens one call may produce before it counts as an overrun (the bound's output part). */
export function imageOutputTokenBound(model: string, quality: ImageQuality, size: ImageSize, now = Date.now()) {
  const tokens = imagePrice(model, now).outputTokens[quality]?.[size];
  if (!tokens) throw new UnpricedModelError(`${model} ${quality} ${size}`);
  return tokens;
}

export function textPrice(model: string): TextPrice {
  const price = Object.prototype.hasOwnProperty.call(TEXT_PRICES, model) ? TEXT_PRICES[model] : undefined;
  if (!price) throw new UnpricedModelError(model);
  return price;
}
export function imagePrice(model: string, now = Date.now()): ImagePrice {
  const retires = PRICE_EVIDENCE.find(item => item.model === model)?.retiresAt;
  if (retires && now >= Date.parse(retires)) throw new UnsupportedConfigurationError(`model "${model}" was retired by its provider on ${retires.slice(0, 10)}`);
  const price = Object.prototype.hasOwnProperty.call(IMAGE_PRICES, model) ? IMAGE_PRICES[model] : undefined;
  if (!price) throw new UnpricedModelError(model);
  return price;
}

/** Most an input token can cost on this model: base input or a 5-minute cache
 * write (the builder only requests 5-minute caching), with the geo uplift. */
export function maxInputTokenMicrousd(model: string) {
  const price = textPrice(model);
  return Math.max(price.input, price.cacheWrite5m) * GEO_MULTIPLIER;
}
export function maxOutputTokenMicrousd(model: string) {
  return textPrice(model).output * GEO_MULTIPLIER;
}

/** Apply the expensive tier to the complete reservation when its prompt can cross the threshold. */
export function textCallTierMultiplier(model: string, inputTokens: number) {
  const long = LONG_CONTEXT_PRICING[model];
  return long && inputTokens > long.thresholdTokens ? long.multiplier : 1;
}

/** Conservative ceiling for one text call: every input token at its highest
 * rate plus the full output allowance (thinking is part of output). */
export function textCallBoundMicrousd(model: string, inputTokens: number, maxOutputTokens: number) {
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1) throw new Error("Invalid call bound inputs.");
  return roundBound((inputTokens * maxInputTokenMicrousd(model) + maxOutputTokens * maxOutputTokenMicrousd(model)) * textCallTierMultiplier(model, inputTokens));
}

type CacheCreation = { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null | undefined;
export type TextUsageLike = {
  input_tokens: number; output_tokens: number;
  cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_creation?: CacheCreation;
  inference_geo?: string | null; speed?: string | null;
  server_tool_use?: Record<string, number | null | undefined> | null;
  iterations?: Array<TextUsageLike & { model?: string | null; type?: string }> | null;
};

function attemptCost(model: string, usage: TextUsageLike) {
  if (!usage || !Number.isSafeInteger(usage.input_tokens) || usage.input_tokens < 0 || !Number.isSafeInteger(usage.output_tokens) || usage.output_tokens < 0)
    throw new UnsupportedConfigurationError("missing or invalid token usage");
  for (const value of [usage.cache_read_input_tokens, usage.cache_creation_input_tokens, usage.cache_creation?.ephemeral_5m_input_tokens,
    usage.cache_creation?.ephemeral_1h_input_tokens, ...Object.values(usage.server_tool_use ?? {})]) {
    if (value != null && (!Number.isSafeInteger(value) || value < 0)) throw new UnsupportedConfigurationError("invalid usage count");
  }
  if (usage.speed && usage.speed !== "standard") throw new UnpricedModelError(`${model} (speed ${usage.speed})`);
  const price = textPrice(model);
  const geo = usage.inference_geo && usage.inference_geo !== "global" ? GEO_MULTIPLIER : 1;
  const created = usage.cache_creation_input_tokens ?? 0;
  const split = usage.cache_creation;
  // Without a TTL breakdown, price cache writes at the higher 1-hour rate.
  const writes = split && (split.ephemeral_5m_input_tokens != null || split.ephemeral_1h_input_tokens != null)
    ? (split.ephemeral_5m_input_tokens ?? 0) * price.cacheWrite5m + (split.ephemeral_1h_input_tokens ?? 0) * price.cacheWrite1h
    : created * price.cacheWrite1h;
  const prompt = usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + created;
  const long = LONG_CONTEXT_PRICING[model], tier = long && prompt > long.thresholdTokens ? long.multiplier : 1;
  let tools = 0;
  for (const [key, count] of Object.entries(usage.server_tool_use ?? {})) {
    if (!count) continue;
    if (key !== "web_search_requests") throw new UnpricedModelError(`${model} (server tool ${key})`);
    tools += count * WEB_SEARCH.microusdPerSearch;
  }
  return (usage.input_tokens * price.input + (usage.cache_read_input_tokens ?? 0) * price.cacheRead + writes + usage.output_tokens * price.output) * geo * tier + tools;
}

/** Billed cost of one response. When `usage.iterations` is present it is the
 * per-attempt billing record (a declined attempt plus its fallback, each at its
 * own model's rates); the top-level usage covers only the serving attempt. */
export function textUsageMicrousd(model: string, usage: TextUsageLike) {
  const iterations = usage.iterations?.filter(Boolean) ?? [];
  if (iterations.length) return roundActual(iterations.reduce((total, item) => total + attemptCost(item.model || model, item), 0));
  return roundActual(attemptCost(model, usage));
}

/** UTF-8 bytes bound text tokens from above (every token covers at least one byte). */
export const utf8Bytes = (value: string) => Buffer.byteLength(value, "utf8");

/** Rounding: bounds round up past float noise; actual costs round up only past it,
 * so equal real amounts never look like an overrun. */
const roundBound = (microusd: number) => Math.ceil(microusd + 1e-6);
const roundActual = (microusd: number) => Math.ceil(microusd - 1e-6);

export function imageCallBoundMicrousd(model: string, quality: ImageQuality, size: ImageSize, prompt: string) {
  const price = imagePrice(model);
  const output = price.outputTokens[quality]?.[size];
  if (!output) throw new UnpricedModelError(`${model} ${quality} ${size}`);
  return roundBound(((utf8Bytes(prompt) + 64) * price.textInput + output * price.imageOutput) * GEO_MULTIPLIER);
}

export type ImageUsageLike = { input_tokens: number; output_tokens: number; input_tokens_details?: { text_tokens?: number; image_tokens?: number } | null };
export function imageUsageMicrousd(model: string, usage: ImageUsageLike) {
  const price = imagePrice(model);
  const image = usage.input_tokens_details?.image_tokens ?? 0;
  const text = usage.input_tokens_details?.text_tokens ?? Math.max(0, usage.input_tokens - image);
  return roundActual(text * price.textInput + image * price.imageInput + usage.output_tokens * price.imageOutput);
}
