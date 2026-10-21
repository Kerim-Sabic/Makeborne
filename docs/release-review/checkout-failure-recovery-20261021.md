# Failed checkout recovery and publishing preparation — 21 October 2026

## Candidate and scope

Runtime 58bc0f7b49c14c573abe8992bf949528a45d8df6 on release/combined-rehearsal-20261020, draft PR12. Claude86cb4b6 remains integrated and its source worktree unchanged (only its existing untracked outputs). Main remains d14bf303165806ab2544299c3e1b63f923a5c9ea. No production writes, environment changes, provisioning, merge or production deployment.

Fixed staging preview: nnss1h4b9 / dpl_BFmKLLWEsoSMu5D2TrEXV61JcYLB in the explicit staging project; READY and source/project read back. Staging QA alias points here after the smoke passed. No production alias changed.

## Real defect found and repaired

An actual staging checkout and sandbox provider payment with fake0341 created an unpaid draft membership. A paid fake4242 attempt on that same checkout created a different active membership. The original failed webhook persisted the draft, so the SQL duplicate-checkout guard correctly rejected the later membership with PBC03. Paid delivery then returned503 and credits remained0.

The repair keeps a previously unbound, verified unpaid draft from claiming a durable subscription binding. Paid/refunded or mismatched evidence in a draft fails503 for retry; storage failures also refuse. Previously bound membership regressions still flow through and revoke cached access. Existing SQL duplicate/replacement protections remain unchanged. No subscription switching was introduced.

Provider evidence shows failed0341 followed by paid4242 on one checkout. The second provider attempt was observed while the checkout UI was processing; no separate second Join click is claimed. Both attempts were owner-approved.

## Genuine provider-signed staging proof

- Original raw payload and signatures forwarded verbatim through the dedicated path, not locally re-signed; sandbox company and signature checked first. All other receiver paths reject.
- Before repair: failed200, paid/activation503; actual staging RPC in BEGIN/ROLLBACK confirmed PBC03.
- Only this disposable unfunded draft and its failed-event receipt were removed to reset the test. Ledger0, retained real checkout, snapshot saved. This was not a production repair or synthetic checkout binding.
- Provider dashboard replay against fixed preview: failed200, no binding/grant; paid200, exactly one active membership and one300-credit grant.
- Delayed failed replay and duplicate paid replay both200; active paid membership and exactly300 credits preserved.
- Actual regular-user sign-in, duplicate checkout409, real return request→Studio and375px billing smoke pass with no horizontal overflow/page errors. An initial test URL used checkout_id instead of the real request parameter; the harness was corrected, not application code.
- Owner-approved cleanup: full29USD sandbox refund read back, immediate cancellation read back canceled. Genuine refund/membership events200. Final ledger exactly+300/-300, zero remaining credits, no second grant.
- Actual staging billing/top-up cron POSTs succeeded; both health endpoints overdue:false/openIssues0. Billing SQL reconciled the one canceled membership with zero additional credits; provider refresh processed0 and top-up processed0. This is health/idempotency evidence, not another missed-payment-delivery proof.
- Test user, bound membership and sessions removed; baseline billing settings unchanged. Sandbox webhook Disabled read back; receiver/tunnel stopped; port3066 no listener. No future fake renewal left on this subscription.

## Local qualification

180/180 offline harnesses, full ESLint, TypeScript and webpack production build pass. Updated webhook harness covers new/unbound and existing/bound drafts, repeated failure, pending, paid/refunded refusal, wrong membership, unavailable lookup and funded retry. Actual billing job plus real105-chain SQL passes in a fresh disposable database that was dropped afterward (Whop mocked there). Controller checks pass with no cloud execution. No SQL migration added by the checkout fix.

1496-source/105-migration frozen inventory matches committed58bc0f7. Its embedded historic20-migration baseline is not the current rollout list; the new read-only production comparison is94applied/11pending. See production-publishing-preparation-20261021.md for exact pending hashes and separate activation gates.

## Remaining evidence gates

A real account-bound monthly subscription renewal and a real bound recurring-payment failure have not been observed. This test is an initial purchase failure and successful retry, not a renewal. The previously observed weekly unbound cycle is separate evidence. Official sandbox sources inspected do not document a test clock; do not fabricate a future billing period or change the monthly catalogue to prove it.

Also pending: distinct second pack payment and any remaining dispute/taxed/promo/non-USD cases; intended production pack adaptive pricing must be explicitly false. Public plan switching and automatic charging remain off. The reconciliation path under a lost failed-renewal webhook needs explicit provider-state coverage before claiming full renewal qualification.

Production publishing resources/startup/golden publish and unpublish remain unqualified; the read-only production preparation did not provision anything. Earlier cloud staging build/fault evidence is reused with its documented limits. Images still need the separate OpenAI key/live qualification.

## Budgets and recovery

Original5USD ledger4.912877 retained. Additional1USD ledger0.45 conservatively accounted after this round (0.10 earlier +0.20 failed/retry run +0.15 rebuild);0.55 remaining. These are retained bounds, not an attributed provider invoice. Separate50USD Claude API allowance0spent; no paid model/VM call this round. Existing approved6USD/month host unchanged.

Recover staging by restoring its prior alias1vj34rpbv if needed; no database rollback required for this source-only fix. Production remains held. Never remove SQL duplicate protection to accept replacement memberships. Keep genuine evidence in ignored work/lovable-qualification-20261020; do not commit credentials, browser storage, payment payloads or tunnel paths.

## Remote closure

Runtime58bc0f7: GitHub PR39523613371 and push39523608515 both SUCCESS; Vercel preview SUCCESS. No main push/merge or production deploy. Final report/handoff are a local documentation-only checkpoint after the green runtime checks. No additional runtime changes.
