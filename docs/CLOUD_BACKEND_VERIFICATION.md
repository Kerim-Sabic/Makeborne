# Makeborne cloud verification

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

Migration `20261003221220_client_outreach.sql` applied to local Makeborne and linked cloud project `rklojnmmsmhwnkbzuidp`. It adds optional outreach data to existing clients without changing tenant policies. Owner/editor update grants are constrained to the new column; reviewers retain read access only. The private validation trigger has no direct anonymous/authenticated execute grant and preserves existing history.

`supabase/check-client-outreach.sql` passes locally and via linked cloud query: 15 assertions cover owner/editor writes, reviewer reads and denied writes, cross-tenant isolation, stale revision rejection, invalid stages/dates/credential URLs, and append-only history. The script rolls back its fixtures in a subtransaction, including on failure. No messages or emails are sent.

Production build and TypeScript pass. Security advisors report no local issues and only the previously known cloud Auth leaked-password-protection warning. Signed-in browser verification of the new cloud panel remains pending; the inspected app browser session was signed out. Local outreach is not automatically uploaded; explicit project import excludes it and says so.
