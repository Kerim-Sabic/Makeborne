# Release runbook: deploy, verify, restore, roll back

This runbook covers the release that adds the CRM split, plan credits, credit expiry and AI spending limits. It is **not approved yet**. These blockers stay open:

**Current-candidate notice (2026-10-13):** the historical tables and appended rehearsal reports below are not a frozen release manifest. The checkout has later publication, namespace, worker and document changes. Use the newly frozen exact inventory and `RELEASE_CHECKLIST.md` gates; use `STAGING_HOSTING_ISOLATION.md` for the two exact QA routes. Recovery builds must retain current SQL contracts and saved document readers, including authored compositions and chapter `opening`.

- full application staging and recovery qualification (database rehearsal passed; see below);
- subscription-replacement verification;
- payment verification;
- the hosting-domain prerequisites (`docs/HOSTING_DOMAIN.md`).

Every SQL step below runs as the **database owner**. A migration never enables spending limits.

## Mandatory environment order

Steps 0–4 below are a rehearsal in an isolated staging environment FIRST. They are not permission to change production. The previous heading order was ambiguous; this gate takes precedence.

1. Obtain the read-only production inventory using `supabase/release-review/production-baseline.sql`. An absent object is evidence, not an instruction to create it. Compare migration IDs AND schema fingerprints; IDs alone cannot establish absence of drift.
2. Reconstruct the verified baseline in a disposable database with synthetic representative data, including open holds and published sites. Do not use the already-upgraded local database as the baseline. Do not copy customer content or live secrets into staging.
3. Rehearse the complete migration sequence, owner-set test limits, candidate app, acceptance checklist and recovery. Use mocked providers and sandbox billing only. A deployment preview must point exclusively to staging.
4. Review the captured evidence and obtain release approval. Only then schedule the production maintenance window. Preserve backups and a reviewed recovery artifact before any production mutation.
5. Repeat the approved sequence on production. Keep public creation, checkout, cron and plan switching closed until the corresponding acceptance gates pass. A paid smoke test needs separately confirmed remaining budget.

The detailed review checklist and evidence map are in `docs/release-review/review.json`; migration hashes and verified production-applied status are in `docs/release-review/migrations.json`.

### Verified rehearsal — 2026-10-12

- Production: Supabase `rklojnmmsmhwnkbzuidp`, PostgreSQL 17.11, **20 applied migrations**. The earlier progress message saying 21 was a counting error. `20261005113330_founder_waitlist.sql` is pending despite its earlier timestamp.
- Production deployment: `dpl_8NUAKFQ6orzUHcb7sAEPziGHhK9T`, commit `307881c2b2079545870a3c1e0e94b275def3072d`, READY. Read-only CLI metadata and the project dashboard agree.
- Exported production application DDL only (public/private/hosting schemas), no customer rows or credentials. Production has no credit-wallet table and zero hosted-site rows.
- Restored into a separate local PostgreSQL 17.11 container, `makeborne_release_stage_20261012`, database `makeborne_release`, loopback port 55432. Auth/storage scaffolding came from local Supabase; pgcrypto and uuid-ossp were installed in the production-verified `extensions` schema. This is not a cloud staging deployment.
- Applied **all 41 pending migrations unchanged**, in timestamp order. Every migration exited successfully. Source hashes and per-migration results are saved alongside this report.
- **22/22 SQL checks**, **5/5 real-session concurrency checks**, and both real-SQL job/run integration checks passed. External Whop/AI responses were mocked. The pilot-lock check used synthetic locked-budget/user fixtures inside its rollback transaction.
- Two tests assumed enabled free trials. Review-link fixture now explicitly enables them inside its rolled-back transaction; wallet concurrency saves/restores the trial setting and amount in its disposable database.
- Executed the actual CRM contract operator script and the separate freeze/rollback/resume sequence. Final mode: expand, consistent, unfrozen. The CRM checks also exercise synthetic user-stage provenance and repeated cycles.
- Final staging state: zero users, clients, wallets, ledger rows and provider calls; all daily provider limits disabled; free trial off. No production mutations, deployment or paid calls.

