# Production publishing integration — 21 October 2026

## Decision

**Staging qualification passes. Production activation and paid launch remain on hold.**

Application/SQL candidate: `764ce5faa40784d10f70610101be434d77c1abe7`, branch `release/combined-rehearsal-20261020`, draft PR #12. Source worktrees and Claude's feature histories are preserved. Remote `main` remains `d14bf303165806ab2544299c3e1b63f923a5c9ea`. No production database, service, environment, Worker, checkout, DNS, deployment or main merge was changed.

The subsequent documentation/example checkpoint does not enable a feature. The production profile was not tested against production credentials or production data.

## Implemented

- Integrated the previously separate production-profile slice from `work/trusted-publication-production-20261019`; that original dirty worktree was not modified or committed by this integration.
- Controller profiles pin the database project/host, Vercel team/project and image namespace, broker origin and output bucket. Mixed profiles and ambient/admin credentials are refused. Production rejects staging bypass credentials.
- Production requires an explicit workspace allowlist in controller, broker and the owner-managed private database table. Missing, duplicate, malformed or mismatched scope fails closed. Rollout drift stops discovery while cleanup remains possible.
- Namespace-aware source transport rechecks current fenced authority before and after storage reads. The application keeps its privileged Storage key; generated code and the controller never receive it.
- Added migration `20261019134828_trusted_publication_production_profile.sql`, pinned to LF. It creates no login, password, enabled rollout entry or activation switch.
- Retained the prior browser font/artwork parity fix, Stop/recovery, billing work and both input branch histories.
- Corrected stale supervisor/broker documentation and documented `MAKEBORNE_PUBLICATION_WORKSPACE_IDS` in the configuration example.

## Exact local and remote gates

| Gate | Result |
|---|---|
| TypeScript / full ESLint | Pass |
| Offline harnesses | 157/157 pass; five existing interactive/tariff exclusions remain explicit |
| Clean Next.js production build | Pass |
| Controller | 8 startup + 6 profile/rollout + 3 actual installed SDK contract groups pass |
| Private source transport | 18 groups pass, including the actual production route with mocked SQL/Storage |
| Full 102-migration SQL chain | 63/66 suites pass, three documented environment skips, zero failures |
| Normal / injected failure / terminated connection replay | Identical schema, ACLs, policies and billing flags |
| Diff pattern secret scan | 223 changed paths, zero findings; pattern scan is not a complete secret guarantee |
| GitHub push and PR checks | Both pass at 764ce5f; runs 39510005374 and 39510008870 |
| Default Vercel preview check | Pass; used only as CI evidence, not as the isolated staging test target |

Recovery fingerprint: `fbb677475e43db9511699484e3ca6cdc7de6e8b6950a47bcc35f103a2b155da0`.

SQL skips: `check-crm-mail-upgrade.sql`, `check-mail-granted-scopes-upgrade.sql` (their historical mid-chain upgrade tests), and `check-local-pilot-lock.sql` (a particular developer fixture). The runner restored the clean 94-migration baseline and applied all eight additions; every suite used a fresh dropped copy. The main local database was not used for fixtures.

The first cached webpack build failed inside WasmHash. Its cache was moved aside within the workspace, the unchanged source built successfully from a clean cache, and the failure log was retained. Initial controller SDK checking needed its already-installed locked dependency tree. The first renderer registry upload timed out; the resumable retry completed before any test VM started. A readback assertion initially looked for network policy on Session; the installed SDK exposes it on Sandbox. The corrected read-only check passed. These were not hidden application fixes.

## Isolated staging

Target Supabase: `xzwikrunwpurxnxgkznh`. Only the new production-profile migration was applied. Existing raw migration hashes matched, existing billing settings were identical before/after, and advisors stayed at **11 WARNs with byte-equivalent findings and no new warnings**.

Target Vercel: `makeborne-release-staging`, deployment `dpl_HGzbvEFfYoYbG4KPP6ez6SMUrFZ8`, preview:
https://makeborne-release-staging-ke7c45yj1-kerimsabic-6594s-projects.vercel.app

Only the staging QA alias was moved to that preview. Actual staged sign-in, paginated title search, workspace/account isolation, Stop/reload/settlement, website/book/deck create/save/replay/conflict, PDF/PPTX export, anonymous review/comment/approval/revocation and phone billing pass, with zero page errors or provider builds. This used admin-exempt disposable fixtures and previous genuine model output; it is not a public signup-email, new image-generation or paid-customer billing claim.

## Actual supervised cloud publishing

