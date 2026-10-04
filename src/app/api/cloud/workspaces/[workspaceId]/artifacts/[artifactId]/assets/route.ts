import { createHash } from "node:crypto";
import sharp from "sharp";
import { cloudContext, cloudError, cloudJson, databaseError, validId } from "@/lib/cloud/server";
import { MAX_PREVIEW_SOURCE_BYTES, renderAssetPreview } from "@/lib/cloud/image-preview";
import { RequestError, sameOrigin } from "@/lib/server/http";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; artifactId: string }> }) {
  try {
    if (process.env.NODE_ENV === "production") throw new RequestError("UPLOAD_UNAVAILABLE", "Artwork uploads are available in the development workspace while storage quotas are being connected.", 503);
    sameOrigin(request);
    const { workspaceId, artifactId } = await context.params;
    validId(artifactId);
    const { client } = await cloudContext(workspaceId, true);
    const { data: artifact, error } = await client.from("artifacts").select("project_id").eq("workspace_id", workspaceId).eq("id", artifactId).maybeSingle();
    databaseError(error);
    if (!artifact) throw new RequestError("NOT_FOUND", "This project is unavailable.", 404);
    if (Number(request.headers.get("content-length")) > MAX_PREVIEW_SOURCE_BYTES) throw new RequestError("TOO_LARGE", "Choose an image under 8 MB.", 413);
    const reader = request.body?.getReader();
    if (!reader) throw new RequestError("EMPTY_IMAGE", "Choose an image to upload.");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length;
        if (size > MAX_PREVIEW_SOURCE_BYTES) { await reader.cancel(); throw new RequestError("TOO_LARGE", "Choose an image under 8 MB.", 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks);
    let format: string;
    try { await renderAssetPreview(bytes); format = (await sharp(bytes).metadata()).format!; }
    catch { throw new RequestError("INVALID_IMAGE", "Choose a still PNG, JPEG, or WebP under 8 MB and 20 megapixels.", 415); }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const digest = createHash("sha256").update(`${workspaceId}:${artifact.project_id}:${sha256}`).digest("hex");
    const id = `${digest.slice(0,8)}-${digest.slice(8,12)}-5${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
    const objectPath = `${workspaceId}/${artifact.project_id}/artwork/${id}.${format}`;
    const contentType = `image/${format}`;
    const existing = await client.from("assets").select("id,sha256,project_id").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
    databaseError(existing.error);
    if (existing.data) {
      if (existing.data.sha256 !== sha256 || existing.data.project_id !== artifact.project_id) throw new RequestError("ASSET_CONFLICT", "This upload could not be safely matched.", 409);
      return cloudJson({ asset: { id }, reused: true });
    }
    const uploaded = await client.storage.from("project-assets").upload(objectPath, bytes, { contentType, upsert: false, cacheControl: "0" });
    if (uploaded.error) {
      // An interrupted first attempt may have stored the object before registration.
      const stored = await client.storage.from("project-assets").download(objectPath);
      if (!stored.data || stored.error || stored.data.size !== bytes.length || createHash("sha256").update(Buffer.from(await stored.data.arrayBuffer())).digest("hex") !== sha256) throw new RequestError("UPLOAD_UNCONFIRMED", "Upload could not be confirmed. Keep the file and retry the same image.", 503);
    }
    const inserted = await client.from("assets").insert({ id, workspace_id: workspaceId, project_id: artifact.project_id, object_path: objectPath, content_type: contentType, sha256, provenance: { kind: "user_upload", byteLength: bytes.length } });
    if (inserted.error) {
      const confirmed = await client.from("assets").select("sha256,project_id").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
      if (confirmed.error || confirmed.data?.sha256 !== sha256 || confirmed.data?.project_id !== artifact.project_id) throw new RequestError("UPLOAD_UNCONFIRMED", "The file may be stored, but registration could not be confirmed. Retry the same image.", 503);
    }
    return cloudJson({ asset: { id }, reused: false }, 201);
  } catch (error) { return cloudError(error); }
}
