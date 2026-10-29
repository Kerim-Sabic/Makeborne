# Minimum launch, gate 4: remaining billing gates — 25 October 2026

Claude, review and local verification only. Candidate: Codex's `release/minimum-launch-20261025` at **700a4e4** (staging runtime e8ccef9, deployment `dpl_DQeybc5KJAy7MMPdWf1aQuZKDY4R`), read only. This branch, `claude/launch-billing-review`, starts at 700a4e4 and adds one code fix (**3ce1e8b**) and this report. No Whop, staging, production or credential action was taken. No paid calls. The November renewal probes were not touched.

## Evidence labels

- **EXACT:** observed by Codex on the exact staging runtime e8ccef9 on 25 October (minimum-launch-20261025.md, minimum-launch-six-purchases-20261025.md, tonight-launch-gates-20261025.md and the two committed JSON files). Codex's private `work/qualification` evidence was not opened.
- **HISTORICAL:** observed on older candidates, older code and the old $29 plan. It shows a mechanism worked once. It is not exact-candidate evidence.
- **LOCAL:** run by Claude today on the candidate code. These are offline harnesses, a fresh disposable Postgres and mounted browsers. **Local is not cloud and not provider evidence.**

## Gate table

| # | Gate | Code (candidate 700a4e4) | EXACT evidence | HISTORICAL evidence | LOCAL checks run today | Codex must still do | Blocker? (recommendation; owner decides) |
|---|---|---|---|---|---|---|---|
| 1 | Automatic signed Whop webhook delivery to the deployed route | `src/app/api/billing/webhook/route.ts:6-26`; `src/lib/billing/webhook.ts:35-47` (Standard Webhooks with the literal `ws_` secret, `webhook-id` must equal the body id), `:49-129` (merchant check `:52-53`, fresh membership read `:70`, checkout binding `:72-76`, 503-for-retry `:24,72,75`, payment/refund/dispute state first `:118-122`, observation `:127-128`); `config.ts:41-48,58` (staging scope, `ws_` secret required) | **Manual only.** Six refund notifications, manually signed and labelled as such, went through the deployed route. Invalid signature gave `INVALID_WEBHOOK`. Wrong merchant gave `WRONG_MERCHANT`. Duplicate refund and delayed `payment.succeeded` were accepted idempotently with credits still 0. **No provider-initiated delivery.** The sandbox webhook stayed disabled. | 13 Oct: real provider-signed `membership.activated`/`payment.succeeded` 200 through a local tunnel. Concurrent duplicates gave 4×200 and one grant (old code, $29 plan; `whop-credit-delivery.json`). 21 Oct (58bc0f7): provider-signed payloads relayed verbatim, plus a **Whop dashboard replay** to the fixed staging preview, gave failed 200 and paid 200 with exactly one 300 grant. Genuine refund/membership events 200 (`checkout-failure-recovery-20261021.md`). | `check-webhook-delivery.cjs` PASS and `check-access-foundation.cjs` PASS: signatures, replay, stale, tampered, wrong merchant, binding retries, refund/dispute resolution. SQL: `check-plan-payment-refunds.sql` 12/12 PASS. | §Checklist A: make the staging route reachable past Vercel protection, point the sandbox webhook at the exact deployment URL, buy, **do not** open the return page or status API, and prove the binding came from the webhook. Refund and prove `reversed` from an automatic event. Disable the webhook again. | **Hard blocker (recommended).** Cheap to close. Without it, and with gate 2 off, a purchase whose buyer never returns is never fulfilled. |
| 2 | Scheduled reconciliation: protected cron, health, missing-first-event recovery | `src/app/api/cron/billing-reconcile/route.ts:24-26` (off unless `MAKEBORNE_BILLING_RECONCILE_ENABLED=true`, then bearer), `:31-35` (`?health=1` merges checkout-recovery health), `:47`; `src/lib/server/cron-auth.ts:5-10` (constant time, ≥32 characters); `reconcile-job.ts:51-158` (lease, checkout discovery `:71-76`, stalest-first, payment state, partial/succeeded `:147-148`); `checkout-recovery.ts:91-107`; SQL `20261021125359_checkout_payment_recovery.sql:16-31,69-75,85-91`; health/overdue `20261012110000_plan_evidence_and_jobs.sql:236-244`. **`vercel.json` has no cron entry.** | **None for the cron.** Billing reconcile is deliberately OFF on this preview. Missing-first-event recovery is EXACT only through the **authenticated return/status route**: all six purchases bound and granted 300/750/1,550 once each with the webhook disabled. | 13 Oct: real sandbox reconcile, processed 2, failed 0, no duplicate grant, unauthorized cron 401 (local, old code). 21 Oct (58bc0f7): staging billing/top-up cron **manual POSTs** succeeded, health `overdue:false`, `openIssues:0`. Not a scheduled invocation and not a missed-delivery proof. 22 Oct combined candidate: health 200/overdue false/openIssues 0 (handoff). | `check-billing-reconcile-job.cjs` 13/13 PASS (retry/backoff, cron auth, overlap, budget, heartbeat, checkout discovery). `check-checkout-recovery.cjs` 26/26 PASS. SQL `check-checkout-recovery.sql` 2/2, `check-plan-credit-allocations.sql` 13/13 (incl. job control/health), `check-financial-reconcile-freshness.sql` 1/1 PASS. | §Checklist B: enable on staging with a fresh `CRON_SECRET`. Prove 401/503 behaviour, a manual authenticated run, health, and **missing-first-event recovery by the cron** (buy, never return, run the job). Production: manual run plus health before opening sales, then add the cron entry. Note F3/F4. | **Hard blocker for the protected route, a manual run and green health in production before sales.** The *scheduled* invocation can only be observed in production, because Vercel Cron does not invoke preview deployments. Accept it as a documented first-24-hours check. |
| 3 | Browser checkout return and recovery UX | Return: `src/app/billing/return/page.tsx:9-16`, `return-client.tsx`. Status: `src/app/api/billing/checkout-status/route.ts:12-22` (owner-bound, runs recovery, then live access check). Checkout: `src/app/api/billing/checkout/route.ts:84` (sandbox returns to `https://sandbox.whop.com/`; otherwise `https://makeborne.com/billing/return?request=…`), resume `:55-63,68-75`. Client: `src/components/creation-plans.tsx:113-138`. | API polling only. Six authenticated status calls recovered the payments. Six post-refund status calls gave `pending` with no destination. Wrong account gave `CHECKOUT_NOT_FOUND`. **The Makeborne return page was not rendered on this runtime**: the sandbox redirects to Whop's home. | 21 Oct (58bc0f7): "real return request → Studio" on staging. The page was opened by direct navigation with the right `request` parameter after a sandbox purchase, plus a 375 px billing smoke. Not the Whop redirect itself. | **Two defects found and fixed in 3ce1e8b** (see below). New mounted `scripts/check-checkout-return-browser.cjs` 4/4 PASS in Chromium, Firefox and WebKit; it fails on 700a4e4. `check-checkout-contract.cjs` PASS with new resume cases; it fails on 700a4e4. Existing `check-creation-plans-browser`, `check-plan-signup-browser` and `check-billing-ux-browser` PASS in all 3 engines. | §Checklist C: integrate 3ce1e8b (or an equivalent), then render the real return page on staging by direct navigation after a sandbox purchase. Production: the first real purchase smoke must land on `/billing/return` via Whop's redirect. Optional: a staging-only redirect to the exact preview origin. | **Not a hard blocker if** 3ce1e8b (or equivalent) is integrated **or** gate 1 passes, and the staging direct-navigation render plus the production redirect smoke are done. Otherwise a missing webhook plus an abandoned tab leads to a possible second payment. |
| 4 | Cancel at period end, partial refund (held), dispute (held/won/lost), lost dispute (reversed) | `whop.ts:73-78` (`active`/`canceling` and `renewal_period_end > now`, so access is time-bounded); `plan-payments.ts:52-67` (dispute vocabulary), `:74-105` (full/partial/held mapping, strict refusal); SQL `20261020090000_payment_funding_and_refunds.sql:286-330` (effects: `held`/`reversed` withhold unused credits and release holds; `reversed` revokes the period), `:331-432` (state machine `:394-395`; won restores); UI `billing-workspace.tsx:68-70` (refunded/charged-back and "set to end" notes), `billing-subscriptions.tsx`. | **None on new-price fixtures.** Cleanup used *immediate* cancellation and *full* refunds. Full-refund reversal is EXACT (6/6 net-zero ledgers, access closed). | 12 Oct: Whop sandbox cancel-at-period-end read back `status: active, cancel_at_period_end: true` and still active. Then immediate cancel gave `canceled` (`whop-sandbox-lifecycle.json`). App `hasCreationAccess` was true at period-end cancel and false after immediate cancel (`whop-credit-delivery.json`). Old code, $29. **No provider partial refund or dispute was ever observed for plans.** | SQL on a fresh disposable DB, all PASS: `check-plan-payment-refunds.sql` 12/12 (D: partial holds, full reverses; E: open dispute holds, won restores, lost revokes; H/I: period-limited revocation, refund-first ordering). `check-plan-credit-allocations.sql` 13/13 (cancellation keeps paid months; cancelled months not granted). `check-billing-lifecycle.sql` 6/6. `check-billing-lifecycle-concurrency.sql` 3/3. `check-credit-lots-expiry.sql` 10/10. `check-plan-credit-rollover.sql` 7/7. `check-billing-ux.sql` 8/8. Offline: `check-plan-payments.cjs` and `check-plan-credits.cjs` PASS. | §Checklist D: cancel-at-period-end read-back plus an access/credits check on a new fixture today. Partial refund leads to `held`, then full refund leads to `reversed`. Disputes only if the Whop sandbox can create one (unknown, so check the docs). "No access after period end" cannot be observed without waiting 30 days. | **Not hard blockers for a limited beta**, provided that: (a) the owner sets the support rule "full refunds only at launch", **or** the partial-refund sandbox step passes; (b) disputes are accepted as SQL-only evidence with the support runbook; (c) the cancel-at-period-end read-back is run (cheap). F5 is a copy gap, not an access bug. |
| 5 | Renewal (monthly, failed renewal, yearly months 2-12) | Payment evidence `webhook.ts:118-128` and `reconcile-job.ts:100-126`; allocation `20261012110000…` and `20261013280000_billing_lifecycle_boundaries.sql`; yearly months 2-12 by observation on access check (`access.ts:56-61`) and reconcile; `past_due` gives no access and no allocation (`whop.ts:76`). | **None.** An initial purchase is not renewal evidence. Annual first allocation is one month, not twelve (EXACT). | 14 Oct: a real **weekly** post-trial `subscription_cycle` success and a failed `past_due` cycle were read from the provider. The failed payment carries `paid_at`, so status must govern (`whop-cycle-observations-20261014.json`, `provider-cycle-classification-20261014.json`). Active **monthly** probes (old $29 plan) `mem_IApANyZ1n9M6vg` (4242) and `mem_DaA63WSyDtf4Sr` (0341) renew **20 Nov 2026, ~15:43 Warsaw** (`monthly-renewal-probes-20261021.md`). | SQL `check-billing-lifecycle.sql` (renewal needs period-local evidence; reversed order gives one grant per paid month; twelve annual monthly lots), `check-plan-credit-allocations.sql` (renewal boundaries, monthly↔yearly, month-end/leap-year anchors), `check-billing-lifecycle-concurrency.sql`: all PASS. Simulated time, not provider. | §Checklist E: leave the probes alone until the cycle. Afterwards, read only and run the reconcile on a staging deployment that still maps the probe plan. The sandbox key expires 28 Oct, so renew it first with owner approval. | **Not a blocker for a beta**, provided that: reconcile is enabled and scheduled in production; the owner accepts that the first real customer monthly renewals (about 24-25 Nov for today's buyers) arrive after the 20 Nov probe checkpoint; and a stop rule is agreed (if probes fail, set `WHOP_CREATION_ENABLED=false` before 24 Nov and resolve via `plan_credit_issues`). |

## Defects found and fixed (branch `claude/launch-billing-review`, commit 3ce1e8b)

### D1. Resume could send a buyer back to pay an already-paid checkout

**Where (700a4e4):** `src/app/api/billing/checkout/route.ts:55-63` (an open checkout blocks a new one with PBC02 and is resumed for the same plan) and `:68-75` (same-key retry). Both returned the saved Whop URL whenever no `billing_memberships` row was bound to that checkout.

**Why that is wrong:**
- An unbound checkout is not proof that it was never paid. The first webhook can be missing or late (gate 1 is unqualified, and the webhook is disabled on staging).
- One Whop checkout accepts more than one payment attempt: on 21 Oct a failed 0341 attempt was followed by a paid 4242 attempt on the same checkout. `check-checkout-recovery.cjs` also treats "multiple paid subscriptions for one checkout" as a real case.
- "Reusable-checkout second-payment behaviour" has been listed as unqualified since 13 Oct (`billing-capabilities-20261013.md`).

**Scenario:** the buyer pays and closes the tab before the redirect. No webhook arrives. They return to `/billing` and click the same plan. They are sent straight back to the paid checkout.

**Fix:** before resuming, the route runs the existing exact-checkout recovery (`recoverCreationCheckout`). This is the same lease-bounded, read-only provider lookup as the status route and cron. It makes no provider writes and invents no events.
- `pending` (Whop lists no paid payment): resume.
- `recovered`: `CHECKOUT_ALREADY_COMPLETED`. The client already shows "That checkout is already complete." with Open studio.
- `review`, cooldown/lease, or a provider error: fail closed with `CHECKOUT_PENDING`. The copy is "don't pay twice … email admin@makeborne.com".

The client's non-resume `CHECKOUT_PENDING` copy now says "being confirmed … email admin@makeborne.com if this doesn't change". The previous copy said "being prepared".

**Reproduction:** the extended `check-checkout-contract.cjs` fails on 700a4e4: the route never consults Whop and returns the URL. It passes on 3ce1e8b. Cases: recovered, review, skipped and throw on both resume paths, with no new provider checkout in any of them.

**Residual:** a payment that is still *processing* (not yet `paid`) does not block resume, because recovery only treats `paid` as proof. This is narrow, and it is listed for Codex.

### D2. The return page gave up before recovery could run twice, and stopped on the first server error

**Where (700a4e4):** `return-client.tsx:39-46`.
- It made 12 polls × 2.5 s (30 s). The status route's recovery runs at most once per 60 s per checkout (`claim_checkout_recovery`, migration line 29). With the webhook missing and the payment not yet listed on the first attempt, the page always ended on "pending".
- Any non-OK answer, including a transient 503 `CHECKOUT_RECOVERY_UNVERIFIED`, ended polling as an error.
- The end copy ("Whop has not confirmed access yet. Check again shortly; you don't need to purchase again.") implied the state would resolve itself, and gave no support route. The same copy is shown to refunded or review-state checkouts.

**Fix:**
- It now checks for about two minutes: 12 × 2.5 s, then 9 × 10 s. After 30 s it says "Still confirming with Whop. This can take a minute or two."
- A 5xx or network error is retried inside the window. A 4xx (wrong account, invalid link) stops at once, without a useless "Check again" button.
- The honest end state reads: "Whop hasn't confirmed this payment to us yet. [Your draft is safe.] If you paid, don't pay again: your plan opens as soon as the payment is confirmed. If this page still says this in a few minutes, email admin@makeborne.com."

**Mounted check:** `scripts/check-checkout-return-browser.cjs` uses the real component, a routed fictional status API and a virtual clock. It covers four scenarios:
- a late recovery (after 60 s) still opens the saved draft and clears the checkout keys;
- a 503 is retried and access then opens;
- a checkout that is never confirmed ends honestly at 375 px with no overflow, and "Check again" restarts polling;
- another account's checkout stops after one request.

On 700a4e4 it fails: the page is already in its final "pending" state at 31 s and never reaches the late recovery. It passes in Chromium, Firefox and WebKit on 3ce1e8b.

**Not changed:** the status route still answers `pending` for review-state and refunded checkouts. The page cannot tell them apart without a new read path (a SQL change), so the end copy covers them with the support route instead.

## Other findings (not fixed; for Codex)

- **F1. Staging is behind Vercel Deployment Protection.** Per the sibling gate-5 report (handoff, 25 Oct), an unauthenticated request to `dpl_DQey…` gets a 302 to Vercel SSO. Whop's automatic delivery would therefore fail before reaching the app. Codex's manual signed posts must have used a bypass.
  - For gate 1, either append Vercel's automation bypass as the `x-vercel-protection-bypass` query parameter in the sandbox webhook URL, or disable protection for that preview during the test window.
  - The query parameter stores a secret in Whop's configuration, so rotate the bypass afterwards.
  - Precondition: an unsigned `POST` to the exact URL must return the app's 400 `INVALID_WEBHOOK`, not Vercel's 302/401.
- **F2. Two webhook routes, one secret.**
  - `/api/billing/whop-events` (`whop-events/route.ts:29-33`) refuses creation fulfilment with 503 `FULFILLMENT_NOT_ACTIVE` and accepts only the support merchant.
  - Creation billing must point at **`/api/billing/webhook`**.
  - Both routes verify with the single `WHOP_WEBHOOK_SECRET`, so a second Whop endpoint with a different secret cannot verify on the same deployment.
  - Production: confirm which endpoint the live Whop company sends to. Use `api_version_date` 2025-01-01 and events `membership.*`, `payment.*`, `refund.*`, `dispute.*` (RELEASE_CHECKLIST row at line 112).
- **F3. Abandoned checkouts never leave the cron's recovery list.** `due_checkout_recoveries` (migration `:69-75`) has no age bound, and a `pending` recovery stays `pending` indefinitely.
  - With **11 or more** abandoned checkouts, every run sees `backlog=true` (`checkout-recovery.ts:93-106`) and is therefore `partial` (`reconcile-job.ts:147-148`).
  - Health `overdue` requires a `succeeded` run within 36 h (`20261012110000…:243`), so it would read `overdue:true` permanently. That is a false alarm that also hides real ones.
  - Rotation is 10 per run. With a daily schedule, a paid-but-unreturned checkout can wait several days.
  - Options for Codex:
    - age out unbound checkouts (for example, mark them `review`/expired after N days and check that Whop's checkout no longer accepts payment);
    - don't count checkout backlog as `partial`;
    - raise the per-run limit or the schedule frequency.
- **F4. Scheduling.** `vercel.json` has no cron. The documented schedule is daily (`17 3 * * *`).
  - Vercel Cron invokes production deployments only, so a staging preview can prove the protected route but not the schedule.
  - With the webhook as the primary path, daily is a safety net. Without a webhook, recovery for a buyer who closed the tab takes up to 24 h, so use a sub-daily schedule if the Vercel plan allows it.
  - No alerting is wired to `?health=1`. Add an authenticated monitor or a log alert on `overdue`/`openIssues`.
- **F5. Cancel at period end may not show "Your plan is set to end".** Historical Whop (API 2025-01-01) reported `status: active` with `cancel_at_period_end: true`.
  - The app stores and reads only `status`. The note at `billing-workspace.tsx:70` keys on `canceling`, so it may never appear.
  - Access and credits are unaffected, because access is time-bounded.
  - The subscription row says "Recorded billing period ends … Confirm … scheduled changes in Whop", which is not false.
  - Verify the exact status in gate 4 step D1. If it is `active`, parsing `cancel_at_period_end` is a small follow-up.
- **F6. An abandoned checkout locks the account to that plan.** Choosing another plan returns `CHECKOUT_ALREADY_OPEN`. In a fresh tab, the client copy says "Finish it in the Whop page you opened, or email admin@makeborne.com", but that page is closed and the plan is not named. The only way out is support. This is acceptable for a support-backed beta. Suggest naming the open plan in the copy.
- **F7. Sandbox API key expires 28 Oct**, before the 20 Nov probes (`monthly-renewal-probes-20261021.md` already notes this).
- **F8. Probe plan mapping.** The probes are on the old $29 plan. Renewal evidence from them qualifies the *mechanism*, not the new plan IDs. The deployment that runs the November reconcile must still list that plan in `WHOP_ACCESS_PLAN_IDS`/`WHOP_PLAN_CREDIT_MAP`, and the staging DB allowlist row must stay enabled. Codex reports the earlier rows were preserved.

## Codex checklist (staging/provider; Codex only)

Use the exact candidate commit you intend to ship. If you integrate 3ce1e8b, that is a new runtime, so redeploy staging and record the new deployment ID and URL. Every step needs fresh, confirmed, non-admin fixtures, sandbox only and `fake4242` unless stated. Never touch `mem_IApANyZ1n9M6vg` or `mem_DaA63WSyDtf4Sr`.

**A. Automatic webhook delivery (gate 1)**
1. Make the exact deployment reachable for Whop (F1). Check that an unsigned `POST https://<exact-staging-host>/api/billing/webhook` returns 400 `INVALID_WEBHOOK` from the app, not a Vercel 302/401.
2. Enable the existing sandbox webhook, or create one, for `https://<exact-staging-host>/api/billing/webhook`.
   - Events: `membership.*`, `payment.*`, `refund.*`, `dispute.*`; API version 2025-01-01.
   - Its `ws_` secret must equal the deployment's `WHOP_WEBHOOK_SECRET`. A new secret means an env change, a redeploy and a new URL.
   - Secret handling is Codex's; never print it.
3. Buy Create monthly as a new fixture. **Do not open `/billing/return` or call `/api/billing/checkout-status`** until step 4 is recorded. Either one would bind the purchase by recovery and mask the webhook.
4. Expected evidence:
   - the Whop dashboard delivery log shows 200 for `payment.succeeded`/`membership.*` to the exact URL;
   - `billing_webhook_events` holds those Whop event IDs;
   - `billing_memberships` is bound to the fixture's checkout;
   - **no** `makeborne_private.checkout_recoveries` row for that request is in `recovered` state;
   - 300 credits granted once;
   - Vercel logs show `POST /api/billing/webhook` 200.
5. Fully refund that payment through the sandbox API. Expected: an automatic `refund.*`/`payment.*` delivery with 200, the payment state `reversed`, net-zero ledger and access closed. All of this without manual signing.
6. Cleanup: immediately cancel the membership, **disable the sandbox webhook** (or point it away), rotate or remove any protection bypass, ban the fixture, revoke its sessions, and keep the financial audit.

**B. Reconciliation (gate 2)**
1. Staging env: `MAKEBORNE_BILLING_RECONCILE_ENABLED=true` and a fresh `CRON_SECRET` of at least 32 random characters, on this deployment only.
2. Expected responses:
   - no bearer: 401;
   - wrong bearer: 401;
   - job disabled: 503 `JOB_DISABLED`;
   - `GET ?health=1` with bearer: 200, with `overdue` false after the first success, `checkoutRecovery` counts and `openIssues` 0.
3. **Missing first event:** with the webhook disabled, buy as a fresh fixture and never open the return page or status. Run `POST /api/cron/billing-reconcile` with the bearer. Expected:
   - `stats.checkoutRecoveries` ≥ 1;
   - the membership is bound through the recovery receipt, with no fake webhook row;
   - exactly one allocation.

   Run it again: no second grant.
4. Watch for F3: if more than 10 unbound `ready` checkouts exist on staging, the run will be `partial`. Record the count.
5. Cleanup: refund and cancel the fixture, disable the job again, and remove `CRON_SECRET` from the preview.
6. Production (only after owner go):
   - follow `RELEASE_CHECKLIST.md` §G (set the secret and flag, run once by hand, check health);
   - add the reviewed `vercel.json` cron entry;
   - after deploy, confirm in Vercel's cron log that the first *scheduled* invocation ran and that health `lastSuccessAt` advanced within 24 h;
   - wire an alert on `overdue`/`openIssues`.

**C. Return and recovery UX (gate 3)**
1. Integrate 3ce1e8b or an equivalent. Re-run `check-checkout-contract.cjs` and `scripts/check-checkout-return-browser.cjs`.
2. On staging, after a sandbox purchase as a fresh fixture, navigate the **same signed-in browser** to `https://<exact-staging-host>/billing/return?request=<that checkout's request_id>`. Expected: "Confirming your membership." then a redirect to `/studio`, with screenshots at 375 and 1440 px. For the unconfirmed state, do the same for a checkout you did not pay. The end copy should appear after about two minutes.
3. Close-the-tab journey, with the webhook disabled: pay, close the Whop tab before the redirect, open `/billing` in a new tab and click the same plan. Expected: "That checkout is already complete." with Open studio, or the "don't pay twice" notice. **Never** a Whop payment page.
4. Optional: let the staging sandbox redirect to the exact preview origin (code change, not in 3ce1e8b).
5. Production smoke after owner go: the first owner-approved real purchase must land on `https://makeborne.com/billing/return?request=…` from Whop's redirect and open the studio. Then refund and cancel it as approved.

**D. Cancel at period end, partial refund, dispute (gate 4)**
1. Cancel at period end: buy as a fresh fixture, then set cancel-at-period-end via the sandbox API or the customer portal. Read back the membership `status` and `cancel_at_period_end` (this settles F5). Then check:
   - authenticated access is still true;
   - credits are unchanged;
   - `/billing` copy is captured as a screenshot.

   "No access after period end" needs 30 days, so accept that as SQL plus code evidence. Cleanup: full refund and immediate cancel.
2. Partial refund (skip if the owner adopts "full refunds only at launch"): buy as a fresh fixture, partially refund (for example $5 of $20), and deliver the event automatically if A passed, else run the B reconcile. Expected:
   - `plan_payments.state='held'` and unused credits withheld (available 0, `Withheld` row in usage history);
   - the reconcile result reports `needsReview: true`. A period-attributed partial refund opens no `plan_credit_issues` row (`apply_plan_payment_state`, `20261020090000…:286-330`), so support must pick it up from the payment list;
   - access stays open (`held` does not revoke);
   - the billing page shows withheld credits.

   Then refund the rest. Expected `reversed`, the period revoked and the refunded-period note shown. Cleanup: cancel.
3. Dispute: check Whop's sandbox documentation for a dispute test card or API. If there is one, open, lose and win a dispute against separate fixtures. Expected: `held`, then `reversed` with access revoked and the "charged back" note, or `held` restored to `funded`. If there is none, record "not provider-testable" and keep the SQL evidence (refunds E).

**E. Renewal (gate 5)**
1. Before 20 Nov: renew the sandbox key with the same limited permissions (owner approval). Do not change the probes, their payment methods or their dates.
2. After 20 Nov ~15:43 Warsaw, read only: each probe's new payment (`billing_reason=subscription_cycle`, status/substatus, `paid_at`) and its membership.
3. Run the reconcile from a staging deployment whose env maps the $29 probe plan (F8). Expected:
   - success probe: one new `plan_payments` row in state `funded`, the second 300 allocation once, and a lot expiring at allocation end plus two months;
   - failure probe: no allocation, `past_due` and access closed, and the billing page shows "Your last payment didn't go through".
4. If the success probe does not get exactly one new allocation, or the failure probe gets any credits, pause new sales (`WHOP_CREATION_ENABLED=false`) before the first customer renewals (about 24-25 Nov). Resolve customers through `plan_credit_issues`.
5. Refund and cancel the probes only after the evidence is captured, as authorized.

## Local runs (today, on candidate code; not cloud, not provider)

- **Offline harnesses:**
  - `node scripts/run-checks.mjs src/lib/billing src/lib/credits src/app/api`: 23/23 PASS on 700a4e4.
  - Full `node scripts/run-checks.mjs` on 3ce1e8b: **186/186 PASS**, with the five standard exclusions.
- **Disposable database:** a fresh `public.ecr.aws/supabase/postgres:17.11.0.002` container with `--network=none`, built the same way as `scripts/rehearse-candidate.mjs`: platform schema, production schema dump, production baseline versions and the populated fixture, then **88 pending candidate migrations**. The container was removed afterwards.
  - PASS: `check-plan-payment-refunds.sql` 12, `check-checkout-recovery.sql` 2, `check-billing-lifecycle.sql` 6, `check-plan-credit-allocations.sql` 13, `check-credit-lots-expiry.sql` 10, `check-plan-credit-rollover.sql` 7, `check-billing-ux.sql` 8, `check-financial-reconcile-freshness.sql` 1, `check-billing-lifecycle-concurrency.sql` 3. That is 62 PASS lines.
  - The concurrency suite needs `dblink` as a superuser. It was first run as `postgres` and refused (harness environment, not candidate code), then run as `supabase_admin` and passed.
- **Mounted browsers** (`scripts/run-browser-checks.mjs`, Chromium/Firefox/WebKit): `check-checkout-return-browser` (new), `check-creation-plans-browser`, `check-plan-signup-browser` and `check-billing-ux-browser`. 12/12 PASS on 3ce1e8b.
- **Static checks:** `tsc --noEmit` is clean. `eslint` is clean on the changed files.

## Boundaries

No Whop dashboard or API call, no staging or production request, no environment, flag, allowlist or webhook change, no credentials read or printed, and no paid calls. The November probes and Codex's worktree were untouched. Nothing was pushed.
