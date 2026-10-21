# Tested app release — 21 October 2026

## Owner authorization and scope

Owner requested the combined Claude Lovable-audit improvements live on makeborne.com. Release the qualified app updates through normal PR merge. Keep existing disabled checkout/top-ups, automatic charging, image model allowlists, provider spending, trusted publishing/broker and mail automation off. No new production controller/bucket/login or provider resource is part of this update. This does not claim the complete commercial launch is ready.

Runtime58bc0f7 includes Claude86cb4b6 and the genuine failed-checkout retry fix. Both GitHub checks and Vercel preview pass;180 offline checks, full lint, typecheck and webpack build pass. The documentation checkpoint for this window changes no runtime or SQL. Source inventory and migration hashes are frozen privately for this window.

## Current gates

- Fresh read-only production preflight:94 applied, exactly11 pending,23 users/13 workspaces/17 artifacts,0 ledger rows/wallets; all provider limits and creation/pack DB switches disabled.
- Current production advisor baseline:9 warnings. Compare exact warning keys, not historical11 staging count.
- Fresh verified-TLS custom-format production backup: listing2355 entries and complete decode passed. Private dump is outside Git; restore copy never sent to staging or another provider.
- Local rehearsal on the fresh populated backup: normal, injected failure and interrupted backend all reach identical schema/ACL/policy/billing flags. Existing user/workspace/artifact counts preserved. Disposable copies dropped.
- Full105-chain SQL suites and fresh staging app walkthrough must pass before production apply. Existing mocked-provider and genuine sandbox evidence remain separately identified.

## Exact live order

1. Verify current source, full diff secret scan, remote checks and staging smoke. Back up first and confirm exact baseline/history/settings/advisor snapshot.
2. Explicit-target dry run of all11 files against rklojnmmsmhwnkbzuidp; compare every filename/hash to production-publishing-preparation-20261021.md. No bare linked CLI command.
3. Apply only first8 pending files (through20261020183417) using a reviewed temporary migration directory containing the full94 baseline plus those8. Vault updates/seeds/roles are excluded. Recheck count102, data conservation, switches and advisor keys.
4. Set only the production maintenance setting on for the candidate and explicitly preserve disabled unqualified feature flags. Merge combined PR normally; no force push. Wait until the new compatible app is READY and actually serving makeborne.com; verify maintenance503 and exact deployed commit. Do not apply M17 merely because a preview exists.
5. Only then dry-run/apply remaining3:20261020203000_scope_revocation_boundaries,20261020210000_artifact_card_previews,20261020231225_billing_ux_details_and_limits. Recheck105 versions, no added security warnings and original flags/data preservation.
6. Redeploy that exact source with maintenance off. Verify public pages, sign-in provider plumbing and an owner/test signed-in app session; project thumbnails/editor/history/billing/settings/help, mobile overflow and errors. No paid AI or live purchases. Clean any disposable fixture.
7. Observe errors and public availability for30 minutes. Record actual result, deployment/merge IDs, migration receipts and disabled capabilities. Do not claim features are live until the final alias and browser checks pass.

## Recovery

Before database changes abort without changing the old live deployment. After migration keep additive tables/data and current billing/credit guards; do not blindly revert to an old reader or drop a saved usage cap. Use current compatible source in maintenance as the safe degraded state while preparing a reviewed forward fix, or a separately qualified rollback that retains source/asset/accounting compatibility. Never restore a backup over later payment/activity without reconciliation. Preserve webhook ingestion and disabled spending/checkout; no automatic production controller activation.

Remaining independent launch gates include account-bound monthly renewal/failure, additional payment cases, image/provider spending qualification, production publishing startup/golden publish/unpublish and other explicitly deferred integrations. The UI update does not silently clear them.

## Execution result

The qualified combined app is live. PR12 merged normally to main at 35d47a7b0765407c56dba9fac7e0f559dc467dfb. Its production deployment dpl_Gyf1pRKUc4cE529sapzyBSga7dG1 was READY and serving makeborne.com with maintenance off. No force push was used.

The production database was backed up before mutation (verified custom-format archive, SHA-256 1aaf50f069292ff73a3e5013714cca65f0de181705a4e00056edc2086ed71d8c). The exact 11 files were applied in the reviewed 8/code-cutover/3 order, reaching 105 migrations. M17 was applied only after the compatible production deployment was actually serving the domain in maintenance. Existing counts and closed billing/provider settings were preserved; security remained 9 warnings with no new warning keys. Private schemas remain unexposed.