**Limit:** application tables were copied as schema only. Billing configuration was synthetic, and existing customer rows were not used. The SQL tests supply synthetic data after upgrade; this is not a populated production-clone migration or browser acceptance test. Auth delivery, real payments, actual hosting, deployment drain, whole-app recovery and cloud export remain separate gates.

**Compatibility finding:** the deployed commit uses the old Claude pilot, not the candidate live builder. After these migrations, its service-role permission to `makeborne_claim_claude_pilot` is revoked. Database-first rollout therefore interrupts old generation. A CRM rollback does not restore that permission, and must not be presented as a complete app rollback. Keep the release on hold until cutover and recovery are qualified.

### Extended local rehearsal — 2026-10-12

- A second, separate container restored the same production application DDL and seeded a synthetic user, workspace, Meeting-stage client with notes, project, version, static publication and completed pilot-cost record **before** the 41 migrations. All migrations passed. `check-populated-upgrade.sql` verifies preservation, disabled spending/trial, revoked old dispatch, and exact stage provenance through contract/rollback. These are representative fixtures, not customer data.
- `pause_legacy_pilot.sql` was executed locally before migration. It preserves reserved cents, commits a zero pilot limit, then refuses to proceed while any run remains reserved. The deployed claim function locks this same budget row. A direct administrator claim after pause is denied without adding a run or changing the retained 75-cent fixture reservation.
- `MAKEBORNE_RELEASE_MAINTENANCE=on` adds a candidate/recovery-build API barrier. It runs before session work, blocks API reads and writes (including billing checkout, GitHub callbacks and cron), and returns no-store 503 + Retry-After. The two exact billing POST webhook paths continue through signature verification; they are never acknowledged by the maintenance barrier. Public pages and sign-in provider discovery remain available. Unknown nonempty settings fail closed.
- Real local production-build HTTP checks: 9 normal-mode boundary checks passed; 16 maintenance API requests were blocked; unsigned webhook requests reached their verifier and were refused. Normal public response caching was preserved after fixing an overly broad session-proxy match.
- Actual Chromium exports: light/dark 6×9 book PDFs and a two-slide PDF/PPTX passed; overflow and invalid/foreign artwork were refused. This does not prove the serverless Chromium bundle on Vercel.
- Actual customer-site Worker with a local HTTP RPC bridge and real anonymous-role SQL passed document serving, CSP, HEAD, ETag/304, missing-site 404, forbidden POST, legacy redirect and no visitor-cookie forwarding. Cloudflare DNS/TLS/cache and the existing legacy host deployment remain unverified.
- Local harnesses deliberately strip saved provider credentials and point to loopback only. No live AI, Whop purchase, email, production write or deployment occurred.

### Concrete cutover and recovery sequence (prepared, not authorized to execute)

1. Re-check the production SHA and schema against this evidence. If either changed, stop and repeat the relevant rehearsal. Preserve a verified backup and exact source/build/configuration manifest. An uncommitted working directory is not a release artifact.
2. For **the verified old SHA only**, capture the receipt and run `supabase/post-deploy/pause_legacy_pilot.sql` during an approved window. This changes production, so it has **not** been run there. Keep old `reserved_cents` unchanged. If the script reports reserved runs, leave the pause in place and drain/reconcile each; do not proceed by deleting them or reopening the budget. Other deployed worker versions need their own stop verification.
3. Apply the reviewed migration set with creation checkout, trial, cron and candidate provider limits closed. The current old generation route will now be unavailable by design. Communicate the maintenance window. CRM remains in expand mode; do not contract yet.
4. Cut over to the reviewed candidate with `MAKEBORNE_RELEASE_MAINTENANCE=on`, retaining the new database and accounting contracts. Verify unsigned webhook rejection, signed billing reconciliation, ownership and environment isolation. Do not reopen checkout merely because the home page responds.
5. On release approval, remove the maintenance setting through the chosen deployment/configuration mechanism and enable only the reviewed limits and features. An environment change is not assumed to affect already-running deployments. Repeat signed-in acceptance checks. Contract CRM only after old callers are retired and checks pass.
6. **If a candidate check fails:** keep maintenance on, public checkout/cron off, provider scopes disabled, and current SQL guards installed. Serve a previously qualified build that retains these contracts, or the current candidate in maintenance while preparing a forward fix. Signed webhook handling must stay compatible and idempotent. This is safe degraded service, not a promise of full functionality during recovery.
7. Re-run accounting/conservation, entitlement, publication and CRM checks before reopening. Never restore the previous Vercel app automatically or restore a stale database over payments/usage recorded since the backup. A database restore requires a separate reconciliation plan.

