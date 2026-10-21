# Current window — tested app update, 21 October 2026

Use docs/release-review/tested-app-release-20261021.md for the owner-approved narrowed scope and current94→105 inventory. The historical20-migration/307881c checklist below is archived context, not an executable target. Backups, exact targeting, advisor comparison, maintenance/code-first ordering, disabled unqualified features, smoke and recovery gates still apply. No blanket commercial-launch approval is inferred.

---

# Production release checklist

Prepared 2026-10-13 for candidate `docs/release-review/candidate-inventory.json`.
**The working candidate has changed since that historical inventory. Do not execute this checklist until the final application, Worker, controller and migration inventory is refrozen and rehearsed together.** Current evidence and open gates are in `docs/PROJECT_STATUS.md`.
**Not approved and not executed.** Every production step needs the owner's
explicit approval in an agreed window. `docs/RELEASE_RUNBOOK.md` is the
background; this list is the order of operations. Blocking decisions are in
`docs/RELEASE_DECISIONS.md`.

Commands assume `PROD_DB_URL` holds the production session-pooler URI for the
`postgres` role, entered by the owner in their own shell. Never paste it into
chat, a file or a log.

## Target safety (read first)

- This checkout's Supabase CLI link points at **production** (`rklojnmmsmhwnkbzuidp`). Before the window, run `npx supabase projects list` and confirm which project shows `linked: true`. Outside the window, never run a bare `supabase db push`, `db reset` or `config push`.
- Production SQL in this list always names `$PROD_DB_URL` explicitly. Staging and rehearsal tools cannot reach production:
  - `scripts/apply-staging-migrations.mjs`, `scripts/check-cloud-release-sql.mjs` and `scripts/refresh-staging-worker.mjs` connect by the staging reference and assert it is not production.
  - `scripts/rehearse-candidate.mjs` uses local Docker containers only.
- The customer-site Worker has separate `--env staging` and `--env production` blocks in `infra/customer-sites/wrangler.jsonc`. Always pass `--env`; the top-level environment is local-only.

## A. Go/no-go before the window

- [ ] Every gate in the final review report is PASS. No release while any gate is FAIL or BLOCKED.
- [ ] The candidate tree matches `candidate-inventory.json` (aggregate hash), and is committed and tagged by the owner. An uncommitted tree is not a release artifact.
- [ ] Production is still at 20 migrations, last `20261007110318`, with the schema fingerprint from `production-baseline.json`. If anything differs, stop and re-run `node scripts/rehearse-candidate.mjs <container>`.
- [ ] The deployed app is still `dpl_8NUAKFQ6orzUHcb7sAEPziGHhK9T` (commit `307881c2…`).
- [ ] D1 founding copy is resolved, and D2–D8 are decided or explicitly deferred with the feature off.
- [ ] Owner-required AI images are qualified on the exact candidate before launch. Keep image activation off until a server-only key, currently verified prices, enforceable per-call bounds and a live qualification pass are recorded. A missing key does not authorize reducing launch scope. Never rely on a retired or unqualified default image model.
- [ ] Single user-action cumulative credit authorization is qualified across builds, continuations, reviews and recovery; displayed maxima match server enforcement.
- [ ] Anonymous client review rejects stale displayed versions and exposes no presenter notes, generation prompts or source provenance. Canonical documents and authorized artwork match the version the client approves.
- [ ] Paid entitlements and fair-use limits match enforcement and checkout copy. The current candidate has more migrations than the historical 45-file staging baseline; use a newly verified inventory.
- [ ] Credit-pack payment verification has `payment:dispute:read` on the matching company key. Whop returns `disputes: null` without that permission; do not convert it to an empty list or grant credits from it. Verify a real retrieved payment, bound checkout/account, single credit grant and replay before enabling packs. Sandbox permission proof does not authorize changing the production key.
- [ ] The recovery application reads every document format the candidate can save, including authored compositions and optional chapter `opening`. Test existing and newly written books/decks against that exact recovery build. Earlier strict schemas can reject these fields: retaining the database alone does not establish application rollback compatibility. Never strip saved fields to force an old build to accept them.

