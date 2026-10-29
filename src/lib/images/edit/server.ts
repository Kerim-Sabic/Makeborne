import "server-only";
import OpenAI, { toFile } from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { downloadProjectAsset } from "../../cloud/asset-storage";
import { storeProjectImage } from "../../builder/images";
import { RequestError } from "../../server/http";
import type { ImageEditClientLike, ToUpload } from "../../ai/image-edit-call";
import { EDIT_LIMITS } from "./contract";
import type { EditAssets } from "./run";

/** Registered assets of ONE project through the caller's RLS-bound client; bytes are re-hashed by the caller. */
export function projectEditAssets(client: SupabaseClient, scope: { workspaceId: string; projectId: string }, download = downloadProjectAsset): EditAssets {
  return {
    async read(id) {
      const { data, error } = await client.from("assets").select("id,object_path,content_type,sha256,provenance")
        .eq("workspace_id", scope.workspaceId).eq("project_id", scope.projectId).eq("id", id).maybeSingle();
      if (error) throw new RequestError("CLOUD_UNAVAILABLE", "The image could not be read. Try again.", 503);
      if (!data || !["image/png", "image/jpeg", "image/webp"].includes(data.content_type) || !/^[a-f0-9]{64}$/.test(String(data.sha256))) return null;
      const file = await download(client, scope, data.object_path, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
      if (file.error || !file.data) throw new RequestError("CLOUD_UNAVAILABLE", "The image could not be read. Try again.", 503);
      if (file.data.size > EDIT_LIMITS.sourceBytes) throw new RequestError("EDIT_INPUT_TOO_LARGE", "This image is too large to edit. Use a smaller version of it.", 413);
      return { id: data.id, sha256: data.sha256, contentType: data.content_type, bytes: Buffer.from(await file.data.arrayBuffer()), provenance: data.provenance ?? null };
    },
    async store(bytes, provenance, options) {
      const stored = await storeProjectImage(client, scope, bytes, provenance, options);
      return { id: stored.id, sha256: stored.sha256, bytes: stored.bytes, width: stored.width, height: stored.height, mediaType: "image/webp" };
    },
  };
}

/** The Images API client for edits: no hidden retries, a hard timeout. Never constructed unless editing is enabled and a model is qualified. */
export function openaiEditClient(): ImageEditClientLike {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new RequestError("IMAGE_EDITING_UNAVAILABLE", "Image editing isn't available yet.", 404);
  return new OpenAI({ apiKey, maxRetries: 0, timeout: 180_000 }) as unknown as ImageEditClientLike;
}
export const openaiUpload: ToUpload = upload => toFile(upload.bytes, upload.name, { type: upload.type });
