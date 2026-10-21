# Active monthly sandbox renewal probes — 21 October 2026

Both owner-approved initial purchases succeeded using fake4242, with no real money. Each is a separate ordinary staging account with its own checkout and provider membership. Both are active and remain so for real renewal testing.

| Probe | Provider membership | Initial payment | Next renewal (Europe/Warsaw) | Future fake card | Initial credits |
|---|---|---|---|---|---|
| Success | mem_IApANyZ1n9M6vg | pay_wsAcrMo8QRNILh | 20 Nov2026 15:43:36 |4242|300|
| Payment failure | mem_DaA63WSyDtf4Sr | pay_ZK4GoK0joxcViW |20 Nov2026 15:43:43|0341|300|

Whop management exposes an exact membership-specific payment-method route. Only the failure membership was changed to saved fake0341. The shared management page then independently showed success4242 and failure0341, both renewing20November. No account-wide default was changed.

## Observed
- Plan readback:29USD, renewal, billing_period30, initial_price0, no trial.
- First Join on each returned Whop's price-updated notice with unchanged29USD total. Exact checkout-filtered API reads showed zero payments before one retry; each retry created exactly one successful payment. No blind payment retries.
- Verified each payment's exact checkout, company, USD29, fake4242, zero refund and fresh active membership.
- Two authenticated staging checkout-status requests total bound the exact memberships and granted300 credits once to each account. Webhook receiver remains disabled; these were return/recovery-path deliveries, **not proof of a signed webhook or real renewal**.
- Reporter failure: the first request completed, then a diagnostic query selected nonexistent credit_ledger.reason. Fixed the reporter and verified that probe with database reads only; no additional status request. The other request returned200/active and its real ledger matched.
- Each unspent plan lot has300 credits and expires20Jan2027 at its original payment time, matching allocation-end20Nov plus the approved two-calendar-month rollover. An assertion initially used the stale internal guide's old rule; it was corrected against the actual migration and customer terms. No credit-policy/database grant logic was changed.
- Both memberships read back active after the failure-card update; dates unchanged. Initial UI receipts may label purchases Renewal, but they are still initial payments, not a later subscription_cycle proof.

## Wait-state and follow-up
Actual monthly success/failure is still pending. Do not alter dates or simulate provider events to mark these gates passed. At the real provider cycle, compare fresh payment details/event reasons, membership state, application observations, entitlement grants, signed delivery when a receiver is connected, expiry and recovery behavior. Keep these staging accounts and audit rows; refund/cancel both only after testing as authorized.

The sandbox API credential expires before the renewal date. A later test session must refresh the same limited sandbox access and establish a bounded cloud allowance before running app reconciliation. No durable webhook tunnel or scheduled monitoring was created. This report is a prepared future test, not a claim that an unattended November test will run by itself.

## Budget and boundaries
No paid AI, builds or VMs this turn. Final0.005USD conservative bound covered exactly two status requests and is now retained; the latest1USD cloud allowance is fully accounted/reserved, not an actual invoice. The Claude ledger is unchanged. Production data/configuration/activation/deployments were untouched. Automatic charging remains off.

Evidence is in work/renewal-publishing-readiness-20261021: monthly-probes-active.json, paid-provider private receipts, exact-account credit/lot snapshots, and monthly-probes-configured.png plus monthly-probes-cards.png. Never commit private account credentials or browser states.
