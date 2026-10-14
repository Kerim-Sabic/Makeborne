# Billing launch contract review — 2026-10-13

**Not launch-ready.** Credit-pack checkout/delivery/recovery is implemented locally and gated. Owner-required subscription switching remains unimplemented and its provider contract unqualified. This review corrected stale `docs/CREDIT_TOPUPS.md` and, after root expanded ownership, fixed two bounded runtime defects. No flags, SQL, provider data, deployments or production state were changed by this package.

## Findings and local corrections

### 1. Resolved credit-pack requests could return an already-used checkout URL — fixed locally

The database intentionally returns the immutable order for a matching request even after fulfillment (`supabase/migrations/20261013110000_durable_topup_fulfillment.sql:85`). Previously `topup-checkout.ts` returned any saved URL without considering order state. A reused browser request could therefore be sent back to pay for an already-funded, held or reversed order.

`src/lib/billing/topup-checkout.ts:13` now requires the known database state and refuses anything except `awaiting_payment` before returning a URL (`:24`), including a changed claim-resume response (`:44`). The error is `CREDIT_PACK_CHECKOUT_RESOLVED` with HTTP 409. Existing awaiting-payment retries, idempotency and saved-checkout recovery remain intact. Regression cases cover all three refused states with/without a saved URL and after a claim response; missing state is refused.

**Remaining limitation:** this closes app reissue of a resolved link. It cannot revoke a URL already exposed to the customer or guarantee that Whop rejects another payment through it. The SQL rejects a second successful payment ID on an order (`20261013110000_durable_topup_fulfillment.sql:185`); prevention or audited recovery/refund of an actual second charge must be qualified before launch.

### 2. Subscription reconciliation reported success after incomplete processing — fixed locally

The old final status considered only thrown failures and time exhaustion. A provider plan/ownership mismatch, unknown credit rule or incomplete payment scan could be counted and skipped while the job persisted `succeeded`.

`src/lib/billing/reconcile-job.ts:121` now reports `partial` for each of those conditions, skipped payment evidence and a known due-membership backlog. A single-row lookahead (`:67`) detects backlog at a page/cap boundary. Safe binding rejection is unchanged (`:80`). Existing complete runs remain successful; database failures remain failed. Regression cases isolate each issue without another failure masking it, check persisted job status/statistics, and distinguish exactly-at-cap completion from remaining work.

This reports incomplete work accurately; it does not implement plan-change reconciliation, repair a binding mismatch or configure alerts.

### 3. Sandbox top-up navigation rejected a valid server response — fixed locally by root

The server's sandbox checkout URL was refused by the browser's production-only origin check. Root added `src/lib/billing/checkout-navigation.ts` and wired it into `src/components/billing-topups.tsx`. Exact HTTPS `whop.com` checkout URLs remain accepted; `sandbox.whop.com` is additionally accepted only from a loopback app origin. Credentials, nonstandard destination ports, malformed paths and spoofed hosts are refused. The server sandbox configuration is still more restrictive and remains authoritative.

Independent source inspection found no concrete issue in root's helper or its 28-check harness. Root ran that harness and focused lint. This agent did not claim an actual sandbox checkout UI purchase.

## Remaining credit-pack launch gates

| Gate | Concrete evidence / customer effect | Smallest next step |
| --- | --- | --- |
| Tax/promotion delivery | `src/lib/billing/topup-fulfillment.ts:72` refuses nonzero tax, refunded tax, promos or total differing from subtotal. `topup-checkout.ts:15` validates price/type/trial but does not block those checkout outcomes. A taxed paid purchase would fail delivery. | Obtain sanitized pinned-version payment/full/partial-refund fixtures, establish exact principal arithmetic and implement it before opening taxed sales. |
| Abandoned/ambiguous checkout recovery | SQL `:44` permits one awaiting purchase; `:93` blocks another pack; `:125` stops ambiguous retries after three attempts/two minutes. There is no cancelled/expired order state or automatic provider reconciliation for an unbound checkout. | Define and exercise a support recovery procedure that proves provider link/payment state before releasing or rebinding the order. |
| Exposed checkout reuse | SQL `:185` rejects a different successful payment on the same order. The local resolved-link fix does not disable already-issued provider links. | Qualify provider reuse semantics and implement prevention or explicit refund/recovery for an extra charge. |
| Scheduled recovery / alerts | `src/app/api/cron/topup-reconcile/route.ts:13` has separate reconcile/migration gates and a health route; `vercel.json` has no schedule. Prior evidence lists scheduling/alerts as unconfigured. | Configure the chosen scheduler/alerts in the authorized staging package, then demonstrate recovery of a missed payment and refund. Do not infer external scheduler state solely from the file. |
| Customer post-payment state | Follow-up local package now reads the return order through an authenticated owner-scoped RPC and renders bounded pending/delivered/under-review/refunded status with balance refresh. The original ignored-order defect is fixed locally; full receipt/history browsing remains separate. | Apply the additive `20261013230000` migration only in an authorized candidate rehearsal and qualify actual HTTP/auth plus signed sandbox delivery. Mocked UI and isolated SQL tests are not payment proof. |
| Signed provider lifecycle | `topup-delivery-20261013.json` records actual local SQL/RPC/concurrency with mocked Whop. `whop-topup-checkout-probe.json` records real checkout creation/idempotency, without purchase. | Perform one authorized app-bound sandbox pack purchase, signed delivery, full/partial refund and recovery sequence against the exact candidate; retain signatures/status/evidence without secrets. |
| Commercial and rollout qualification | Pack terms still need final expiry/refund handling; current implementation records consumed refund exposure for support and preserves non-expiring top-up lots. Current 58-migration local rehearsal is distinct from cloud qualification. | Confirm the implemented pack terms, finish the exact candidate rehearsal and retain compatible delivery/refund handlers after any exposed link. |

