# Minimum launch gate 3: ordinary paying-workspace publishing — 25 October 2026

Status: **implemented and tested locally only.** Branch `claude/paying-publish-entitlement`, based on Codex's candidate `release/minimum-launch-20261025` at `700a4e4`. Nothing was pushed, merged or deployed. No staging or production database, environment, controller, flag or provider was touched. No paid AI or infrastructure was used.

**Local checks do not count as cloud qualification.** The staging plan in section 5 is for Codex to run with its existing staging access, and only after review.

## 1. Where publishing is limited today (candidate 700a4e4)

Generated websites are source projects (`websiteSource`), so they go live only through the trusted preparation path: request, then controller compile, then retained output, then promotion. The older outline publisher (`makeborne_save_hosted_site_v4`) refuses source websites (`20261013180000:279-281`).

### Global switches (they apply to every workspace)

| Where | What it guards |
|---|---|
| `src/lib/projects/publication-server.ts:11-15` `trustedPublicationAvailable()` = `MAKEBORNE_TRUSTED_PUBLICATION_ENABLED==="true"` | Every preparation request (`:47`) and `preparationAvailable` in the GET route (`publication/route.ts:34`). It is off on the minimum staging preview and on production. |
| `makeborne_private.billing_settings.creation_enabled` (used by `has_creation_membership_for_actor`, `save_site_v2` and `owner_can_host`) | Every non-administrator publish and **all non-administrator serving**. Production is `false` today (Codex's read-only check). |

### Owner/admin-only scope

**Production workspace allowlist**, in three places that must match exactly:

| Where | What it guards |
|---|---|
| SQL `20261019134828:3-9` `makeborne_private.trusted_publication_workspaces`: empty, RLS on, no role grants | The rollout list. Only the database owner can change it. |
| SQL `20261019134828:13-24` `publication_workspace_allowed()`: production requires an enabled row | Called from `publication_authority` (`:35`), so it covers request, status, latest, claim, load and promote. Also called from `publication_worker_candidates` (`:66`). |
| SQL `20261019134828:106-109` `publication_worker_attest()` | Returns `publication-controller-v2` with the exact enabled list. |
| Controller `infra/publication-controller/config.mjs:21-32` with `profiles.mjs:14-19` | Production schema 2 needs `workspaceAllowlist`: 1–100 UUIDs. |
| Controller `attestation.mjs:24-27` | The database list must equal the configured list at startup and before every discovery. |
| Controller `scope.mjs:7-8` | Every claim and load result must name a listed workspace (`PUBLICATION_WORKSPACE_DENIED`). |
| App broker `src/lib/projects/publication-broker-profile.ts:15-19`, `publication-asset-broker.ts:12-18,53-55` | `MAKEBORNE_PUBLICATION_WORKSPACE_IDS` must be an exact list; source assets for other workspaces are refused. |

**Staging: one QA workspace.** This is by design and this change keeps it.

| Where | What it guards |
|---|---|
| SQL `20261013200000:20-44` `site_address_namespace_policy` and `check_site_address_namespace` | Staging allows only `qa_workspace_id` and the slugs `release-check` / `release-check-renamed`. Production refuses those two slugs. Enforced by triggers on `hosted_sites`, `site_address_reservations` and `publication_preparations`. |
| SQL `20261013200000:79-105` `validate_site_address_namespace_policy` | Re-pointing the QA workspace is refused while release-check rows belong to another workspace, or while incompatible preparations are pending. |
| SQL `20261019134828:20` | Staging scope is `qa_workspace_id` only. |
| App `src/lib/hosting/namespace-server.ts:14-28` | Needs `MAKEBORNE_STAGING_QA_WORKSPACE_ID`, the staging Supabase URL and the allowed labels. |
| Controller `config.mjs:23,32` | Schema 1 has a single `qaWorkspaceId`, and `attestation.mjs:22-23` must match it. |
| Broker `publication-broker-profile.ts:9-13` | Single staging QA workspace. |
| Edge `infra/customer-sites/namespace-policy.js:4,71-83` | Serves the QA labels only in staging. |

**Plan access, which in practice only admins could pass reliably.**

| Where | What it guards |
|---|---|
| App `generation/submission-server.ts:21` → `billing/access.ts:94-99` `requireCreationAccess` | Request and promote, plus the legacy publish at `publication/route.ts:62`. It uses the existing verified path (database first, then a live Whop check). Admins bypass it at `access.ts:30`. |
| SQL `20261020090000:441-454` `has_creation_membership_for_actor` | Admin, **or** all of: `creation_enabled`, an enabled access plan, status `active`/`canceling`, `period_end > now()`, **`verified_until > now()`** and the period not revoked. |
| SQL `20261004162455:33`: CHECK `verified_until <= checked_at + 5 minutes` | A verification is good for five minutes at most. **Defect for non-admins:** `publication_authority` re-runs that strict check on status polling, worker claim, worker load and broker source loads. None of these refresh the verification. A non-admin compile claimed or loaded more than five minutes after the last browser access check failed with `PUBLICATION_AUTHORITY_UNAVAILABLE`. After five minutes, polling the status returned 402 "A verified creation membership is required…". Admins bypass this, which is why owner-only staging passes could not qualify subscribers. |
| SQL `20261013120000:23-77` `save_site_v2` | The atomic writer behind every promotion. It requires the owner and the same strict membership, then applies fair use: **50 new sites per workspace per rolling day** and **1,000 live sites per workspace**. |
| SQL `20261013180000:118` | At most 30 preparations per account per hour. |
| SQL `20261013180000:209-250` | Output limits: 4 MB HTML per route, 8 MB of routes, 128 files, 6 MB of files, 40 images, digests. |

**Other limits:**
- **Ownership:** only the workspace owner can publish. This is enforced in the route (`publication/route.ts:57,118`) and in SQL (`publication_authority`, `save_site_v2`).
- **UI:** there is no admin gate. `trusted-website-publish.tsx:53-61` shows what the server reports.
- **Serving:** `makeborne_hosting.owner_can_host` (`20261011140000:31-41`) allows an admin, **or** an active or canceling membership inside its period while `creation_enabled` is on. It does not check verification freshness or refund revocation.
- **Generation:** `requireSubmissionGate` (`submission-server.ts:62-66`) is admin-only. That is gate 2, and this change does not touch it.

Not involved: `infra/project-runtime/*` and `infra/customer-sites/site-policy.js` contain no workspace or owner gate.

## 2. The change: the smallest safe entitlement

**Rule.** A workspace may publish when its **owner has verified, active plan access**. This is the same predicate that checkout and creation use. Once the database owner opts production into the new `entitled` scope, it applies to every workspace. Until then, nothing about rollout scope changes.

| Case | Result |
|---|---|
| Owner/admin, workspace on the existing list | Unchanged in both scopes. |
| Admin, workspace not on the list | Refused in `allowlist` scope (as today). Allowed in `entitled` scope, because admins are entitled. |
| Verified paying owner | Refused in `allowlist` scope (as today). In `entitled` scope: allowed, with every existing limit. |
| Not paying, refunded, charged back, cancelled after the period, or `creation_enabled` off | Refused, with the honest message "Publishing needs an active Makeborne plan…". |
| Another account, including a paying one | Refused ("Owner required", or not found). |
| Taking a site offline | Always allowed for the owner, with no plan needed (unchanged). |

**Verification freshness.**
- **Request and promote** are user-initiated. They still need the strict check: a provider verification from the last five minutes. The app refreshes it on every such call.
- **Background and read paths** use the new `publication_entitled_for_actor`: status, latest, worker claim, worker and broker load, and candidate discovery. Its predicate:
  - the most recent provider check was **positive** (`verified_until > checked_at`);
  - that check is **no older than 24 hours**, the lifetime of a preparation;
  - plus the plan, period, status, revocation and `creation_enabled` conditions above.
- A recorded cancellation, refund or end of period still stops background work at once.

**What happens to live sites when access ends.** Serving is unchanged. Nothing is deleted or unpublished automatically.
- `hosted_sites`, the bundle and the routes are kept with `live` unchanged.
- A site is served while `owner_can_host` holds. It stops being served after the period ends, after a cancellation is recorded, or if `creation_enabled` is switched off.
- It is served again automatically if access returns.
- The owner can still take it offline.

These serving choices are owner decisions; see section 6.

**Preserved:**
- staging single-QA namespace strictness: entitled scope is refused unless the namespace is production, and staging always resolves to its QA workspace first;
- the production QA-label reservation;
- the 50/day, 1,000-live and 30/hour limits, and the output size and file limits;
- promotion compare-and-swap, so the last-good output is kept: failed, refused or lapsed promotions never change the live row.

### Files

**SQL** (new migration `supabase/migrations/20261025200000_paying_workspace_publication.sql`):
- **New:** the `makeborne_private.trusted_publication_scope` singleton:
  - default `allowlist`;
  - RLS on, no grants;
  - a guard trigger that refuses `entitled` outside production.
- **New:** `configure_trusted_publication_scope(mode)`. The database owner only, like `configure_site_address_namespace`.
- **New:** `publication_entitled_for_actor(actor)`.
- **Redefined:** `publication_workspace_allowed`. An enabled list row still wins. Otherwise, `entitled` scope admits the workspace when its owner is entitled.
- **Redefined:** `publication_authority`. It uses the relaxed predicate, and checks the plan before the scope so a lapsed account hears about its plan.
- **Redefined:** `request_publication_preparation` and `promote_publication_preparation`. Each body is copied verbatim from `20261013180000` plus **one** strict-check line.
- **Redefined:** `makeborne_hosting.save_site_v4`. Copied verbatim plus one line: the live path refuses refunded or charged-back periods for the owner.
- **Redefined:** `publication_worker_attest`. Copied verbatim from `20261019134828`, with the scope table added to the RLS check. Production with entitled scope returns `{contractVersion:'publication-controller-v3', namespace:'production', workspaceScope:'entitled'}`. Allowlist (v2) and staging (v1) are unchanged.
- **Grants:** CREATE OR REPLACE keeps the existing grants. New objects are revoked from `public`, `anon`, `authenticated`, `service_role` and `makeborne_publication_worker`.
- **Rollback:** `supabase/release-review/rollback-paying-workspace-publication.sql`. It is generated from the original definitions, restores them exactly and drops the new objects. Hosted sites and preparations are untouched.

**App** (the files Codex owns for the release):
- `src/lib/projects/publication-server.ts`:
  - `publicationDatabaseError` gives publishing-specific wording for MB402, for 42501 "Trusted publication workspace not enabled" and for MB429 (request vs promote);
  - `publicationWriteContext` and `requirePublishingAccess` map MEMBERSHIP_REQUIRED to `PUBLISHING_PLAN_REQUIRED`;
  - everything else keeps `databaseError`.
- `src/app/api/cloud/workspaces/[workspaceId]/artifacts/[artifactId]/publication/route.ts`:
  - the legacy publish uses `requirePublishingAccess` and the new mapping;
  - **turning customer JavaScript on (PATCH) now needs plan access** (turning it off does not).
- `src/lib/projects/publication-broker-profile.ts`, `src/lib/projects/publication-asset-broker.ts` and `src/app/api/hosting/publication-assets/route.ts`:
  - production-only `MAKEBORNE_PUBLICATION_WORKSPACE_SCOPE=entitled`, which must come with an empty `MAKEBORNE_PUBLICATION_WORKSPACE_IDS`;
  - with it, the broker skips the local list and relies on the load RPC's database authority;
  - all other identity, signature and storage checks are unchanged;
  - staging refuses any non-default scope.
- `.env.example` documents the variable.

**Controller** (Codex-owned: minimal, clearly listed, not activated):
- `infra/publication-controller/config.mjs` accepts production **schema 3** `{workspaceScope:"entitled"}` in place of `workspaceAllowlist`, and exposes `workspaceScope`. Schemas 1 and 2 are unchanged.
- `attestation.mjs`: schema 3 requires exactly the v3 attestation. A v2 list or v1 staging attestation is refused, and so is the reverse.
- `scope.mjs`: in entitled scope, claim and load skip the local list, because the database authority re-runs on every claim and load. Discovery still needs the v3 attestation, so scope drift stops discovery.
- `check-profiles.mjs`: three new groups.

## 3. Tests (all local; commands from the worktree)

| Check | Result |
|---|---|
| `supabase/check-paying-workspace-publication.sql`, new, on the isolated local stack (`supabase_db_makeborne-release-auth`, 127.0.0.1:55438). One transaction, rolled back. | **16/16 PASS** (detail below) |
| Existing SQL suites on the same stack, rolled back. Run before the migration, after it, after the rollback script, and after re-applying. | Each run gave the same result. **Passing:** `check-trusted-publication` 8, `check-publication-production-profile` 4, `check-site-address-namespace` 1, `check-unlimited-sites` 7, `check-publication-worker-authority` 2, `check-site-address-changes` 4, `check-publication-sandbox-journal` 1, and `check-publication-controller-boundary` 2/2 (actual attestation; run with the worker role borrowed inside the rolled-back transaction). **Pre-existing failures, identical before and after:** `check-publication-controller-boundary` without the borrowed role ("permission denied to set role") and `check-hosting-modes` ("Browser changed a hosted site"). The two `rehearsal`-only suites were run with their database-name guard relaxed in the piped copy only. |
| `src/lib/projects/check-publication-entitlement.cjs` (new, offline) | **6/6 PASS** (detail below) |
| `src/lib/projects/check-publication-download.cjs` | **19/19 PASS**, including the new entitled-broker group: needs the exact production identity and no list; mixed or staging configurations, a bogus scope, or a list alongside the scope are refused; it streams only after two load-RPC reauthorizations; a database refusal or a record moved to another workspace reads no bytes. |
| `src/lib/hosting/check-publication-modes.cjs` | 12/12 PASS (unchanged) |
| `infra/publication-controller/check-profiles.mjs` | **9/9 PASS**: 6 existing plus 3 new (schema 3 parse rules, v3 attestation exactness both ways, entitled claims and loads, drift stops discovery). |
| `infra/publication-controller/check.mjs --no-report` | 7 startup groups PASS. The last group needs a built `dist/` and the controller's own `node_modules`, which are not installed in this worktree. That is an environment limitation, the same as on the candidate. `check-sdk-session.mjs` needs `@vercel/sandbox`, which is likewise not installed. |
| `npm test` (all offline harnesses) | **187/187 PASS**; five existing exclusions unchanged |
| `npx tsc --noEmit` | clean |
| ESLint on all changed TS/CJS/MJS files | clean |
| `git diff --check` | clean |

**SQL scenarios.** Each is one PASS line in the new suite:
1. Staging keeps one QA workspace whatever the scope, keeps the v1 attestation, and refuses entitled scope while in staging.
2. Allowlist scope (the state right after the migration): the listed owner workspace prepares, compiles, promotes and is served. Unlisted paying and admin workspaces are refused with "Trusted publication workspace not enabled". A non-paying workspace is refused with MB402. The attestation stays v2 with the exact list.
3. Entitled scope: the attestation is v3. A verified **paying** workspace runs the full cycle: request, claim, load, complete, promote. Both routes are served and the promotion replay is idempotent.
4. Owner/admin workspaces keep publishing in entitled scope.
5. Non-paying, refunded (provider still `active` with a revoked period) and cancelled-after-period accounts are refused (MB402), on both the trusted and the legacy path.
6. Cross-workspace: another paying account cannot request, read, promote, or borrow a session.
7. A lapsed account's existing live site is kept: not deleted, not served, and its bytes are retained. The owner can still take it offline.
8. A compile claimed and loaded **an hour after** the request succeeds. Going live with stale verification is refused, and succeeds after a fresh check (republish).
9. A verification older than 24 hours, or a recorded cancellation, stops claims and status reads.
10. Last good is kept. Three failed compiles, a refused oversize output and a failed promotion all leave the previous site live, at the same revision and serving the same bytes.
11. Fair use: the 51st new site in a day is refused with MB429 and the 1,001st live site with MB429. The preparation stays ready and the site is unchanged.
12. 30 preparations an hour is still enforced.
13. Production still refuses the `release-check` label.
14. The scope table and functions have no app, browser or worker grants, and the existing service grants are preserved.
15. The service role cannot change the scope.

**Offline app scenarios:**
- error mapping;
- a non-paying account gets an honest 402 before any RPC;
- a paying account reaches the authority, and refunded or unlisted responses are reported honestly;
- promotion lapse and fair-use messages say the live site is unchanged;
- the legacy publish needs plan access, but unpublishing does not;
- turning JavaScript on needs plan access, turning it off does not, and editors are refused.

## 4. Migration and local proof

1. Local stack `supabase_db_makeborne-release-auth`: Postgres 17.11 at 127.0.0.1:55438, database `postgres`, production namespace.
   - Before the change it lacked three unrelated later migrations (`20261021125359`, `20261021133151`, `20261023000417`).
   - None of them touches the functions redefined here.
   - No `supabase db push` was used; everything went through `psql` in the container.
2. **Dry run.** The migration with `commit` replaced by `rollback`. All statements succeeded.
3. **Apply** (`begin … commit`). Scope = `allowlist`, namespace = production, enabled list = 0 rows.
4. **The SQL suite found a regression.** In my first save_site_v4 line, the plan check ran before the owner check. That changed the code for a non-owner from 42501 to MB402, and `check-site-address-changes` failed.
   - Fix: the plan check now applies only when the actor owns the workspace.
5. **Rollback rehearsal.**
   - Dry-run of `rollback-paying-workspace-publication.sql`, then the real rollback.
   - The restored `request_publication_preparation`, `promote_publication_preparation` and `publication_worker_attest` definitions hash **identically** to the pre-migration md5s (4eba05bf…, d11489d1…, 0aa22fe8…), and the scope table was gone.
6. **Re-apply** the corrected migration: a fresh dry run, then commit.
   - The new suite and all existing suites were run again with the results above.
   - Every suite rolled back, leaving fixtures 0, scope `allowlist` and namespace production.

The local stack keeps 20261025200000 applied (scope `allowlist`). To remove it there, run the rollback script.

## 5. Staging plan for Codex (prepared, NOT executed)

Purpose: qualify ordinary, non-admin paying-workspace publishing on the real staging stack. **Local SQL and offline checks above are not cloud qualification.**

### Preconditions

Each needs Codex's existing staging access and the owner approvals noted.

1. Review this branch, then apply `20261025200000_paying_workspace_publication.sql` to staging `xzwikrunwpurxnxgkznh` through the reviewed path: dry run in a transaction, then apply.
   - Record raw migration hashes, `billing_settings`, advisors and the namespace policy before and after.
   - Scope stays `allowlist`. Staging ignores scope by design.
   - **Without this migration, expect the five-minute failure** described in section 1 for any compile that is claimed or loaded more than five minutes after the request.
2. **Staging tests the non-admin entitlement path, not the production `entitled` scope.** The staging namespace allows exactly one QA workspace and the two `release-check*` labels. The validator (`20261013200000:79-105`) refuses to re-point the QA workspace while those labels belong to another workspace. To give the seat to a **second, non-admin paying workspace**, pick one:
   - **B1, preferred (needs owner approval to remove retained staging fixture rows):**
     - Export the current QA workspace's `release-check*` rows as a JSON backup: `hosted_sites`, `site_routes`, `hosted_site_files`, `site_address_reservations`.
     - Delete those rows. Deleting `hosted_sites` cascades to routes and files. Check for delete guards first.
     - Make sure no queued, running or ready preparation exists outside the new seat.
     - As the database owner: `select makeborne_private.configure_site_address_namespace('staging','<fixture workspace>')`.
     - Set staging `MAKEBORNE_STAGING_QA_WORKSPACE_ID` and the controller `qaWorkspaceId` to the same UUID.
     - Restore all three afterwards (cleanup step 2).
   - **B3, fallback (no deletion, but not a second workspace):** only if the current QA workspace owner is a disposable fixture and not the owner's real account.
     - Temporarily remove that account's `account_privileges` admin row.
     - Give it the sandbox subscription in step 3.
     - Restore the row afterwards.
   - **Rejected: transferring workspace ownership.** `hosted_sites.owner_id`, workspace membership roles and the serving join (`w.owner_id = s.owner_id`) are bound to the original owner, and nothing re-syncs them.
3. **Fixture.**
   - One fresh, confirmed, **non-admin** staging account, created the same way as Codex's six purchase fixtures. Make sure it has no `account_privileges` row.
   - One sandbox subscription bought at Create $20/month with fake 4242, after action-time terms approval as before.
   - Verify `billing_memberships`: active, enabled plan, positive `verified_until`, with `creation_enabled=true` on staging.
4. **Owner approval of a compute allowance** for the actual compiler and renderer VMs (about three VMs per publish attempt; a minimum of four publishes and one failing compile below). Also:
   - restart the existing approved controller host with a temporary restricted SQL login;
   - set staging preview `MAKEBORNE_TRUSTED_PUBLICATION_ENABLED=true` and the broker variables for this test only.

### Steps

Use the exact candidate deployment and capture evidence at each step.

| # | Action | Expect | Evidence |
|---|---|---|---|
| 1 | Run controller startup attestation | v1 staging plus the QA UUID | sanitized controller event log |
| 2 | As the fixture: a source site with **2 routes** (`/`, `/about`), **one uploaded image** (exercises broker source load), a **contact form**; save; prepare at `release-check` | queued → ready, one attempt | preparation id/state/attempts/fence; `billing_memberships.checked_at`/`verified_until` at request, claim and complete |
| 3 | **Wait more than 5 minutes** before reviewing; keep polling the status | Status stays readable (no 402) | UI screenshot and network log of the status polls |
| 4 | Review the preview, then promote | live revision n+1 | promotion result; `hosted_sites` revision |
| 5 | Check HTTPS at `https://release-check.makeborne.site/` and `/about` | 200; valid TLS; staging noindex; image, fonts, routes | `curl -sv` (certificate issuer/expiry, headers); sha256 of served HTML vs retained `output_hash`; 1440 px and 375 px screenshots, no page errors |
| 6 | Submit the form on a phone | Worker gateway → this workspace's inbox → CRM lead | lead/activity row ids |
| 7 | **Republish** with a text edit | Revision +1; new text served; still 1 new-site event | before/after revision; `site_publication_events` count |
| 8 | **Failure keeps last good:** save a version with a build error (for example a syntax error in `src/App.tsx`) and prepare | 3 attempts → `failed`; UI says the live site is unchanged; served bytes identical | preparation row; HTTP hash identical to step 7 |
| 9 | **Unpublish**, then publish again | Offline: not served (404). Republish: served again | HTTP status both times; revision |
| 10 | **Honest refusals** | No VM started for any refusal | message text and code; controller log shows no claim |
|    | – a second confirmed **non-paying** account in its own workspace tries to prepare | 402 "Publishing needs an active Makeborne plan…" | |
|    | – any account other than the QA seat tries `release-check` | refused by namespace (staging strictness unchanged) | |
| 11 | **Lapsed access:** cancel the fixture's sandbox membership immediately (or refund + cancel) through the sandbox API as in the six-purchase run; let the webhook or reconcile record it | New prepare refused, honest 402. Existing site **not served** while retained (`live=true` row, bytes kept). Owner can still unpublish | billing rows; HTTP status; `hosted_sites` row |
| 12 | Optional: a refund **without** cancellation | Under the current rule the site stays served until period end or cancellation (owner decision 2) | as step 11 |
| 13 | Spend readback | Exact VM count, all stopped, deny-all policy | provider readback; actual cost against the allowance |

### Cleanup

1. Unpublish the fixture site, or leave the fictional QA site as the owner prefers.
2. Undo the seat change:
   - **B1:** restore the namespace policy, `MAKEBORNE_STAGING_QA_WORKSPACE_ID` and the controller `qaWorkspaceId`, then re-insert the backed-up QA rows.
   - **B3:** restore the admin row.
3. Refund or cancel any remaining sandbox membership.
4. Ban the fixtures, revoke their sessions and refresh tokens, and delete local passwords and cookies.
5. Stop the controller. Disable or expire the temporary SQL login. Set `MAKEBORNE_TRUSTED_PUBLICATION_ENABLED` back to false on the preview.
6. Remove the broker secrets for this test.
7. Keep the R2 objects or delete them, as the owner decides.
8. Record the budget.
9. Do not disturb the November renewal probes.

### Separately (production; owner-gated)

Activation order. Stop discovery first.
1. Apply the migration. Scope stays `allowlist`, so nothing changes.
2. Prepare controller schema 3 `{"workspaceScope":"entitled"}`. It takes the place of `workspaceAllowlist`; every other field stays the same.
3. Set app `MAKEBORNE_PUBLICATION_WORKSPACE_SCOPE=entitled` and clear `MAKEBORNE_PUBLICATION_WORKSPACE_IDS`.
4. As the database owner: `select makeborne_private.configure_trusted_publication_scope('entitled')`.
5. Start the controller.
6. Run a disposable production publish/unpublish smoke.

Rollback:
1. `configure_trusted_publication_scope('allowlist')`. Non-listed workspaces are refused by the database at once, and the controller's v3 attestation then fails, which stops discovery.
2. Restore controller schema 2 and the app list.
3. If needed, run the rollback script.

## 6. Open owner decisions

1. **Live sites after access ends.** Today they stop being served at period end or a recorded cancellation; they are not deleted or unpublished, and resume if access returns.
   - **Recommendation:** keep this for launch, with clear copy.
   - Optional later change: a grace period, for example 14 days of serving after a lapse. That is a small `owner_can_host` change.
2. **Refunds while the provider membership stays active.** `owner_can_host` ignores refund revocation, so the site stays served until cancellation or period end. New publishes are already refused. Decide whether a refund should stop serving immediately (a small `owner_can_host` change). The six-purchase flow pairs refunds with immediate cancellation, so in practice serving stops.
3. **`creation_enabled` is also the serving switch.** Turning it off takes **every paying customer's site offline** (admins excepted). Production has it off today, so it must be on for paid publishing. Do not use it as a generation emergency stop; use the provider limits instead.
4. **Background verification window of 24 hours.** It matches the preparation lifetime. Recorded cancellations, refunds and the end of a period still apply immediately.
5. **Publishing compute cost and capacity for all subscribers.**
   - Today's limits are 30 preparations an hour per account (up to 720 compiles a day per account) and 50 new sites a day per workspace.
   - There is a single controller on the $6 host.
   - Decide on a per-account daily compile cap, a global daily budget, or both, before opening this to everyone.
6. **UI.** The publish panel still offers "prepare" to workspaces that cannot publish; they get the honest message only after clicking. Optional follow-up: report plan state in the GET route and show "Choose a plan" upfront.
7. **Staging seat:** B1 (back up, remove and later restore the retained fictional QA rows, so a second non-admin workspace can take the seat) or B3 (temporarily demote a disposable QA owner account).

## 7. Exact files for Codex to review and merge

- `supabase/migrations/20261025200000_paying_workspace_publication.sql` (new)
- `supabase/check-paying-workspace-publication.sql` (new)
- `supabase/release-review/rollback-paying-workspace-publication.sql` (new)
- `src/lib/projects/publication-server.ts`
- `src/app/api/cloud/workspaces/[workspaceId]/artifacts/[artifactId]/publication/route.ts`
- `src/lib/projects/publication-broker-profile.ts`
- `src/lib/projects/publication-asset-broker.ts`
- `src/app/api/hosting/publication-assets/route.ts`
- `src/lib/projects/check-publication-entitlement.cjs` (new)
- `src/lib/projects/check-publication-download.cjs` (one new group)
- `.env.example`
- Controller (Codex-owned): `infra/publication-controller/config.mjs`, `attestation.mjs`, `scope.mjs`, `check-profiles.mjs`
- This document

Code commit: `ed1a0ac`. `npm test`: **187/187** offline harnesses pass (the candidate had 186; the new one is `check-publication-entitlement.cjs`). The five existing exclusions are unchanged.
