import "server-only";
import sharp from "sharp";

/** Decode a single still original. Callers own identity, byte limits and errors. */
export async function verifyStillRaster(bytes: Uint8Array, mediaType: string) {
  const image = sharp(bytes, {limitInputPixels: 20_000_000, failOn: "warning"});
  const metadata = await image.metadata();
  if (`image/${metadata.format}` !== mediaType || (metadata.pages ?? 1) !== 1 || !metadata.width || !metadata.height) throw new Error("INVALID_STILL_RASTER");
  await image.resize({width: 1, height: 1, fit: "inside"}).timeout({seconds: 8}).png().toBuffer();
  return {width: metadata.width, height: metadata.height};
}