Production Worker fc0bf646-ccee-42d2-9f44-af44b5c73116 replaced 0c544317-8b96-4ec2-83ab-ede2eb9d703d using the same existing routes and secrets. No custom-domain catch-all or publication activation was added.

Production owner-session checks passed for project thumbnails and library controls, website previews, version comparison, CRM project delivery controls, balance-first billing, System compiler Available, and Health visits/funnel with zero recorded errors. Public SEO checks passed for all 34 sitemap addresses, robots and canonical hosts. Existing legacy book outlines still open; they were not regenerated. The restricted legacy development export was not enabled. The modern PDF/PPTX path was separately qualified on staging using prior sample sources, not fresh paid generation.

The public phone sweep found decorative Help-page overflow. A follow-up PR13 contains only Help CSS and a Chromium regression. Its first CI exposed a second real narrow-header issue on Linux; header wrapping fixed that without relaxing the assertions. All 181 harnesses, lint, typecheck, build and Vercel checks then passed. PR13 merged normally at 70a1d910dce32f8a1fddaede0b437ec1ac105dcb. Final deployment/browser/watch results are recorded below when complete.

### Capabilities intentionally still off

- Creation subscriptions, credit-pack checkout, automatic top-up charging and billing/top-up reconciliation activation: outstanding real payment lifecycle evidence and a separate opening decision.
- Provider daily spending: disabled. Consequently real AI generation remains paused, including admin generation. A deployed generation interface is not an enabled provider budget.
- AI image routing/model allowlist: unqualified and disabled. A production OpenAI key exists; its existence is not permission or evidence to enable images.
- Trusted full-source publication and asset broker: disabled. Production controller credentials/bucket/startup and golden publish/unpublish remain unqualified. Existing public-site hosting availability is a separate check.
- Gmail automation: off; sending-only OAuth verification remains a separate owner/Google step.

No paid AI calls or new cloud test VMs were used during this release. The original $5 ledger remains $4.912877 accounted/reserved. The separate $1 staging allowance retains $0.55 of completed test bounds, leaving $0.45; the separate $50 Claude allowance was not used. These are ledger bounds, not a claim of a reconciled provider invoice.

### Final observation

PASS. Final main70a1d910dce32f8a1fddaede0b437ec1ac105dcb is READY in production deployment dpl_ENjea1fLgLqR54bVLUcvMHXjfUfr, with the actual makeborne.com alias read back and matched. Main CI39529812103 also succeeded. Public home/login/billing/help passed all12 live browser combinations at375/800/1440, with no horizontal overflow, page errors or console errors. Final owner-session compiler was Available844ms; Health showed0errors and loaded visits/funnel. Project title search, Settings and command palette also worked without sending requests to paid providers or modifying project content.

Continuous observation ran from2026-10-21T01:30:55.508Z to02:01:08.826Z:31 samples over30.2145minutes, every monitored public page200, zero new first-party error groups. The watch began on35d47a7; the CSS-only70a1d91 update entered during it and received the separate final browser smoke above. This is not a claim of30minutes on the CSS follow-up alone. Final-deployment Vercel runtime queries returned0error records and0HTTP5xx records, with no excluded intervals or unexamined pagination.

Private execution receipts and screenshots are in work/lovable-qualification-20261020/live-release-20261021 under the original checkout. The active combined checkout holds these updated local release notes; executable release changes are already merged on main. The shared root AGENT_HANDOFF also records completion for Claude. No production fixture or customer content was created/modified by the read-only final smoke. Disposable staging fixtures, local rehearsal databases and the temporary container backup copy were cleaned; the canonical private production backup is retained.

The qualified app update is accepted. The deliberately disabled capabilities above remain independent commercial-launch blockers; neither this report nor a successful UI deployment activates them.

## Staged Worker follow-up

Live Brotli responses exposed weak-ETag conditional requests returning200. The small GET/HEAD weak-comparison repair preserves upstream access checks and passes all5Worker harnesses plus direct staging CSS/JS304 checks. Stage Worker bbb9d114-e962-49da-bf31-142260756ee1 also passes root/noindex/robots/sitemap smoke. Source/SQL tests above remain applicable; exact final commit is in the handoff. Production Worker update will retain the existing routes/secrets and disabled publication settings. Cloudflare confirms compression can weaken ETags: https://developers.cloudflare.com/cache/reference/etag-headers/ .
