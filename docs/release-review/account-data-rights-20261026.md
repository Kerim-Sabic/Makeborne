# Account data rights: export and deletion (26 October 2026)

Branch `claude/account-data-rights`, worktree `.claude/worktrees/account-rights`, base Codex's minimum candidate **5f655a7**. Local only. Nothing was pushed, merged, deployed or run against staging or production. No provider calls and no paid calls were made.

**Why.** The new-user audit found that Settings had no data export and no account deletion. EU users have the rights of access, erasure and portability (GDPR Art. 15, 17 and 20). The current privacy notice tells people to email admin@makeborne.com. This branch builds both features so they are ready. **Activation and the policy wording stay with the owner and Codex.**

## Status at a glance

- **Off by default.**
  - `MAKEBORNE_ACCOUNT_EXPORT` must be exactly `on` to enable data export.
  - `MAKEBORNE_ACCOUNT_DELETION` must be exactly `on` to enable account deletion.
  - With both off, Settings shows the email-support route the privacy notice already promises.
- **Grace period.** 7 days, set by a single constant: `ACCOUNT_DELETION_GRACE_DAYS` in `src/lib/account-rights/contracts.ts`. The database clamps it to 1–30.
- **Migration.** `supabase/migrations/20261026100000_account_data_rights.sql`. It adds 5 private tables, 1 private bucket and 18 functions. All entry points need the server key.
  - It also replaces 3 existing guard functions so they allow a delete during an active erasure. With no erasure in progress they behave exactly as before.
  - It was applied only to the local `makeborne-journey-audit` stack (DB 127.0.0.1:55618), after a rolled-back dry run.
- **Scheduler.** The cron route `/api/cron/account-rights` exists but is **not** added to `vercel.json`. Scheduling it is Codex's decision.

## Flows

### Export my data

1. **Request.** In Settings › Your data, the account owner clicks **Prepare my data**.
   - `POST /api/account/data/export` checks the same origin and requires an `Idempotency-Key`. The account always comes from the verified session, never from the request body.
   - `makeborne_account_export_request` records the request and is idempotent per key.
   - **Rate limit:** one export at a time, and one per 24 hours. A failed export does not count toward the limit.
2. **Build.** The ZIP is built on the server inside the same request's `after()` (maxDuration 300 s). If the build stops, the cron route picks it up again after its lease expires. A build is attempted at most 3 times, then marked `failed` (`ATTEMPTS_EXHAUSTED`).
   - Reads go through `makeborne_account_export_rows(user, source, offset, limit)`. This is one SQL branch per source, with fixed column lists.
   - Each source is scoped to **workspaces the account owns**, or to rows keyed by the account itself.
   - For workspaces the account only belongs to, the export lists just the workspace name and role. It contains none of that workspace's content.
   - The builder also strips any secret-looking key as a second line of defence.