**Before-migration abort only:** after reconciling all old pilot runs, an operator may restore the exact limit from the pause receipt while preserving reserved cents. **After migration:** do not restore legacy dispatch grants or limits to make the old code run; use the compatible recovery build.

### Candidate rehearsal — 2026-10-13

`node scripts/rehearse-candidate.mjs makeborne_candidate_20261013` rebuilds the production baseline (platform schema, production DDL, the 20 production versions, populated fixture) in a fresh disposable container per scenario. It then applies the 45 candidate migrations as `postgres`:

- **full:** pause the legacy pilot, migrate, 11 rolled-back check suites, no public function lost, CRM contract then rollback, legacy hosting reader still serves;
- **fault:** `select 1/0` injected before the commit of `20261012120000`; the database is unchanged, and a clean re-run reaches the same fingerprint;
- **interrupt:** stop after `20261012110000` (the legacy site is still served), then resume.

All three end at fingerprint `1fe043ede88d1bafc19ec3fea7803f4a`. Evidence: `docs/release-review/candidate-rehearsal.json`. Containers are stopped, not removed; the main local database is untouched.

### Remaining external release gates

- Signed-in staging signup/verification/login, project editing and export through a complete isolated Auth/Storage stack; real delivery-provider verification separately.
- Real Whop sandbox renewal, replacement/proration, cancellation, duplicate/out-of-order delivery and annual allocation evidence. The `whop-events` route intentionally refuses creation fulfillment; confirm the connected endpoint and merchant configuration before launch. Do not enable it or redirect it based only on mocks.
- Cloudflare legacy and isolated host deployment, DNS/TLS and recovery behavior; actual Vercel export runtime. The user has prohibited deployment, so these cannot be marked passed by this local rehearsal.
- Immutable release/recovery artifacts, production ingress/drain observation, pricing/trial decisions and explicit release approval.

## 0. Before the window

1. **Production baseline.** Record:
   - `select version from supabase_migrations.schema_migrations order by version;`
   - `select count(*), sum(balance), sum(reserved) from makeborne_private.credit_wallets;`
   - the open holds (`credit_reservations` where `status = 'reserved'`);
   - `generation_execution_caps`: `vendor_limit`, `vendor_spent`, `vendor_reserved` and `enabled` per scope.

   The release reconciles against this baseline.
2. **Durable test budgets are cumulative.**
   - `generation_execution_caps.vendor_limit` and `vendor_spent` are lifetime totals, not a daily or fresh allowance.
   - Example: the local database shows a limit of 25,000,000 µ$ with 2,173,444 µ$ already spent, so only 22,826,556 µ$ remain.
   - Read `vendor_spent` before choosing any new cap. Raising the limit adds headroom only above what has already been spent.
3. **Choose daily provider limits** (micro-USD per UTC day):
   - one for `global`;
   - one for each provider in use: `anthropic`, plus `openai` if images are on;
   - for the durable jobs' providers only if those jobs run.

   Limits apply to everyone, administrators included.

## 1. Apply migrations (in filename order)

| Migration | Effect | Check right after |
|---|---|---|
| `20261011170000`–`20261011200000` | free tier off by default; CRM split in `expand` mode | `select makeborne_private.crm_transition_report();` shows `mode: expand`, `consistent: true` |
| `20261012090000`–`20261012110000` | plan credit allocations, evidence and job tables (reconcile job stays disabled) | none |
| `20261012120000`, `20261012130000` | credit lots and expiry: existing balances become audited legacy lots, and the migration aborts if any wallet doesn't reconcile | `select * from makeborne_private.credit_lot_migration;` shows before = after for every wallet |
| `20261012140000`, `20261012150000` | live provider-spend gate (**disabled**), run outcomes, durable dispatch on the shared gate | `select public.makeborne_provider_spend_status('anthropic');` returns `{"available": false, "reason": "paused"}` |
| `20261012160000`, `20261012170000` | portable site documents (`isolated_html` added; existing `html` untouched). Sites published by the unreleased interactive app keep their document as the isolated copy and are flagged `needs_portable_republish` | `select slug from public.hosted_sites where needs_portable_republish;` lists sites to republish once (expected: none in production, where that app never ran). Existing links still serve |
| `20261012175901` | one open creation checkout per account (PBC01/PBC02) | none |
| `20261012184407`, `20261012210033` | website enquiries (off per site) and editable addresses with retired-address reservations | none |
| `20261013090000` | release-review fixes: enquiries refused when the owner can no longer host; at most 10 addresses per website | none |

