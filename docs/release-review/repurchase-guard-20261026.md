# Pre-checkout repeat-purchase guard — 26 October 2026

Owner requested a repair and a fresh-account close-tab test. Production is not authorized and remains unchanged. This is a focused follow-up to runtime 5f655a7, not Claude's broader full-launch candidate.

## Repair

`20261026013451_prevent_unsupported_creation_repurchase.sql` replaces the private checkout-insert trigger function. Under the existing per-account advisory lock it retains the active-subscription and unbound-checkout guards, and invokes the existing financial allocation-conflict function before admitting another checkout. An overlapping or unknown legacy allowance raises PBC03. Historical grants and refund evidence remain intact.

The application returns HTTP 409 / SUBSCRIPTION_REPURCHASE_REQUIRES_SUPPORT with no payment URL. The billing UI offers Contact support rather than a generic retry. Repeated request IDs also traverse the trigger before uniqueness/resume handling. No service/browser function privilege is added, and the grant/settlement guard is unchanged.

This is conservative eligibility for the first monthly allocation of either monthly or yearly subscriptions. It is not plan switching, an automated refund exception, or permission to grant a second allowance. Known expired, non-overlapping allocations and top-up-only accounts remain eligible. Unsupported old/unknown dates need support review.

## Local/staging checks

- The real SQL full-refund scenario, new request, retained request, zero wallet, expired historical allocation, top-up-only account, unknown dates, active-subscription precedence and trigger-only permissions pass in rolled-back transactions on the full-chain disposable database.
- Existing checkout-recovery suite and all twelve plan-payment/refund groups pass with the repair.
- Route regression verifies 409, no URL, and no provider checkout creation on PBC03.
- Mounted Chromium billing UI regression verifies support link and no generic retry action.
- Staging exact-target dry run and rollback restore confirmed the old trigger body; only the new migration then applied to xzwikrunwpurxnxgkznh. Advisor remains 11 WARN with zero new WARN. The runner initially refused because the separate staging test ledger excludes the original 20 baseline migrations; it was corrected to compare the union of the recorded baseline and staged migrations. No unexpected migrations were applied.
- First SQL fixtures attempted an unsupported generic adjustment and then omitted legacy expiry metadata. Both test fixtures were corrected to use the actual full-refund path and valid legacy grant metadata. Neither error was an application regression.

## Exact staging journey — passed

Frozen runtime `59e5d32d55ee46e9dde2e93777024e633a998322`, deployment `dpl_4tG94WBq1PEEBzcefkTvPB6R8n3b`, URL `https://makeborne-release-staging-hhzprgjay-kerimsabic-6594s-projects.vercel.app`. No production promotion occurred.

1. Reused historical account: both a new request and the previous request return 409 / SUBSCRIPTION_REPURCHASE_REQUIRES_SUPPORT, no URL, no added checkout row.
2. Fresh, confirmed, non-admin fictional staging account: initial subscription count, grant history and wallet are zero; one $20 Create sandbox checkout is created. Owner separately approved its displayed terms/fake-card purchase and cleanup.
3. Fake 4242 submitted at **01:48:17.650 UTC**; tab closed at **01:48:20.853 UTC**, still on sandbox.whop.com and showing Processing payment. It never returned to Makeborne.
4. Provider delivered membership.activated at 01:48:23 UTC and payment.succeeded at 01:48:25 UTC, each HTTP 200. Read-only database observation, before any follow-up app access or manual reconcile, found one bound membership, two receipts, exactly one 300-credit grant, wallet 300/0 and no issues. No fabricated webhook or recovery grant was used as automatic-delivery evidence.
5. Exact test payment `pay_tFMEshCz0jysXJ` fully refunded $20 and membership `mem_6TbGx52Lp8CZ1v` immediately cancelled. Real refund/deactivation deliveries each HTTP 200; SQL payment state reversed, wallet 0/0, no issue. November probes were excluded.
6. Repeated checkout after this real refund/cancellation: both new and original request IDs return 409/no URL; exactly the original checkout row remains. This verifies the repair against actual provider-refund evidence, not just synthetic fixtures.
7. Reconcile run 42 succeeded, overdue false, openIssues 0 and no run errors. A historical 24-hour failure and one old pending recovery remain visible; they were not deleted to improve the report.

Evidence in ignored `work/qualification/`: `repurchase-staging-block.json`, `repurchase-fresh-browser.json`, `repurchase-fresh-provider-log.txt`, `repurchase-fresh-post-close.private.json`, `repurchase-fresh-refund.private.json`, `repurchase-fresh-cleanup.private.json`, `repurchase-fresh-real-refund-block.json`, `repurchase-final-health.json`, `repurchase-concurrency.json` and `repurchase-staging-migration.json`.

Final checks: both initial and frozen-candidate offline runs pass 187/187; full typecheck, ESLint, production build, mounted Chromium billing regression and diff secret-pattern scan pass. Four existing/new billing SQL suites plus twelve refund groups pass in rolled-back transactions. Two simultaneous fresh-account inserts admit exactly one checkout.

## Cleanup and budget

Sandbox webhook disabled and bypass removed from its URL. Temporary Vercel bypass revoked; fresh fixture banned, local password removed and fixture sessions revoked. Financial receipts, ledger and refund audit retained. No production data/settings, main branch, Worker or production services changed; no push.

No additional paid AI or publishing VMs. Original $5 Anthropic scope remains $0.959960 accounted. Original $3 cloud scope retains $2.96 for previous VMs/storage plus at most $0.04 for this bounded app/checkout qualification; no extra budget is reused. Current team verified Hobby, this build assigned Basic (included build compute, not a claim of zero total invoice). Sources: [Vercel build machines](https://vercel.com/docs/builds/managing-builds), current team/deployment readbacks retained privately.

The app now withholds a new payment link for unsupported re-subscription. It does not revoke previously distributed third-party checkout URLs or implement provider-side plan switching; do not market it as protection against every possible direct Whop purchase outside Makeborne.

## Rollout / recovery

Apply this exact migration before opening new checkout in the future production release; never a bare database push. It can ship before the new application: the old route would fail closed with a generic error, never create another checkout. Keep the new explanatory UI and route together in the release candidate.

If rollback is needed, prefer keeping the stronger database guard while reverting unrelated app changes. Restoring the old guard reintroduces charge-before-review risk and requires a deliberate owner-reviewed decision. No financial history should be deleted to make an account appear eligible.