## B. Backups

1. Confirm Supabase daily backups and PITR are on for `rklojnmmsmhwnkbzuidp` (Dashboard → Database → Backups). Note the latest restore point.
2. Take a logical dump before any change and store it outside the repo (the repo is public):

```bash
npx supabase db dump --db-url "$PROD_DB_URL" -f prod-pre-release-schema.sql
```

```bash
npx supabase db dump --db-url "$PROD_DB_URL" --data-only -f prod-pre-release-data.sql
```

3. Record the reconciliation baseline (runbook section 0.1): migration versions, wallet totals, open holds and `generation_execution_caps`.
4. Record the current Vercel production deployment ID and its environment variables (names only), plus `npx wrangler deployments list --env production` if the Worker exists.

## C. Freeze ingress (window start)

1. Set `MAKEBORNE_RELEASE_MAINTENANCE=on` on the candidate deployment only. The old deployment has no barrier, so the pilot is paused in SQL instead.
2. Pause the old pilot, then keep its receipt:

```bash
psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -f supabase/post-deploy/pause_legacy_pilot.sql
```

   If it reports reserved runs, stop. Drain and reconcile them; do not delete them.

## D. Migrations (exact frozen candidate order)

The old 45-migration checklist is superseded. The current checkout is **not frozen**. Before this section may execute, regenerate the agreed candidate inventory, prove `--check` passes, and compare every ordered file and raw hash in `candidate-inventory.json` (`migrations.order`) with `candidate-rehearsal.json` (`candidate`). All three rehearsal scenarios must pass against the same inputs and files. No historical count or fingerprint authorizes the current tree.

Applied as `postgres` by `supabase db push`. `20261005113330_founder_waitlist.sql` (empty) is older than production's last version, so `--include-all` is required. Namespace migration56 aborts if either QA label already has an owner or preparation; inspect and resolve that conflict without seizing names before the window.

Use the approved production connection explicitly; do not rely on or change the checkout's implicit project link for these steps. Verify the host/project identity before the dry run.

```bash
npx supabase db push --db-url "$PROD_DB_URL" --include-all --dry-run
```

The dry run must match the newly frozen `migrations.order` exactly, with no missing or extra migration. Record the prior production version set and the expected resulting **set of versions**, not just a count. Review the newer billing, review-version, original artwork, cumulative operation, trusted publication, restricted worker and namespace migrations as part of that same list. The namespace remains `production` in production; never run its staging opt-in there.

```bash
npx supabase db push --db-url "$PROD_DB_URL" --include-all
```

**If a migration fails:** the rehearsed injected transactional failure left no partial file changes. Verify the real transaction outcome, migration history and schema against that evidence rather than assuming every failure behaves identically. Do not edit an applied file in place. Keep maintenance on; only after the cause and any forward repair are reviewed, repeat the explicitly targeted dry run and apply command above. Confirm already-applied files are skipped and the remaining set is exactly expected.

Immediately after:

```sql
select makeborne_private.crm_transition_report();          -- mode expand, consistent true
select * from makeborne_private.credit_lot_migration;      -- before = after for every wallet
select public.makeborne_provider_spend_status('anthropic'); -- {"available": false, "reason": "paused"}
select slug from public.hosted_sites where needs_portable_republish; -- expected: none
select version from supabase_migrations.schema_migrations order by version; -- exact baseline + approved candidate version set
```

## E. Environment variables

**App (Vercel, production):** set before deploying the candidate. Secrets are entered in the Vercel dashboard by the owner.

