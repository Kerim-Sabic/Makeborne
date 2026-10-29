import { createHash } from "node:crypto";
import {
  GEO_MULTIPLIER, MEASURED_HEADROOM, PRICE_EVIDENCE, UnsupportedConfigurationError, imagePrice, supportsTransparentImages, utf8Bytes,
  type ImageQuality, type ImageSize, type ImageUsageLike,
} from "./prices";

/**
 * Image EDIT pricing evidence (POST /v1/images/edits), the only path on which
 * an image may be sent to an image model. Every other image path keeps the
 * generic refusal in prices.ts (assertSupportedImageRequest: "image input").
 *
 * Checked against OpenAI's official pages on 2026-10-23 (developers.openai.com):
 * - API reference, Create image edit: up to 16 input images for GPT image
 *   models; `mask` (applied to the first image); `n` 1-10; quality low,
 *   medium, high (+ xhigh, max on the 2.5 models; default auto); standard
 *   sizes 1024x1024, 1536x1024, 1024x1536 (+ arbitrary sizes on gpt-image-2
 *   and 2.5); `partial_images` 0-3 with `stream`; `input_fidelity` only for
 *   gpt-image-1 / 1.5 ("For gpt-image-2, omit this parameter"); background
 *   transparent is supported by the 2.5 models and "in preview" for
 *   gpt-image-2; the `usage` object is documented "For gpt-image-1 only".
 * - Image generation guide: masks need the same format and size as the image
 *   (< 50 MB) and an alpha channel; "Masking with GPT Image is entirely
 *   prompt-based ... may not follow its exact shape with complete precision";
 *   a mask adds "additional instructions" (text tokens of unpublished size);
 *   cached input pricing does NOT apply to the Images API (/v1/images/edits);
 *   each partial image adds 100 image output tokens; edit cost = input text +
 *   input image tokens + image output tokens; gpt-image-2 always processes
 *   image inputs at high fidelity, so edits "can use more input tokens".
 * - Images and vision guide, "GPT Image model inputs": the input-image token
 *   rule is published for gpt-image-1 ONLY (65 base + 129 per 512-px tile, and
 *   +4,160 / +6,240 at high fidelity). No input-image token rule or count is
 *   published for gpt-image-2, gpt-image-2.5-sunburst or gpt-image-2.5-flare.
 * - Pricing page and model pages: image input $8, image output $30, text
 *   input $5 per 1M on gpt-image-2 and both 2.5 models (same as generation).
 *
 * Consequence: the rate of an input image token is published, but not how many
 * tokens a source image, reference or mask costs on any model we may still
 * call (gpt-image-1 shuts down on 2026-10-23). Output tokens for edits are not
 * published for the 2.5 models either, and the generation measurements
 * (MEASURED_IMAGE_OUTPUT_TOKENS) do not qualify edits. So no edit cell has a
 * bound and every edit is refused until an owner-approved live qualification
 * records observed counts in MEASURED_EDIT_TOKENS (plan:
 * docs/release-review/image-edit-qualification-20261023.md).
 */
export const IMAGE_EDIT_EVIDENCE_VERIFIED_AT = "2026-10-23";
export const IMAGE_EDIT_SOURCES = Object.freeze([
  "https://developers.openai.com/api/reference/resources/images/methods/edit (Create image edit, checked 2026-10-23)",
  "https://developers.openai.com/api/docs/guides/image-generation (Edit Images; Mask requirements; Cost and latency; Cached input pricing; Partial images cost; Image input fidelity, checked 2026-10-23)",
  "https://developers.openai.com/api/docs/guides/images-vision (GPT Image model inputs, checked 2026-10-23)",
  "https://developers.openai.com/api/docs/pricing (Image generation models, standard, checked 2026-10-23)",
]);

