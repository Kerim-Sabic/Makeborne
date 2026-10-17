# Client care plans (branch `feature/client-care-plans`)

An agency charges its own client a recurring fee for looking after their website. It's built on the client portal (`docs/CLIENT_PORTAL.md`).

## Owner decisions (2026-10-18)

- **Payments:** the agency's own payment link. Makeborne never handles the money. The agency adds a Stripe, PayPal, Whop or invoice link and records the payments it receives. Fully automatic charging (Stripe Connect) would need a Makeborne Stripe platform account, which PAY04 defers until the legal entity is eligible. The data model is provider-neutral, so it can be added later.
- **Unpaid:** the portal becomes read-only and the website stays live.
- **Grace period:** 7 days.
- **Reminders:** in the portal only. There is no email yet; Resend or the agency's own mailbox can come later.

## How it works

- **One plan per client** (`client_care_plans`): name, optional price and currency, billing period (month, quarter or year), the agency's https payment link, "paid through" date, and on/off.
- **Recording a payment** (`client_care_payments`) moves "paid through" on by one period, counted from the old date. A late payment therefore still covers the period it was due for, and month ends don't drift: 31 Jan → 28 Feb → 31 Mar.
  - Payments are idempotent per `Idempotency-Key`, so a double click records one payment.
  - Only the latest payment can be undone. Undoing it restores the previous date. If the plan has changed since, the undo is refused.
- **Status** (UTC calendar days):

  | Status | When | Client sees |
  |---|---|---|
  | `paid` | today ≤ paid-through | A quiet "paid through" line |
  | `due` | the 7 days after paid-through | A reminder with the **Pay** button; editing still works |
  | `paused` | from paid-through + 8 | Read-only portal with the Pay button |

  - **While paused:** the database refuses saving, sending, uploading and deleting photos (`PB402` → HTTP 402 `PAYMENT_DUE`). Reading still works, and the agency can still approve changes sent before the pause.
  - **When nothing is enforced:** a plan that is switched off, or has no paid-through date yet.
- **Agency screens:**
  - Clients → a client → **Brand & client access** → **Care plan**: set up, edit, record a payment (with an optional note), payment history, and Undo on the latest payment.
  - **Clients → Care plans** ("who owes me"), for owners and editors only:
    - monthly recurring income per currency, with quarterly and yearly plans spread evenly;
    - payments recorded this calendar month (UTC), excluding undone ones;
    - how many plans are paused or due;
    - a list that opens on *Needs attention*, with *All*, *Paid up* and *Not started or off* filters, a one-click Record payment, and a link to each client's plan.
  - Data: `GET /api/cloud/workspaces/[ws]/care-plans` returns `{ plans (each with lastPaymentAt), month, collected }`.
- **Not affected:** the per-person "access until" date on portal access (`client_portal_access.paid_through`) is unchanged. It ends one person's access entirely.

## Security

- **Agency functions:** the five agency functions are SECURITY DEFINER in `makeborne_rpc`, behind `public` security-invoker wrappers. Only `authenticated` can execute them, and editors or owners are required.
  - Reviewers, portal clients and strangers are refused and can read no rows. Members read through RLS, and there are no browser writes.
  - The advisor-equivalent query is unchanged.
- **Client reads** go through service-role-only bridges with the verified actor and session (`makeborne_portal_billing_home`, `makeborne_portal_billing_site`).
- **Payment links:** `https://` only, with no credentials, spaces, quotes or backslashes, and at most 500 characters. The same rule is enforced in zod, in the SQL function and in a table CHECK. The portal opens the link with `rel="noopener noreferrer"`.
- **Audit:** `portal.care_plan_updated`, `portal.care_payment_recorded` and `portal.care_payment_undone`. Metadata holds no amounts, links or notes.

## Migration `20261018090000_client_care_plans.sql`

- **Additive:** two tables, private helpers, client bridges, and agency functions with wrappers.
- **Replaced bodies:** `makeborne_private.portal_grant` (the same as `20261016090000`, plus the pause check on writes) and `portal_upload_scope` (now on the write path).
- **Order:** apply after `20261017090000_client_portal_uploads.sql`.

