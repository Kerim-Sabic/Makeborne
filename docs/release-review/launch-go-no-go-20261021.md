# Launch go/no-go packet — 21 October 2026

## Status

Staging publishing journey: qualified for the tested fixture; see cloud-publishing-final-20261021.md. Paid launch: still on hold. Production activation is not approved by the current task.

## Ready for review

- Current source/runtime identities and all107 migration hashes frozen in the private release-source-inventory.json.
- Exact production105→107 migration order identified; prior local upgrade/failure/recovery rehearsal retained.
- Current full-source publish, preview approval, desktop/phone output, form→CRM, unpublish and republish passed on staging.
- Current crash/fence recovery, direct deny-all isolation,20MB broker and four full-chain SQL suites passed; storage transport/conditional-write recovery passed with actual R2.
- New sandbox subscriptions each received300 credits. Actual renewal probes remain active:20Nov2026 about15:43 Europe/Warsaw, success4242 and failure0341. Neither monthly renewal nor failed monthly renewal has happened yet.
- Missing-first-webhook recovery and refund reconciliation fixes passed their separate real sandbox/staging journeys. This run created no new paid AI test.

## Remaining owner gates

1. **Billing evidence:** observe real monthly renewal and failure on the active probes, refreshing only the limited sandbox credential when needed. Confirm renewal grants, recovery, rollover expiry and access outcome. Signed delivery needs a dedicated approved test receiver; it is currently off. No provider dates/events may be forged. Owner-only real subscription/pack purchase and refund verification remains separate from sandbox evidence.
2. **Candidate:** reconcile final Claude handback, then commit intended documentation/qualified source and review remote CI/PR checks. No force push. Any runtime change invalidates the affected evidence until rechecked. The current qualification source is local, not an already-approved production release.
3. **Production publishing setup (requires explicit go):** dedicated restricted login with only makeborne_publication_worker membership; independent bucket makeborne-publication-production and bucket-only R2 keys; scoped production Vercel token; broker secret/origin; plain non-instrumented controller package; immutable production image mappings with evidence hashes. Verify every identity and no staging bypass on production. Keep the rollout limited to the explicitly approved owner workspace. The host already exists at the previously approved6USD/month; no new subscription was bought.
4. **Backup and migrations (requires go):** verify a production backup and restore record. Run the reviewed explicit-target path against rklojnmmsmhwnkbzuidp, never bare db push. Dry run must list only the two pending files below. Apply in order, verify schema and unchanged advisor baseline, then normal PR/deploy order from the release checklist.
5. **Production golden site (requires go):** approve retained preview, compare actual public root/nested routes at375/1440, HTTPS/images/menu/form→correctCRM, unpublish and restore. Prove service startup/restart with production scope. Monitor logs/Health for30minutes. Stop on a failed gate.
6. **Activation decisions:** production checkout/top-ups, AI provider daily limits, images and enquiry secrets each need explicit activation approval and their corresponding evidence. The testing cap is not an ongoing customer-spending allowance. Auto-top-up charging stays off. Gmail sending stays off until its verification is complete; custom domains can remain unavailable while standard name.makeborne.site hosting launches first.

## Exact pending production files

-20261021125359_checkout_payment_recovery.sql
-20261021133151_billing_financial_reconcile_freshness.sql

SHA256 values are in cloud-publishing-final-20261021.md; hashes must match the frozen inventory and staging bytes.

## Settings to prepare privately, not apply now

App: MAKEBORNE_TRUSTED_PUBLICATION_ENABLED, MAKEBORNE_HOSTING_NAMESPACE, MAKEBORNE_PUBLICATION_ASSET_BROKER_ENABLED, MAKEBORNE_PUBLICATION_ASSET_BROKER_ORIGIN, MAKEBORNE_PUBLICATION_ASSET_BROKER_SECRET, MAKEBORNE_PUBLICATION_WORKSPACE_IDS and the existing server database configuration. Use makeborne.com and production scope only. Never put STAGING_VERCEL_OIDC_TOKEN or a staging bypass in production.

Controller: NODE_ENV, MBPUB_CONFIG_FILE, MBPUB_CONTROLLER_IMAGE, MBPUB_DB_PASSWORD, MBPUB_VERCEL_TOKEN, MBPUB_BROKER_SECRET, MBPUB_R2_ACCESS_KEY_ID, MBPUB_R2_SECRET_ACCESS_KEY. No administrator/service key or generated-code access to these values. The config pins production ref rklojnmmsmhwnkbzuidp, production Vercel project prj_UzMAuCP7X4yeBP6FrUFCDlJ5GWHh and production bucket.

Forms, if approved: matching MAKEBORNE_FORMS_SIGNING_SECRET in the app and FORMS_SIGNING_SECRET in the production Worker. Do not change Worker production routes/secrets without the explicit go. Billing activation follows its existing dedicated checklist and real-owner purchase handoff, not merely these publishing checks.

## Recovery

Disable new publishing admission and stop the production controller if the golden test fails. Preserve approved live output and durable journals/orphan cleanup. Restore the previous qualified Worker/image/config and use a normal revert PR for the app. Additive migrations stay unless reviewed harmful; never drop production objects to make an error disappear. For billing faults, close checkout/top-ups and redeploy through the approved rollback path. Record exact previous identities before activation.

## First-week checks

Each day inspect admin Health/errors, billing and top-up health overdue/open issues, provider spend and reservations, failed/stuck publication attempts and orphan cleanup, public golden site/form delivery, and storage/hosting usage. Investigate failures before widening access. No unattended monitoring was installed by this task.
