# Launch: billing, refunds, auto top-ups, publishing, Gmail — 20 October 2026

**Status: not launch-ready.** The refunded-subscription defect is fixed and locally qualified. Payment-level refund
eligibility and a support refund workflow are implemented. Auto top-up is prepared with charging off. Publishing and
Gmail are prepared by Codex and need Kerim's actions. Nothing touched production: no data, configuration, migration,
deployment, purchase, charge, paid AI call or new paid service.

| Item | Value |
| --- | --- |
| Branch | `feature/billing-refunds-provenance` (worktree `.claude/worktrees/billing-refunds-20261020`), base `origin/main` `d14bf30` = production deployment `dpl_BSTNcBDmzcEHDWSvoTV1pPpjq6cW` |
| Commit | recorded in `docs/AGENT_HANDOFF.md` with this report (local only, not pushed) |
| Left uncommitted on purpose | `docs/AGENT_HANDOFF.md` in this worktree: it holds Codex's own uncommitted coordination notes |
| New migrations, in order | `20261020090000_payment_funding_and_refunds.sql`, then `20261020100000_credit_autotopup_authorization.sql`. Both are forward-only and additive, and both sort after Codex's uncommitted `20261019134828` |
| Evidence folder | `docs/release-review/launch-20261020/` |

Real provider observations and simulations are kept apart throughout. **Real** means Codex's Whop sandbox run on
2026-10-19. **Simulated** means a local database with normalized provider evidence written by the test.

---

## 1. What works, with evidence

### 1.1 The reported defect: a refunded subscription kept access and credits — fixed

* **Real observation (Codex, sandbox, 2026-10-19):**
  * A $29 `subscription_create` payment was fully refunded in the dashboard.
  * Whop then reported the payment as `status: "paid"`, `substatus: "refunded"`, 29 of 29 refunded, while the membership stayed `active`.
  * Makeborne kept creation access and the 300-credit lot, and a reconcile did not change that.
  * Source: `work/payments-preparation-20261019/docs/release-review/payments-go-live-20261019.md`.
* **Root cause:**
  * Refund and dispute webhooks re-read the membership, which Whop keeps active, and record a *paid* observation.
  * `makeborne_record_plan_payment` ignores a later refunded state (`on conflict do nothing`).
  * Plan lots had no payment provenance, and access trusted membership status alone.
* **Reproduction:** `repro-subscription-refund.sql` runs the same event sequence on both chains (simulated provider).

  | Chain | Before refund | After refund |
  | --- | --- | --- |
  | Without the fix | access `t`, 300 credits | access `t`, 300 credits (defect) |
  | With `20261020090000` | access `t`, 300 credits | access `f`, 0 credits |

  Log: `repro-subscription-refund.log`.
* **Fix:**
  * The webhook (payment, refund and dispute events) and the daily reconcile job now retrieve each subscription payment from Whop and record it through `makeborne_reconcile_plan_payment` *before* the membership observation.
  * A full refund or lost dispute (`reversed`) does four things:
    * releases live holds on that payment's credits;
    * withholds its unused credits with audited `adjust` ledger rows;
    * revokes creation access for that billing period only;
    * blocks further allocations for that period.
  * A membership refresh or paid observation cannot undo a revocation.
  * `access.ts` live verification also checks the revocation and fails closed if the check errors.
  * Nothing is deleted: used credits stay `spent` and are recorded as exposure for review.

### 1.2 Refund policy and payment-level provenance — implemented, locally qualified (simulated)

Policy implemented: a payment is refundable only while **none of the credits it supplied** have been used.
Eligibility is decided per payment. Mandatory rights, disputes and Whop's rules still apply.