export type ImageEditEvidence = Readonly<{
  model: string; verifiedAt: string;
  /** Model page lists v1/images/edits as Supported. */
  editsEndpoint: string;
  /** Precision editing (named by OpenAI for edits) versus routine/fast work. */
  role: "precision" | "routine";
  /** transparent background on the edits endpoint. */
  transparent: "documented" | "preview";
  /** Is a per-image input-token rule published for this model? */
  inputImageTokens: "published" | "unpublished";
  inputFidelity: "parameter" | "fixed_high";
  notes: readonly string[];
}>;
export const IMAGE_EDIT_EVIDENCE: readonly ImageEditEvidence[] = Object.freeze([
  Object.freeze({ model: "gpt-image-2.5-sunburst", verifiedAt: "2026-10-23", role: "precision" as const, transparent: "documented" as const, inputImageTokens: "unpublished" as const, inputFidelity: "fixed_high" as const,
    editsEndpoint: "https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst (Image edit v1/images/edits: Supported; supported features: inpainting)",
    notes: Object.freeze(["OpenAI: \"Use it for workflows where editing precision matters most\"; the API's default edit model.",
      "Edit rates as generation: text $5, image input $8, image output $30 per 1M; cached rates do not apply to the Images API.",
      "No published input-image token count and no published edit output-token count: unbounded until measured."]) }),
  Object.freeze({ model: "gpt-image-2.5-flare", verifiedAt: "2026-10-23", role: "routine" as const, transparent: "documented" as const, inputImageTokens: "unpublished" as const, inputFidelity: "fixed_high" as const,
    editsEndpoint: "https://developers.openai.com/api/docs/models/gpt-image-2.5-flare (Image edit v1/images/edits: Supported; supported features: inpainting)",
    notes: Object.freeze(["OpenAI: \"fastest model for high-quality, everyday image generation\"; candidate for routine variants and restyles only.",
      "Same rates and the same missing token counts as Sunburst: unbounded until measured."]) }),
  Object.freeze({ model: "gpt-image-2", verifiedAt: "2026-10-23", role: "routine" as const, transparent: "preview" as const, inputImageTokens: "unpublished" as const, inputFidelity: "fixed_high" as const,
    editsEndpoint: "https://developers.openai.com/api/docs/models/gpt-image-2 (Image edit v1/images/edits: Supported)",
    notes: Object.freeze(["Published per-image prices cover image OUTPUT only; input images are always processed at high fidelity and \"can use more input tokens\" (count unpublished).",
      "Transparent backgrounds are \"in preview\" on the edits endpoint, and generation refused them live on 2026-10-20: never qualified for cut-outs."]) }),
  Object.freeze({ model: "gpt-image-1", verifiedAt: "2026-10-23", role: "routine" as const, transparent: "documented" as const, inputImageTokens: "published" as const, inputFidelity: "parameter" as const,
    editsEndpoint: "https://developers.openai.com/api/docs/guides/images-vision (GPT Image 1 input rule: 65 + 129 per tile; +4,160 square / +6,240 otherwise at high fidelity)",
    notes: Object.freeze(["The only model with a published input-image token rule, and it is shut down on 2026-10-23 (prices.ts retiresAt): refused."]) }),
]);

/**
 * Observed token counts per edit call, by model, quality and size, from an
 * owner-approved live qualification. Inputs are always normalised server-side
 * to the requested output size before they are sent (source and mask exactly
 * that size, references inside it), so one cell covers every edit of that size.
 * PROPOSED after the paid qualification of 24 Oct 2026 (scope
 * agency-qualification-20261024; docs/release-review/agency-qualification-20261024.md):
 * the largest counts observed over 24 live medium-quality calls, usage returned on
 * every call, no overrun. Input image tokens are per image (the source; references
 * fitted inside the canvas counted less or equal). The mask figure is the largest TOTAL
 * text-token count seen on a masked call (conservative); cells without masked calls
 * carry none, so masks stay refused there. Every other model x quality x size stays
 * refused. A cell is bounded at observed x MEASURED_HEADROOM (the D8 rule for
 * generation): extending D8 to edits STILL NEEDS THE OWNER'S SIGN-OFF, and the
 * image-editing flags remain off and set nowhere.
 */
