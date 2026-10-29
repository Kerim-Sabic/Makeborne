# Checkout consent, sign-up and UI lines (version 2026-10-26)

These are the exact lines used in the app. Constants live in `src/lib/legal/versions.ts`.

## Sign-up (clickwrap)

Under "Create account" and the Google/GitHub buttons, as links (no pre-ticked box):

> By creating an account you agree to the [Terms](/terms) and acknowledge the [Privacy Policy](/privacy).

Email sign-up stores `terms_version` (`LEGAL_VERSION`) and `terms_accepted_at` in the Supabase user metadata. Google and GitHub sign-up show the same line before the provider screen but cannot pass metadata; record acceptance on first sign-in if a durable record is required for those accounts (Codex follow-up).

## Checkout (before the redirect to Whop)

Why Makeborne collects this itself: Whop's Seller Terms make Whop merchant of record "for the purpose of card network rules and payment settlement only" and the seller "the supplier ... for value-added tax, sales tax, consumer protection". Whop's terms say nothing about collecting the EU/UK immediate-performance request or the withdrawal acknowledgement, so Makeborne asks on its own plan step.

Unticked checkbox, shown to signed-in buyers next to the plans and on the "Ready to finish" step; the buy buttons stay disabled until it is ticked:

> I want my plan to start immediately. I understand that if I withdraw within 14 days, I'll pay for the credits I've used, and that I lose my right to withdraw once the service has been fully provided.

Below it:

> By continuing you agree to the [Terms](/terms) and the [Subscription, credit and refund terms](/billing/terms). EU and UK consumers can withdraw within 14 days ([how](/withdraw)).

The request to `/api/billing/checkout` carries `withdrawalConsent: "withdrawal-2026-10-26"`; the route stores it in the Whop checkout metadata as `makeborne_withdrawal_consent` next to `makeborne_terms_version`.

## How it fits "refundable until used"

| Situation | Outcome |
|---|---|
| Any customer, any time, none of a payment's credits used | Full refund of that payment (voluntary policy) |
| EU/EEA/UK consumer withdraws within 14 days after using credits | Refund less a proportionate amount: credits used from that payment ÷ credits included in its paid term (CRD Art. 14(3)) |
| Service fully provided within 14 days | Withdrawal right lost (CRD Art. 16(a), after the express request and acknowledgement above) |
| After 14 days, credits used | No voluntary refund; statutory remedies unaffected |

## Confirmation on a durable medium (CRD Art. 8(7))

Whop's receipt names Makeborne as supplier but is not Makeborne's confirmation, so Makeborne sends its own (migration `20261028100000_purchase_confirmations.sql`, text in `src/lib/legal/purchase-confirmation.ts`). After a plan's first funded payment or a funded credit pack, one immutable record per payment stores and emails: what was bought, the amount paid and payment reference, renewal (plans), the immediate-start request word for word with its version and time (copied from `checkout_consents`), the withdrawal information and the model form, the Terms and Billing terms versions with links, the statutory-rights line and the seller. The database refuses a text that does not quote the payment reference and the accepted request. The same text is shown under Billing › Purchase confirmations and included in the account export. Off until `MAKEBORNE_PURCHASE_CONFIRMATIONS_SINCE` is set; mail goes out only with `MAKEBORNE_TRANSACTIONAL_MAIL_ENABLED=true` and `RESEND_API_KEY`.

## Withdrawal function (CRD Art. 11a, applies from 19 June 2026)

`/withdraw` gives a "Withdraw from contract here" button that opens the notice (signed in: choose the purchase; signed out: the account's email and, optionally, the Whop payment reference) and a "Confirm withdrawal" button. The notice is stored with server time and a reference (`WD-…`), shown back in full on screen, and acknowledged by email with its content, date and time. The automatic acknowledgement goes to the account's own address, or to a typed address only when it matches the account that owns the referenced payment; every other notice is still stored and answered by support. A notice never refunds or revokes anything by itself: support refunds through the existing workflow within 14 days.

## Footer links

Every public page and the auth, help, billing and studio settings footers: Terms · Privacy · DPA · Legal notice (plus Billing terms where billing is shown).

## Cookie notice

None needed today: the only cookies are strictly necessary sign-in and preview cookies, analytics is cookieless, and published sites set no cookies of ours. Before any ad pixel, conversion tag or third-party analytics: add a consent banner that blocks them until consent, with "Reject" as easy as "Accept", and update section 6 of the Privacy Policy.
