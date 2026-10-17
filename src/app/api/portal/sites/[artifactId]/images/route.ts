import { createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { assetId } from "@/lib/builder/images";
import { portalContext, portalDatabaseError, portalFail, portalJson, validUuid } from "@/lib/portal/server";
import { purgePortalUploads } from "@/lib/portal/upload-cleanup";
import { RequestError, boundedBytes, sameOrigin } from "@/lib/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ artifactId: string }> };
const UPLOAD_LIMIT = 8_000_000, EDGE = 2400, STORED_LIMIT = 4_000_000;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif"]);

/**
 * A client uploads a photo for their site. It is re-encoded on the server
 * (orientation applied, metadata such as GPS stripped, at most 2400 px, WebP),
 * stored under the site's project and registered for this site's image picker.
 * It joins the website only when the agency approves a change that uses it.
 */
export async function POST(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const artifactId = validUuid((await context.params).artifactId, "site");
    const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!TYPES.has(type)) throw new RequestError("UNSUPPORTED_IMAGE", "Upload a JPG, PNG, WebP or iPhone (HEIC) photo.", 415);
    const { trusted, db } = await portalContext(request);
    const scopeResult = await db.rpc("makeborne_portal_upload_scope", { ...trusted, p_artifact: artifactId });
    portalDatabaseError(scopeResult.error);
    const scope = z.object({ workspaceId: z.string().uuid(), projectId: z.string().uuid() }).parse(scopeResult.data);
    const input = await boundedBytes(request, UPLOAD_LIMIT, request.signal);
    let bytes: Buffer, width: number, height: number;
    try {
      // sharp drops EXIF/XMP/ICC-extras by default; rotate() bakes in the orientation first.
      const encoded = await sharp(input, { limitInputPixels: 80_000_000, animated: false }).rotate()
        .resize({ width: EDGE, height: EDGE, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
      bytes = encoded.data; width = encoded.info.width; height = encoded.info.height;
    } catch { throw new RequestError("INVALID_IMAGE", "That file isn't a photo we can read. Try a JPG or PNG.", 415); }
    if (width < 200 || height < 200) throw new RequestError("IMAGE_TOO_SMALL", "This photo is too small. Use one at least 200 pixels wide.", 400);
    if (bytes.length > STORED_LIMIT) throw new RequestError("IMAGE_TOO_LARGE", "This photo is too detailed to store. Try a smaller one.", 413);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const id = assetId(scope.workspaceId, scope.projectId, sha256);
    const objectPath = `${scope.workspaceId}/${scope.projectId}/portal/${id}.webp`;
    const stored = await db.storage.from("project-assets").upload(objectPath, bytes, { contentType: "image/webp", upsert: false, cacheControl: "0" });
    if (stored.error && !/exists|duplicate/i.test(stored.error.message)) throw new RequestError("UPLOAD_FAILED", "The photo couldn't be saved. Try again.", 503);
    const registered = await db.rpc("makeborne_portal_register_upload", { ...trusted, p_artifact: artifactId, p_asset: id, p_sha256: sha256, p_bytes: bytes.length, p_width: width, p_height: height });
    // An object this request created but could not register would never be cleaned up: remove it now.
    if (registered.error && !stored.error) await db.storage.from("project-assets").remove([objectPath]).catch(() => undefined);
    portalDatabaseError(registered.error);
    // Opportunistic cleanup of this site's long-unused photos and queued objects (no scheduler needed).
    await purgePortalUploads(db, artifactId, 10).catch(() => undefined);
    const image = z.object({ assetId: z.string().uuid(), path: z.string().regex(/^\/images\/client-[0-9a-f]{12}\.webp$/) }).parse(registered.data);
    return portalJson({ image: { path: image.path, previewUrl: `/api/portal/sites/${artifactId}/images/${image.assetId}`, removable: true } }, 201);
  } catch (error) { return portalFail(error); }
}
