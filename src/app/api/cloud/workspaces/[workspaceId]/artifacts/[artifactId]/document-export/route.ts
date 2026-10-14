import { cloudContext, cloudError, databaseError, validId } from "@/lib/cloud/server";
import { mapVersion } from "@/lib/cloud/mappers";
import { RequestError } from "@/lib/server/http";
import { documentPdf, documentPptx, loadDocumentImages } from "@/lib/documents/export-server";

export const runtime = "nodejs";
export const maxDuration = 120;
let active = 0;

/** PDF (books and presentations) and editable PPTX (presentations) for a saved
 * live-built document version. Renders server-side from the stored source. */
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string; artifactId: string }> }) {
  let reserved = false;
  try {
    const url = new URL(request.url);
    const format = url.searchParams.get("format");
    if (format !== "pdf" && format !== "pptx") throw new RequestError("INVALID_FORMAT", "Choose PDF or PPTX.");
    const { workspaceId, artifactId } = await context.params;
    validId(artifactId);
    const versionParam = url.searchParams.get("version");
    const versionNumber = versionParam === null ? null : Number(versionParam);
    if (versionNumber !== null && (!Number.isInteger(versionNumber) || versionNumber < 1)) throw new RequestError("INVALID_VERSION", "Choose a saved version.");
    const { client } = await cloudContext(workspaceId);
    const artifactResult = await client.from("artifacts").select("id,project_id,kind,current_version").eq("workspace_id", workspaceId).eq("id", artifactId).maybeSingle();
    databaseError(artifactResult.error);
    const artifact = artifactResult.data;
    if (!artifact || (artifact.kind !== "book" && artifact.kind !== "presentation")) throw new RequestError("NOT_FOUND", "This document is unavailable.", 404);
    if (format === "pptx" && artifact.kind !== "presentation") throw new RequestError("INVALID_FORMAT", "PPTX is available for presentations.");
    const versionResult = await client.from("artifact_versions").select("*").eq("workspace_id", workspaceId).eq("artifact_id", artifactId).eq("version_number", versionNumber ?? artifact.current_version).maybeSingle();
    databaseError(versionResult.error);
    if (!versionResult.data) throw new RequestError("NOT_FOUND", "This version is unavailable.", 404);
    const doc = mapVersion(versionResult.data).content.document;
    if (!doc) throw new RequestError("NO_DOCUMENT", "This version was not made with the live builder. Use the standard export.", 409);
    if (active >= 2) throw new RequestError("EXPORT_BUSY", "Two exports are already running. Please try again shortly.", 429);
    active++; reserved = true;
    const buffers = await loadDocumentImages(client, workspaceId, artifact.project_id, doc);
    let bytes: Buffer;
    try { bytes = format === "pdf" ? await documentPdf(doc, buffers) : await documentPptx(doc, buffers); }
    catch (error) {
      console.error("document export failed", error instanceof Error ? error.message : error);
      throw new RequestError("EXPORT_FAILED", "The export could not finish. Your document is unchanged; please try again.", 500);
    }
    const filename = doc.title.replace(/[^a-zA-Z0-9 _-]/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "makeborne";
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${filename}.${format}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    return cloudError(error);
  } finally {
    if (reserved) active--;
  }
}
