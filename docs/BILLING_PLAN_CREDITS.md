# Plan credits: allocations from billing history

## Model

- **Observations** (`makeborne_private.plan_observations`, append-only). Each row is one piece of evidence about a Whop membership:
  - **`webhook`, `access_check`, `reconcile`:** a verified read of the membership's *current* state from Whop (never the event payload), stamped with server time. It records status, plan, tier and the billing period Whop reported.
  - **`payment`:** a Whop payment, stamped with its `paid_at`.
    - Only `paid`, unrefunded `subscription_create` / `subscription_cycle` payments count as evidence.
    - `subscription_update` (meaning undocumented), refunded and other payments are stored as `evidence_unverified` / `evidence_refunded` and never used.
  - **`manual`:** an operator's resolution of one open issue. It covers only that allocation.
- **Periods** (`makeborne_private.plan_periods`). A paid period is recorded only from Whop's own `renewal_period_start` and `renewal_period_end`:
  - **Missing start:** `missing_period`. It is never derived.
  - **Length doesn't match the plan interval:** `interval_mismatch`.
  - **Overlaps a recorded period with a different start:** `anchor_conflict`.
  - **Bound to another account:** `user_mismatch`.
  - **Same start with a later end:** `extended` (comp days, seller edits).
- **Allocations** (`makeborne_private.reconcile_plan_membership`):
  - Allocation *k* starts at `period_start + k months` (UTC, clamped at month end, no drift). It ends at the next allocation or the period end.
  - **Evidence for an allocation:** the latest evidence at or before its start, or else the first evidence inside it. **Nothing else.** In particular, a later observation that merely reports the same period is *not* evidence for earlier months.
  - **No evidence:** an open `plan_credit_issues` row (`no_evidence`) that stays recoverable. It resolves itself when payment evidence arrives, or an operator resolves it (`makeborne_private.resolve_plan_credit_issue`, owned by the database owner, note required). An operator's "not owed" decision is final.
  - **Tier:** the one in force at the start. An upgrade evidenced inside the allocation tops up that allocation only; a downgrade applies from the next one. Nothing is clawed back.
  - **Paid:** the allocation is owed only if the evidence says paid (`active`/`canceling`). Cancelled and past-due months aren't owed; reactivation resumes.
- **Grants** go through `credit_grant_plan_allocation` (idempotent per membership and allocation month). Every grant carries its allocation end and expires then (see Credit expiry). The app cannot grant with a caller-chosen tier. The undated `credit_grant_plan_month` path was removed.
  - Entry points (service role): `makeborne_record_plan_observation`, `makeborne_record_plan_payment`, `makeborne_reconcile_plan_credits`.
  - Concurrency: a per-membership advisory lock, then the wallet lock.

## Credit expiry

Migrations `20261012120000_credit_lots_expiry.sql` and `20261012130000_credit_lock_clock.sql`.

- **Lots.** Every grant creates one row in `makeborne_private.credit_lots`, with a source, a reference, and `spent`, `held` and `lapsed` amounts. Every credit can be traced to its grant.
  - **`plan`:** expires at the allocation end, an exact UTC instant (`expires_at`). At that instant the credits are expired. Top-ups expire with their own allocation month.
  - **`trial`:** never expires, while the trial stays disabled by default.
  - **`topup`:** never expires, which keeps the current pack terms.
  - **`adjust`:** goodwill or admin grants. They never expire, and they require `metadata.reason` (5 or more characters), which is kept on the lot and in the ledger.
  - **`refund`:** the existing kind, unchanged. Monetary refunds are a separate workflow, and no policy was added here.
  - **`legacy`:** the migrated balance; see below.
- **Spending order:** soonest-expiring plan credits first, then non-expiring credits in this order: trial, top-up, adjustment, refund, legacy. Spending legacy credits last is an assumption; it is easy to change in `lot_spend_rank`.
- **Holds.** `credit_hold_lots` records exactly which lots fund each reservation.
  - **Settle:** charges actual usage from those lots, soonest-expiring first, and never more than the reservation. Any excess is recorded as `shortfall` and not charged. A settle without a reservation charges nothing.
  - **Unspent credits:** go back to their own lot with that lot's expiry. If the lot has expired, they lapse instead, recorded as an `expire` ledger row with delta 0. A refund or release can never make expired credits non-expiring.
  - **Release** (failed or cancelled run): handled the same way.
