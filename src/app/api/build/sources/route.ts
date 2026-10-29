import { cloudContext } from "@/lib/cloud/server";
import { apiError, boundedBytes, RequestError, sameOrigin } from "@/lib/server/http";
import { BUILDER_ATTACHMENT_LIMITS } from "@/lib/builder/attachments";
import { sourceIngestionEnabled } from "@/lib/ingest/builder-sources";
import { INGEST_REQUEST_LIMITS } from "@/lib/ingest/request";
import { inspectionOf } from "@/lib/ingest/record";
import { IngestBusyError, IngestCancelledError, extractSource } from "@/lib/ingest/worker-host";

export const runtime = "nodejs";
export const maxDuration = 60;
const noStore = { "Cache-Control": "private, no-store" };

/** What the pre-Send check may offer. No account data; the switch is server-side. */
export async function GET() {
  const enabled = sourceIngestionEnabled();
  return Response.json({ enabled, formats: enabled ? ["docx", "pptx", "xlsx", "csv", "pdf"] : [], inlineBytes: BUILDER_ATTACHMENT_LIMITS.fileBytes,
    referenceBytes: enabled ? INGEST_REQUEST_LIMITS.referenceFileBytes : 0 }, { headers: noStore });
}

/** Pre-Send check of one small file (raw bytes, at most the inline limit): coverage, warnings and
 * unsupported content only. Nothing is stored, no AI is called and no extracted text is returned. */
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (!sourceIngestionEnabled()) throw new RequestError("SOURCE_INGESTION_UNAVAILABLE", "Checking Office and CSV files isn’t available in this environment.", 503);
    await cloudContext();
    let name = "";
    try { name = decodeURIComponent(request.headers.get("x-source-name") ?? "").slice(0, 255); } catch { name = ""; }
    if (!name) throw new RequestError("SOURCE_NAME_REQUIRED", "The file name is missing.");
    const declaredType = (request.headers.get("content-type") ?? "").split(";")[0].trim().slice(0, 200);
    const bytes = await boundedBytes(request, BUILDER_ATTACHMENT_LIMITS.fileBytes, request.signal);
    const record = await extractSource({ bytes, name, declaredType: declaredType === "application/octet-stream" ? "" : declaredType, signal: request.signal });
    return Response.json({ inspection: inspectionOf(record) }, { headers: noStore });
  } catch (error) {
    if (error instanceof IngestCancelledError) return apiError(new RequestError("REQUEST_CANCELLED", "The check was cancelled.", 499));
    if (error instanceof IngestBusyError) return apiError(new RequestError("SOURCES_BUSY", error.message, 429));
    return apiError(error);
  }
}
