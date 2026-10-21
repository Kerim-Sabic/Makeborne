# Checkout recovery and combined publishing qualification — 21 October 2026

## Decision

The missing-first-webhook defect is fixed and proven against real Whop sandbox payments and the deployed staging app. Two further refund-reconciliation defects were found and fixed. Production activation is NOT approved or performed. This is not a full commercial-launch clearance.

- Local branch: qualification/launch-services-20261021.
- Recovery commit: de7ca5d5aebb51a59993b1863a66e8b2fd02a948.
- Final financial-scheduling candidate: e45eaa50cf8527c367212df67f47bed4e63daced.
- Ready staging preview: https://makeborne-release-staging-ahqk25sz5-kerimsabic-6594s-projects.vercel.app (dpl_CANTnNxyU8e3j2uQjzfRR78w5Tox).
- Actual makeborne.com and remote main were rechecked at13:45UTC: unchanged70a1d910dce32f8a1fddaede0b437ec1ac105dcb, READY dpl_ENjea1fLgLqR54bVLUcvMHXjfUfr.
- No production DB, Worker, merchant, controller, environment or deployment writes were made by this task. No push/merge or paidAI call.

## Fixes and observed proof

1. Lost initial payment webhooks: recovery now uses an owned stored request, durable lease/cooldown, exact checkout/merchant/plan/request metadata, complete bounded payment listing, freshly retrieved payment/payer/membership and existing financial SQL. No email matching, browser-supplied provider identities, synthetic signed events or direct credit edits.
2. Recovery is wired into both the authenticated return route and the leased daily job. Uncertain/ambiguous evidence fails closed; operator-review counts appear in health.
3. Frequent sign-ins or membership-only notifications could indefinitely postpone refunds because the old job freshness used all non-payment observations. The new due query uses financial reconcile observations only.
4. Failed or incomplete financial reads previously marked the membership freshly reconciled before the read. The observation now follows the complete payment pass; partial/failed reads stay eligible for retry.
5. Claude9e37cf0's maximum-credit guard is integrated as3dfd1ee. Its test fixture still uses the actual effort ceiling. Claude's laterd526cb7/ba1a7d8 image-routing/eval-budget/docs work was read, not silently imported into this frozen candidate. No newer app/runtime difference was found in those two checkpoints.

### Real sandbox sequence

- Fresh ordinary staging account signed in and created a real29USD/month sandbox checkout; repeated/abandoned requests resumed one URL.
- Whop dashboard visibly confirmed its only sandbox webhook Disabled BEFORE purchase. Fake4242 only; owner gave action-time terms approval.
- Before recovery: real paid payment existed, but zero app membership bindings, zero credits and zero webhook receipts.
- WITHOUT purchaser returning, the deployed staging cron discovered and settled the payment: exactly one binding and300credits; zero fabricated webhook receipts.
- Eight simultaneous actual return requests all reported active and produced no extra grant.
- The29testUSD was fully refunded and the subscription immediately canceled; no real money or future test renewal.
- Default daily reconciliation intentionally waits20hours after a financial pass. For the post-refund check, the real app job was driven with its existing60second stale option, selection restricted to the owned fixture, actual Whop HTTP and real service-role staging SQL. This is an explicitly compressed DAILY-reconciliation test, not a real20hour wait or monthly renewal. Provider billing dates were never edited.
- Initial attempts to age only the fixture's checked_at did not make it due, revealing that the predicate actually used observation history. One such update hit the existing verification-TTL constraint and rolled back; an epoch verified_until plus owned fixture checked_at update then succeeded but still did not bypass observation freshness. No financial observation dates were edited in staging. Those failed probes are retained, not relabeled passes.
- Corrected financial job read the real refund and reversed300credits; final ledger+300/-300, net0. Canceled return is pending and cannot reopen creation.
- Final preview: real sign-in,375/1440 billing with no overflow/page errors, both job health endpoints200, overdue:false/openIssues:0.
- Cleanup: test auth account banned, all its sessions removed, financial audit retained, original staging billing settings preserved. Sandbox webhook remained disabled; no new tunnel or receiver.

## Database and local checks

- Full offline185/185, fullESLint, TypeScript and webpack production build pass on final source.
- Six real SQL suites pass in rolled-back transactions on the full107-file chain: recovery, financial freshness, lifecycle, annual/monthly allocations, expiry and payment refunds.
- Eight real simultaneous DB claims admitted one recovery; eight settlement retries granted exactly300once, with no fake webhook event.
- A fresh disposable database restored the prior94 baseline, applied all13 later files in order and passed the six suites. Injected failure midway through the final migration rolled its partial function creation back and left the prior function definition intact; normal retry then passed.
- Staging received ONLY the two new migrations below, in order. Its existing imported20 baseline plus85 tracked forwards became20+87; no shared local stack or production migration was applied.
- Recent previously applied staging hashes were checked before each apply. Data row counts/settings were preserved across each migration itself; owned test fixtures and their financial audit are separately intentional.
- Staging advisor11→11, zero new warning keys; API exposed schemas remain public,graphql_public.