- **Hold timeout and interrupted builds:** the 15-minute rule is unchanged.
  - **Reads:** a hold older than 15 minutes counts as available, but only if its lot is still valid.
  - **Next wallet write, or the reconciliation job:** releases the hold. Valid credits go back and expired ones lapse.
  - **After that release:** a settle of the same reference fails with `PT409`. A reclaimed hold can never also be spent.
- **Late settlement:** if a run's allocation ends while the run is in progress, the run can still be charged from its own hold, which was authorised while the credits were valid. Whatever the run did not use lapses.
- **Time of decision:** each wallet write judges expiry, the hold timeout and availability at the instant it holds the wallet lock (`credit_clock`), not when its transaction started. A request that started before an allocation's end but obtained the lock after it cannot spend that allocation. Reads use the same clock: `now()` outside a write.
- **Late catch-up:** an allocation granted after its end, such as months evidenced later by a payment, is recorded (lot, `plan_grant` and `expire` ledger rows) and lapses in the same transaction. Its `plan_grant` row's `balance_after` shows it never counted as available.
- **Ledger:** the invariant `sum(delta) = available` still holds.
  - Unheld credits that expire produce a negative `expire` row.
  - Balances are exact at read time without these rows. `makeborne_credit_expire_due` writes the rows; it runs at the end of every reconciliation run and on the next wallet write.
- **Display:** `/api/credits` returns `nextExpiry: {at, credits}` (UTC). The billing page shows it in the viewer's own time zone, for example "120 credits expire 31 Oct 2026, 10:00". There is also a "Do credits expire?" FAQ entry.
- **Existing balances:**
  - Each existing wallet becomes one non-expiring `legacy` lot (`legacy:pre-lots`, with the reason recorded). That lot funds the wallet's open holds.
  - `credit_lot_migration` stores each wallet's balance, reserved and available amounts before and after. The migration aborts unless every wallet matches exactly; holds older than 15 minutes are compared as available, the same way the previous reads treated them.
  - **Local result:** 1 wallet, 187/0 before and 187/0 after, with 0 holds.
  - **Production is not verified.** Its migration history and schema must be checked independently before anyone assumes it has no wallets. The migration handles any number of wallets and holds, and refuses inconsistent ones (reserved ≠ open holds) instead of guessing.

## Reconciliation job

`GET /api/cron/billing-reconcile` (and POST). Code: `src/lib/billing/reconcile-job.ts`.

- **Off by default.** It runs only with `MAKEBORNE_BILLING_RECONCILE_ENABLED=true`. `vercel.json` has no cron entry, so production scheduling stays disabled until reviewed. To schedule later, add `{"crons":[{"path":"/api/cron/billing-reconcile","schedule":"17 3 * * *"}]}`.
- **Authentication:** `Authorization: Bearer $CRON_SECRET`, a secret of at least 32 characters, compared in constant time. Billing must be configured.
- **Overlapping runs:** `makeborne_billing_job_begin` grants one lease at a time. A run whose lease expired (crash or timeout) is marked `abandoned`, and the next run proceeds. Heartbeats renew the lease every 10 memberships.
- **Work list:** `makeborne_billing_job_due_memberships` returns bound memberships (`billing_memberships`) that are active, recently ended, or have open issues and haven't been observed for 20 hours, stalest first.
  - **Recovery after missed runs** works by staleness, not by date: a skipped day just means more rows are due.
  - **Paging:** in pages of 50, at most 200 memberships per run, within a 240-second budget. Running out of budget leaves the run `partial`.
- **Per membership:**
  1. Read it from Whop, with retry and backoff: 429 honours `Retry-After`; 5xx, timeouts and network errors back off exponentially; other 4xx don't retry; at most 4 attempts.
  2. Check the binding: merchant, checkout, Whop user and plan.
  3. Update `billing_memberships` and record the observation.
  4. If issues are open, read its payments (paged, at most 5 pages). Whop's `query` search is fuzzy, so each item must name exactly this membership and merchant. Then record the evidence.
  5. A failure on one membership is counted and the run continues. Each membership is attempted once per run.
- **Then** the database reconcile runs for every recorded entitlement, followed by `makeborne_credit_expire_due`, which records ended allocations and timed-out holds. A failure in either marks the run `failed`.
- **Idempotency:** every write is idempotent, so retried and repeated runs are safe.
- **Monitoring:**
  - `billing_job_runs` holds each run's status (`succeeded`, `partial`, `failed`, `abandoned`), stats and errors.
  - Each run writes a JSON log line.
  - `GET /api/cron/billing-reconcile?health=1` (same auth) or `select public.makeborne_billing_job_health();` reports the last success, failures in the last 24 hours, open issues, and `overdue` (no success in 36 hours). Alert on `overdue` or a growing `openIssues`.
