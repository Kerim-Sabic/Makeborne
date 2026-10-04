import { cloudContext, cloudError, databaseError, validId } from "@/lib/cloud/server";
import { MAX_PREVIEW_SOURCE_BYTES, renderAssetPreview, renderAssetExport } from "@/lib/cloud/image-preview";
import { RequestError } from "@/lib/server/http";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string; artifactId: string; assetId: string }> }) {
  try {
    const variant = new URL(request.url).searchParams.get("variant") ?? "preview";
    if (!["preview", "export"].includes(variant)) throw new RequestError("INVALID_VARIANT", "Choose a supported artwork format.");
    if (variant === "export" && process.env.NODE_ENV === "production") throw new RequestError("EXPORT_UNAVAILABLE", "Artwork exports are not configured in this environment.", 503);
    const { workspaceId, artifactId, assetId } = await context.params;
    validId(artifactId); validId(assetId);
    const { client } = await cloudContext(workspaceId);
    const { data: artifact, error: artifactError } = await client.from("artifacts").select("project_id").eq("workspace_id", workspaceId).eq("id", artifactId).maybeSingle();
    databaseError(artifactError);
    if (!artifact) throw new RequestError("NOT_FOUND", "This project is unavailable.", 404);
    const { data: asset, error: assetError } = await client.from("assets").select("object_path,content_type").eq("workspace_id", workspaceId).eq("project_id", artifact.project_id).eq("id", assetId).maybeSingle();
    databaseError(assetError);
    if (!asset) throw new RequestError("NOT_FOUND", "This artwork is unavailable in this project.", 404);
    if (!["image/png", "image/jpeg", "image/webp"].includes(asset.content_type) || !asset.object_path.startsWith(`${workspaceId}/`)) throw new RequestError("INVALID_IMAGE", "This asset cannot be previewed.", 415);
    const { data: file, error } = await client.storage.from("project-assets").download(asset.object_path);
    if (error || !file) throw new RequestError("IMAGE_UNAVAILABLE", "The artwork could not be loaded.", 404);
    if (file.size > MAX_PREVIEW_SOURCE_BYTES) throw new RequestError("IMAGE_TOO_LARGE", "Artwork preview supports images under 8 MB.", 413);
    let bytes: Uint8Array<ArrayBuffer>;
    try { bytes = new Uint8Array(await (variant === "export" ? renderAssetExport : renderAssetPreview)(new Uint8Array(await file.arrayBuffer()))); }
    catch (error) { throw new RequestError("INVALID_IMAGE", variant === "export" && error instanceof Error ? error.message : "This image format or size cannot be previewed.", 415); }
    return new Response(bytes, { headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store", Vary: "Cookie, X-Makeborne-Account", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" } });
  } catch (error) { return cloudError(error); }
}
