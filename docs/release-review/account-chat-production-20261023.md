# Cleaner composer and account chat history production release — 23 October 2026

Owner approval: backup, the account-chat migration and deployment of these features, live checks, preserving unqualified-feature switches. This is a narrow release from production main d066f23, not a merge of the broader combined qualification branch. Project-header redesign is a separate Claude implementation brief in docs/CLAUDE_PROJECT_WORKSPACE_CLEANUP_20261023.md.

## Candidate scope
Composer disclosures collapse into Request details, empty brand-kit text is removed, and completed textual chat history syncs through per-account/project database storage. API uses authenticated workspace/project/account gates, immutable IDs, idempotent retry and fifty-message keyset pagination. Migration 20261023000417_account_chat_history.sql is additive. It grants authenticated read/append only and RLS keeps conversations account-private. Historical approvals, receipt/tool data and model context are not restored from transcript rows. Stored text is bounded to 8,000 characters per message. No new env setting or feature activation.

## Baseline and gates
- Read-only production inventory confirms alias makeborne.com, production project prj_UzMAuCP7X4yeBP6FrUFCDlJ5GWHh, main d066f23, 107 migrations and exactly one pending file (account-chat).
- Production security baseline: 9 WARN. Staging baseline: 11 WARN. Compare each against its own baseline.
- Production and staging can_read/can_edit boundary definitions match; staged migration bytes match this narrow candidate.
- Prior combined staging evidence: 9/9 browser/API journeys and SQL/RLS checks. Narrow candidate is independently qualified before production; results appended below.
- Local typecheck/lint/build passed. Full offline and mounted-chat harness results pending at initial draft.

## Recovery
Revert the normal release merge through a PR or restore the prior compatible deployment. Leave the additive table in place; do not restore an old database backup over newer user data. New chat rows stay immutable and older app code ignores them. If a privacy/security defect requires removal, report and use a reviewed targeted forward change, not a broad drop/reset.

## Budget and exclusions
No paid AI calls. A new owner-approved $1 cap covers only the narrow staging preview and HTTP/browser qualification, with $0.50 reserved to each; invoice pending. Existing AI, checkout, auto-charging, images, custom-domain and Gmail settings are not enabled by this release. The previously qualified owner-only publishing configuration is preserved. No wider GitHub import, brief-enhancer, book/gallery or model-routing work is included.
