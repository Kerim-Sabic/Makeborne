# Lovable implementation qualification — 20 October 2026

**Production unchanged. Qualification is incomplete; this is not release approval.**

## Owner decisions implemented

- New automatic top-up setup being disabled cannot hide existing authorizations or prevent revocation. Creating/replacing consent still requires the setup flag. Consent is hashed from the stored offer shown to the customer. Automatic charging remains unimplemented and off.
- An unreadable home attachment stops generation and tailored-question calls. Keep the prompt and explain the problem. Retry, replace or explicitly leave out the file before sending. Leaving out does not delete the stored file or automatically submit the prompt.

## Evidence and scope

Private logs, local fixture screenshots and the new budget ledger are in the primary checkout's ignored `work/lovable-qualification-20261020/` directory. Historical research evidence was not modified. The new $5 testing allowance has **$0 spent, $0 reserved**. No Lovable requests were sent; the 18 queued layout instructions remain paused.

| Handoff item | Result so far | Remaining gate |
|---|---|---|
| 0: original branches | Independently passed 150/150 fixes and 142/142 billing harnesses, typecheck, full lint, webpack builds, original mounted checks and Worker checks | Five documented service/interactive/tariff skips are not passes |
| C3: usage history | 58 SQL suites passed, three documented skips, zero failures in separate disposable copies of the clean 94-migration base plus billing migrations. A new SQL suite calls actual withholding/restoration helpers and verifies history, wallet reconciliation and duplicate handling. Real signed-in local app at 1440/375 passes 120-row pagination, JSON coverage and charged sum = used | Large-ledger benchmark; staging confirmation. Month navigation across two populated months cannot be proven with only October available; month-boundary logic remains offline-tested |
| M05: title search | Local full-chain SQL: 5,000 artifacts, 151 matches over four pages, no duplicates, caller RLS, literal wildcard input and anonymous denial. Four pages: 784.98 ms in the final local run | Real route 404/409 checks, staging advisors and cloud performance |
| C2: asset cache | Local Worker implementation and all Worker checks pass. New workerd check covers 19 requests: republish, GET/HEAD/304, offline, JavaScript disable, retired files, changed digest and upstream outage | Cloud staging deployment, real publication and load observation |
| C4: fonts | Separate runtime image rebuilt. All 17 opt-in portability groups pass: eight actual font files/eight faces, current and historical source, exported archive/runtime byte parity, tamper refusal | Cloud serverless PDF/font inspection; native Windows/macOS PowerPoint checks |
| C1: Stop | Not implemented in this checkpoint | Durable cancellation, provider gating/abort, measured settlement, SQL/race/mounted tests and bounded staging qualification |
| M04/M09: real model behavior | No paid calls; source readiness and submission contracts are tested locally | Actual title/source-use samples with independent fixtures and advance ledger reservations |
| C5: consent safety | Implemented on billing branch; offline and 9 mounted checks pass; full updated branch passes 142/142, typecheck, lint and build | Integration/staging before release; charging stays off |
| C6: stale fixture | All 13 attachment-flow scenarios pass after request-specific completion waits replaced stale exact message counts | None locally |
| Final edited fixes candidate | 151/151 harnesses, full lint, typecheck and webpack build pass | Re-run after subsequent implementation changes; no frozen final candidate yet |

## Additional defect found

Supabase's default privileges directly granted `service_role` execution of title search, despite the authenticated-only contract. Additive forward repair `20261020144714_artifact_title_search_acl.sql` narrows this function only; its predecessor remains unchanged. The SQL regression explicitly checks the service-role denial. Applied only on the local rc API stack and disposable rehearsal copies, with a local backup first.

## Cache decision

Only fingerprinted script/style/font paths use edge byte caching. Mutable files use `public, max-age=0, must-revalidate` and a SHA-256 ETag. Cache keys include namespace, origin, slug and digest and ignore old v1 keys. Every request still executes the existing authoritative file RPC **before** consulting the cache, so edge hits do not bypass hosting eligibility, current manifest or JavaScript consent. This adds no second database query and claims no database-load reduction.

No old-revision grace period was added. A retired bundle returns 404; making older code public after revocation requires a separate retention policy. No network check can revoke bytes a visitor already downloaded or retained in their browser.

## Test corrections and limitations

- The older attachment fixture counted every completed assistant message; receipts introduced extra completed messages. Waits now target this request's saved output and verify the actual request attachments. Unsupported/oversized cases require explicit exclusion under the owner's new policy.
- An older namespace test deliberately expected stale image bytes. It now requires authoritative bytes, including same-namespace poisoned cache entries. The first candidate run failed this assertion (149/150); after correcting it, the full rerun passed 151/151.
- The real billing test initially used an invalid grant fixture, then selected both the usage and cost tables. Fixed those fixture mistakes, reran successfully and removed the disposable account. No product failure is inferred from those fixture failures.
- SQL restore emits six pre-existing `already exists` ownership/grant warnings in the dump runner; passing suites do not establish a hosted security-advisor comparison. The runner's process exit alone is insufficient: its JSON failure array was inspected and is empty.

## Branches and next release order

1. Keep `feature/billing-refunds-provenance` as the billing base; do not rewrite its history.
2. `feature/billing-audit-ux` includes consent safety checkpoint `6aa2dc1` and the real payment-history SQL regression.
3. `feature/lovable-audit-fixes` remains Claude's original implementation head `94f824d`.
4. `feature/lovable-qualification` adds this checkpoint on top of that fixes branch. Do not omit its forward ACL repair.
5. Finish C1, C3/M05 cloud checks, C2 cloud cache qualification, C4 output qualification and paid M04/M09 proof. Record exact candidate commits, images, migration hashes and remaining skips.
6. Open draft PRs with evidence and explicit outstanding gates. Do not merge, activate flags, deploy to production or apply production migrations without Kerim's separate approval.

Production release preparation must list `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `MAKEBORNE_AUTOTOPUP_SETUP_ENABLED`, and qualification-only `MAKEBORNE_VERIFY_PORTABLE_RUNTIME` / `MAKEBORNE_PORTABLE_RUNTIME_IMAGE` by name only. Keep automatic charging off. The runtime override is a test selector, not an application activation setting.

Rollback before merge: keep branches unreleased. After a separately approved release: revert the relevant application commits, roll the Worker back to its previous version, and restore the previous pinned runtime. Additive read functions may remain during application rollback; do not drop a function still used by a deployed app. Do not undo the narrower title-search ACL by widening service-role access.
