/**
 * What a data export contains: each source is one branch of the database function
 * makeborne_account_export_rows (migration 20261026100000), written to one JSON file and,
 * for tabular data people open in a spreadsheet, a CSV. check-account-rights.cjs keeps
 * this list and the SQL branches identical.
 */
export type ExportSource = {
  source: string;
  group: "account" | "workspaces" | "clients" | "projects" | "reviews" | "websites" | "email" | "chat" | "connections" | "billing" | "usage" | "requests";
  /** Rows per database call; small for sources that carry whole saved versions. */
  page: number;
  csv?: readonly string[];
  /** Present only when a feature branch created the table. */
  optional?: true;
};

export const EXPORT_SOURCES: readonly ExportSource[] = Object.freeze([
  { source: "account", group: "account", page: 1 },
  { source: "account_privileges", group: "account", page: 1 },
  { source: "workspaces", group: "workspaces", page: 1000 },
  { source: "workspace_members", group: "workspaces", page: 1000 },
  { source: "clients", group: "clients", page: 500, csv: ["id", "workspace_id", "name", "company", "email", "website", "notes", "tags", "deal_value", "deal_currency", "lead_source", "created_at", "updated_at"] },
  { source: "contacts", group: "clients", page: 500, csv: ["id", "client_id", "name", "email", "phone", "created_at"] },
  { source: "crm_next_steps", group: "clients", page: 500, optional: true },
  { source: "crm_suppressions", group: "clients", page: 500, optional: true },
  { source: "crm_site_checks", group: "clients", page: 200, optional: true },
  { source: "crm_duplicate_dismissals", group: "clients", page: 500, optional: true },
  { source: "client_facts", group: "clients", page: 500, optional: true },
  { source: "client_fact_revisions", group: "clients", page: 500, optional: true },
  { source: "client_fact_evidence", group: "clients", page: 500, optional: true },
  { source: "knowledge_snapshots", group: "clients", page: 100, optional: true },
  { source: "client_research_pages", group: "clients", page: 100, optional: true },
  { source: "client_research_briefs", group: "clients", page: 100, optional: true },
  { source: "client_portal_access", group: "clients", page: 500 },
  { source: "client_portal_sites", group: "clients", page: 500 },
  { source: "client_portal_changes", group: "clients", page: 50 },
  { source: "projects", group: "projects", page: 500, csv: ["id", "workspace_id", "client_id", "title", "kind", "status", "delivery_stage", "created_at", "updated_at"] },
  { source: "tasks", group: "projects", page: 500, csv: ["id", "project_id", "title", "status", "due_at", "created_at"] },
  { source: "sources", group: "projects", page: 100 },
  { source: "style_profiles", group: "projects", page: 200 },
  { source: "brand_kits", group: "projects", page: 200 },
  { source: "artifacts", group: "projects", page: 500 },
  { source: "artifact_versions", group: "projects", page: 20 },
  { source: "artifact_plans", group: "projects", page: 100 },
  { source: "assets", group: "projects", page: 500 },
  { source: "reviews", group: "reviews", page: 500 },
  { source: "published_releases", group: "websites", page: 500 },
  { source: "client_review_links", group: "reviews", page: 500 },
  { source: "client_review_comments", group: "reviews", page: 500, csv: ["id", "link_id", "version_number", "kind", "author_name", "author_email", "body", "resolved_at", "created_at"] },
  { source: "client_review_views", group: "reviews", page: 500 },
  { source: "hosted_sites", group: "websites", page: 200 },
  { source: "custom_domains", group: "websites", page: 200 },
  { source: "site_enquiries", group: "websites", page: 500, csv: ["id", "artifact_id", "name", "email", "message", "read_at", "created_at"] },
  { source: "site_view_days", group: "websites", page: 1000 },
  { source: "generation_jobs", group: "usage", page: 500 },
  { source: "mail_accounts", group: "email", page: 100 },
  { source: "mail_templates", group: "email", page: 200 },
  { source: "mail_sequences", group: "email", page: 200 },
  { source: "mail_enrollments", group: "email", page: 500 },
  { source: "mail_messages", group: "email", page: 200, csv: ["id", "client_id", "direction", "status", "subject", "from_address", "to_address", "sent_at", "created_at"] },
  { source: "chat_messages", group: "chat", page: 500 },
  { source: "audit_events", group: "workspaces", page: 500 },
  { source: "github_connection", group: "connections", page: 1 },
  { source: "github_website_links", group: "connections", page: 200 },
  { source: "billing_memberships", group: "billing", page: 200 },
  { source: "billing_checkouts", group: "billing", page: 200 },
  { source: "plan_payments", group: "billing", page: 200, csv: ["payment_id", "membership_id", "plan_id", "billing_reason", "currency", "principal_cents", "refunded_cents", "dispute", "state", "paid_at", "period_start", "period_end"] },
  { source: "plan_periods", group: "billing", page: 500 },
  { source: "membership_revocations", group: "billing", page: 200 },
  { source: "refund_cases", group: "billing", page: 200 },
  { source: "topup_orders", group: "billing", page: 200, csv: ["id", "packId", "credits", "priceCents", "state", "granted", "paymentId", "createdAt"] },
  { source: "credit_wallet", group: "billing", page: 1 },
  { source: "credit_preferences", group: "billing", page: 1 },
  { source: "credit_ledger", group: "billing", page: 1000, csv: ["id", "created_at", "kind", "delta", "balance_after", "reference"] },
  { source: "credit_lots", group: "billing", page: 500 },
  { source: "credit_lot_withholds", group: "billing", page: 500 },
  { source: "autotopup_authorizations", group: "billing", page: 100 },
  { source: "autotopup_attempts", group: "billing", page: 500 },
  { source: "ai_operations", group: "usage", page: 200 },
  { source: "export_requests", group: "requests", page: 100 },
  { source: "deletion_requests", group: "requests", page: 100 },
] satisfies ExportSource[]);

export const exportFileName = (source: ExportSource) => `data/${source.group}/${source.source.replace(/_/g, "-")}.json`;
export const exportCsvName = (source: ExportSource) => `spreadsheets/${source.source.replace(/_/g, "-")}.csv`;