| Variable | Value at release |
| --- | --- |
| `MAKEBORNE_RELEASE_MAINTENANCE` | `on` until section H passes, then `off` |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | production project |
| `MAKEBORNE_CLOUD_ENABLED`, `MAKEBORNE_CLOUD_MIGRATIONS_VERIFIED` | `true` only after section D checks pass |
| `MAKEBORNE_BILLING_MIGRATIONS_VERIFIED` | `true` after section D |
| `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`, `WHOP_COMPANY_ID`, `WHOP_ACCESS_PLAN_IDS`, `WHOP_PLAN_CREDIT_MAP` | production company and plans; **no** `WHOP_SANDBOX_COMPANY_ID`, `MAKEBORNE_WHOP_SANDBOX` or `WHOP_API_BASE_URL` |
| Whop webhook endpoint (dashboard/API, not an env var) | created with `api_version_date` `2025-01-01` to match the app's pinned requests; events `membership.*`, `payment.*`, `refund.*`, `dispute.*` |
| `WHOP_CREATION_ENABLED` | `false` until D1 is resolved and the founding/standard offer is approved |
| `MAKEBORNE_BILLING_RECONCILE_ENABLED`, `CRON_SECRET` | `false` until section G; secret ≥ 32 characters |
| `ANTHROPIC_API_KEY`, `MAKEBORNE_BUILDER_MODEL` | priced model only (`prices.ts`), else `AI_UNAVAILABLE` |
| `OPENAI_API_KEY`, `MAKEBORNE_IMAGE_MODELS` (or `MAKEBORNE_IMAGE_MODEL`) | unset (images off), or `gpt-image-2.5-flare,gpt-image-2.5-sunburst,gpt-image-2` (D8 changed 2026-10-21) before gpt-image-1 shuts down on 2026-10-23 |
| `MAKEBORNE_FORMS_SIGNING_SECRET` | random ≥ 32 characters; same value as the Worker's `FORMS_SIGNING_SECRET` |
| `NEXT_PUBLIC_MAKEBORNE_SITE_HOSTING`, `..._SITE_URL_TEMPLATE`, `..._SITE_DOMAIN_VERIFIED` | unset (existing addresses), or all three per `HOSTING_DOMAIN.md` after section F |
| `MAKEBORNE_HOSTING_NAMESPACE`, `MAKEBORNE_STAGING_QA_WORKSPACE_ID` | `production`; QA workspace unset |
| `MAKEBORNE_GITHUB_*` | production GitHub App |
| `MAKEBORNE_PREVIEW_ALLOW_LOCALHOST`, `MAKEBORNE_VERIFY_*` | unset or `false` |

**Customer-site Worker (`--env production`):**

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | `https://rklojnmmsmhwnkbzuidp.supabase.co` (in `wrangler.jsonc`) |
| `SITE_NAMESPACE` | `production`; both QA labels remain excluded |
| `SITES_DOMAIN`, `APP_ORIGIN`, `LEGACY_SITES_HOST` | `makeborne.site`, `https://makeborne.com`, `sites.makeborne.com` (in `wrangler.jsonc`) |
| `SUPABASE_PUBLISHABLE_KEY` (secret) | production publishable key only, never the secret key |
| `FORMS_SIGNING_SECRET` (secret) | same as the app's `MAKEBORNE_FORMS_SIGNING_SECRET` |
| `STAGING_VERCEL_OIDC_TOKEN` | **must not exist** (`WEBSITE_ENQUIRIES.md`) |

## F. Hosting cutover (only if the isolated domain ships in this release)

The default needs no hosting change: existing `sites.makeborne.com` addresses keep serving portable copies.

1. Complete and independently verify `STAGING_HOSTING_ISOLATION.md` first. The historical live staging Worker owns the wildcard/apex; local configuration now limits staging to the two exact QA routes. Read the actual route list and verify that cutover occurred: staging must have no wildcard/apex, production must never serve QA labels. Keep the staging Worker for its exact QA routes; do not delete it merely to release the wildcard. Old ordinary staging sites will go offline when those routes are narrowed. Confirm production's migration reserved both names, DNS/TLS and the legacy redirect guard before enabling production customer hosting.

2. Deploy the production Worker only in the approved window. Namespace, cache and legacy redirect guards must match the frozen inventory; the standalone legacy Pages redirect needs its matching reviewed update too:

