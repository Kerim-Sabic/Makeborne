# Launch preparation — 28 October 2026

Status: local candidate qualified; cloud staging and the owner activation gates remain open. This document is not permission to activate production.

## Candidate and targets

The reviewed app is Claude's `3c39cab`, plus Codex repair `52d1ce9` on `release/launch-preparation-20261028`. New preparation scripts do not change the app runtime. Claude subsequently added operational commit `d47f570`; it is reviewed below, not silently included.

Production is `origin/main` `09e394f1c2bd52524f50c8a82d435e77a5d60fff`. The live Vercel project is **makeborne / prj_UzMAuCP7X4yeBP6FrUFCDlJ5GWHh**, team **team_viiayqU1BnwJBdEqgHdgmtnA**. The primary checkout's old `makeborne-app` Vercel link does not own makeborne.com. Always name the actual project explicitly.

Production Supabase: `rklojnmmsmhwnkbzuidp`. Staging: `xzwikrunwpurxnxgkznh`, Vercel `prj_c9h8fuyEmVAT8F3NHFMvzFR1BnLc`. Only read-only production management calls were used.

The later countdown commit targets **29 October 00:30 UTC / 01:30 CET**. The older runbook's 20:00 UTC time is historical. A countdown never authorizes opening checkout. Choose the confirmation cutoff from the actual approved activation instant, not a stale schedule.

## Completed and independently checked

- Docker Engine 28.3.2 starts and stays available. The crash was a stale `dockerInference` runtime socket. Only Docker's local `run` directory was renamed, retaining `run.stale-20261028-221608`. No factory reset, prune, volume deletion, VHD change or WSL unregister was used.
- Both `supabase_db_makeborne-journey-audit` and `makeborne-apps-pg` pass `pg_isready` and real `SELECT 1`. A fresh cached Postgres container also ran with networking disabled. Claude can use the journey API on localhost:55615 / DB 55618, and apps Postgres on 127.0.0.1:55432. Coordinate before resetting shared fixtures.
- Run `node scripts/verify-local-docker.mjs` for a repeatable read-only readiness check. Docker's existing AutoStart=false was left unchanged; this is not a claim that it will start at Windows login.
- 231/231 offline harnesses pass. Typecheck passes. Full ESLint has zero errors and one existing `catImage` warning. Optimized webpack build passes. Some runner checks require a running server, interactive browser fixture, or renewed tariff qualification and remain explicitly skipped; 231 does not mean every live journey passed.
- Diff secret scan: 705 text files, six available known private values, zero findings. Masked credentials cannot be checked by value. Repeat the scan after final documentation changes.
- Full, injected-failure and interrupted local migration rehearsals pass on the candidate chain. Nine intentional failures leave the transaction unchanged, then recover to the same schema fingerprint. Fingerprinting now includes the private `makeborne_rpc` boundary. All three containers stop after the drill.
- Corrected the purchase-confirmation SQL fixtures to follow real constraints: historical canceled membership before a second checkout; an actual credit lot for a funded top-up. No production guard or trigger was weakened.
- Reproduced an expired mail worker settling a newer claim against real SQL. Forward migration `20261028213151_transactional_mail_delivery_fencing.sql` fixes it: matching attempt, active lease, terminal idempotency, stale result refusal, service-only invoker wrapper. Automatic retries end after 23 hours, before Resend's 24-hour deduplication window. Legacy unfenced settlement fails closed.
- The app validates a claim before sending and only reports sent after durable database acknowledgement. Eight confirmation test groups, fulfilment integration checks, and three real SQL fencing PASS groups cover this behavior.

## Migration preparation

See `launch-preparation-manifest-20261028.json`: **16 exact pending production files**, with committed-byte SHA-256 hashes, after 109 applied versions. None of those 109 applied migration files was edited.

Staging has 108 tracked applications plus an imported original baseline. Its initial preflight correctly stopped on six historical GitHub migrations absent from this launch branch. All six were traced to immutable Git sources and their exact LF/CRLF byte hashes. Their identities are recorded in `staging-historical-github-migrations-20261028.json`; they are not additions to the production release.

`scripts/prepare-launch-staging-20261028.mjs` is staging-only and dry-run by default. It refuses unknown history, changed SQL, unexpected pending files, security errors, or a changed warning baseline. It accepts exactly three reviewed pending files: waitlist, purchase confirmations, mail fencing. Schema SQL and the history hash commit in the same transaction. Applied history is never rewritten to resolve Windows line endings.

