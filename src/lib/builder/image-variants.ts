import sharp from "sharp";
import responsive from "../../../infra/project-runtime/responsive-images.cjs";

export type ImageVariant = { width: number; height: number; bytes: Buffer };

/**
 * Downscaled WebP copies of a stored project image for srcset (widths from
 * responsive-images.cjs: 640/828/1280, never upscaled, only where they save
 * bytes). Opaque images use `quality` (the original's class, e.g. 76 for
 * generated photos); images with alpha keep the cut-out encoding (84, alpha 95).
 */
export async function responsiveVariantBytes(input: Buffer, options: { quality?: number } = {}): Promise<ImageVariant[]> {
  const meta = await sharp(input).metadata();
  if (!meta.width || !meta.height) return [];
  const variants: ImageVariant[] = [];
  for (const width of responsive.variantWidths(meta.width)) {
    const resized = sharp(input).resize({ width, withoutEnlargement: true });
    const bytes = await (meta.hasAlpha
      ? resized.webp({ quality: 84, alphaQuality: 95 })
      : resized.webp({ quality: options.quality ?? 84, smartSubsample: true, effort: 5 })).toBuffer();
    const info = await sharp(bytes).metadata();
    if (info.width !== width || !info.height) continue;
    variants.push({ width, height: info.height, bytes });
  }
  return variants;
}

/** Longest edge of the preview the builder sees of each generated image: 768 px keeps
 * hands, faces, lettering and straight lines legible for the inspection while costing at
 * most ~790 image tokens (a 768×768 square; 768×512 is ~520). */
export const IMAGE_PREVIEW_EDGE = 768;

/** Design comps are read for layout and type, so they are shown larger than a photo preview (~1.4k image tokens). */
export const COMP_PREVIEW_EDGE = 1024;

export type ImagePreview = { mediaType: "image/webp"; data: string; width: number; height: number };

/**
 * A small WebP of a stored image for the builder to look at (tool result image block).
 * Cut-outs are flattened onto a mid grey so their edges and halo stay visible
 * (transparent pixels would otherwise read as black or white).
 */
export async function imagePreview(input: Buffer, options: { maxEdge?: number } = {}): Promise<ImagePreview> {
  const edge = options.maxEdge ?? IMAGE_PREVIEW_EDGE;
  const meta = await sharp(input).metadata();
  if (!meta.width || !meta.height) throw new Error("The image could not be decoded.");
  let image = sharp(input).rotate().resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true });
  if (meta.hasAlpha) image = image.flatten({ background: { r: 138, g: 138, b: 138 } });
  const { data, info } = await image.webp({ quality: 72, effort: 4 }).toBuffer({ resolveWithObject: true });
  return { mediaType: "image/webp", data: data.toString("base64"), width: info.width, height: info.height };
}
