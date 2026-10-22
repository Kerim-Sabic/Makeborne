import "server-only";
import { createHash } from "node:crypto";
import OpenAI from "openai";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImageClientLike } from "../ai/image-call";
import type { ImageSize } from "../ai/prices";
import { allowedImageModels } from "./image-router";
import type { SourceAsset } from "./files";
import { responsiveVariantBytes } from "./image-variants";
import responsive from "../../../infra/project-runtime/responsive-images.cjs";

export type ImageConfiguration = { model: string; models: string[]; issue: null } | { model: null; models: []; issue: string };
/**
 * Image generation is opt-in. It needs OPENAI_API_KEY and an explicit model
 * allowlist: MAKEBORNE_IMAGE_MODELS (ordered, comma-separated) or the single
 * MAKEBORNE_IMAGE_MODEL, each with a current, bounded price card. There is no
 * default model, so a provider retirement or a new release never changes spend
 * silently. The router (image-router.ts) picks among the allowed models per
 * image; `model` is the first one (document builds use it directly). Without a
 * usable configuration images are off and runs continue with typography, CSS
 * and SVG; every configured model left out is logged.
 */
export function imageConfiguration(now = Date.now()): ImageConfiguration {
  const { models, issues } = allowedImageModels(process.env, now);
  const configured = Boolean(process.env.OPENAI_API_KEY && (process.env.MAKEBORNE_IMAGE_MODELS?.trim() || process.env.MAKEBORNE_IMAGE_MODEL?.trim()));
  if (configured) for (const issue of issues) console.warn(`Image model left out. ${issue}`);
  if (!models.length) {
    const issue = issues.length === 1 && !configured ? issues[0] : `no usable image model (${issues.join("; ")})`;
    if (configured) console.warn(`Image generation is off. ${issue}`);
    return { model: null, models: [], issue };
  }
  return { model: models[0], models, issue: null };
}
export const IMAGE_SIZES: Record<ImageAspect, ImageSize> = { landscape: "1536x1024", portrait: "1024x1536", square: "1024x1024" };
export type ImageAspect = "landscape" | "portrait" | "square";

/** OpenAI client with no hidden retries; each attempt is budgeted by the caller. */
export function openaiImageClient(): ImageClientLike {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Image generation is not connected.");
  return new OpenAI({ apiKey, maxRetries: 0, timeout: 180_000 }) as unknown as ImageClientLike;
}

/** Deterministic asset id bound to workspace, project and exact bytes (same scheme as uploads). */
function assetId(workspaceId: string, projectId: string, sha256: string) {
  const digest = createHash("sha256").update(`${workspaceId}:${projectId}:${sha256}`).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

/** WebP quality for generated (opaque) images: measured 30-45% smaller than 84 on 2.5 photos and
 * illustrations at no visible loss, which matters because a generated hero is the LCP element.
 * Logos and other uploads keep 84. Cut-outs keep 84 with alpha quality 95. */
export const GENERATED_PHOTO_QUALITY = 76;

/** Smallest share of fully transparent pixels for an image to count as a cut-out. */
const CUTOUT_MIN_TRANSPARENT = 0.02;

/**
 * WebP bytes for storage. Opaque images: re-encoded at quality 84. Cut-outs
 * (requested transparent and actually carrying alpha): trimmed to the subject
 * plus a 3% transparent margin, so CSS places the object rather than empty
 * canvas, and encoded with a high alpha quality for clean edges.
 */
export async function prepareImageBytes(input: Buffer, options: { transparent?: boolean; quality?: number } = {}) {
  const source = sharp(input).rotate();
  const meta = await source.metadata();
  if (options.transparent && meta.hasAlpha) {
    const { data, info } = await sharp(input).rotate().ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
    let clear = 0;
    for (let index = 0; index < data.length; index++) if (data[index] < 8) clear++;
    if (clear / (info.width * info.height) >= CUTOUT_MIN_TRANSPARENT) {
      const trimmed = await sharp(input).rotate().trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 }).toBuffer({ resolveWithObject: true });
      const pad = Math.max(8, Math.round(Math.max(trimmed.info.width, trimmed.info.height) * 0.03));
      const bytes = await sharp(trimmed.data).extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality: 84, alphaQuality: 95 }).toBuffer();
      return { bytes, transparent: true };
    }
  }
  return { bytes: await source.webp({ quality: options.quality ?? 84, ...(options.quality ? { smartSubsample: true, effort: 5 } : {}) }).toBuffer(), transparent: false };
}

