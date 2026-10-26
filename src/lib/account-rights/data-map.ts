/**
 * Table-by-table data map for export and deletion (migration 20261026100000).
 * check-account-rights.cjs fails when a migration creates a table that is not listed
 * here, so a new table cannot ship without an export and deletion decision.
 *
 * export: the export source that carries it (null = not exported, with the reason).
 * deletion:
 *   delete       removed (directly, or with a workspace the account owns)
 *   retain       copied to retained_account_records with the account id replaced, then removed
 *   pseudonymize kept in place with the account id replaced by the deletion's random reference
 *   detach       rows in other people's workspaces: membership removed, authorship handed to that owner or cleared
 *   system       configuration or aggregate data that names no account
 */
export type DataMapEntry = { table: string; export: string | null; deletion: "delete" | "retain" | "pseudonymize" | "detach" | "system"; reason: string; period?: string; optional?: true };

const W = "Deleted with the workspace the account owns.";
const RETAIN = "Financial/tax record (payments, refunds, credits).";
const ACCT = "Cost-accounting evidence without content.";
const TAX = "10 years after deletion (owner/lawyer to confirm)";

export const DATA_MAP: readonly DataMapEntry[] = Object.freeze([
  // Account
  { table: "makeborne_private.account_privileges", export: "account_privileges", deletion: "delete", reason: "Operator grants for the account." },
  { table: "makeborne_private.account_privilege_events", export: null, deletion: "pseudonymize", reason: "Audit of operator grants; not exported (operator log).", period: "Kept with the audit log" },
  { table: "workspaces", export: "workspaces", deletion: "delete", reason: "Owned workspaces; memberships elsewhere are listed by name and role." },
  { table: "workspace_members", export: "workspace_members", deletion: "detach", reason: "Members of owned workspaces (other accounts shown only as 'another account'); own memberships removed." },
  { table: "makeborne_private.workspace_creation_receipts", export: null, deletion: "delete", reason: "Idempotency receipt, no content." },
  { table: "makeborne_private.cloud_mutation_receipts", export: null, deletion: "delete", reason: "Idempotency receipts; removed for the account everywhere." },
  { table: "audit_events", export: "audit_events", deletion: "detach", reason: "Owned workspaces: full; elsewhere: own actions only. Actor cleared in other workspaces." },
  // CRM
  { table: "clients", export: "clients", deletion: "delete", reason: W },
  { table: "contacts", export: "contacts", deletion: "delete", reason: W },
  { table: "client_portal_access", export: "client_portal_access", deletion: "delete", reason: "Invitation token hash excluded. Revoked at the unpublish step, then deleted with the workspace; a client's own portal account keeps working elsewhere." },
  { table: "client_portal_sites", export: "client_portal_sites", deletion: "delete", reason: W },
  { table: "client_portal_changes", export: "client_portal_changes", deletion: "delete", reason: W },
  { table: "makeborne_private.crm_migration_audit", export: null, deletion: "delete", reason: "Internal stage-migration audit for owned workspaces." },
  { table: "makeborne_private.crm_transition", export: null, deletion: "system", reason: "Global CRM release switch." },
  // Projects
  { table: "projects", export: "projects", deletion: "delete", reason: W },
  { table: "tasks", export: "tasks", deletion: "delete", reason: W },
  { table: "sources", export: "sources", deletion: "delete", reason: W },
  { table: "style_profiles", export: "style_profiles", deletion: "delete", reason: W },
  { table: "brand_kits", export: "brand_kits", deletion: "delete", reason: W },
  { table: "artifacts", export: "artifacts", deletion: "delete", reason: W },
  { table: "artifact_versions", export: "artifact_versions", deletion: "delete", reason: "Every saved version with full content. Versions authored in someone else's workspace are immutable: deletion waits (SHARED_CONTRIBUTIONS) for support." },
  { table: "artifact_plans", export: "artifact_plans", deletion: "detach", reason: "Owned: deleted with the workspace; elsewhere: last editor handed to that workspace's owner." },
  { table: "artifact_card_previews", export: null, deletion: "delete", reason: "Derived library thumbnail HTML; the versions carry the content." },
  { table: "assets", export: "assets", deletion: "delete", reason: "Metadata exported; the original files are in files/. Storage objects under the workspace prefix are removed." },
  { table: "artifact_chat_messages", export: "chat_messages", deletion: "delete", reason: "Account-private chat, every workspace." },
  { table: "reviews", export: "reviews", deletion: "detach", reason: "Owned: deleted; elsewhere: reviewer handed to that workspace's owner." },
  { table: "published_releases", export: "published_releases", deletion: "delete", reason: W },
  // Client review
  { table: "client_review_links", export: "client_review_links", deletion: "delete", reason: "Link token hash excluded. Revoked at unpublish, then deleted." },
  { table: "client_review_comments", export: "client_review_comments", deletion: "delete", reason: W },
  { table: "client_review_snapshots", export: null, deletion: "delete", reason: "Derived review HTML; versions carry the content." },
  { table: "client_review_views", export: "client_review_views", deletion: "delete", reason: "View counts; the anonymous viewer session id is excluded." },
  // Websites
  { table: "hosted_sites", export: "hosted_sites", deletion: "delete", reason: "Taken offline first (live=false), then deleted. Rendered HTML is not exported (versions and website-sources carry it)." },
  { table: "hosted_site_files", export: null, deletion: "delete", reason: "Derived published files; website-sources carries the source." },
  { table: "makeborne_hosting.site_routes", export: null, deletion: "delete", reason: "Derived published routes; removed at unpublish." },
  { table: "makeborne_hosting.site_address_reservations", export: null, deletion: "delete", reason: "Address reservation; the address becomes available again (owner decision: tombstone)." },
  { table: "makeborne_hosting.site_publication_events", export: null, deletion: "delete", reason: "First-published timestamp; deleted with the workspace." },
  { table: "custom_domains", export: "custom_domains", deletion: "delete", reason: "Edge hostname id excluded. Detached from the edge provider at the domains step." },
  { table: "site_enquiries", export: "site_enquiries", deletion: "delete", reason: "Visitor form submissions held for the account (business records)." },
  { table: "site_view_days", export: "site_view_days", deletion: "delete", reason: "Aggregate views." },
  { table: "site_view_breakdowns", export: null, deletion: "delete", reason: "Aggregate referrer/device counts; site_view_days is exported." },
  { table: "makeborne_private.site_view_visitors", export: null, deletion: "delete", reason: "Daily salted visitor hashes, not linkable to a person." },
  { table: "makeborne_private.site_analytics_key", export: null, deletion: "system", reason: "Global analytics secret." },
  { table: "makeborne_private.site_address_namespace_policy", export: null, deletion: "system", reason: "Global hosting policy." },
  { table: "makeborne_private.trusted_publication_scope", export: null, deletion: "system", reason: "Global publication policy." },
  { table: "makeborne_private.trusted_publication_workspaces", export: null, deletion: "delete", reason: W },
  { table: "makeborne_private.publication_preparations", export: null, deletion: "delete", reason: "Build queue rows and compiled output; deleted with the workspace/account." },
  { table: "makeborne_private.publication_sandboxes", export: null, deletion: "system", reason: "Build machine journal (names, leases); no account data. Codex: confirm no output persists." },
  { table: "makeborne_private.preview_sessions", export: null, deletion: "delete", reason: "Short-lived preview cookies (hashes)." },
  { table: "makeborne_private.project_builds", export: null, deletion: "retain", reason: `${ACCT} Receipt excluded.`, period: TAX },
  // Generation
  { table: "generation_jobs", export: "generation_jobs", deletion: "delete", reason: "Status only; provider request ids excluded." },
  { table: "budget_reservations", export: null, deletion: "retain", reason: ACCT, period: TAX },
  { table: "usage_ledger", export: null, deletion: "retain", reason: `${ACCT} Vendor costs are internal; customer credits are in credit_ledger.`, period: TAX },
  { table: "makeborne_private.generation_budgets", export: null, deletion: "delete", reason: "Per-workspace spending limits." },
  { table: "makeborne_private.generation_proposals", export: null, deletion: "delete", reason: "Prepared-request snapshots; consents in them are exported via ai_operations." },
  { table: "makeborne_private.generation_reservations", export: null, deletion: "retain", reason: `${ACCT} Approval snapshot excluded.`, period: TAX },
  { table: "makeborne_private.generation_dispatches", export: null, deletion: "detach", reason: "Owned: deleted; elsewhere: actor handed to that workspace's owner." },
  { table: "makeborne_private.generation_provider_outcomes", export: null, deletion: "retain", reason: ACCT, period: TAX },
  { table: "makeborne_private.generation_job_settlements", export: null, deletion: "retain", reason: `${ACCT} A settlement reviewed in someone else's workspace stops deletion for manual review (immutable).`, period: TAX },
  { table: "makeborne_private.generation_execution_holds", export: null, deletion: "retain", reason: ACCT, period: TAX },
  { table: "makeborne_private.generation_job_outbox", export: null, deletion: "delete", reason: "Queue outbox." },
  { table: "makeborne_private.generation_execution_caps", export: null, deletion: "system", reason: "Global spending caps." },
  { table: "makeborne_private.ai_operations", export: "ai_operations", deletion: "delete", reason: "Requests the account made (kind, effort, credits, request context incl. consent); internal rate/cost fields excluded." },
  { table: "makeborne_private.ai_operation_runs", export: null, deletion: "delete", reason: "Steps of an operation; deleted with it." },
  { table: "makeborne_private.ai_operation_authorizations", export: null, deletion: "delete", reason: "Extra-credit approvals; deleted with the operation." },
  { table: "makeborne_private.ai_run_outcomes", export: null, deletion: "pseudonymize", reason: "Charged vs measured credits and vendor cost (accounting).", period: TAX },
  { table: "makeborne_private.live_provider_calls", export: null, deletion: "pseudonymize", reason: "Vendor spend ledger (accounting).", period: TAX },
  { table: "makeborne_private.live_provider_days", export: null, deletion: "system", reason: "Daily totals." },
  { table: "makeborne_private.live_provider_limits", export: null, deletion: "system", reason: "Global limits." },
  { table: "makeborne_private.research_daily_uses", export: null, deletion: "delete", reason: "Per-person daily counter for website checks and client research (20261026120100); timestamps only, no content." },
  { table: "claude_pilot_runs", export: null, deletion: "retain", reason: "Internal pilot runs (usage); result excluded.", period: TAX },
  { table: "makeborne_private.claude_pilot_budget", export: null, deletion: "system", reason: "Global pilot budget." },
  // Email
  { table: "mail_accounts", export: "mail_accounts", deletion: "delete", reason: "Own mailboxes only; disconnected at the disconnect step. Deleting a mailbox also deletes its saved messages, including in workspaces owned by others." },
  { table: "makeborne_private.mail_tokens", export: null, deletion: "delete", reason: "Secret: never exported; deleted at the disconnect step. Provider-side revocation is a Codex follow-up." },
  { table: "mail_templates", export: "mail_templates", deletion: "delete", reason: W },
  { table: "mail_sequences", export: "mail_sequences", deletion: "delete", reason: W },
  { table: "mail_enrollments", export: "mail_enrollments", deletion: "delete", reason: "Paused at disconnect; deleted with the workspace." },
  { table: "mail_messages", export: "mail_messages", deletion: "delete", reason: "Provider message id excluded." },
  // Connections
  { table: "github_connections", export: "github_connection", deletion: "delete", reason: "Login and id only; token ciphertexts never exported. Row deleted at disconnect (same as Disconnect)." },
  { table: "github_website_links", export: "github_website_links", deletion: "delete", reason: "Repository links the account made." },
  // Billing
  { table: "billing_memberships", export: "billing_memberships", deletion: "retain", reason: RETAIN, period: TAX },
  { table: "billing_checkouts", export: "billing_checkouts", deletion: "retain", reason: `${RETAIN} Checkout link excluded.`, period: TAX },
  { table: "billing_webhook_events", export: null, deletion: "system", reason: "Provider event ids (no account id); kept as delivery evidence.", period: TAX },
  { table: "makeborne_private.plan_payments", export: "plan_payments", deletion: "retain", reason: `${RETAIN} Provider evidence not exported.`, period: TAX },
  { table: "makeborne_private.plan_payment_observations", export: null, deletion: "system", reason: "Provider payment evidence keyed by payment id (no account id). May contain provider-side customer fields: lawyer to confirm minimisation.", period: TAX },
  { table: "makeborne_private.plan_periods", export: "plan_periods", deletion: "retain", reason: RETAIN, period: TAX },
  { table: "makeborne_private.plan_observations", export: null, deletion: "retain", reason: `${RETAIN} Internal access-check log; plan_periods/billing_memberships are exported.`, period: TAX },
  { table: "makeborne_private.plan_credit_issues", export: null, deletion: "retain", reason: `${RETAIN} Internal reconciliation issues.`, period: TAX },
  { table: "makeborne_private.membership_revocations", export: "membership_revocations", deletion: "retain", reason: RETAIN, period: TAX },
  { table: "makeborne_private.refund_cases", export: "refund_cases", deletion: "retain", reason: `${RETAIN} Operator ids excluded; operator ids of a deleted operator are pseudonymized.`, period: TAX },
  { table: "makeborne_private.topup_orders", export: "topup_orders", deletion: "retain", reason: `${RETAIN} Checkout link/request excluded.`, period: TAX },
  { table: "makeborne_private.topup_observations", export: null, deletion: "system", reason: "Provider evidence keyed by order id (no account id).", period: TAX },
  { table: "makeborne_private.topup_catalog", export: null, deletion: "system", reason: "Price catalogue." },
  { table: "makeborne_private.checkout_recoveries", export: null, deletion: "system", reason: "Recovery queue keyed by checkout request id (no account id)." },
  { table: "makeborne_private.billing_access_plans", export: null, deletion: "system", reason: "Plan allowlist." },
  { table: "makeborne_private.billing_settings", export: null, deletion: "system", reason: "Global billing switches." },
  { table: "makeborne_private.billing_job_runs", export: null, deletion: "system", reason: "Job run log." },
  { table: "makeborne_private.autotopup_settings", export: null, deletion: "system", reason: "Global auto top-up settings." },
  { table: "makeborne_private.autotopup_authorizations", export: "autotopup_authorizations", deletion: "retain", reason: "Consent evidence for automatic charges.", period: TAX },
  { table: "makeborne_private.autotopup_attempts", export: "autotopup_attempts", deletion: "retain", reason: RETAIN, period: TAX },
  { table: "credit_ledger", export: "credit_ledger", deletion: "retain", reason: RETAIN, period: TAX },
  { table: "makeborne_private.credit_wallets", export: "credit_wallet", deletion: "retain", reason: `${RETAIN} Final balance; unused credits are forfeited.`, period: TAX },
  { table: "makeborne_private.credit_lots", export: "credit_lots", deletion: "retain", reason: RETAIN, period: TAX },
  { table: "makeborne_private.credit_lot_withholds", export: "credit_lot_withholds", deletion: "retain", reason: RETAIN, period: TAX },
  { table: "makeborne_private.credit_lot_migration", export: null, deletion: "retain", reason: `${RETAIN} One-time migration snapshot.`, period: TAX },
  { table: "makeborne_private.credit_reservations", export: null, deletion: "retain", reason: `${RETAIN} Holds; ai_operations is exported.`, period: TAX },
  { table: "makeborne_private.credit_hold_lots", export: null, deletion: "pseudonymize", reason: `${RETAIN} Hold-to-lot allocation (no account reference).`, period: TAX },
  { table: "makeborne_private.credit_preferences", export: "credit_preferences", deletion: "delete", reason: "Low-balance alert and monthly limit." },
  // Operations and telemetry
  { table: "makeborne_private.app_error_groups", export: null, deletion: "system", reason: "Scrubbed error reports, no account id.", period: "About 400 days" },
  { table: "makeborne_private.app_error_days", export: null, deletion: "system", reason: "Daily error counts.", period: "About 400 days" },
  { table: "makeborne_private.studio_visits", export: null, deletion: "system", reason: "Daily salted visit hashes, unlinkable after the salt is deleted.", period: "About 400 days" },
  { table: "makeborne_private.telemetry_salts", export: null, deletion: "system", reason: "Daily salts, deleted after two days." },
  // Data rights (this migration)
  { table: "makeborne_private.account_export_requests", export: "export_requests", deletion: "delete", reason: "Export requests; files removed after 72 hours and at deletion." },
  { table: "makeborne_private.account_deletion_requests", export: "deletion_requests", deletion: "pseudonymize", reason: "Proof of erasure: account id cleared on completion; only the random reference, dates and steps remain.", period: "Owner decision (proposed 3 years)" },
  { table: "makeborne_private.account_rights_events", export: null, deletion: "system", reason: "Operational log: request ids, event names and codes, no personal data.", period: "Owner decision (proposed 3 years)" },
  { table: "makeborne_private.retained_account_records", export: null, deletion: "system", reason: "The retained, pseudonymized records themselves; purged after retain_until.", period: TAX },
  { table: "makeborne_private.account_legal_holds", export: null, deletion: "system", reason: "Operator-only holds; an open hold blocks deletion." },
  // Feature-branch tables (exported when present; deleted with the workspace)
  ...["crm_next_steps", "crm_suppressions", "crm_site_checks", "crm_duplicate_dismissals", "client_facts", "client_fact_revisions", "client_fact_evidence", "knowledge_snapshots", "client_research_pages", "client_research_briefs"]
    .map(table => ({ table, export: table, deletion: "delete" as const, reason: `${W} Created by a feature branch; exported when present.`, optional: true as const })),
  { table: "client_knowledge_state", export: null, deletion: "delete", reason: `${W} Per-client counter (feature branch).`, optional: true },
  { table: "makeborne_private.brief_enhancements", export: null, deletion: "delete", reason: "Brief-enhancer runs (full candidate): removed with the sign-in record (cascade). Codex: add an export source if it is activated.", optional: true },
] satisfies DataMapEntry[]);