- Installed controller image `sha256:61c006fcc01d5839bd7971c345503d7c8d220b7d08dec92490bb996a6f27456c` on the existing approved host. The test-only wrapper pins the staging project, three VM creations, 1 CPU, bounded deadlines, deny-all networking and no mounts/ports/environment injection. It contains no credential.
- Actual restricted SQL startup/namespace attestation passed against the updated staging database. Temporary login had only the publication-worker membership.
- Actual compiler plus two renderer VMs built both declared routes from source version 3 in one attempt/fence. Immutable compiler/renderer digests are unchanged from the previously qualified runtime images.
- Reviewed retained output and promoted it through the actual approval/publication API. Fictional QA site `release-check-renamed.makeborne.site` is retained at revision **5**.
- Both routes pass at 1440px and 375px: public HTTP 200, expected staging noindex, original images/font, visible entrance animation, no horizontal overflow, functional phone menu and zero page errors. Main text, headings and fonts match the retained preview.
- Actual phone form → Worker gateway → correct staging artifact inbox → CRM lead/activity passes. Test enquiry/client were deleted; disposable app accounts/workspaces are absent.
- Independent provider readback confirms exactly three VMs, one session each, all stopped, with Sandbox-reported `deny-all` policy. This is provider policy readback; the earlier directly observed egress experiment remains separate evidence. No new egress-attempt experiment or restart/failure matrix is claimed for this exact bundle.
- Staging controller stopped/disabled, temporary host configuration/override removed, staging gateway token removed, two registry repositories deleted, local private Docker auth removed, and temporary SQL login disabled/expired. Production controller remains inactive. Output objects and the fictional QA publication are deliberately retained. Journal rows remain durable; do not equate a `cleanup_finished` field with provider stop evidence.

The new production-profile denial, drift and scope checks are local/SQL tests. Earlier crash/ambiguous-create/stale-fence/storage fault evidence is documented separately; it was not repeated as fresh cloud evidence for this candidate. The 20 MB cloud streaming boundary and production-profile startup remain separate qualifications.

## Billing evidence and remaining boundary

Re-ran the actual reconciliation job with real disposable SQL and mocked Whop: historical catch-up, monthly annual-plan allocations, rollover/expiry, idempotency, issue recovery, overlapping-job refusal and health pass on this chain. Full billing/refund/top-up/authorization SQL suites also pass.

Re-ran the candidate's actual webhook route with live sandbox provider GETs and locally signed replay: invalid signature refused before provider access; missing account binding refuses; retry after inserting an isolated fixture binding using the actual Whop checkout identifier succeeds; duplicates produce one receipt; refunded subscription grants zero. The unbound failed-cycle probe remains refused.

Fresh read-only sandbox scan: 8 memberships and 10 payments. No new sandbox purchase, refund, fresh provider-signed dispatch or real charge was performed. The weekly renewal is due **21 October 00:08:59 UTC / 02:08:59 Warsaw**, later than this report's tests. Its membership has no Makeborne checkout reference: even a successful renewal cannot prove app-bound credit delivery. Keep the scheduled sandbox follow-up, and qualify a genuinely bound provider-signed purchase/renewal path before opening payments. Never invent a binding or treat a weekly test plan as a monthly catalogue plan.

## Budget

Original SAME $5 ledger: **$4.412877 conservatively accounted**, **$0.587123 remaining**, no open reservations. This includes retained worst-case cloud/function bounds and uncertain earlier usage, not an invoice. No new model calls in this continuation. New separate Claude API allowance: **$50 authorized, $0 spent**. Existing host subscription is the previously approved $6/month; no additional subscription was purchased.

## Remaining launch work

1. Combine and qualify Claude's round-2 `feature/lovable-integration` (`dd8aff6`) with this candidate and the remaining billing UX addendum. Its two migrations are not applied to staging; deploy the required scope-boundary code before `20261020203000`, then apply `20261020210000` through the reviewed path.
2. Fresh, genuinely account-bound provider-signed Whop lifecycle and pack delivery evidence. Existing simulations/live GETs do not replace this. Automatic charging and production payment activation remain held.
3. Production-specific publishing setup/activation requires owner approval: dedicated restricted login, production-only bucket/token/images/configuration, broker variables, matching rollout lists and service. Then one actual production golden-site publish/compare/unpublish and rollback smoke. The staged profile integration does not provision these.
4. OpenAI image key and a bounded live qualification are still absent; native Office rendering remains unqualified. Do not enable an unqualified image model or imply editable PPTX XML inspection equals native PowerPoint visual verification.
5. Keep custom-domain/Gmail and other unqualified capabilities honestly gated. Review the final combined candidate, rehearse exact migrations/configuration and request the explicit production go.

## Recovery

Production is unchanged, so no production rollback is needed. Previous staged preview `bqvotkhje` can be re-aliased for app recovery; the new additive rollout migration preserves staging's QA namespace and has no enabled production entries. Restore a previous controller image only with its matching profile/attestation contract; keep the service disabled until checked. Preserve output/journal/migrations and existing published bytes. Never recover by enabling raw browser-output promotion or marking uncertain VMs stopped.

Private receipts/scripts are under ignored `work/lovable-qualification-20261020/` (profile-prefixed files, current combined app receipt, budget and source inventory). Do not copy raw credentials, cookies, provider payloads or access configuration into Git.