```bash
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY --env production
```

```bash
npx wrangler secret put FORMS_SIGNING_SECRET --env production
```

```bash
npx wrangler deploy --env production
```

```bash
npx wrangler secret list --env production
```

3. Check `curl -sI https://<live-slug>.makeborne.site/` returns 200 with the strict CSP, an unknown slug returns 404, and `http://` redirects to `https://`.
4. Then set the three app hosting variables and redeploy the app.
5. **Fallback:** unset the three variables and redeploy the app. Sites return to `sites.makeborne.com` portable copies (rehearsed: hosting fallback in `candidate-rehearsal.json`). Disable enquiries per site if the Worker is down.

## G. AI limits and billing reconciliation

1. Choose daily limits (micro-USD per UTC day) from the remaining budget. Test budgets are cumulative: read `vendor_spent` first.

```sql
select makeborne_private.set_live_provider_limit('global',    true, <daily µ$>, false, '<ticket>');
select makeborne_private.set_live_provider_limit('anthropic', true, <daily µ$>, false, '<ticket>');
-- only if images are on:
select makeborne_private.set_live_provider_limit('openai',    true, <daily µ$>, false, '<ticket>');
select public.makeborne_provider_spend_health();
```

2. Billing reconciliation: set `CRON_SECRET` and `MAKEBORNE_BILLING_RECONCILE_ENABLED=true`, then call the job once by hand and check it:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" "https://makeborne.com/api/cron/billing-reconcile?health=1"
```

   Expect `overdue: false`, no failures and no binding mismatches. Only then add the `vercel.json` cron entry (`BILLING_PLAN_CREDITS.md`) in a reviewed commit.
3. Free tier: stays off unless D3 approves it.

## H. Smoke tests (maintenance on, then off)

Unpaid, in order:

1. `curl -s -o /dev/null -w "%{http_code}" -X POST https://makeborne.com/api/billing/webhook` returns 400 or 401 (signature refused, not 503).
2. Sign up, confirm email, sign in and sign out with a new test address. Check the redirect stays on `makeborne.com`.
3. Open an existing project; edit, save and export a PDF.
4. Publish a website. The existing address serves it; republish after a rename and check the former address returns 404.
5. Enable enquiries on that site, submit the form, and see it in the owner inbox. Then disable enquiries.
6. With limits disabled, a build returns `AI_PAUSED` with no hold row.
7. Billing page: the founding and creation CTAs match the D1 decision. A checkout returns the same URL on retry (`resumed: true`).

Paid (only with separately confirmed budget): one Plan-mode request at `light` effort. One settled `ai_run_outcomes` row; `actual_microusd ≤ bound_microusd`.

Then set `MAKEBORNE_RELEASE_MAINTENANCE=off`, redeploy, and repeat steps 1, 2 and 6.

## I. Alerts (configure before reopening)

- `public.makeborne_provider_spend_health()` every 5 minutes: alert on any stopped scope, `staleOpenCalls > 0`, `overrunsToday > 0`, spend > 80% of a daily limit.
- `public.makeborne_billing_job_health()` hourly: alert on `overdue` or growing open issues.
- `ai_run_outcomes`: alert on `missing_hold` or `released_hold`.
- Vercel: 5xx rate on `/api/billing/webhook`, `/api/hosting/enquiries` and generation routes. Whop: webhook delivery failures in the Whop dashboard.
- Cloudflare: Worker error rate on `makeborne-site-host`.

## Reversibility

