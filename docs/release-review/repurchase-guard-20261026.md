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

Fresh-account cloud journey and final evidence are pending at this checkpoint. Do not claim production or fresh credit delivery passed based on the old reused-account run.

## Rollout / recovery

Apply this exact migration before opening new checkout in the future production release; never a bare database push. It can ship before the new application: the old route would fail closed with a generic error, never create another checkout. Keep the new explanatory UI and route together in the release candidate.

If rollback is needed, prefer keeping the stronger database guard while reverting unrelated app changes. Restoring the old guard reintroduces charge-before-review risk and requires a deliberate owner-reviewed decision. No financial history should be deleted to make an account appear eligible.
