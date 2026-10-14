# Plan switching qualification — 2026-10-13

Read-only research and sandbox inspection; no subscription was changed.

## Established evidence

- The existing creation checkout refuses an account with a creation subscription, protecting against an accidental second subscription. The current pricing component deliberately disables purchase actions. Neither behavior implements owner-required plan switching.
- The reviewed [beta membership update contract](https://docs.whop.com/api-reference/beta/memberships/update-membership) offers metadata, cancellation, payment method and billing-period-days changes, but no target plan, price variant, prorated upgrade or scheduled tier downgrade contract. A period-length change is not proof of a paid annual-plan switch.
- The [billing portal guide](https://docs.whop.com/payments-and-billing/manage-billing/billing-portal) documents subscription visibility, payment history, methods, cancellation and transfer; it does not establish a self-service upgrade/downgrade contract.
- Sandbox membership reads under the existing 2025-01-01 version and 2026-10-09-2 both succeeded. The newer shape differs and omits the checkout binding relied on by current fulfillment. Do not change the application API version globally to obtain one feature. See [API versioning](https://docs.whop.com/developer/api/versioning).
- In the sandbox seller customer view, **Update subscription** exposed a new renewal-price field and the statement: “This change will take effect from the next billing cycle. No proration will be applied.” There was no target-tier or plan selector in that observed form. The dialog was closed without saving. This seller price adjustment does not prove app-mediated paid tier switching.
- The sandbox developer view showed the configured v1 webhook disabled. Earlier local simulations are not evidence of current signed external webhook delivery.

## Required implementation and qualification

1. Establish a supported provider contract for a paid switch, including whether the membership identity changes. Do not represent cancel/rebuy as a seamless switch.
2. Record a durable account-bound change request: original membership/plan, target offer, billing anchors, verified payment evidence, and idempotency/recovery state.
3. Preserve original purchase binding and history. Do not broadly remove binding checks to accept an arbitrary changed plan.
4. Enforce one account allowance for the switch month: a verified upgrade adds only the difference; downgrade applies next allocation; no historical retroactive top-up or clawback. A replacement membership must not create a second allowance.
5. Observe app-bound signed sandbox delivery, renewal, monthly-to-yearly and yearly-to-monthly behavior, duplicate/out-of-order events, failed payment and interrupted recovery. Separate provider observations from mocked tests in the evidence matrix.
6. Connect plan purchase/switch UI only to validated server availability. Production checkout remains closed until release approval.

**Status: unresolved launch requirement.** Provider subscriptions alone do not establish correct Makeborne entitlement delivery or plan switching.
