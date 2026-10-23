import { assertSupportedImageRequest, imageCallBoundMicrousd, imageOutputTokenBound, imageTokenUsage, imageUsageMicrousd, type ImageBackground, type ImageQuality, type ImageSize, type ImageUsageLike } from "./prices";
import { reportImageOverrun } from "./image-health";
import type { RunSpend } from "./run-spend";

export type ImageClientLike = { images: {
  generate(body: Record<string, unknown>, options: { signal?: AbortSignal; maxRetries: number; timeout?: number }): Promise<{ data?: Array<{ b64_json?: string | null }> | null; usage?: ImageUsageLike | null }>;
} };

/** What one finished image call cost and whether it stayed inside its bound. */
export type ImageCallDetail = { model: string; quality: ImageQuality; size: ImageSize; boundMicrousd: number; costMicrousd: number | null; outputTokens: number | null; boundOutputTokens: number; overrun: boolean };

/**
 * Reserves one image's bound now (so the run's budget is checked before any
 * provider contact) and returns the running generation as `done` (bytes) and
 * `detail` (cost and usage). No SDK retries. Usage reported by the API is the
 * actual cost; without it the bound is spent. background "transparent" asks
 * for an alpha cut-out (WebP keeps the alpha channel); models without it are
 * refused before the reservation. After every call usage.output_tokens is
 * compared with the bound's output tokens: an excess is settled at its actual
 * cost, logged, stops this run's further calls and stops routing to the model.
 */
export async function startBudgetedImage(input: {
  client: ImageClientLike; spend: RunSpend; model: string; prompt: string; size: ImageSize; quality: ImageQuality; signal: AbortSignal; background?: ImageBackground; allowHigh?: boolean;
}): Promise<{ done: Promise<Buffer>; detail: Promise<ImageCallDetail> }> {
  assertSupportedImageRequest({ model: input.model, quality: input.quality, size: input.size, background: input.background, allowHigh: input.allowHigh });
  const bound = imageCallBoundMicrousd(input.model, input.quality, input.size, input.prompt);
  const boundOutputTokens = imageOutputTokenBound(input.model, input.quality, input.size);
  const ticket = await input.spend.begin("openai", input.model, bound);
  const timeout = Math.max(1, Math.min(180_000, input.spend.timeLeftMs()));
  let resolveDetail!: (detail: ImageCallDetail) => void;
  const detail = new Promise<ImageCallDetail>(resolve => { resolveDetail = resolve; });
  const base = { model: input.model, quality: input.quality, size: input.size, boundMicrousd: bound, boundOutputTokens };
  const done = (async () => {
    let response;
    try {
      response = await input.client.images.generate({ model: input.model, prompt: input.prompt, n: 1, size: input.size, quality: input.quality, output_format: "webp", output_compression: 90, ...(input.background === "transparent" ? { background: "transparent" } : {}) },
        { signal: AbortSignal.any([input.signal, AbortSignal.timeout(timeout)]), maxRetries: 0, timeout });
    } catch (error) {
      const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : undefined;
      // Rate limited before processing: not billed. Anything else may have been.
      await input.spend.finish(ticket, status === 429 ? { actualMicrousd: 0, detail: { status } } : { actualMicrousd: null, detail: { status: status ?? null } });
      resolveDetail({ ...base, costMicrousd: status === 429 ? 0 : null, outputTokens: null, overrun: false });
      throw error;
    }
    let cost: number | null = null;
    try { cost = response.usage ? imageUsageMicrousd(input.model, response.usage) : null; } catch { cost = null; }
    const outputTokens = Number.isSafeInteger(response.usage?.output_tokens) ? response.usage!.output_tokens : null;
    const overrun = outputTokens !== null && outputTokens > boundOutputTokens;
    const usage = response.usage ? imageTokenUsage(response.usage) : null;
    await input.spend.finish(ticket, cost === null ? { actualMicrousd: null, usage, detail: { reason: "usage_missing" } } : { actualMicrousd: cost, usage, ...(overrun ? { detail: { outputTokens, boundOutputTokens } } : {}) });
    if (overrun) {
      reportImageOverrun({ model: input.model, quality: input.quality, size: input.size, outputTokens, boundTokens: boundOutputTokens });
      input.spend.markOverrun();
    }
    resolveDetail({ ...base, costMicrousd: cost, outputTokens, overrun });
    const encoded = response.data?.[0]?.b64_json;
    if (!encoded) throw new Error("The image service returned no image.");
    return Buffer.from(encoded, "base64");
  })();
  // Callers attach handlers later; never leave a rejection unobserved meanwhile.
  done.catch(() => undefined);
  return { done, detail };
}
