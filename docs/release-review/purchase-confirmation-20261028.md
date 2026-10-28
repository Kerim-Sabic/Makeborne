# Durable purchase confirmation and the withdrawal function — 28 October 2026

**Not a launch approval.** Branch `claude/purchase-confirmation-20261028`, from Codex's candidate `qualification/consumer-billing-20261026` **d5b3ecb**. This is the launch gate Codex assigned to Claude/legal in the 26 October handback: "durable purchase confirmation including terms/consent/withdrawal information, plus an actual withdrawal request confirmation and automatic acknowledgement; mailto-only is not qualification."

Nothing here was deployed, merged, applied to any database or sent. No credential was created. Checkout, fulfilment, credits, prices, access and the consent API are unchanged: the new code runs only after a payment is already recorded, and it never fails or retries a delivery.

## What a buyer gets

**1. A purchase confirmation by email** (Consumer Rights Directive Art. 8(7), a durable medium). It is sent once per purchase, after a plan's first funded payment or after a funded credit pack. It contains:
- what was bought (plan and interval, or pack and credits), the amount paid as Whop recorded it, the payment time and the Whop payment reference;
- for plans, the renewal terms;
- the immediate-start request **word for word**, with its version and the time it was ticked. This is copied in the database from `checkout_consents`, so it is never taken from the app's own text;
- the withdrawal information and the model withdrawal form;
- the Terms and Billing terms versions, with links;
- the statutory-rights line, the voluntary "refundable while unused" policy, and the seller's identity.

If a purchase has no immediate-start request on record, the confirmation says that withdrawing within 14 days gives a full refund.

The same stored text is shown under Billing › Purchase confirmations, and it is included in the account export.

**2. A withdrawal function** (Art. 11a). `/withdraw` keeps its "Withdraw from contract here" button. The button now opens a form instead of an email:
- **Signed in:** pick the purchase from a list, or type a reference.
- **Signed out:** enter the account's email and, optionally, the Whop payment reference.

The notice shows exactly what will be sent. "Confirm withdrawal" stores it with the server's time and a reference such as `WD-1A2B3C4D`. The page then shows the reference, the time and the full notice, and an email acknowledgement with the same content follows.

Nothing asks for a reason. A notice never refunds or revokes anything by itself: support handles it through the existing refund workflow, within 14 days.

**Anti-abuse (the form must not become a way to email anyone):**
- The automatic acknowledgement goes to the account's own address (signed in).
- For a signed-out notice, it goes to the typed address only when that address matches the account that owns the referenced payment.
- Every other notice is still stored and marked "reply by hand" for support.
- The limit is 5 notices per address or account in 24 hours. Over the limit the user is told to email admin@makeborne.com. A notice is never silently dropped.

**3. Admin › Withdrawals & email:** shows the notices (newest first), the outbox counts (waiting, retrying, failed, sent in 7 days) and every failed or retrying email.

## Data model (migration `20261028100000_purchase_confirmations.sql`, forward-only, additive)

| Table (all `makeborne_private`, RLS on, no grants to any role) | Purpose |
|---|---|
| `purchase_confirmations` | One immutable row per `payment_id` (unique). An update trigger refuses changes; erasure deletes it through the auth-user foreign key. |
| `withdrawal_requests` | Immutable notices with server time and reference. `user_id` is null for signed-out notices. |
| `transactional_mail` | Outbox. One row per confirmation or notice, with a unique idempotency key. Content cannot change; a sent row stays sent. A lease stops double sends; failures back off 5 min × 2ⁿ, capped at 24 h. After 12 attempts or a permanent provider refusal, the row is `failed` for operator review. |

**Functions.** Each is a SECURITY DEFINER function in `makeborne_rpc` with a SECURITY INVOKER `public.*` wrapper, executable by `service_role` only, following the boundary in Codex's consent migration:
- `makeborne_purchase_confirmation_candidates(p_since, p_payment, p_limit)` returns due payments: a membership's first funded plan payment (renewals continue the same contract) and every funded, granted pack order. Only payments at or after `p_since` count, so switching the feature on never mails earlier buyers.
- `makeborne_record_purchase_confirmation(...)` writes the confirmation and its outbox row in one transaction, and is idempotent per payment: the first text wins. It re-reads amount, currency, time, recipient and consent from stored evidence. It refuses a text that does not quote the payment reference and the accepted request, and it refuses pack credits that differ from the order.
- `makeborne_record_withdrawal_request(...)` validates the notice, checks that a chosen payment belongs to the account, applies the throttle, assigns the reference, and fills the acknowledgement template's `{{reference}}`/`{{received}}` from the stored row.
- `makeborne_transactional_mail_claim` and `makeborne_transactional_mail_result` handle the outbox.
- `makeborne_account_purchase_records(p_user)` serves the billing page and the withdrawal form; `makeborne_admin_legal_requests(p_actor)` is checked through `require_admin`.
- The account export extension adds `purchase_confirmations` and `withdrawal_requests`. Every other source still goes to the previous function, unchanged. `public.makeborne_account_export_rows` is replaced in place as an invoker wrapper.