- **Sandbox:** `WHOP_API_BASE_URL=https://sandbox-api.whop.com/api/v1` points every Whop call at Whop's sandbox. Only that URL and production are accepted.

## What Whop documents (checked 2026-10-12)

- **Membership period fields:** `renewal_period_start` and `renewal_period_end` are "the start/end of the current billing period". The text says Unix timestamp and the schema says date-time; both are accepted, and anything else is treated as missing. ([Retrieve membership](https://docs.whop.com/api-reference/memberships/retrieve-membership))
- **Membership plan:** `plan` is "the plan the customer purchased to create this membership".
- **Payments:**
  - `plan`, `membership`, `paid_at`, refunds, and `billing_reason` ∈ {`subscription_create`, `subscription_cycle`, `subscription_update`, `one_time`, `manual`, `subscription`}. The description covers "initial subscription purchase, renewal cycle, or one-time payment" but not `subscription_update`.
  - The list endpoint searches by membership through the fuzzy `query` filter, with cursor paging. ([Retrieve payment](https://docs.whop.com/api-reference/payments/retrieve-payment), [List payments](https://docs.whop.com/api-reference/payments/list-payments))
- **Not documented anywhere:** upgrades, downgrades, proration, plan switching, or links between memberships. ([List memberships](https://docs.whop.com/api-reference/memberships/list-memberships), [Memberships guide](https://docs.whop.com/developer/guides/memberships))
- **Sandbox:** Whop has one at `sandbox.whop.com` / `sandbox-api.whop.com/api/v1`, with test cards (4242 4242 4242 4242 succeeds) and webhooks. A sandbox refund doesn't revoke access. ([Sandbox](https://docs.whop.com/developer/guides/sandbox))
- No sanitized real Whop fixtures exist in this repository.

## Limitations and open items

1. **Credit expiry is implemented locally** (see Credit expiry). Open item: production's wallets and holds are unknown until its migration history and schema are verified. The reconciliation record from that run must be reviewed before release.
2. **Subscription replacement is unverified.** Public plan switching stays disabled until the provider's behaviour and the entitlement handling are confirmed. Two overlapping memberships are two entitlements, and that is not verified upgrade behaviour. Whether a plan change edits the membership or creates a new one, and which payments and webhooks it produces, needs the sandbox test below. Until then, two memberships are two entitlements. There is no blanket per-account cap.
3. **Previous-release grants** (`plan:<membership>:<period end>`) count toward allocation 1 using the period's current end. No such grants exist in production.

## Sandbox verification needed (no real purchases)

The account owner creates a Whop **sandbox** account and API key; Claude doesn't create accounts.

### Minimum sandbox credentials and permissions

These are sandbox values only. Never use production keys for this, and never paste a secret into chat, an issue or a commit.

| Variable | What | Minimum access |
|---|---|---|
| `WHOP_API_BASE_URL` | `https://sandbox-api.whop.com/api/v1` | Not secret. The code accepts only this URL or production. |
| `WHOP_API_KEY` | A sandbox company API key | Read memberships and read payments for the sandbox company. Nothing else: no write, payout or member-management permissions. Pick the matching read permissions in Whop's key settings. Their exact names aren't in the API docs we checked, so confirm them in the dashboard. |
| `WHOP_COMPANY_ID` | The sandbox company (`biz_...`) | Not secret. |
| `WHOP_WEBHOOK_SECRET` | The signing secret of a sandbox webhook pointed at the local app (through a tunnel) | Membership and payment events only. |
| `WHOP_ACCESS_PLAN_IDS`, `WHOP_PLAN_CREDIT_MAP` | The sandbox plan IDs from step 1, for example `plan_a:create,plan_b:studio,plan_c:scale,plan_d:create:yearly` | Not secret. |

**Secure configuration:**

1. Put these variables in a new git-ignored file, for example `.env.whop-sandbox.local`. `.gitignore` already excludes `.env*` except `.env.example`.
2. Load that file only for the local sandbox run. Do not put sandbox values in `.env.local`, which points at production Supabase, or in Vercel production settings.
3. Use the local Supabase stack.
4. Revoke the key after the test.

The values are entered by the account owner and never shared in chat. Claude can then run the steps that need no purchase, such as reading memberships and payments or replaying webhooks. The owner does the checkout steps.

### Steps

1. Create sandbox plans:
   - Create, Studio and Scale **monthly**
   - Create **yearly**
2. With card 4242, buy Create monthly. Record the membership, payment (`billing_reason`), webhooks, and `renewal_period_*`.
3. Through the membership's `manage_url`, upgrade Create→Studio mid-period. Record:
   - whether the membership ID or `plan.id` changes
   - any new membership
   - payments with their `billing_reason` and amounts
   - webhook order
   - `renewal_period_*` before and after
4. Downgrade Studio→Create. Record the same.
5. Switch monthly→yearly. Record the same.
6. Cancel at period end, then cancel immediately. Refund one payment. Record status, payments and webhooks.
7. Save the sanitized responses as fixtures under `src/lib/billing/fixtures/whop-sandbox/`, with IDs and emails redacted. Then replace the assumptions in the replacement design with tests built from those fixtures.

## Configuration required before selling

- `WHOP_ACCESS_PLAN_IDS`: every plan that may grant access.
- `WHOP_PLAN_CREDIT_MAP`: every plan that isn't in the catalogue, as `plan_id:tier:yearly` for annual plans. The catalogue plans are assumed **monthly**; confirm that in Whop. Unknown or malformed entries are ignored and reported in `billingConfig().planConfigIssues`.
- `makeborne_private.billing_access_plans`: each access plan present and `enabled`.
- `creation_enabled`, `WHOP_CREATION_ENABLED`, `MAKEBORNE_BILLING_MIGRATIONS_VERIFIED`: as documented elsewhere.
- Job, when approved:
  - `MAKEBORNE_BILLING_RECONCILE_ENABLED=true`
  - `CRON_SECRET` (32+ random characters)
  - the `vercel.json` cron entry
  - alerting on the health endpoint

## Tests

| Check | Where | What |
|---|---|---|
| `supabase/check-credit-lots-expiry.sql` | local DB, rolled back | spend order, expiry boundary (at the instant), allocation expiring while held, partial/late settle never above the hold, returns keep source and expiry, expired release lapses, hold timeout and reclaimed-hold settle refused, MB402 counts valid credits only, plan catch-up lapses atomically, top-ups expire with their month, legacy migration and reconciliation, privileges |
| `supabase/check-credit-lots-concurrency.sql` | **disposable DB** | concurrent reservations across lots; spending racing an allocation's end; hold timeout racing a late settle and release; settle racing release |
| `supabase/check-credit-wallets.sql` | local DB, rolled back | free-tier gate, trial, grants (dated plan grants, adjustment reasons), reserve/settle/release, ledger invariant, admin bypass, RLS |
| `supabase/check-plan-credit-allocations.sql` | local DB, rolled back | upgrade/downgrade in month 6, repeated changes, monthly↔yearly, Jan 31/Feb 29 anchors, renewal boundaries, cancellation and reactivation, previous-release grants, no inferred history (open issues), payment evidence, unverified/refunded payments, manual review, recording outcomes, permissions, job control |
| `supabase/check-plan-credit-concurrency.sql` | **disposable DB** | 8 simultaneous deliveries plus a racing reconcile; ended months lapse |
| `supabase/check-plan-credit-job-e2e.cjs` | **disposable DB** | real job and SQL with mocked Whop: issues opened, then resolved by payments; idle run; overlap |
| `supabase/check-credit-wallets-concurrency.sql` | **disposable DB** | racing reserves and trials |
| `src/lib/billing/check-billing-reconcile-job.cjs` | offline | retry/backoff, sandbox base, payment paging and filtering, cron auth, overlap, binding, failures, budget, heartbeat, expiry step |
| `src/lib/billing/check-plan-credits.cjs` | offline | Whop timestamps, mapping of every plan ID, observation wiring, cancellation status |

Each disposable-database check refuses to run against the main database.

The disposable database was built from a schema-only copy, so it lacks Supabase's per-database role grants and the migrations' seed rows. `sh supabase/sync-disposable-grants.sh makeborne_crm_isolated` copies the grants from the local main database (read-only there), so the browser-permission sections also run in the disposable database. Run settlement outcomes and AI spending limits are covered in `docs/AI_SPENDING.md`.
