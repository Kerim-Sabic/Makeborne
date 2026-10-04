import "server-only";
import { createHash } from "node:crypto";
import OpenAI from "openai";
import type { ImageGenerateParamsNonStreaming } from "openai/resources/images";
import sharp from "sharp";
import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ConfigSchema = z.object({
  apiKey: z.string().min(1), model: z.string().regex(/^gpt-image-[A-Za-z0-9.-]+$/).max(160),
  size: z.string().regex(/^[1-9][0-9]{2,3}x[1-9][0-9]{2,3}$/),
  quality: z.enum(["low", "medium", "high", "xhigh", "max"]),
  background: z.enum(["opaque", "transparent"]),
  maximumInputTokens: count.min(1).max(100000), maximumOutputTokens: count.min(1).max(100000),
  timeoutMs: count.min(1000).max(300000),
}).strict().superRefine((config, ctx) => {
  const [width, height] = config.size.split("x").map(Number);
  if (width % 16 || height % 16 || Math.max(width, height) > 3840 || width * height < 655360 || width * height > 8294400 || Math.max(width / height, height / width) > 3) ctx.addIssue({ code: "custom", message: "Unsupported bounded image dimensions." });
});
const RequestSchema = z.object({ attemptId: z.string().uuid(), prompt: z.string().min(1).max(32000) }).strict();
const details = z.object({ image_tokens: count, text_tokens: count });
const UsageSchema = z.object({ input_tokens: count, output_tokens: count, total_tokens: count, input_tokens_details: details, output_tokens_details: details.optional() }).superRefine((usage, ctx) => {
  if (usage.input_tokens + usage.output_tokens !== usage.total_tokens || usage.input_tokens_details.image_tokens + usage.input_tokens_details.text_tokens !== usage.input_tokens || (usage.output_tokens_details && usage.output_tokens_details.image_tokens + usage.output_tokens_details.text_tokens !== usage.output_tokens)) ctx.addIssue({ code: "custom", message: "Inconsistent image usage." });
});
export type OpenAIImageConfig = z.input<typeof ConfigSchema>;
export type ImageEvidence = {
  attemptId: string; requestHash: string; providerRequestId: string | null;
  requestedModel: string; usage: z.infer<typeof UsageSchema> | null;
};
export type ImageOutcome =
  | { status: "not_dispatched"; reason: "disabled" | "invalid_request" | "cancelled" | "input_limit" }
  | { status: "uncertain"; reason: "claim" | "transport" | "cancelled"; evidence: ImageEvidence }
  | { status: "rejected"; reason: "usage" | "output" | "dimensions"; evidence: ImageEvidence }
  | { status: "image_ready"; image: { bytes: Buffer; mime: "image/png"; width: number; height: number; sha256: string }; requiresVisualReview: true; evidence: ImageEvidence };
export type ImageDependencies = {
  spendingAllowed: () => boolean;
  /** Trusted tokenizer for the configured image model and exact request. */
  countInputTokens: (body: Readonly<ImageGenerateParamsNonStreaming>) => Promise<number>;
  /** Commit a durable, authorized per-attempt claim bound to this request hash. */
  claimDispatch: (binding: { attemptId: string; requestHash: string }) => Promise<boolean>;
  fetch?: typeof fetch;
};
const safeId = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value) ? value : null;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** One new-image request; no edits, image URLs, batch calls, retries or charges.
 * Exact supported model/size/quality and a worst-case price must be verified by
 * the routing layer before activation. The API has no output-token cap: explicit
 * size, quality and n=1 bound the operation; usage overrun requires reconciliation. */
