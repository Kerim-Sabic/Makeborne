import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RequestError } from "../server/http";
import { INGESTED_MEDIA_TYPES } from "../ingest/request";
import { resolveSourceReference } from "../ingest/storage";
import { IngestBusyError, IngestCancelledError, extractSource, type ExtractInput } from "../ingest/worker-host";
import type { ExtractionRecord } from "../ingest/record";
import { DataError } from "./dataset";

/**
 * Sources for data reports are the project's stored spreadsheets (registered by
 * the stage 2 upload path: immutable, hash-verified assets). They are re-read
 * through the caller's RLS-bound client, re-hashed, and parsed in the existing
 * isolated ingestion worker (no environment, bounded heap/stack, wall-clock
 * timeout, network disabled), so a heavy or hostile file ends as a specific
 * failure, never as a stuck request.
 */
export const SPREADSHEET_TYPES = [INGESTED_MEDIA_TYPES.xlsx, INGESTED_MEDIA_TYPES.csv] as const;
type Scope = { workspaceId: string; projectId: string };
export type SpreadsheetSource = { assetId: string; sha256: string; name: string; bytes: number; format: "xlsx" | "csv" };

export async function listSpreadsheetSources(client: SupabaseClient, scope: Scope): Promise<SpreadsheetSource[]> {
  const { data, error } = await client.from("assets").select("id,sha256,content_type,provenance,created_at").eq("workspace_id", scope.workspaceId).eq("project_id", scope.projectId)
    .in("content_type", [...SPREADSHEET_TYPES]).order("created_at", { ascending: false }).limit(50);
  if (error) throw new RequestError("CLOUD_UNAVAILABLE", "The project’s files could not be read. Try again.", 503);
  return (data ?? []).filter(row => (row.provenance as Record<string, unknown> | null)?.kind === "source_upload").map(row => {
    const provenance = row.provenance as Record<string, unknown>;
    return { assetId: row.id as string, sha256: row.sha256 as string, name: String(provenance.name ?? "Spreadsheet").slice(0, 255), bytes: Number(provenance.byteLength) || 0,
      format: row.content_type === INGESTED_MEDIA_TYPES.csv ? "csv" as const : "xlsx" as const };
  });
}

export type LoadDeps = { extract?: (input: ExtractInput) => Promise<ExtractionRecord>; resolve?: typeof resolveSourceReference; timeoutMs?: number };
/** Verified bytes → extraction record in the isolated worker. Timeouts and memory exhaustion are explicit refusals. */
export async function loadSpreadsheet(client: SupabaseClient, scope: Scope, source: { assetId: string; sha256: string }, signal: AbortSignal | undefined, deps: LoadDeps = {}) {
  const row = await client.from("assets").select("id,sha256,content_type,provenance").eq("workspace_id", scope.workspaceId).eq("project_id", scope.projectId).eq("id", source.assetId).maybeSingle();
  if (row.error) throw new RequestError("CLOUD_UNAVAILABLE", "The file could not be read. Try again.", 503);
  const provenance = row.data?.provenance as Record<string, unknown> | undefined;
  if (!row.data || row.data.sha256 !== source.sha256 || provenance?.kind !== "source_upload" || !(SPREADSHEET_TYPES as readonly string[]).includes(row.data.content_type))
    throw new RequestError("SOURCE_UNAVAILABLE", "This spreadsheet isn’t available in this project. Choose it again.", 404);
  const name = String(provenance.name ?? "spreadsheet").slice(0, 255);
  const bytes = await (deps.resolve ?? resolveSourceReference)(client, scope, { assetId: source.assetId, sha256: source.sha256, bytes: Number(provenance.byteLength) || 0 }, row.data.content_type, signal);
  let record: ExtractionRecord;
  try { record = await (deps.extract ?? extractSource)({ bytes, name, declaredType: row.data.content_type, signal, ...(deps.timeoutMs ? { timeoutMs: deps.timeoutMs } : {}) }); }
  catch (error) {
    if (error instanceof IngestCancelledError) throw new RequestError("REQUEST_CANCELLED", "The request was cancelled.", 499);
    if (error instanceof IngestBusyError) throw new RequestError("DATA_BUSY", error.message, 429);
    throw error;
  }
  if (record.status === "failed" && record.problem === "timeout") throw new DataError("SOURCE_TIMEOUT", record.message);
  if (record.status === "failed" && record.problem === "memory") throw new DataError("SOURCE_TOO_HEAVY", record.message);
  return { record, name };
}