SQL line references in this table refer to `supabase/migrations/20261013110000_durable_topup_fulfillment.sql`.

## Current official Whop switching contract

Read-only official documentation was retrieved on 2026-10-13. No provider mutation or unsupported endpoint probe was made.

- The stable membership PATCH request body exposes only `metadata`. Its documented response has `manage_url`, described as supporting customer billing management including plan changes. This is a lead to qualify a customer portal path, not evidence of Makeborne tier/cadence/proration semantics. [Stable membership update](https://docs.whop.com/api-reference/memberships/update-membership.md), [membership retrieval](https://docs.whop.com/api-reference/memberships/retrieve-membership.md).
- The beta PATCH exposes `billing_period_days`, `cancel_at_period_end`, `metadata` and `payment_method_id`. It does not define a target plan/variant, target price or upgrade-proration request. Its cadence edit changes the period end and future cadence under stated eligibility constraints. That alone does not purchase Makeborne's annual offer. [Beta membership update](https://docs.whop.com/api-reference/beta/memberships/update-membership.md).
- The seller's documented membership actions include cancellation, termination, payment pauses, added days, promotions and transfer; the page does not define a tier-switch contract. [Manage users](https://docs.whop.com/manage-your-business/manage-payments/manage-users.md).
- The existing local investigation observed seller price adjustment effective at the next cycle with no proration, and no target-tier selector. This is historical observed UI evidence in `plan-switching-qualification-20261013.md`, not a new UI observation in this review.

**Conclusion:** the reviewed public API contracts do not establish the required paid tier-switch lifecycle. Do not repeat the older categorical claim that no switching capability exists anywhere: `manage_url` explicitly mentions plan changes. The next step is to qualify that exact portal capability or obtain Whop's supported merchant contract, including plan identity, charges, timing, failure, refund and proration behavior. Keep the application's pinned `2025-01-01` version (`src/lib/billing/whop.ts:7`); the current stable/beta documentation is not proof of the pinned response contract.

## Makeborne switching implementation gaps

- `src/components/creation-plans.tsx:101` explicitly says switching is unavailable. Existing memberships block another checkout through the current UI/API/SQL protections; cancel-and-repurchase is not an implemented switch.
- A same-membership provider plan change would fail current bindings: `src/lib/billing/access.ts:42` requires the original plan; `src/lib/billing/webhook.ts:75` returns `CHECKOUT_PLAN_MISMATCH`; `src/lib/billing/reconcile-job.ts:80` skips it. The corrected job now reports this as partial. These checks must remain strict until a durable authorized transition can distinguish a supported switch from a mismatched purchase.
- No account-bound switch request records original/target plan, effective boundary, provider transition identity and recovery state. A replacement membership can receive its own allowance; existing per-membership allocation tests do not establish one account allowance across replacements.
- The minimum switch package needs an established provider contract, immutable request/history, account-level overlap policy, explicit upgrade/downgrade and monthly/yearly rules, idempotent recovery, and signed sandbox events covering failure/duplicate/out-of-order boundaries. See the existing `plan-switching-qualification-20261013.md` for the proposed allowance rules; do not silently substitute an arbitrary adjustment grant.

## Provider evidence and future events

`whop-credit-delivery.json` contains historical real signed subscription activation/payment evidence, concurrent replay, cancellation and a first annual allocation. It does not qualify a pack purchase or the current changed candidate. Later current-configuration qualification remains necessary.

Root's read-only `whop-probe-readback-20261013.json` at 07:14:58Z finds both renewal probes still `trialing`, with an empty completed payment scan. Their trial ends are October 14 at 00:08:59Z and 00:10:27Z. These future first charges and subsequent weekly renewals have not been observed in that evidence. Trial completion is distinct from a later renewal cycle. The sandbox key expiry before the expected weekly-renewal observation remains an operator prerequisite recorded in project status.

## Validation and handback

This agent ran eight existing offline harnesses successfully before the runtime fixes: top-ups, provider normalization, checkout, delivery, top-up reconciliation, webhook delivery, creation checkout contract and creation offers. After the changes, the updated top-up checkout harness and all 11 subscription reconciliation groups passed. Focused ESLint over the four owned runtime/test files and `npx tsc --noEmit --incremental false` passed. Whop/database dependencies were mocked in these harnesses. No SQL tests, real payment, browser purchase, scheduler or cloud rehearsal were run by this agent.

Files owned/changed by this package: `docs/CREDIT_TOPUPS.md`, this report, `src/lib/billing/topup-checkout.ts`, `src/lib/billing/check-topup-checkout.cjs`, `src/lib/billing/reconcile-job.ts`, `src/lib/billing/check-billing-reconcile-job.cjs`. Root separately owns the navigation helper/component/check. Shared status and handoff files were left to root. All package files are handed back; preserve shared uncommitted work.
