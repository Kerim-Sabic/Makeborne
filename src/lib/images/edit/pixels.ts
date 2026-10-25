import { createHash } from "node:crypto";
import sharp from "sharp";
import { RequestError } from "../../server/http";
import { EDIT_LIMITS, type DeterministicEdit, type EditOperation, type Region } from "./contract";

/**
 * Ordinary, deterministic image processing for edits (sharp, no model):
 * verification, normalisation of what is sent, the "extend" canvas and mask,
 * exact compositing of protected regions, and the plain operations (resize,
 * crop, compress, composite) that never need a model call.
 */
const refuse = (code: string, message: string, status = 400) => new RequestError(code, message, status);
export type VerifiedImage = { bytes: Buffer; width: number; height: number; hasAlpha: boolean; format: "png" | "jpeg" | "webp" };

/** Bytes must match the registered sha256 and decode as one still raster within the limits. */
export async function verifyImageBytes(bytes: Buffer, expectedSha256: string, limits: { bytes: number; pixels?: number } = { bytes: EDIT_LIMITS.sourceBytes }): Promise<VerifiedImage> {
  if (!bytes.length || bytes.length > limits.bytes) throw refuse("EDIT_INPUT_TOO_LARGE", "This image is too large to edit. Use a smaller version of it.", 413);
  if (createHash("sha256").update(bytes).digest("hex") !== expectedSha256) throw refuse("EDIT_INPUT_CHANGED", "This image no longer matches the one you chose. Reload the project and try again.", 409);
  try {
    const image = sharp(bytes, { limitInputPixels: limits.pixels ?? EDIT_LIMITS.sourcePixels, failOn: "warning" });
    const meta = await image.metadata();
    if (!["png", "jpeg", "webp"].includes(meta.format ?? "") || (meta.pages ?? 1) !== 1 || !meta.width || !meta.height) throw new Error("format");
    await image.resize({ width: 1, height: 1, fit: "inside" }).timeout({ seconds: 8 }).png().toBuffer();
    return { bytes, width: meta.width, height: meta.height, hasAlpha: Boolean(meta.hasAlpha), format: meta.format as VerifiedImage["format"] };
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw refuse("EDIT_INPUT_INVALID", "This image could not be read. Use a still PNG, JPEG or WebP image under 20 megapixels.", 415);
  }
}

/** A mask: PNG, exactly the source's dimensions, with an alpha channel that marks some (not all) of the image as editable. */
export async function validateMask(maskBase64: string, source: { width: number; height: number }) {
  const bytes = Buffer.from(maskBase64, "base64");
  if (!bytes.length || bytes.length > EDIT_LIMITS.maskBytes || bytes.toString("base64") !== maskBase64) throw refuse("EDIT_MASK_INVALID", "The mask must be a PNG under 4 MB.");
  let meta;
  try { meta = await sharp(bytes, { limitInputPixels: EDIT_LIMITS.sourcePixels, failOn: "warning" }).metadata(); }
  catch { throw refuse("EDIT_MASK_INVALID", "The mask could not be read. Draw it again."); }
  if (meta.format !== "png") throw refuse("EDIT_MASK_INVALID", "The mask must be a PNG image.");
  if (meta.width !== source.width || meta.height !== source.height) throw refuse("EDIT_MASK_INVALID", "The mask must be exactly the same size as the image.");
  if (!meta.hasAlpha || meta.channels !== 4) throw refuse("EDIT_MASK_INVALID", "The mask needs transparency where the picture may change.");
  const alpha = await sharp(bytes).ensureAlpha().extractChannel(3).raw().toBuffer();
  let clear = 0;
  for (const value of alpha) if (value < 8) clear++;
  const share = clear / alpha.length;
  if (share < 0.005) throw refuse("EDIT_MASK_INVALID", "The mask doesn't mark any area to change.");
  if (share > 0.995) throw refuse("EDIT_MASK_INVALID", "The mask marks the whole picture. Describe the change without a mask instead.");
  return { bytes, editableShare: share };
}

export type Placement = { left: number; top: number; width: number; height: number };
export type NormalisedEdit = { image: Buffer; mask?: Buffer; references: Buffer[]; placement: Placement; size: { width: number; height: number }; autoMask: boolean };

const png = (image: ReturnType<typeof sharp>) => image.png({ compressionLevel: 9 }).toBuffer();

/**
 * What is sent, always exactly the output size (so one measured cell bounds the
 * call): the source resized to the canvas (an aspect difference above 2% is
 * refused except for "extend", which places the source on a larger transparent
 * canvas and builds the mask from it), the mask with the same transform
 * (nearest neighbour: alpha stays binary), references fitted inside it.
 */