export type EditCell = Readonly<{
  /** Largest observed image-input tokens for ONE input image of this size. */
  inputImageTokens: number;
  /** Largest observed extra text tokens added when a mask is sent; absent = masks refused for this cell. */
  maskTextTokens?: number;
  /** Largest observed output tokens for one edited image. */
  outputTokens: number;
  evidence: string;
}>;
export type EditTokenTable = Readonly<Record<string, Readonly<Partial<Record<ImageQuality, Readonly<Partial<Record<ImageSize, EditCell>>>>>>>>;
const QUALIFIED_20261024 = (calls: number, size: string) => `agency-qualification-20261024: largest of ${calls} live call(s) at medium ${size}, usage returned on every call; owner sign-off of the D8 extension pending`;
export const MEASURED_EDIT_TOKENS: EditTokenTable = Object.freeze({
  "gpt-image-2.5-sunburst": Object.freeze({ medium: Object.freeze({
    "1024x1024": Object.freeze({ inputImageTokens: 1024, maskTextTokens: 55, outputTokens: 439, evidence: QUALIFIED_20261024(8, "1024x1024") }),
    "1536x1024": Object.freeze({ inputImageTokens: 1536, maskTextTokens: 55, outputTokens: 343, evidence: QUALIFIED_20261024(8, "1536x1024") }),
  }) }),
  "gpt-image-2.5-flare": Object.freeze({ medium: Object.freeze({
    "1024x1024": Object.freeze({ inputImageTokens: 1024, outputTokens: 439, evidence: QUALIFIED_20261024(3, "1024x1024") }),
    "1536x1024": Object.freeze({ inputImageTokens: 1536, outputTokens: 343, evidence: QUALIFIED_20261024(3, "1536x1024") }),
  }) }),
  "gpt-image-2": Object.freeze({ medium: Object.freeze({
    "1024x1024": Object.freeze({ inputImageTokens: 1024, outputTokens: 1756, evidence: QUALIFIED_20261024(2, "1024x1024") }),
  }) }),
});

export const EDIT_SIZES: readonly ImageSize[] = Object.freeze(["1024x1024", "1536x1024", "1024x1536"]);
export const EDIT_QUALITIES: readonly ImageQuality[] = Object.freeze(["low", "medium", "high"]);
/** Source plus at most three references per call (the API allows 16; we qualify few). */
export const MAX_EDIT_INPUT_IMAGES = 4;
/** Text tokens added to every prompt for request framing (same allowance as generation). */
export const EDIT_PROMPT_OVERHEAD_TOKENS = 64;
export const MAX_EDIT_PROMPT_BYTES = 8000;

export const editEvidence = (model: string) => IMAGE_EDIT_EVIDENCE.find(item => item.model === model);

export type ImageEditRequestShape = {
  model: string; quality: string; size: string; images: number; mask: boolean; background: string;
  n?: number; stream?: boolean; partialImages?: number; inputFidelity?: string; prompt?: string;
};

/** The edit cell for this exact request, or a refusal. Nothing outside the table is ever called. */
export function assertSupportedImageEditRequest(request: ImageEditRequestShape, table: EditTokenTable = MEASURED_EDIT_TOKENS, now = Date.now()): EditCell {
  const evidence = editEvidence(request.model);
  if (!evidence || !PRICE_EVIDENCE.some(item => item.provider === "openai" && item.model === request.model)) throw new UnsupportedConfigurationError(`image edits on "${request.model}"`);
  imagePrice(request.model, now); // retired or unpriced models fail here
  if (!EDIT_QUALITIES.includes(request.quality as ImageQuality)) throw new UnsupportedConfigurationError(`edit quality "${request.quality}"`);
  if (!EDIT_SIZES.includes(request.size as ImageSize)) throw new UnsupportedConfigurationError(`edit size "${request.size}"`);
  if ((request.n ?? 1) !== 1) throw new UnsupportedConfigurationError("more than one edited image per call");
  if (request.stream || (request.partialImages ?? 0) !== 0) throw new UnsupportedConfigurationError("streamed or partial edit images (each partial image is billed)");
  if (request.inputFidelity !== undefined) throw new UnsupportedConfigurationError("input_fidelity");
  if (!Number.isSafeInteger(request.images) || request.images < 1 || request.images > MAX_EDIT_INPUT_IMAGES) throw new UnsupportedConfigurationError("number of edit input images");
  if (request.background !== "opaque" && request.background !== "transparent") throw new UnsupportedConfigurationError(`edit background "${request.background}"`);
  if (request.background === "transparent" && (evidence.transparent !== "documented" || !supportsTransparentImages(request.model)))
    throw new UnsupportedConfigurationError(`transparent edits on "${request.model}"`);
  if (request.prompt !== undefined && (utf8Bytes(request.prompt) < 1 || utf8Bytes(request.prompt) > MAX_EDIT_PROMPT_BYTES)) throw new UnsupportedConfigurationError("edit prompt length");
  const cell = Object.prototype.hasOwnProperty.call(table, request.model) ? table[request.model]?.[request.quality as ImageQuality]?.[request.size as ImageSize] : undefined;
  if (!cell || !Number.isSafeInteger(cell.inputImageTokens) || cell.inputImageTokens <= 0 || !Number.isSafeInteger(cell.outputTokens) || cell.outputTokens <= 0)
    throw new UnsupportedConfigurationError(`image edit on "${request.model}" at ${request.quality} ${request.size}: no published or measured input-image and output token counts`);
  if (request.mask && !(Number.isSafeInteger(cell.maskTextTokens) && (cell.maskTextTokens as number) >= 0)) throw new UnsupportedConfigurationError(`masked edits on "${request.model}" at ${request.quality} ${request.size}: mask instructions not measured`);
  return cell;
}

