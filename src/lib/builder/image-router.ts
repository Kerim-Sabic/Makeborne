/**
 * Image orchestration: picks the GPT Image model, quality and size for each
 * image from the request's explicit fields (owner direction, Kerim, 2026-10-21:
 * "if the image needs text on it, the newer 2.5 model; if not, a lower model").
 *
 * - needs text  -> a 2.5 model: flare for new images, sunburst when the words
 *                  must sit exactly where asked (editing precision);
 * - transparent -> a 2.5 model (gpt-image-2 refuses transparent backgrounds);
 * - edit        -> sunburst (the builder has no source-image input yet, so it
 *                  is refused with a clear message);
 * - otherwise   -> the cheapest allowed model at the quality the asset needs,
 *                  by its price-card bound (measured on 2026-10-20: at medium a
 *                  2.5 image is about a quarter of gpt-image-2's price; at low,
 *                  for textures, gpt-image-2 is cheapest).
 * Models come from the ordered allowlist MAKEBORNE_IMAGE_MODELS (or the single
 * MAKEBORNE_IMAGE_MODEL); each needs a current price card. gpt-image-1 is never
 * routed (shutdown 2026-10-23) and any model past its price card's shutdown
 * date, unpriced, or stopped after an overrun is skipped. A hard need (text,
 * transparency) that no allowed model meets is an error, never a silent drop.
 */
import { PRICE_EVIDENCE, imageCallBoundMicrousd, imagePrice, supportsTransparentImages, type ImageQuality, type ImageSize } from "../ai/prices";
import { imageModelDisabled } from "../ai/image-health";

export const IMAGE_KINDS = ["photo", "illustration", "cutout", "texture", "icon"] as const;
export type ImageKind = typeof IMAGE_KINDS[number];
export type ImageAspect = "landscape" | "portrait" | "square";
export const ROUTER_SIZES: Record<ImageAspect, ImageSize> = { landscape: "1536x1024", portrait: "1024x1536", square: "1024x1024" };
export const TEXT_IMAGE_MODELS = Object.freeze(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]);
/** Never routed, whatever the allowlist says. */
export const NEVER_ROUTED = Object.freeze(["gpt-image-1"]);

export type ImageTask = {
  kind: ImageKind; aspect: ImageAspect;
  /** Exact words to render in the image; null for no text. */
  text: string | null;
  /** "exact": the words must sit precisely where the prompt says. */
  textPlacement?: "exact" | "loose";
  /** A source image is supplied to edit. */
  edit?: boolean;
};
export type ImageRoute =
  | { ok: true; model: string; quality: ImageQuality; size: ImageSize; background: "opaque" | "transparent"; allowHigh: boolean; reason: string; prompt: string; boundMicrousd: number }
  | { ok: false; error: string };

/** Quality each asset needs (measured: medium is client-grade for photos and cut-outs; textures read well at low). */
export const KIND_QUALITY: Readonly<Record<ImageKind, ImageQuality>> = Object.freeze({ photo: "medium", illustration: "medium", cutout: "medium", texture: "low", icon: "medium" });

export type AllowedImageModels = { models: string[]; issues: string[] };

/** The routable models, in allowlist order, with a reason for every model left out. */
export function allowedImageModels(env: Record<string, string | undefined> = process.env, now = Date.now()): AllowedImageModels {
  if (!env.OPENAI_API_KEY) return { models: [], issues: ["OPENAI_API_KEY is not set"] };
  const list = env.MAKEBORNE_IMAGE_MODELS?.trim() ? env.MAKEBORNE_IMAGE_MODELS.split(",") : env.MAKEBORNE_IMAGE_MODEL?.trim() ? [env.MAKEBORNE_IMAGE_MODEL] : [];
  if (!list.length) return { models: [], issues: ["MAKEBORNE_IMAGE_MODEL is not set"] };
  const models: string[] = [], issues: string[] = [];
  for (const raw of list) {
    const model = raw.trim();
    if (!model || models.includes(model)) continue;
    if (NEVER_ROUTED.includes(model)) { issues.push(`${model} is never routed (provider shutdown 2026-10-23)`); continue; }
    if (!PRICE_EVIDENCE.some(item => item.provider === "openai" && item.model === model)) { issues.push(`${model} has no price card`); continue; }
    try { imagePrice(model, now); } catch (error) { issues.push(`${model} cannot be used: ${error instanceof Error ? error.message : String(error)}`); continue; }
    if (imageModelDisabled(model)) { issues.push(`${model} is stopped after an overrun until reviewed`); continue; }
    models.push(model);
  }
  return { models, issues };
}

