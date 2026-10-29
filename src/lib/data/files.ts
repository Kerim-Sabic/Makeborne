import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalSourceJson } from "../projects/canonical-json";
import type { DocumentSource } from "../documents/schema";

/**
 * Saved report files: the facts sheet (JSON), the PDF and, for presentations,
 * the editable PPTX, stored as immutable project assets at
 * <workspace>/<project>/reports/<sha256>.<ext> and referenced by the version's
 * asset manifest. A file belongs to a version only while that version's
 * document is byte-for-byte the one it was rendered from (documentSha): after
 * any later edit, the standard export renders the edited document instead.
 */
export const REPORT_FILE_TYPES = { pdf: "application/pdf", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", facts: "application/json" } as const;
export type ReportFormat = keyof typeof REPORT_FILE_TYPES;
export const REPORT_EXTENSIONS: Record<ReportFormat, string> = { pdf: "pdf", pptx: "pptx", facts: "json" };
type Scope = { workspaceId: string; projectId: string };

/** Deterministic id per workspace, project and exact bytes, in its own namespace. */
export function reportAssetId(scope: Scope, sha256: string) {
  const digest = createHash("sha256").update(`report:${scope.workspaceId}:${scope.projectId}:${sha256}`).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
export const reportObjectPath = (scope: Scope, sha256: string, format: ReportFormat) => `${scope.workspaceId}/${scope.projectId}/reports/${sha256}.${REPORT_EXTENSIONS[format]}`;
export const documentSha = (doc: DocumentSource) => createHash("sha256").update(canonicalSourceJson(JSON.parse(JSON.stringify(doc)))).digest("hex");

/** The saved report file of one format for a version whose document is unchanged since generation, through the caller's RLS-bound client. */
export async function storedReportFile(client: SupabaseClient, scope: Scope, manifest: readonly string[], doc: DocumentSource, format: ReportFormat) {
  if (!manifest.length) return null;
  const { data, error } = await client.from("assets").select("id,object_path,content_type,sha256,provenance").eq("workspace_id", scope.workspaceId).eq("project_id", scope.projectId).in("id", [...manifest]);
  if (error) throw new Error("Asset registry unavailable.");
  const sha = documentSha(doc);
  const rows = (data ?? []).filter(row => {
    const provenance = row.provenance as Record<string, unknown> | null;
    const kind = format === "facts" ? "data_report_facts" : "data_report_file";
    return provenance?.kind === kind && (format === "facts" || provenance.format === format) && provenance.documentSha === sha && row.content_type === REPORT_FILE_TYPES[format]
      && row.object_path === reportObjectPath(scope, String(row.sha256), format);
  });
  return rows[0] as { id: string; object_path: string; content_type: string; sha256: string } | undefined ?? null;
}