| Change | Reversible? | How |
| --- | --- | --- |
| App deployment | Only to a qualified compatible recovery build | Verify current SQL contracts and saved document formats before promotion. **Not** `dpl_8NUAKFQ…` after migration: the old pilot loses its dispatch permission. A candidate predating chapter `opening` or authored compositions is also not automatically compatible. Otherwise retain maintenance and fix forward. |
| Env flags (maintenance, checkout, reconcile, hosting variables, image variables) | Yes | Unset or flip and redeploy. Running deployments keep old values until redeployed. |
| AI provider limits | Yes | `set_live_provider_limit(scope, false, 0, false, '<note>')`. |
| Exact pending migrations in the final approved inventory | **No (forward repair only)** | Credit lots convert balances into audited lots, CRM moves to expand mode, and the legacy pilot loses dispatch. Later namespace, journal and worker-authority migrations also need their matching recovery code. Fix forward with a new migration. Database restore is a separate incident (section J). |
| CRM contract | Yes, rehearsed | `CRM_STAGE_TRANSITION.md` rollback (contract → Conversation, rollback → Meeting). |
| Production Worker deploy | Only to a qualified recovery Worker | Pin the reviewed recovery version retaining QA exclusions, namespace cache partition, strict forms authority and matching legacy redirect guards. An arbitrary previous version is not safe. Otherwise disable affected hosting and fix forward; portable fallback also needs the matching guarded legacy host. |
| Narrowing staging to two exact QA routes | Historical wildcard rollback is forbidden | Keep the exact QA routes or an explicit unavailable response. Never restore the staging wildcard/apex. See `STAGING_HOSTING_ISOLATION.md`. |
| Credit grants, payments, refunds | **No** | Corrections are new ledger entries (`adjust`), never deletions. |

## makeborne.site cutover order and consequences

1. Read the live route list; historical staging had wildcard/apex ownership, but never assume that remains true. Complete the isolated staging procedure in `STAGING_HOSTING_ISOLATION.md` before this production window.
2. Staging retains only `release-check.makeborne.site/*` and `release-check-renamed.makeborne.site/*`, backed exclusively by staging. Keep this Worker; do not delete it merely to free the wildcard. Old ordinary staging sites become unavailable when routes are narrowed; their records remain preserved.
3. In the separately approved production window, deploy the matching production Worker on wildcard/apex routes. Its request guard and legacy redirect must reject both QA names, independently of Cloudflare route precedence.
4. Verify the two exact staging routes, production customer routes, apex redirect, DNS/TLS and denied cross-environment requests against their actual databases. Only then enable the app hosting settings in section F.4.
5. If staging fails, repair its exact QA routes or leave them unavailable. Never restore its historical wildcard or point QA at production. A local route test is not evidence of the live cutover.

## J. Recovery commands

| Situation | Action |
| --- | --- |
| Migration failed mid-run | Keep maintenance on. Check the actual applied list and transaction outcome against the rehearsal; do not assume every failure rolled back. Review the forward repair, then use the explicitly authorized production URL (`npx supabase db push --db-url "$PROD_DB_URL" --include-all`), never the implicit CLI link. |
| Candidate app broken after migration | Keep maintenance on. Do **not** roll back to `dpl_8NUAKFQ…`: its pilot has no dispatch permission after migration. Serve the candidate in maintenance and ship a forward fix (runbook section 6). |
| AI spend anomaly | `select makeborne_private.set_live_provider_limit('global', false, 0, false, '<incident>');` stops all integrated calls. Then `select public.makeborne_provider_calls_expire(500);` |
| Billing grants wrong | `MAKEBORNE_BILLING_RECONCILE_ENABLED=false` and `WHOP_CREATION_ENABLED=false`. Webhooks stay on and idempotent. Reconcile from `plan_credit_issues`. |
| CRM contract went wrong | `docs/CRM_STAGE_TRANSITION.md` rollback (rehearsed: contract → Conversation, rollback → Meeting). |
| Isolated hosting failing | Unset the three hosting variables and redeploy (section F.5). `update public.hosted_sites set enquiries_enabled=false where …` stops forms. |
| Worker bad version | Restore only the exact reviewed recovery version that retains namespace/QA exclusions, cache partition and forms authority. Verify route ownership and legacy redirect guards again. If no compatible version is qualified, keep affected hosting unavailable and fix forward. |
| Database must be restored | Separate incident procedure: PITR to the pre-window point loses every payment and credit change since then and needs Whop reconciliation. Never restore automatically. |