const bounded = (model: string, quality: ImageQuality, size: ImageSize) => { try { return Boolean(imagePrice(model).outputTokens[quality]?.[size]); } catch { return false; } };
const textInstruction = (text: string, placement: "exact" | "loose") =>
  ` Render this text in the image, spelled exactly, letter for letter, and nothing else: "${text.replace(/"/g, "'")}". Use a clean, legible typeface with strong contrast against its background${placement === "exact" ? ", placed exactly where described above" : ""}. No other words, letters, logos or watermarks.`;
const NO_TEXT = " No text, no letters, no logos, no watermarks.";

/** Pick model, quality and size for one image. `allowed` is allowedImageModels().models (ordered). */
export function routeImage(task: ImageTask, prompt: string, allowed: readonly string[]): ImageRoute {
  const size = ROUTER_SIZES[task.aspect];
  const text = task.text?.trim() ? task.text.trim() : null;
  const transparent = task.kind === "cutout";
  if (task.edit) return { ok: false, error: "Editing an existing image needs gpt-image-2.5-sunburst with a source image, which the website builder does not support yet. Generate a new image instead." };
  if (!allowed.length) return { ok: false, error: "Image generation is unavailable. Use CSS, typography and inline SVG." };
  const quality = KIND_QUALITY[task.kind];
  // Hard needs first: only 2.5 models render text and transparency here.
  let candidates = [...allowed];
  const needs: string[] = [];
  if (text) { candidates = candidates.filter(model => TEXT_IMAGE_MODELS.includes(model)); needs.push("text in the image"); }
  if (transparent) { candidates = candidates.filter(supportsTransparentImages); needs.push("a transparent background"); }
  if (!candidates.length) {
    return { ok: false, error: text
      ? "Text in an image needs a GPT Image 2.5 model, which isn't enabled. Generate the image without text and set the words in HTML/CSS over it."
      : "Transparent cut-outs need a GPT Image 2.5 model, which isn't enabled. Use a photo whose background matches its frame, or CSS/SVG artwork." };
  }
  const pick = (model: string, reason: string, want: ImageQuality = quality): ImageRoute | null => {
    const chosen = bounded(model, want, size) ? want : bounded(model, "medium", size) ? "medium" : null;
    if (!chosen) return null;
    const full = `${prompt.trim()}${text ? textInstruction(text, task.textPlacement ?? "loose") : /no text/i.test(prompt) ? "" : NO_TEXT}`;
    return { ok: true, model, quality: chosen, size, background: transparent ? "transparent" : "opaque", allowHigh: false, reason: `${reason}${chosen !== want ? ` (${want} has no bound at ${size}; ${chosen})` : ""}`,
      prompt: full, boundMicrousd: imageCallBoundMicrousd(model, chosen, size, full) };
  };
  if (text || transparent) {
    // Preference inside the 2.5 family: sunburst for exact text placement, flare otherwise (faster, same price).
    const order = text && task.textPlacement === "exact" ? ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare"] : ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"];
    for (const model of order.filter(model => candidates.includes(model))) {
      const preferred = model === order[0];
      const route = pick(model, `${needs.join(" and ")} needs a 2.5 model; ${model}${preferred ? "" : ` (fallback: ${order[0]} not allowed)`}`);
      if (route) return route;
    }
    return { ok: false, error: `No enabled model has a bound for ${size} images with ${needs.join(" and ")}.` };
  }
  // No hard needs: the cheapest bounded option at the quality this asset needs; ties keep allowlist order.
  let best: Extract<ImageRoute, { ok: true }> | null = null;
  for (const model of candidates) {
    const route = pick(model, `no text or transparency: cheapest allowed model for a ${quality} ${task.kind} (${size})`);
    if (route?.ok && (!best || route.boundMicrousd < best.boundMicrousd)) best = route;
  }
  return best ?? { ok: false, error: `No enabled image model has a bound for ${size} images.` };
}
