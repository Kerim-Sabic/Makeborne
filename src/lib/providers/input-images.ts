import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import {verifyStillRaster} from "../media/verified-raster";

export const MAX_MODEL_INPUT_IMAGES = 20;

/** Originals only, no URLs, remote fetches or executable formats. */
export const ModelInputImageSchema = z.object({
  assetId: z.string().uuid(), mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  data: z.string().min(4).max(4_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict();
export const ModelInputImagesSchema = z.array(ModelInputImageSchema).max(MAX_MODEL_INPUT_IMAGES).superRefine((images, context) => {
  let total = 0;
  const ids = new Set<string>();
  for (const [index, image] of images.entries()) {
    const bytes = Buffer.from(image.data, "base64"), id = image.assetId.toLowerCase();
    total += bytes.length;
    if (ids.has(id) || !bytes.length || bytes.length > 3_000_000 || total > 12_000_000
      || bytes.toString("base64") !== image.data || createHash("sha256").update(bytes).digest("hex") !== image.sha256) {
      context.addIssue({code: "custom", path: [index], message: "Invalid original image identity or bounds."});
      return;
    }
    ids.add(id);
  }
});
export type ModelInputImage = z.infer<typeof ModelInputImageSchema>;

export async function verifyModelInputImages(images: readonly ModelInputImage[], signal: AbortSignal) {
  for (const image of images) {
    signal.throwIfAborted();
    const metadata = await verifyStillRaster(Buffer.from(image.data, "base64"), image.mediaType);
    if (metadata.width > 8000 || metadata.height > 8000) throw new Error("MODEL_IMAGE_DIMENSIONS_EXCEEDED");
  }
  signal.throwIfAborted();
}
