# One-time credit packs

Status: prepared contracts and preview catalog. **No credit pack can currently be purchased.** This is separate from the existing $1/month support contribution and from recurring creation memberships.

## Customer experience

An active creation member can eventually add credits without changing their membership. A credit pack will not upgrade seats, storage, hosting allowances, or membership access. The account must have a verified creation membership to purchase; buying support does not qualify.

Proposed USD prices, before any applicable tax:

| Pack ID | Credits | One-time price |
| --- | ---: | ---: |
| `boost_100` | 100 | $12 |
| `boost_300` | 300 | $32 |
| `boost_1000` | 1,000 | $95 |

These are previews, not validated margins or live offers. Cost measurements, failed-job expense, payment fees, refund policy, credit expiry and consumer terms must be finalized before sales. There is no automatic recurring top-up or automatic charge.

## UI and API contract

`src/lib/billing/topups-catalog.ts` is client safe and exports:

- `CREDIT_TOPUP_PACKS`: `{ id, label, credits, priceCents }[]` with integer display values.
- `CREDIT_TOPUP_CATALOG_VERSION`, `CREDIT_TOPUP_CURRENCY`, `creditTopupPack(id)`, and `formatCreditTopupPrice(priceCents)`.
- `CreditTopupAvailability`: `{ available, reason, authenticated, eligible }`.

`GET /api/billing/topups` returns that availability object with private, non-cacheable headers. `eligible` means the signed-in account currently has verified creation access, not that the checkout has opened. Provider failure returns an ineligible/unavailable response. `available` is always false until an actual fulfillment adapter is implemented; no environment flag can turn this into a selling endpoint.

`POST /api/billing/topups` accepts only `{ packId, requestId }`, with a catalog pack ID and UUID request ID. It enforces same-origin requests, a bounded body, confirmed sign-in and active creation membership. Extra price, credit, account, plan or payment fields are rejected. A valid eligible request currently returns `503 TOPUPS_NOT_OPEN` without contacting Whop or recording a grant.

## Implemented pure contracts

`topups-contracts.ts` validates a server-owned purchase snapshot against its fixed catalog version. Stored accounting uses bounded exact decimal integer strings. A future trusted adapter must bind the Supabase user, credit account, catalog snapshot, approved one-time Whop plan, checkout configuration and Whop user before checkout is shown.

`topups-reconcile.ts` accepts that trusted purchase, optional previously stored state, and normalized current payment evidence. This function creates **proposed effects**, not funded balances:

- A verified paid purchase proposes one grant with a stable key based on its provider payment ID.
- Duplicate evidence produces no effects; older evidence is ignored. Conflicting evidence at the same provider revision/time or decreasing successful-refund totals requires reconciliation.
- Merchant, plan, checkout, customer, original USD principal and currency must match exactly. Payment IDs cannot change once bound.
- A full refund reverses the original grant once. Refund-before-success records a non-funded tombstone, preventing a late success event from granting credits.
- Open/lost disputes and partial refunds hold the purchase for review. A successful dispute resolution releases its hold without granting the purchase again. Partial-refund allocation is deliberately not invented by the function.

`grant` and `reversal` effects carry exact credit amounts. `hold` and `release_hold` are purchase-level controls and intentionally carry **no amount**: they mark/unmark the credit lot's eligibility, including when the purchase has not been granted yet. A full refund of a held purchase emits its reversal and releases the hold together; the transaction must commit both atomically so no reversed credits become spendable between effects. The final reversed state remains ineligible independently of a hold.

The evidence schema is not proof of payment. Never expose it as an HTTP request body accepted from a browser, and never pass a raw webhook into reconciliation. Signature checks and fresh provider retrieval belong in a trusted adapter. The adapter must include current successful refunds and disputes, and use their authoritative revision/timestamps rather than delivery order.

## Required fulfillment work before checkout opens

1. Create and verify dedicated **one-time** Whop plans for the approved catalog. Keep them unavailable until delivery verification passes. Never reuse a coffee or creation subscription plan, and never trust a browser-provided plan mapping.
2. Implement durable top-up purchase records and a funded credit ledger. Choose the account/workspace allocation rules explicitly; the current `creditAccountId` is a trusted server binding, not a workspace supplied by the browser.
3. Reserve a unique `(account, requestId)` purchase before checkout creation. Persist its immutable account/catalog/checkout binding before returning a URL. Provider timeouts require reconciliation, not blind checkout recreation.
4. Configure signed Whop events and verify current paid status, original currency, original principal, plan type, merchant, checkout and customer. Tax and processor fees must not be mistaken for credit principal. Unsupported currency conversion, discounts, quantities or partial payments must fail closed until deliberately supported.
5. Commit the reconciliation state, ledger effects and webhook receipt in **one database transaction**. Lock/check the purchase revision; enforce globally unique provider payment IDs and ledger event keys. A database transaction, not the pure function, supplies concurrency safety.
6. Integrate funded credit lots with reservation, usage and expiry. Enforce holds before work starts. A refunded grant that was already consumed needs an explicit debt/recovery or loss policy; insufficient wallet balance must not silently skip the reversal. Partial refunds and lost disputes need an approved allocation/settlement policy.
7. Verify delayed/duplicate/out-of-order events, concurrent purchases, refund before payment delivery, failures between provider response and database commit, transferred membership/customer mismatch, consumed-credit refunds, exhausted retries, and abandoned checkouts with Whop's supported test flow.
8. Connect purchase status, receipt/history and balance refresh in the UI. Publish final pricing, credit expiry, refund/cancellation terms and support contact. Only then replace the hard-closed availability with measured health checks for the installed fulfillment path.

Current job spending limits/reservations are not a funded customer wallet. Adding Whop credentials or a balance label does not fulfill this work. Creation memberships remain necessary independently of any credit balance.

## Verification

`node src/lib/billing/check-topups.cjs` runs offline catalog/input/binding, grant/refund/dispute, duplicate/stale evidence, unavailable-provider, and route authorization checks. The fixtures make no network requests, create no products, and charge nothing. They do not demonstrate live credit delivery or database atomicity.

References: [Whop checkout configurations](https://docs.whop.com/api-reference/checkout-configurations/create-checkout-configuration), [payment retrieval](https://docs.whop.com/api-reference/payments/retrieve-payment), [signed webhook delivery](https://docs.whop.com/developer/guides/webhooks).