`20261005113330_founder_waitlist.sql` (empty) predates production's last version `20261007110318`, so the approved explicit-target command needs `--include-all`. This table is a historical subset, not the complete current migration order. Follow the newly frozen inventory, explicitly targeted dry run and verified failure handling in `docs/RELEASE_CHECKLIST.md` section D; never use a bare push through the checkout's production link.

**Candidate-app behavior after migration `20261012150000`, until step 2:** its integrated AI paths fail closed:
- live builds and plans return `AI_PAUSED` (503) before any credit hold exists;
- durable dispatches are refused (`MB423`).

Do steps 1 and 2 in the same window.

This does NOT stop an older live-builder deployment that calls the provider without the new gate. Before applying these migrations, close generation ingress for every deployment and pause workers using a mechanism independently verified against that deployed version. Drain in-flight work and reconcile open holds. Disabling the new database limits alone is insufficient. If a verified ingress stop is unavailable, the production migration is blocked.

## 2. Configure spending limits (required before generation works)

```sql
select makeborne_private.set_live_provider_limit('global',    true, <daily µ$>, false, '<ticket: reason>');
select makeborne_private.set_live_provider_limit('anthropic', true, <daily µ$>, false, '<ticket: reason>');
select makeborne_private.set_live_provider_limit('openai',    true, <daily µ$>, false, '<ticket: reason>');  -- only if image generation is on
-- Durable jobs only, per provider in use: deepseek, qwen_hosted, self_hosted, media_worker.
select public.makeborne_provider_spend_health();   -- every enabled scope shows enabled, not stopped, with the intended limit
select public.makeborne_provider_spend_status('anthropic');   -- {"available": true, "reason": null}
```

- **Durable jobs** must also have `generation_execution_caps` enabled. Those caps are cumulative (see 0.2); the daily limits apply on top.
- **Who can change limits:** only the database owner can call `set_live_provider_limit`. The service role and browsers cannot, and the app never does.

## 3. Deploy the app

1. Deploy, then run the CRM steps 2–3 in `docs/CRM_STAGE_TRANSITION.md`.
2. Keep these off until reviewed: the plan-credit reconcile cron (`MAKEBORNE_BILLING_RECONCILE_ENABLED`), the free tier, and public plan switching.
3. Keep existing publishing addresses: leave the hosting-domain variables unset until `docs/HOSTING_DOMAIN.md` is complete.

## 4. Verify the isolated staging rehearsal before production approval

**Staging** (verified schema baseline, synthetic data, no production provider keys):

1. **Limits disabled** (right after step 1):
   - a build returns 503 `AI_PAUSED`;
   - `credit_reservations` gains no row;
   - `live_provider_calls` gains no row.
2. **Rolled-back checks:** run them against staging. They commit nothing.
   - `check-live-ai-spend.sql`
   - `check-credit-lots-expiry.sql`
   - `check-credit-wallets.sql`
   - `check-generation-caps.sql`
3. **Limits enabled** (after step 2, small daily limits):
   - `makeborne_provider_spend_status` reports available;
   - health shows the limits.
4. **One live smoke test, only with the owner's approval** (it is a paid call): one Plan-mode request at `light` effort. Then:
   - `ai_run_outcomes` has one `settled` row;
   - `live_provider_calls` has a `settled` row with `actual_microusd ≤ bound_microusd`;
   - the ledger sum equals the available balance.
5. **Exhaustion:** set the daily limit to 1 µ$. The next build returns 503 `AI_DAILY_LIMIT`, with no hold and no call. Then restore the limit.

**Production after release approval:** repeat the accepted procedure and production-safe checks. Do not run fixture-writing SQL harnesses against production, even if they roll back. A paid smoke test needs explicit approval.

