# Creation purchase UI qualification — 2026-10-13

Local implementation only. No provider writes, database changes, paid calls, flags, deployment or commits.

## Implemented

- `/api/billing/availability` returns only authenticated/member booleans and public tier, cadence, total and monthly credit allowance. Responses are private/no-store. Provider IDs, keys and configuration diagnostics are omitted.
- Offers resolve from the existing creation catalogue and credit-map configuration. Unknown, malformed or ambiguous tier/cadence mappings fail closed. No annual provider IDs were invented or created.
- A purchasable offer requires the existing application gate, database allowlist, and matching provider merchant, USD recurring price, cadence (30/365 days), no trial or initial fee, buy-now release and available stock. The POST rechecks the same contract and rejects browser amount fields.
- The pricing component stays disabled until availability confirms the displayed standard price and allowance. It retains selection and an idempotency request key through sign-in, retries and refresh. Returning from sign-in requires an explicit purchase action. Errors and loading states are accessible.
- Existing members receive billing-email management guidance and support for plan changes. They cannot buy a second membership through the UI. This does not implement plan switching.
- An already-bound checkout cannot be replayed to payment with an old browser request key, including after its membership expires or is canceled. Unbound ready checkouts can still resume; uncertain requests retain their original key.

## Evidence

- `node scripts/run-checks.mjs check-creation-offers check-checkout-contract check-plans`: 3/3 mocked/offline harnesses passed.
- `node scripts/check-creation-plans-browser.cjs`: actual React in Chromium against an isolated local fixture passed closed state, annual selection through login, no automatic purchase, stable retry/refresh request key, mocked checkout redirect, member support and malformed availability/retry paths. External checkout was intercepted; no account/provider calls.
- `npx tsc --noEmit`: passed.
- Focused ESLint over changed implementation and tests: passed without warnings.

## Remaining release gates

Production flags remain closed. Actual pinned-version provider catalogue responses and app-bound checkout/payment delivery still require qualification; these tests use mocked contracts. Current online Whop documentation redirects older plan documentation to beta variants; the implementation retains the existing pinned API version and refuses absent/unrecognized fields. A future provider mismatch therefore closes availability rather than advertising unverified terms.

Owner-required plan switching remains unresolved under `plan-switching-qualification-20261013.md`. Do not interpret purchase UI completion as launch approval.

## Read-only sandbox contract correction

On 2026-10-13 the pinned `2025-01-01` API returned both known sandbox plans with `stock: 0` and `unlimited_stock: true`. Whop's [plan contract](https://docs.whop.com/api-reference/plans/retrieve-plan) states that stock is ignored for unlimited plans. The original local verifier incorrectly treated these as sold out. It now requires an explicit boolean `unlimited_stock`; finite stock must be a positive integer, while explicit unlimited stock may be zero or null. Missing, malformed or negative stock metadata fails closed. Regression checks cover these combinations without provider writes.

Sanitized observations and the repeatable GET-only probe are in `whop-plan-shapes-20261013.json` and `scripts/check-whop-plan-shapes.mjs`. The observed sandbox monthly plan has the expected $29 renewal price. The historical annual test plan is $279, whereas the displayed standard annual Create price is $278.40; it must remain unavailable under exact-price verification. No provider prices or plans were changed. These reads qualify field interpretation only, not production configuration, checkout execution, signed lifecycle delivery or switching.
