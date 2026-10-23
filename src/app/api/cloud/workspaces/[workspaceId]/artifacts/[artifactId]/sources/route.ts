import { z } from "zod";
import { cloudBody, cloudContext, cloudError, cloudJson, databaseError, validId } from "@/lib/cloud/server";
import { RequestError } from "@/lib/server/http";
import { sourceIngestionEnabled } from "@/lib/ingest/builder-sources";
import { INGEST_REQUEST_LIMITS } from "@/lib/ingest/request";
import { inspectionOf } from "@/lib/ingest/record";
import { SOURCE_REFERENCE_TYPES, registerSourceUpload, resolveSourceReference, sourceAssetId, sourceObjectPath } from "@/lib/ingest/storage";
import { IngestBusyError, IngestCancelledError, extractSource } from "@/lib/ingest/worker-host";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  action: z.enum(["prepare", "register"]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().positive().max(INGEST_REQUEST_LIMITS.referenceFileBytes),
  mediaType: z.string().refine(type => type in SOURCE_REFERENCE_TYPES),
  name: z.string().min(1).max(255),
}).strict();

/** Large AI sources: "prepare" names the one storage path the editor's browser may upload this
 * exact file to (upsert:false); "register" verifies the stored bytes, records the immutable asset
 * and returns the pre-Send inspection. The request that uses it carries only the reference. */
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; artifactId: string }> }) {
  try {
    if (!sourceIngestionEnabled()) throw new RequestError("SOURCE_INGESTION_UNAVAILABLE", "Storing large source files for AI isn’t available in this environment.", 503);
    const { workspaceId, artifactId } = await context.params;
    validId(artifactId);
    const body = await cloudBody(request, Body, 4_000);
    const { client } = await cloudContext(workspaceId, true);
    const { data: artifact, error } = await client.from("artifacts").select("project_id").eq("workspace_id", workspaceId).eq("id", artifactId).maybeSingle();
    databaseError(error);
    if (!artifact) throw new RequestError("NOT_FOUND", "This project is unavailable.", 404);
    const scope = { workspaceId, projectId: artifact.project_id as string };
    const objectPath = sourceObjectPath(scope, body.sha256, body.mediaType);
    const assetId = sourceAssetId(scope, body.sha256);
    if (body.action === "prepare") {
      const existing = await client.from("assets").select("id").eq("workspace_id", workspaceId).eq("id", assetId).maybeSingle();
      databaseError(existing.error);
      return cloudJson({ objectPath, assetId, registered: Boolean(existing.data) });
    }
    const registered = await registerSourceUpload(client, scope, body, request.signal);
    const reference = { assetId: registered.id, sha256: body.sha256, bytes: body.bytes };
    const bytes = registered.bytes ?? await resolveSourceReference(client, scope, reference, body.mediaType, request.signal);
    const record = await extractSource({ bytes, name: body.name, declaredType: body.mediaType, signal: request.signal });
    return cloudJson({ reference, inspection: inspectionOf(record) }, registered.reused ? 200 : 201);
  } catch (error) {
    if (error instanceof IngestCancelledError) return cloudError(new RequestError("REQUEST_CANCELLED", "The check was cancelled.", 499));
    if (error instanceof IngestBusyError) return cloudError(new RequestError("SOURCES_BUSY", error.message, 429));
    return cloudError(error);
  }
}
