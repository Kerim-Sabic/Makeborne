# Launch preparation — 28 October 2026

Status: local candidate qualified; cloud staging and the owner activation gates remain open. This document is not permission to activate production.

## Candidate and targets

The reviewed app is Claude's `3c39cab`, plus Codex repair `52d1ce9` on `release/launch-preparation-20261028`. New preparation scripts do not change the app runtime. Claude subsequently added operational commit `d47f570`; its three files were integrated as `c5cc9e5`, then corrected locally as described below. Nothing was pushed or deployed.

Production is `origin/main` `09e394f1c2bd52524f50c8a82d435e77a5d60fff`. The live Vercel project is **makeborne / prj_UzMAuCP7X4yeBP6FrUFCDlJ5GWHh**, team **team_viiayqU1BnwJBdEqgHdgmtnA**. The primary checkout's old `makeborne-app` Vercel link does not own makeborne.com. Always name the actual project explicitly.

Production Supabase: `rklojnmmsmhwnkbzuidp`. Staging: `xzwikrunwpurxnxgkznh`, Vercel `prj_c9h8fuyEmVAT8F3NHFMvzFR1BnLc`. Only read-only production management calls were used.

The later countdown commit targets **29 October 00:30 UTC / 01:30 CET**. The older runbook's 20:00 UTC time is historical. A countdown never authorizes opening checkout. Choose the confirmation cutoff from the actual approved activation instant, not a stale schedule.

## Completed and independently checked

- Docker Engine 28.3.2 starts and stays available. The crash was a stale `dockerInference` runtime socket. Only Docker's local `run` directory was renamed, retaining `run.stale-20261028-221608`. No factory reset, prune, volume deletion, VHD change or WSL unregister was used.
- Both `supabase_db_makeborne-journey-audit` and `makeborne-apps-pg` pass `pg_isready` and real `SELECT 1`. A fresh cached Postgres container also ran with networking disabled. Claude can use the journey API on localhost:55615 / DB 55618, and apps Postgres on 127.0.0.1:55432. Coordinate before resetting shared fixtures.
- Run `node scripts/verify-local-docker.mjs` for a repeatable read-only readiness check. Docker's existing AutoStart=false was left unchanged; this is not a claim that it will start at Windows login.
- 231/231 offline harnesses pass. Typecheck passes. Full ESLint has zero errors and one existing `catImage` warning. Optimized webpack build passes. Some runner checks require a running server, interactive browser fixture, or renewed tariff qualification and remain explicitly skipped; 231 does not mean every live journey passed.
- Diff secret scan found zero known private values or high-confidence credential formats. Masked credentials cannot be checked by value. The final file count is recorded in the handoff after the final documentation scan.
- Full, injected-failure and interrupted local migration rehearsals pass on the candidate chain. Nine intentional failures leave the transaction unchanged, then recover to the same schema fingerprint. Fingerprinting now includes the private `makeborne_rpc` boundary. All three containers stop after the drill.
- Corrected the purchase-confirmation SQL fixtures to follow real constraints: historical canceled membership before a second checkout; an actual credit lot for a funded top-up. No production guard or trigger was weakened.
- Reproduced an expired mail worker settling a newer claim against real SQL. Forward migration `20261028213151_transactional_mail_delivery_fencing.sql` fixes it: matching attempt, active lease, terminal idempotency, stale result refusal, service-only invoker wrapper. Automatic retries end after 23 hours, before Resend's 24-hour deduplication window. Legacy unfenced settlement fails closed.
- The app validates a claim before sending and only reports sent after durable database acknowledgement. Eight confirmation test groups, fulfilment integration checks, and three real SQL fencing PASS groups cover this behavior.

## Migration preparation

See `launch-preparation-manifest-20261028.json`: **16 exact pending production files**, with committed-byte SHA-256 hashes, after 109 applied versions. None of those 109 applied migration files was edited.

Staging has 108 tracked applications plus an imported original baseline. Its initial preflight correctly stopped on six historical GitHub migrations absent from this launch branch. All six were traced to immutable Git sources and their exact LF/CRLF byte hashes. Their identities are recorded in `staging-historical-github-migrations-20261028.json`; they are not additions to the production release.

`scripts/prepare-launch-staging-20261028.mjs` is staging-only and dry-run by default. It refuses unknown history, changed SQL, unexpected pending files, security errors, or a changed warning baseline. It accepts exactly three reviewed pending files: waitlist, purchase confirmations, mail fencing. Schema SQL and the history hash commit in the same transaction. Applied history is never rewritten to resolve Windows line endings.

The staging-specific historical schema has now passed full, injected-failure and interrupted recovery in disposable containers. Reproduce it with `node scripts/rehearse-staging-overlay-20261028.mjs makeborne_candidate_YYYYMMDD`. Its sources come from the pinned Git commits, not production credentials. The first adapter run correctly failed its final inventory because that comparison omitted the six historical files. It was retained as invalid evidence; the corrected complete rerun passes with stable inputs and inventory.

**All three migrations are applied to staging only**, with their history hashes committed atomically. Read-back verifies 111 tracked applications and no remaining candidate migration. Security remains **11 WARN / 0 ERROR**, no new actionable findings. Four new INFO notices describe the new private tables' deny-all RLS; direct privilege checks prove anon, authenticated and service_role have no table DML access, and both private schemas remain outside the API's exposed list. No permissive policies were added to silence informational notices. Evidence: `staging-overlay-rehearsal-20261028.json` and `staging-verification-20261028.json`.

