import "server-only";
import { ArtifactSchema, ArtifactVersionSchema, ClientSchema, ProjectSchema } from "@/lib/domain";
import type { CloudClient, CloudProject } from "./contracts";
import { OutreachSummarySchema } from "./contracts";

type Row = Record<string, unknown>;
const iso = (value: unknown) => new Date(String(value)).toISOString();
export function mapClient(row: Row): CloudClient {
  return { ...ClientSchema.parse({ id: row.id, name: row.name, company: row.company, email: row.email, website: row.website, notes: row.notes, outreach: row.outreach ?? undefined, createdAt: iso(row.created_at) }), updatedAt: iso(row.updated_at) };
}
export function mapClientSummary(row: Row): CloudClient {
  return { ...mapClient(row), outreachSummary: row.outreach_stage == null ? undefined : OutreachSummarySchema.parse({ stage: row.outreach_stage, nextFollowUp: row.outreach_follow_up }) };
}
export function mapProject(row: Row): CloudProject {
  return { ...ProjectSchema.parse({ id: row.id, clientId: row.client_id, title: row.title, kind: row.kind, status: row.status, styleId: row.style_id, brief: row.brief, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }), audience: String(row.audience ?? ""), purpose: String(row.purpose ?? ""), wording: String(row.wording ?? "preserve") };
}
export function mapArtifact(row: Row) {
  return ArtifactSchema.parse({ id: row.id, projectId: row.project_id, kind: row.kind, title: row.title, currentVersion: row.current_version, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) });
}
export function mapVersion(row: Row) {
  return ArtifactVersionSchema.parse({ id: row.id, artifactId: row.artifact_id, number: row.version_number, parentVersionId: row.parent_version_id, content: row.content, style: row.style_snapshot, assetIds: row.asset_manifest, createdAt: iso(row.created_at), createdBy: row.created_by, changeSummary: row.change_summary });
}
