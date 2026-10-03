# Makeborne cloud verification

## Unified Studio creation — 2026-10-04

Migration `20261003224557_unified_project_creation.sql` is applied locally and to the linked Makeborne project. The authenticated `/api/cloud/workspaces/[workspaceId]/studio-projects` endpoint creates the project, artifact, and initial saved version in one database transaction. It preserves effort and custom style snapshots. The existing request receipt system rejects changed payloads on retry and returns the original records for identical retries.

`supabase/check-unified-creation.sql` passes both locally and on the linked project: 14 checks cover saved effort/palette, the initial version, identical retries, altered retry rejection, invalid-version rollback, mismatched content, invalid effort, outsider replay denial, and reviewer write denial. Fixtures roll back. Production build, TypeScript, focused ESLint, and diff whitespace checks pass. Linked security advisors still report only the previously documented leaked-password-protection warning.

This verifies the database operation and compiled API integration, not the complete browser creation flow. The main creation wizard is not yet connected to this endpoint; account editor autosave and existing account project access are separate completed steps. Signed-in browser verification remains outstanding.

The separately guarded `supabase/check-cloud-fixtures.mjs` accepts only `https://rklojnmmsmhwnkbzuidp.supabase.co`. It requires `MAKEBORNE_VERIFY_CLOUD_FIXTURES=true` and `MAKEBORNE_CLOUD_KEYS_FILE` pointing to private revealed CLI API-key JSON outside the repository. Never print or commit that file. The original local runner remains restricted to its local endpoint.

Creates unique, confirmed test accounts through admin auth (no signup email), then authenticates them normally. Workspace/project creation uses authenticated RPCs. It never deletes existing data, resets the database, or enables paid integrations. Test users, workspaces and immutable artifacts remain for inspection. Requests refuse redirects. Credentials are not logged.

## 2026-10-03 findings

Two initial runs passed authentication, tenant reads, anonymous denial, reviewer/cross-workspace write denial, and idempotent concurrent artifact creation. The concurrent revision loser timed out at both 15 and 30 seconds. This is not a passing suite.

The original function deliberately raises SQLSTATE `40001` for a stale revision. [Supabase documents that this triggers infinite automatic retries in PostgREST 14](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b). Local PostgREST did not exhibit the failure. A deterministic revision conflict must use `PT409`, returning HTTP 409 without retry. The verifier now requires that exact response; it cannot mistake a timeout for an accepted rejection.

After migration `20261003213957_revision_conflict_http409`, cloud run `3e42c21f-e81f-423b-8caa-e3e09bf6d46b` passed all 25 core checks, storage upload/read/tenant/overwrite controls, and revocation of database and uncached storage reads. The conflict response is now HTTP 409 with PT409. An intermediate run encountered a network connection timeout, which is not counted as a passing run. Network errors are now reported without raw exception output.

**Storage cache limitation:** with the SDK's default upload cache duration, the same previously downloaded authenticated URL continued returning bytes immediately after membership revocation. A fresh `cacheNonce` with `cache: "no-store"` was denied using the same session, proving current origin authorization was removed. This suite does not prove immediate invalidation of cached URLs or retract already delivered files. Production sensitive-asset delivery must define and verify an appropriate cache lifetime/invalidation policy; do not advertise instantaneous revocation of downloaded/cached content.

Recommended protected-media implementation: upload with `cacheControl: "0"`, perform fresh authenticated reads with `cache: "no-store"` and a fresh cache nonce, and verify that complete delivery path before release. This recommendation has not yet been implemented or validated as an application media flow; previously cached objects also need an explicit invalidation strategy.

Local regression run `adbfea66-c1c8-406c-ba93-6f56e40bd81a` also passed after the conflict-code migration, including its stricter same-URL storage revocation check. No application environment was changed by cloud verification. Browser auth, production deployment, generation, billing, publishing and full release-gate acceptance remain separate checks. Current advisor results are maintained in `CLOUD_PROJECT_SETUP.md`; this verification does not claim all advisor findings are resolved.
# Cloud outreach extension

Client list loading now projects only outreach stage and follow-up date. Full history is loaded through an authenticated, tenant-scoped client GET when opening details/outreach. Pending loads are invalidated on workspace changes and logout. Local fixture run `39a2fbfc-e878-4ec5-b1be-e0c58431989f` verified the actual PostgREST projection using 100 conversation entries: list response omitted history and was more than 20 times smaller, detail retained all entries, and another tenant received no record. Existing 25 isolation checks and storage/revocation checks also passed in that run. This does not substitute for signed-in browser verification.

Migration `20261003221220_client_outreach.sql` applied to local Makeborne and linked cloud project `rklojnmmsmhwnkbzuidp`. It adds optional outreach data to existing clients without changing tenant policies. Owner/editor update grants are constrained to the new column; reviewers retain read access only. The private validation trigger has no direct anonymous/authenticated execute grant and preserves existing history.

`supabase/check-client-outreach.sql` passes locally and via linked cloud query: 15 assertions cover owner/editor writes, reviewer reads and denied writes, cross-tenant isolation, stale revision rejection, invalid stages/dates/credential URLs, and append-only history. The script rolls back its fixtures in a subtransaction, including on failure. No messages or emails are sent.

Production build and TypeScript pass. Security advisors report no local issues and only the previously known cloud Auth leaked-password-protection warning. Signed-in browser verification of the new cloud panel remains pending; the inspected app browser session was signed out. Local outreach is not automatically uploaded; explicit project import excludes it and says so.


## Main Studio wizard connected — 2026-10-04

The existing creation modal now resolves the account destination and account clients before accepting a save. Signed-in creation calls the atomic endpoint, opens the returned artifact in the main Studio, and retains an identical request body for uncertain retries. New accounts provision their first workspace through the existing idempotent endpoint. Signed-out creation retains the explicitly labelled device draft flow. Account clients are fetched through all pages; device client IDs cannot be silently attached or uploaded. Pending account creation requests are visible and recoverable from Projects after closing the wizard.

Browser verification on localhost with an existing signed-in session: created `QA account creation — main Studio`, opened version 1 with supplied text, edited the paragraph, observed version 2, reloaded the page, reopened the account card, and confirmed the changed paragraph and both history entries. No generation was invoked. This proves that create/edit/autosave/reload path; simulated network interruption and concurrent browser editing remain unverified in the browser.

Eight creation payload checks, 15 autosave checks, 22 editor bridge checks, TypeScript and the production build pass. Focused ESLint reports no errors; two pre-existing image optimization warnings remain in studio.tsx. Homepage/login/signup redesign also inspected on desktop and 390px mobile, including signup mode and footer layout. Authentication submission logic is unchanged; the redesigned signup submission has not created another account.
