import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { downloadProjectAsset, readPendingSourceUpload } from "../cloud/asset-storage";
import { RequestError } from "../server/http";
import { INGESTED_MEDIA_TYPES, INGEST_REQUEST_LIMITS, type SourceReference } from "./request";

/** Large AI sources travel as references to an immutable original in the project's private
 * storage, never as base64 in the request. The browser uploads to the exact path the server
 * names (INSERT policy: editors, own workspace prefix, upsert:false); the server then re-reads
 * the object with its own key, verifies size and SHA-256, and registers an immutable asset row
 * through the caller's RLS-bound client. Reads always go through the caller's RLS check first. */

export const SOURCE_REFERENCE_TYPES: Record<string, "docx" | "pptx" | "xlsx" | "csv" | "pdf"> = {
  [INGESTED_MEDIA_TYPES.docx]: "docx", [INGESTED_MEDIA_TYPES.pptx]: "pptx", [INGESTED_MEDIA_TYPES.xlsx]: "xlsx", [INGESTED_MEDIA_TYPES.csv]: "csv", "application/pdf": "pdf",
};
type Scope = { workspaceId: string; projectId: string };

/** Deterministic id per workspace, project and exact bytes, in a namespace separate from artwork uploads. */
export function sourceAssetId(scope: Scope, sha256: string) {
  const digest = createHash("sha256").update(`source:${scope.workspaceId}:${scope.projectId}:${sha256}`).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
export function sourceObjectPath(scope: Scope, sha256: string, mediaType: string) {
  const extension = SOURCE_REFERENCE_TYPES[mediaType];
  if (!extension || !/^[a-f0-9]{64}$/.test(sha256)) throw new RequestError("SOURCE_TYPE", "This file type can’t be stored as an AI source.", 415);
  return `${scope.workspaceId}/${scope.projectId}/sources/${sha256}.${extension}`;
}

const unavailable = () => new RequestError("SOURCE_UNAVAILABLE", "A stored source file is missing, changed or unavailable. Attach it again.", 409);
const unconfirmed = () => new RequestError("SOURCE_UNCONFIRMED", "The stored source file couldn’t be verified. Keep the file and retry.", 503);

/** After the browser upload: verify the stored bytes and register the immutable asset (idempotent). */
export async function registerSourceUpload(client: SupabaseClient, scope: Scope, input: { sha256: string; bytes: number; mediaType: string; name: string }, signal?: AbortSignal) {
  if (input.bytes < 1 || input.bytes > INGEST_REQUEST_LIMITS.referenceFileBytes) throw new RequestError("SOURCE_TOO_LARGE", "Each stored AI source file can be up to 25 MB.", 413);
  const objectPath = sourceObjectPath(scope, input.sha256, input.mediaType);
  const id = sourceAssetId(scope, input.sha256);
  const existing = await client.from("assets").select("id,sha256,project_id,object_path").eq("workspace_id", scope.workspaceId).eq("id", id).maybeSingle();
  if (existing.error) throw unconfirmed();
  if (existing.data) {
    if (existing.data.sha256 !== input.sha256 || existing.data.project_id !== scope.projectId || existing.data.object_path !== objectPath) throw new RequestError("SOURCE_CONFLICT", "This upload could not be safely matched.", 409);
    return { id, objectPath, reused: true, bytes: null };
  }
  const stored = await readPendingSourceUpload(scope, objectPath, undefined, { signal });
  if (!stored.data || stored.error) throw new RequestError("SOURCE_NOT_UPLOADED", "The file wasn’t found in project storage. Upload it again.", 409);
  const bytes = Buffer.from(await stored.data.arrayBuffer());
  if (bytes.byteLength !== input.bytes || createHash("sha256").update(bytes).digest("hex") !== input.sha256) throw new RequestError("SOURCE_MISMATCH", "The stored file doesn’t match the file you attached. Attach it again.", 409);
  const inserted = await client.from("assets").insert({ id, workspace_id: scope.workspaceId, project_id: scope.projectId, object_path: objectPath, content_type: input.mediaType, sha256: input.sha256,
    provenance: { kind: "source_upload", byteLength: bytes.byteLength, name: input.name.slice(0, 255) } });
  if (inserted.error) {
    const confirmed = await client.from("assets").select("sha256,project_id").eq("workspace_id", scope.workspaceId).eq("id", id).maybeSingle();
    if (confirmed.error || confirmed.data?.sha256 !== input.sha256 || confirmed.data?.project_id !== scope.projectId) throw unconfirmed();
  }
  return { id, objectPath, reused: false, bytes: new Uint8Array(bytes) };
}

/** Resolve a reference to verified original bytes for this caller and project. */
export async function resolveSourceReference(client: SupabaseClient, scope: Scope, reference: SourceReference, mediaType: string, signal?: AbortSignal): Promise<Uint8Array> {
  const row = await client.from("assets").select("id,workspace_id,project_id,object_path,content_type,sha256")
    .eq("workspace_id", scope.workspaceId).eq("project_id", scope.projectId).eq("id", reference.assetId).maybeSingle();
  if (row.error) throw unconfirmed();
  const data = row.data;
  if (!data || data.sha256 !== reference.sha256 || data.content_type !== mediaType || data.object_path !== sourceObjectPath(scope, reference.sha256, mediaType)) throw unavailable();
  const download = await downloadProjectAsset(client, scope, data.object_path, { signal: signal ?? AbortSignal.timeout(20_000), cache: "no-store" });
  if (download.error || !download.data) throw unconfirmed();
  if (download.data.size !== reference.bytes) throw unavailable();
  const bytes = new Uint8Array(await download.data.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== reference.sha256) throw unavailable();
  return bytes;
}
