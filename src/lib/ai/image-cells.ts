import { imagePrice, MEASURED_HEADROOM, type ImageQuality, type ImageSize } from "./prices";

/**
 * Image cells: one (quality, size) a 2.5 model is asked for. A cell is usable only when prices.ts has a measured
 * bound for it (MEASURED_IMAGE_OUTPUT_TOKENS); everything else stays refused. This module chooses, for a wanted
 * shape and quality, the best measured canvas (the native size first, then a measured canvas that is cropped to the
 * shape), and holds the measurement plan for the cells the document and website features want.
 *
 * Sizes (OpenAI image-generation guide, checked 2026-10-26, 2.5 models): custom WIDTHxHEIGHT, both edges multiples
 * of 16, aspect ratio between 1:3 and 3:1, neither edge above 3840 px, 655,360 to 8,294,400 pixels in all;
 * "Resolutions above 2560x1440 are experimental", so Makeborne never asks for more pixels than 2560x1440.
 * Qualities: low, medium, high, xhigh, max, auto; Makeborne uses low to xhigh (max and auto have no bound).
 */
export const SIZE_RULES = Object.freeze({ multiple: 16, minPixels: 655_360, maxPixels: 2560 * 1440, maxEdge: 3840, maxRatio: 3 });

export const parseSize = (size: string) => {
  const match = /^(\d+)x(\d+)$/.exec(size);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
};
/** Why a size cannot be requested from a 2.5 model, or null. */
export function sizeIssue(size: string): string | null {
  const parsed = parseSize(size);
  if (!parsed) return `"${size}" is not WIDTHxHEIGHT`;
  const { width, height } = parsed, pixels = width * height, ratio = Math.max(width, height) / Math.min(width, height);
  if (width % SIZE_RULES.multiple || height % SIZE_RULES.multiple) return `${size}: both edges must be multiples of ${SIZE_RULES.multiple}`;
  if (Math.max(width, height) > SIZE_RULES.maxEdge) return `${size}: an edge is above ${SIZE_RULES.maxEdge} px`;
  if (ratio > SIZE_RULES.maxRatio) return `${size}: the aspect ratio is outside 1:3 to 3:1`;
  if (pixels < SIZE_RULES.minPixels) return `${size}: fewer than ${SIZE_RULES.minPixels} pixels`;
  if (pixels > SIZE_RULES.maxPixels) return `${size}: more pixels than 2560x1440 (experimental at the provider)`;
  return null;
}

/** True when the model has a measured bound for this cell (the only cells a call may use). */
export function cellMeasured(model: string, quality: ImageQuality, size: ImageSize) {
  try { return Boolean(imagePrice(model).outputTokens[quality]?.[size]); } catch { return false; }
}

export type Crop = { left: number; top: number; width: number; height: number };
/** The centred crop of a canvas to a width/height ratio (the whole canvas when it already has that ratio). */
export function cropFor(size: ImageSize, ratio: number): Crop {
  const { width, height } = parseSize(size)!;
  if (Math.abs(width / height - ratio) < 0.004) return { left: 0, top: 0, width, height };
  if (width / height > ratio) { const w = Math.round(height * ratio); return { left: Math.floor((width - w) / 2), top: 0, width: w, height }; }
  const h = Math.round(width / ratio);
  return { left: 0, top: Math.floor((height - h) / 2), width, height: h };
}

export type ResolvedCell = { ok: true; quality: ImageQuality; size: ImageSize; native: boolean; crop: Crop } | { ok: false; error: string };
/** The canvas to generate for a shape (`ratio` = width / height) at a quality: the first measured candidate, in order
 * (the native size first, then measured canvases that are cropped to the shape). Refused when none is measured. */
export function resolveCell(model: string, quality: ImageQuality, candidates: readonly ImageSize[], ratio: number): ResolvedCell {
  for (const size of candidates) {
    if (!cellMeasured(model, quality, size)) continue;
    const crop = cropFor(size, ratio);
    const { width, height } = parseSize(size)!;
    return { ok: true, quality, size, native: crop.width === width && crop.height === height, crop };
  }
  return { ok: false, error: `no measured ${quality} canvas for this shape yet (${candidates.join(", ")})` };
}
/** How much of each edge a crop removes, as percentages of the canvas (for the prompt's safe margins). */
export function cropMargins(size: ImageSize, crop: Crop) {
  const { width, height } = parseSize(size)!;
  return { x: Math.round(crop.left / width * 1000) / 10, y: Math.round(crop.top / height * 1000) / 10 };
}

