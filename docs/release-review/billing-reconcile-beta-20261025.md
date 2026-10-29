# Daily billing reconciliation beta preparation — 25 October 2026

Local candidate: `release/minimum-launch-20261025`. No commit, deployment, provider change, database change, paid call, or production operation performed for this package.

## Change

`recoverDueCreationCheckouts` admits at most ten checkouts with one extra row of lookahead. Pending unpaid checkouts become due again after their cooldown, so more than ten abandoned links made every daily run `partial`. Health uses the last `succeeded` run and therefore eventually reported `overdue`, even when every admitted membership/payment check succeeded.

`reconcile-job.ts` now persists `stats.checkoutRecoveryBacklog` separately. Membership backlog still sets `stats.backlog` and makes the run partial. Actual checkout discovery errors and review outcomes still increment `checkoutRecoveryFailures` and make the run partial; a discovery query failure still fails the job. Checkout lookup/binding/credit rules, time limits and SQL are unchanged. Unchecked checkout lookahead is informational; this does not assert that every checkout was verified.

The existing SQL orders discovery by oldest `updated_at`, then checkout creation and request ID. Updated pending attempts rotate behind unchecked ones. No migration is needed.

`vercel.json` prepares one daily `GET /api/cron/billing-reconcile` at `17 3 * * *` (03:17 UTC). Existing enable flag, constant-time bearer authentication and database lease remain required. Vercel Cron is supported on all plans; this daily expression fits Hobby. Vercel invokes production deployments; a Preview needs a manual authenticated run. Source documentation: [overview](https://vercel.com/docs/cron-jobs), [limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [authentication and delivery](https://vercel.com/docs/cron-jobs/manage-cron-jobs), checked 25 October 2026.

## Offline evidence

- `node src/lib/billing/check-billing-reconcile-job.cjs`: **14 passed**. Covers independent informational checkout backlog, genuine membership backlog, failed/review recovery and thrown discovery failures, persisted status/stats, exact daily cron declaration, plus existing auth/binding/budget cases.
- `node src/lib/billing/check-checkout-recovery.cjs`: **27 passed**. New integrated mocked-queue case exercises the real recovery helper and job across two runs with eleven unpaid attempts: both succeed, report backlog, and the previously unchecked eleventh request is selected first on the second run. Review outcomes and provider errors remain partial. The queue fake models the unchanged SQL oldest-first clause; this is not a live SQL ordering qualification.
- Regression red: ran the updated checkout-recovery suite with only `reconcile-job.ts` loaded from `700a4e4` in memory. Existing 26 cases passed; the new eleven-checkout case failed as expected (`actual partial`, `expected succeeded`). No source replacement or Git mutation was used.
- Targeted ESLint on the job, cron route and both check files: **passed**.

## Operational gates still open

After the approved release path deploys and enables this job, make one authenticated manual run and inspect health. Alert on `overdue`, `failuresLast24h > 0`, and `openIssues > 0`; the HTTP health endpoint merges checkout `needsReview` into open issues. Treat ordinary `pending`/`due` and `checkoutRecoveryBacklog` as informational; investigate sustained growth or recovery delay separately. No external alert has been installed or delivered by this package. Vercel delivery can be missed or duplicated and failed invocations are not automatically retried; existing lease/idempotency and daily operator review remain necessary.
