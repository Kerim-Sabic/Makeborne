import { valueIdentity, windowsOverlap, type FactKind, type FactStatus } from "./types";

/** What the "Client knowledge" panel shows. No provider, model or internal actor names. */
export type EvidenceView = Readonly<{
  id: string; kind: string; title: string; locator: Record<string, unknown>; quote: string | null; url: string | null; fetchedAt: string | null;
  version: string | null; extractionVersion: string | null; state: "live" | "stale" | "revoked"; revokedReason: string | null; supports: boolean; createdAt: string;
}>;
export type FactView = Readonly<{
  id: string; kind: FactKind; key: string; label: string; valueText: string; currency: string | null; unit: string | null;
  validFrom: string | null; validTo: string | null; observedAt: string | null; status: FactStatus; revision: number;
  supersedesId: string | null; supersededBy: string | null; uncertainty: string | null; evidenceState: "live" | "stale" | "revoked";
  suggestedBy: "person" | "task"; approvedAt: string | null; rejectedAt: string | null; reviewNote: string | null; redacted: boolean;
  createdAt: string; updatedAt: string;
  /** Other current facts with the same key, overlapping dates and a different value. */
  conflictsWith: readonly string[];
  evidence: readonly EvidenceView[];
}>;
export type RevisionView = Readonly<{ revision: number; action: string; status: string; valueText: string; removed: boolean; note: string | null; createdAt: string; byYou: boolean }>;
export type KnowledgeList = Readonly<{ enabled: true; canEdit: boolean; facts: readonly FactView[]; truncated: boolean }>;
export type KnowledgeProvenance = Readonly<{ fact: FactView; revisions: readonly RevisionView[] }>;

export type FactRow = {
  id: string; kind: FactKind; key: string; label: string; value: unknown; value_text: string; currency: string | null; unit: string | null;
  valid_from: string | null; valid_to: string | null; observed_at: string | null; status: FactStatus; revision: number;
  supersedes_id: string | null; superseded_by: string | null; uncertainty: string | null; evidence_state: "live" | "stale" | "revoked";
  created_via: "user" | "system"; approved_at: string | null; rejected_at: string | null; review_note: string | null; redacted_at: string | null;
  created_at: string; updated_at: string;
};
export type EvidenceRow = {
  id: string; fact_id: string; kind: string; ref_id: string | null; locator: Record<string, unknown> | null; quote: string | null; url: string | null; fetched_at: string | null;
  sha256: string | null; extraction_version: string | null; state: "live" | "stale" | "revoked"; revoked_reason: string | null; supports: boolean; created_at: string;
};
export const FACT_COLUMNS = "id,kind,key,label,value,value_text,currency,unit,valid_from,valid_to,observed_at,status,revision,supersedes_id,superseded_by,uncertainty,evidence_state,created_via,approved_at,rejected_at,review_note,redacted_at,created_at,updated_at";
export const EVIDENCE_COLUMNS = "id,fact_id,kind,ref_id,locator,quote,url,fetched_at,sha256,extraction_version,state,revoked_reason,supports,created_at";

const hostOf = (url: string) => { try { return new URL(url).hostname; } catch { return "Web page"; } };
const EVIDENCE_TITLE: Record<string, string> = { source: "Project source", asset: "Uploaded file", url: "Web page", brief: "Project brief", user: "Statement", artifact_version: "Generated draft" };

/** Conflicts among current facts: same key, overlapping validity, different value. Mirrors the database rule. */
export function conflictMap(rows: readonly FactRow[]): Map<string, string[]> {
  const current = rows.filter(row => (row.status === "proposed" || row.status === "approved") && !row.redacted_at);
  const map = new Map<string, string[]>();
  for (const a of current) for (const b of current) {
    if (a.id === b.id || a.key !== b.key) continue;
    if (!windowsOverlap({ validFrom: a.valid_from, validTo: a.valid_to }, { validFrom: b.valid_from, validTo: b.valid_to })) continue;
    if (valueIdentity({ value: a.value, valueText: a.value_text, currency: a.currency, unit: a.unit }) === valueIdentity({ value: b.value, valueText: b.value_text, currency: b.currency, unit: b.unit })) continue;
    map.set(a.id, [...(map.get(a.id) ?? []), b.id]);
  }
  return map;
}

export function factView(row: FactRow, evidence: readonly EvidenceRow[], titles: ReadonlyMap<string, string>, conflicts: ReadonlyMap<string, string[]>): FactView {
  return Object.freeze({
    id: row.id, kind: row.kind, key: row.key, label: row.label, valueText: row.value_text, currency: row.currency, unit: row.unit,
    validFrom: row.valid_from, validTo: row.valid_to, observedAt: row.observed_at, status: row.status, revision: row.revision,
    supersedesId: row.supersedes_id, supersededBy: row.superseded_by, uncertainty: row.uncertainty, evidenceState: row.evidence_state,
    suggestedBy: row.created_via === "system" ? "task" : "person", approvedAt: row.approved_at, rejectedAt: row.rejected_at, reviewNote: row.review_note,
    redacted: !!row.redacted_at, createdAt: row.created_at, updatedAt: row.updated_at, conflictsWith: Object.freeze(conflicts.get(row.id) ?? []),
    evidence: Object.freeze(evidence.filter(item => item.fact_id === row.id).map(item => Object.freeze({
      id: item.id, kind: item.kind, title: (item.ref_id && titles.get(item.ref_id)) || (item.url ? hostOf(item.url) : EVIDENCE_TITLE[item.kind] ?? "Source"),
      locator: item.locator ?? {}, quote: item.quote, url: item.url, fetchedAt: item.fetched_at, version: item.sha256 ? item.sha256.slice(0, 12) : null,
      extractionVersion: item.extraction_version, state: item.state, revokedReason: item.revoked_reason, supports: item.supports, createdAt: item.created_at,
    }))),
  });
}