/**
 * Reference observations, NOT bounds: output tokens the owner's own reel runs reported for gpt-image-2.5-sunburst
 * (Z:/makeborne-films/v13/gen/ledger.jsonl and v14/gen/out/*.log, 2026-10-24, same API and token rates). Each cell
 * returned the same count on every call (2560x1440 high: 20 calls, all 1843). They size the measurement plan's
 * estimate; a cell becomes usable only after Makeborne's own measurement records it in prices.ts.
 */
export const REFERENCE_OUTPUT_TOKENS: Readonly<Partial<Record<ImageQuality, Readonly<Record<string, number>>>>> = Object.freeze({
  high: { "2560x1440": 1843 },
  xhigh: { "2560x1440": 3276, "2560x1280": 2702, "1536x2048": 3952, "1280x1280": 3726, "2560x1600": 3902, "1152x2496": 2341 },
});
export const REFERENCE_EVIDENCE = "Z:/makeborne-films/v13/gen/ledger.jsonl (owner's reel image runs, 2026-10-24; reference only)";

/** Conservative ceilings for an unmeasured cell's output tokens (largest reference at that quality, rounded up). */
export const UNMEASURED_CEILING_TOKENS: Readonly<Record<"high" | "xhigh", number>> = Object.freeze({ high: 2500, xhigh: 4000 });

export type PlannedCell = { model: string; quality: "high" | "xhigh"; size: ImageSize; uses: string };
/** Sizes the features want, native to each shape (all within SIZE_RULES). */
export const WANTED_SIZES: Readonly<Record<string, { size: ImageSize; uses: string }>> = Object.freeze({
  wide: { size: "2560x1440", uses: "16:9 slides, desktop website comps" },
  standard: { size: "2048x1536", uses: "4:3 slides, 6x9 book spreads" },
  square: { size: "1920x1920", uses: "1:1 slides, square book pages" },
  vertical: { size: "1440x2560", uses: "9:16 slides" },
  page: { size: "1536x2304", uses: "6x9 book covers and pages" },
  squareSpread: { size: "2560x1280", uses: "square book spreads" },
  landscapePage: { size: "1600x1280", uses: "landscape (10x8) book pages" },
  landscapeSpread: { size: "2880x1152", uses: "landscape picture-book spreads" },
  phone: { size: "1152x2496", uses: "phone website comps" },
});
/** The measurement run: every wanted size at high and xhigh on sunburst (one call each: counts are deterministic per
 * cell), plus flare on three cells to confirm both models still match (the guide says they "can use different token
 * counts"; until confirmed, a cell measured on sunburst is recorded for sunburst only). */
export const MEASUREMENT_PLAN: readonly PlannedCell[] = Object.freeze([
  ...Object.values(WANTED_SIZES).flatMap(({ size, uses }) => (["high", "xhigh"] as const).map(quality => ({ model: "gpt-image-2.5-sunburst", quality, size, uses }))),
  { model: "gpt-image-2.5-flare", quality: "high", size: "2560x1440", uses: "parity check" },
  { model: "gpt-image-2.5-flare", quality: "high", size: "1536x2304", uses: "parity check" },
  { model: "gpt-image-2.5-flare", quality: "xhigh", size: "2048x1536", uses: "parity check" },
]);
/** Prompt used for every measurement call (a typical reference-style slide prompt, about 1,100 bytes). */
export const MEASUREMENT_PROMPT_BYTES = 1200;

/** Expected (reference or ceiling) and worst-case (ceiling x headroom) cost of the plan, at the published 2.5 rates:
 * $30 per 1M image output tokens and $5 per 1M text input tokens (prompt bytes bound its tokens). */
export function measurementEstimate(plan: readonly PlannedCell[] = MEASUREMENT_PLAN) {
  const rows = plan.map(cell => {
    const reference = REFERENCE_OUTPUT_TOKENS[cell.quality]?.[cell.size];
    const expectedTokens = reference ?? UNMEASURED_CEILING_TOKENS[cell.quality];
    const boundTokens = Math.ceil(UNMEASURED_CEILING_TOKENS[cell.quality] * MEASURED_HEADROOM);
    const prompt = MEASUREMENT_PROMPT_BYTES * 5e-6;
    return { ...cell, reference: reference ?? null, expectedUsd: expectedTokens * 30e-6 + prompt, boundUsd: boundTokens * 30e-6 + prompt };
  });
  const sum = (key: "expectedUsd" | "boundUsd") => Math.round(rows.reduce((total, row) => total + row[key], 0) * 10000) / 10000;
  return { rows, calls: rows.length, expectedUsd: sum("expectedUsd"), boundUsd: sum("boundUsd") };
}
