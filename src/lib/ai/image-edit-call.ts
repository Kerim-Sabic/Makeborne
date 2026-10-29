import sharp from "sharp";
import { z } from "zod";
import { imageEditCallBoundMicrousd, imageEditUsageMicrousd, MEASURED_EDIT_TOKENS, type EditTokenTable, type ImageEditBound } from "./image-edit-prices";
import { reportImageOverrun } from "./image-health";
import type { ImageQuality, ImageSize } from "./prices";
import type { RunSpend } from "./run-spend";

/** One input file for the multipart edit request (PNG bytes, normalised to the output size by the caller). */
export type EditUpload = { name: string; bytes: Buffer; type: "image/png" };
export type ImageEditClientLike = { images: {
  edit(body: Record<string, unknown>, options: { signal?: AbortSignal; maxRetries: number; timeout?: number }): Promise<unknown>;
} };
/** Turns bytes into the SDK's upload type (openai `toFile` in production; identity in tests). */
export type ToUpload = (upload: EditUpload) => Promise<unknown>;

export type ImageEditCallDetail = {
  model: string; quality: ImageQuality; size: ImageSize; background: "opaque" | "transparent";
  boundMicrousd: number; costMicrousd: number | null; outputTokens: number | null; inputImageTokens: number | null;
  boundOutputTokens: number; boundInputImageTokens: number; overrun: boolean; usage: z.infer<typeof UsageSchema> | null;
};
export type ImageEditCallOutcome =
  | { ok: true; bytes: Buffer; width: number; height: number; hasAlpha: boolean; detail: ImageEditCallDetail }
  /** "uncertain": the provider may have run (and billed) it; "malformed": it answered with an unusable result; "refused": 4xx before work. */
  | { ok: false; reason: "uncertain" | "malformed" | "refused" | "rate_limited"; status: number | null; detail: ImageEditCallDetail };

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const split = z.object({ image_tokens: count, text_tokens: count });
const UsageSchema = z.object({ input_tokens: count, output_tokens: count, total_tokens: count.optional(), input_tokens_details: split.optional(), output_tokens_details: split.partial().optional() })
  .passthrough().superRefine((usage, ctx) => {
    if (usage.total_tokens !== undefined && usage.total_tokens !== usage.input_tokens + usage.output_tokens) ctx.addIssue({ code: "custom", message: "Inconsistent usage total." });
    if (usage.input_tokens_details && usage.input_tokens_details.image_tokens + usage.input_tokens_details.text_tokens !== usage.input_tokens) ctx.addIssue({ code: "custom", message: "Inconsistent input split." });
  });
const ResponseSchema = z.object({ data: z.array(z.object({ b64_json: z.string().min(1), url: z.undefined().or(z.null()).optional() }).passthrough()).length(1),
  output_format: z.string().optional(), size: z.string().optional(), quality: z.string().optional(), background: z.string().optional(), usage: z.unknown().optional() }).passthrough();
export const MAX_EDIT_OUTPUT_BYTES = 16 * 1024 * 1024;

/**
 * One budgeted image-edit call on the Images API (multipart: image[], mask,
 * prompt, size, quality, background). The bound covers text, every input
 * image (and the mask) and the output, and is reserved through the run's
 * RunSpend before any provider contact. No SDK retries, no streaming or
 * partial images, n = 1, PNG output, a hard timeout. After the call:
 * - usage present and valid: settled at its actual cost; an output or input
 *   token count above its bound is an overrun (logged, routing to the model
 *   stops in this process, the run makes no further calls; a dollar excess
 *   also trips the provider scope's emergency stop in SQL);
 * - usage missing or invalid: the bound is recorded as spent (uncertain);
 * - a thrown error other than 429 may have executed: uncertain at its bound,
 *   never retried here;
 * - a response that does not decode to exactly one PNG of the requested size
 *   is "malformed": its usage is still recorded, the image is never stored.
 */
