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