## Verification (2026-10-18)

- **SQL:** `supabase/check-client-care-plans.sql` passes 5 groups:
  - exposure;
  - agency set-up and refusals;
  - payments and status math;
  - portal enforcement;
  - cascades.

  With the full release chain, phase 2 and this migration inside BEGIN…ROLLBACK, all 9 SQL suites pass and the advisor-equivalent result is unchanged.
- **Offline:**
  - `check-care.cjs` 4/4: link rule, validation, formatting, wiring.
  - `check-portal-routes.cjs` 19/19: billing in the portal home and site reads, 402 mapping, agency routes, reviewer refusal.
  - `run-checks` 134/134. TypeScript and full ESLint are clean.
- **Real end-to-end** on the local release-auth stack (`work/client-editing-phase2-20261017/e2e-care.cjs` with `db.cjs setup`/`teardown`):
  - **Set-up:** the agency sets up "Website care €49 / month". A `javascript:` link is refused.
  - **Overdue:** with paid-through 10 days ago, the client's home and editor show "Editing is paused…" with a Pay button linking to the agency's https link. The editor is disabled with no Send button, and a forced draft save gets 402 `PAYMENT_DUE`.
  - **Payment:** recording a payment moves the plan to "Paid through 7 Nov" and the client can edit again.
  - **Undo:** undo restores the paused state.
  - **Grace period:** paid-through 3 days ago shows "Payment due · editing pauses 22 Oct", and editing is still possible.
  - **Audit and clean-up:** the audit trail holds the four expected actions. There were no browser errors, and the teardown left 0 objects.

## Release steps (after the portal and Phase 2)

1. Apply `20261018090000_client_care_plans.sql`.
2. Run `check-client-care-plans.sql` and the advisor comparison on staging.
3. No Worker, Auth or environment changes are needed.

## Dashboard verification (2026-10-18)

- **Offline:** `check-care.cjs` passes 5/5. It now also covers the recurring-income math and the dashboard wiring.
- **SQL:** the care plans check also covers the overview: ordering, last payment, and this month's totals without undone payments.
- **Browser** (`e2e-dashboard.cjs`, four seeded plans: paused, due, paid, off):
  - the stats read "€148.00 + US$100.00, 3 active plans", "US$1,200.00, 1 payment" and "Needs attention 2 (1 paused, 1 due)";
  - recording Monee Dental's payment from the list moved it to paid: attention 1, recorded €49.00 + US$1,200.00;
  - opening the client landed on its plan;
  - no browser errors, and the teardown left 0 test rows.

## Next: Makeborne takes a % through Whop (research 2026-10-18)

Whop for Platforms works like Stripe Connect and fits this model:

1. Each agency becomes a **connected account**, going through Whop's identity checks and payout setup.
2. Makeborne creates a recurring checkout configuration on the agency's account (`plan_type: renewal`, `billing_period`, `renewal_price`) with `application_fee_amount`. That is a fixed amount, so we compute it from our %.
3. The client pays through `purchase_url`, which is what the portal's Pay button opens.
4. With these *direct charges*, the agency pays Whop's fees and handles refunds and disputes.
5. Webhooks would then record payments automatically and pause or resume editing.

To settle before building:
- **Access:** platform access is invite-only, so the owner needs to email Whop.
- **Renewals:** confirm the application fee applies to **every renewal**. The docs only say "per unit purchased".
- **Pricing:** any extra platform pricing.
- **Payouts:** the payout countries our agencies need.
- **Webhooks:** that connected-account events reach the platform.
- **Fallback:** if renewals aren't covered, transfers are the alternative. Makeborne would collect the full payment and pay agencies out, which makes it the merchant of record. That is heavier, so avoid it.
- **Entity:** the PAY01 and PAY04 entity questions also apply.

Sources:
- docs.whop.com/developer/platforms/collect-payments-for-connected-accounts
- docs.whop.com/api-reference/checkout-configurations/create-checkout-configuration
- docs.whop.com/supported-business-models/platforms
- docs.whop.com/fees
