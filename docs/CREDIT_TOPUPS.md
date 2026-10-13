# One-time credit packs

Updated 2026-10-13. **Implemented locally, closed by default, not qualified for launch.** Checkout, durable credit delivery and recovery adapters exist. Passing offline checks do not establish a real signed purchase/refund lifecycle. Current release status is in `PROJECT_STATUS.md`; the bounded audit is `release-review/billing-launch-contract-20261013.md`.

## Customer contract

An account with a verified creation membership can buy extra account credits without changing its plan. Packs do not buy membership access, seats, storage or hosting allowances. The separate $1/month support contribution does not qualify a customer. There is no recurring refill or automatic charge.

Preview USD prices before applicable tax:

| Pack ID | Credits | One-time price |
| --- | ---: | ---: |
| `boost_100` | 100 | $12 |
| `boost_300` | 300 | $32 |
| `boost_1000` | 1,000 | $95 |

The durable implementation creates non-expiring top-up lots. Full refunds withhold the unspent remainder; partial refunds and open/lost disputes hold the pack for review. Already-consumed credits are recorded as support exposure, without subtracting unrelated credits or creating a negative wallet. Publish and approve these pack-specific terms before sales. Tax/promotion fulfillment remains unsupported below.

## Availability and checkout

`topups-catalog.ts` is client safe and exports the fixed catalogue, version history, display prices and `{ available, reason, authenticated, eligible }` response type. `GET /api/billing/topups` returns private, non-cacheable availability. Eligibility means verified creation access; it does not establish checkout qualification.

`topups.ts` requires all of the following to open checkout:

- Configured and enabled creation billing.
- `WHOP_TOPUPS_ENABLED=true` and `MAKEBORNE_TOPUP_MIGRATIONS_VERIFIED=true`.
- `MAKEBORNE_TOPUP_CHECKOUT_QUALIFIED=true`, or the explicitly local sandbox test exception.
- All three enabled database catalogue rows matching the current version, merchant, credit quantities and prices.

`MAKEBORNE_TOPUP_SANDBOX_TEST=true` can substitute for checkout qualification only when `billingConfig()` permits the isolated sandbox: no Vercel, local Supabase API `http://127.0.0.1:55435`, explicit sandbox enablement and a distinct matching sandbox merchant. It cannot open live sales. Flags record operator qualification decisions; setting them does not prove qualification.

`POST /api/billing/topups` accepts only `{ packId, requestId }` with a catalogue ID and UUID. It requires same origin, a bounded body, confirmed sign-in and creation access. Price, credits, plan and account identity are server-owned. Closed gates return `503 TOPUPS_NOT_OPEN`. When open, the server requires one recently verified Whop identity for that account and prepares a frozen purchase before contacting Whop.

`topup-checkout.ts` verifies a one-time USD plan with the exact initial price, zero renewal price and no trial. A durable claim stores the original provider request; checkout creation uses an explicit idempotency key and has no automatic POST retries. The returned ID and URL are saved before a link is returned. Ambiguous attempts are limited to three, at least 15 seconds apart, within two minutes; older ambiguity requires operator recovery. Another request for the same open pack resumes it; a different pack is blocked while a purchase is open.

Only `awaiting_payment` orders may return a checkout link. Funded, held and reversed requests fail with `CREDIT_PACK_CHECKOUT_RESOLVED`, including claim-resume responses. An already-exposed external URL still needs provider reuse prevention/recovery qualification. Browser navigation permits exact Whop checkout URLs; sandbox destinations are accepted only from a loopback app origin. The server's stricter sandbox configuration remains authoritative.

## Payment delivery and database controls

`topups-contracts.ts` validates the frozen account/catalogue/merchant/plan/checkout/Whop-user binding and bounded exact integer strings. `topups-reconcile.ts` remains a pure proposal and binding validator; it does not fund balances itself.

`topup-fulfillment.ts` normalizes freshly retrieved provider evidence under the application's pinned `2025-01-01` API version. It requires exact USD principal, one-time billing, matching ownership and recognized payment/refund/dispute states. **Nonzero tax, tax refunds, promotions, or a total different from subtotal are refused.** Checkout currently does not independently prevent those provider charges, so general taxed sales must stay closed until their contract is implemented and qualified.