## 5. Restore service safely

| Symptom | Cause (check `makeborne_provider_spend_health()`) | Action |
|---|---|---|
| `AI_PAUSED` for everyone | a scope is disabled, or `stopped` after an overrun | Find the overrun: `select * from makeborne_private.live_provider_calls where overrun order by created_at desc;`. Reconcile it against the invoice and fix the price card if needed. Then `set_live_provider_limit(scope, true, <limit>, true, '<review note>')`. The 4th argument clears the stop. Never clear a stop without that review. |
| `AI_DAILY_LIMIT` | today's spend + reservations reached the limit | Wait for UTC midnight, or raise the limit with a note. Check `uncertainTodayMicrousd` first: unknown-usage calls count at their bound. |
| `AI_UNAVAILABLE` | the gate RPC failed, or the model is unpriced or unsupported | Check database health and logs (`ai_spend_stop` events). An unpriced model means the configuration is wrong: fix `MAKEBORNE_BUILDER_MODEL` or the verified price card. |
| `staleOpenCalls > 0` | processes died mid-call | Run `select public.makeborne_provider_calls_expire(500);`. The reconcile job also runs it. Each stale call is charged at its bound once. |
| an invoice shows a different cost for an uncertain or expired call | usage was unknown | `select makeborne_private.reconcile_provider_call('<call id>', <actual µ$>, '<invoice reference>');`. It runs once; the reservation is never released twice. |

Operator limit changes do not authorize extra customer charges. Work that never started must create no hold or release it. For work already started, inspect the run's settlement outcome: confirmed usage can be charged within its authorized hold; uncertain usage and any excess require separate accounting. Do not promise that every stopped run is free.

## 6. Recovery and rollback gate

An instant rollback to the old application is NOT approved. The actual old production pilot loses its dispatch permission after upgrade; intermediate live-builder versions may also lack the daily gate. Old credit and publishing callers have not been fully qualified against the new database. CRM compatibility alone does not establish whole-release compatibility.

1. Close generation and mutation ingress with the verified deployment-level maintenance control; pause workers and reconciliation dispatch. Disable provider scopes as an additional stop for integrated paths. Allow or reconcile already-started work; do not erase reservations or provider-spend evidence.
2. Keep all spending, authorization and expiry triggers installed. Do not remove guard triggers to restore service.
3. Prefer a reviewed forward fix, or a previously rehearsed recovery build that retains the new accounting, spending and publishing contracts. Keep generation closed until that build passes checks.
4. If an older UI must be restored, qualify its API calls in staging against the upgraded schema first. Apply the CRM rollback separately when required. Verify that credit writes, membership evidence, site publishing and daily limits remain correct before reopening any affected route.
5. Database restore is a separate incident procedure, not an automatic reverse migration. Require a restorable backup, recovery-time decision and reconciliation of payments, credits, publications and provider calls since the backup. Never discard new ledger history to make the old code run.
6. Hosting-mode fallback can preserve the portable page body but canonical URLs and asset completeness need separate verification. All `needs_portable_republish` rows must be resolved or explicitly excluded before promising legacy-host recovery.

Resume only after wallet/hold conservation, entitlement uniqueness, provider-spend accounting and hosted-site checks pass. Record the operator, configuration, artifact hashes and remaining limitations.

## 7. Monitoring

- `makeborne_provider_spend_health()`: alert on any stopped scope, on `staleOpenCalls`, on `overrunsToday`, and when spend exceeds 80% of a daily limit.
- `makeborne_billing_job_health()`: alert when `overdue`.
- `ai_run_outcomes`: alert on `missing_hold` and `released_hold` outcomes, and on a rising absorbed total.

### Auth, storage and billing delivery rehearsal — 2026-10-12

A third isolated environment, `makeborne-release-auth`, runs real Supabase Auth, PostgREST, Storage and local Mailpit. API 55435 and database 55438 are loopback only. It restores the same application baseline and 41 pending migrations; platform configuration and storage policies come from the repository, not the production Auth configuration. The runner strips saved provider credentials before starting the app.