| Brief requirement | Implementation |
| --- | --- |
| Payment-level provenance | `credit_lots.funding_payment_id` is set once and guarded against change. Pack lots link to their order's payment (backfill plus trigger). A plan lot links to the single `subscription_create`/`subscription_cycle` payment paid within its billing period (from one day before the period starts). Other cases are never guessed: `ambiguous` (two payments), `none` (other reasons) and `pending` (outside every known period) all go to manual review. |
| Deterministic consumption order | Unchanged and documented: soonest-expiring credits first; then plan, trial, pack, adjustment, refund credits; then oldest lot. This order is in the terms and in each support snapshot. |
| Reservations linked to funding | Existing `credit_hold_lots`. The support snapshot lists each reservation that used the payment's lots. |
| Support-visible evidence | `/admin` → Customers → **Payments & refunds** shows the decision, used/unused/withheld credits, usage, the case, revoked periods and a "Refunded: no creation access until …" badge. A full JSON snapshot including ledger rows is available from `makeborne_support_payment_refund_check`. |
| Safe refund workflow | **Freeze** (`…_refund_begin`) re-decides under the wallet lock and withholds the unused credits; nothing can be spent between check and withhold. Support then refunds in the Whop dashboard. **Cancel** restores the credits only while Whop shows no refund. Only administrators can act, with a 5–500 character reason, and the actor is stored. |
| Idempotent reversal | Stale, duplicate, conflicting-timestamp, refund-regression and paid-to-failed regressions are all refused or ignored. One observation row is kept per accepted revision. |
| Access change for the refunded entitlement | The revocation covers the refunded billing period only. A later paid renewal restores access (case H). |
| Active vs released holds | A live hold gives `blocked_active_hold`; a released hold is not use (case C). A timed-out hold is released at the next wallet lock. |
| External refunds and disputes after use | The rest of the credits are withheld, the exposure is recorded, and a `refund_after_use` issue opens. Unattributable refunds open `refund_unattributed`. An open dispute holds credits; a won dispute restores them; a lost dispute revokes. |
| Copy agrees | Terms version `2026-10-20-standard-v7` (refund policy and support process), the help answer, the billing notice for a refunded period, admin guidance, `docs/BILLING_PLAN_CREDITS.md` and `docs/RELEASE_DECISIONS.md` D7. |

The SQL suite `supabase/check-plan-payment-refunds.sql` passes 12 groups (A–L), covering the brief's test matrix:
* unused purchase;
* partial usage;
* mixed subscription plus pack (expiring plan credits are spent first, so the pack stays refundable);
* multiple payments;
* active and released holds;
* spending blocked during a refund (`MB402`);
* abandoned refund (cancel), with case history kept;
* duplicate and out-of-order events;
* partial refunds;
* external refund after use;
* disputes;
* refund evidence arriving first;
* a refund whose billing period becomes known only later (applied as soon as it is matched);
* a refunded period receiving no allocation;
* renewal after revocation;
* unattributed and ambiguous payments;
* binding, plan and administrator boundaries;
* client privileges.

Not covered:
* A dblink two-session concurrency test. Serialization comes from the shared wallet lock, and the logical race is tested.
* Annual periods. Yearly plans stay off.

### 1.3 Automatic 100-credit top-ups — prepared, charging OFF

* **Provider check:** Whop's docs (read 2026-10-20) do document off-session charges. Details and caveats are in §2 and §4.
* **What exists (migration `20261020100000`):**
  * A global kill switch: `charging_enabled = false`.
  * No price: `price_cents = NULL`, so authorization is refused until Kerim decides.
  * Versioned explicit authorization. It stores the terms version, credits, price, threshold, monthly and daily limits, and the SHA-256 of the exact consent text shown.
  * No account is authorized by the migration or by any default.
  * A charge-decision function, `makeborne_autotopup_plan_charge`, for a future executor. It records a planned attempt with a unique idempotency key and never charges. It checks:
    * the kill switch;
    * re-consent on any offer change;
    * an active paid subscription (free tier does not qualify);
    * a threshold on authoritative available credits;
    * one attempt in flight;
    * a 10-minute cooldown;
    * daily (2) and calendar-month limits;
    * suspension after two consecutive failures.
  * Revocation cancels planned attempts.
* **UI:** behind `MAKEBORNE_AUTOTOPUP_SETUP_ENABLED=true`, which production leaves unset. It shows:
  * the exact price, 100 credits, the threshold choice and the monthly limit with its USD total;
  * the consent text, an "I authorize" checkbox and "Enable automatic top-ups";
  * enabled/disabled status and an immediate turn-off.
* **No charging code exists.** No code path calls Whop to charge.
* **Evidence:**
  * `supabase/check-credit-autotopup.sql`: 4 groups pass.
  * `src/lib/billing/check-autotopup.cjs`: the exact text and its hash are verified.
  * Browser, local:
    * The no-price state reads "cannot be turned on yet".
    * With a local-only price of 1200, enable stored the authorization with a hash equal to the displayed text, and the decision returned `charging_disabled`.
    * Turn-off works.
    * At 375 px there is no horizontal overflow.

