# Durable generation domain groundwork

`src/lib/jobs` contains Zod contracts and pure transitions. It performs **no provider calls, database writes, queue delivery or refunds**. It is not a deployed worker. Pure transitions cannot establish atomic database behaviour or external exactly-once execution.

## Requirements reviewed

The original master build prompt requires fixed-precision quotes, atomic credit/vendor reservations, attempts, route/input/base-version tracking, bounded retry, leases, cancellation checkpoints, partial-output preservation and ambiguous-charge reconciliation. Relevant original gates include OL-V2-015, OL-V2-036, OL-V2-037, OL-BUILD-051 and OL-V4-076. These contracts advance the domain boundary; none of those production gates is marked complete by their existence.

## Contract

- Scope contains workspace, project and optional artifact UUIDs.
- Quote pins input hash, base version, provider/model, route version, approval, expiry, vendor ceiling and customer credits.
- Budget defaults to spending disabled. Emergency stop and concurrency are explicit.
- Money uses JSON-safe decimal integer strings and BigInt arithmetic in microusd. Customer credits are a separate exact unit, not money or a bank balance.
- Job keeps revision, deadline, attempt bound, cancellation, stage, lease/fence and accepted asset IDs.
- Attempt records the plan input hash **and actual request hash**, base/route, provider/model, dispatch state, charge uncertainty, request ID, usage evidence, costs, failures and assets.
- Ledger entries are append-only directions with unique event keys and actual evidence references. Provider and customer accounts remain separate.

All supplied scope/authority data must come from an authenticated adapter that checks membership and assignment. A UUID is not authorisation. Source rights, processor policy and spending permission are checked again before dispatch. Browser flags are never authoritative.

## Transition flow

`createJob` → `quoteJob` → `approveQuote` → `reserveJob` → `enqueueJob` → `acquireLease` → `prepareAttempt` → `markDispatchIntent` → actual provider adapter → `confirmAttemptOutcome` → review → `settleExecution`.

For another stage, `continueAfterReview` preserves reviewed assets and returns the job to queued state. All next attempts remain bounded by the original quote and reserved vendor ceiling. A local quality repair cannot silently increase customer credits. Invalid-input and policy failures cannot retry unchanged or select a hidden fallback.

`markDispatchIntent` returns `shouldDispatch: true` once in the owned state transition; replay returns false. **Persist that result before making the external request.** Crashing between persistence and a response still leaves an ambiguous external outcome, not proof that the provider was or was not charged.

`markAttemptUncertain` holds the reservation and enters awaiting reconciliation. Do not retry it blindly. A queue restart or expired worker must detect dispatching/unknown attempts, reconcile with the actual provider when possible, and retain explicit uncertainty otherwise.

`confirmAttemptOutcome` requires real usage/result evidence. Confirmed incurred costs remain recorded even when they exceed the planned reservation; this is flagged for cost-overrun review and cannot silently expand the customer quote.

## Cancellation and settlement

Cancellation stops prepared/undispatched work, revokes the lease and prevents acceptance or further dispatch. Already dispatched work retains unknown cost until reconciled. Cancellation does not retract a provider request, erase incurred costs, generate a refund or delete already approved assets.

Settlement converts reserved amounts into observed vendor spend and, only for accepted work, the agreed customer credit charge. Unused reserved capacity is released. Unknown costs prevent settlement. Replay cannot duplicate the owned settlement.

`appendCreditAdjustment` records an explicitly authorised, evidenced provider credit or customer refund/adjustment. It does not itself change the budget account or request a refund; an authorised financial adapter must update the appropriate account atomically. Never interpret cancellation as a credit event.

## Required persistence adapter

The adapter must:

1. Authenticate the caller and recheck current membership/project access.
2. Load trusted job, quote, budget, source and route records.
3. Compare expected job/account revisions and persist both returned values in one transaction.
4. Apply workspace-scoped unique keys to job requests, reservations, attempts and ledger events.
5. Lock/check global caps and trial limits in the same reservation operation; a workspace account alone does not enforce global spend.
6. Use leases/fencing and current access policy on state writes and output release.
7. Schedule queue work transactionally and tolerate at-least-once delivery.
8. Record stage outputs and actual provider evidence before promoting readiness.
9. Preserve immutable quote history, ledger events and uncertain reservations through recovery.
10. Reconcile confirmed financial adjustments without rewriting historical costs.

No function here establishes those transaction guarantees. The caller must not persist a stale calculated account independently from the job.

## Current migration gap

The existing foundation migration has coarse generation job, reservation and usage ledger records. It lacks the complete attempt, lease/fence, quote, dual allowance, revision and adjustment models represented here. Domain states such as reviewing/ready/partial require deliberate persistence mapping or migration; do not directly insert unsupported status strings. This task makes no migration changes.

Database activation and concurrent SQL reservation verification remain unperformed. Local Docker startup was unavailable, and no live database/provider execution is claimed.

## Offline checks

Run `node src/lib/jobs/check-contracts.cjs` from the repository. It uses labelled fixed fixtures and the existing TypeScript/Zod dependencies, not a provider or database. The cases cover spending disabled, reservation replay, tenant mismatch, dispatch replay, uncertain outcome, cancellation without refund, deferred settlement, fixed precision, deadline/scope checks and ledger separation.

`npx tsc --noEmit` checks the typed contracts. Neither check proves provider billing, queue crash recovery, SQL isolation or production security.