Eight actual browser/HTTP checks passed: signup, branded confirmation email in the local inbox, scanner-safe confirmation GET followed by explicit confirmation, unpaid creation denial without a credit grant, workspace/client/project updates, private storage boundaries, authenticated saved book PDF and deck PDF/PPTX exports, and fresh password sign-in. These checks use generated synthetic users and clean them afterwards. No external email, payment or AI request was sent. This does not qualify production SMTP, OAuth, or Vercel's runtime.

A payment delivery bug was fixed locally: a known-plan membership with a missing checkout binding or mismatched plan now fails with a retryable 503 rather than acknowledging and discarding the event. Offline handler tests cover retries after grant failure, duplicate receipt prevention, current cancellation state for delayed events, and merchant isolation. Real Whop lifecycle verification remains open.

The executed offline suite passes 74/74; typecheck, targeted lint and production build pass. Two time-boxed tariff qualification harnesses are skipped by the existing runner and must be refreshed before enabling paid generation. See `auth-staging-results.json`, `auth-staging-browser.log`, and `offline-auth-billing.log` under `docs/release-review/`.

Whop supports a separate sandbox with test cards: https://docs.whop.com/developer/guides/sandbox . The currently signed-in sandbox account shows hilarafghan and an Intera business. Ownership must be confirmed before creating a Makeborne test business or credentials. No sandbox product, production setting, purchase or deployment was changed in this review.

### Real Whop sandbox lifecycle — 2026-10-12

Fake-card checkout succeeded for sandbox plan `plan_00mHHGVMtYzRL`: payment `pay_cONPleFVVW16yo` is paid, membership `mem_qghwLUAqqHkFCM` was active. Period-end cancellation kept it active with cancellation scheduled; immediate cancellation then made it canceled. The test subscription is left canceled. No real payment method or money was used.

The new key's default API version returned incompatible membership fields. Both app request helpers now explicitly pin `Api-Version-Date: 2025-01-01`, supported by Whop's versioning documentation and verified using the actual sandbox membership. The real response passes our existing schema and access decisions for all three states. Ten reconciliation tests and targeted lint pass. This does not verify app checkout binding, credit delivery, webhook delivery, annual renewal, replacements, or refunds. See `whop-sandbox-lifecycle.json`.

Sandbox integration preparation: the checkout configuration now permits an explicitly opted-in sandbox merchant only against the isolated loopback Supabase stack, rejects Vercel/cloud-database use, validates sandbox checkout URLs separately from live URLs, and returns to the sandbox Whop home (Whop rejects HTTP return URLs). Regression checks and typecheck pass. A webhook-only local relay on port 3051 rejects other routes, methods and missing signature headers (five checks pass); cryptographic verification remains in the actual app handler. The owner subsequently authorized the temporary tunnel and sandbox signing secret; see the completed integration evidence below.


### Signed sandbox billing integration — 2026-10-12

Real account-bound monthly and annual purchases completed with fake Visa 4242 in Makeborne sandbox only. Membership activation and payment success arrived with real Whop signatures through the webhook-only tunnel and returned 200. Monthly purchase granted 300 credits once; annual purchase granted only allocation 1 (300 credits), not a year of credits. Four concurrent/reordered duplicate deliveries added no credits. Cancel-at-period-end retained access; immediate cancellation removed access. An old activation payload, re-signed locally with a fresh timestamp, could not restore canceled access or add credits. Tampered signature was rejected with 400 and a correctly signed wrong-merchant event with 403.

The actual authenticated reconciliation HTTP job refreshed both memberships from Whop and completed without additional grants; an unauthenticated request returned 401. The real isolated SQL allocation and expiry suites passed. These SQL clock-controlled scenarios are NOT a real subsequent Whop charge. The offline suite passed 75/75 executed harnesses; five environment/qualification harnesses remain skipped.

Fixes from the live contract: both provider helpers pin Api-Version-Date 2025-01-01; pinned checkout responses use company_id (not account_id); sandbox returns require HTTPS and must not enter production. Sandbox configuration is accepted only with an explicit local opt-in and the isolated Supabase URL. Sanitized membership fixtures and a checkout route regression now cover those contracts.

