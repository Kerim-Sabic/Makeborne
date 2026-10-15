import { z } from "zod";
import { MAX_PREVIEW_SOURCE_BYTES, renderAssetPreview } from "@/lib/cloud/image-preview";
import { portalContext, portalDatabaseError, portalFail, validUuid } from "@/lib/portal/server";
import { RequestError } from "@/lib/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ artifactId: string; assetId: string }> };

/** Thumbnail of one image in the site's current version (the grant RPC refuses any other asset). */
export async function GET(request: Request, context: Context) {
  try {
    const params = await context.params;
    const artifactId = validUuid(params.artifactId, "site"), assetId = validUuid(params.assetId, "image");
    const { trusted, db } = await portalContext(request);
    const { data, error } = await db.rpc("makeborne_portal_image", { ...trusted, p_artifact: artifactId, p_asset: assetId });
    portalDatabaseError(error);
    const image = z.object({ objectPath: z.string().min(1).max(1024), contentType: z.enum(["image/png", "image/jpeg", "image/webp"]) }).parse(data);
    const { data: file, error: downloadError } = await db.storage.from("project-assets").download(image.objectPath);
    if (downloadError || !file) throw new RequestError("IMAGE_UNAVAILABLE", "This image could not be loaded.", 404);
    if (file.size > MAX_PREVIEW_SOURCE_BYTES) throw new RequestError("IMAGE_TOO_LARGE", "This image is too large to preview.", 413);
    let bytes: Uint8Array<ArrayBuffer>;
    try { bytes = new Uint8Array(await renderAssetPreview(new Uint8Array(await file.arrayBuffer()))); }
    catch { throw new RequestError("INVALID_IMAGE", "This image cannot be previewed.", 415); }
    return new Response(bytes, { headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store", Vary: "Cookie, X-Makeborne-Account",
      "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" } });
  } catch (error) { return portalFail(error); }
}
