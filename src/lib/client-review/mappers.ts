import { ReviewAnchorSchema, type ReviewLink, type StudioReviewComment } from "./contracts";

type Row = Record<string, unknown>;
const iso = (value: unknown) => value == null ? null : new Date(String(value)).toISOString();

export const LINK_COLUMNS = "id,artifact_id,project_id,version_number,recipient_name,message,expires_at,revoked_at,decision,decision_name,decided_at,decided_version,view_count,last_viewed_at,created_at";
export const COMMENT_COLUMNS = "id,link_id,version_number,kind,author_name,author_email,body,anchor,resolved_at,created_at";

export function mapReviewLink(row: Row): ReviewLink {
  return {
    id: String(row.id), artifactId: String(row.artifact_id), projectId: String(row.project_id),
    version: row.version_number == null ? null : Number(row.version_number),
    recipientName: String(row.recipient_name ?? ""), message: String(row.message ?? ""),
    expiresAt: iso(row.expires_at)!, revokedAt: iso(row.revoked_at),
    decision: (row.decision as ReviewLink["decision"]) ?? null, decisionName: (row.decision_name as string | null) ?? null,
    decidedAt: iso(row.decided_at), decidedVersion: row.decided_version == null ? null : Number(row.decided_version),
    viewCount: Number(row.view_count ?? 0), lastViewedAt: iso(row.last_viewed_at), createdAt: iso(row.created_at)!,
  };
}

export function mapReviewComment(row: Row): StudioReviewComment {
  const anchor = ReviewAnchorSchema.safeParse(row.anchor);
  return {
    id: String(row.id), linkId: String(row.link_id), version: Number(row.version_number),
    kind: row.kind as StudioReviewComment["kind"], authorName: String(row.author_name), authorEmail: String(row.author_email ?? ""),
    body: String(row.body ?? ""), anchor: anchor.success ? anchor.data : { kind: "general" },
    createdAt: iso(row.created_at)!, resolved: row.resolved_at != null, resolvedAt: iso(row.resolved_at),
  };
}