| Pending production migration (NOT applied) | Raw SHA256 |
|---|---|
| 20261021125359_checkout_payment_recovery.sql | cb048fb30957ceb52d64badedd37d12702477a99c5ea9544d619be9977ac3130 |
| 20261021133151_billing_financial_reconcile_freshness.sql | 5045b832f0fa763c94cfc581175aa41b002fb38f0c8350f5da18f9b763728ee6 |

These hashes are the exact staged bytes. Compare them before any future production apply; never repair an applied migration hash or run a bare linked db push. Preserve LF for these new files when moving between checkouts.

## Updated publishing images

- Explicit allowlisted contexts built the combined compiler and renderer; context manifests freeze the exact source bytes, in addition to the app commit. Billing-only follow-up does not change those runtime inputs.
- Private staging registry, immutable digests: compiler456180dca30a7773eb13e2b150c81bf3bf197b9b7bb539c0821e0744cee6197f; renderer684af196a943e17bbd1e2afb6bd3c97bd0d775b993fa970e288d08c97c176a9f.
- Three real Vercel sessions: one compiler and one Chromium renderer per route (/ and /work). Non-root identities, deny-all network policy, no credentials/mounts/ports, persistent:false and75second maximum enforced. Source/output hashes and retained route HTML validated.
- Captured HTML plus compiled assets replayed in a browser at375/1440: four cases, images loaded, no overflow/page errors. This is a local browser replay of ACTUAL cloud-retained output, not a newly published public revision.
- A local Docker packaging diagnostic could not start Chromium's native sandbox on this Windows/Docker kernel. It was NOT weakened; the actual cloud kernel successfully ran Chromium with its sandbox enabled. The local failure remains evidence.
- All three sessions independently read back STOPPED with resume:false; both new image repositories deleted; Docker credential config removed. A harmless local buildx auxiliary cache folder remains after its empty-directory cleanup failed. Recursive removal was blocked by automatic command review; no attempt to bypass that block. No live cloud resource remains in this batch apart from the intentionally retained private app previews.
- IMPORTANT: this batch qualifies the new immutable runtime content and both routes. It does NOT re-prove the entire updated supervisor/approval/public-host/form/restart chain or directly re-observe outbound denial in the new sessions. Earlier54449ae controller-death/fence/public-form/network evidence remains separately dated; do not relabel it as a full new-candidate production publishing pass. Production still needs its reviewed image registration/controller setup and golden end-to-end publish/unpublish after ownergo.

## Budget and cleanup

- Owner's new1USD staging cap:0.95USD conservatively accounted/retained, NOT an invoice (0.80initial runtime/preview package+0.15necessary financial-scheduling repair preview). Prior ledgers were not reset or borrowed from.
- Two preview builds, exactly three cloudVMs, one fake29USD purchase. Zero new paidAI calls. Registry compressed content636320977bytes gives a conservative0.063633USD repository-lifetime upper bound; VM/preview/request bounds remain within the retained package. Actual cloud invoice unavailable.
- Original5USD ledger4.956772; earlier extra1USD staging ledger1.00; separate Claude50USD ledger1.926543 measured remain unchanged by this task. Claude's other qualification/design ledgers are independent.
- Test account disabled/sessions revoked, zero credits, canceled subscription, full sandbox refund, no webhook/tunnel left running. Private previews and disposable local DBs retained for review; no production write.

## Remaining launch gates

1. Genuine account-bound MONTHLY renewal charge and failed monthly renewal have not happened. All test subscriptions were canceled per the cleanup instruction, so no active probe is waiting. Initial purchase/decline, weekly probes, mocked calendars and the60second daily-job test are not substitutes.
2. Production publication controller/image registration and a golden preview→publish→public HTTPS/forms→unpublish journey still need the separately approved production preparation and explicit activationgo. New runtime tests alone do not authorize it.
3. Review the exact two-migration rollout/backup and final candidate checks, then obtain ownergo before production merge/deploy/activation. Current checkout, automatic charging, AI spending and publishing activation were not opened here. Claude's latest AI activation document reports a separately owner-approved inert image allowlist preparation; that was not performed by this task and is not AI activation.

## Recovery / rollback

No production rollback is needed. For a future app release use a normal revert PR or the prior compatible deployment; keep both additive migrations unless a reviewed forward repair is needed. Do not drop recovery receipts or rewrite financial history. Existing credit expiry, immutable bindings, duplicate/replacement guards and refund reversals remain authoritative. If recovery is paused, preserve audit rows and reconcile verified outstanding purchases manually; never mark fabricated webhook events successful.

Private receipts and screenshots: work/launch-services-qualification-20261021. Key files: recovery-final.json, recovery-real-refund-job.private.json, final-recovery-preview-smoke.json, final-recovery-rehearsal.json, recovery-concurrency.json, recovery-release-inventory.json, combined-runtime/runtime-evidence.json and browser-review.json, combined-cloud-cleanup.json, recovery-account-cleanup.json, recovery-staging-budget-20261021.json.