export async function normaliseForEdit(input: { source: VerifiedImage; operation: EditOperation; size: string; mask?: Buffer; references: VerifiedImage[] }): Promise<NormalisedEdit> {
  const [width, height] = input.size.split("x").map(Number);
  const target = width / height, actual = input.source.width / input.source.height;
  let placement: Placement, image: Buffer, mask: Buffer | undefined, autoMask = false;
  if (input.operation === "extend") {
    // The source keeps its shape, fitted inside the canvas; with the same shape it is shrunk to 80% so there is new picture around it.
    const fit = Math.min(width / input.source.width, height / input.source.height);
    const scale = Math.abs(actual - target) / target <= EDIT_LIMITS.aspectTolerance ? fit * 0.8 : fit;
    const w = Math.max(16, Math.floor(input.source.width * scale)), h = Math.max(16, Math.floor(input.source.height * scale));
    placement = { left: Math.floor((width - w) / 2), top: Math.floor((height - h) / 2), width: w, height: h };
    const inner = await sharp(input.source.bytes).rotate().resize(w, h, { fit: "fill" }).ensureAlpha().png().toBuffer();
    image = await png(sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: inner, left: placement.left, top: placement.top }]));
    const keep = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 255 } } }).png().toBuffer();
    mask = await png(sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: keep, left: placement.left, top: placement.top }]));
    autoMask = true;
  } else {
    if (Math.abs(actual - target) / target > EDIT_LIMITS.aspectTolerance)
      throw refuse("EDIT_ASPECT_MISMATCH", "Choose the output shape that matches this image, or use \"Extend the picture\" to change its shape.");
    placement = { left: 0, top: 0, width, height };
    image = await png(sharp(input.source.bytes).rotate().resize(width, height, { fit: "fill" }).ensureAlpha());
    if (input.mask) mask = await png(sharp(input.mask).resize(width, height, { fit: "fill", kernel: "nearest" }).ensureAlpha());
  }
  const references = [];
  for (const reference of input.references) references.push(await png(sharp(reference.bytes).rotate().resize(width, height, { fit: "inside", withoutEnlargement: true })));
  const total = image.length + (mask?.length ?? 0) + references.reduce((sum, item) => sum + item.length, 0);
  if (total > EDIT_LIMITS.payloadBytes) throw refuse("EDIT_INPUT_TOO_LARGE", "These images are too large to send together. Use fewer references.", 413);
  return { image, ...(mask ? { mask } : {}), references, placement, size: { width, height }, autoMask };
}

/** Pixel rectangles of fractional regions of the source, mapped onto the edit canvas. */
export function regionRects(regions: readonly Region[], placement: Placement) {
  return regions.map(region => {
    const left = placement.left + Math.floor(region.x * placement.width), top = placement.top + Math.floor(region.y * placement.height);
    const right = placement.left + Math.ceil((region.x + region.width) * placement.width), bottom = placement.top + Math.ceil((region.y + region.height) * placement.height);
    return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
  });
}

/**
 * Deterministic compositing for fidelity-critical elements: the original
 * (normalised) pixels of each protected region are pasted back over the
 * generated result, byte for byte. The seams still need a person to look.
 */
export async function compositeProtected(generated: Buffer, normalisedSource: Buffer, regions: readonly Region[], placement: Placement) {
  if (!regions.length) return generated;
  const layers = [];
  for (const rect of regionRects(regions, placement)) layers.push({ input: await sharp(normalisedSource).extract(rect).png().toBuffer(), left: rect.left, top: rect.top });
  return png(sharp(generated).ensureAlpha().composite(layers));
}

/** Raw RGBA pixels of one region (for exactness checks). */
export async function regionPixels(image: Buffer, rect: { left: number; top: number; width: number; height: number }) {
  return sharp(image).ensureAlpha().extract(rect).raw().toBuffer();
}

/** A cut-out must really be transparent around the subject. */
export async function transparentShare(bytes: Buffer) {
  const meta = await sharp(bytes).metadata();
  if (!meta.hasAlpha) return 0;
  const alpha = await sharp(bytes).ensureAlpha().extractChannel(3).raw().toBuffer();
  let clear = 0;
  for (const value of alpha) if (value < 8) clear++;
  return clear / alpha.length;
}

/** Plain operations, no model call. Returns PNG (exact) bytes; storage re-encodes per its rules. */
export async function deterministicEdit(source: VerifiedImage, op: DeterministicEdit["op"], overlay?: VerifiedImage): Promise<{ bytes: Buffer; lossless: boolean; quality?: number }> {
  const base = sharp(source.bytes).rotate();
  if (op.type === "resize") return { bytes: await png(base.resize(op.width, op.height, { fit: op.fit, withoutEnlargement: op.fit === "inside" })), lossless: false };
  if (op.type === "crop") {
    const rect = regionRects([op.region], { left: 0, top: 0, width: source.width, height: source.height })[0];
    rect.width = Math.min(rect.width, source.width - rect.left); rect.height = Math.min(rect.height, source.height - rect.top);
    if (rect.width < 16 || rect.height < 16) throw refuse("EDIT_REGION_TOO_SMALL", "Choose a larger area.");
    return { bytes: await png(base.extract(rect)), lossless: false };
  }
  if (op.type === "compress") return { bytes: await png(base), lossless: false, quality: op.quality };
  if (!overlay) throw refuse("EDIT_INPUT_INVALID", "Choose the image to place.");
  const rect = regionRects([op.region], { left: 0, top: 0, width: source.width, height: source.height })[0];
  rect.width = Math.min(rect.width, source.width - rect.left); rect.height = Math.min(rect.height, source.height - rect.top);
  const placed = await sharp(overlay.bytes).rotate().resize(rect.width, rect.height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).ensureAlpha().png().toBuffer();
  // Exact composite: stored losslessly so the label or logo keeps its pixels.
  return { bytes: await png(base.ensureAlpha().composite([{ input: placed, left: rect.left, top: rect.top }])), lossless: true };
}