export type ImageEditBound = { boundMicrousd: number; outputTokens: number; inputImageTokensPerImage: number; inputImages: number; textTokens: number };
const ceilHeadroom = (tokens: number) => Math.ceil(tokens * MEASURED_HEADROOM);

/**
 * Conservative ceiling for one edit call: every prompt byte as a text token
 * plus framing (and the measured mask instructions), every input image
 * (source, references and the mask itself) at the measured per-image count,
 * and the measured output count, each count x MEASURED_HEADROOM, all at the
 * standard (non-cached) rates, then x GEO_MULTIPLIER (1.1). No caching,
 * batch or discount is assumed.
 */
export function imageEditCallBoundMicrousd(request: ImageEditRequestShape & { prompt: string }, table: EditTokenTable = MEASURED_EDIT_TOKENS, now = Date.now()): ImageEditBound {
  const cell = assertSupportedImageEditRequest(request, table, now);
  const price = imagePrice(request.model, now);
  const textTokens = utf8Bytes(request.prompt) + EDIT_PROMPT_OVERHEAD_TOKENS + (request.mask ? ceilHeadroom(cell.maskTextTokens ?? 0) : 0);
  const inputImages = request.images + (request.mask ? 1 : 0);
  const perImage = ceilHeadroom(cell.inputImageTokens), outputTokens = ceilHeadroom(cell.outputTokens);
  const microusd = (textTokens * price.textInput + inputImages * perImage * price.imageInput + outputTokens * price.imageOutput) * GEO_MULTIPLIER;
  return { boundMicrousd: Math.ceil(microusd + 1e-6), outputTokens, inputImageTokensPerImage: perImage, inputImages, textTokens };
}

/** Billed cost of one edit response from its usage (text and image input split when reported). */
export function imageEditUsageMicrousd(model: string, usage: ImageUsageLike, now = Date.now()) {
  const price = imagePrice(model, now);
  const image = usage.input_tokens_details?.image_tokens ?? usage.input_tokens; // unsplit input is priced at the higher image rate
  const text = usage.input_tokens_details?.text_tokens ?? 0;
  return Math.ceil(text * price.textInput + image * price.imageInput + usage.output_tokens * price.imageOutput - 1e-6);
}

/** Changes whenever the edit evidence, the measured table or the bound rule changes; recorded with every edit. */
export function imageEditPriceCardVersion(table: EditTokenTable = MEASURED_EDIT_TOKENS) {
  const card = { verifiedAt: IMAGE_EDIT_EVIDENCE_VERIFIED_AT, evidence: IMAGE_EDIT_EVIDENCE, table, headroom: MEASURED_HEADROOM, geo: GEO_MULTIPLIER, overhead: EDIT_PROMPT_OVERHEAD_TOKENS,
    rates: IMAGE_EDIT_EVIDENCE.map(item => { try { const price = imagePrice(item.model); return [item.model, price.textInput, price.imageInput, price.imageOutput]; } catch { return [item.model, null]; } }) };
  return `image-edit-${createHash("sha256").update(JSON.stringify(card)).digest("hex").slice(0, 16)}`;
}