### 1.4 Gates on this branch

| Gate | Result | Evidence |
| --- | --- | --- |
| TypeScript | pass | `launch-20261020/gate/typecheck.log` |
| ESLint `--max-warnings 0` (whole repository) | pass | `gate/eslint.log` |
| Offline harnesses | **140/140** pass (5 standard skips) | `gate/harnesses.log`; new: `check-plan-payments.cjs`, `check-autotopup.cjs`; extended: webhook delivery, access foundation, reconcile job, plans, capabilities |
| Production build (`next build --webpack`) | pass | `gate/build.log` |
| SQL suites, full chain | **57/60** pass (the 3 documented release skips: two upgrade-path suites and one developer-stack postcondition); 0 failures. Clean 94-migration base plus both migrations; every suite ran in its own dropped copy. | `sql-suites.json`, `sql-suites.log`, runner `run-sql-suites.mjs` |
| Defect repro before/after | defect on the old chain, fixed on the new one | `repro-subscription-refund.log` |
| Browser (local, simulated provider) | All checks pass: admin refunded-customer panel; freeze, then cancel, with the database showing grant/withhold/restore and the case `canceled`; refunded-period notice on `/billing`; auto top-up states. No console errors. | `local-server.mjs`, `seed-refund-fixtures.mjs` (passwords only in the ignored `work/`) |

---

## 2. What remains disabled, and why

| Capability | State | Reason or blocker |
| --- | --- | --- |
| Creation checkout, credit packs, plan switching | **Off in production** (unchanged) | Codex's open payment gates: real renewal and failed renewal; a second payment on an exposed checkout; awaiting-checkout recovery; tax, promo and BAM-conversion evidence; scheduler eligibility. This branch must also be re-qualified in the sandbox (needs a new key: the old one expired 2026-10-20 00:00 UTC). |
| Yearly plans | Off | Kerim's confirmation and an annual refund rule are needed (proposal in §4). There are no annual refund tests yet. |
| Automatic top-up charging | Off (kill switch, no price, no executor) | 1. The runtime key has no `payment:charge`, `member:payment_methods:read` or `member:basic:read`. 2. Off-session charges need a saved payment method with future-use consent, and our hosted checkout does not request it (unverified). 3. `off_session` is documented only on Whop's *Current* API (version 2026-10-07 or later), while we pin `2025-01-01`. 4. 3-D Secure needs the customer to open `recovery_url`, and Makeborne has no transactional email channel. 5. Fulfillment (credit exactly 100 only on `payment.succeeded`, bound to the attempt) is not built. 6. The price is undecided. 7. There is no sandbox key. |
| Standard `<slug>.makeborne.site` publishing | Off in production | Codex owns this. Host prepared and reboot-tested; staging transport proven. Cloud compiler/recovery/isolation tests (within the $2 ceiling), scoped unattended Vercel access and a production profile are still pending. Custom domains stay disabled; no catch-all route or Cloudflare SaaS is used. |
| Gmail CRM sending | Prepared; production runs `MAKEBORNE_GOOGLE_MAIL_MODE=send_only` (Codex readback) | Google verification is not submitted; the demo is recorded after approval. Reply detection, inbox reading and stop-on-reply are **unavailable** in send-only mode, and the code refuses reads. |
| Commercial hosting | — | Codex reports the Vercel team is on **Hobby**, whose terms restrict commercial use. Paid activation needs a supported plan, which is a new paid service needing Kerim's approval. |

---

## 3. What Codex can finish (concrete)

1. **Review this branch.** Run:

   ```bash
   node docs/release-review/launch-20261020/run-sql-suites.mjs
   ```

   ```bash
   node scripts/run-checks.mjs
   ```

   It is locked to the disposable stack `makeborne-rc-20261019` and needs `/tmp/refunds-base.dump` in that container. To recreate the dump, run `supabase start --workdir work/rc-stack` from `.claude/worktrees/rc-20261019`, then `pg_dump -Fc -d postgres -f /tmp/refunds-base.dump` inside the database container.
