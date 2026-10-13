# Billing implementation evidence — 2026-10-13

## Implemented in this package

`src/lib/billing/topup-fulfillment.ts` converts retrieved Whop payment evidence into the existing strict top-up contract. It reuses `reconcileCreditTopup` for purchase binding rather than creating another ledger/state engine. Invalid identities, amounts/currency, recurring billing reasons, unknown payment/dispute states, contradictory outcomes and unqualified tax/promotion allocation are refused. Money uses integer cents without rounding. Retrieval verifies the requested payment ID and bounds GET retries.

`check-topup-fulfillment.cjs` verifies normalized once-only grant/replay through the real existing reconciliation code; full/partial refunds; conflicting dispute status; owner/merchant/plan/checkout mismatch; wrong currency; imprecise/sub-cent amounts; path injection and response-ID mismatch. It performs no network calls or real grants. Typecheck and focused lint pass.

This adapter is not connected to checkout yet. Required next package: durable purchase/payment uniqueness, atomic ledger lot grants/reversals/holds and state revision; RLS/service role permissions; expiry policy; verified one-time plan/checkout mapping; signed webhook and reconcile wiring; taxed sandbox payment/refund fixtures; real fake-card checkout; concurrent/replay/out-of-order checks. Checkout remains closed until those pass. Tax-free test coverage does not qualify worldwide taxed payments.

## Durable database package (local only)

Added `20261013110000_durable_topup_fulfillment.sql`: disabled-by-default, versioned packs; frozen purchase terms; unique request/checkout/payment/lot bindings; wallet-first atomic reconciliation; private RLS tables and service-only public wrappers. The file was created by the Supabase CLI, then sequenced after the existing 46 migrations. It has not been applied to the main local database, staging or production.

`check-topup-fulfillment.sql` passes six groups against `makeborne_topup_verify`, a separate disposable database in the isolated auth stack. It verifies closed checkout, immutable prices and purchase binding, ownership, one-time grant, duplicate/stale/conflicting evidence, dispute hold release and restoration, partial/full refund, consumed-credit exposure, refund before delivery, ledger balance and permissions. All SQL fixtures roll back.

`check-topup-concurrency.cjs` passes against the same named disposable database: eight simultaneous deliveries produce one 100-credit lot, one grant and one observation. Fixtures are deleted afterwards; account and ledger tables are empty. No paid provider calls are involved. The focused billing suite passes 10/10.

Refunds after consumption record the already-spent amount as an exposure for support review; they do not invent a negative wallet or take credits from unrelated lots. Remaining pack credits are withheld. Top-ups preserve the existing non-expiring lot policy. These policies still need commercial review before checkout activation.

Still missing: checkout/database adapter integration, signed webhook delivery and scheduled reconciliation, real one-time sandbox checkout and taxed/refunded fixtures, account rate limits, plan switching and cloud rehearsal of the new migration. The candidate inventory is stale after this package and Claude's admin/UI additions. This evidence is not a release approval.

### Delivery integration follow-up

`topup-delivery.ts` now converts frozen database purchases into the strict historical catalogue contract, retrieves fresh Whop payment evidence, checks merchant/ownership/amounts, and invokes the durable reconciliation RPC. `webhook.ts` routes top-up payment/refund/dispute events before subscription lookup only when `MAKEBORNE_TOPUP_MIGRATIONS_VERIFIED=true`. This setting must remain unset until the new migration is applied and rehearsed in the target environment. Delivery is independent of checkout enablement so closing new sales does not stop handling existing refunds.

Unknown non-pack payments fall through to subscription handling. Known pack payments arriving before their purchase binding return a retriable error instead of being acknowledged. The lookup RPC and private tables remain inaccessible to browser roles. No browser/event payload supplies credit amounts.

Verification: 78/78 offline harnesses, including new delivery and webhook routing checks; typecheck and focused lint pass. The whole new migration was re-applied from its exact current file to a fresh disposable schema, then six rolled-back SQL groups passed. `check-topup-delivery-e2e.cjs` exercises the real TypeScript adapter through actual service-role RPCs into actual lot/ledger tables, using a mocked provider only. Payment and refund replays pass. Eight simultaneous real database deliveries still grant once. Disposable fixtures are removed and packs return to disabled state.

Remaining above is updated: the server delivery branch is implemented, but live signed Whop-to-app delivery, missed-webhook reconciliation and checkout recovery are not qualified yet. No pack checkout is opened, no cloud migration/deploy is made, and no paid AI call is made.

## Checkout and bounded recovery follow-up

The public top-up route now invokes the server checkout adapter after authentication, strict input validation and creation-access checks. It stays closed by default: `WHOP_TOPUPS_ENABLED`, `MAKEBORNE_TOPUP_MIGRATIONS_VERIFIED` and `MAKEBORNE_TOPUP_CHECKOUT_QUALIFIED` all default false. The configured merchant and enabled creation billing are also required, plus all three enabled database pack rows matching the current historical catalogue. No local/staging/production activation settings were changed.

`MAKEBORNE_TOPUP_SANDBOX_TEST` permits qualification exercises without falsely setting the production qualification flag. It defaults false and is accepted only through billingConfig's isolated local sandbox gate (specific local Supabase URL, distinct sandbox merchant, no Vercel). A regression verifies it cannot open live sales. It has not been configured in any running app yet.

The server derives a single recently verified Whop purchasing identity from the signed-in account's subscriptions. Conflicting identities fail before checkout. The database freezes price, pack, merchant and user. An additional request key resumes the same open pack; a different pack is refused until the open purchase is resolved. The adapter verifies Whop's current one-time type, exact USD price, zero renewal price and no trial before creating checkout.

