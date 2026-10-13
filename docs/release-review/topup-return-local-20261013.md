# Credit-pack return flow — local qualification

Date: 2026-10-13. Scope: local implementation and tests only. No paid calls, provider mutations, cloud uploads, credentials, production changes or deployments.

## Customer behavior

The billing page now reads its `topup` return parameter and displays a purchase status. A URL cannot assert successful payment. The authenticated API reads durable order state and returns only order ID, pack ID, frozen credit/price amounts, currency and a normalized state.

- Pending: serialized checks, at most 20 attempts and 60 seconds per checking session; each request has an 8-second timeout. Manual retry starts a fresh bounded session.
- Delivered: confirms the recorded grant and refreshes the mounted credit balance. It does not infer remaining spendable credits from the original pack size.
- Under review: avoids promising delivery and offers retry/support.
- Refunded: reports the recorded refund and directs the customer to their actual current balance/support.
- Signed out, missing order, malformed data and temporary failures have explicit safe states. Sign-in preserves the return order.

Timers and in-flight requests are cleaned up on order changes/unmount. Balance refresh events are deduplicated by the last observed state of each order; a subsequent hold-to-delivery transition refreshes again. The shared balance component now ignores superseded responses before changing state or invoking its callback.

## Security and database boundary

`GET /api/billing/topups/[orderId]` verifies the account, passes the server-authenticated user ID to a service-only read RPC, and applies private/no-store caching on success and failure. Missing and other-account orders have the same response. No creation plan is required to read an existing purchase. Status polling never contacts Whop, grants credits or runs reconciliation.

Migration `20261013230000_read_topup_order_status.sql` is additive, stable and read-only. A private definer with an empty search path reads the exact user/order pair; the public invoker is executable only by the service role. It adds no table grants. The main local database and cloud databases were not migrated in this package.

## Evidence and limits

- Endpoint/auth/projection/error/cache checks: 9 groups, independently rerun by root.
- Actual SQL: 3 groups on a disposable schema clone, including all eight stored state/granted combinations, service-role execution, account separation, historical amounts, permission denial and unchanged orders/lots/ledger. Fixtures rolled back and the clone was removed.
- 24 real React browser groups passed and were independently rerun by root. These use the shipped status and balance components with synthetic same-origin API responses, including the displayed balance through delivery/hold/release. They are not full-app authentication or signed payment-delivery tests. Screenshots and detailed cases are in `work/topup-return-browser/`.
- Root visually reviewed desktop and 375px mobile fixtures. Fixtures use installed local Inter; they do not represent a complete billing-page integration screenshot.
- Combined offline checks: 103/103 passed, five environment/live checks explicitly skipped. The first run exposed an existing pricing fixture's missing boundary for the new child component; that fixture now includes the boundary and asserts absent/valid/invalid order wiring. The full rerun passed. Logs: `work/local-topup-return-checks-final.log`.
- Final Next build/TypeScript and focused changed-file lint passed. Logs: `work/local-topup-return-build-final.log`, `work/local-topup-return-lint-final.log`. Claude's concurrent CRM/chat source remains in progress; the passing check window is not a frozen whole-app candidate.
- All 59 migrations passed normal/failure/interruption rehearsal with 117 SQL PASS groups and fingerprint `7af413faf58c21a69b723261b4cb1d11`. All84 consumed inputs were unchanged. The earlier58 report is preserved and all three owned containers were removed. See `candidate-rehearsal.json` and `candidate-rehearsal-cleanup-20261013-100814.json`.

## Release order and remaining gates

Apply the additive migration as part of the approved exact-candidate rollout before shipping the API. Missing RPCs fail with a generic unavailable state, never a fabricated success. App rollback can leave the additive read functions in place; no order or credit history should be deleted to roll back this UI.

Still required: actual HTTP/auth integration on the candidate, signed app-bound sandbox payment/refund delivery, tax/promotion normalization, exposed-checkout duplicate-charge behavior, abandoned-order recovery, scheduler/alerts and the supported plan-switching contract. Full receipt browsing is separate from this one-order return screen. Pack checkout remains gated. Cloud publication/image qualification remains on hold under the owner's local-only decision.