OPEN: real subsequent renewal, upgrade/downgrade/proration and replacement policy. The customer portal exposes payment changes, transfer and cancellation, but no plan switch. Merchant Update subscription exposes renewal price only. Cancel monthly then buy annual produces a DIFFERENT membership and a separate initial allowance; this is a new purchase, not evidence of an in-place switch. Do not enable or advertise seamless plan switching. No documented sandbox time-advance mechanism was found. Refund/dispute lifecycle remains unverified with real notifications.

See docs/release-review/whop-credit-delivery.json. No production, deployment, committed changes, real-money purchase or paid AI call occurred.

Cleanup confirmed: the sandbox webhook is Disabled, the tunnel/relay/test app are stopped, ports 3048/3051 are closed, both bound test subscriptions are canceled, and the isolated billing switch was restored. Review fixtures remain in the isolated DB. Sandbox credentials remain in ignored local configuration; the API key expires October 19.


### Hosted enquiries and updated staging rehearsal — 2026-10-12

The cloud staging database has now applied 43 pending migrations, including
`20261012184407_hosted_site_enquiries.sql`. The five rolled-back cloud checks
for allocation, expiry, CRM, spending and hosting pass. This supersedes earlier
migration counts in the historical entries above; production remains unchanged.

The actual local publish API, customer Worker, signed enquiry gateway and SQL
inbox pass six integration groups. Eight concurrent submissions admit exactly
five; anonymous and unrelated users cannot read messages. Enquiries are off by
default. See `WEBSITE_ENQUIRIES.md` for secrets, enablement and recovery. Existing
demo forms are not automatically connected. Email forwarding is not implemented.

The recovery HTTP check now blocks 18 method/route combinations, including the
new enquiry endpoint. Unsigned webhooks still reach their verifier and fail.
The public home stays available. The production build compiles; 75 offline
harnesses pass, with the runner's five documented exclusions still applying.

Cloud app rehearsal is pending: the connected Vercel account currently exposes
only amuo's projects, not Makeborne's owning team. No deployment was created.
Actual subsequent Whop renewal and replacement lifecycle, public customer-domain
TLS, image qualification, and the final complete release-candidate failure
rehearsal remain release gates. Do not merge or deploy based on these partial
checks. No paid AI calls occurred during this enquiry implementation.


### Isolated Vercel staging — 2026-10-12

Created separate project makeborne-release-staging in kerimsabic-6594s-projects.
Preview settings use only xzwikrunwpurxnxgkznh. Paid generation, creation checkout,
reconciliation and optional support checkout are disabled. No provider or live
Whop keys were copied. Deployment Protection stays enabled; no custom domain
was assigned. The Vercel CLI uses its authenticated access for HTTP checks.

The first snapshot omitted two imported toolchain manifests; corrected before
qualification. Vercel then exposed a real export failure: playwright-core's
browsers.json was omitted. next.config.ts now explicitly traces Playwright and
Chromium runtime resources for both export endpoints. The fixed preview exported
the full 44-page 6x9 book, 10-slide deck PDF, and editable PPTX with a native chart.

The schema-only clone did not contain Storage configuration. Created the private
project-assets bucket with the existing repository MIME/size policy, then applied
its two existing storage policies to staging. Owner upload/download and anonymous
read denial passed. No production storage or account was touched.

Cloud password auth, unpaid creation refusal, workspace and saved-document writes
passed. Browser password sign-in reached the expected membership gate. This uses
preconfirmed synthetic accounts and does NOT test cloud email delivery or OAuth.
Temporary fixtures are removed by the test. See cloud-app-results.json,
cloud-browser-login.json, cloud-deployment.json and staging-source-manifest.json.

Remaining: cloud email/OAuth, browser uploads through the full app UI, customer
domain DNS/TLS and public publishing, actual provider renewal/replacement, AI
image qualification, and full final-candidate migration failure/recovery.
Production makeborne.com still resolves to dpl_8NUAKFQ6orzUHcb7sAEPziGHhK9T.
No production rollout, commit, push or paid AI call occurred.

Final staging preview dpl_BNSsYnER7N2CCRgyhVsxdihbiiF8 is READY. All eight cloud HTTP checks pass, including disabled support checkout, full-document exports and private storage. Offline suite remains 75/75. This is partial staging qualification, not release approval.


### Additional cloud qualification � 2026-10-12