/** Upload final WebP bytes and register them as a project asset (idempotent: the id is bound to the bytes). */
async function registerImageBytes(client: SupabaseClient, scope: { workspaceId: string; projectId: string }, bytes: Buffer, provenance: Record<string, unknown>) {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const id = assetId(scope.workspaceId, scope.projectId, sha256);
  const objectPath = `${scope.workspaceId}/${scope.projectId}/artwork/${id}.webp`;
  const existing = await client.from("assets").select("id").eq("workspace_id", scope.workspaceId).eq("id", id).maybeSingle();
  if (existing.error) throw new Error("Asset registry unavailable.");
  if (!existing.data) {
    const uploaded = await client.storage.from("project-assets").upload(objectPath, bytes, { contentType: "image/webp", upsert: false, cacheControl: "0" });
    if (uploaded.error && !/exists|duplicate/i.test(uploaded.error.message)) throw new Error("Image storage failed.");
    const inserted = await client.from("assets").insert({ id, workspace_id: scope.workspaceId, project_id: scope.projectId, object_path: objectPath,
      content_type: "image/webp", sha256, provenance: { ...provenance, byteLength: bytes.length } });
    if (inserted.error && inserted.error.code !== "23505") throw new Error("Image registration failed.");
  }
  return { id, sha256 };
}

/** Store original bytes as a registered project asset through the caller's
 * RLS-bound client, so the existing source-asset verifier accepts it. */
export async function storeProjectImage(client: SupabaseClient, scope: { workspaceId: string; projectId: string }, input: Buffer, provenance: Record<string, unknown>, options: { transparent?: boolean; quality?: number } = {}) {
  const prepared = await prepareImageBytes(input, options);
  const bytes = prepared.bytes;
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height) throw new Error("Generated image could not be decoded.");
  const { id, sha256 } = await registerImageBytes(client, scope, bytes, { ...provenance, width: meta.width, height: meta.height, background: prepared.transparent ? "transparent" : "opaque" });
  return { id, sha256, bytes: bytes.length, width: meta.width, height: meta.height, transparent: prepared.transparent, data: bytes };
}

/**
 * Downscaled copies of a stored image (srcset widths, see responsive-images.cjs),
 * each registered as its own asset through the same RLS-bound client and placed
 * at public/images/_r/<sha16>-<W>x<H>/<w>.webp, so the authorised asset route,
 * the source-asset verifier, the trusted build and the site host treat them like
 * any project image. Best effort: `fits` (the site's image budget) can decline
 * them, and a failure leaves the original usable on its own.
 */
export async function storeResponsiveVariants(client: SupabaseClient, scope: { workspaceId: string; projectId: string },
  original: { id: string; path: string; sha256: string; width: number; height: number; data: Buffer },
  options: { quality?: number; fits?: (added: { bytes: number }[]) => boolean } = {}): Promise<SourceAsset[]> {
  if (!responsive.isOriginalPath(original.path)) return [];
  try {
    const variants = await responsiveVariantBytes(original.data, { quality: options.quality });
    if (!variants.length || (options.fits && !options.fits(variants.map(variant => ({ bytes: variant.bytes.length }))))) return [];
    const stored: SourceAsset[] = [];
    for (const variant of variants) {
      const { id, sha256 } = await registerImageBytes(client, scope, variant.bytes, { kind: "responsive-variant", of: original.id, width: variant.width, height: variant.height });
      stored.push({ id, path: responsive.variantPath(original, variant.width), sha256, bytes: variant.bytes.length, mediaType: "image/webp" });
    }
    return stored;
  } catch (error) {
    console.warn(`Responsive copies skipped for ${original.path}: ${(error as Error).message}`);
    return [];
  }
}

/** The router's choice for one image, recorded on the stored asset. */
export type ImageRouteRecord = { model: string; quality: string; size: string; reason: string; text: string | null; costMicrousd: number | null; outputTokens: number | null; overrun: boolean };
export type GeneratedImageRequest = { name: string; prompt: string; model: string; kind?: string; transparent?: boolean; route?: ImageRouteRecord };
/** What the builder tells the model about a stored image, besides its URL. */
export type GeneratedImage = SourceAsset & { url: string; width?: number; height?: number; transparent?: boolean; variants?: SourceAsset[];
  /** The stored WebP bytes (for the builder's preview of the image; never persisted with the source). */
  data?: Buffer };

/** Registers generated bytes as a project image whose public URL is `/images/<name>.webp`.
 * With `options.variants` (website builds) it also stores the responsive copies
 * that the site's image budget callback accepts. */
export async function storeGeneratedImage(client: SupabaseClient, scope: { workspaceId: string; projectId: string }, request: GeneratedImageRequest, bytes: Buffer,
  options: { variants?: (added: { bytes: number }[]) => boolean } = {}): Promise<GeneratedImage> {
  const stored = await storeProjectImage(client, scope, bytes, { kind: "generated", model: request.model, prompt: request.prompt.slice(0, 2000), ...(request.kind ? { imageKind: request.kind } : {}), ...(request.route ? { route: request.route } : {}) }, { transparent: request.transparent, quality: GENERATED_PHOTO_QUALITY });
  const path = `public/images/${request.name}.webp`;
  const variants = options.variants ? await storeResponsiveVariants(client, scope, { ...stored, path }, { quality: GENERATED_PHOTO_QUALITY, fits: options.variants }) : undefined;
  return { id: stored.id, path, sha256: stored.sha256, bytes: stored.bytes, mediaType: "image/webp", url: `/images/${request.name}.webp`, width: stored.width, height: stored.height, transparent: stored.transparent, ...(variants ? { variants } : {}), data: stored.data };
}