2. **Sandbox re-qualification after Kerim renews the sandbox key.** Run this branch locally with the existing relay (`scripts/sandbox-webhook-relay.mjs`):
   * (a) Fresh Create purchase, then a dashboard full refund. Expect: webhook 200; `plan_payments.state = reversed`; revocation present; `/billing` notice; studio redirects to billing; 300 credits withheld. This is the original failing case.
   * (b) Partial refund, which should be `held`.
   * (c) Pack purchase, freeze in `/admin`, refund in Whop. Expect the case `completed`.
   * (d) Freeze, then cancel. Expect credits restored.
   * (e) The reconcile job finds a refund made while the webhook was disabled.
   * Record real observations separately from simulations.
3. **Staging:** apply both migrations through `scripts/apply-staging-migrations.mjs` (explicit target, dry run first). Deploy the branch to the QA alias. Repeat (a)–(e) against staging with the sandbox.
4. **Production offer preparation:** no change is needed for refunds. For auto top-up, prepare (not create) the following, using the 100-credit pack plan `plan_uQfsnWwX9aAxK` ($12) as the charge's plan source:
   * a separate least-privilege Whop key: `payment:charge`, `member:payment_methods:read`, `member:basic:read`, `webhook_receive:payments`;
   * a design note for saving payment methods with off-session consent.
5. **Publishing:** continue `work/trusted-publication-production-20261019`, per `publishing-host-preparation-20261020.md` §Remaining gates 2–5:
   * scoped runtime Vercel access;
   * staging deploy of a frozen candidate;
   * staged supervisor runs (builds, recovery, isolation) within $2;
   * a production activation/rollback packet.
6. **Gmail:**
   * Keep `work/forms-and-gmail-20261019/docs/release-review/gmail-verification-20261019/SUBMISSION_PACK.md` current.
   * Before Kerim submits: separate the staging OAuth client into its own project, and remove unused broader scopes.
   * Prepare the send-only privacy wording for an approved release.
7. **Production steps** (when Kerim approves; see §5): backup, explicit-target migration, deploy, smoke checks.

## 4. What only Kerim can authorize or perform