3. **What the ZIP holds.**
   - **Part 1:** `README.txt`, `manifest.json` (row counts, plus a checksum for every file), `data/**.json` for all 63 sources, and `spreadsheets/*.csv` for clients, contacts, tasks, projects, review comments, enquiries, emails, payments, top-ups and the credit ledger. CSV cells are protected against formula injection.
   - **`website-sources/`:** the current version of each owned website, built with the existing source-download builders. This is the "where cheap" extra; up to 25 sites, and a site that fails is skipped.
   - **Uploaded files:** the originals from `project-assets`, split into parts of at most 45 MB (the bucket's object limit is 50 MB). Above 900 MB in total, files are listed in the manifest as skipped and the README says to email support.
4. **Delivery.**
   - Parts go to the private `account-exports` bucket at `<user>/<request>/part-N.zip`.
   - The download link is a 120-second signed URL. It is created only when the person clicks `GET /api/account/data/export/<id>/parts/<n>` (a 303 redirect with no referrer).
   - That route checks the owner, the request and the expiry. Another account's export and an expired one get the same 404.
   - Files are removed 72 hours after they are ready; the cron route calls `expireAccountExports`.
5. **Logging.** `makeborne_private.account_rights_events` records the request id, event and code only. Console JSON logs carry the same fields.

**Never included:**
- Token hashes, token ciphertexts and mail tokens.
- Provider checkout links and payment evidence payloads.
- Custom-domain edge ids.
- Internal vendor cost, rate and model fields.
- Other accounts' chat history, billing and mailboxes. In owned workspaces, other members appear only as "another account".

### Delete my account

1. **Explain.** Settings shows three things before anything can be confirmed:
   - **What is deleted and what is kept, and why.** The copy is in `DELETION_EXPLAINED`.
   - **Live consequences:** the number of live websites and connected domains, unused credits, portal clients, the mailbox and code-hosting connections, and memberships in other people's workspaces.
   - **Blockers, each with a link.** These are checked by `makeborne_private.account_deletion_blockers`:

| Code | Meaning | What the user does |
|---|---|---|
| `ACTIVE_SUBSCRIPTION` | A membership is `trialing`, `active`, `past_due` or `unresolved` | Cancel it (link to `/billing#receipts`, which opens the existing Whop management page). **Nothing is cancelled automatically.** `canceling` (cancelled at period end) does not block. |
| `SHARED_WORKSPACE` | An owned workspace has other members | Email support to transfer it or remove the members. There is no member-management UI. |
| `SHARED_CONTRIBUTIONS` | The account saved versions in someone else's workspace | Email support. Versions are immutable, so the workspace owner must take them over first. |
| `AUTO_TOPUP_ON` | An automatic top-up authorization is open | Turn it off in `/billing#credits`. |
| `REFUND_IN_PROGRESS` | A refund case is `pending` | Wait for it, or email support. |
| `ACCOUNT_HOLD` | An operator opened a row in `makeborne_private.account_legal_holds` | Email support. |

2. **Confirm.** The person must do all of the following:
   - Type their sign-in email; case and surrounding spaces are ignored.
   - Tick the box saying they have downloaded what they want to keep and understand deletion can't be undone.
   - Have a **fresh sign-in**: the token's `amr` timestamp must be under 10 minutes old. Refreshing a session does not count. If it is older, the UI offers **Sign in again**, which signs out and returns to `/login?next=/studio?tab=settings`. The retry reuses the same request key.
   - The route also requires the same origin and an `Idempotency-Key`.
3. **Grace period.**
   - `makeborne_account_deletion_request` records a `scheduled` request and returns `scheduled_for = now() + 7 days`.
   - The account keeps working, and a notice appears across the studio. The owner can cancel any time before the job starts.
   - A request that is blocked before any destructive step can be cancelled, or asked again once the blocker is resolved.
   - Cancelling does not happen automatically on sign-in. Signing in is enough to *see* the notice and the **Cancel deletion** button. This is an owner decision (see below).
4. **Job.** The cron route calls `runDueAccountDeletions`. Each step is idempotent and recorded in `steps`. A run holds a 280-second lease; a stopped run resumes at the first missing step under a new lease, and a stale lease is refused (`MBD10`).

| # | Step | Where | What |
|---|---|---|---|
| 1 | `recheck` | DB | Checks blockers again (if any, the request becomes `blocked` and nothing has been touched). Waits while generation or publication work is running (`busy`). Records the owned workspace ids. |
| 2 | `lock` | App | Bans the sign-in through the auth admin API (`ban_duration`), so it cannot sign in or refresh. |
| 3 | `unpublish` | DB | Sets `hosted_sites.live=false` and deletes `site_routes`. Revokes review links and portal invitations and logins. |
| 4 | `domains` | App | Detaches each custom hostname at the edge with the existing `cloudflareHostnames().remove` (404 counts as done). It is skipped and logged if custom domains are not configured. |
| 5 | `disconnect` | DB | Deletes mail tokens, marks mailboxes disconnected and pauses sequences. Deletes the GitHub connection and its links. This is the same effect as the existing Disconnect actions. |
| 6 | `retain` | DB | Copies the financial, consent and accounting rows into `retained_account_records`. Every top-level value equal to the account id is replaced by the request's random `subject_ref`. Checkout links and approval snapshots are excluded. Conflicts are ignored, so the step is idempotent. |
| 7 | `erase` | DB, one transaction | Sets `makeborne.account_erasure`. Deletes the owned workspaces with their dependants in foreign-key order. Leaves other workspaces: membership removed, review and plan authorship handed to that workspace's owner, actor cleared. Pseudonymizes rows that have no foreign key in place. Then checks for remaining references to the sign-in record; any found sets `blocked` (`MANUAL_REVIEW`). |
| 8 | `storage` | App | Removes every object under `project-assets/<workspace>/` (recursively) and `account-exports/<user>/`. |
| 9 | `auth` | App | `auth.admin.deleteUser(user)`. The foreign-key cascades remove the original billing rows, which are already copied in step 6. |
| 10 | `finish` | DB | Requires every step to be done and the sign-in record to be gone. Sets `completed`, clears `user_id` and the workspace ids. The row stays as proof of erasure: random reference, dates and step times. |

## Data map

There are 127 entries: 115 tables from this branch’s migrations, plus 12 feature-branch tables (the `crm-research` CRM and knowledge tables and the full candidate’s `brief_enhancements`). The CRM and knowledge tables are exported when present; all are deleted with the workspace or account.

- **Export:** 63 export sources.
- **On deletion:**
  - 67 delete;
  - 25 retain (pseudonymized copy);
  - 5 pseudonymize in place;
  - 5 detach;
  - 25 are system tables or hold no account data.

`src/lib/account-rights/data-map.ts` is the source of truth. `check-account-rights.cjs` fails when any migration creates a table that is not in it. Retention periods marked "owner/lawyer to confirm" are proposals.

| Table | Export source | On deletion | Reason | Period |
|---|---|---|---|---|
| `makeborne_private.account_privileges` | `account_privileges` | Delete | Operator grants for the account. | — |
| `makeborne_private.account_privilege_events` | No | Pseudonymize in place | Audit of operator grants; not exported (operator log). | Kept with the audit log |
| `workspaces` | `workspaces` | Delete | Owned workspaces; memberships elsewhere are listed by name and role. | — |
| `workspace_members` | `workspace_members` | Detach (shared workspaces) | Members of owned workspaces (other accounts shown only as 'another account'); own memberships removed. | — |
| `makeborne_private.workspace_creation_receipts` | No | Delete | Idempotency receipt, no content. | — |
| `makeborne_private.cloud_mutation_receipts` | No | Delete | Idempotency receipts; removed for the account everywhere. | — |
| `audit_events` | `audit_events` | Detach (shared workspaces) | Owned workspaces: full; elsewhere: own actions only. Actor cleared in other workspaces. | — |
| `clients` | `clients` | Delete | Deleted with the workspace the account owns. | — |
| `contacts` | `contacts` | Delete | Deleted with the workspace the account owns. | — |
| `client_portal_access` | `client_portal_access` | Delete | Invitation token hash excluded. Revoked at the unpublish step, then deleted with the workspace; a client's own portal account keeps working elsewhere. | — |
| `client_portal_sites` | `client_portal_sites` | Delete | Deleted with the workspace the account owns. | — |
| `client_portal_changes` | `client_portal_changes` | Delete | Deleted with the workspace the account owns. | — |
| `makeborne_private.crm_migration_audit` | No | Delete | Internal stage-migration audit for owned workspaces. | — |
| `makeborne_private.crm_transition` | No | No account data / system | Global CRM release switch. | — |
| `projects` | `projects` | Delete | Deleted with the workspace the account owns. | — |
| `tasks` | `tasks` | Delete | Deleted with the workspace the account owns. | — |
| `sources` | `sources` | Delete | Deleted with the workspace the account owns. | — |
| `style_profiles` | `style_profiles` | Delete | Deleted with the workspace the account owns. | — |
| `brand_kits` | `brand_kits` | Delete | Deleted with the workspace the account owns. | — |
| `artifacts` | `artifacts` | Delete | Deleted with the workspace the account owns. | — |
| `artifact_versions` | `artifact_versions` | Delete | Every saved version with full content. Versions authored in someone else's workspace are immutable: deletion waits (SHARED_CONTRIBUTIONS) for support. | — |
| `artifact_plans` | `artifact_plans` | Detach (shared workspaces) | Owned: deleted with the workspace; elsewhere: last editor handed to that workspace's owner. | — |
| `artifact_card_previews` | No | Delete | Derived library thumbnail HTML; the versions carry the content. | — |
| `assets` | `assets` | Delete | Metadata exported; the original files are in files/. Storage objects under the workspace prefix are removed. | — |
| `artifact_chat_messages` | `chat_messages` | Delete | Account-private chat, every workspace. | — |
| `reviews` | `reviews` | Detach (shared workspaces) | Owned: deleted; elsewhere: reviewer handed to that workspace's owner. | — |
| `published_releases` | `published_releases` | Delete | Deleted with the workspace the account owns. | — |
| `client_review_links` | `client_review_links` | Delete | Link token hash excluded. Revoked at unpublish, then deleted. | — |
| `client_review_comments` | `client_review_comments` | Delete | Deleted with the workspace the account owns. | — |
| `client_review_snapshots` | No | Delete | Derived review HTML; versions carry the content. | — |
| `client_review_views` | `client_review_views` | Delete | View counts; the anonymous viewer session id is excluded. | — |
| `hosted_sites` | `hosted_sites` | Delete | Taken offline first (live=false), then deleted. Rendered HTML is not exported (versions and website-sources carry it). | — |
| `hosted_site_files` | No | Delete | Derived published files; website-sources carries the source. | — |
| `makeborne_hosting.site_routes` | No | Delete | Derived published routes; removed at unpublish. | — |
| `makeborne_hosting.site_address_reservations` | No | Delete | Address reservation; the address becomes available again (owner decision: tombstone). | — |
| `makeborne_hosting.site_publication_events` | No | Delete | First-published timestamp; deleted with the workspace. | — |
| `custom_domains` | `custom_domains` | Delete | Edge hostname id excluded. Detached from the edge provider at the domains step. | — |
| `site_enquiries` | `site_enquiries` | Delete | Visitor form submissions held for the account (business records). | — |
| `site_view_days` | `site_view_days` | Delete | Aggregate views. | — |
| `site_view_breakdowns` | No | Delete | Aggregate referrer/device counts; site_view_days is exported. | — |
| `makeborne_private.site_view_visitors` | No | Delete | Daily salted visitor hashes, not linkable to a person. | — |
| `makeborne_private.site_analytics_key` | No | No account data / system | Global analytics secret. | — |
| `makeborne_private.site_address_namespace_policy` | No | No account data / system | Global hosting policy. | — |
| `makeborne_private.trusted_publication_scope` | No | No account data / system | Global publication policy. | — |
| `makeborne_private.trusted_publication_workspaces` | No | Delete | Deleted with the workspace the account owns. | — |
| `makeborne_private.publication_preparations` | No | Delete | Build queue rows and compiled output; deleted with the workspace/account. | — |
| `makeborne_private.publication_sandboxes` | No | No account data / system | Build machine journal (names, leases); no account data. Codex: confirm no output persists. | — |
| `makeborne_private.preview_sessions` | No | Delete | Short-lived preview cookies (hashes). | — |
| `makeborne_private.project_builds` | No | Retain (pseudonymized copy) | Cost-accounting evidence without content. Receipt excluded. | 10 years after deletion (owner/lawyer to confirm) |
| `generation_jobs` | `generation_jobs` | Delete | Status only; provider request ids excluded. | — |
| `budget_reservations` | No | Retain (pseudonymized copy) | Cost-accounting evidence without content. | 10 years after deletion (owner/lawyer to confirm) |
| `usage_ledger` | No | Retain (pseudonymized copy) | Cost-accounting evidence without content. Vendor costs are internal; customer credits are in credit_ledger. | 10 years after deletion (owner/lawyer to confirm) |
| `makeborne_private.generation_budgets` | No | Delete | Per-workspace spending limits. | — |
| `makeborne_private.generation_proposals` | No | Delete | Prepared-request snapshots; consents in them are exported via ai_operations. | — |
| `makeborne_private.generation_reservations` | No | Retain (pseudonymized copy) | Cost-accounting evidence without content. Approval snapshot excluded. | 10 years after deletion (owner/lawyer to confirm) |
| `makeborne_private.generation_dispatches` | No | Detach (shared workspaces) | Owned: deleted; elsewhere: actor handed to that workspace's owner. | — |
| `makeborne_private.generation_provider_outcomes` | No | Retain (pseudonymized copy) | Cost-accounting evidence without content. | 10 years after deletion (owner/lawyer to confirm) |
| `makeborne_private.generation_job_settlements` | No | Retain (pseudonymized copy) | Cost-accounting evidence without content. A settlement reviewed in someone else's workspace stops deletion for manual review (immutable). | 10 years after deletion (owner/lawyer to confirm) |
| `makeborne_private.generation_execution_holds` | No | Retain (pseudonymized copy) | Cost-accounting evidence without content. | 10 years after deletion (owner/lawyer to confirm) |
| `makeborne_private.generation_job_outbox` | No | Delete | Queue outbox. | — |
| `makeborne_private.generation_execution_caps` | No | No account data / system | Global spending caps. | — |
| `makeborne_private.ai_operations` | `ai_operations` | Delete | Requests the account made (kind, effort, credits, request context incl. consent); internal rate/cost fields excluded. | — |
| `makeborne_private.ai_operation_runs` | No | Delete | Steps of an operation; deleted with it. | — |
| `makeborne_private.ai_operation_authorizations` | No | Delete | Extra-credit approvals; deleted with the operation. | — |
| `makeborne_private.ai_run_outcomes` | No | Pseudonymize in place | Charged vs measured credits and vendor cost (accounting). | 10 years after deletion (owner/lawyer to confirm) |
| `makeborne_private.live_provider_calls` | No | Pseudonymize in place | Vendor spend ledger (accounting). | 10 years after deletion (owner/lawyer to confirm) |
| `makeborne_private.live_provider_days` | No | No account data / system | Daily totals. | — |
| `makeborne_private.live_provider_limits` | No | No account data / system | Global limits. | — |
| `claude_pilot_runs` | No | Retain (pseudonymized copy) | Internal pilot runs (usage); result excluded. | 10 years after deletion (owner/lawyer to confirm) |
| `makeborne_private.claude_pilot_budget` | No | No account data / system | Global pilot budget. | — |
| `mail_accounts` | `mail_accounts` | Delete | Own mailboxes only; disconnected at the disconnect step. Deleting a mailbox also deletes its saved messages, including in workspaces owned by others. | — |
| `makeborne_private.mail_tokens` | No | Delete | Secret: never exported; deleted at the disconnect step. Provider-side revocation is a Codex follow-up. | — |
| `mail_templates` | `mail_templates` | Delete | Deleted with the workspace the account owns. | — |
| `mail_sequences` | `mail_sequences` | Delete | Deleted with the workspace the account owns. | — |
| `mail_enrollments` | `mail_enrollments` | Delete | Paused at disconnect; deleted with the workspace. | — |
| `mail_messages` | `mail_messages` | Delete | Provider message id excluded. | — |
| `github_connections` | `github_connection` | Delete | Login and id only; token ciphertexts never exported. Row deleted at disconnect (same as Disconnect). | — |
| `github_website_links` | `github_website_links` | Delete | Repository links the account made. | — |
| `billing_memberships` | `billing_memberships` | Retain (pseudonymized copy) | Financial/tax record (payments, refunds, credits). | 10 years after deletion (owner/lawyer to confirm) |
| `billing_checkouts` | `billing_checkouts` | Retain (pseudonymized copy) | Financial/tax record (payments, refunds, credits). Checkout link excluded. | 10 years after deletion (owner/lawyer to confirm) |
| `billing_webhook_events` | No | No account data / system | Provider event ids (no account id); kept as delivery evidence. | 10 years after deletion (owner/lawyer to confirm) |
| `makeborne_private.plan_payments` | `plan_payments` | Retain (pseudonymized copy) | Financial/tax record (payments, refunds, credits). Provider evidence not exported. | 10 years after deletion (owner/lawyer to confirm) |
| `makeborne_private.plan_payment_observations` | No | No account data / system | Provider payment evidence keyed by payment id (no account id). May contain provider-side customer fields: lawyer to confirm minimisation. | 10 years after deletion (owner/lawyer to confirm) |
| `makeborne_private.plan_periods` | `plan_periods` | Retain (pseudonymized copy) | Financial/tax record (payments, refunds, credits). | 10 years after deletion (owner/lawyer to confirm) |
| `makeborne_private.plan_observations` | No | Retain (pseudonymized copy) | Financial/tax record (payments, refunds, credits). Internal access-check log; plan_periods/billing_memberships are exported. | 10 years after deletion (owner/lawyer to confirm) |
| `makeborne_private.plan_credit_issues` | No | Retain (pseudonymized copy) | Financial/tax record (payments, refunds, credits). Internal reconciliation issues. | 10 years after deletion (owner/lawyer to confirm) |
| `makeborne_private.membership_revocations` | `membership_revocations` | Retain (pseudonymized copy) | Financial/tax record (payments, refunds, credits). | 10 years after deletion (owner/lawyer to confirm) |
| `makeborne_private.refund_cases` | `refund_cases` | Retain (pseudonymized copy) | Financial/tax record (payments, refunds, credits). Operator ids excluded; operator ids of a deleted operator are pseudonymized. | 10 years after deletion (owner/lawyer to confirm) |
| `makeborne_private.topup_orders` | `topup_orders` | Retain (pseudonymized copy) | Financial/tax record (payments, refunds, credits). Checkout link/request excluded. | 10 years after deletion (owner/lawyer to confirm) |
| `makeborne_private.topup_observations` | No | No account data / system | Provider evidence keyed by order id (no account id). | 10 years after deletion (owner/lawyer to confirm) |
| `makeborne_private.topup_catalog` | No | No account data / system | Price catalogue. | — |
| `makeborne_private.checkout_recoveries` | No | No account data / system | Recovery queue keyed by checkout request id (no account id). | — |
| `makeborne_private.billing_access_plans` | No | No account data / system | Plan allowlist. | — |
| `makeborne_private.billing_settings` | No | No account data / system | Global billing switches. | — |
| `makeborne_private.billing_job_runs` | No | No account data / system | Job run log. | — |
| `makeborne_private.autotopup_settings` | No | No account data / system | Global auto top-up settings. | — |
| `makeborne_private.autotopup_authorizations` | `autotopup_authorizations` | Retain (pseudonymized copy) | Consent evidence for automatic charges. | 10 years after deletion (owner/lawyer to confirm) |
| `makeborne_private.autotopup_attempts` | `autotopup_attempts` | Retain (pseudonymized copy) | Financial/tax record (payments, refunds, credits). | 10 years after deletion (owner/lawyer to confirm) |
| `credit_ledger` | `credit_ledger` | Retain (pseudonymized copy) | Financial/tax record (payments, refunds, credits). | 10 years after deletion (owner/lawyer to confirm) |
| `makeborne_private.credit_wallets` | `credit_wallet` | Retain (pseudonymized copy) | Financial/tax record (payments, refunds, credits). Final balance; unused credits are forfeited. | 10 years after deletion (owner/lawyer to confirm) |
| `makeborne_private.credit_lots` | `credit_lots` | Retain (pseudonymized copy) | Financial/tax record (payments, refunds, credits). | 10 years after deletion (owner/lawyer to confirm) |
| `makeborne_private.credit_lot_withholds` | `credit_lot_withholds` | Retain (pseudonymized copy) | Financial/tax record (payments, refunds, credits). | 10 years after deletion (owner/lawyer to confirm) |
| `makeborne_private.credit_lot_migration` | No | Retain (pseudonymized copy) | Financial/tax record (payments, refunds, credits). One-time migration snapshot. | 10 years after deletion (owner/lawyer to confirm) |
| `makeborne_private.credit_reservations` | No | Retain (pseudonymized copy) | Financial/tax record (payments, refunds, credits). Holds; ai_operations is exported. | 10 years after deletion (owner/lawyer to confirm) |
| `makeborne_private.credit_hold_lots` | No | Pseudonymize in place | Financial/tax record (payments, refunds, credits). Hold-to-lot allocation (no account reference). | 10 years after deletion (owner/lawyer to confirm) |
| `makeborne_private.credit_preferences` | `credit_preferences` | Delete | Low-balance alert and monthly limit. | — |
| `makeborne_private.app_error_groups` | No | No account data / system | Scrubbed error reports, no account id. | About 400 days |
| `makeborne_private.app_error_days` | No | No account data / system | Daily error counts. | About 400 days |
| `makeborne_private.studio_visits` | No | No account data / system | Daily salted visit hashes, unlinkable after the salt is deleted. | About 400 days |
| `makeborne_private.telemetry_salts` | No | No account data / system | Daily salts, deleted after two days. | — |
| `makeborne_private.account_export_requests` | `export_requests` | Delete | Export requests; files removed after 72 hours and at deletion. | — |
| `makeborne_private.account_deletion_requests` | `deletion_requests` | Pseudonymize in place | Proof of erasure: account id cleared on completion; only the random reference, dates and steps remain. | Owner decision (proposed 3 years) |
| `makeborne_private.account_rights_events` | No | No account data / system | Operational log: request ids, event names and codes, no personal data. | Owner decision (proposed 3 years) |
| `makeborne_private.retained_account_records` | No | No account data / system | The retained, pseudonymized records themselves; purged after retain_until. | 10 years after deletion (owner/lawyer to confirm) |
| `makeborne_private.account_legal_holds` | No | No account data / system | Operator-only holds; an open hold blocks deletion. | — |
| `crm_next_steps` (feature branch) | `crm_next_steps` | Delete | Deleted with the workspace the account owns. Created by a feature branch; exported when present. | — |
| `crm_suppressions` (feature branch) | `crm_suppressions` | Delete | Deleted with the workspace the account owns. Created by a feature branch; exported when present. | — |
| `crm_site_checks` (feature branch) | `crm_site_checks` | Delete | Deleted with the workspace the account owns. Created by a feature branch; exported when present. | — |
| `crm_duplicate_dismissals` (feature branch) | `crm_duplicate_dismissals` | Delete | Deleted with the workspace the account owns. Created by a feature branch; exported when present. | — |
| `client_facts` (feature branch) | `client_facts` | Delete | Deleted with the workspace the account owns. Created by a feature branch; exported when present. | — |
| `client_fact_revisions` (feature branch) | `client_fact_revisions` | Delete | Deleted with the workspace the account owns. Created by a feature branch; exported when present. | — |
| `client_fact_evidence` (feature branch) | `client_fact_evidence` | Delete | Deleted with the workspace the account owns. Created by a feature branch; exported when present. | — |
| `knowledge_snapshots` (feature branch) | `knowledge_snapshots` | Delete | Deleted with the workspace the account owns. Created by a feature branch; exported when present. | — |
| `client_research_pages` (feature branch) | `client_research_pages` | Delete | Deleted with the workspace the account owns. Created by a feature branch; exported when present. | — |
| `client_research_briefs` (feature branch) | `client_research_briefs` | Delete | Deleted with the workspace the account owns. Created by a feature branch; exported when present. | — |
| `client_knowledge_state` (feature branch) | No | Delete | Deleted with the workspace the account owns. Per-client counter (feature branch). | — |
| `makeborne_private.brief_enhancements` (feature branch) | No | Delete | Brief-enhancer runs (full candidate): removed with the sign-in record (cascade). Codex: add an export source if it is activated. | — |

## What Codex must wire or review

This touches the auth, billing and mail boundaries.

1. **Review the migration first.** In particular, review the three `create or replace` guard functions:
   - `prevent_accounting_rewrite`;
   - `protect_project_build`;
   - `protect_referenced_asset_identity`.

   Each allows **DELETE only**, and only when `makeborne.account_erasure` names a `processing` request whose recorded workspaces include the row's workspace. The SQL check proves three things: the guard is unchanged without the setting, a random id is refused, and a completed request's id is refused.
2. **Scheduler.** Add `/api/cron/account-rights` (bearer `CRON_SECRET`) to `vercel.json` when activating. Every 15 minutes is enough; exports start immediately through `after()`. Each tick does the following:
   - expires export files;
   - retries up to 2 stuck exports;
   - runs up to 3 due deletions;
   - purges retained records past `retain_until` (none for 10 years).
3. **Whop cancellation path.** Deletion does **not** cancel subscriptions.
   - An active membership blocks deletion and links to `/billing#receipts`. That page uses `WHOP_MANAGE_URL`, which is still the `https://whop.com/` placeholder.
   - The blocker reads the **stored** membership status. Codex should decide whether `recheck` should refresh it from Whop (`retrieveMembership`) at execution time.
   - Codex should also decide how webhooks for a membership whose account was deleted are handled. The `billing_memberships` row is gone; the retained copy carries the membership id under a `subject_ref`. Today they would arrive as an unknown membership.
4. **Mail and GitHub revocation.** Both are DB-level only, the same as today's Disconnect buttons.
   - Provider-side revocation is not implemented: Google `oauth2/revoke`, Microsoft (the grant remains until the user removes it), and GitHub `DELETE /applications/{client_id}/token`.
   - The Settings copy tells people to revoke access in the provider as well. Mail is Codex-owned; please decide.
5. **Storage outside `project-assets`.**
   - Compiled publication output in R2 (the `r2-output-store` keys) is **not** removed by this job, because it needs the publication controller's binding. Please add an R2 prefix cleanup for the account's workspaces, or confirm that those objects are short-lived.
   - Also confirm that `publication_sandboxes` holds no account content.
6. **Site addresses.** Deleting a hosted site releases its slug (`site_address_reservations` cascades). Codex should decide whether to keep a tombstone, for example 90 days, so a deleted customer's address can't be reclaimed for phishing.
7. **Account emails.** No email is sent on scheduling, cancelling or completing. A "deletion scheduled — cancel here" mail through the existing account mail is recommended. The copy is for the owner to decide.
8. **Fresh-session rule.** The rule reads `amr[].timestamp` from `getClaims()`. Please confirm that the email-code and OAuth sign-ins on staging populate `amr` as expected.
9. **Rebase.** The release branch is now at 0877345, which adds `20261026013451_prevent_unsupported_creation_repurchase.sql`.
   - That migration sorts before this one and redefines none of the three guards.
   - The changed shared files are small: `studio.tsx` (+3 lines), `proxy.ts` (`/api/account` added to the session-refresh list), `check-asset-storage.cjs`, `check-settings-storage.cjs`, `check-trust-copy-browser.cjs` and `settings-storage.ts`.
   - Merging the full candidate needs no new data-map entries; any new table fails `check-account-rights.cjs` until it is classified.
10. **Operator tools.**
   - Legal holds are inserted by SQL (`makeborne_private.account_legal_holds`).
   - `MANUAL_REVIEW` requests need an operator to resolve the residual reference (the job lists the table, column and count) and then run the claim again.
   - An admin console view would help.

## Proposed privacy-notice wording (for the owner and a lawyer; legal pages were not edited)

Replace the last sentences of **"Retention and your choices"** with:

> **Your data.** In Settings › Your data you can download a copy of everything saved to your account: your profile, workspaces you own, clients and notes, projects and their saved versions, uploaded files, client reviews, published websites, emails saved in your workspaces, your project chat history, plans, payments, credits and usage. The copy is a ZIP of JSON and spreadsheet files that you can download for three days. It never contains passwords, access keys or other people's private data.
>
> **Deleting your account.** You can delete your account in Settings. Deletion starts seven days after you ask, and you can cancel until then. When it runs, we take your websites offline, disconnect your mailboxes and code-hosting connection, and delete your sign-in, workspaces you own, projects, files, clients, reviews, chat history and exports. If you're a member of someone else's workspace, you're removed from it and what you created there stays with its owner. Before you can delete your account, an active subscription must be cancelled and workspaces you share must be transferred.
>
> **What we keep.** We keep records of payments, refunds, subscriptions, credits and the consents you gave for automatic top-ups for as long as tax and accounting law requires (currently up to 10 years). We also keep cost totals for work you ran, without its content. In these records your account identifier is replaced by a random reference, so they are no longer linked to a sign-in. We may also keep information we're legally required to hold, for example during a dispute. Our payment processor keeps its own records under its policy. Copies made outside Makeborne, such as pages saved by visitors or search engines and emails already delivered, can't be removed by us. Backups are overwritten on their normal schedule.
>
> If you can't use Settings, email admin@makeborne.com from the address you sign in with. We respond within one month.

**Check with the lawyer:**
- the backup-retention sentence (the Supabase backup window);
- the processor sentence;
- the 10-year period, which depends on jurisdiction.

## Owner decisions

1. **Grace period:** 7 days (constant). The alternatives are 14 or 30 days.
2. **Sign-in during the grace period:** currently signing in shows the notice and a cancel button, and does not cancel automatically. Automatic cancel on sign-in is a one-line change in the cancel flow; it would surprise someone who signs in only to download their data.
3. **Retention periods:**
   - financial, consent and accounting copies: 10 years (`v_until` in the `retain` step);
   - completed request rows and the rights event log: proposed 3 years, with no purge implemented yet;
   - export files: 72 hours.
4. **Export rate limit:** 1 per 24 hours.
5. **File budget:** 900 MB per export.
6. **Fraud prevention:** nothing is kept to stop a deleted person re-signing up for trial credits. Option: keep an HMAC of the email for 12 months.
7. **Activation order:** export first (low risk). Turn on deletion after Codex's review, a staging run of every step and the scheduler.

## Tests (all local)

- **Offline (`npm test`):** `src/lib/account-rights/check-account-rights.cjs`, 15/15. It covers:
  - the data map covers every migration table;
  - the TypeScript sources, SQL branches and data map agree;
  - retained tables match between SQL and the map;
  - no secret columns are selected, and the grants are server-key only;
  - `withoutSecrets`;
  - safe file paths;
  - export paging, parts, budgets, a missing file, CSV injection, README and manifest;
  - a source that fails closes the export;
  - the deletion job's order, resume after a failure, busy, blocked and lost-lease cases;
  - the fresh-sign-in rule;
  - parsing of the status contract;
  - the single grace constant;
  - route ordering (origin, key, user, typed email, fresh sign-in) and the cron secret;
  - no provider or model names in customer copy.

  `src/lib/check-settings-storage.cjs` was updated for the new "Your data" setting (5/5).
- **SQL (`supabase/check-account-data-rights.sql`, rolled back):** 7 groups pass on the local journey-audit stack. They cover:
  - the export is complete and scoped: owner data present; reviewer, other-workspace and other-account data absent; secrets absent;
  - export lifecycle: idempotency, the one-a-day limit, the lease, cross-account refusal, link expiry and bounded retries;
  - blockers: active subscription, shared workspace, hold and shared contributions;
  - the 7-day grace period, idempotent scheduling, cancellation, a replayed key that can't resurrect a request, and cross-account cancel refusal;
  - the full job: unpublish, site routes removed, portal revoked, idempotent steps, resume with a new lease, a stale lease refused, the other account's mailbox and GitHub untouched, pseudonymized retained records, erase, shared review authorship handed to the owner, the other workspace intact, in-place pseudonymization, and finish refused before the auth step;
  - the append-only guard unchanged without an active erasure;
  - grants.

  Existing suites re-run on the same stack all pass: `generation-settlement`, `client-review-document-assets`, `account-chat-history`, `usage-history`, `generation-result`, `durable-jobs`, `scope-matrix`, `credit-wallets`, `plan-payment-refunds`, `paying-workspace-publication` and `locked-content`. `crm-mail-boundaries` refuses to run unless it is on a disposable database (environment reason).
- **Real local stack (`scripts/check-account-rights-local-stack.cjs`):** 3/3 against API 127.0.0.1:55615. It runs the real `jobs.ts` code with the auth admin API, storage and RPCs, using fictional accounts that it removes afterwards. It covers:
  - the export ZIP holds the owner's files, including nested folders, and none of the other workspace's files;
  - the signed link lives 120 s;
  - expiry removes the part and stops the link;
  - deletion waits out the grace period, then removes the sign-in and the files, leaves the other account's file, retains a pseudonymized `credit_ledger` copy, and does not run again.
- **Mounted browser (`scripts/check-account-rights-browser.cjs`):** 8/8 in each of Chromium, Firefox and WebKit. It covers:
  - the fallback when the features are off;
  - export request, progress, two parts, download on click and the one-a-day limit;
  - expired and failed exports;
  - blockers with links;
  - the full deletion flow, including explanation, warnings, typed email, keyboard-operable consent, fresh-sign-in retry with the same key, the scheduled notice, focus management and cancel;
  - a started or manual-review deletion that cannot be cancelled;
  - signed out;
  - 375 and 320 px with no overflow and touch-size controls.

  `scripts/check-trust-copy-browser.cjs` was updated for the new Settings section (6/6).
- `tsc` clean, full `eslint` clean, and `next build --webpack` exit 0; the five new routes build as dynamic functions. `npm test` passes 188/188; the first run was 187/188 until `check-asset-storage` was updated for the export's scoped read and its single link.

## Local-stack note

While re-applying this migration during development, a cleanup script on the local journey-audit stack accidentally dropped the existing `public.makeborne_account_revoked_period(uuid)`, because its name matched a pattern. It was restored from `20261020090000` with the same owner and grants, and `check-plan-payment-refunds.sql` passes again. Nothing else outside this migration was touched. No other stack was used.
