import { assertSupportedImageRequest, imageCallBoundMicrousd, imageUsageMicrousd, type ImageQuality, type ImageSize, type ImageUsageLike } from "./prices";
import type { RunSpend } from "./run-spend";

export type ImageClientLike = { images: {
  generate(body: Record<string, unknown>, options: { signal?: AbortSignal; maxRetries: number; timeout?: number }): Promise<{ data?: Array<{ b64_json?: string | null }> | null; usage?: ImageUsageLike | null }>;
} };

/**
 * Reserves one image's bound now (so the run's budget is checked before any
 * provider contact) and returns the running generation as `done`. No SDK retries.
 * Usage reported by the API is the actual cost; without it the bound is spent.
 */
export async function startBudgetedImage(input: {
  client: ImageClientLike; spend: RunSpend; model: string; prompt: string; size: ImageSize; quality: ImageQuality; signal: AbortSignal;
}): Promise<{ done: Promise<Buffer> }> {
  assertSupportedImageRequest({ model: input.model, quality: input.quality, size: input.size });
  const bound = imageCallBoundMicrousd(input.model, input.quality, input.size, input.prompt);
  const ticket = await input.spend.begin("openai", input.model, bound);
  const timeout = Math.max(1, Math.min(180_000, input.spend.timeLeftMs()));
  const done = (async () => {
    let response;
    try {
      response = await input.client.images.generate({ model: input.model, prompt: input.prompt, n: 1, size: input.size, quality: input.quality, output_format: "webp", output_compression: 90 },
        { signal: AbortSignal.any([input.signal, AbortSignal.timeout(timeout)]), maxRetries: 0, timeout });
    } catch (error) {
      const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : undefined;
      // Rate limited before processing: not billed. Anything else may have been.
      await input.spend.finish(ticket, status === 429 ? { actualMicrousd: 0, detail: { status } } : { actualMicrousd: null, detail: { status: status ?? null } });
      throw error;
    }
    let cost: number | null = null;
    try { cost = response.usage ? imageUsageMicrousd(input.model, response.usage) : null; } catch { cost = null; }
    await input.spend.finish(ticket, cost === null ? { actualMicrousd: null, detail: { reason: "usage_missing" } } : { actualMicrousd: cost });
    const encoded = response.data?.[0]?.b64_json;
    if (!encoded) throw new Error("The image service returned no image.");
    return Buffer.from(encoded, "base64");
  })();
  // Callers attach handlers later; never leave a rejection unobserved meanwhile.
  done.catch(() => undefined);
  return { done };
}