1. **Approve the refund policy and terms `2026-10-20-standard-v7`** for release. The live terms still say "non-refundable" until then.
2. **Auto top-up price decision.** No live price was created. Proposal:

   | Input | Value | Source |
   | --- | --- | --- |
   | AI cost per credit | $0.030 (worst case, every credit used) | `src/lib/builder/pricing.ts`; price card checked 2026-10-12 (`margins.ts`) |
   | 100 credits, AI cost | $3.00 | — |
   | Whop card fee | 2.7% + $0.30 (domestic); +1.5% international; +1% FX; $0.03 3DS; $0.07 Radar; $15 per dispute; optional tax 2% | docs.whop.com/fees, read 2026-10-20 |
   | **At $12 (= the approved manual 100-credit pack)** | AI-only margin **75%** (enforced floor 40%, proposed 50%). Contribution after fees: ~$8.31 domestic, ~$7.74 worst case (international + FX + 3DS + Radar + tax), before hosting/support. One dispute ($15) wipes out about two top-ups. | computed |

   * Recommendation: **$12 per 100 credits**, with no automatic-top-up discount.
   * Proposed defaults: threshold 50 (covers a medium run's 50-credit ceiling; offered 25/50/100), monthly limit 4 ($48), 2 per day, 10-minute cooldown, suspension after 2 failed charges.
   * Also needed: approval of the new Whop key scopes.
3. **Annual refund treatment** (before any yearly offer). Recommended: the same rule. An annual payment is refundable only while none of its credits have been used; month 1's allocation counts; after any use there is no voluntary refund. The database already revokes the whole year and blocks the remaining allocations. Tests must be added before selling.
4. **Renew the Whop sandbox key** (it expired 2026-10-20 00:00 UTC) so Codex can re-qualify. Real purchases and refunds in production remain Kerim's own actions.
5. **Hosting plan for commercial use** (Vercel Hobby restriction). A paid plan is a new recurring service.
6. **Google verification:** submit it yourself per the submission pack; record the case ID; record the demo after approval.
7. **Each production activation** (payments, publishing, Gmail release, auto top-up) is a separate go.

## 5. Shortest safe production activation order

1. Kerim approves: terms v7, auto top-up stays off (or a price), yearly off, hosting plan.
2. Codex completes the sandbox re-qualification of this branch (§3.2) and the open payment gates.
3. Open a PR from `feature/billing-refunds-provenance` to `main`; CI green; review.
4. **Production database** (explicit target, never a bare `db push`):
   * verified backup;
   * dry-run listing that shows exactly `20261020090000` and `20261020100000`;
   * apply;
   * verify: new functions are service-role only, `has_creation_membership_for_actor` excludes revocations, `autotopup_settings` has `charging_enabled = false` and `price_cents = NULL`, 0 authorizations, and security advisors are unchanged.
5. Deploy the merged commit *after* the migration. The code also works before it while billing is off, because `verifyCreationAccess` returns early.
6. Smoke checks:
   * `/billing` 200;
   * `/billing/terms` shows v7;
   * `/admin` → a customer shows "Payments & refunds";
   * the webhook endpoint still answers 503 `WEBHOOK_NOT_CONFIGURED` while billing env is off;
   * every commercial switch reads back unchanged.
7. Then, as separate gos: payment activation (Codex's sequence in `payments-go-live-20261019.md`), publishing, Gmail release after Google approval, auto top-up (executor build plus sandbox qualification first).

**Rollback.**
* Revert the merge commit. Keep the migrations: they are additive, and the database keeps enforcing any revocation.
* If a revocation must be lifted after review, use operator SQL inside a transaction:
  * `select makeborne_private.lock_credit_wallet(<user>)`;
  * `update makeborne_private.membership_revocations set lifted_at = now(), lift_reason = '<reason>' where payment_id = '<pay_…>'`;
  * `select makeborne_private.restore_payment_lots(<user>, '<pay_…>', array['refunded'], '<reason>')`.
  * All three steps leave ledger and audit rows.
* No ledger row is ever deleted.

**Environment variable names.**
* New: `MAKEBORNE_AUTOTOPUP_SETUP_ENABLED`. Leave it unset in production.
* Payments: `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`, `WHOP_COMPANY_ID`, `WHOP_ACCESS_PLAN_IDS`, `WHOP_PLAN_CREDIT_MAP`, `WHOP_CREATION_ENABLED`, `MAKEBORNE_BILLING_MIGRATIONS_VERIFIED`, `WHOP_TOPUPS_ENABLED`, `MAKEBORNE_TOPUP_MIGRATIONS_VERIFIED`, `MAKEBORNE_TOPUP_CHECKOUT_QUALIFIED`, `MAKEBORNE_BILLING_RECONCILE_ENABLED`, `MAKEBORNE_TOPUP_RECONCILE_ENABLED`, `CRON_SECRET`.
* Gmail: `MAKEBORNE_GOOGLE_MAIL_MODE=send_only`, `MAKEBORNE_MAIL_AUTOMATION_ENABLED=false`, `MAKEBORNE_GOOGLE_MAIL_CLIENT_ID`, `MAKEBORNE_GOOGLE_MAIL_CLIENT_SECRET`, `MAKEBORNE_MAIL_ENCRYPTION_KEY`.

**External identifiers (no secrets).**
* Whop company `biz_CV9cZg1zFX3h7f`.
* Plans: Create `plan_qs8XNbKQsowC6`, Studio `plan_arwSDewCa8Dvi`, Scale `plan_Wf2CTdqqUwufk`.
* Packs: 100 `plan_uQfsnWwX9aAxK`, 300 `plan_GwpfABcqYL52H`, 1,000 `plan_kad4BfTsKyfHn`.
* Prepared webhook `hook_NRlOFyyxw1UKG` (disabled).
* Production deployment `dpl_BSTNcBDmzcEHDWSvoTV1pPpjq6cW`.
* Staging Supabase `xzwikrunwpurxnxgkznh`.
* Controller host: DigitalOcean droplet `610683000`.
* Google OAuth callback `https://makeborne.com/api/mail/callback/google`.

**Sources (read 2026-10-20 unless noted).**
* Whop:
  * docs.whop.com/developer/guides/save-payment-methods
  * …/api-reference/beta/payments/create-payment
  * …/api-reference/payments/create-payment
  * …/payments/payment-requires-action
  * …/payment-methods/list-payment-methods
  * …/developer/api/idempotency
  * …/payments/refund-payment
  * …/api-reference/stability
  * docs.whop.com/fees
* Codex reports:
  * `payments-go-live-20261019.md`
  * `publishing-host-preparation-20261020.md`
  * `forms-and-gmail-20261019.md`
  * `SUBMISSION_PACK.md`
  * `lovable-ux-audit-20261020.md` (auto top-up consent pattern)
