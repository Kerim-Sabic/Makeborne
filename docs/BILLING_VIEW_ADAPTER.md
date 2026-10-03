# Billing view adapter contract

`/billing` currently renders an explicitly unavailable view. There is no authenticated balance loader or checkout action attached to this screen. Do not interpret the screen as enabled billing.

## Exact amounts

`BillingViewModel.unit` is the literal `whole_customer_credits`. `available`, `reserved`, `used`, and `BillingEntry.credits` are canonical non-negative decimal integer **strings**, or `null` for unavailable summary amounts. One stored customer credit is one displayed credit; no implicit cents, fractional-credit, or vendor-microdollar conversion is permitted.

The accepted magnitude matches `ExactAmountSchema`: `0` through `9223372036854775807`. Format with `BigInt` and `Intl.NumberFormat`, never `Number`, `parseFloat`, or two-decimal rounding. Invalid display input renders an unavailable dash, not a zero. If fractional credits are introduced later, version the unit contract and implement exact quotient/remainder formatting explicitly.

## Future authenticated server adapter

1. Authenticate the user and verify workspace membership before querying any account or ledger. Authorise billing management separately.
2. Read exact customer-credit strings from a transactional server-owned balance snapshot. Never use local-storage values, router estimates, browser totals, or vendor-microUSD as customer balances.
3. `available` must mean funded credits available after active reservations. A spending limit is not a funded balance. Do not map `customerLimitCredits` directly to available credit.
4. `reserved` is the active reservation total. `used` is the agreed period's settled charge aggregate, with refunds handled according to the published accounting policy. Compute aggregates in the database or with exact integers, with the period explicitly supplied in `period`.
5. Map ledger rows to positive exact `credits` magnitudes and explicit statuses (`Charged`, `Refunded`). Map active holds/releases from reservation events to `Reserved`/`Released`; those events are not charges. Preserve immutable event IDs and project/model provenance. Do not invent ledger records from a quote.
6. Map supported capabilities to visible categories: website/book/presentation creation to `Creation`; image/video/clipping/transcription to `Media`; deployment/runtime to `Hosting`; research to `Research`. Unknown capabilities need an explicit mapping before display.
7. Keep unavailable data null. Do not replace failed fetches or unauthenticated state with a zero balance or a success-shaped empty account. Use the unavailable state until the server adapter and failure UI are implemented.
8. Before enabling checkout, replace proposed cards with a server-approved product catalogue, authoritative price IDs, explicit currency/interval/tax presentation, and authenticated checkout/portal actions. Validate payment webhooks and reconcile ledger funding independently of redirect success.

The `ready` view now renders connected usage copy, while purchase and portal controls stay disabled independently. `src/lib/billing/view.ts` validates the display boundary: ready balances must all be exact strings, a period is required, event IDs must be unique, and invalid snapshots become unavailable with no rows. This validation does not authenticate or authorise data; the server adapter is still required.

The usage download is JSON to retain exact credit strings. It exports only loaded entries matching the selected category/search, labels that limited coverage, and is not an invoice or complete account ledger. It is disabled when unavailable or no matching entries exist. No client-side sum is used to infer a funded balance.

Verification: 17 offline checks cover precision, zero vs unavailable, invalid units/dates/amounts, duplicate rows, filters, and exact statement export. Focused lint and TypeScript passed. Browser inspection confirms the unavailable screen keeps export and purchases disabled. A real authenticated snapshot, database accounting, and a live download from that account remain unverified.
