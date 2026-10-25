# Tonight's minimum launch gates — 25 October 2026

Owner priority: launch tonight, finish necessary work. Existing explicit report-before-production gate remains in force. Urgency does not qualify a failed feature or authorize new recurring expenditure.

## Scope

Use release/minimum-launch-20261025: live main + new pricing page + isolated Whop checkout qualification + compact editor header + manual GitHub-export wording + review-draft restore fix. Keep continuous GitHub sync, unfinished apps backend/agency work, unqualified images, auto-top-up, custom domains and mail automation outside this release.

## New actual evidence

- Six fresh, confirmed, non-admin fictional staging accounts created through the exact staging Auth project; no external confirmation email sent. All are now banned, their sessions revoked, and local passwords/cookies removed. Financial test audit is retained.
- Authenticated staging availability returns all six new sandbox offers and no existing subscription.
- Owner explicitly approved all six sandbox-only purchases and cleanup. All six browser checkouts completed using fake4242 at the exact new monthly/yearly prices. Authenticated staging recovery granted exactly one monthly allowance each. Provider full refunds and immediate cancellations verified for all six; net credits zero, no active creation access afterwards.
- Manually signed refund events, replay and delayed paid-event tests pass; invalid signatures and wrong merchants are rejected. Actual provider automatic webhook delivery and scheduled reconciliation remain separate open gates. See minimum-launch-six-purchases-20261025.md.
- Production database status read in an explicit READ ONLY transaction, then rolled back/disconnected: creation_enabled=false; free_tier_enabled=false; every live_provider_limits row disabled with zero daily allowance. No production writes.
- Earlier local minimum-candidate186/186, types/lint/build and component browser passes remain evidence for their stated scope. Exact staging build READY; full payment and ordinary-user generated-site publication still unproven for this release.

## Release checklist

1. Obtain checkout-terms confirmation, execute six fake-money subscriptions on isolated staging fixtures and verify exact monthly credit delivery/provider dates. Preserve checkout binding, repeat-request and duplicate-subscription checks. Refund/revoke/cancel and verify ledger reversal; never disturb November renewal probes.
2. Exercise signed notifications/replay/refund/dispute and missing-first-event recovery, with protected reconcile health. Use only sandbox endpoints and exact staging ref; no old-price evidence substitution.
3. Finish signed-in staging header/export and anonymous review journey. Clean every fixture only after evidence capture and session revocation.
4. Verify ordinary paying-workspace publishing/controller entitlement. A retained owner-only publish pass cannot qualify all subscribers. Prove source/assets/routes/forms/HTTPS/republish/unpublish and retain the last good site during failure.
5. Verify customer generation availability and cost controls. Production is currently OFF. Prepare a small operating limit for owner approval; do not substitute the existing release-testing budget for ongoing customer spending. Qualified generation is necessary before charging for creation.
6. Read/prepare production six-plan configuration at $20/$49/$99 monthly and $192/$470.40/$950.40 yearly. New production plan IDs still required. No production offer/config/database changes before approval. Do not change the old catalogue IDs to sandbox IDs.
7. Deliver exact candidate/config delta, backup/restore/rollback commands, known off features, actual evidence and billing limitations. If any hard gate fails, say NO GO for paid launch; a scoped UI update or explicitly limited beta is a different owner decision.
8. Only after final owner go: backup, exact approved database/settings delta, normal PR merge, deploy, disposable production smoke and30-minute watch. No force push or automatic promotion.

## Spending and cleanup

No paid AI calls or real-money purchases in this pass. Current cloud allowance remains $1 reserved for minimum-release staging deployment and checkout qualification; actual build charge pending. Do not assume another deployment or publication VM fits an unconfirmed remainder. No new subscription purchased.

The six fictional accounts are retired: banned, sessions revoked, local passwords/cookies removed. Financial audit remains for review. Local redirect helper is stopped. No real payment. November renewal probes remain active and untouched.
