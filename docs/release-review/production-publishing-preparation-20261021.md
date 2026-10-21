> Historical baseline: superseded by [Renewal and publishing readiness](renewal-publishing-readiness-20261021.md). The94-migration/11-pending inventory below is historical; current read-only baseline is105/two.

# Production publishing preparation — 21 October 2026

Status: NOT activated; production approval still required. This report is preparation, not a deployment authorization or claim of readiness.

## Read-only production baseline

Verified-TLS, READ ONLY transaction against the explicit production project rklojnmmsmhwnkbzuidp; rollback completed. There are 94 applied migrations, 11 pending and zero unknown versions. No production controller login, no production workspace allowlist table and zero draft billing memberships were found. One owner workspace was found; its identifier is retained privately for a proposed restricted rollout, not enabled here.

Pending files in repository order (review their individual deployment dependencies before applying):

1. 20261019134828_trusted_publication_production_profile.sql — SHA256 c28e4d356327a3740578d5c2288991964b28cb46fa607277c35413deed396ff5
2. 20261020090000_payment_funding_and_refunds.sql — SHA256 a4196916826f5c55f257c7909dbf19c867305344af88135d9496b6bacfea03c9
3. 20261020100000_credit_autotopup_authorization.sql — SHA256 563e75796f9dea1f32cf5116319fe7e8868240027e02c9ee3e8d52a8274ccd84
4. 20261020110000_usage_history_read.sql — SHA256 d80b0f6453c0f8952f6a80ea34868594b410ff16c70f2ef0c65325edeb0908ac
5. 20261020120000_artifact_title_search.sql — SHA256 702a0aa2fe84c40ca2f2b248a74399ecaee987c8cb1c316dbd8113dae0663c8c
6. 20261020144714_artifact_title_search_acl.sql — SHA256 ae64759d0619b898da485f858b2cbd6f4b170d8664fffa0704a054f1203ff876
7. 20261020174011_ai_operation_cancellation.sql — SHA256 4d18b6d64f47cac558f4216f198b31e4b599d0616f0a0c7465183db3d4298344
8. 20261020183417_ai_operation_cancel_compatibility.sql — SHA256 49648213a2c0c143e8c8371b4220fdcd4a7220f278cde278f99f4d9015d83e07
9. 20261020203000_scope_revocation_boundaries.sql — SHA256 884df0c23a157daa0b46e9a0e8f3fb03abeb3e438aa8b3167802b2a5d8d5a7c3
10. 20261020210000_artifact_card_previews.sql — SHA256 aa2efce837b702f6d87bbe879f79be155197a853072ba5926f445d6783c8cca6
11. 20261020231225_billing_ux_details_and_limits.sql — SHA256 8bdaa393391c56d1d28dfbc46a7fc782d5ad8a099e36fee8f7f6844dc45ad45b

Do not use the historical 20-migration baseline. Do not apply this list merely because it is printed here. Require a current backup, fresh explicit-target comparison, code-first scope migration prerequisites and the exact candidate rehearsal. No bare database push.

## Profile/resource matrix

- Database: db.rklojnmmsmhwnkbzuidp.supabase.co, verified TLS required.
- Vercel team: team_viiayqU1BnwJBdEqgHdgmtnA; project: prj_UzMAuCP7X4yeBP6FrUFCDlJ5GWHh.
- Broker: https://makeborne.com; sites: makeborne.site.
- Intended private bucket: makeborne-publication-production. Existence and production credentials are not qualified by this read-only database check.
- Intended compiler/renderer registry prefix: kerimsabic-6594s-projects/makeborne/. Staging-prefixed approvals must never be reused as production approvals.
- Intended dedicated login: makeborne_publication_controller_production*, sole membership makeborne_publication_worker, no superuser/BYPASSRLS/create privileges. Not created.
- Existing approved Linux supervisor host: the staging host/runtime/reboot evidence is in publishing-host-preparation-20261020.md. Both service instances were inactive on readback. Production startup has not been qualified. No new subscription or host provisioned.
- Explicit owner-managed workspace rollout: additive migration 20261019134828 creates a disabled/empty allowlist. Match the exact enabled workspace set across app, controller and startup attestation after separate approval.

## Activation sequence to review with owner

1. Freeze and qualify the combined candidate, including the failed-checkout repair; retain passing remote checks and staging evidence. Rehearse the exact production baseline and all pending files, including failure/recovery.
2. With separate production approval, take and verify the database backup, run explicit-target dry run, then apply only reviewed pending files in dependency order. Preserve existing applied bytes and old API compatibility.
3. Prepare isolated production bucket credentials, restricted database login, immutable production compiler/renderer images and approval manifest. Validate profiles cannot mix. Keep the service stopped while checking configuration and exact startup attestation.
4. Prepare production-only supervisor configuration with private file permissions and separate MBPUB_* secrets; no staging bypass token or staging ambient credentials. Check the service restart policy, access scope, resource limits and alert destination.
5. Set the agreed workspace lists and broker variables only after review. Enable MAKEBORNE_PUBLICATION_ASSET_BROKER_ENABLED and MAKEBORNE_TRUSTED_PUBLICATION_ENABLED only for the approved golden workspace after the production go. Do not open every workspace by default.
6. Publish one approved golden site through actual preview approval, compare every route on desktop/mobile, verify menus/assets/forms as enabled, then unpublish. Confirm public removal and retained recoverable source. Record actual provider VM stop evidence, not only journal labels.

## Still unqualified

Current production startup/registry/bucket credentials and golden publish/unpublish; fresh restart/ambiguous-create/stale-fence/storage-fault matrix on this exact integrated bundle; live 20 MB streaming boundary. Earlier staging two-route/three-VM and supervised-host results are reused evidence, explicitly not fresh production qualification. OpenAI image generation remains a separate key/live-test gate. No new paid AI or VM calls in this preparation.

## Recovery

Disable production publication and broker flags and stop only makeborne-publication@production. Restore the matching reviewed app/Worker/controller versions through normal rollback. Preserve additive migrations, source versions, existing hosted output, object records and lifecycle journal. Never restore browser-bundle promotion, disable TLS/profile fences or mark uncertain VMs stopped. Existing site availability and unpublish access must be checked after rollback.

Production was not changed. Ask for approval only after the remaining qualification gates have evidence.
