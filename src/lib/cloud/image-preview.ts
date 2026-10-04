import sharp from "sharp";

export const MAX_PREVIEW_SOURCE_BYTES = 8 * 1024 * 1024;
/** Decode raster pixels and strip metadata; never serve uploaded markup or original bytes. */
export async function renderAssetPreview(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > MAX_PREVIEW_SOURCE_BYTES) throw new Error("Choose an image under 8 MB.");
  const input = sharp(bytes, { limitInputPixels: 20_000_000, failOn: "warning" });
  const metadata = await input.metadata();
  if (!metadata.format || !["png", "jpeg", "webp"].includes(metadata.format) || (metadata.pages ?? 1) !== 1) {
    throw new Error("Preview supports still PNG, JPEG, and WebP images.");
  }
  return input.rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
}

/** Preserve raster resolution for downloads; never substitute the smaller preview. */
export async function renderAssetExport(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > MAX_PREVIEW_SOURCE_BYTES) throw new Error("Export artwork must be under 8 MB.");
  const input = sharp(bytes, { limitInputPixels: 16_777_216, failOn: "warning" });
  const metadata = await input.metadata();
  if (!metadata.format || !["png", "jpeg", "webp"].includes(metadata.format) || (metadata.pages ?? 1) !== 1 || !metadata.width || !metadata.height || metadata.width > 4096 || metadata.height > 4096) {
    throw new Error("Export supports still PNG, JPEG, or WebP artwork up to 4096 pixels per side.");
  }
  const output = await input.rotate().toColourspace("srgb").webp({ lossless: true }).timeout({ seconds: 8 }).toBuffer();
  if (output.length > 3_000_000) throw new Error("This artwork exceeds the 3 MB export limit. Use a smaller source image.");
  return output;
}