export async function budgetedImageEdit(input: {
  client: ImageEditClientLike; toUpload: ToUpload; spend: RunSpend; signal: AbortSignal;
  model: string; prompt: string; size: ImageSize; quality: ImageQuality; background: "opaque" | "transparent";
  images: EditUpload[]; mask?: EditUpload; table?: EditTokenTable; maxTimeoutMs?: number;
}): Promise<ImageEditCallOutcome> {
  const table = input.table ?? MEASURED_EDIT_TOKENS;
  const bound: ImageEditBound = imageEditCallBoundMicrousd({ model: input.model, quality: input.quality, size: input.size, images: input.images.length, mask: Boolean(input.mask),
    background: input.background, prompt: input.prompt }, table);
  const [width, height] = input.size.split("x").map(Number);
  for (const upload of [...input.images, ...(input.mask ? [input.mask] : [])]) {
    const meta = await sharp(upload.bytes).metadata();
    if (meta.format !== "png" || meta.width! > width || meta.height! > height) throw new Error("Edit inputs must be PNG files normalised to the output size.");
  }
  const ticket = await input.spend.begin("openai", input.model, bound.boundMicrousd);
  const timeout = Math.max(1, Math.min(input.maxTimeoutMs ?? 180_000, input.spend.timeLeftMs()));
  const base: ImageEditCallDetail = { model: input.model, quality: input.quality, size: input.size, background: input.background, boundMicrousd: bound.boundMicrousd,
    costMicrousd: null, outputTokens: null, inputImageTokens: null, boundOutputTokens: bound.outputTokens, boundInputImageTokens: bound.inputImageTokensPerImage * bound.inputImages, overrun: false, usage: null };
  let response: unknown;
  try {
    const images = await Promise.all(input.images.map(input.toUpload));
    const mask = input.mask ? await input.toUpload(input.mask) : undefined;
    response = await input.client.images.edit({ model: input.model, prompt: input.prompt, image: images, ...(mask ? { mask } : {}), n: 1, size: input.size, quality: input.quality,
      background: input.background, output_format: "png", stream: false },
    { signal: AbortSignal.any([input.signal, AbortSignal.timeout(timeout)]), maxRetries: 0, timeout });
  } catch (error) {
    const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : null;
    // 429 is refused before processing (not billed). 400/401/403/404/422 are rejected requests; still recorded at
    // the bound (uncertain) except 429, because the API does not promise that a 4xx was never processed.
    await input.spend.finish(ticket, status === 429 ? { actualMicrousd: 0, detail: { status } } : { actualMicrousd: null, detail: { status } });
    return { ok: false, reason: status === 429 ? "rate_limited" : status !== null && status >= 400 && status < 500 ? "refused" : "uncertain", status, detail: { ...base, costMicrousd: status === 429 ? 0 : null } };
  }
  const shape = ResponseSchema.safeParse(response);
  const usage = UsageSchema.safeParse(shape.success ? shape.data.usage : (response as { usage?: unknown } | null)?.usage);
  let cost: number | null = null;
  try { cost = usage.success ? imageEditUsageMicrousd(input.model, usage.data) : null; } catch { cost = null; }
  const outputTokens = usage.success ? usage.data.output_tokens : null;
  const inputImageTokens = usage.success ? usage.data.input_tokens_details?.image_tokens ?? null : null;
  // Without a split, the whole input is compared with the image and text allowances together.
  const inputOver = usage.success && (usage.data.input_tokens_details ? usage.data.input_tokens_details.image_tokens > base.boundInputImageTokens
    : usage.data.input_tokens > base.boundInputImageTokens + bound.textTokens);
  const overrun = (outputTokens !== null && outputTokens > base.boundOutputTokens) || inputOver
    || (cost !== null && cost > bound.boundMicrousd);
  await input.spend.finish(ticket, cost === null ? { actualMicrousd: null, detail: { reason: "usage_missing" } }
    : { actualMicrousd: cost, ...(overrun ? { detail: { outputTokens, inputImageTokens, boundOutputTokens: base.boundOutputTokens, boundInputImageTokens: base.boundInputImageTokens } } : {}) });
  if (overrun) {
    reportImageOverrun({ model: input.model, quality: input.quality, size: input.size, outputTokens: outputTokens ?? 0, boundTokens: base.boundOutputTokens });
    input.spend.markOverrun();
  }
  const detail: ImageEditCallDetail = { ...base, costMicrousd: cost, outputTokens, inputImageTokens, overrun, usage: usage.success ? usage.data : null };
  const malformed = (): ImageEditCallOutcome => ({ ok: false, reason: "malformed", status: null, detail });
  if (!shape.success || (shape.data.output_format && shape.data.output_format !== "png") || (shape.data.size && shape.data.size !== input.size)
    || (shape.data.quality && shape.data.quality !== input.quality) || (shape.data.background && shape.data.background !== input.background)) return malformed();
  const encoded = shape.data.data[0].b64_json;
  if (encoded.length > Math.ceil(MAX_EDIT_OUTPUT_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return malformed();
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.toString("base64") !== encoded) return malformed();
  try {
    const image = sharp(bytes, { limitInputPixels: 8_294_400, failOn: "warning" });
    const meta = await image.metadata();
    if (meta.format !== "png" || (meta.pages ?? 1) !== 1 || meta.width !== width || meta.height !== height) return malformed();
    await image.timeout({ seconds: 8 }).stats();
    return { ok: true, bytes, width, height, hasAlpha: Boolean(meta.hasAlpha), detail };
  } catch { return malformed(); }
}
