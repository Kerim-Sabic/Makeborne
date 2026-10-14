import { createHash } from "node:crypto";
import { z } from "zod";
import { billingDatabase } from "@/lib/billing/database";
import { requireReviewToken, reviewDatabaseError } from "@/lib/client-review/server";
import { MAX_PREVIEW_SOURCE_BYTES, renderAssetPreview } from "@/lib/cloud/image-preview";
import { apiError, RequestError } from "@/lib/server/http";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" };
const Locator = z.object({
  assetId: z.string().uuid(), version: z.number().int().positive(), workspaceId: z.string().uuid(), projectId: z.string().uuid(),
  objectPath: z.string().min(1).max(1024), contentType: z.enum(["image/png", "image/jpeg", "image/webp"]), sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

/** Public raster read; its only authority is a live review token and viewed version. */
export async function GET(request: Request, context: { params: Promise<{ token: string; assetId: string }> }) {
  try {
    const params = await context.params;
    const token = requireReviewToken(params.token);
    const asset = z.string().uuid().safeParse(params.assetId);
    const rawVersion = new URL(request.url).searchParams.get("version");
    if (!asset.success || !rawVersion || !/^[1-9]\d{0,8}$/.test(rawVersion)) throw new RequestError("INVALID_REVIEW_IMAGE", "Choose artwork from the displayed review version.");
    const version = Number(rawVersion), client = billingDatabase();
    const authorize = async () => {
      const { data, error } = await client.rpc("makeborne_client_review_asset", { p_token: token, p_version: version, p_asset: asset.data });
      reviewDatabaseError(error);
      const parsed = Locator.safeParse(data);
      if (!parsed.success) throw new RequestError("REVIEW_IMAGE_UNAVAILABLE", "This artwork is unavailable.", 404);
      const locator = parsed.data;
      if (locator.assetId !== asset.data || locator.version !== version || !locator.objectPath.startsWith(`${locator.workspaceId}/${locator.projectId}/`)
        || /[\\%?#]/.test(locator.objectPath) || locator.objectPath.split("/").some(part => !part || part === "." || part === "..")) {
        throw new RequestError("REVIEW_IMAGE_UNAVAILABLE", "This artwork is unavailable.", 404);
      }
      return locator;
    };
    const locator = await authorize();
    const { data: file, error } = await client.storage.from("project-assets").download(locator.objectPath);
    if (error || !file) throw new RequestError("REVIEW_IMAGE_UNAVAILABLE", "This artwork could not be loaded.", 404);
    if (file.size > MAX_PREVIEW_SOURCE_BYTES) throw new RequestError("REVIEW_IMAGE_TOO_LARGE", "This artwork exceeds the review image limit.", 413);
    const original = new Uint8Array(await file.arrayBuffer());
    if (createHash("sha256").update(original).digest("hex") !== locator.sha256) throw new RequestError("REVIEW_IMAGE_CHANGED", "This artwork no longer matches the saved version.", 409);
    let bytes: Uint8Array<ArrayBuffer>;
    try { bytes = new Uint8Array(await renderAssetPreview(original)); }
    catch { throw new RequestError("REVIEW_IMAGE_INVALID", "This artwork could not be displayed.", 415); }
    // A revocation, expiry or version advance during storage/decoding must not
    // release bytes after the authorization changes.
    const current = await authorize();
    if (current.objectPath !== locator.objectPath || current.sha256 !== locator.sha256) throw new RequestError("REVIEW_IMAGE_CHANGED", "This artwork changed. Refresh the review.", 409);
    return new Response(bytes, { headers: { ...headers, "Content-Type": "image/webp" } });
  } catch (error) {
    const response = apiError(error);
    Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
    return response;
  }
}
