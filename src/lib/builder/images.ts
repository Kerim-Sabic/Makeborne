import "server-only";
import { createHash } from "node:crypto";
import OpenAI from "openai";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SourceAsset } from "./files";

export const imageGenerationAvailable = () => Boolean(process.env.OPENAI_API_KEY);
const imageModel = () => process.env.MAKEBORNE_IMAGE_MODEL || "gpt-image-1";
const SIZES = { landscape: "1536x1024", portrait: "1024x1536", square: "1024x1024" } as const;
export type ImageAspect = keyof typeof SIZES;

/** Deterministic asset id bound to workspace, project and exact bytes (same scheme as uploads). */
function assetId(workspaceId: string, projectId: string, sha256: string) {
  const digest = createHash("sha256").update(`${workspaceId}:${projectId}:${sha256}`).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

/** Store original bytes as a registered project asset through the caller's
 * RLS-bound client, so the existing source-asset verifier accepts it. */
export async function storeProjectImage(client: SupabaseClient, scope: { workspaceId: string; projectId: string }, input: Buffer, provenance: Record<string, unknown>) {
  const bytes = await sharp(input).rotate().webp({ quality: 84 }).toBuffer();
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height) throw new Error("Generated image could not be decoded.");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const id = assetId(scope.workspaceId, scope.projectId, sha256);
  const objectPath = `${scope.workspaceId}/${scope.projectId}/artwork/${id}.webp`;
  const existing = await client.from("assets").select("id").eq("workspace_id", scope.workspaceId).eq("id", id).maybeSingle();
  if (existing.error) throw new Error("Asset registry unavailable.");
  if (!existing.data) {
    const uploaded = await client.storage.from("project-assets").upload(objectPath, bytes, { contentType: "image/webp", upsert: false, cacheControl: "0" });
    if (uploaded.error && !/exists|duplicate/i.test(uploaded.error.message)) throw new Error("Image storage failed.");
    const inserted = await client.from("assets").insert({ id, workspace_id: scope.workspaceId, project_id: scope.projectId, object_path: objectPath,
      content_type: "image/webp", sha256, provenance: { ...provenance, byteLength: bytes.length, width: meta.width, height: meta.height } });
    if (inserted.error && inserted.error.code !== "23505") throw new Error("Image registration failed.");
  }
  return { id, sha256, bytes: bytes.length, width: meta.width, height: meta.height };
}

/** Generate one original image and register it. Returns the source asset entry
 * whose public URL is `/images/<name>.webp`. */
export async function generateProjectImage(client: SupabaseClient, scope: { workspaceId: string; projectId: string }, request: { name: string; prompt: string; aspect: ImageAspect }, signal: AbortSignal): Promise<SourceAsset & { url: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Image generation is not connected.");
  const openai = new OpenAI({ apiKey, maxRetries: 1, timeout: 180_000 });
  const response = await openai.images.generate({ model: imageModel(), prompt: request.prompt, n: 1, size: SIZES[request.aspect], quality: "medium", output_format: "webp", output_compression: 90 }, { signal });
  const encoded = response.data?.[0]?.b64_json;
  if (!encoded) throw new Error("The image service returned no image.");
  const stored = await storeProjectImage(client, scope, Buffer.from(encoded, "base64"), { kind: "generated", model: imageModel(), prompt: request.prompt.slice(0, 2000) });
  const path = `public/images/${request.name}.webp`;
  return { id: stored.id, path, sha256: stored.sha256, bytes: stored.bytes, mediaType: "image/webp", url: `/images/${request.name}.webp` };
}
