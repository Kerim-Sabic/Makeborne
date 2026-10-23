import { IMAGE_EDIT_EVIDENCE, MAX_EDIT_PROMPT_BYTES, MEASURED_EDIT_TOKENS, imageEditCallBoundMicrousd, type EditTokenTable } from "../../ai/image-edit-prices";
import { imageModelDisabled } from "../../ai/image-health";
import { UnpricedModelError, UnsupportedConfigurationError, type ImageQuality, type ImageSize } from "../../ai/prices";
import type { EditOperation, EditSettings } from "./contract";

/**
 * Model choice for an edit, server-side only. Precision edits (backgrounds,
 * objects, extension, cut-outs) prefer the model OpenAI names for editing
 * precision; restyles and variants may use the routine model first. A model is
 * eligible only when ALL of these hold: it is on the operator allowlist
 * MAKEBORNE_IMAGE_EDIT_MODELS (unset: none), it has edit evidence, it is not
 * stopped after an overrun, and its (quality, size) cell is bounded by a
 * recorded live measurement. A model name, a quality level or a generation
 * result never qualifies an edit on its own. Nothing here is customer-facing.
 */
export const OPERATION_ROLE: Readonly<Record<EditOperation, "precision" | "routine">> = Object.freeze({
  background_replace: "precision", object_remove: "precision", object_replace: "precision", extend: "precision", cutout: "precision",
  relight_restyle: "routine", variant: "routine",
});
const PREFERENCE: Readonly<Record<"precision" | "routine", readonly string[]>> = Object.freeze({
  precision: Object.freeze(["gpt-image-2.5-sunburst"]),
  routine: Object.freeze(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-2"]),
});

export function allowedEditModels(env: Record<string, string | undefined> = process.env) {
  if (!env.OPENAI_API_KEY) return [];
  return [...new Set((env.MAKEBORNE_IMAGE_EDIT_MODELS ?? "").split(",").map(item => item.trim()).filter(Boolean))];
}

export type EditRoute = { ok: true; model: string; maxBoundMicrousd: number; reason: string } | { ok: false; code: "EDIT_UNSUPPORTED"; message: string; detail: string[] };
const CUSTOMER_UNSUPPORTED = "This kind of edit isn't available at this size and quality yet.";

/** The model for this edit and the bound of its largest possible prompt (what the estimate shows). */
export function routeImageEdit(input: { operation: EditOperation; settings: EditSettings; images: number; mask: boolean }, allowed: readonly string[], table: EditTokenTable = MEASURED_EDIT_TOKENS, now = Date.now()): EditRoute {
  const role = OPERATION_ROLE[input.operation];
  const detail: string[] = [];
  for (const model of PREFERENCE[role]) {
    const evidence = IMAGE_EDIT_EVIDENCE.find(item => item.model === model);
    if (!allowed.includes(model)) { detail.push(`${model}: not on MAKEBORNE_IMAGE_EDIT_MODELS`); continue; }
    if (!evidence) { detail.push(`${model}: no edit evidence`); continue; }
    if (imageModelDisabled(model)) { detail.push(`${model}: stopped after an overrun until reviewed`); continue; }
    try {
      const bound = imageEditCallBoundMicrousd({ model, quality: input.settings.quality as ImageQuality, size: input.settings.size as ImageSize, images: input.images, mask: input.mask,
        background: input.settings.background, prompt: "x".repeat(MAX_EDIT_PROMPT_BYTES) }, table, now);
      return { ok: true, model, maxBoundMicrousd: bound.boundMicrousd, reason: `${input.operation} is ${role}; ${model} is allowed and measured at ${input.settings.quality} ${input.settings.size}` };
    } catch (error) {
      if (error instanceof UnsupportedConfigurationError || error instanceof UnpricedModelError) { detail.push(`${model}: ${error.message}`); continue; }
      throw error;
    }
  }
  return { ok: false, code: "EDIT_UNSUPPORTED", message: CUSTOMER_UNSUPPORTED, detail };
}