Fresh production read-back remains **9 WARN / 0 ERROR**, creation disabled and every provider gate disabled. This is today's read-only baseline, not the older staging warning count. The nine production offers all read back with the approved USD prices, monthly/yearly periods or one-time type, no trial and hidden visibility. The provider returns stock=null/unlimited_stock=false; this alone does not independently prove a public checkout cannot charge. Its `collect_tax:true / inclusive` mismatch still needs resolution. See `production-plans-readback-20261028.json`.

## Remaining gates before production

1. **Vercel Pro:** live team freshly reads Hobby. Owner must upgrade before commercial use. No subscription was purchased. Published Pro starting price is $20/month plus tax/usage. See https://vercel.com/pricing and https://vercel.com/docs/limits/fair-use-guidelines . Confirm Supabase plan/backups separately; today's plan was not independently verified.
2. **Real transactional email:** at the initial 28 October preflight neither app environment had `RESEND_API_KEY`. **29 October update:** the owner signed in and approved a new sending-only, domain-restricted staging key. Four actual messages are confirmed Delivered; real SQL outbox, idempotency and retry checks pass. The staging Preview secret is prepared with automatic sending off. Production still needs a separate approved key, and the exact cloud checkout-to-email test remains open. See `confirmation-emails-20261029.md`. No old exposed/revoked key is reused.
3. **Production environment:** `WHOP_COMPANY_ID` is missing; prepare `biz_CV9cZg1zFX3h7f`. Whop and provider secrets exist but are masked by the environment export and are not thereby verified. Never redeploy literal `[SENSITIVE]` placeholders. Reuse settings server-side or set actual authorized values privately.
4. **Exact cloud staging:** deploy the frozen repaired candidate with qualified credentials; prove automatic signed webhook, subscriber/pack delivery, confirmation and withdrawal emails, reconciliation and alerts, refund handling and cleanup. Earlier ordinary-subscriber generation evidence does not clear the newer confirmation pipeline. The retired fixture's financial refund reconciliation remains unverified because its old cron secret returned 401.
5. **Consumer checkout:** resolve Whop's hosted final-button wording, seller-managed-tax dashboard/API mismatch, reused provider checkout purchase risk, and direct-store purchases that lack Makeborne account binding. Do not bind purchases by email or claim these are fixed by offline tests. Keep checkout closed until qualified.
6. **Publishing:** recheck the actual production controller credentials, entitlement scope and golden-site publish/unpublish flow within a reserved compute allowance. Do not infer hosted output works from a successful app build.
7. **Final owner GO:** verified production backup and restore instructions, exact 16-file dry-run, security baseline, scoped environment delta, normal PR, deployment, smoke, and 30-minute watch. Real-card checkout is the owner's action. November renewal probes remain untouched.

## Review and repair of Claude's later operational commit d47f570

The original helper omitted the mail fencing migration, defaulted certificate verification off, offered a production `--rehearse` that writes and locks live objects despite rollback, and did not fail its process after individual rehearsal-check failures. The integrated repair includes all 16 migrations, refuses production rehearsal before connecting, always verifies TLS, and checks the exact current baseline against the prepared manifest. Actual application requires the exact committed HEAD's GO value, a clean tracked tree and a fresh, restore-verified backup file with a matching SHA-256. Concurrent apply sessions are fenced by an advisory lock. Neither production apply nor a production write rehearsal was run.

The backup manifest must be private JSON with `projectRef`, `createdAt`, `restoreVerified: true`, `dumpPath` and `sha256`. This is evidence from a real backup/restore drill, not permission to invent a marker. Set `MAKEBORNE_PRODUCTION_BACKUP_MANIFEST` to that private file and `MAKEBORNE_RELEASE_GO_SHA` only after the owner approves the exact committed release. Dry-run is read-only. If the ledger changes or a partial rollout occurs, stop and review a new delta rather than bypassing the guard.

The original go-live SQL described $30/day global/Anthropic and $10/day OpenAI as approved. It now prepares **$10/day global and Anthropic, OpenAI off**, uses the audited limit-setting function, and refuses execution without an explicit session GO plus the fencing migration. Its rollback preserves existing paid memberships. Negative guards and the successful activation path were tested only in a disposable database with **network=none**; no provider call or production setting changed. Existing trusted-publishing state is pre-existing and must be assessed, not silently toggled.

## Rollout and recovery order

Keep checkout and transactional mail off through additive database application and app deployment. The old five-argument mail settlement now refuses unfenced results; do not leave an older mail sender running. Only the repaired app can consume the new claim/result contract. After delivery tests, enable transactional mail and the actual confirmation cutoff, then open only the qualified sales/provider settings after final GO.

If the app is reverted, stop transactional mail first. Keep the additive migration, retain ambiguous pending mail for operator review, and do not reopen retries outside the deduplication window. Revert app through a normal PR; roll the site Worker/controller back separately if they changed. Stop AI with the global provider emergency stop, not `billing_settings.creation_enabled=false`, which also affects customer hosting. Do not blanket-disable existing paid plan access as an AI shutdown.

## Budget and coordination

This preparation used **$0 new AI calls, $0 paid publishing VMs, and no new subscription**. Prior full-version scope remains settled at $9.331320/$13; no new ledger reservation was taken. Credentials, raw environment pulls and private management responses remain ignored. All findings and ownership were added to the primary `docs/AGENT_HANDOFF.md`; acknowledgement by Claude is not assumed.