`topup-delivery.ts` looks up the frozen database order, normalizes current provider evidence and invokes the durable reconciliation RPC. `webhook.ts` runs this path after signature/merchant verification and before subscription lookup when the top-up migration gate is enabled. Event payloads identify payments; they never supply authoritative credit amounts. Known packs missing their order binding return a retriable error.

`supabase/migrations/20261013110000_durable_topup_fulfillment.sql` provides:

- Disabled-by-default, append-only catalogue terms; unique account/request, checkout, funded payment and credit-lot bindings.
- Private tables with RLS and service-only wrappers; the funded wallet belongs to the purchasing account, not a browser-selected workspace.
- Wallet-first locking, atomic order state/observation/lot/ledger changes, duplicate/stale/conflicting evidence handling and refund-before-success protection.
- Failed/pending attempts that do not permanently bind the order, allowing a different successful retry.
- Release of active reservations before withholding a disputed/refunded lot, plus auditable consumed-credit exposure and hold restoration.

Top-up atomicity comes from the RPC's order/observation/ledger transaction. The top-up webhook branch returns before the generic subscription event-receipt table; repeated signed events are reconciled using payment evidence and database uniqueness. It is not one combined transaction with the generic webhook receipt.

## Recovery and remaining launch gates

`/api/cron/topup-reconcile` has constant-time bearer authorization, separate reconcile/migration gates, a leased bounded queue, durable scan cursors and health reporting. It refreshes funded payments for refunds and scans merchant/checkout-bound payments for missed delivery. Failed or unfinished pages do not advance beyond undelivered evidence. Closing new sales does not disable refund delivery or reconciliation.

Before enabling packs:

1. Qualify the actual signed, app-bound sandbox purchase/refund lifecycle using the pinned version, including tax and refund allocation. Existing real probes created a hidden one-time plan and idempotent checkout configurations; they did not purchase a pack.
2. Establish that an exposed checkout cannot collect an unsupported second payment, or implement an audited recovery/refund path. The current order accepts one funded payment; a second successful payment with another ID is refused.
3. Add verified recovery for interrupted/unbound and abandoned checkouts. There is no cancellation/expiry state for an awaiting order; it continues blocking a different pack. Never clear a local binding while an external link can still accept payment.
4. Configure and prove the scheduler and alerts. The endpoint and health query exist; `vercel.json` contains no cron schedule and existing evidence does not establish an external scheduler.
5. Qualify the new authenticated purchase-status return flow on the exact staging candidate after migration `20261013230000_read_topup_order_status.sql`. The local implementation reads pending/delivered/under-review/refunded state without granting credits or contacting Whop, and refreshes the balance on observed state changes. Local mocked browser and disposable SQL checks do not prove signed payment delivery. Full receipt/history browsing remains separate work.
6. Finalize catalogue/pack terms and rehearse the exact combined cloud candidate. Local database checks do not qualify cloud credentials, webhook configuration or deployment.

Once a URL has been exposed, rollback must preserve compatible pack delivery, refund handling and reconciliation. Disabling app sales does not invalidate existing Whop links. Preserve order, observation, lot and ledger history.

## Verification boundaries

The offline harnesses `check-topups.cjs`, `check-topup-fulfillment.cjs`, `check-topup-checkout.cjs`, `check-topup-delivery.cjs`, `check-topup-reconcile-job.cjs` and `check-webhook-delivery.cjs` cover contracts and mocked integrations. They were run successfully during this audit. The updated checkout harness also covers funded/held/reversed refusal and awaiting-payment recovery.

`release-review/topup-delivery-20261013.json` records earlier disposable SQL, actual service-role RPC/ledger and concurrency checks with mocked Whop. Those database checks were not rerun for this update. `release-review/whop-topup-checkout-probe.json` records the real idempotent sandbox checkout-creation probe. Neither proves paid pack delivery. Later overall migration rehearsal status is in `PROJECT_STATUS.md`; the older package report's migration count is historical.

References: [Whop checkout configurations](https://docs.whop.com/api-reference/checkout-configurations/create-checkout-configuration), [payment retrieval](https://docs.whop.com/api-reference/payments/retrieve-payment), [signed webhooks](https://docs.whop.com/developer/guides/webhooks).
