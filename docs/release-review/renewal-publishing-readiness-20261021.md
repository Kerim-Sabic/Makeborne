> Publishing update: the current staging chain and cleanup are now qualified in [Final cloud publishing](cloud-publishing-final-20261021.md). Its launch packet supersedes the earlier open staging-publishing statements below. Production remains unchanged; monthly renewal gates are still pending.

> Update: both monthly probes are now paid/active and independently configured; see [Active monthly probes](monthly-renewal-probes-20261021.md). The unsubmitted/preparation statements below describe the earlier checkpoint. The final0.005USD bound has been retained, so the latest1USD allowance is fully allocated.

# Renewal and production publishing readiness — 21 October 2026

## Current result
Production was not changed, deployed, merged or activated. This is a preparation report, not a launch sign-off.

### Billing
- Owner chose real monthly sandbox probes. Two separate ordinary staging accounts and actual $29/30-day USD checkouts are prepared: success and failure. No trial or initial surcharge. Both remain **unsubmitted** pending browser agreement confirmation; therefore no renewal is scheduled yet.
- Success probe: initial fake4242 purchase, keep the same membership active until Whop's recorded renewal. Failure probe: initial fake4242 purchase, then change **only this membership's** future payment method to fake0341 if Whop exposes that control. If only an account-wide change exists, stop rather than alter the success probe. An initial declined checkout is not a failed renewal.
- Save provider membership/start/end, checkout request binding and initial allocation after purchase. At renewal compare signed receipts, provider payment records, actual reconciliation results, allocation/expiry ledger, duplicate deliveries and access outcome. Never rewrite provider dates or forge a cycle event. Refund and cancel both after the journeys. Preserve audit; revoke sessions when finished.
- The previous real cycle payments belonged to canceled, app-unbound probes with seven-day billing windows. They are not monthly app-credit evidence.
- At 14:04 UTC both deployed staging job health endpoints returned200, overdue:false, openIssues:0; billing failuresLast24h:0 and top-up unchecked:0.
- Current sandbox API credential expires before a full month. Renew limited test access when needed; no persistent tunnel or ongoing monitor has been created. A later test turn must obtain fresh evidence and an explicit ledger reservation before running cloud work. No accelerated clock was found in the reviewed official membership-update documentation.

### Source and packaging
Runtime e45eaa50cf8527c367212df67f47bed4e63daced remains the deployed staging runtime. Local ff61f1d430f4512caeae75f2b217e9ea391c0b7f adds only .gitattributes to pin two staged SQL files to LF. A clean Windows archive and autocrlf checkout now exactly match staging's hashes. No runtime/SQL logic changed; no push.

Claude worktree remains ba1a7d8d2502309d360c5c332e71cdcadfac4d6b. Its latest additions are evaluator/documentation work, not additional app runtime fixes. Existing source and outputs were preserved. The actual prior fixes and 185-harness/database/cloud receipts are in checkout-recovery-and-cloud-20261021.md; this turn does not relabel them as a full production qualification.

### Production read-only baseline
Fresh verified-TLS read-only inspection found105 applied migrations, exactly two pending, production namespace already configured, zero publication-controller logins, zero enabled rollout workspaces, creation disabled and every provider daily limit disabled.

Pending order, unchanged staged bytes:
1. 20261021125359_checkout_payment_recovery.sql — cb048fb30957ceb52d64badedd37d12702477a99c5ea9544d619be9977ac3130
2. 20261021133151_billing_financial_reconcile_freshness.sql — 5045b832f0fa763c94cfc581175aa41b002fb38f0c8350f5da18f9b763728ee6

### Controller preparation
The current controller bundle was rebuilt locally, controller checks passed, and a new non-root Node24 Linux image passed its no-network self-check. Local image metadata and the exact image ID are retained in controller-package.json under work/renewal-publishing-readiness-20261021. It has NOT been installed on the supervisor host.

Read-only SSH confirms both staging and production services inactive/disabled; neither has an environment file, controller config or approval mapping installed. The existing approved $6/month host can be reused; no new subscription was purchased. systemd's prepared policy is Restart=always with10-second backoff,40-second termination and no pull on restart. This describes the configuration, not a newly proven production reboot recovery.

## Remaining gates before production approval
1. Submit/observe the two real monthly probes after action-time agreement confirmation. Qualify actual bound monthly renewal and payment failure, expiry and recovery. They cannot pass immediately after preparation.
2. Qualify the current full supervisor/approval/public-host/form chain and recovery matrix in staging. Current immutable compiler/renderer cloud smoke passed three bounded VMs and both routes, but not this complete chain or directly observed egress-denial matrix. New cloud tests require a new approved compute reservation; closed VM allowances cannot be reused.
3. Final source freeze, secret scan, CI and precise migration/rollback rehearsal for the exact release candidate, preserving Claude's latest handback. Refresh any expired test-only credentials.
4. Prepare the production-only restricted DB login (only publication_worker membership), bucket-scoped R2 credentials, exact immutable images and approval digest, broker secret and scoped Vercel credential. Verify the bucket exists and identities match. These resources are NOT certified present by this report. Propose only the owner's chosen workspace; the allowlist remains empty until approved.
5. After explicit owner go: verified production backup/restore record, exact-target dry-run showing only the two files above, apply in order, unchanged security advisor baseline, normal PR/deploy. Install pinned controller/config with independent production secrets; no staging bypass or service-role key in the controller. Enable only the explicitly approved workspace and publishing flags. Do not simultaneously open billing/AI switches without their own approval.
6. Golden site: prepare every route, compare approved preview against actual public375/1440 output, test HTTPS/assets/menu/animation/form destination, unpublish and verify removal. Run failure/recovery checks and30-minute watch before wider rollout.

## Recovery
Keep the previous live app/Worker and immutable controller identities before activation. On failure stop new publishing admission and its production service; do not promote unapproved output. Revert the app via normal PR and restore the previously qualified Worker/image/config where applicable. Preserve journal/orphan cleanup and evidence; do not blindly resume unknown VMs. The two migrations are additive and stay unless reviewed harmful. Customer live output should remain at its last approved revision. Disable checkout/top-ups and redeploy separately if billing exhibits a fault. No destructive production SQL is authorized here.

## Budgets and evidence limits
No paid AI calls this turn. Separate Claude ledger remains$1.926543 measured of$50. Latest$1 staging allowance now retains$0.995 of conservative bounds (not an invoice), leaving$0.005 unreserved. Previous closed ledgers stay unchanged. New preparation used no VM/build; health used two read-only function requests. No additional paid cloud work may silently draw on closed reservations or the Claude budget.

Private evidence: production-preflight.private.json; provider-evidence.private.json; monthly-*-fixture.private.json and browser states; monthly-plan-and-old-cycle-evidence.json; final-health.private.json; packaging-proof.json; controller-package.json; host-readonly-inventory.json. Never commit private configuration, passwords, tokens or browser states.