The protected preview now passes 10 cloud integration groups. Added real anonymous
review comments, changes requested, approval, project delivery transitions, link
revocation, and optimistic version-conflict rejection. These use disposable
staging accounts and saved documents, with no provider calls.

Four separate confirmation checks pass against real cloud Auth: GET leaves the
signup token unused, explicit POST confirms the account, external destinations
are reduced to a local path, and replay is rejected. The confirmed user can sign
in. This does **not** establish SMTP delivery or Google/GitHub OAuth readiness.
See cloud-confirmation-results.json and cloud-app-results.json.

Rechecked all 43 staging migration hashes and reran allocation, expiry, CRM,
provider-spend and hosting SQL suites successfully. No synthetic Auth users remain.
The local recovery build again blocks all 18 tested API method/route combinations;
unsigned billing events reach signature verification and fail, and home stays up.
This is not yet an injected partial-migration failure/recovery rehearsal against
an immutable final candidate.

No new application deployment, production change, commit, merge, or paid AI call
was made in this continuation. Conservative cumulative budget remains $23.865144
of $25; $1.134856 is unspent. Paid AI stays paused.

Release remains blocked by: actual subsequent provider renewal/replacement
qualification; staging email delivery and OAuth; public customer hosting DNS/TLS;
OpenAI image qualification (key unavailable); full browser upload flow; final
candidate fault-injection recovery and the final approved rollout inventory.


### Browser uploads and mailbox � 2026-10-12

Staging preview dpl_8erkRDkv6E9QyDe8L9cQVUnPtXXc enables artwork uploads by
explicit setting only. Replaced the blanket production-mode denial with an
opt-in that defaults off on hosted apps. Browser upload, saving, reopening and
raster decoding passed. Invalid raster input is refused. Route and client cap
uploads at 4 MiB, below Vercel's function body limit. Full production storage
quota qualification remains separate. PDF prompt attachment works on-device;
that is not evidence of cloud document ingestion. Typecheck and targeted lint pass.

Created admin@makeborne.com after owner password entry. Spacemail Pro trial is
30 days with owner-approved $0.98/month renewal. Root MX/SPF now point to
Spacemail; the existing send.makeborne.com Resend CNAME remains. Mailbox creation
and DNS are verified; actual test-message delivery is still unverified. No
production app deployment, database change, commit or paid AI call occurred.

The existing customer static host has valid HTTPS and rejects missing slugs
with 404 and script/form-disabled CSP. That does not qualify interactive sites
or forms. A separate registrable customer domain and staging SMTP/OAuth
credentials are still required. See cloud-upload-browser-results.json.


### Email, OAuth and editable addresses — 2026-10-12

Staging now has a separate domain-restricted sending-only Resend key and
separate Google/GitHub sign-in credentials. Three authorized signup emails
were sent while qualifying the template. The final received email has only
the branded template, and its intentional confirmation action passed. Both
Google and GitHub sign-in returned to the membership gate; SQL confirms both
identities on the owner staging account. GitHub requested read-only email,
no repository permissions. The owner OAuth account is retained. Disposable
signup and publication fixtures were removed.

New migration 20261012210033_hosted_site_address_changes.sql is applied only
on isolated local and cloud staging; staging now has 44 pending migrations
above the verified production baseline. New publication RPC v4 permits owner
republishing under a new address, retaining old slug reservations so another
project cannot take an old link. Any downstream refusal rolls the rename back.
The old address stops resolving; this feature does not provide redirects.
Reservations cascade only when the hosted project itself is removed.
SQL tests cover rename, retry, stale revision, invalid document rollback, old
writer collision, unrelated owner and permissions. Real cloud routes passed
publication, renamed canonical URLs and stale-update refusal.

Current publication preview: dpl_BkXTCdaWtVUVABBNvP18QD4SYfa4, READY. Build
caught a UTF-8 encoding issue in the changed publishing component; corrected
and remote build passed. Authentication was qualified on the preceding
poymmdz0z preview; its exact callback and Site URL remain configured there.
Update that allowlist before using a different preview for authentication.

Production app, production database, git merge/commit and paid AI spending
remain unchanged. Buying and connecting a separate customer domain is still
required before public interactive hosting and forms are qualified. The release
rehearsal must include this new migration; prior inventories are now historical.
See staging-account-qualification.json and cloud-address-changes.json.