Before applying, qualify the staging-specific historical schema in disposable containers, then compare security advisors before and after. The first overlay harness completed its database checks but invalidated its own final inventory because the local adapter omitted the six historical files in that comparison. That run is retained as invalid evidence; a corrected full rehearsal is required. Current apply status is recorded separately; do not infer application from this document.

## Remaining gates before production

1. **Vercel Pro:** live team freshly reads Hobby. Owner must upgrade before commercial use. No subscription was purchased. Published Pro starting price is $20/month plus tax/usage. See https://vercel.com/pricing and https://vercel.com/docs/limits/fair-use-guidelines . Confirm Supabase plan/backups separately; today's plan was not independently verified.
2. **Real transactional email:** no `RESEND_API_KEY` exists in either current app environment. Resend browser sign-in is expired. Owner must sign in; qualify a sending-only key and real delivered confirmation/withdrawal acknowledgement before enabling the flag. No old exposed/revoked key is reused.
3. **Production environment:** `WHOP_COMPANY_ID` is missing; prepare `biz_CV9cZg1zFX3h7f`. Whop and provider secrets exist but are masked by the environment export and are not thereby verified. Never redeploy literal `[SENSITIVE]` placeholders. Reuse settings server-side or set actual authorized values privately.
4. **Exact cloud staging:** deploy the frozen repaired candidate with qualified credentials; prove automatic signed webhook, subscriber/pack delivery, confirmation and withdrawal emails, reconciliation and alerts, refund handling and cleanup. Earlier ordinary-subscriber generation evidence does not clear the newer confirmation pipeline. The retired fixture's financial refund reconciliation remains unverified because its old cron secret returned 401.
5. **Consumer checkout:** resolve Whop's hosted final-button wording, seller-managed-tax dashboard/API mismatch, reused provider checkout purchase risk, and direct-store purchases that lack Makeborne account binding. Do not bind purchases by email or claim these are fixed by offline tests. Keep checkout closed until qualified.
6. **Publishing:** recheck the actual production controller credentials, entitlement scope and golden-site publish/unpublish flow within a reserved compute allowance. Do not infer hosted output works from a successful app build.
7. **Final owner GO:** verified production backup and restore instructions, exact 16-file dry-run, security baseline, scoped environment delta, normal PR, deployment, smoke, and 30-minute watch. Real-card checkout is the owner's action. November renewal probes remain untouched.

## Review of Claude's later operational commit d47f570

Do not run its production helper or go-live SQL as currently written. It omits the new mail fencing migration; defaults certificate verification off; offers a production `--rehearse` that writes and locks live objects despite rollback; and individual rehearsal check failures do not produce a failing exit status. Perform mutation rehearsals on isolated copies and require verified TLS and backup evidence.

Its go-live SQL describes $30/day global/Anthropic and $10/day OpenAI as approved. This conversation's explicit launch limit is **$10/day global and Anthropic, OpenAI off**. A separate direct owner decision is needed to raise it. No provider settings were changed. Existing trusted-publishing state is pre-existing and must be assessed, not silently toggled.

## Rollout and recovery order

Keep checkout and transactional mail off through additive database application and app deployment. The old five-argument mail settlement now refuses unfenced results; do not leave an older mail sender running. Only the repaired app can consume the new claim/result contract. After delivery tests, enable transactional mail and the actual confirmation cutoff, then open only the qualified sales/provider settings after final GO.

If the app is reverted, stop transactional mail first. Keep the additive migration, retain ambiguous pending mail for operator review, and do not reopen retries outside the deduplication window. Revert app through a normal PR; roll the site Worker/controller back separately if they changed. Stop AI with the global provider emergency stop, not `billing_settings.creation_enabled=false`, which also affects customer hosting. Do not blanket-disable existing paid plan access as an AI shutdown.

## Budget and coordination

This preparation used **$0 new AI calls, $0 paid publishing VMs, and no new subscription**. Prior full-version scope remains settled at $9.331320/$13; no new ledger reservation was taken. Credentials, raw environment pulls and private management responses remain ignored. All findings and ownership were added to the primary `docs/AGENT_HANDOFF.md`; acknowledgement by Claude is not assumed.