export function createOpenAIImageAdapter(configuration: OpenAIImageConfig, dependencies: ImageDependencies) {
  const config = ConfigSchema.parse(configuration);
  const [width, height] = config.size.split("x").map(Number);
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: "https://api.openai.com/v1", maxRetries: 0, timeout: config.timeoutMs, fetch: dependencies.fetch, fetchOptions: { redirect: "error" } });
  return async (input: unknown, signal: AbortSignal): Promise<ImageOutcome> => {
    if (!dependencies.spendingAllowed()) return { status: "not_dispatched", reason: "disabled" };
    const request = RequestSchema.safeParse(input);
    if (!request.success) return { status: "not_dispatched", reason: "invalid_request" };
    if (signal.aborted) return { status: "not_dispatched", reason: "cancelled" };
    const body: ImageGenerateParamsNonStreaming = Object.freeze({ model: config.model, prompt: request.data.prompt, n: 1, size: config.size, quality: config.quality, output_format: "png", background: config.background, moderation: "auto", stream: false });
    const requestHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    let tokens: number;
    try { tokens = await dependencies.countInputTokens(body); } catch { return { status: "not_dispatched", reason: "input_limit" }; }
    if (!count.safeParse(tokens).success || tokens > config.maximumInputTokens) return { status: "not_dispatched", reason: "input_limit" };
    if (signal.aborted) return { status: "not_dispatched", reason: "cancelled" };
    if (!dependencies.spendingAllowed()) return { status: "not_dispatched", reason: "disabled" };
    const evidence: ImageEvidence = { attemptId: request.data.attemptId, requestHash, providerRequestId: null, requestedModel: config.model, usage: null };
    try { if (!await dependencies.claimDispatch({ attemptId: request.data.attemptId, requestHash })) return { status: "uncertain", reason: "claim", evidence }; }
    catch { return { status: "uncertain", reason: "claim", evidence }; }
    if (signal.aborted || !dependencies.spendingAllowed()) return { status: "uncertain", reason: "cancelled", evidence };
    try {
      const { data, request_id } = await client.images.generate(body, { signal, maxRetries: 0, timeout: config.timeoutMs, headers: { "X-Client-Request-Id": request.data.attemptId } }).withResponse();
      evidence.providerRequestId = safeId(request_id);
      const usage = UsageSchema.safeParse(data.usage); evidence.usage = usage.success ? usage.data : null;
      if (signal.aborted) return { status: "uncertain", reason: "cancelled", evidence };
      if (!usage.success || !evidence.providerRequestId || usage.data.input_tokens > config.maximumInputTokens || usage.data.output_tokens > config.maximumOutputTokens) return { status: "rejected", reason: "usage", evidence };
      if (!Array.isArray(data.data) || data.data.length !== 1 || data.data[0].url || (data.output_format && data.output_format !== "png") || (data.size && data.size !== config.size) || (data.quality && data.quality !== config.quality) || (data.background && data.background !== config.background)) return { status: "rejected", reason: "output", evidence };
      const encoded = data.data[0].b64_json;
      if (!encoded || encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return { status: "rejected", reason: "output", evidence };
      const bytes = Buffer.from(encoded, "base64");
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64") !== encoded) return { status: "rejected", reason: "output", evidence };
      try {
        const image = sharp(bytes, { limitInputPixels: 8294400, failOn: "warning" });
        const metadata = await image.metadata();
        if (metadata.format !== "png" || (metadata.pages ?? 1) !== 1) return { status: "rejected", reason: "output", evidence };
        if (metadata.width !== width || metadata.height !== height || (metadata.orientation && metadata.orientation !== 1)) return { status: "rejected", reason: "dimensions", evidence };
        // Decode pixels, not just the file header. Preserve original generated
        // bytes/provenance metadata for private storage; previews are separate.
        await image.timeout({ seconds: 8 }).stats();
      } catch { return { status: "rejected", reason: "output", evidence }; }
      if (signal.aborted) return { status: "uncertain", reason: "cancelled", evidence };
      return { status: "image_ready", image: { bytes, mime: "image/png", width, height, sha256: createHash("sha256").update(bytes).digest("hex") }, requiresVisualReview: true, evidence };
    } catch (error) {
      if (error instanceof OpenAI.APIError) evidence.providerRequestId = safeId(error.requestID);
      return { status: "uncertain", reason: signal.aborted ? "cancelled" : "transport", evidence };
    }
  };
}
