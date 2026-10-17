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
  - `GET /api/cloud/workspaces/[ws]/care-plans` lists every plan with paused and due first, for an overview. It has no screen yet.
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