The database claims provider attempts atomically, stores the exact original request, and saves the returned checkout ID/URL. Eight concurrent claims admit one attempt. Recovery uses the same explicit idempotency header/body; a saved URL resumes without a provider call. Ambiguous attempts are bounded to three within two minutes, separated by at least 15 seconds. Older ambiguity requires operator reconciliation rather than assuming the provider's key retention. Automatic operator recovery, abandoned-checkout cancellation and reusable-checkout second-payment behavior remain unqualified.

Real Whop sandbox probe: `scripts/probe-whop-topup-checkout.mjs --prepare` created a hidden $12 one-time test plan under the Makeborne sandbox product. Two pinned-2025 checkout requests with the same explicit key/body returned the same ID. Whop also refused a changed request under a previously used key. Evidence is in `whop-topup-checkout-probe.json`. No purchase/card submission or real charge occurred. Source: [Whop's official checkout integration guide](https://whop.com/blog/integrate-checkout-api/).

The real TypeScript checkout adapter passes through actual service-role claim/save RPCs into the disposable database, with Whop responses mocked; resume makes no extra provider call. Delivery/refund replay and checkout/payment concurrency pass. Typecheck, focused lint and 12/12 billing harnesses pass. All test fixture accounts/ledger rows are removed and catalogue packs disabled afterward.

### Rollout and recovery constraint

Migration 47 is additive and not applied outside the disposable database. Before opening packs, rehearse it with migration 46 on cloud staging and qualify a real signed test purchase/refund, tax evidence, recovery and scheduled reconciliation. Re-freeze the candidate after both agents finish.

After any checkout URL has been exposed, do not roll the billing handlers back to a version that cannot deliver packs/refunds. Disabling app checkout does not by itself invalidate external Whop links. Keep compatible delivery/reconciliation running, disable new purchases and generation if needed, and fix forward. Never drop order/observation/lot/ledger history to roll back. An older application rollback is permissible only after verifying no exposed checkout/payment obligations exist, or after a verified migration of those obligations to a compatible handler. This is a remaining release gate, not a solved automatic recovery claim.

## Recovery job follow-up

Added `/api/cron/topup-reconcile` with the existing constant-time bearer check, no-store responses, disabled-by-default reconciliation and migration gates. New sales flags do not control this job. The health query reports job state, unresolved issues, unchecked purchases and already-consumed refund exposure. Scheduling and alerts remain unconfigured; this is locally verified implementation, not live delivery qualification.

The queue selects oldest-checked orders, carries a durable per-order payment-list cursor, and admits one leased job at a time. A stale or reclaimed worker cannot advance a cursor. Budgets/backlogs, skipped evidence and incomplete pages produce partial outcomes. A deadline or failed delivery never checkpoints beyond an undelivered page. Unbound interrupted checkouts remain explicit issues for operator recovery. Payment lists are merchant-scoped and checkout-filtered; every returned payment must also match plan and Whop user before its ID is passed to fresh retrieval/ledger reconciliation.

Two actual defects fixed: pending/failed payment attempts no longer permanently bind an order or block a later paid attempt with a different ID; clocks are compared within payment identity. A different failed attempt after funding is ignored without changing the funded snapshot. Also, subscription payment-list requests now supply company_id: the sandbox rejected the unscoped request and accepted the merchant-scoped request. The exact checkout filter was observed returning a real sample payment, evidence in `whop-payment-list-probe.json`. [Whop lists the checkout and pagination filters here](https://docs.whop.com/api-reference/payments/list-payments).

Evidence: 80/80 offline harnesses, 13/13 billing harnesses, typecheck and focused lint pass. Nine rolled-back SQL groups pass on a fresh disposable import of the exact current migration 47. The real queue/lease/checkout/delivery adapters through actual service-role SQL recover a missed payment and missed refund without any browser access, using mocked Whop responses only. Real sandbox calls were read-only. No credential permission changes, purchase or AI call occurred. The main local, staging and production databases were not modified.

Remaining: signed real sandbox checkout/payment/refund/tax qualification; scheduling/alerts; automatic provider reconciliation and abandonment cancellation for unbound checkouts; reusable checkout duplicate-payment handling; plan switching; image qualification; website/book/deck visual qualification; combined cloud rehearsal. Migration 47 remains unfrozen.

## Commercial copy (terms)

Removed prelaunch/founding purchase promises from `src/app/billing/terms/page.tsx` in accordance with owner D1. Standard monthly/yearly prices only; annual upfront billing and credit expiry remain explicit. Refund requests go through admin@makeborne.com, retaining mandatory rights/provider-policy exceptions. Terms version becomes 2026-10-13-standard-v5. No live prices/provider offers were changed.

## Provider sources

- Payment fields, one-time billing reason, creator subtotal/total, tax/refund fields, status: https://docs.whop.com/api-reference/payments/retrieve-payment
- One-time versus renewal plans: https://docs.whop.com/api-reference/plans/retrieve-plan
- Subscription start, renewal/cancellation, support refund and mandatory-rights exceptions: https://whop.com/buyer-terms/

These sources do not prove an in-place subscription-switch API or tax/refund arithmetic for our pinned version. Verify those using the sandbox before enabling them.

## Coordination

Claude acknowledged UI/admin/document ownership and a maximum $20 allocation; Codex maximum $20; reserve $10. New round spent $0. Do not freeze/deploy the combined candidate while edits remain active. Production/commit/push/merge remain on hold.
