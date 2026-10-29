# Six-plan sandbox qualification — 25 October 2026

## Result and boundary

Six real Whop sandbox purchases PASS on staging runtime e8ccef9, deployment dpl_DQeybc5KJAy7MMPdWf1aQuZKDY4R. Owner explicitly approved accepting all six terms, fake4242 submission and refund/cancel cleanup. No real money, paid AI, production writes, merge or production deploy.

| Offer | Actual test payment | First allocation | Cleanup |
|---|---:|---:|---|
| Create monthly | $20 | 300 | Fully refunded; cancelled |
| Create yearly | $192 | 300 | Fully refunded; cancelled |
| Studio monthly | $49 | 750 | Fully refunded; cancelled |
| Studio yearly | $470.40 | 750 | Fully refunded; cancelled |
| Scale monthly | $99 | 1,550 | Fully refunded; cancelled |
| Scale yearly | $950.40 | 1,550 | Fully refunded; cancelled |

## Actual checks

- Six separate confirmed non-admin staging accounts; actual authenticated checkout route bound each checkout to its own account and exact offer. No external signup email involved.
- Browser Whop checkout showed the correct amount before submission. Actual pinned provider reads verified company, payment, membership, plan, currency and principal.
- Provider's original webhook remained disabled. Actual authenticated staging checkout-status recovery discovered each payment, recorded funding and granted its exact first monthly allocation. Annual plans did not grant twelve allowances upfront.
- A repeat subscription attempt on the funded Create account returned SUBSCRIPTION_ALREADY_EXISTS. A different account's checkout lookup returned CHECKOUT_NOT_FOUND.
- Each exact payment was fully refunded through the sandbox API; each exact membership was immediately cancelled. Requests were journalled before mutation, with no blind retries. Provider reads verified all six refunds and cancelled memberships.
- Six manually signed refund notifications went through the deployed webhook route and fresh provider reads. SQL then showed reversed payment principal, matching full refunded cents, cancelled memberships and net zero ledger credits for every account.
- Actual deployed webhook route rejected invalid signature (INVALID_WEBHOOK) and wrong merchant (WRONG_MERCHANT). Duplicate refund notification and delayed payment.succeeded notification were accepted idempotently; a subsequent read-only SQL check still showed zero credits and reversed funding.
- Six authenticated checkout-status calls after refund reported pending with no studio destination. These refunds did not retain active creation access.

## Cleanup

Six fixture accounts banned; refresh tokens and sessions removed for exactly those six staging user IDs. Local fixture passwords and session cookies deleted. Financial test records retained. Loopback-only checkout redirect helper stopped. Older monthly renewal probes were not changed, cancelled or refunded.

## Evidence provenance

Ignored work/qualification evidence: all-six-funded.json; six-provider-cleanup.json; six-manual-webhook-receipts.json; webhook-boundary-results.json; all-six-reversed.json; refunded-access-results.json; wrong-account-result.json; fixture-retirement.json. These are operator evidence, not credential files to publish. No secret is included in this report.

## Not proven by this pass

- Provider-initiated automatic delivery: the accepted notifications were deliberately manually signed and labelled as such. The existing disabled provider webhook did not deliver these events.
- Scheduled reconcile/health: billing reconcile is intentionally off on this preview.
- Actual scheduled renewal or failed renewal: the real November probes remain pending. Initial purchase is not renewal evidence.
- Partial refund, dispute and cancellation at period end on these new-price fixtures. Cleanup used immediate cancellation.
- Browser return page: sandbox checkout deliberately redirects to Whop's sandbox home. API recovery is qualified; the production Makeborne return-page journey is not established by it.
- Production plan IDs, opening provider spend limits, ordinary paying-workspace publishing and final owner go. Production payments remain closed.

## Budget

No new deployment, VM, paid AI call, subscription or real-money purchase. Existing $1 cloud reservation covers the previously submitted staging build and this checkout qualification; actual provider charge is still pending accounting. No unused remainder is assumed.