## Where it hooks in

- `src/lib/billing/webhook.ts`: after `deliverTopupPayment` succeeds, and after the plan payment and observation are recorded, the webhook calls `confirmAfterFulfillment(paymentId)`. That call never throws and never changes the webhook's response.
- `src/app/api/cron/billing-reconcile/route.ts`: the daily run adds `runConfirmationSweep()`, which writes confirmations that are still due and then drains the outbox. The response gains a `confirmations` field; the credit job's status is unchanged.
- `POST /api/legal/withdraw`: same-origin check, bounded JSON and a strict schema. It drains up to three acknowledgements right away.
- `src/lib/mail/transactional.ts`: about 40 lines that call Resend's `POST /emails` with an `Idempotency-Key` header and plain text, from `Makeborne <admin@makeborne.com>` with reply-to admin@. Results carry error codes only, never the key.

## Environment and flags (all off by default)

| Variable | Effect |
|---|---|
| `MAKEBORNE_PURCHASE_CONFIRMATIONS_SINCE` | ISO instant. Unset means no confirmations are recorded. Set it to the launch instant (`2026-10-29T20:00:00Z`). |
| `MAKEBORNE_TRANSACTIONAL_MAIL_ENABLED` | `true` sends the outbox. Otherwise rows wait, and the admin tab shows "Sending: Off". |
| `RESEND_API_KEY` | A Resend API key with **Sending access** only, restricted to the `makeborne.com` domain. |

## What Codex must review and qualify on staging

1. **Migration:** apply `20261028100000` to staging with your apply script. Then run `supabase/check-purchase-confirmations.sql`, which ends in a rollback, and compare the security advisors: no new findings are expected, because every definer function is in unexposed `makeborne_rpc` with `search_path=''`.
   - **Locally the SQL passed on Postgres 16 (PGlite)**, against stubs of `auth.users`, the billing and pack tables, `checkout_consents` and `require_admin`. That is not the real chain. Re-run it after the real one.
2. **Fulfilment points:** confirm that the two `confirmAfterFulfillment` calls sit after every completed plan or pack delivery path you rely on, including `deliverTopupPayment` called from `topup-reconcile`. That cron path is covered by the daily sweep, not by an immediate call.
3. **Staging journey with sandbox keys,** with `SINCE` set and mail on, using a send-only staging Resend key to a test inbox:
   - buy a plan and a pack and check one confirmation each;
   - replay the webhook and check there is still one;
   - check the billing page shows the stored text;
   - submit a signed-in withdrawal and check the email acknowledgement;
   - submit signed-out with a matching address (automatic) and a non-matching one (reply by hand);
   - check the throttle at the sixth notice;
   - check the admin tab and the account export.
4. **Lawyer review of the texts** in `src/lib/legal/purchase-confirmation.ts`, which uses the Terms §6 wording. In particular the "within 2 working days" reply promise in the acknowledgement, and whether Whop's merchant-of-record role needs a line.

## Owner steps (when the owner approves)

1. In Resend: **API Keys → Create API key**, name `makeborne-transactional`, permission **Sending access**, domain **makeborne.com**. Save it straight into Vercel as `RESEND_API_KEY` for Production, and use a separate key for staging. It must never be pasted into chat or into the repository.
2. At launch, with Codex, set `MAKEBORNE_PURCHASE_CONFIRMATIONS_SINCE=2026-10-29T20:00:00Z` and `MAKEBORNE_TRANSACTIONAL_MAIL_ENABLED=true`, after the staging journey above passes.

## Checks run (offline)

- New:
  - `src/lib/legal/check-purchase-confirmation.cjs` (7);
  - `src/lib/billing/check-purchase-confirmations.cjs` (7);
  - `src/lib/mail/check-transactional-mail.cjs`;
  - `supabase/check-purchase-confirmations.sql` (needs a database).
- Updated:
  - `check-webhook-delivery.cjs`: a confirmation runs only after a completed delivery;
  - `check-access-foundation.cjs`;
  - `check-account-rights.cjs`: the data map and export sources cover the three new tables;
  - `check-legal-pages.cjs`: the form has "Withdraw from contract here" and "Confirm withdrawal", and the page has no mailto-only path.
- Results on this branch:
  - `npm test`: **228/228** harnesses (the usual 5 skipped).
  - `tsc --noEmit`: pass. eslint on every changed file: 0 problems.
  - `next build --webpack`: pass (`/withdraw` and `/api/legal/withdraw` are dynamic).
  - Migration plus `supabase/check-purchase-confirmations.sql` on Postgres 16 (PGlite) with stubs of the existing tables: both suites PASS and roll back.
  - New mounted browser check `scripts/check-withdraw-browser.cjs` (Chromium, 390 and 1440 px): PASS. It covers the two-step notice, the exact statement, the stored reference and time, the honest 429 path, the retrievable confirmation text and no sideways scroll. Screenshots are in `purchase-confirmation-20261028/`.
